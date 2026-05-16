// src/test/productCtrl.test.js
import request from 'supertest'
import app from '../../app.js'
import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import Color from '../models/colorModel.js'
import { getCSRFToken } from './testSetup.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'


let adminToken, productId
const { csrfToken, cookies } = await getCSRFToken()
beforeAll(async () => {
  await connectTestDB()

  // Crear admin y obtener token
  const admin = await User.create({
    firstname: 'Admin',
    lastname: 'Test',
    email: 'admin@test.com',
    password: '12345678',
    role: 'admin',
    isBlocked: false,
  })

  // Obtener token CSRF
  const csrfRes = await request(app).get('/api/user/csrf-token')
  let csrfToken = csrfRes.body.csrfToken
  let csrfCookie = csrfRes.headers['set-cookie'] // ✅ declarada correctamente
  

  // Login como admin
  const loginRes = await request(app)
    .post('/api/user/login')
    .set('Cookie', csrfCookie)
    .set('X-CSRF-Token', csrfToken)
    .send({
      email: 'test@test.com',
      password: 'Pass1234!',
    })

  const cookies = loginRes.headers['set-cookie']
  expect(cookies).toBeDefined()

  const accessToken = cookies.find(c => c.startsWith('accessToken'))
  expect(accessToken).toBeDefined()

  adminToken = res.body?.data?.token
})

afterAll(async () => {
  await Product.deleteMany()
  await User.deleteMany()
  await disconnectTestDB()
})

// Crear el color primero
const color = await Color.create({ title: 'Negro' })

// Luego crear el producto usando el ObjectId del color
const product = await Product.create({
  title: 'Producto Admin Test',
  description: 'Control de orden por admin',
  price: 500,
  quantity: 20,
  category: 'Test',
  brand: 'MarcaTest',
  color: [color._id], // ✅ así debe ser
})

describe('🔍 PRODUCT CONTROLLER', () => {
  test('📌 Crear un producto', async () => {
    const res = await request(app)
      .post('/api/product')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', cookies)
      .send({
        title: 'Producto de prueba',
        slug: 'producto-de-prueba',
        description: 'Descripción de prueba',
        brand: 'PruebaBrand',
        price: 1000,
        category: 'TestCategory',
        quantity: 10,
        color: 'Azul',
        images: [],
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.title).toBe('Producto de prueba')
    productId = res.body.data._id
  })

  test('📦 Obtener todos los productos', async () => {
    const res = await request(app).get('/api/product')
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  test('🔍 Obtener un producto por ID', async () => {
    const res = await request(app).get(`/api/product/${productId}`)
    expect(res.statusCode).toBe(200)
    expect(res.body.data._id).toBe(productId)
  })

  test('✏️ Actualizar producto', async () => {
    const res = await request(app)
      .put(`/api/product/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', cookies)
      .send({ price: 1500 })

    expect(res.statusCode).toBe(200)
    expect(res.body.data.price).toBe(1500)
  })

  test('🗑️ Eliminar producto', async () => {
    const res = await request(app)
      .delete(`/api/product/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-CSRF-Token', csrfToken)
      .set('Cookie', cookies)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
