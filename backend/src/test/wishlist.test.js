// 📁 src/test/wishlist.test.js
import request from 'supertest'
import app from '../../app.js'
import User from '../models/userModel.js'
import Product from '../models/productModel.js'
import Wishlist from '../models/wishlistModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'

let csrfToken, csrfCookie, accessToken, userId, productId

describe('💖 WISHLIST', () => {
 

  beforeAll(async () => {
    await connectTestDB()
    await User.deleteMany()
    await Product.deleteMany()
    await Wishlist.deleteMany()

    const csrfRes = await request(app).get('/api/user/csrf-token')
    csrfToken = csrfRes.body.csrfToken
    csrfCookie = csrfRes.headers['set-cookie'][0]

    const registerRes = await request(app)
      .post('/api/user/register')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        firstname: 'Test',
        lastname: 'User',
        email: 'wishlist@test.com',
        password: 'Test1234!',
        mobile: '1234567890',
      })

    userId = registerRes.body.data._id

    const loginRes = await request(app)
      .post('/api/user/login')
      .set('Cookie', csrfCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'wishlist@test.com',
        password: 'Test1234!',
      })

    const cookies = loginRes.headers['set-cookie']
    accessToken = cookies.find(c => c.startsWith('accessToken'))?.split(';')[0]

    const product = await Product.create({
      title: 'Producto Test',
      slug: 'producto-test',
      price: 100,
      quantity: 10,
      description: 'Producto de prueba para wishlist',
    })

    productId = product._id
  }, 10000)

  afterAll(async () => {
    await disconnectTestDB()
  })

  it('💾 Debería añadir un producto a la wishlist', async () => {
    const res = await request(app)
      .put('/api/user/wishlist')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)
      .send({ prodId: productId })

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.message).toMatch(/wishlist/i)
  })

  it('📋 Debería obtener la wishlist del usuario', async () => {
    const res = await request(app)
      .get('/api/user/wishlist')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)

    expect(res.statusCode).toBe(200)
    expect(res.body.data).toBeDefined()
    expect(Array.isArray(res.body.data)).toBe(true)
  })
})
