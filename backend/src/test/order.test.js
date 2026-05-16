// 📁 src/test/order.test.js
import request from 'supertest'
import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Order from '../models/orderModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'

describe('🧾 ORDENES - Usuario', () => {
  let csrfToken, csrfCookie, accessToken, userId, productId

  beforeAll(async () => {
    await connectTestDB()
    await User.deleteMany()
    await Product.deleteMany()
    await Order.deleteMany()

    const csrfRes = await request(app).get('/api/user/csrf-token')
    csrfToken = csrfRes.body.csrfToken
    csrfCookie = csrfRes.headers['set-cookie'][0]

    const registerRes = await request(app)
      .post('/api/user/register')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        firstname: 'Pedro',
        lastname: 'Ordenado',
        email: 'order@test.com',
        password: 'Test1234!',
        mobile: '1123456789',
      })

    userId = registerRes.body.data._id

    const loginRes = await request(app)
      .post('/api/user/login')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'order@test.com',
        password: 'Test1234!',
      })

    const cookies = loginRes.headers['set-cookie']
    accessToken = cookies.find(c => c.startsWith('accessToken'))?.split(';')[0]

    const product = await Product.create({
      title: 'Producto de Prueba',
      slug: 'producto-prueba',
      price: 500,
      quantity: 30,
      description: 'Para test de órdenes',
    })

    productId = product._id
  }, 10000)

  afterAll(async () => {
    await disconnectTestDB()
  })

  it('📦 Debería crear una orden con método COD', async () => {
    const res = await request(app)
      .post('/api/user/cart')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)
      .send({
        cart: [
          {
            _id: productId,
            count: 1,
            color: 'black',
          },
        ],
      })

    expect(res.statusCode).toBe(200)

    const orderRes = await request(app)
      .post('/api/user/order')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)
      .send({ paymentMethod: 'COD' })

    expect(orderRes.statusCode).toBe(201)
    expect(orderRes.body.data).toHaveProperty('orderStatus', 'Pending')
  })

  it('📋 Debería obtener las órdenes del usuario', async () => {
    const res = await request(app)
      .get('/api/user/get-orders')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)

    expect(res.statusCode).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
  })

  it('🧮 Debería haber actualizado el stock del producto', async () => {
    const productoActualizado = await Product.findById(productId)
    expect(productoActualizado.quantity).toBeLessThan(30)
  })
})
