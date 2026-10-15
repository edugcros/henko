import mongoose from 'mongoose'
import request from 'supertest'
import { crearMongoEnMemoria } from './testDB.js'

// Definir los secretos antes de importar la aplicación y el controlador.
process.env.AI_AGENT_SECRET_ENCRYPTION_KEY =
  Buffer.alloc(32, 3).toString('base64url')
process.env.JWT_SECRET = 'test-access-secret-refresh-grace'
process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret-refresh-grace'
process.env.REFRESH_GRACE_MS = '60000'

const { default: app } = await import('../../app.js')
const { createTestTenant, createTestUser, getCSRFToken } =
  await import('./testSetup.js')
const { default: User } = await import('../models/userModel.js')
const { generateRefreshToken } =
  await import('../../config/generateRefreshToken.js')

let mongod

const authOptions = {
  ignoreTenant: true,
  platformScope: 'auth:usuario-por-identidad',
}

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  if (mongod) await mongod.stop()
})

describe('refresh token · cookie access durante la ventana de gracia', () => {
  test('la respuesta perdedora emite access HttpOnly, sin renovar refresh', async () => {
    const { tenant, shopDomain } = await createTestTenant()

    const { user } = await createTestUser({
      tenantId: tenant._id,
      role: 'user',
    })

    // Crear un refresh JWT auténtico y registrar su JTI en la sesión.
    const original = await generateRefreshToken(user._id, {
      tenantId: tenant._id,
      role: 'user',
    })

    const now = new Date()

    await User.updateOne(
      { _id: user._id },
      {
        $push: {
          refreshSessions: {
            tokenHash: original.hashedJti,
            previousTokenHash: null,
            rotatedAt: null,
            createdAt: now,
            lastUsedAt: now,
            userAgent: 'test-refresh-grace',
          },
        },
      },
    ).setOptions(authOptions)

    // Obtener un token CSRF real y conservar ambas cookies en la petición.
    const csrf = await getCSRFToken(shopDomain)

    expect(csrf.csrfToken).toBeTruthy()
    expect(csrf.csrfCookie).toBeTruthy()

    const cookieHeader =
      `${csrf.csrfCookie}; refreshToken=${original.refreshToken}`

    const refrescar = () =>
      request(app)
        .post('/api/user/refresh')
        .set('x-tenant-domain', shopDomain)
        .set('Cookie', cookieHeader)
        .set('X-CSRF-Token', csrf.csrfToken)
        .send({})

    // La primera petición gana la rotación y cambia el refresh vigente.
    const primera = await refrescar()

    expect(primera.status).toBe(200)

    const cookiesPrimera = primera.headers['set-cookie'] || []
    expect(
      cookiesPrimera.some(cookie => /^refreshToken=/i.test(cookie)),
    ).toBe(true)

    // La segunda presenta el mismo token antiguo y debe entrar por gracia.
    const segunda = await refrescar()

    expect(segunda.status).toBe(200)
    expect(segunda.body.success).toBe(true)

    const cookiesSegunda = segunda.headers['set-cookie'] || []

    // La respuesta de gracia debe renovar la cookie de acceso.
    const accessCookie = cookiesSegunda.find(cookie => /^token=/i.test(cookie))

    expect(accessCookie).toBeDefined()
    expect(accessCookie).toMatch(/;\s*HttpOnly\b/i)

    // La respuesta perdedora no debe sobrescribir el refresh ganador.
    expect(
      cookiesSegunda.some(cookie => /^refreshToken=/i.test(cookie)),
    ).toBe(false)
  })
})
