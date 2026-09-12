import request from 'supertest'

import app from '../../app.js'
import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
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
    await resetCollections(Product, User, Tenant)

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

  test('el posicionamiento SEO del formulario se guarda de verdad', async () => {
    // El alta tiene una sección entera —intención, posicionamiento, audiencia,
    // enfoque, preguntas frecuentes y pilares— con un botón que avisa
    // "Posicionamiento SEO creado". El servidor los tiraba todos: el schema no
    // los declaraba y el normalizador devolvía solo cinco claves.
    const res = await request(app)
      .post('/api/product')
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
        csrfToken: csrf.csrfToken,
        csrfCookie: csrf.csrfCookie,
      }))
      .send({
        title: 'Producto con posicionamiento',
        description: 'Descripción',
        marca: 'PruebaBrand',
        categoria: 'TestCategory',
        subcategoria: 'General',
        price: 2000,
        stock: 5,
        seoFocusKeyword: 'motocicleta adventure',
        seoSearchIntent: 'commercial',
        seoPositioning: 'Se posiciona para búsquedas de intención comercial.',
        seoTargetAudience: 'Usuarios que buscan una moto para ruta y uso mixto',
        seoContentAngle: 'Destacar autonomía y confort',
        seoFaq: ['¿Qué motor tiene?', '¿Para qué uso sirve?'],
        seoContentPillars: ['motocicleta', 'adventure', 'ruta'],
      })

    expect(res.statusCode).toBe(201)

    const guardado = await Product.findById(res.body.data._id)
      .setOptions({ tenantId: String(tenantContext.tenant._id) })
      .lean()

    expect(guardado.seo.focusKeyword).toBe('motocicleta adventure')
    expect(guardado.seo.searchIntent).toBe('commercial')
    expect(guardado.seo.positioning).toContain('intención comercial')
    expect(guardado.seo.targetAudience).toContain('ruta y uso mixto')
    expect(guardado.seo.contentAngle).toBe('Destacar autonomía y confort')
    // Las preguntas conservan las mayúsculas: son texto que se lee tal cual.
    expect(guardado.seo.faq).toEqual(['¿Qué motor tiene?', '¿Para qué uso sirve?'])
    expect(guardado.seo.contentPillars).toEqual(['motocicleta', 'adventure', 'ruta'])

    // Y editar el producto desde una pantalla que NO muestra estos campos no
    // puede borrarlos.
    const editado = await request(app)
      .put(`/api/product/${res.body.data._id}`)
      .set(authHeaders({
        token: adminSession.token,
        domain: tenantContext.adminDomain,
        csrfToken: csrf.csrfToken,
        csrfCookie: csrf.csrfCookie,
      }))
      .send({ metaTitle: 'Otro título para buscadores' })

    expect(editado.statusCode).toBe(200)
    expect(editado.body.data.seo.metaTitle).toBe('Otro título para buscadores')
    expect(editado.body.data.seo.focusKeyword).toBe('motocicleta adventure')
    expect(editado.body.data.seo.faq).toHaveLength(2)
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
