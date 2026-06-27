import request from 'supertest'

import app from '../../app.js'
import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'
import {
  authHeaders,
  createTestTenant,
  createTestUser,
  getCSRFToken,
} from './testSetup.js'

describe('product controller', () => {
  let tenantContext
  let adminSession
  let csrf
  let productId

  beforeAll(async () => {
    await connectTestDB()
    await Product.deleteMany()
    await User.deleteMany()
    await Tenant.deleteMany()

    tenantContext = await createTestTenant()
    adminSession = await createTestUser({
      tenantId: tenantContext.tenant._id,
      email: 'product-admin@test.com',
      role: 'admin',
    })
    csrf = await getCSRFToken(tenantContext.adminDomain)
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('creates a product as tenant admin', async () => {
    const res = await request(app)
      .post('/api/product')
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
        csrfToken: csrf.csrfToken,
        csrfCookie: csrf.csrfCookie,
      }))
      .send({
        title: 'Producto de prueba',
        description: 'Descripción de prueba',
        marca: 'PruebaBrand',
        categoria: 'TestCategory',
        subcategoria: 'General',
        price: 1000,
        stock: 10,
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.title).toBe('Producto de prueba')
    productId = res.body.data._id
  })

  test('returns storefront products for the resolved tenant', async () => {
    const res = await request(app)
      .get('/api/product')
      .set('x-tenant-domain', tenantContext.shopDomain)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  test('returns a storefront product by id', async () => {
    const res = await request(app)
      .get(`/api/product/${productId}`)
      .set('x-tenant-domain', tenantContext.shopDomain)

    expect(res.statusCode).toBe(200)
    expect(String(res.body.data._id)).toBe(String(productId))
  })

  test('updates a product as tenant admin', async () => {
    const res = await request(app)
      .put(`/api/product/${productId}`)
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
        csrfToken: csrf.csrfToken,
        csrfCookie: csrf.csrfCookie,
      }))
      .send({ price: 1500 })

    expect(res.statusCode).toBe(200)
    expect(res.body.data.price).toBe(1500)
  })

  test('deletes a product as tenant admin', async () => {
    const res = await request(app)
      .delete(`/api/product/${productId}`)
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
        csrfToken: csrf.csrfToken,
        csrfCookie: csrf.csrfCookie,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
