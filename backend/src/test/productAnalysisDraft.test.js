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
import { buildProductDraftFromJob } from '../controller/productAnalysisController.js'
import Product from '../models/productModel.js'
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
