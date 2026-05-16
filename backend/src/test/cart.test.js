// 📁 src/test/cart.test.js
jest.setTimeout(30000)
import request from 'supertest'
import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'

describe('🛒 USER CART', () => {
  let csrfToken, csrfCookie, accessToken, userId, productId

  beforeAll(async () => {
    await connectTestDB()
    await User.deleteMany()
    await Product.deleteMany()
    await Cart.deleteMany()

    const csrfRes = await request(app).get('/api/user/csrf-token')
    csrfToken = csrfRes.body.csrfToken
    csrfCookie = csrfRes.headers['set-cookie'][0]

    const registerRes = await request(app)
      .post('/api/user/register')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        firstname: 'María',
        lastname: 'Pérez',
        email: 'cart@test.com',
        password: 'Test1234!',
        mobile: '1123456789',
      })

    userId = registerRes.body.data._id

    const loginRes = await request(app)
      .post('/api/user/login')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'cart@test.com',
        password: 'Test1234!',
      })

    const cookies = loginRes.headers['set-cookie']
    accessToken = cookies.find(c => c.startsWith('accessToken'))?.split(';')[0]

    const product = await Product.create({
      title: 'Producto Carrito',
      slug: 'producto-carrito',
      price: 200,
      quantity: 50,
      description: 'Producto para testing de carrito',
    })

    productId = product._id
  }, 10000)

  afterAll(async () => {
    await disconnectTestDB()
  })

  it('➕ Debería añadir productos al carrito', async () => {
    const res = await request(app)
      .post('/api/user/cart')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)
      .send({
        cart: [
          {
            _id: productId,
            count: 2,
            color: 'red',
          },
        ],
      })

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('📦 Debería obtener el carrito del usuario', async () => {
    const res = await request(app)
      .get('/api/user/cart')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)

    expect(res.statusCode).toBe(200)
    expect(res.body.data.products.length).toBeGreaterThan(0)
  })

  it('❌ Debería eliminar un producto del carrito', async () => {
    const res = await request(app)
      .delete(`/api/user/cart/${productId}`)
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('🧹 Debería vaciar completamente el carrito', async () => {
    await request(app)
      .post('/api/user/cart')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)
      .send({
        cart: [
          {
            _id: productId,
            count: 1,
            color: 'blue',
          },
        ],
      })

    const res = await request(app)
      .delete('/api/user/empty-cart')
      .set('Cookie', [...csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)

    expect(res.statusCode).toBe(200)
    expect(res.body.message).toMatch(/vacío/i)
  })
})
