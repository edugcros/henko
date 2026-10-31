// Alias del panel compartido (PLATFORM_ADMIN_ALIASES).
//
// El panel se sirve también desde el dominio de Vercel del proyecto
// (henko-admin.vercel.app). Hace falta cuando admin.henkart.com.ar no es
// alcanzable desde una red: hay proveedores de internet que no llegan a uno de
// los bloques de IP de Vercel. Sin alias, el backend rechazaba ese origen por
// CORS y, aun dejándolo pasar, buscaba un comercio con ese dominio y devolvía
// 404, porque solo reconocía como panel compartido a ADMIN_BASE_DOMAIN.
//
// Lo que se fija:
//   - un alias se trata exactamente como el panel: CORS, comercio desde la
//     sesión y cookies de sesión del panel;
//   - la coincidencia es exacta: otro subdominio de vercel.app no pasa;
//   - en producción el alias solo se activa con cookies SameSite=None, y si
//     no, se ignora en vez de cortar el arranque de la API.

import mongoose from 'mongoose'
import request from 'supertest'
import { crearMongoEnMemoria } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const { default: app } = await import('../../app.js')
const { env, resolvePlatformAdminAliases } = await import('../../config/env.js')
const { esHostDePanelDePlataforma } = await import('../utils/domainUtils.js')
const { getSessionCookieNames, SESSION_COOKIE_NAMES } = await import('../utils/cookieHelper.js')

const ALIAS = 'henko-admin.vercel.app'
let mongod
let aliasesOriginales

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

beforeEach(() => {
  aliasesOriginales = env.platformAdminAliases
  env.platformAdminAliases = [ALIAS]
})

afterEach(() => {
  env.platformAdminAliases = aliasesOriginales
})

describe('alias del panel · reconocimiento', () => {
  test('el alias es el panel; otro subdominio de vercel.app no', () => {
    expect(esHostDePanelDePlataforma(ALIAS, 'admin.henkart.com.ar', [ALIAS])).toBe(true)
    expect(
      esHostDePanelDePlataforma('otro-henko-admin.vercel.app', 'admin.henkart.com.ar', [ALIAS]),
    ).toBe(false)
    expect(esHostDePanelDePlataforma('vercel.app', 'admin.henkart.com.ar', [ALIAS])).toBe(false)
  })

  test('sin alias configurados, solo el dominio principal es panel', () => {
    expect(esHostDePanelDePlataforma(ALIAS, 'admin.henkart.com.ar')).toBe(false)
    expect(esHostDePanelDePlataforma('admin.henkart.com.ar', 'admin.henkart.com.ar')).toBe(true)
  })

  test('las cookies de sesión desde el alias son las del panel', () => {
    const req = { headers: { origin: `https://${ALIAS}` } }
    expect(getSessionCookieNames(req)).toEqual(SESSION_COOKIE_NAMES.admin)
  })
})

describe('alias del panel · activación', () => {
  test('en producción con SameSite=None se activan', () => {
    expect(
      resolvePlatformAdminAliases({
        platformAdminAliasesRequested: [ALIAS],
        cookieSameSite: 'None',
        isProduction: true,
      }),
    ).toEqual([ALIAS])
  })

  test('en producción con Lax se ignoran (la sesión no viajaría) y no se corta nada', () => {
    expect(
      resolvePlatformAdminAliases({
        platformAdminAliasesRequested: [ALIAS],
        cookieSameSite: 'Lax',
        isProduction: true,
      }),
    ).toEqual([])
  })

  test('fuera de producción se activan', () => {
    expect(
      resolvePlatformAdminAliases({
        platformAdminAliasesRequested: [ALIAS],
        cookieSameSite: 'Lax',
        isProduction: false,
      }),
    ).toEqual([ALIAS])
  })
})

describe('alias del panel · contra la API', () => {
  test('CORS deja pasar el alias', async () => {
    const res = await request(app)
      .options('/api/user/csrf-token')
      .set('Origin', `https://${ALIAS}`)
      .set('Access-Control-Request-Method', 'GET')

    expect(res.headers['access-control-allow-origin']).toBe(`https://${ALIAS}`)
  })

  test('CORS sigue rechazando otro subdominio de vercel.app', async () => {
    const res = await request(app)
      .options('/api/user/csrf-token')
      .set('Origin', 'https://otro-proyecto.vercel.app')
      .set('Access-Control-Request-Method', 'GET')

    expect(res.status).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('desde el alias, el comercio sale de la sesión como en el panel (sin sesión: 401, no 404)', async () => {
    const res = await request(app)
      .get('/api/promotional-blocks')
      .set('Origin', `https://${ALIAS}`)
      .set('x-tenant-domain', ALIAS)

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Sesión requerida en el panel')
  })

  test('sin el alias activo, ese dominio no es ningún comercio (404, como antes)', async () => {
    env.platformAdminAliases = []

    const res = await request(app).get('/api/promotional-blocks').set('x-tenant-domain', ALIAS)

    expect(res.status).toBe(404)
  })
})
