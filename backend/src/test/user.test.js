// 📁 src/test/user.test.js
import request from 'supertest'
import app from '../../app.js'
import User from '../models/userModel.js'
import { connectTestDB, disconnectTestDB } from './testDB.js'

let csrfToken
let csrfCookie
let userId

beforeAll(async () => {
  await connectTestDB()
  await User.deleteMany()

  const csrfRes = await request(app).get('/api/user/csrf-token')
  csrfToken = csrfRes.body.csrfToken
  
  // Buscá la cookie que contiene XSRF-TOKEN y extraela correctamente
  csrfCookie = csrfRes.headers['set-cookie']
  .find(c => c.startsWith('X-CSRF-Token='))
  .split(';')[0] // ejemplo: "XSRF-TOKEN=abc123"
})

afterAll(async () => {
  await disconnectTestDB()
},10000)

describe('👤 USER CONTROLLER', () => {
  it('📥 Registro exitoso', async () => {
    const res = await request(app)
      .post('/api/user/register')
      .set('Cookie', csrfCookie) // ✅ cookie bien formateada
      .set('X-CSRF-Token', csrfToken) // ✅ header del token
      .send({
        firstname: 'Edu',
        lastname: 'Greco',
        email: 'grecoeduardo87@gmail.com',
        password: 'Test1234!',
        mobile: '12345678'
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.email).toBe('grecoeduardo87@gmail.com')
    userId = res.body.data._id
  })

  it('🔐 Login exitoso', async () => {
    const res = await request(app)
      .post('/api/user/login')
      .set('Cookie', csrfCookie) // ✅ cookie bien formateada
      .set('X-CSRF-Token', csrfToken) // ✅ header del token
      .send({
        email: 'grecoeduardo87@gmail.com',
        password: 'Test1234!'
      })

    expect(res.statusCode).toBe(201)
    expect(res.body.success).toBe(true)
    const cookies = res.headers['set-cookie']
    expect(cookies).toBeDefined()
  })

  it('📤 Obtener perfil del usuario', async () => {
    const loginRes = await request(app)
      .post('/api/user/login')
      .set('Cookie', csrfCookie) // ✅ cookie bien formateada
      .set('X-CSRF-Token', csrfToken) // ✅ header del token
      .send({
        email: 'grecoeduardo87@gmail.com',
        password: 'Test1234!'
      })

    const cookies = loginRes.headers['set-cookie'] || []
    const accessToken = cookies.find(c => c.startsWith('accessToken'))?.split(';')[0]
    expect(accessToken).toBeDefined()

    const res = await request(app)
      .get('/api/user/profile')
      .set('Cookie', [csrfCookie, accessToken])
      .set('X-CSRF-Token', csrfToken)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.email).toBe('grecoeduardo87@gmail.com')
  })
})
