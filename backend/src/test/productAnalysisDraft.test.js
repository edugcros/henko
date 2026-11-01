// Del análisis de IA al borrador del producto.
//
// La IA no conoce el inventario: una foto no dice cuántas unidades hay en el
// depósito, y el prompt de visión ni siquiera lo pide. Aun así, el borrador
// salía con stock 1 SIEMPRE —la visión nunca devuelve stock y el respaldo era
// `|| 1`—, y si el modelo inventaba un número para una variante, pasaba tal
// cual. Un producto armado desde una foto se vendía con unidades que nadie
// había contado.

import mongoose from 'mongoose'
import { normalizeVariantSuggestions } from '../services/aiVisionService.js'
import {
  buildProductDraftFromJob,
  createProductFromAnalysisJob,
  sanitizeAnalysis,
} from '../controller/productAnalysisController.js'
import Product from '../models/productModel.js'
import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import CatalogCategory from '../models/catalogCategoryModel.js'
import { normalizeCatalogKey } from '../services/catalogCategoryService.js'
import { connectTestDB, disconnectTestDB, resetCollections } from './testDB.js'
import {
  buildAutonomousProductPayload,
  buildNormalizedDraftFromAnalysis,
} from '../services/autonomousProductBuilder.js'

const analisis = (extra = {}) => ({
  titulo: 'Casco integral AGV K1',
  descripcion: 'Casco integral con visor.',
  categoria: 'Accesorios',
  subcategoria: 'Cascos',
  marca: 'AGV',
  precio: 250000,
  confidence: 0.9,
  ...extra,
})

describe('IA · no inventa stock', () => {
  test('el borrador normalizado deja la cantidad vacía para que la cargue el comercio', () => {
    expect(buildNormalizedDraftFromAnalysis(analisis()).fields.cantidad).toBeNull()
  })

  test('aunque el modelo devuelva un número, la cantidad no lo toma', () => {
    const draft = buildNormalizedDraftFromAnalysis(analisis({ cantidad: 12, stock: 30 }))

    expect(draft.fields.cantidad).toBeNull()
  })

  test('las variantes que propone la IA no traen stock, aunque el modelo invente uno', () => {
    const [variante] = normalizeVariantSuggestions([
      { attributes: { talle: 'M', color: 'Negro' }, stock: 25, price: 250000 },
    ])

    expect(variante.attributes).toEqual(expect.objectContaining({ talle: 'M' }))
    expect(variante.stock).toBeNull()
  })

  test('el producto autónomo sale con stock 0, no con una unidad inventada', () => {
    const payload = buildAutonomousProductPayload({
      analysis: analisis({ cantidad: 9 }),
      tenantId: '64b7f0000000000000000001',
      job: { _id: '64b7f00000000000000000aa', imageUrl: 'https://x/y.jpg' },
    })

    expect(payload.stock).toBe(0)
  })
})

// ─── PR 5: el producto creado desde un análisis lleva SKU ───────────────────
//
// buildProductDraftFromJob armaba el producto SIN SKU. El índice único
// { tenantId, sku } es sparse, pero en un índice compuesto sparse indexa igual
// el documento con sku null (tenantId siempre existe): el segundo producto
// creado así en una tienda fallaba con E11000. createProduct ya generaba uno.

describe('agente · el producto creado desde un análisis lleva SKU', () => {
  const TENANT = new mongoose.Types.ObjectId()

  const trabajo = (extra = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    tenantId: TENANT,
    originalFilename: 'casco.jpg',
    imageUrl: 'https://cdn.test/casco.jpg',
    imageHash: 'abc123',
    source: 'local-folder-agent',
    analysis: {
      titulo: 'Casco integral AGV',
      descripcion: 'Casco con visor',
      categoria: 'Accesorios',
      subcategoria: 'Cascos',
      marca: 'AGV',
      price: 250000,
    },
    ...extra,
  })

  test('sin SKU cargado, se genera uno con el mismo formato que createProduct', () => {
    const draft = buildProductDraftFromJob({ job: trabajo() })

    expect(draft.sku).toMatch(/^CASCO-INTEGRAL-AGV-[A-Z0-9]{6}-[A-Z0-9]+$/)
  })

  test('el SKU que cargó una persona manda: al aprobar o al importar', () => {
    expect(buildProductDraftFromJob({ job: trabajo(), overrides: { sku: ' agv-k1 ' } }).sku).toBe(
      'AGV-K1',
    )
    expect(buildProductDraftFromJob({ job: trabajo({ metadata: { sku: 'imp-77' } }) }).sku).toBe(
      'IMP-77',
    )
  })

  test('guarda el modelo que analizó, no el origen de la imagen', () => {
    const conModelo = trabajo({
      analysis: { ...trabajo().analysis, source: 'gemini-3.1-flash-lite' },
    })

    expect(buildProductDraftFromJob({ job: conModelo }).aiSource).toBe('gemini-3.1-flash-lite')
    // Si el análisis no dice el modelo, queda el origen del trabajo, como antes.
    expect(buildProductDraftFromJob({ job: trabajo() }).aiSource).toBe('local-folder-agent')
  })

  test('el análisis guardado conserva el modelo que lo hizo', () => {
    expect(sanitizeAnalysis({ titulo: 'Casco', source: 'gemini-3.1-flash-lite' }).source).toBe(
      'gemini-3.1-flash-lite',
    )
    expect(sanitizeAnalysis({ titulo: 'Casco' }).source).toBeNull()
  })

  test('el producto queda vinculado al análisis del que salió', () => {
    const job = trabajo()

    expect(String(buildProductDraftFromJob({ job }).aiAgentJobId)).toBe(String(job._id))
  })

  describe('contra Mongo real, con el índice único activo', () => {
    beforeAll(async () => {
      await connectTestDB()
      await resetCollections(Product)
      await Product.createIndexes()
    })

    afterAll(async () => {
      await disconnectTestDB()
    })

    test('sin SKU, el segundo producto de la tienda choca: por eso hace falta', async () => {
      // Comprueba que el índice está activo; si no, el test de abajo pasaría
      // sin probar nada.
      const sinSku = () => {
        const draft = buildProductDraftFromJob({ job: trabajo() })
        delete draft.sku
        return draft
      }

      await Product.create(sinSku())
      await expect(Product.create(sinSku())).rejects.toMatchObject({ code: 11000 })
      await resetCollections(Product)
      await Product.createIndexes()
    })

    test('dos productos creados desde análisis en la misma tienda se guardan los dos', async () => {
      await Product.create(buildProductDraftFromJob({ job: trabajo() }))
      await Product.create(buildProductDraftFromJob({ job: trabajo() }))

      expect(
        await Product.countDocuments({ tenantId: TENANT }).setOptions({ tenantId: TENANT }),
      ).toBe(2)
    })
  })
})

// El alta automática (autoCreateProduct) hacía un Product.create pelado. Ahora
// pasa por createProductRecord, el mismo servicio que el alta del panel.
describe('alta automática desde un análisis · mismo servicio que el panel', () => {
  const TENANT = new mongoose.Types.ObjectId()

  const nuevoTrabajo = async (analysis = {}) => {
    const [job] = await ProductAnalysisJob.create(
      [
        {
          tenantId: TENANT,
          imageUrl: 'https://cdn.test/casco.jpg',
          originalFilename: 'casco.jpg',
          source: 'local-folder-agent',
          analysis: {
            titulo: 'Casco integral AGV',
            descripcion: 'Casco con visor',
            categoria: 'Cascos',
            subcategoria: 'Integrales',
            marca: 'AGV',
            source: 'gemini-3.1-flash-lite',
            ...analysis,
          },
        },
      ],
      { tenantId: TENANT },
    )
    return job
  }
  const contar = filtro =>
    Product.countDocuments({ tenantId: TENANT, ...filtro }).setOptions({ tenantId: TENANT })

  beforeAll(async () => {
    await connectTestDB()
    await resetCollections(Product, CatalogCategory)
    await ProductAnalysisJob.deleteMany({}).setOptions({ ignoreTenant: true })
    await Product.createIndexes()
  })

  afterAll(async () => {
    await disconnectTestDB()
  })

  test('crea el producto, vincula el análisis y arma la plantilla de la subcategoría', async () => {
    const job = await nuevoTrabajo()

    const product = await createProductFromAnalysisJob({ job })

    expect(product.aiAgentJobId.toString()).toBe(job._id.toString())
    expect(product.seo.slug).toBe(product.slug)
    expect(product.sku).toBeTruthy()
    expect(job.createdProductId.toString()).toBe(product._id.toString())
    // Lo que el Product.create pelado no hacía: la plantilla de la categoría.
    const categoria = await CatalogCategory.findOne({
      tenantId: TENANT,
      normalizedName: normalizeCatalogKey('Cascos'),
    })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(categoria).toBeTruthy()
  })

  test('si el análisis ya tiene producto, no crea otro aunque el trabajo no lo registre', async () => {
    const job = await nuevoTrabajo({ titulo: 'Guantes Alpinestars' })
    const primero = await createProductFromAnalysisJob({ job })

    // El trabajo perdió el vínculo (p. ej. se guardó antes de que terminara).
    job.createdProductId = null
    const segundo = await createProductFromAnalysisJob({ job })

    expect(segundo._id.toString()).toBe(primero._id.toString())
    expect(await contar({ aiAgentJobId: job._id })).toBe(1)
  })

  test('el slug se hace único aunque ya exista uno igual en la tienda', async () => {
    const job = await nuevoTrabajo({ titulo: 'Botas TCX Clima' })
    const ocupado = `botas-tcx-clima-${String(job._id).slice(-8)}`
    await Product.collection.insertOne({
      tenantId: TENANT,
      title: 'Otro producto',
      slug: ocupado,
      sku: `OTRO-${Date.now()}`,
    })

    const product = await createProductFromAnalysisJob({ job })

    expect(product.slug).not.toBe(ocupado)
    expect(product.slug.startsWith(ocupado)).toBe(true)
  })
})
