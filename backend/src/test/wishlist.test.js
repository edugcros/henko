import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'
import {
  authHeaders,
  createTestProduct,
  createTestTenant,
  registerAndLoginUser,
} from './testSetup.js'

describe('wishlist', () => {
  let tenantContext
  let session
  let product

  beforeAll(async () => {
    await connectTestDB()
    await User.deleteMany()
    await Product.deleteMany()
    await Tenant.deleteMany()

    tenantContext = await createTestTenant()
    session = await registerAndLoginUser({
      shopDomain: tenantContext.shopDomain,
      email: 'wishlist@test.com',
    })
    product = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Producto Wishlist',
      price: 100,
      stock: 10,
    })
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('adds a product to the wishlist', async () => {
    const res = await request(app)
      .put(`/api/user/wishlist/${product._id}`)
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toMatch(/deseos/i)
  })

  test('returns the authenticated user wishlist', async () => {
    const res = await request(app)
      .get('/api/user/wishlist')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveLength(1)
    expect(String(res.body.data[0]._id)).toBe(String(product._id))
  })
})
