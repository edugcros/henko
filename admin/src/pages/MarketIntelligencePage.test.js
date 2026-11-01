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

const {
  default: MarketIntelligencePage,
  buildAnalyzeRequest,
  describeCostSource,
  EMPTY_COSTS,
  percent,
  validateCosts,
} = await import('./MarketIntelligencePage.js')

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

  test('Enter con el desplegable cerrado analiza una sola vez', async () => {
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Yerba{Escape}{Enter}')

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalled())
    expect(mockAnalyze).toHaveBeenCalledTimes(1)
    expect(mockAnalyze.mock.calls[0][0].product).toBe('Yerba')
  })

  // Antes Enter con el desplegable abierto solo lo cerraba y había que
  // apretarlo otra vez. Pasa con sugerencias a la vista y también sin ellas:
  // sin coincidencias en el catálogo el desplegable sigue "abierto" aunque no
  // se dibuje nada, y era el caso más común al evaluar un producto nuevo.
  test('Enter con sugerencias a la vista analiza el texto escrito', async () => {
    mockGetProducts.mockResolvedValue({ data: [{ _id: 'p1', title: 'Yerba Mate Suave' }] })
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Yerba')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalledTimes(1))
    expect(mockAnalyze.mock.calls[0][0].product).toBe('Yerba')
    expect(mockAnalyze.mock.calls[0][0].productId).toBeUndefined()
  })

  test('Enter sin coincidencias en el catálogo analiza a la primera', async () => {
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Yerba{Enter}')

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalledTimes(1))
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
    // Coma decimal: con punto, "23.8%" al lado de "ARS 1.900" se lee como
    // veintitrés mil.
    expect(screen.getByText(/23,8% de margen/)).toBeDefined()
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

// ─── Rediseño ────────────────────────────────────────────────────────────

const QUESO = {
  _id: '64b000000000000000000001',
  title: 'Queso de Campo Ricolact',
  costoUnitario: 5200,
}

describe('Análisis de mercado · producto del catálogo', () => {
  test('elegido del desplegable, viaja el productId y la ficha pone el costo', async () => {
    mockGetProducts.mockResolvedValue({ data: [QUESO] })
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Queso')
    await userEvent.click(await screen.findByText('Queso de Campo Ricolact'))

    expect(await screen.findByText(/Costo en la ficha: \$5\.200/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))
    await waitFor(() => expect(mockAnalyze).toHaveBeenCalled())

    expect(mockAnalyze.mock.calls[0][0]).toEqual({
      product: 'Queso de Campo Ricolact',
      country: 'AR',
      forceRefresh: false,
      productId: QUESO._id,
      costs: {},
    })
  })

  test('si el texto cambia, deja de ser ese producto y no manda su productId', async () => {
    mockGetProducts.mockResolvedValue({ data: [QUESO] })
    render(<MarketIntelligencePage />)

    const campo = screen.getByLabelText(/producto o categoría/i)
    await userEvent.type(campo, 'Queso')
    await userEvent.click(await screen.findByText('Queso de Campo Ricolact'))
    await userEvent.type(campo, ' rallado{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalled())
    expect(mockAnalyze.mock.calls[0][0].productId).toBeUndefined()
    expect(screen.queryByText(/Costo en la ficha/)).toBeNull()
  })

  test('se muestra de dónde salió cada costo', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: { ...RESULTADO, profitability: RENTABILIDAD },
      costSources: {
        unitCost: 'stored',
        paymentFeePercent: 'measured',
        paymentFeeSampleSize: 40,
        shippingCost: 'override',
        platformFeePercent: 'missing',
        taxPercent: 'missing',
      },
    })

    await analizar()

    expect(await screen.findByText('De dónde salen tus costos')).toBeDefined()
    expect(screen.getByText('De la ficha del producto')).toBeDefined()
    expect(screen.getByText('Medida en tus últimas 40 ventas cobradas')).toBeDefined()
    expect(screen.getByText('Lo cargaste vos')).toBeDefined()
  })
})

describe('Análisis de mercado · costos', () => {
  test('un costo inválido frena el análisis y dice por qué', async () => {
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Yerba{Escape}')
    await userEvent.click(screen.getByText('Calcular rentabilidad'))
    await userEvent.type(screen.getByLabelText(/Impuestos/i), '150')

    expect(screen.getByText('Entre 0 y 100')).toBeDefined()
    expect(screen.getByRole('button', { name: /^Analizar$/i }).disabled).toBe(true)
  })

  test('sin catálogo, la comisión de cobro viaja aparte de la del marketplace', async () => {
    render(<MarketIntelligencePage />)

    await userEvent.type(screen.getByLabelText(/producto o categoría/i), 'Yerba{Escape}')
    await userEvent.click(screen.getByText('Calcular rentabilidad'))
    await userEvent.type(screen.getByLabelText(/Costo por unidad/i), '1000')
    await userEvent.type(screen.getByLabelText(/Comisión del marketplace/i), '13')
    await userEvent.type(screen.getByLabelText(/Comisión de cobro/i), '6')
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    await waitFor(() => expect(mockAnalyze).toHaveBeenCalled())
    expect(mockAnalyze.mock.calls[0][0].costs).toEqual({
      unitCost: 1000,
      shippingCost: 0,
      platformFeePercent: 13,
      paymentFeePercent: 6,
      taxPercent: 0,
    })
  })

  test('validateCosts: vacío vale, cero de costo no, porcentajes entre 0 y 100', () => {
    expect(validateCosts(EMPTY_COSTS)).toEqual({})
    expect(validateCosts({ ...EMPTY_COSTS, unitCost: '0' }).unitCost).toBeDefined()
    expect(validateCosts({ ...EMPTY_COSTS, shippingCost: '-1' }).shippingCost).toBeDefined()
    expect(validateCosts({ ...EMPTY_COSTS, taxPercent: '100' })).toEqual({})
    expect(validateCosts({ ...EMPTY_COSTS, paymentFeePercent: '101' }).paymentFeePercent).toBe(
      'Entre 0 y 100',
    )
  })

  test('buildAnalyzeRequest: con catálogo solo viaja lo que se quiere sobrescribir', () => {
    const pedido = buildAnalyzeRequest({
      product: ' Queso ',
      country: 'UY',
      forceRefresh: true,
      costs: { ...EMPTY_COSTS, taxPercent: '21' },
      catalogProduct: QUESO,
    })

    expect(pedido).toEqual({
      product: 'Queso',
      country: 'UY',
      forceRefresh: true,
      productId: QUESO._id,
      costs: { taxPercent: 21 },
    })
  })

  test('describeCostSource y percent', () => {
    expect(describeCostSource('paymentFeePercent', { paymentFeePercent: 'missing' })).toMatch(
      /cuenta 0%/,
    )
    expect(describeCostSource('unitCost', {})).toBeNull()
    expect(percent(undefined)).toBe('—')
    expect(percent(-37.1)).toBe('-37,1%')
  })

  test('un escenario sin margen no rompe la pantalla', async () => {
    mockAnalyze.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        profitability: {
          ...RENTABILIDAD,
          scenarios: { atMedian: { price: 8000, profit: 1900, profitable: true } },
        },
      },
    })

    await analizar()

    expect(await screen.findByText('— de margen')).toBeDefined()
  })
})
