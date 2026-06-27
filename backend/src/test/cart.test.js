import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'
import {
  authHeaders,
  createTestProduct,
  createTestTenant,
  registerAndLoginUser,
} from './testSetup.js'

describe('user cart', () => {
  let tenantContext
  let session
  let product

  beforeAll(async () => {
    await connectTestDB()
    await User.deleteMany()
    await Product.deleteMany()
    await Cart.deleteMany()
    await Tenant.deleteMany()

    tenantContext = await createTestTenant()
    session = await registerAndLoginUser({
      shopDomain: tenantContext.shopDomain,
      email: 'cart@test.com',
    })
    product = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Producto Carrito',
      price: 200,
      stock: 50,
    })
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('adds products to the cart', async () => {
    const res = await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({
        productId: product._id,
        quantity: 2,
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.products).toHaveLength(1)
  })

  test('returns the authenticated user cart', async () => {
    const res = await request(app)
      .get('/api/user/user-cart')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data.products.length).toBeGreaterThan(0)
  })

  test('removes a product from the cart', async () => {
    const res = await request(app)
      .delete(`/api/user/cart/${product._id}`)
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test('empties the cart', async () => {
    await request(app)
      .post('/api/user/cart')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({
        productId: product._id,
        quantity: 1,
      })

    const res = await request(app)
      .delete('/api/user/cart/empty')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.message).toMatch(/vac/i)
  })
})
