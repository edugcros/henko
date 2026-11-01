// Del análisis de IA al borrador del producto.
//
// La IA no conoce el inventario: una foto no dice cuántas unidades hay en el
// depósito, y el prompt de visión ni siquiera lo pide. Aun así, el borrador
// salía con stock 1 SIEMPRE —la visión nunca devuelve stock y el respaldo era
// `|| 1`—, y si el modelo inventaba un número para una variante, pasaba tal
// cual. Un producto armado desde una foto se vendía con unidades que nadie
// había contado.

import { normalizeVariantSuggestions } from '../services/aiVisionService.js'
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
