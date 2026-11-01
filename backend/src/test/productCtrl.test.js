import request from 'supertest'

import app from '../../app.js'
import Product from '../models/productModel.js'
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
