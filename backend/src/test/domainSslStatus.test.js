// 📁 src/test/domainSslStatus.test.js
//
// El estado del certificado dice cómo está el certificado, no en qué entorno
// corre el proceso.
//
// QUÉ ESTABA MAL
//
// El alta de comercio escribía, para los dos dominios que crea:
//
//   sslStatus: env.isProduction ? 'active' : 'not_required'
//
// O sea que en producción todo dominio nacía declarando certificado ACTIVO sin
// que nada lo hubiera comprobado. El campo terminaba informando NODE_ENV.
//
// Hoy no se nota porque nadie lee `sslStatus` todavía. Se va a notar el día que
// los comercios carguen sus propios dominios: el panel diría que está todo bien
// mientras el comercio ve un error de certificado en el navegador — que es el
// peor modo de falla posible para un campo de estado, porque desvía el
// diagnóstico en vez de ayudarlo.
//
// EL VALOR CORRECTO DEPENDE DEL TIPO, Y ESO SÍ SE PUEDE SABER AL CREARLO
//
//   platform_subdomain  lo cubre el wildcard de la plataforma: no hay
//                       certificado propio que emitir. 'not_required' es
//                       literal.
//   custom_domain       necesita el suyo. 'pending' hasta que el proveedor
//                       confirme.
//
// Sin base: es el default de un schema de Mongoose, y se puede medir
// instanciando el documento sin guardarlo.

import mongoose from 'mongoose'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const { default: Tenant } = await import('../models/tenantModel.js')

const construir = domains =>
  new Tenant({
    name: 'Comercio',
    slug: `slug-${Math.random().toString(36).slice(2, 9)}`,
    status: 'active',
    domains,
  })

afterAll(async () => {
  // El modelo se importa pero nunca se conecta: no hay nada que cerrar más que
  // la conexión por defecto, que queda en estado 'disconnected'.
  if (mongoose.connection.readyState === 1) await mongoose.disconnect()
})

describe('el estado inicial del certificado', () => {
  test('un subdominio de plataforma no necesita certificado propio', () => {
    // Lo cubre el wildcard. 'active' afirmaría que emitimos uno.
    const tenant = construir([
      {
        hostname: 'tienda.henkart.com.ar',
        normalizedHostname: 'tienda.henkart.com.ar',
        type: 'platform_subdomain',
      },
    ])

    expect(tenant.domains[0].sslStatus).toBe('not_required')
  })

  test('un dominio propio del comercio arranca PENDIENTE', () => {
    // ESTA ES LA PROPIEDAD QUE IMPORTA. Es el caso que viene con los dominios
    // de comercio, y el que antes habría nacido diciendo 'active'.
    const tenant = construir([
      {
        hostname: 'mitienda.com.ar',
        normalizedHostname: 'mitienda.com.ar',
        type: 'custom_domain',
      },
    ])

    expect(tenant.domains[0].sslStatus).toBe('pending')
  })

  test('sin tipo explícito cae al subdominio de plataforma', () => {
    // `type` tiene default 'platform_subdomain', y el estado tiene que seguirlo
    // en vez de asumir lo más optimista.
    const tenant = construir([
      {
        hostname: 'algo.henkart.com.ar',
        normalizedHostname: 'algo.henkart.com.ar',
      },
    ])

    expect(tenant.domains[0].type).toBe('platform_subdomain')
    expect(tenant.domains[0].sslStatus).toBe('not_required')
  })

  test('el entorno no entra en la cuenta', () => {
    // Es lo que se rompió antes: el valor salía de env.isProduction. Que el
    // mismo dominio dé lo mismo con NODE_ENV cambiado es exactamente la
    // propiedad que faltaba.
    const anterior = process.env.NODE_ENV

    try {
      process.env.NODE_ENV = 'production'
      const enProd = construir([
        {
          hostname: 'mitienda.com.ar',
          normalizedHostname: 'mitienda.com.ar',
          type: 'custom_domain',
        },
      ])

      process.env.NODE_ENV = 'development'
      const enDev = construir([
        {
          hostname: 'mitienda.com.ar',
          normalizedHostname: 'mitienda.com.ar',
          type: 'custom_domain',
        },
      ])

      expect(enProd.domains[0].sslStatus).toBe(enDev.domains[0].sslStatus)
      expect(enProd.domains[0].sslStatus).toBe('pending')
    } finally {
      process.env.NODE_ENV = anterior
    }
  })

  test('un valor explícito sigue mandando', () => {
    // El default es el punto de partida, no una imposición: cuando el flujo de
    // verificación exista, va a escribir 'active' o 'failed' acá.
    const tenant = construir([
      {
        hostname: 'mitienda.com.ar',
        normalizedHostname: 'mitienda.com.ar',
        type: 'custom_domain',
        sslStatus: 'active',
      },
    ])

    expect(tenant.domains[0].sslStatus).toBe('active')
  })
})
