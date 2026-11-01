import request from 'supertest'

import app from '../../app.js'
import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import { authHeaders, createTestTenant, createTestUser, getCSRFToken } from './testSetup.js'

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
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
          csrfToken: csrf.csrfToken,
          csrfCookie: csrf.csrfCookie,
        }),
      )
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
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
          csrfToken: csrf.csrfToken,
          csrfCookie: csrf.csrfCookie,
        }),
      )
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
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
          csrfToken: csrf.csrfToken,
          csrfCookie: csrf.csrfCookie,
        }),
      )
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
        descripcionTecnica: 'Motor bicilíndrico, chasis de acero, tablero digital.',
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

    // La ficha técnica que escribe una persona: la tienda la muestra en su
    // propia pestaña y hasta ahora solo sobrevivía si la había escrito la IA,
    // de rebote, dentro del JSON crudo del análisis.
    expect(guardado.technicalDescription).toContain('Motor bicilíndrico')

    // Y editar el producto desde una pantalla que NO muestra estos campos no
    // puede borrarlos.
    const editado = await request(app)
      .put(`/api/product/${res.body.data._id}`)
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
          csrfToken: csrf.csrfToken,
          csrfCookie: csrf.csrfCookie,
        }),
      )
      .send({ metaTitle: 'Otro título para buscadores' })

    expect(editado.statusCode).toBe(200)
    expect(editado.body.data.seo.metaTitle).toBe('Otro título para buscadores')
    expect(editado.body.data.seo.focusKeyword).toBe('motocicleta adventure')
    expect(editado.body.data.seo.faq).toHaveLength(2)
    expect(editado.body.data.technicalDescription).toContain('Motor bicilíndrico')
  })

  test('deletes a product as tenant admin', async () => {
    const res = await request(app)
      .delete(`/api/product/${productId}`)
      .set(
        authHeaders({
          token: adminSession.token,
          domain: tenantContext.adminDomain,
          csrfToken: csrf.csrfToken,
          csrfCookie: csrf.csrfCookie,
        }),
      )

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ─── Fase 0: ida y vuelta del producto ──────────────────────────────────────
//
// Red de seguridad antes de tocar el alta y la edición. Fija lo que HAY QUE
// CONSERVAR: lo que se crea se puede leer igual, y una edición parcial no
// borra lo que no mandó. Los defectos conocidos (stock pisado al editar,
// atributos de variante perdidos, envío digital, etc.) los fija cada PR que
// los arregla, no estos tests.

describe('producto · ida y vuelta (alta → lectura → edición → lectura)', () => {
  let ctx
  let admin
  let csrfAdmin
  let otroCtx
  let otroAdmin
  let csrfOtro

  const headersDe = (session, context, token) =>
    authHeaders({
      token: session.token,
      domain: context.adminDomain,
      csrfToken: token.csrfToken,
      csrfCookie: token.csrfCookie,
    })

  const leer = id => Product.findById(id).setOptions({ tenantId: ctx.tenant._id }).lean()

  const productoCompleto = () => ({
    title: 'Campera impermeable',
    description: 'Campera para moto, impermeable y con protecciones.',
    marca: 'Henko',
    categoria: 'Indumentaria',
    subcategoria: 'Camperas',
    condicion: 'nuevo',
    price: 50000,
    compareAtPrice: 60000,
    currency: 'ARS',
    status: 'draft',
    visibility: 'hidden',
    hasVariants: true,
    variantAttributes: [
      { name: 'color', label: 'Color', type: 'color' },
      { name: 'talle', label: 'Talle', type: 'select' },
    ],
    variants: [
      { attributes: { color: 'Negro', talle: 'M' }, price: 50000, stock: 4, sku: 'CAMP-NEG-M' },
      { attributes: { color: 'Negro', talle: 'L' }, price: 52000, stock: 6, sku: 'CAMP-NEG-L' },
    ],
    specifications: [{ key: 'material', label: 'Material', value: 'Cordura', filterable: true }],
    seo: {
      metaTitle: 'Campera impermeable para moto',
      metaDescription: 'Campera de cordura con protecciones.',
      keywords: ['campera', 'moto'],
      searchIntent: 'commercial',
    },
    logistics: { weightKg: 1.5, dimensionsCm: { length: 40, width: 30, height: 10 } },
    tags: ['moto', 'invierno'],
  })

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(Product, User, Tenant)

    ctx = await createTestTenant()
    admin = await createTestUser({
      tenantId: ctx.tenant._id,
      email: 'ida-vuelta@test.com',
      role: 'admin',
    })
    csrfAdmin = await getCSRFToken(ctx.adminDomain)

    otroCtx = await createTestTenant({ name: 'Otra tienda' })
    otroAdmin = await createTestUser({
      tenantId: otroCtx.tenant._id,
      email: 'otro-admin@test.com',
      role: 'admin',
    })
    csrfOtro = await getCSRFToken(otroCtx.adminDomain)
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  const crear = async (body = productoCompleto()) => {
    const res = await request(app)
      .post('/api/product')
      .set(headersDe(admin, ctx, csrfAdmin))
      .send(body)
    expect(res.statusCode).toBe(201)
    return res.body.data._id
  }

  const editar = (id, body, session = admin, context = ctx, token = csrfAdmin) =>
    request(app)
      .put(`/api/product/${id}`)
      .set(headersDe(session, context, token))
      .send(body)

  test('lo que se crea se guarda: datos, variantes, especificaciones, SEO y logística', async () => {
    const guardado = await leer(await crear())

    expect(guardado).toMatchObject({
      title: 'Campera impermeable',
      marca: 'Henko',
      categoria: 'Indumentaria',
      subcategoria: 'Camperas',
      condicion: 'nuevo',
      price: 50000,
      compareAtPrice: 60000,
      status: 'draft',
      visibility: 'hidden',
      hasVariants: true,
      tags: ['moto', 'invierno'],
    })
    expect(guardado.slug).toBeTruthy()
    // createProduct genera un SKU de producto cuando no viene ninguno.
    expect(guardado.sku).toBeTruthy()

    expect(guardado.variants).toHaveLength(2)
    expect(guardado.variants.map(v => v.sku)).toEqual(['CAMP-NEG-M', 'CAMP-NEG-L'])
    expect(guardado.variants.map(v => v.stock)).toEqual([4, 6])
    // Con variantes, el stock del producto es la suma de las activas.
    expect(guardado.stock).toBe(10)
    expect(guardado.variantAttributes.map(a => a.name)).toEqual(['color', 'talle'])

    expect(guardado.specifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'material', value: 'Cordura' })]),
    )
    expect(guardado.seo).toMatchObject({
      metaTitle: 'Campera impermeable para moto',
      searchIntent: 'commercial',
    })
    expect(guardado.logistics.weightKg).toBe(1.5)
  })

  test('una edición parcial no borra lo que no mandó', async () => {
    const id = await crear()
    const antes = await leer(id)

    const res = await editar(id, { price: 55000 })
    expect(res.statusCode).toBe(200)

    const despues = await leer(id)
    expect(despues.price).toBe(55000)

    // Todo lo demás, intacto.
    for (const campo of [
      'title',
      'description',
      'marca',
      'categoria',
      'subcategoria',
      'slug',
      'sku',
      'stock',
      'tags',
    ]) {
      expect(despues[campo]).toEqual(antes[campo])
    }
    expect(despues.variants.map(v => [v.key, v.sku, v.stock, String(v._id)])).toEqual(
      antes.variants.map(v => [v.key, v.sku, v.stock, String(v._id)]),
    )
    expect(despues.specifications).toEqual(antes.specifications)
    expect(despues.seo.metaTitle).toBe(antes.seo.metaTitle)
    expect(despues.logistics.weightKg).toBe(antes.logistics.weightKg)
  })

  test('editar sin mandar stock no toca el stock', async () => {
    const id = await crear({
      ...productoCompleto(),
      hasVariants: false,
      variants: [],
      variantAttributes: [],
      stock: 7,
    })

    const res = await editar(id, { title: 'Campera impermeable 2026' })

    // La edición tiene que haber pasado de verdad: un PUT rechazado tampoco
    // tocaría el stock, y el test pasaría sin probar nada.
    expect(res.statusCode).toBe(200)
    const despues = await leer(id)
    expect(despues.title).toBe('Campera impermeable 2026')
    expect(despues.stock).toBe(7)
  })

  test('mandar stock explícito lo reemplaza (comportamiento actual que se conserva)', async () => {
    const id = await crear({
      ...productoCompleto(),
      hasVariants: false,
      variants: [],
      variantAttributes: [],
      stock: 7,
    })

    const res = await editar(id, { stock: 3 })

    expect(res.statusCode).toBe(200)
    expect((await leer(id)).stock).toBe(3)
  })

  test('otra tienda no puede editar el producto', async () => {
    const id = await crear()

    const res = await editar(id, { price: 1 }, otroAdmin, otroCtx, csrfOtro)

    expect([403, 404]).toContain(res.statusCode)
    expect((await leer(id)).price).toBe(50000)
  })
})
