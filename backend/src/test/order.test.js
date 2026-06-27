import request from 'supertest'

import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Order, { PAYMENT_STATUS } from '../models/orderModel.js'
import Cart from '../models/cartModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'
import {
  authHeaders,
  createTestProduct,
  createTestTenant,
  registerAndLoginUser,
} from './testSetup.js'

describe('orders - storefront user', () => {
  let tenantContext
  let session
  let product
  let createdOrderId

  beforeAll(async () => {
    await connectTestDB()
    await User.deleteMany()
    await Product.deleteMany()
    await Order.deleteMany()
    await Cart.deleteMany()
    await Tenant.deleteMany()

    tenantContext = await createTestTenant()
    session = await registerAndLoginUser({
      shopDomain: tenantContext.shopDomain,
      email: 'order@test.com',
    })
    product = await createTestProduct({
      tenantId: tenantContext.tenant._id,
      title: 'Producto Orden',
      price: 500,
      stock: 30,
    })
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('creates a cash-on-delivery order from the cart', async () => {
    const cartRes = await request(app)
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

    expect(cartRes.statusCode).toBe(200)

    const orderRes = await request(app)
      .post('/api/order/create')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
        csrfToken: session.csrfToken,
        csrfCookie: session.csrfCookie,
      }))
      .send({
        COD: true,
        shippingAddress: {
          firstName: 'Pedro',
          lastName: 'Ordenado',
          email: 'order@test.com',
          phone: '+541123456789',
          address: 'Calle Test 123',
          city: 'Buenos Aires',
          zipCode: '1000',
          country: 'AR',
        },
      })

    expect(orderRes.statusCode).toBe(201)
    expect(orderRes.body.success).toBe(true)
    expect(orderRes.body.data.paymentStatus).toBe(PAYMENT_STATUS.APPROVED)
    createdOrderId = orderRes.body.data._id
  })

  test('returns authenticated user orders', async () => {
    const res = await request(app)
      .get('/api/order/my-orders')
      .set(authHeaders({
        token: session.token,
        domain: tenantContext.shopDomain,
      }))

    expect(res.statusCode).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(String(res.body.data[0]._id)).toBe(String(createdOrderId))
  })

  test('decrements product stock for cash-on-delivery orders', async () => {
    const updatedProduct = await Product.findOne({
      _id: product._id,
      tenantId: tenantContext.tenant._id,
    }).setOptions({ tenantId: tenantContext.tenant._id })

    expect(updatedProduct.stock).toBeLessThan(30)
  })
})
