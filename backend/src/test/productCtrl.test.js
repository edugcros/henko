import mongoose from 'mongoose'
import request from 'supertest'

import app from '../../app.js'
import Product from '../models/productModel.js'
import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import { authHeaders, createTestTenant, createTestUser, getCSRFToken } from './testSetup.js'
import { decrementLineStock } from '../services/orderInventoryService.js'
import { applyStockBaselines } from '../controller/productCtrl.js'

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

// ─── PR 1: una venta mientras se edita no se pisa ───────────────────────────
//
// El formulario de edición manda el stock que vio al abrirse. Si mientras
// tanto se vendía, guardar cualquier cambio devolvía el stock al valor viejo
// y se vendía lo que ya no había. Con `stockBaseline` el backend aplica la
// diferencia sobre el valor actual. Las ventas se simulan con el mismo
// decrementLineStock que usan los pedidos.

describe('stock · una venta mientras se edita no se pisa', () => {
  let ctx
  let admin
  let csrfAdmin

  const leer = id => Product.findById(id).setOptions({ tenantId: ctx.tenant._id }).lean()
  const editar = (id, body) =>
    request(app)
      .put(`/api/product/${id}`)
      .set(
        authHeaders({
          token: admin.token,
          domain: ctx.adminDomain,
          csrfToken: csrfAdmin.csrfToken,
          csrfCookie: csrfAdmin.csrfCookie,
        }),
      )
      .send(body)

  const crear = async extra => {
    const res = await request(app)
      .post('/api/product')
      .set(
        authHeaders({
          token: admin.token,
          domain: ctx.adminDomain,
          csrfToken: csrfAdmin.csrfToken,
          csrfCookie: csrfAdmin.csrfCookie,
        }),
      )
      .send({
        title: `Casco ${Math.random()}`,
        description: 'Casco integral',
        marca: 'Henko',
        categoria: 'Accesorios',
        subcategoria: 'Cascos',
        price: 30000,
        status: 'active',
        visibility: 'visible',
        ...extra,
      })
    expect(res.statusCode).toBe(201)
    return res.body.data._id
  }

  const vender = (productId, count, variantId = null) =>
    decrementLineStock({
      tenantId: ctx.tenant._id,
      line: { product: productId, count, variantId, titleSnapshot: 'Casco' },
    })

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(Product, User, Tenant)
    ctx = await createTestTenant()
    admin = await createTestUser({
      tenantId: ctx.tenant._id,
      email: 'stock-admin@test.com',
      role: 'admin',
    })
    csrfAdmin = await getCSRFToken(ctx.adminDomain)
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('cambiar el precio con el formulario abierto no devuelve el stock vendido', async () => {
    const id = await crear({ stock: 10 })
    await vender(id, 2) // queda en 8 mientras el formulario muestra 10

    const res = await editar(id, { price: 32000, stock: 10, stockBaseline: 10 })

    expect(res.statusCode).toBe(200)
    expect((await leer(id)).stock).toBe(8)
    expect((await leer(id)).price).toBe(32000)
  })

  test('si el comercio suma unidades, se suman sobre lo que quedó', async () => {
    const id = await crear({ stock: 10 })
    await vender(id, 2) // 8

    await editar(id, { stock: 15, stockBaseline: 10 }) // +5 cargadas

    expect((await leer(id)).stock).toBe(13)
  })

  test('nunca queda negativo', async () => {
    const id = await crear({ stock: 5 })
    await vender(id, 3) // 2

    await editar(id, { stock: 0, stockBaseline: 5 }) // el comercio lo pone en 0

    expect((await leer(id)).stock).toBe(0)
  })

  test('con variantes: cada una conserva lo vendido y aplica su propio cambio', async () => {
    const id = await crear({
      hasVariants: true,
      variantAttributes: [{ name: 'talle', label: 'Talle', type: 'select' }],
      variants: [
        { attributes: { talle: 'M' }, price: 30000, stock: 4, sku: 'CASCO-M' },
        { attributes: { talle: 'L' }, price: 30000, stock: 6, sku: 'CASCO-L' },
      ],
    })
    const creado = await leer(id)
    const [m, l] = creado.variants
    await vender(id, 1, m._id) // M queda en 3

    const res = await editar(id, {
      hasVariants: true,
      variants: [
        {
          _id: m._id,
          attributes: { talle: 'M' },
          price: 30000,
          stock: 4,
          stockBaseline: 4,
          sku: 'CASCO-M',
        },
        {
          _id: l._id,
          attributes: { talle: 'L' },
          price: 30000,
          stock: 9,
          stockBaseline: 6,
          sku: 'CASCO-L',
        },
      ],
    })

    expect(res.statusCode).toBe(200)
    const despues = await leer(id)
    const porSku = Object.fromEntries(despues.variants.map(v => [v.sku, v.stock]))
    expect(porSku).toEqual({ 'CASCO-M': 3, 'CASCO-L': 9 })
    expect(despues.stock).toBe(12)
  })

  test('una variante nueva usa su valor tal cual', async () => {
    const id = await crear({
      hasVariants: true,
      variantAttributes: [{ name: 'talle', label: 'Talle', type: 'select' }],
      variants: [{ attributes: { talle: 'M' }, price: 30000, stock: 4, sku: 'NUEVA-M' }],
    })
    const [m] = (await leer(id)).variants

    await editar(id, {
      hasVariants: true,
      variants: [
        {
          _id: m._id,
          attributes: { talle: 'M' },
          price: 30000,
          stock: 4,
          stockBaseline: 4,
          sku: 'NUEVA-M',
        },
        { attributes: { talle: 'XL' }, price: 30000, stock: 2, stockBaseline: 99, sku: 'NUEVA-XL' },
      ],
    })

    const porSku = Object.fromEntries((await leer(id)).variants.map(v => [v.sku, v.stock]))
    expect(porSku).toEqual({ 'NUEVA-M': 4, 'NUEVA-XL': 2 })
  })

  test('applyStockBaselines no devuelve stock negativo por su cuenta', () => {
    // El modelo también lo corrige al guardar, pero la diferencia no puede
    // depender de eso: el resultado tiene que ser válido antes de llegar ahí.
    const resultado = applyStockBaselines({
      product: { stock: 2, variants: [] },
      updates: { stock: 0 },
      stockBaseline: 5,
      variantBaselines: new Map(),
    })

    expect(resultado.stock).toBe(0)
  })

  test('applyStockBaselines no acumula si la transacción se reintenta', () => {
    const product = { stock: 8, variants: [] }
    const updates = { stock: 10, price: 1 }

    const primero = applyStockBaselines({
      product,
      updates,
      stockBaseline: 10,
      variantBaselines: new Map(),
    })
    const segundo = applyStockBaselines({
      product,
      updates,
      stockBaseline: 10,
      variantBaselines: new Map(),
    })

    expect(primero.stock).toBe(8)
    expect(segundo.stock).toBe(8)
    // `updates` no se toca: es lo que se reutiliza en el reintento.
    expect(updates.stock).toBe(10)
  })
})

// ─── PR 3: los atributos de variante se guardan completos ───────────────────
//
// El controlador normalizaba values, required y sortOrder, pero el esquema
// solo declaraba name, label y type: el modo strict de Mongoose descartaba el
// resto en silencio. Se perdían el orden de los talles y los valores definidos.

describe('variantes · los atributos se guardan completos', () => {
  let ctx
  let admin
  let csrfAdmin

  const headers = () =>
    authHeaders({
      token: admin.token,
      domain: ctx.adminDomain,
      csrfToken: csrfAdmin.csrfToken,
      csrfCookie: csrfAdmin.csrfCookie,
    })
  const leer = id => Product.findById(id).setOptions({ tenantId: ctx.tenant._id }).lean()

  const atributos = [
    {
      name: 'talle',
      label: 'Talle',
      type: 'select',
      values: ['S', 'M', 'L', 'XL'],
      required: true,
      sortOrder: 0,
    },
    {
      name: 'color',
      label: 'Color',
      type: 'color',
      values: ['Negro', 'Blanco'],
      required: false,
      sortOrder: 1,
    },
  ]

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(Product, User, Tenant)
    ctx = await createTestTenant()
    admin = await createTestUser({
      tenantId: ctx.tenant._id,
      email: 'atributos-admin@test.com',
      role: 'admin',
    })
    csrfAdmin = await getCSRFToken(ctx.adminDomain)
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  const crear = async () => {
    const res = await request(app)
      .post('/api/product')
      .set(headers())
      .send({
        title: `Remera ${Math.random()}`,
        description: 'Remera de algodón',
        marca: 'Henko',
        categoria: 'Indumentaria',
        subcategoria: 'Remeras',
        price: 15000,
        hasVariants: true,
        variantAttributes: atributos,
        variants: [
          {
            attributes: { talle: 'M', color: 'Negro' },
            price: 15000,
            stock: 3,
            sku: `R-M-${Math.random()}`,
          },
        ],
      })
    expect(res.statusCode).toBe(201)
    return res.body.data._id
  }

  test('values, required y sortOrder sobreviven al alta', async () => {
    const guardado = await leer(await crear())

    expect(guardado.variantAttributes).toEqual([
      expect.objectContaining({
        name: 'talle',
        values: ['S', 'M', 'L', 'XL'],
        required: true,
        sortOrder: 0,
      }),
      expect.objectContaining({
        name: 'color',
        values: ['Negro', 'Blanco'],
        required: false,
        sortOrder: 1,
      }),
    ])
  })

  test('una edición que no los manda los conserva', async () => {
    const id = await crear()

    const res = await request(app).put(`/api/product/${id}`).set(headers()).send({ price: 16000 })

    expect(res.statusCode).toBe(200)
    expect((await leer(id)).variantAttributes[0].values).toEqual(['S', 'M', 'L', 'XL'])
  })

  test('una edición que los manda los actualiza', async () => {
    const id = await crear()

    const res = await request(app)
      .put(`/api/product/${id}`)
      .set(headers())
      .send({
        variantAttributes: [{ ...atributos[0], values: ['M', 'L'] }, atributos[1]],
      })

    expect(res.statusCode).toBe(200)
    expect((await leer(id)).variantAttributes[0].values).toEqual(['M', 'L'])
  })
})

// ─── PR 4: el tipo de envío se conserva ─────────────────────────────────────
//
// AddProduct manda `shipping: { type, requiresShipping }`; el controlador lo
// pasaba por normalizeText, que solo acepta texto, y un producto digital se
// guardaba como 'standard'. Y en la edición, mandar solo la garantía rearmaba
// toda la logística: tipo 'standard', peso y medidas en 0.

describe('logística · el tipo de envío y los datos guardados se conservan', () => {
  let ctx
  let admin
  let csrfAdmin

  const headers = () =>
    authHeaders({
      token: admin.token,
      domain: ctx.adminDomain,
      csrfToken: csrfAdmin.csrfToken,
      csrfCookie: csrfAdmin.csrfCookie,
    })
  const leer = id => Product.findById(id).setOptions({ tenantId: ctx.tenant._id }).lean()
  const base = () => ({
    title: `Curso ${Math.random()}`,
    description: 'Curso online de mecánica',
    marca: 'Henko',
    categoria: 'Cursos',
    subcategoria: 'Online',
    price: 20000,
    stock: 100,
  })
  const crear = async extra => {
    const res = await request(app)
      .post('/api/product')
      .set(headers())
      .send({ ...base(), ...extra })
    expect(res.statusCode).toBe(201)
    return res.body.data._id
  }
  const editar = (id, body) => request(app).put(`/api/product/${id}`).set(headers()).send(body)

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(Product, User, Tenant)
    ctx = await createTestTenant()
    admin = await createTestUser({
      tenantId: ctx.tenant._id,
      email: 'logistica-admin@test.com',
      role: 'admin',
    })
    csrfAdmin = await getCSRFToken(ctx.adminDomain)
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('un producto digital creado desde AddProduct queda digital', async () => {
    // El payload exacto de AddProduct (buildLogisticsPayload): objeto en
    // logistics.shipping y repetido en la raíz.
    const shipping = { type: 'digital', requiresShipping: false }
    const id = await crear({
      shipping,
      weightKg: 0,
      logistics: { weightKg: 0, dimensions: { length: 0, width: 0, height: 0 }, shipping },
    })

    expect((await leer(id)).logistics.shippingType).toBe('digital')
  })

  test('el formato plano de EditProduct sigue funcionando', async () => {
    const id = await crear({ logistics: { shippingType: 'fragile', weightKg: 2 } })

    const guardado = await leer(id)
    expect(guardado.logistics.shippingType).toBe('fragile')
    expect(guardado.logistics.weightKg).toBe(2)
  })

  test('un tipo desconocido cae en standard, como antes', async () => {
    const id = await crear({ shipping: { type: 'teletransporte' } })

    expect((await leer(id)).logistics.shippingType).toBe('standard')
  })

  test('editar solo la garantía no borra el tipo de envío, el peso ni las medidas', async () => {
    const id = await crear({
      logistics: {
        shippingType: 'refrigerated',
        weightKg: 3.5,
        dimensionsCm: { length: 40, width: 30, height: 20 },
      },
    })

    const res = await editar(id, { warranty: '6 meses' })

    expect(res.statusCode).toBe(200)
    expect((await leer(id)).logistics).toMatchObject({
      shippingType: 'refrigerated',
      weightKg: 3.5,
      dimensionsCm: { length: 40, width: 30, height: 20 },
      warranty: '6 meses',
    })
  })

  test('editar con el objeto de AddProduct cambia el tipo', async () => {
    const id = await crear({ logistics: { shippingType: 'standard' } })

    await editar(id, { shipping: { type: 'digital', requiresShipping: false } })

    expect((await leer(id)).logistics.shippingType).toBe('digital')
  })

  test('vaciar la garantía o el país de origen los borra de verdad', async () => {
    const id = await crear({ logistics: { warranty: '12 meses', originCountry: 'Argentina' } })

    const res = await editar(id, { logistics: { warranty: '', originCountry: '' } })

    expect(res.statusCode).toBe(200)
    expect((await leer(id)).logistics).toMatchObject({ warranty: '', originCountry: '' })
  })

  test('mandar una sola medida conserva las otras', async () => {
    const id = await crear({ logistics: { dimensionsCm: { length: 40, width: 30, height: 20 } } })

    await editar(id, { logistics: { dimensionsCm: { length: 50 } } })

    expect((await leer(id)).logistics.dimensionsCm).toEqual({ length: 50, width: 30, height: 20 })
  })

  test('un cero explícito se respeta y no vuelve al valor guardado', async () => {
    const id = await crear({ logistics: { weightKg: 4 } })

    await editar(id, { logistics: { weightKg: 0 } })

    expect((await leer(id)).logistics.weightKg).toBe(0)
  })
})

describe('alta recuperable · reintentar no duplica el producto', () => {
  let ctx
  let admin
  let csrfAdmin

  const headers = () =>
    authHeaders({
      token: admin.token,
      domain: ctx.adminDomain,
      csrfToken: csrfAdmin.csrfToken,
      csrfCookie: csrfAdmin.csrfCookie,
    })
  const base = () => ({
    title: 'Casco integral AGV',
    description: 'Casco de prueba',
    marca: 'AGV',
    categoria: 'Cascos',
    subcategoria: 'Integrales',
    price: 150000,
    stock: 3,
  })
  const crear = extra =>
    request(app)
      .post('/api/product')
      .set(headers())
      .send({ ...base(), ...extra })
  const contar = filtro =>
    Product.countDocuments({ tenantId: ctx.tenant._id, ...filtro }).setOptions({
      tenantId: ctx.tenant._id,
    })

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(Product, User, Tenant)
    await ProductAnalysisJob.deleteMany({}).setOptions({ ignoreTenant: true })
    await Product.createIndexes()
    ctx = await createTestTenant()
    admin = await createTestUser({
      tenantId: ctx.tenant._id,
      email: 'alta-recuperable-admin@test.com',
      role: 'admin',
    })
    csrfAdmin = await getCSRFToken(ctx.adminDomain)
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('el mismo clientRequestId devuelve el producto ya creado, no otro', async () => {
    const clientRequestId = 'alta-1111-2222-3333'

    const primero = await crear({ clientRequestId })
    const reintento = await crear({ clientRequestId, title: 'Otro título' })

    expect(primero.statusCode).toBe(201)
    expect(reintento.statusCode).toBe(200)
    expect(reintento.body.replayed).toBe(true)
    expect(reintento.body.data._id).toBe(primero.body.data._id)
    expect(await contar({ clientRequestId })).toBe(1)
  })

  test('intentos distintos crean productos distintos', async () => {
    const a = await crear({ clientRequestId: 'alta-aaaa-0001' })
    const b = await crear({ clientRequestId: 'alta-bbbb-0002' })

    expect(a.statusCode).toBe(201)
    expect(b.statusCode).toBe(201)
    expect(b.body.data._id).not.toBe(a.body.data._id)
  })

  test('un clientRequestId con formato inválido se ignora y no bloquea el alta', async () => {
    const a = await crear({ clientRequestId: 'x' })
    const b = await crear({ clientRequestId: 'x' })

    expect(a.statusCode).toBe(201)
    expect(b.statusCode).toBe(201)
    expect(a.body.data.clientRequestId).toBeUndefined()
  })

  test('dos pedidos simultáneos del mismo intento dejan un solo producto', async () => {
    const clientRequestId = 'alta-doble-clic-0001'

    const respuestas = await Promise.all([crear({ clientRequestId }), crear({ clientRequestId })])

    expect(respuestas.map(r => r.statusCode).sort()).toEqual([200, 201])
    expect(respuestas[0].body.data._id).toBe(respuestas[1].body.data._id)
    expect(await contar({ clientRequestId })).toBe(1)
  })

  test('un análisis ya convertido en producto no crea un segundo producto', async () => {
    const aiAgentJobId = new mongoose.Types.ObjectId().toString()

    const primero = await crear({ aiAgentJobId })
    const reintento = await crear({ aiAgentJobId })

    expect(primero.statusCode).toBe(201)
    expect(reintento.statusCode).toBe(200)
    expect(reintento.body.data._id).toBe(primero.body.data._id)
  })

  test('reconoce el producto que el servidor creó solo desde ese análisis', async () => {
    const existente = await Product.create({
      ...base(),
      tenantId: ctx.tenant._id,
      slug: `creado-por-el-servidor-${Date.now()}`,
      sku: `SERVIDOR-${Date.now()}`,
      status: 'draft',
      visibility: 'hidden',
    })
    const [job] = await ProductAnalysisJob.create(
      [
        {
          tenantId: ctx.tenant._id,
          imageUrl: 'https://res.cloudinary.com/demo/image/upload/casco.jpg',
          createdProductId: existente._id,
        },
      ],
      { tenantId: ctx.tenant._id },
    )

    const res = await crear({ aiAgentJobId: String(job._id) })

    expect(res.statusCode).toBe(200)
    expect(res.body.data._id).toBe(String(existente._id))
  })

  test('si el producto de ese análisis se borró, se puede crear de nuevo', async () => {
    const aiAgentJobId = new mongoose.Types.ObjectId().toString()
    const primero = await crear({ aiAgentJobId })
    await Product.updateOne(
      { _id: primero.body.data._id },
      { $set: { isDeleted: true } },
    ).setOptions({ tenantId: ctx.tenant._id })

    const otra = await crear({ aiAgentJobId })

    expect(otra.statusCode).toBe(201)
    expect(otra.body.data._id).not.toBe(primero.body.data._id)
  })

  test('publicar el borrador lo deja visible, y un borrador borrado no se publica', async () => {
    const borrador = await crear({ status: 'draft', visibility: 'hidden' })
    const borrado = await crear({ status: 'draft', visibility: 'hidden' })
    await Product.updateOne(
      { _id: borrado.body.data._id },
      { $set: { isDeleted: true } },
    ).setOptions({ tenantId: ctx.tenant._id })

    const res = await request(app)
      .put('/api/product/admin/drafts/bulk-publish')
      .set(headers())
      .send({ productIds: [borrador.body.data._id, borrado.body.data._id] })

    expect(res.statusCode).toBe(200)
    expect(res.body.published).toBe(1)
    const publicado = await Product.findById(borrador.body.data._id)
      .setOptions({ tenantId: ctx.tenant._id })
      .lean()
    expect(publicado.status).toBe('active')
    expect(publicado.visibility).toBe('visible')
    expect(publicado.publishedAt).toBeTruthy()
  })
})
