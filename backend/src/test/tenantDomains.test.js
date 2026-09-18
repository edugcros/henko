// 📁 src/test/tenantDomains.test.js
//
// El alta y la verificación de los dominios propios de un comercio.
//
// QUÉ SE PRUEBA
//
// Lo que hace que esto sea seguro no es el paso de verificar: es que el dominio
// nazca INERTE. Entra en `status: 'pending'`, y findTenantByDomainCandidates
// exige 'active', así que hasta que alguien pruebe que el dominio es suyo no
// resuelve a nada. Si esa propiedad se rompe, cualquier comercio podría
// reclamar el dominio de otro y la plataforma se lo serviría.
//
// EL DNS VA MOCKEADO, EL RESTO NO
//
// dns.resolveTxt es lo único simulado: depende de internet y de propagación, y
// no es lo que se está midiendo. Las transiciones de estado, la unicidad y las
// guardas corren contra base real, porque la unicidad global entre comercios la
// resuelve un índice único de Mongo y con un mock se probaría el mock.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')
// El dominio de la plataforma, para poder probar que no se puede reclamar.
process.env.ROOT_DOMAIN = 'henkart.com.ar'
process.env.PUBLIC_BASE_DOMAIN = 'henkart.com.ar'

const resolveTxtMock = jest.fn()

jest.unstable_mockModule('node:dns', () => ({
  promises: { resolveTxt: resolveTxtMock },
  default: { promises: { resolveTxt: resolveTxtMock } },
}))

const { default: Tenant } = await import('../models/tenantModel.js')
const {
  registerTenantDomain,
  verifyTenantDomain,
  listTenantDomains,
  removeTenantDomain,
  VERIFICATION_PREFIX,
} = await import('../services/tenant/tenantDomainService.js')

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } })
  await mongoose.connect(mongod.getUri())
  await Tenant.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(async () => {
  await Tenant.collection.deleteMany({})
  resolveTxtMock.mockReset()
  // Lo normal al cargar un dominio recién creado: todavía no hay nada.
  resolveTxtMock.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
})

const crearComercio = async (slug = `c-${Math.random().toString(36).slice(2, 8)}`) =>
  Tenant.create({
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
    ],
  })

describe('alta de un dominio propio', () => {
  test('nace INERTE y con instrucciones', async () => {
    // ESTA ES LA PROPIEDAD DE SEGURIDAD. Pendiente no es cosmético: el
    // resolvedor exige 'active', así que un dominio sin verificar no resuelve a
    // ningún comercio.
    const tenant = await crearComercio()

    const { domain, instructions } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(domain.status).toBe('pending')
    expect(domain.type).toBe('custom_domain')
    // Un dominio por comercio sirviendo tienda Y panel: es el modelo que
    // resolveSurfacesForTenant sabe interpretar.
    expect(domain.context).toBe('both')
    // Y sin certificado propio todavía.
    expect(domain.sslStatus).toBe('pending')

    expect(instructions.verification.type).toBe('TXT')
    expect(instructions.verification.name).toBe(`${VERIFICATION_PREFIX}.mitienda.com.ar`)
    expect(instructions.verification.value).toMatch(/^henko-verify=[a-f0-9]{32}$/)
  })

  test('el token de verificación no viaja en el listado', async () => {
    // Es `select: false` en el modelo. Filtrarlo en el serializador además es
    // redundante a propósito: el día que alguien agregue un `.select('+...')`
    // por otro motivo, el token no se escapa igual.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const listado = await listTenantDomains(tenant._id)

    expect(listado.every(d => !('verificationToken' in d))).toBe(true)
  })

  test('normaliza lo que pega el comercio', async () => {
    // La gente copia la URL del navegador. Rechazarlo sería correcto y molesto.
    const tenant = await crearComercio()

    const { domain } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: '  HTTPS://MiTienda.com.ar/  ',
    })

    expect(domain.hostname).toBe('mitienda.com.ar')
  })

  test('rechaza un valor que no es un dominio', async () => {
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'localhost' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  test('NO se puede reclamar un dominio de la plataforma', async () => {
    // Sin esta guarda, un comercio podría cargar el subdominio de otro. El
    // índice único no alcanza: protege de reclamar un dominio YA cargado, no
    // uno que todavía no existe en la base.
    const tenant = await crearComercio()

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'otra-tienda.henkart.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  test('NO se puede reclamar el dominio de otro comercio', async () => {
    // Lo resuelve el índice único sobre domainKeys: la base, no una
    // comprobación previa que pueda perder la carrera.
    const primero = await crearComercio()
    const segundo = await crearComercio()

    await registerTenantDomain({ tenantId: primero._id, hostname: 'disputado.com.ar' })

    await expect(
      registerTenantDomain({ tenantId: segundo._id, hostname: 'disputado.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  test('no se puede cargar dos veces el mismo en el propio comercio', async () => {
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    await expect(
      registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('verificación de propiedad', () => {
  test('sin el TXT sigue pendiente, y no es un error', async () => {
    // Es el caso normal: el comercio acaba de cargar el dominio y todavía no
    // tocó su DNS. Tratarlo como falla haría que el panel muestre un error por
    // algo que está saliendo bien.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(false)
    expect(res.domain.status).toBe('pending')
    // Y se le vuelve a decir qué cargar, para no tener que buscarlo.
    expect(res.instructions.verification.name).toContain(VERIFICATION_PREFIX)
  })

  test('con el TXT correcto queda ACTIVO', async () => {
    const tenant = await crearComercio()
    const { instructions } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    resolveTxtMock.mockResolvedValue([[instructions.verification.value]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(true)
    expect(res.domain.status).toBe('active')
    expect(res.domain.verifiedAt).toBeInstanceOf(Date)
  })

  test('un TXT de otro NO alcanza', async () => {
    // ESTA ES LA PROPIEDAD. Que exista un TXT en ese nombre no prueba nada: lo
    // que prueba la propiedad es que sea EL token que emitimos para ESTE
    // comercio.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    resolveTxtMock.mockResolvedValue([['henko-verify=' + 'f'.repeat(32)]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(false)
    expect(res.domain.status).toBe('pending')
  })

  test('un TXT partido en fragmentos se une antes de comparar', async () => {
    // resolveTxt devuelve arrays de fragmentos: un TXT largo llega partido y
    // comparar fragmento por fragmento nunca daría verdadero.
    const tenant = await crearComercio()
    const { instructions } = await registerTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    const token = instructions.verification.value
    const mitad = Math.floor(token.length / 2)
    resolveTxtMock.mockResolvedValue([[token.slice(0, mitad), token.slice(mitad)]])

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.verified).toBe(true)
  })

  test('deja registrado cuándo se miró', async () => {
    // lastCheckedAt existía en el modelo y no lo escribía nadie. Sin él no se
    // puede saber si un dominio lleva pendiente cinco minutos o cinco días.
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const res = await verifyTenantDomain({
      tenantId: tenant._id,
      hostname: 'mitienda.com.ar',
    })

    expect(res.domain.lastCheckedAt).toBeInstanceOf(Date)
  })

  test('no se puede verificar un dominio que no es del comercio', async () => {
    const tenant = await crearComercio()

    await expect(
      verifyTenantDomain({ tenantId: tenant._id, hostname: 'ajeno.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('baja', () => {
  test('se puede dar de baja el dominio propio', async () => {
    const tenant = await crearComercio()
    await registerTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    await removeTenantDomain({ tenantId: tenant._id, hostname: 'mitienda.com.ar' })

    const listado = await listTenantDomains(tenant._id)
    expect(listado.some(d => d.hostname === 'mitienda.com.ar')).toBe(false)
  })

  test('el subdominio de la plataforma NO se puede borrar', async () => {
    // Es la dirección que siempre funciona. Borrarla dejaría al comercio sin
    // ninguna forma de entrar si su dominio propio falla — y el momento en que
    // eso pasa es justo el momento en que necesita entrar.
    const tenant = await crearComercio('fijo')

    await expect(
      removeTenantDomain({ tenantId: tenant._id, hostname: 'fijo.henkart.com.ar' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
