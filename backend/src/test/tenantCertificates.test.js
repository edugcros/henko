// 📁 src/test/tenantCertificates.test.js
//
// El job que pasa sslStatus a 'active' cuando el dominio ya presenta un
// certificado válido.
//
// POR QUÉ SE ABRE UNA CONEXIÓN EN VEZ DE PREGUNTARLE AL PROVEEDOR
//
// Preguntarle a Cloudflare devuelve lo que Cloudflare CREE. Lo que importa es
// lo que ve el navegador del cliente, y entre una cosa y la otra hay varias
// formas de fallar: DNS que todavía apunta a otro lado, un proxy mal armado, un
// certificado emitido para otro nombre. El handshake contesta la pregunta real
// y sirve igual con cualquier proveedor.
//
// QUÉ SE MOCKEA Y QUÉ NO
//
// Solo node:tls. Las transiciones de estado corren contra base real, porque son
// exactamente lo que puede salir mal: activar el dominio equivocado, activar
// uno sin verificar, o degradar uno que ya andaba.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { EventEmitter } from 'node:events'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')
process.env.ROOT_DOMAIN = 'henkart.com.ar'

// Los hostnames que "tienen" certificado en cada prueba.
const conCertificado = new Set()
const conexiones = []

/**
 * Un socket TLS de mentira.
 *
 * Se emite en el próximo tick y no en el mismo, porque el código real se
 * suscribe a los eventos DESPUÉS de llamar a connect: emitir sincrónicamente
 * haría que nadie escuche y la promesa quedaría colgada.
 */
const tlsConnectMock = jest.fn((options, onSecure) => {
  conexiones.push(options)

  const socket = new EventEmitter()
  socket.destroy = jest.fn()
  socket.setTimeout = jest.fn()

  const autorizado = conCertificado.has(options.servername)

  process.nextTick(() => {
    if (autorizado) {
      socket.authorized = true
      socket.authorizationError = null
      onSecure()
    } else {
      socket.emit('error', Object.assign(new Error('sin certificado'), { code: 'ECONNREFUSED' }))
    }
  })

  return socket
})

jest.unstable_mockModule('node:tls', () => ({
  default: { connect: tlsConnectMock },
  connect: tlsConnectMock,
}))

const { default: Tenant } = await import('../models/tenantModel.js')
const { refreshPendingCertificates, hasValidCertificate } = await import(
  '../services/tenant/tenantDomainService.js'
)

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } })
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Tenant.collection.deleteMany({})
  conCertificado.clear()
  conexiones.length = 0
  tlsConnectMock.mockClear()
})

/** Un comercio con su subdominio y, opcionalmente, un dominio propio. */
const crearComercio = async (propio = null) => {
  const slug = `c-${Math.random().toString(36).slice(2, 8)}`

  return Tenant.create({
    name: 'Comercio',
    slug,
    status: 'active',
    domains: [
      {
        hostname: `${slug}.henkart.com.ar`,
        normalizedHostname: `${slug}.henkart.com.ar`,
        type: 'platform_subdomain',
        context: 'storefront',
        status: 'active',
        isPrimary: true,
      },
      ...(propio ? [{ normalizedHostname: propio.hostname, ...propio }] : []),
    ],
  })
}

const DOMINIO_VERIFICADO = {
  hostname: 'mitienda.com.ar',
  type: 'custom_domain',
  context: 'both',
  status: 'active',
  sslStatus: 'pending',
}

describe('el chequeo del certificado', () => {
  test('manda el SNI del dominio que está midiendo', async () => {
    // Sin servername, un borde compartido devolvería su certificado por defecto
    // y daríamos por bueno uno que no cubre este dominio. Es la diferencia
    // entre medir lo correcto y medir cualquier cosa.
    conCertificado.add('mitienda.com.ar')

    await hasValidCertificate('mitienda.com.ar')

    expect(conexiones[0].servername).toBe('mitienda.com.ar')
    expect(conexiones[0].port).toBe(443)
    // Autofirmado no le sirve al cliente, así que tampoco acá.
    expect(conexiones[0].rejectUnauthorized).toBe(true)
  })

  test('sin certificado devuelve false en vez de lanzar', async () => {
    // Un dominio recién verificado SIN certificado todavía es el estado normal.
    // Si esto lanzara, el job se cortaría en el primer dominio pendiente y no
    // revisaría ninguno de los siguientes.
    const res = await hasValidCertificate('sin-cert.com.ar')

    expect(res.ok).toBe(false)
  })
})

describe('la revisión periódica', () => {
  test('activa el dominio que ya tiene certificado', async () => {
    conCertificado.add('mitienda.com.ar')
    const tenant = await crearComercio(DOMINIO_VERIFICADO)

    const res = await refreshPendingCertificates()

    expect(res.activados).toBe(1)

    const actualizado = await Tenant.findById(tenant._id)
    const propio = actualizado.domains.find(d => d.type === 'custom_domain')

    expect(propio.sslStatus).toBe('active')
    expect(propio.lastCheckedAt).toBeInstanceOf(Date)
  })

  test('el que todavía no lo tiene sigue pendiente', async () => {
    const tenant = await crearComercio(DOMINIO_VERIFICADO)

    const res = await refreshPendingCertificates()

    expect(res.revisados).toBe(1)
    expect(res.activados).toBe(0)

    const actualizado = await Tenant.findById(tenant._id)
    const propio = actualizado.domains.find(d => d.type === 'custom_domain')

    expect(propio.sslStatus).toBe('pending')
    // Pero queda registrado que se miró: sin esto no se puede distinguir un
    // dominio que lleva cinco minutos de uno que lleva cinco días.
    expect(propio.lastCheckedAt).toBeInstanceOf(Date)
  })

  test('NO mira dominios sin verificar', async () => {
    // ESTA ES LA QUE AHORRA TIEMPO Y CONFUSIÓN. Un dominio que no pasó la
    // verificación de propiedad ni siquiera apunta acá: preguntarle por su
    // certificado es gastar el timeout completo para no aprender nada.
    await crearComercio({ ...DOMINIO_VERIFICADO, status: 'pending' })

    const res = await refreshPendingCertificates()

    expect(res.revisados).toBe(0)
    expect(tlsConnectMock).not.toHaveBeenCalled()
  })

  test('NO mira subdominios de la plataforma', async () => {
    // Los cubre el wildcard y su sslStatus es 'not_required'. Revisarlos sería
    // una conexión por comercio en cada pasada, para nada.
    await crearComercio()

    const res = await refreshPendingCertificates()

    expect(res.revisados).toBe(0)
    expect(tlsConnectMock).not.toHaveBeenCalled()
  })

  test('NO vuelve a mirar uno que ya está activo', async () => {
    await crearComercio({ ...DOMINIO_VERIFICADO, sslStatus: 'active' })

    const res = await refreshPendingCertificates()

    expect(res.revisados).toBe(0)
  })

  test('NO degrada un dominio que ya andaba', async () => {
    // Un certificado que hoy no responde puede ser un problema de red
    // pasajero. Bajarlo a pendiente haría que el panel alarme al comercio por
    // algo que se arregla solo — y el comercio no puede hacer nada al
    // respecto, que es la peor clase de alarma.
    const tenant = await crearComercio({ ...DOMINIO_VERIFICADO, sslStatus: 'active' })

    // Nadie en conCertificado: el handshake falla para todos.
    await refreshPendingCertificates()

    const actualizado = await Tenant.findById(tenant._id)
    const propio = actualizado.domains.find(d => d.type === 'custom_domain')

    expect(propio.sslStatus).toBe('active')
  })

  test('un dominio caído no impide revisar los demás', async () => {
    // Si el job se cortara en el primer fallo, un solo dominio mal configurado
    // dejaría a todos los demás comercios esperando para siempre.
    conCertificado.add('anda.com.ar')

    await crearComercio({ ...DOMINIO_VERIFICADO, hostname: 'no-anda.com.ar' })
    await crearComercio({ ...DOMINIO_VERIFICADO, hostname: 'anda.com.ar' })

    const res = await refreshPendingCertificates()

    expect(res.revisados).toBe(2)
    expect(res.activados).toBe(1)
  })
})
