import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import {
  authHeaders,
  createTestTenant,
  getCSRFToken,
  registerAndLoginUser,
} from './testSetup.js'

describe('user controller', () => {
  let tenantContext

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(User, Tenant)

    tenantContext = await createTestTenant()
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('registers a storefront user in the resolved tenant', async () => {
    const { csrfToken, csrfCookie } = await getCSRFToken(tenantContext.shopDomain)

    const res = await request(app)
      .post('/api/user/register')
      .set('x-tenant-domain', tenantContext.shopDomain)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        firstname: 'Edu',
        lastname: 'Greco',
        email: 'grecoeduardo87@gmail.com',
        password: 'Test1234!',
        mobile: '1123456789',
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.email).toBe('grecoeduardo87@gmail.com')

    const user = await User.findOne({
      email: 'grecoeduardo87@gmail.com',
      tenantId: tenantContext.tenant._id,
    })

    expect(user).toBeTruthy()
    user.isEmailVerified = true
    user.emailVerificationToken = undefined
    user.emailVerificationExpires = undefined
    await user.save({ validateBeforeSave: false })
  })

  test('logs in and returns an access token', async () => {
    const { csrfToken, csrfCookie } = await getCSRFToken(tenantContext.shopDomain)

    const res = await request(app)
      .post('/api/user/login')
      .set('x-tenant-domain', tenantContext.shopDomain)
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'grecoeduardo87@gmail.com',
        password: 'Test1234!',
      })

    expect([200, 201]).toContain(res.statusCode)
    expect(res.body.success).toBe(true)
    expect(res.body.data?.token || res.body.accessToken || res.body.token).toBeDefined()
  })

  test('returns the current authenticated user', async () => {
    const session = await registerAndLoginUser({
      shopDomain: tenantContext.shopDomain,
      email: 'profile@test.com',
    })

    const res = await request(app)
      .get('/api/user/me')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.email).toBe('profile@test.com')
  })
})

// Códigos de error de autenticación.
//
// El mensaje es para la persona y está en castellano; el código es para el
// cliente. Sin pruebas que los fijen son decoración: nadie se entera si uno
// cambia, y el frontend que decida por ellos se rompe en silencio.
//
// Por eso se afirma sobre `code` Y sobre el status: un código correcto con el
// status equivocado manda al frontend por la rama de error errónea igual.
describe('authMiddleware · códigos de error', () => {
  let contexto

  beforeAll(async () => {
    await connectTestDB()
    contexto = await createTestTenant()
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  const pedirMiUsuario = cabeceras =>
    request(app).get('/api/user/me').set(cabeceras)

  test('sin token · 401 AUTH_TOKEN_MISSING', async () => {
    const res = await pedirMiUsuario({
      'x-tenant-domain': contexto.shopDomain,
    })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING')
    // El mensaje no cambió: agregar el código es aditivo.
    expect(res.body.message).toBe('Token de acceso ausente')
  })

  test('el string "null" cuenta como ausente, no como inválido', async () => {
    // Un cliente que serializa un token vacío manda el string. Antes caía en
    // decodeAccessToken y contestaba "token inválido", que describe otra cosa.
    const res = await pedirMiUsuario({
      'x-tenant-domain': contexto.shopDomain,
      Authorization: 'Bearer null',
    })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_TOKEN_MISSING')
  })

  test('token ilegible · 401 AUTH_TOKEN_INVALID', async () => {
    const res = await pedirMiUsuario({
      'x-tenant-domain': contexto.shopDomain,
      Authorization: 'Bearer esto.no.es.un.jwt',
    })

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('AUTH_TOKEN_INVALID')
    expect(res.body.expired).toBe(false)
  })

  test('los códigos son distintos entre sí', async () => {
    // Si dos caminos devolvieran el mismo código, el frontend no podría
    // distinguirlos — que es exactamente el problema que esto viene a resolver.
    const sinToken = await pedirMiUsuario({
      'x-tenant-domain': contexto.shopDomain,
    })
    const tokenRoto = await pedirMiUsuario({
      'x-tenant-domain': contexto.shopDomain,
      Authorization: 'Bearer esto.no.es.un.jwt',
    })

    expect(sinToken.body.code).not.toBe(tokenRoto.body.code)
  })
})
