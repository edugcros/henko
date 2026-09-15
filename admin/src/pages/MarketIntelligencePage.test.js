// Pantalla de Análisis de mercado.
//
// Lo que se prueba acá no es el diseño: es que la pantalla no afirme cosas que
// el análisis no midió, y que cuando una fuente falla el comerciante lea qué
// pasó en su idioma. Los doce análisis reales de producción mostraban el error
// literal de Google —"You exceeded your current quota, please check your plan
// and billing details"— y un veredicto de "No conviene por ahora" sobre
// productos cuya demanda nunca se había medido.

import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockAnalyze = jest.fn()
const mockGetProducts = jest.fn()

jest.unstable_mockModule('../utils/marketIntelligenceApi.js', () => ({
  analyzeProduct: mockAnalyze,
  default: {},
}))

jest.unstable_mockModule('../features/product/productService', () => ({
  default: { getAdminProducts: mockGetProducts },
}))

const { default: MarketIntelligencePage } =
  await import('./MarketIntelligencePage.js')

// Un análisis real: el buscador de precios contestó, la búsqueda con IA no.
const RESULTADO = {
  product: 'Queso de Campo Ricolact',
  country: 'AR',
  demandScore: 38,
  demandClassification: 'Actividad del mercado (la demanda no se pudo medir)',
  confidenceScore: 50,
  trendLabel: '❓ INDETERMINADA',
  breakdown: {
    demand: null,
    trend: null,
    competition: 70,
    social: null,
    commercial: 32,
    opportunity: 20,
  },
  measuredWeight: 0.4,
  unmeasured: ['demand', 'trend', 'social'],
  degenerate: false,
  internalOnly: false,
  recommendation: 'FALTA MEDIR LA DEMANDA',
  priceStats: {
    min: 4450,
    median: 8000,
    max: 30600,
    currency: 'ARS',
    sampleSize: 8,
  },
  offers: [],
  profitability: null,
  rawSignals: {
    shopping: { available: true, offerCount: 8, merchantCount: 7 },
    gemini: { available: false },
    internal: { available: true },
  },
  sources: [
    {
      key: 'shopping',
      label: 'Buscador de precios',
      role: 'Precios y vendedores publicados hoy en Google Shopping.',
      available: true,
      detail: '8 ofertas de 7 vendedores distintos.',
    },
    {
      key: 'gemini',
      label: 'Búsqueda con IA',
      role: 'Interés de búsqueda, tendencia, marcas y quejas de compradores.',
      available: false,
      detail:
        'La clave de IA llegó al límite de consultas de Google. Se renueva sola, o se amplía habilitando facturación en la clave.',
    },
    {
      key: 'internal',
      label: 'Tu tienda',
      role: 'Tus ventas, tu stock y la rotación de la categoría.',
      available: true,
      detail: 'Está en tu catálogo: 1 unidades vendidas en 90 días.',
    },
  ],
  generatedAt: new Date().toISOString(),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetProducts.mockResolvedValue({ data: [] })
  mockAnalyze.mockResolvedValue({ success: true, data: RESULTADO })
})

const analizar = async () => {
  render(<MarketIntelligencePage />)

  await userEvent.type(
    screen.getByLabelText(/producto o categoría/i),
    'Queso de Campo',
  )
  await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

  await waitFor(() => expect(mockAnalyze).toHaveBeenCalled())
}

describe('Análisis de mercado · la pantalla se explica', () => {
  test('el instructivo está a la vista, sin tener que analizar nada', () => {
    render(<MarketIntelligencePage />)

    expect(screen.getByText(/Cómo funciona/i)).toBeDefined()
    expect(screen.getByText(/consulta tres fuentes/i)).toBeDefined()
  })
})

describe('Análisis de mercado · no se afirma lo que no se midió', () => {
  test('sin medir la demanda, el veredicto no dice "no conviene"', async () => {
    await analizar()

    expect(
      await screen.findByText(/Hay mercado, falta medir la demanda/i),
    ).toBeDefined()
    expect(screen.queryByText(/No conviene por ahora/i)).toBeNull()
  })

  test('el número se llama por lo que mide', async () => {
    await analizar()

    // "Demanda 38/100" sobre un análisis sin demanda medida era el número mal
    // nombrado. (El selector de país también se llama "Mercado", de ahí el
    // filtro por el elemento del encabezado de la tarjeta.)
    const titulos = await screen.findAllByText(/^Mercado$/i)
    expect(titulos.some(el => el.tagName === 'SPAN')).toBe(true)

    expect(screen.getByText(/la demanda no se pudo medir/i)).toBeDefined()
  })

  test('cada fuente dice qué aportó, y la que falló por qué', async () => {
    await analizar()

    expect(
      await screen.findByText(/De dónde salieron los datos/i),
    ).toBeDefined()
    expect(screen.getByText(/8 ofertas de 7 vendedores/i)).toBeDefined()
    expect(screen.getByText(/límite de consultas de Google/i)).toBeDefined()
  })

  test('no aparece el error crudo del proveedor', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        rawSignals: {
          ...RESULTADO.rawSignals,
          gemini: {
            available: false,
            error: 'You exceeded your current quota, please check your plan',
          },
        },
      },
    })

    await analizar()

    await screen.findByText(/De dónde salieron los datos/i)
    expect(screen.queryByText(/exceeded your current quota/i)).toBeNull()
  })
})
