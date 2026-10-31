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

const { default: MarketIntelligencePage } = await import('./MarketIntelligencePage.js')

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
    research: { available: false },
    internal: { available: true },
  },
  // Copiado de backend/src/services/marketIntelligence/schemas/
  // marketAnalysisContract.js — SOURCE_LABELS, SOURCE_ROLES y describeSources.
  // Esa es la fuente de verdad: la pantalla no escribe estos textos, los
  // renderiza tal como llegan.
  //
  // Este bloque ya quedó viejo una vez sin que nadie se enterara: seguía
  // diciendo "Búsqueda con IA" y "Google Shopping" cuando el backend ya decía
  // otra cosa, y el test pasaba igual. De ahí que las aserciones de abajo usen
  // los valores de acá en vez de repetir el texto: si el fixture se
  // desactualiza, se desactualiza en un solo lugar.
  sources: [
    {
      key: 'shopping',
      label: 'Buscador de precios',
      role: 'Precios publicados hoy en tiendas online, cada uno con el link del que salió.',
      available: true,
      detail: 'Precios encontrados en 3 tiendas distintas.',
    },
    {
      key: 'research',
      label: 'Búsqueda en la web',
      role: 'Lo que dicen las páginas sobre el producto: interés, marcas, quejas repetidas.',
      available: false,
      detail:
        'No hay páginas que hablen de este producto. Con un nombre más general —la categoría en vez del modelo exacto— suele aparecer algo.',
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

  await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Queso de Campo')
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

    expect(await screen.findByText(/Hay mercado, falta medir la demanda/i)).toBeDefined()
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
    // La pantalla no redacta estos textos: los manda el backend y acá se
    // comprueba que llegue cada uno a la vista, sea cual sea su redacción.
    await analizar()

    expect(await screen.findByText(/De dónde salieron los datos/i)).toBeDefined()

    for (const fuente of RESULTADO.sources) {
      expect(screen.getByText(fuente.label)).toBeDefined()
      expect(screen.getByText(fuente.detail)).toBeDefined()
    }
  })

  test('no aparece el error crudo del proveedor', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        rawSignals: {
          ...RESULTADO.rawSignals,
          research: {
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

describe('Análisis de mercado · un resultado guardado se avisa', () => {
  test('dice que viene del caché y ofrece rehacerlo', async () => {
    // El backend sirve el análisis guardado hasta 24 horas. Sin avisarlo, el
    // comerciante aprieta "Analizar", recibe el resultado de ayer al instante
    // y parece que la IA no corrió.
    mockAnalyze.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        fromCache: true,
        generatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      },
    })

    await analizar()

    expect(await screen.findByText(/análisis guardado de hace 3 horas/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /Analizar de nuevo/i })).toBeDefined()
  })

  test('un análisis recién hecho no muestra ese aviso', async () => {
    await analizar()

    await screen.findByText(/De dónde salieron los datos/i)
    expect(screen.queryByText(/análisis guardado/i)).toBeNull()
  })
})

// ─── Caracterización ─────────────────────────────────────────────────────
//
// Lo que la pantalla le manda al backend y lo que muestra de lo que vuelve.
// Fijado antes del rediseño para que cambiar la presentación no cambie el
// contrato con la API.

const RENTABILIDAD = {
  viable: true,
  currency: 'ARS',
  totalUnitCost: 5200,
  breakEvenPrice: 6100,
  marketPosition: { level: 'AJUSTADO', message: 'El precio típico deja poco margen.' },
  scenarios: {
    atMin: { price: 4450, profit: -1650, marginPercent: -37.1, profitable: false },
    atMedian: { price: 8000, profit: 1900, marginPercent: 23.75, profitable: true },
  },
}

describe('Análisis de mercado · lo que se manda', () => {
  test('sin costo cargado, los costos viajan en null', async () => {
    await analizar()

    expect(mockAnalyze).toHaveBeenCalledWith({
      product: 'Queso de Campo',
      country: 'AR',
      forceRefresh: false,
      costs: null,
    })
  })

  test('Enter con el desplegable cerrado analiza', async () => {
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Yerba{Escape}{Enter}')

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalled())
    expect(mockAnalyze.mock.calls[0][0].product).toBe('Yerba')
  })

  test('sin producto el botón no analiza', () => {
    render(<MarketIntelligencePage />)

    expect(screen.getByRole('button', { name: /^Analizar$/i }).disabled).toBe(true)
  })

  test('"Analizar de nuevo" pide datos frescos', async () => {
    mockAnalyze.mockResolvedValue({ success: true, data: { ...RESULTADO, fromCache: true } })
    await analizar()

    await userEvent.click(await screen.findByRole('button', { name: /Analizar de nuevo/i }))

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalledTimes(2))
    expect(mockAnalyze.mock.calls[1][0].forceRefresh).toBe(true)
  })
})

describe('Análisis de mercado · lo que se muestra', () => {
  test('el mensaje del backend llega tal cual (cuota agotada)', async () => {
    mockAnalyze.mockRejectedValue({
      response: { status: 429, data: { message: 'Llegaste al límite de análisis del mes.' } },
    })

    await analizar()

    expect(await screen.findByText('Llegaste al límite de análisis del mes.')).toBeDefined()
  })

  test('sin mensaje del backend, un error genérico entendible', async () => {
    mockAnalyze.mockRejectedValue(new Error('Network Error'))

    await analizar()

    expect(await screen.findByText(/No se pudo completar el análisis/i)).toBeDefined()
  })

  test('la rentabilidad muestra equilibrio, posición y escenarios con signo', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: { ...RESULTADO, profitability: RENTABILIDAD },
    })

    await analizar()

    expect(await screen.findByText('Ajustado')).toBeDefined()
    expect(screen.getByText('El precio típico deja poco margen.')).toBeDefined()
    expect(screen.getByText('ARS 6.100')).toBeDefined()
    expect(screen.getByText(/ARS 1\.900/)).toBeDefined()
    expect(screen.getByText(/ARS -1\.650/)).toBeDefined()
    expect(screen.getByText(/23\.8% de margen/)).toBeDefined()
  })

  test('una rentabilidad inviable muestra el motivo', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        profitability: { viable: false, message: 'Los porcentajes suman más de 100%.' },
      },
    })

    await analizar()

    expect(await screen.findByText('Los porcentajes suman más de 100%.')).toBeDefined()
  })

  test('sin score no se muestra el desglose', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: { ...RESULTADO, demandScore: null, recommendation: 'DATOS INSUFICIENTES' },
    })

    await analizar()

    expect(await screen.findByText(/No se pudo medir la demanda de este producto/i)).toBeDefined()
    expect(screen.queryByText(/Desglose del score/i)).toBeNull()
  })

  test('las ofertas llevan el link a la tienda de la que salió el precio', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        offers: [
          {
            title: 'Queso Ricolact 1kg',
            link: 'https://tienda.example/q',
            merchant: 'Tienda A',
            price: 7900,
          },
        ],
      },
    })

    await analizar()
    await userEvent.click(await screen.findByText(/Ver de dónde salen estos precios/i))

    const link = await screen.findByRole('link', { name: 'Queso Ricolact 1kg' })
    expect(link.getAttribute('href')).toBe('https://tienda.example/q')
    expect(link.getAttribute('rel')).toMatch(/noopener/)
  })
})
