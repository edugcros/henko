import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'
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
    await User.deleteMany()
    await Tenant.deleteMany()

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
