// 📁 src/test/tenantSurfaces.test.js
//
// Un dominio puede servir la tienda, el panel, o las dos cosas.
//
// QUÉ PROBLEMA RESUELVE
//
// El contexto se derivaba de un solo booleano —`isAdminDomainForTenant`, que
// miraba únicamente `adminDomains`— y las dos guardas de ruta son excluyentes:
//
//   requireAdminDomain   403 si NO es contexto admin   (27 rutas)
//   requireShopDomain    403 si SÍ es contexto admin   (30 rutas)
//
// Con un comercio usando UN SOLO dominio para la tienda y el panel, cualquiera
// de las dos respuestas rompía la mitad del sistema. No había forma de
// configurarlo: era un cambio de código.
//
// Ahora son dos preguntas independientes. Un dominio con `context: 'both'` es
// superficie de las dos, y las guardas preguntan por lo que cada una necesita
// en vez de por la negación de la otra.
//
// LO QUE MÁS IMPORTA ACÁ NO ES LO NUEVO
//
// Es que lo viejo siga igual. El cambio toca el punto por el que pasa toda
// request con dominio, así que la mitad de estas pruebas fija el comportamiento
// de los comercios con dominios separados — que son todos los que existen hoy.

import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const { default: app } = await import('../../app.js')
const { default: Tenant } = await import('../models/tenantModel.js')
const { createTestTenant, createTestUser, getCSRFToken } = await import('./testSetup.js')

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } })
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

/** Un comercio con UN solo dominio que sirve las dos superficies. */
const crearComercioDominioUnico = async () => {
  const unico = `unico-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.test`

  const tenant = await Tenant.create({
    name: 'Comercio de Dominio Único',
    slug: unico.split('.')[0],
    status: 'active',
    plan: 'starter',
    domains: [
      {
        hostname: unico,
        normalizedHostname: unico,
        type: 'custom_domain',
        context: 'both',
        status: 'active',
        isPrimary: true,
      },
    ],
    adminDomains: [],
  })

  const { token } = await createTestUser({ tenantId: tenant._id, role: 'admin' })

  return { tenant, dominio: unico, token }
}

const crearColor = async ({ dominio, token, title }) => {
  const { csrfToken, csrfCookie } = await getCSRFToken(dominio)

  return request(app)
    .post('/api/color')
    .set('Authorization', `Bearer ${token}`)
    .set('x-tenant-domain', dominio)
    .set('Cookie', csrfCookie)
    .set('X-CSRF-Token', csrfToken)
    .send({ title })
}

const listarColores = dominio =>
  request(app).get('/api/color').set('x-tenant-domain', dominio)

describe('dominios separados · lo que ya funcionaba sigue igual', () => {
  test('el dominio de panel sirve el panel', async () => {
    const { tenant, adminDomain } = await createTestTenant()
    const { token } = await createTestUser({ tenantId: tenant._id, role: 'admin' })

    const res = await crearColor({ dominio: adminDomain, token, title: 'violeta' })

    expect(res.status).toBe(201)
  })

  test('el dominio de panel NO sirve la tienda', async () => {
    // requireShopDomain tiene que seguir cortando acá. Es la propiedad que más
    // fácil se rompía al cambiar la negación por una pregunta afirmativa.
    const { adminDomain } = await createTestTenant()

    const res = await listarColores(adminDomain)

    expect(res.status).toBe(403)
  })

  test('el dominio de tienda sirve la tienda', async () => {
    const { shopDomain } = await createTestTenant()

    const res = await listarColores(shopDomain)

    expect(res.status).toBe(200)
  })

  test('el dominio de tienda NO sirve el panel', async () => {
    const { tenant, shopDomain } = await createTestTenant()
    const { token } = await createTestUser({ tenantId: tenant._id, role: 'admin' })

    const res = await crearColor({ dominio: shopDomain, token, title: 'naranja' })

    expect(res.status).toBe(403)
  })
})

describe('dominio único · las dos superficies a la vez', () => {
  test('sirve el PANEL', async () => {
    // ESTA ES LA MITAD QUE ANTES DABA 403. Con el booleano viejo, un dominio
    // cargado en `domains` daba isAdminContext=false y las 27 rutas del panel
    // rebotaban.
    const { dominio, token } = await crearComercioDominioUnico()

    const res = await crearColor({ dominio, token, title: 'celeste' })

    expect(res.status).toBe(201)
  })

  test('sirve la TIENDA', async () => {
    // Y esta es la otra mitad: marcarlo como admin para arreglar lo de arriba
    // habría hecho que las 30 rutas de tienda devolvieran 403.
    const { dominio, token } = await crearComercioDominioUnico()

    await crearColor({ dominio, token, title: 'bordo' })

    const res = await listarColores(dominio)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('las dos superficies resuelven el MISMO comercio', async () => {
    // Un dominio, un comercio. Si panel y tienda resolvieran comercios
    // distintos el aislamiento estaría roto, que es peor que el 403 original.
    const { tenant, dominio, token } = await crearComercioDominioUnico()

    const creado = await crearColor({ dominio, token, title: 'turquesa' })

    expect(String(creado.body.data.tenantId)).toBe(String(tenant._id))
  })

  test('sigue exigiendo rol de admin para el panel', async () => {
    // El dominio único quita la separación por HOST, no la autorización. Lo que
    // protege el panel es el rol, y tiene que seguir protegiéndolo — si no,
    // esto sería cambiar un 403 molesto por un agujero.
    const { tenant, dominio } = await crearComercioDominioUnico()
    const { token } = await createTestUser({ tenantId: tenant._id, role: 'user' })

    const res = await crearColor({ dominio, token, title: 'magenta' })

    expect(res.status).toBe(403)
  })
})
