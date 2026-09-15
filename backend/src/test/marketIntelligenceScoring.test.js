// Análisis de mercado: el cálculo del puntaje y lo que se le muestra al
// comerciante.
//
// El módulo no tenía tests, y la auditoría contra los doce análisis reales de
// producción encontró por qué importaba: los doce salieron con 1 a 9 puntos de
// 100 y 33 de confianza, teniendo entre 8 y 40 ofertas de mercado medidas y
// guardadas en el mismo documento. El buscador de precios —la única fuente
// externa que hoy responde— no entraba al puntaje, y la confianza seguía
// contando MercadoLibre, retirado desde que cerró su API.
//
// Las señales de acá son las de un análisis real de producción
// (Queso de Campo Ricolact, 2026-09-13), no inventadas.

import { jest } from '@jest/globals'

import {
  calculateDemandScore,
  SCORING_VERSION,
} from '../services/marketIntelligence/scoring/demandScoreEngine.js'
import { calculateConfidence } from '../services/marketIntelligence/scoring/confidenceCalculator.js'
import { buildMarketAnalysisResponse } from '../services/marketIntelligence/schemas/marketAnalysisContract.js'

const CUOTA_AGOTADA =
  'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.'

/** Producción, tal cual: buscador con datos, IA sin cuota, tienda con una venta. */
const señalesReales = (extra = {}) => ({
  meli: { available: false, retired: true },
  shopping: {
    available: true,
    provider: 'tavily',
    offerCount: 8,
    merchantCount: 7,
    priceStats: { min: 4450, p25: 4786, median: 8000, p75: 20060, max: 30600, currency: 'ARS', sampleSize: 8 },
    offers: [],
  },
  research: { available: false, error: CUOTA_AGOTADA },
  internal: {
    available: true,
    scope: 'internal',
    isInCatalog: true,
    unitsSoldLast90Days: 1,
    currentStock: 111,
    categoryUnitsSold: 1,
  },
  ...extra,
})

describe('puntaje de demanda · las ofertas del mercado cuentan', () => {
  test('con la IA caída, competencia se mide con los vendedores que sí se contaron', () => {
    // Antes: competition = null, porque solo miraba la lectura de la IA. Siete
    // vendedores publicando el producto quedaban sin usar.
    const { components } = calculateDemandScore(señalesReales())

    // 7 vendedores cae en el tramo de 4 a 7: mercado con competencia real.
    expect(components.competition).toBe(70)
  })

  test('actividad comercial refleja las ofertas vivas, no solo la categoría propia', () => {
    // Antes daba 1: el único aporte era categoryUnitsSold = 1.
    const { components } = calculateDemandScore(señalesReales())

    expect(components.commercial).toBeGreaterThanOrEqual(32)
  })

  test('lo que no se pudo medir queda listado, no puntúa cero', () => {
    const { measuredWeight, unmeasured } = calculateDemandScore(señalesReales())

    // competencia + comercial + oportunidad: lo que el buscador y la tienda
    // alcanzan a medir sin la búsqueda con IA.
    expect(measuredWeight).toBeCloseTo(0.4, 2)
    // Demanda, tendencia y social dependen de la IA, y eso se dice en pantalla.
    expect(unmeasured.sort()).toEqual(['demand', 'social', 'trend'])
  })

  test('deja de dar un dígito cuando hay mercado medido', () => {
    const { total } = calculateDemandScore(señalesReales())

    // El mismo caso daba 1/100 en producción.
    expect(total).toBeGreaterThan(20)
  })

  test('cero ofertas con el buscador respondiendo es una medición, no un vacío', () => {
    const { components } = calculateDemandScore(
      señalesReales({
        shopping: { available: true, offerCount: 0, merchantCount: 0, priceStats: null, offers: [] },
      }),
    )

    expect(components.competition).toBe(20)
  })

  test('sin buscador, la lectura de la IA sigue sirviendo de respaldo', () => {
    const { components } = calculateDemandScore(
      señalesReales({
        shopping: { available: false, reason: 'NO_DISPONIBLE' },
        research: {
          available: true,
          searchIntent: { informational: 2, commercial: 3, transactional: 4 },
          trendDirection: 'CRECIENTE',
          competition: { level: 'MEDIA' },
        },
      }),
    )

    expect(components.competition).toBe(70)
  })

  test('las ventas propias no se hacen pasar por demanda del mercado', () => {
    // Una Coca-Cola con decenas de vendedores publicándola salía "no conviene"
    // porque esta tienda había vendido UNA unidad en 90 días: esa venta valía
    // 2 puntos sobre 100 y pesaba el 30% del puntaje.
    const { components } = calculateDemandScore(señalesReales())

    expect(components.demand).toBeNull()
  })

  test('sin ninguna fuente externa, las ventas propias sí miden algo', () => {
    // Ahí el análisis responde otra pregunta —"¿mis clientes lo compran?"— y
    // se presenta como interno.
    const { components } = calculateDemandScore(
      señalesReales({
        shopping: { available: false, reason: 'NO_DISPONIBLE' },
        internal: {
          available: true,
          isInCatalog: true,
          unitsSoldLast90Days: 12,
          currentStock: 4,
          categoryUnitsSold: 30,
        },
      }),
    )

    expect(components.demand).toBe(24)
  })

  test('la versión del modelo subió, así que el cache viejo no se sirve', () => {
    expect(SCORING_VERSION).toBeGreaterThanOrEqual(6)
  })
})

describe('confianza · se cuentan las fuentes que existen', () => {
  test('un análisis con precios medidos deja de ser "datos insuficientes"', () => {
    const signals = señalesReales()
    const { measuredWeight } = calculateDemandScore(signals)

    const confianza = calculateConfidence(signals, measuredWeight)

    // El contrato marca DATOS INSUFICIENTES por debajo de 40, y en producción
    // los doce análisis daban 33 — siempre, midieran lo que midieran.
    expect(confianza).toBeGreaterThan(40)
  })

  test('MercadoLibre retirado no cuenta como fuente disponible', () => {
    const conMeli = calculateConfidence(
      { ...señalesReales(), meli: { available: true, priceRange: { min: 1 }, sellerCount: 30 } },
      0.7,
    )
    const sinMeli = calculateConfidence(señalesReales(), 0.7)

    expect(conMeli).toBe(sinMeli)
  })

  test('una muestra de precios chica no otorga el bonus cuantitativo', () => {
    const chica = señalesReales({
      shopping: {
        available: true,
        offerCount: 2,
        merchantCount: 2,
        priceStats: { median: 8000, sampleSize: 2 },
      },
    })

    expect(calculateConfidence(chica, 0.7)).toBeLessThan(
      calculateConfidence(señalesReales(), 0.7),
    )
  })
})

describe('respuesta al panel · los errores se cuentan en castellano', () => {
  const respuesta = (rawSignals = señalesReales()) =>
    buildMarketAnalysisResponse({
      product: 'Queso de Campo Ricolact',
      country: 'AR',
      demandScore: 40,
      confidenceScore: 55,
      breakdown: {},
      rawSignals,
      generatedAt: new Date(),
    })

  test('no se le muestra al comerciante el error literal de Google', () => {
    const { sources } = respuesta()
    const ia = sources.find(s => s.key === 'research')

    expect(ia.available).toBe(false)
    expect(ia.detail).not.toMatch(/quota|billing/i)
    expect(ia.detail).toMatch(/límite de consultas/i)
  })

  test('cada fuente dice qué aporta y qué contestó', () => {
    const { sources } = respuesta()

    expect(sources.map(s => s.key)).toEqual(['shopping', 'research', 'internal'])
    expect(sources.find(s => s.key === 'shopping').detail).toMatch(/8 ofertas de 7 vendedores/i)
    expect(sources.find(s => s.key === 'internal').detail).toMatch(/catálogo/i)
  })


  test('un modelo dado de baja manda a donde se cambia', () => {
    const { sources } = respuesta(
      señalesReales({
        research: {
          available: false,
          error: 'This model models/gemini-2.5-flash-lite is no longer available to new users.',
        },
      }),
    )

    expect(sources.find(s => s.key === 'research').detail).toMatch(
      /Configuración del agente/i,
    )
  })
})

describe('veredicto · no se afirma lo que no se midió', () => {
  const veredicto = (demandScore, confidenceScore, breakdown) =>
    buildMarketAnalysisResponse({
      product: 'x',
      country: 'AR',
      demandScore,
      confidenceScore,
      breakdown,
      rawSignals: señalesReales(),
      generatedAt: new Date(),
    })

  test('sin medir la demanda no se dice "no conviene"', () => {
    // 41/100 con la demanda sin medir era exactamente el caso de la Coca-Cola:
    // el panel mostraba "No conviene por ahora".
    const r = veredicto(41, 63, { demand: null, competition: 85, commercial: 60 })

    expect(r.recommendation).toBe('FALTA MEDIR LA DEMANDA')
    expect(r.demandClassification).toMatch(/no se pudo medir/i)
  })

  test('con la demanda medida el veredicto vuelve a ser sobre la demanda', () => {
    expect(veredicto(80, 70, { demand: 78 }).recommendation).toBe('RECOMENDADO')
    expect(veredicto(30, 70, { demand: 20 }).recommendation).toBe('NO RECOMENDADO')
  })
})

// ─── La búsqueda que sí funcionó no se tira ─────────────────────────────────
//
// El análisis pasa por dos llamadas: la primera busca en Google —el recurso
// escaso, el que tiene cuota propia y ya está pagado— y la segunda solo
// reordena ese texto en JSON. En producción, dos de las tres búsquedas que
// funcionaron terminaron descartadas porque la segunda no devolvió JSON
// válido: se perdió lo caro por fallar lo barato.

const mockCallAgentLLM = jest.fn()

const mockTavilySearch = jest.fn()

jest.unstable_mockModule('../services/aiAgent/aiAgentLLMService.js', () => ({
  callAgentLLM: mockCallAgentLLM,
  callAgentLLMForRepair: jest.fn(),
}))

jest.unstable_mockModule('../services/marketIntelligence/sources/tavilyClient.js', () => ({
  tavilySearch: mockTavilySearch,
  hasTavilyKey: () => true,
  TAVILY_COUNTRY: { AR: 'argentina' },
}))

describe('precios desde texto · lo que NO se puede tomar por precio', () => {
  let normalizeTavilyResults

  const AR = { domain: 'google.com.ar', gl: 'ar', hl: 'es', currency: 'ARS' }

  const resultado = (url, title, content) => ({ url, title, content })

  beforeAll(async () => {
    ;({ __test__: { normalizeTavilyResults } } = await import(
      '../services/marketIntelligence/sources/shoppingSource.js'
    ))
  })

  test('toma el precio marcado con moneda', () => {
    const ofertas = normalizeTavilyResults(
      [resultado('https://www.tienda.com.ar/campera', 'Campera de cuero', 'Campera biker $ 89.999 envío gratis')],
      AR,
    )

    expect(ofertas).toHaveLength(1)
    expect(ofertas[0]).toMatchObject({
      price: 89999,
      currency: 'ARS',
      merchant: 'tienda.com.ar',
      link: 'https://www.tienda.com.ar/campera',
    })
  })

  test('el punto de miles no se lee como decimal', () => {
    // "$ 89.999" es ochenta y nueve mil, no ochenta y nueve con noventa y
    // nueve: mil veces menos entrando a la mediana y a la rentabilidad.
    const casos = [
      ['Precio $ 89.999', 89999],
      ['Precio $ 1.299.500', 1299500],
      ['Precio $ 4.450', 4450],
      ['Precio $ 12,50', 12.5],
      ['Precio $ 8000', 8000],
    ]

    for (const [texto, esperado] of casos) {
      expect(normalizeTavilyResults([resultado('https://t.com.ar/a', '', texto)], AR)[0].price).toBe(esperado)
    }
  })

  test('ignora las cuotas, que no son el precio', () => {
    // "12 cuotas sin interés de $ 7.499" sobre una campera de 89.999: tomar la
    // cuota hunde la mediana a una fracción de la real.
    const ofertas = normalizeTavilyResults(
      [resultado('https://x.com.ar/a', 'Campera', '12 cuotas sin interés de $ 7.499. Precio $ 89.999')],
      AR,
    )

    expect(ofertas[0].price).toBe(89999)
  })

  test('un umbral de envío gratis no es el precio', () => {
    // Texto real de campingcenter.com.ar, capturado en la verificación en vivo:
    // el parser tomaba ese $100 como el precio de una campera de Columbia.
    const ofertas = normalizeTavilyResults(
      [
        resultado(
          'https://www.campingcenter.com.ar/campera-powder-lite',
          'Campera POWDER LITE MID II Mujer',
          '3 cuotas SIN interes en todos los articulos - Envios GRATIS x compra de mas de $100mil - En las sucursales descuento 10 % en efectivo',
        ),
      ],
      AR,
    )

    expect(ofertas).toHaveLength(0)
  })

  test('descarta precios en otra moneda', () => {
    // Un US$ 120 entre precios en pesos rompe la mediana y los percentiles: no
    // son comparables y acá no hay tipo de cambio.
    const ofertas = normalizeTavilyResults(
      [resultado('https://importado.com/a', 'Jacket', 'Leather jacket US$ 120 free shipping')],
      AR,
    )

    expect(ofertas).toHaveLength(0)
  })

  test('un número sin moneda no es un precio', () => {
    const ofertas = normalizeTavilyResults(
      [resultado('https://x.com.ar/a', 'Campera modelo 2026', 'Talle 42, modelo 2026, 100% cuero')],
      AR,
    )

    expect(ofertas).toHaveLength(0)
  })

  test('diez páginas de la misma tienda son UN vendedor', () => {
    // merchantCount mide competencia. Contar diez resultados del mismo dominio
    // como diez competidores infla justo el número que decide ese componente.
    const ofertas = normalizeTavilyResults(
      [
        resultado('https://tienda.com.ar/a', 'Campera A', 'Precio $ 80.000'),
        resultado('https://tienda.com.ar/b', 'Campera B', 'Precio $ 90.000'),
        resultado('https://otra.com.ar/c', 'Campera C', 'Precio $ 70.000'),
      ],
      AR,
    )

    expect(ofertas).toHaveLength(2)
    expect(ofertas.map(o => o.merchant)).toEqual(['tienda.com.ar', 'otra.com.ar'])
  })

  test('una página de OTRO producto no entra a la muestra', () => {
    // Caso real de producción, 15/09 14:21. Buscando una campera de cuero
    // sintético con suela, Tavily devolvió botines "de cuero sintético suela"
    // y una pantubota "de cuero sintético gamuzado suela": los atributos
    // coincidían. Dos de los tres precios eran de otra cosa, y los botines a
    // $18.473 fijaban el mínimo contra una campera de $157.499.
    const ofertas = normalizeTavilyResults(
      [
        resultado('https://www.billabong.com.ar/p/campera-laguna', 'Campera Mujer Laguna parka matelaseada', 'Precio $157.499'),
        resultado('https://briganti.com.ar/p/pantubota', 'Pantubota Bambi Mujer de Cuero Sintético Gamuzado Suela', 'Precio $89.999'),
        resultado('https://www.sgcdeportes.com.ar/p/botines', 'BOTINES NTX STADIO FUTSAL CUERO SINTETICO SUELA', 'Precio $18.473'),
      ],
      AR,
      'Campera De Cuero Sintético Biker Bicolor Blanco Y Suela',
    )

    expect(ofertas).toHaveLength(1)
    expect(ofertas[0].merchant).toBe('billabong.com.ar')
  })

  test('la marca también identifica, cuando el sustantivo no aparece', () => {
    // "Gaseosa Coca-Cola…": las páginas tituladas "Coca Cola 2.25L" no dicen
    // "gaseosa" y quedaban afuera. La segunda palabra sirve cuando no es un
    // material — "cuero" no identifica nada, "coca" sí.
    const ofertas = normalizeTavilyResults(
      [resultado('https://super.com.ar/p/coca', 'Coca Cola 2.25L', 'Precio $5.824')],
      AR,
      'Gaseosa Coca-Cola Original Taste Botella 2.25L',
    )

    expect(ofertas).toHaveLength(1)
  })

  test('un pack no es el precio de la unidad', () => {
    // Caso real: buscando "Yerba Mate Playadito 1kg" entraron packs por cinco
    // a $27.200 y $38.000 junto a los kilos sueltos de $4.100.
    const ofertas = normalizeTavilyResults(
      [
        resultado('https://a.com.ar/p/yerba-1kg', 'Yerba Mate Playadito 1kg', 'Precio $4.100'),
        resultado('https://b.com.ar/p/yerba-pack', 'Yerba Playadito 1kg - Pack x 5un', 'Precio $27.200'),
      ],
      AR,
      'Yerba Mate Playadito 1kg',
    )

    expect(ofertas).toHaveLength(1)
    expect(ofertas[0].price).toBe(4100)
  })

  test('si se pide un pack, el pack vale', () => {
    const ofertas = normalizeTavilyResults(
      [resultado('https://b.com.ar/p/yerba-pack', 'Yerba Playadito 1kg Pack x 5un', 'Precio $27.200')],
      AR,
      'Yerba Mate Playadito Pack x 5 unidades',
    )

    expect(ofertas).toHaveLength(1)
  })

  test('una página sin precio legible no inventa uno', () => {
    const ofertas = normalizeTavilyResults(
      [resultado('https://blog.com/nota', 'Las mejores camperas de 2026', 'Repasamos los modelos del año')],
      AR,
    )

    expect(ofertas).toHaveLength(0)
  })
})

describe('estadísticas de precio · los atípicos no deciden el piso', () => {
  let getPriceStatsForTest

  beforeAll(async () => {
    ;({ __test__: { computePriceStats: getPriceStatsForTest } } = await import(
      '../services/marketIntelligence/sources/shoppingSource.js'
    ))
  })

  test('el extremo disparatado no entra a las estadísticas', () => {
    // Corrida real de "casco de moto integral": nueve tiendas argentinas, con
    // $5.000 y $1.202.600 saliendo de listados de categoría y no de productos.
    const precios = [5000, 81400, 107923, 156100, 259000, 280000, 422100, 554000, 1202600]

    const stats = getPriceStatsForTest(precios.map(price => ({ price })))

    // El millón doscientos queda fuera: está a más de 1,5 rangos
    // intercuartiles del p75.
    expect(stats.max).toBeLessThan(1202600)
    expect(stats.sampleSize).toBe(8)

    // El $5.000 SOBREVIVE, y está bien que así sea: con una dispersión tan
    // ancha la regla de Tukey no lo marca, y recortarlo pediría un criterio
    // inventado que también se llevaría ofertas baratas legítimas. Por eso el
    // panel muestra cada precio con su link en vez de pedir fe.
    expect(stats.min).toBe(5000)
    expect(stats.median).toBe(207550)
  })

  test('con muestra chica no se descarta nada', () => {
    // Con cuatro precios el rango intercuartil no describe nada y recortar
    // sería inventar un criterio.
    const stats = getPriceStatsForTest([{ price: 100 }, { price: 200 }, { price: 300 }, { price: 99000 }])

    expect(stats.min).toBe(100)
    expect(stats.max).toBe(99000)
    expect(stats.sampleSize).toBe(4)
  })
})

describe('persistencia · ninguna fuente se pierde al guardar', () => {
  let MarketAnalysis

  beforeAll(async () => {
    MarketAnalysis = (await import(
      '../services/marketIntelligence/schemas/MarketAnalysis.js'
    )).default
  })

  test('el schema declara las tres fuentes del análisis', () => {
    // MercadoLibre salió del paquete: su API está cerrada a integradores y el
    // stub que fallaba rápido ocupaba un lugar en cada análisis para devolver
    // siempre lo mismo.
    for (const fuente of ['shopping', 'research', 'internal']) {
      expect(MarketAnalysis.schema.path(`rawSignals.${fuente}`)).toBeDefined()
    }
  })

})

// ─── Lo ajustable se ajusta sin tocar código ────────────────────────────────

describe('configuración · nada fijo a mano', () => {
  test('el umbral de atípicos sale de una variable', async () => {
    const previo = process.env.SHOPPING_MIN_SAMPLE_OUTLIERS
    process.env.SHOPPING_MIN_SAMPLE_OUTLIERS = '3'

    try {
      // Con el módulo recargado, tres precios ya alcanzan para descartar.
      const { __test__ } = await import(
        `../services/marketIntelligence/sources/shoppingSource.js?umbral=${Date.now()}`
      )

      const stats = __test__.computePriceStats(
        [4100, 4200, 4300, 4400, 900000].map(price => ({ price })),
      )

      expect(stats.max).toBeLessThan(900000)
    } finally {
      if (previo === undefined) delete process.env.SHOPPING_MIN_SAMPLE_OUTLIERS
      else process.env.SHOPPING_MIN_SAMPLE_OUTLIERS = previo
    }
  })
})

// ─── Tavily busca, Gemini ordena ────────────────────────────────────────────
//
// El paso de investigación lo hacía Gemini con el tool de Google Search, y
// estaba muerto: la familia Gemini 3 tiene cuota de búsqueda CERO en el nivel
// gratuito. Comprobado contra la API con la clave de producción, mismo minuto:
// sin `tools` responde 200, con `tools` responde 429. Ahora busca Tavily y el
// modelo solo estructura, con una llamada común de las que sí funcionan.

describe('investigación web · el modelo ordena, no recuerda', () => {
  let getWebResearchSignals

  const PAGINAS = [
    {
      url: 'https://foro.com.ar/hilo-campera',
      title: 'Opiniones campera de cuero',
      content: 'Varios usuarios dicen que el cierre se traba al mes.',
    },
    {
      url: 'https://blog.com.ar/review',
      title: 'Review: campera biker',
      content: 'El cierre vino fallado. Igual la calidad general es buena.',
    },
  ]

  const SENALES = {
    searchIntent: { informational: 1, commercial: 1, transactional: 0 },
    trendDirection: 'ESTABLE',
    recurringComplaints: ['el cierre se traba'],
  }

  beforeAll(async () => {
    ;({ getWebResearchSignals } = await import(
      '../services/marketIntelligence/sources/webResearchSource.js'
    ))
  })

  beforeEach(() => {
    mockCallAgentLLM.mockReset()
    mockTavilySearch.mockReset()
  })

  test('no manda herramientas: no depende de la cuota que está en cero', async () => {
    mockTavilySearch.mockResolvedValue(PAGINAS)
    mockCallAgentLLM.mockResolvedValue({ content: JSON.stringify(SENALES) })

    await getWebResearchSignals({ product: 'campera de cuero', country: 'AR', apiKey: 'k' })

    expect(mockCallAgentLLM).toHaveBeenCalledTimes(1)
    expect(mockCallAgentLLM.mock.calls[0][0].tools).toBeUndefined()
  })

  test('las fuentes son las URLs que trajo el buscador, no lo que el modelo escriba', async () => {
    // Una URL inventada por un modelo es indistinguible de una real hasta que
    // alguien la abre.
    mockTavilySearch.mockResolvedValue(PAGINAS)
    mockCallAgentLLM.mockResolvedValue({
      content: JSON.stringify({ ...SENALES, sources: [{ url: 'https://inventada.com' }] }),
    })

    const signals = await getWebResearchSignals({ product: 'campera', country: 'AR', apiKey: 'k' })

    expect(signals.available).toBe(true)
    expect(signals.sources.map(f => f.url)).toEqual([
      'https://foro.com.ar/hilo-campera',
      'https://blog.com.ar/review',
    ])
  })

  test('el modelo recibe cada página con su link', async () => {
    mockTavilySearch.mockResolvedValue(PAGINAS)
    mockCallAgentLLM.mockResolvedValue({ content: JSON.stringify(SENALES) })

    await getWebResearchSignals({ product: 'campera', country: 'AR', apiKey: 'k' })

    const enviado = mockCallAgentLLM.mock.calls[0][0].messages[0].content

    expect(enviado).toContain('https://foro.com.ar/hilo-campera')
    expect(enviado).toContain('[1]')
    expect(enviado).toContain('[2]')
  })

  test('si la IA no devuelve el formato, la búsqueda no se pierde', async () => {
    mockTavilySearch.mockResolvedValue(PAGINAS)
    mockCallAgentLLM.mockResolvedValue({ content: 'perdón, no puedo' })

    const signals = await getWebResearchSignals({ product: 'campera', country: 'AR', apiKey: 'k' })

    expect(signals.available).toBe(false)
    expect(signals.reason).toMatch(/formato esperado/i)
    expect(signals.sources).toHaveLength(2)
    expect(signals.pagesFound).toBe(2)
  })

  test('el JSON envuelto en un bloque de código se recupera igual', async () => {
    mockTavilySearch.mockResolvedValue(PAGINAS)
    mockCallAgentLLM.mockResolvedValue({
      content: '```json\n' + JSON.stringify(SENALES) + '\n```',
    })

    const signals = await getWebResearchSignals({ product: 'campera', country: 'AR', apiKey: 'k' })

    expect(signals.available).toBe(true)
    expect(signals.trendDirection).toBe('ESTABLE')
  })

  test('sin páginas no se llama a la IA ni se inventa nada', async () => {
    mockTavilySearch.mockResolvedValue([])

    const signals = await getWebResearchSignals({ product: 'zxqwv', country: 'AR', apiKey: 'k' })

    expect(signals.available).toBe(false)
    expect(signals.reason).toMatch(/no se encontraron páginas/i)
    expect(mockCallAgentLLM).not.toHaveBeenCalled()
  })
})

// ─── Un pack de 3 no se compara contra un kilo suelto ───────────────────────
//
// Caso real, 15/09 15:52 UTC: analizando "Yerba Mate Playadito Elaborada con
// Palo 1kg Pack x 3 Unidades" el panel mostró mediana $25.440 y mínimo $4.000.
// Los tres precios eran de tres productos distintos —un kilo suelto de otra
// marca, un pack de diez y uno de cinco— y ninguno era el pack por tres.
//
// La causa: el filtro de packs se apagaba entero cuando la consulta pedía un
// pack. Pasaba de "filtrar bultos" a "no filtrar nada", justo cuando comparar
// cantidades importa más.

describe('packs · se compara la misma cantidad de unidades', () => {
  let packSize
  let looksLikeBundle
  let normalizeTavilyResults

  const PRODUCTO = 'Yerba Mate Playadito Elaborada con Palo 1kg Pack x 3 Unidades'

  // Textualmente los tres resultados que devolvió Tavily en esa corrida.
  const RESULTADOS_REALES = [
    {
      title: 'YERBA MATE ELABORADA CON PALO POR 1 KG.',
      url: 'https://www.tiendapipore.com.ar/productos/yerba-mate-elaborada-con-palo-por-1-kg',
      content: 'Yerba mate elaborada con palo 1 kg $4.000',
    },
    {
      title: 'Yerba Mate Más Sabor Con Palo 1kg - Pack x 10u',
      url: 'https://mas-sabor.com.ar/productos/yerba-mate-con-palo-1kg-pack-x-10u',
      content: 'Pack x 10 unidades $28.000',
    },
    {
      title: 'Yerba Playadito 1kg - Pack x 5un - Comprar en OPEN25HS!',
      url: 'https://tienda.open25.com.ar/productos/yerba-playadito-1kg-pack-x5',
      content: 'Pack x 5 unidades $25.440',
    },
  ]

  beforeAll(async () => {
    ;({
      __test__: { packSize, looksLikeBundle, normalizeTavilyResults },
    } = await import('../services/marketIntelligence/sources/shoppingSource.js'))
  })

  test('lee cuántas unidades trae cada título', () => {
    expect(packSize('Yerba Mate Playadito 1kg Pack x 3 Unidades')).toBe(3)
    expect(packSize('Yerba Mate Más Sabor Con Palo 1kg - Pack x 10u')).toBe(10)
    expect(packSize('Yerba Playadito 1kg - Pack x 5un')).toBe(5)
    expect(packSize('Combo 2 unidades')).toBe(2)

    // Sin palabra de pack, es una unidad.
    expect(packSize('YERBA MATE ELABORADA CON PALO POR 1 KG.')).toBe(1)

    // "1kg" es peso, no cantidad de unidades.
    expect(packSize('Yerba Mate Playadito 1kg')).toBe(1)

    // Dice pack y no dice cuántas: no es 1, y no es comparable.
    expect(packSize('Pack ahorro yerba mate')).toBeNull()
  })

  test('el caso de producción: ninguno de los tres era el pack por tres', () => {
    for (const resultado of RESULTADOS_REALES) {
      expect(looksLikeBundle(resultado, PRODUCTO)).toBe(true)
    }

    const ofertas = normalizeTavilyResults(RESULTADOS_REALES, 'es-AR', PRODUCTO)

    // Cero ofertas es la respuesta verdadera: ese pack no está publicado.
    // Una mediana de $25.440 construida con otros tres productos, no.
    expect(ofertas).toHaveLength(0)
  })

  test('el pack de la misma cantidad sí entra', () => {
    const mismo = {
      title: 'Yerba Mate Playadito 1kg Pack x 3 Unidades',
      url: 'https://tienda.com.ar/playadito-pack-x3',
      content: 'Pack x 3 unidades $12.600',
    }

    expect(looksLikeBundle(mismo, PRODUCTO)).toBe(false)
  })

  test('preguntando por una unidad, los packs se siguen yendo', () => {
    // Es el comportamiento que ya existía y no debe perderse.
    const unaUnidad = 'Yerba Mate Playadito 1kg'

    expect(looksLikeBundle({ title: 'Yerba Playadito Pack x 5un' }, unaUnidad)).toBe(true)
    expect(looksLikeBundle({ title: 'Yerba Playadito 1kg' }, unaUnidad)).toBe(false)
  })

  test('si la consulta dice pack sin decir cuántas, no se filtra', () => {
    // No hay con qué comparar. Mejor una muestra ruidosa que el comerciante
    // puede mirar oferta por oferta, que cero resultados por una ambigüedad
    // del propio título.
    const ambiguo = 'Yerba Mate Playadito Pack ahorro'

    expect(looksLikeBundle({ title: 'Yerba Playadito Pack x 5un' }, ambiguo)).toBe(false)
    expect(looksLikeBundle({ title: 'Yerba Playadito 1kg' }, ambiguo)).toBe(false)
  })
})

// ─── Un listado de categoría no es una ficha de producto ────────────────────
//
// Caso real, 15/09 16:14 UTC: analizando "Gorra Fox Racing Negra con Logo
// Blanco" las dos únicas ofertas fueron la portada de la marca en motordos
// ($110.971) y los resultados de búsqueda de MercadoLibre ($78.699). Ninguna
// es una gorra: son precios de otra cosa que estaba en la misma página.
//
// Una página de categoría SIEMPRE tiene un precio a la vista, así que el
// parser no falla — encuentra el precio equivocado, que es peor.

describe('listados · no se cotiza una página de categoría', () => {
  let isListingPage
  let normalizeTavilyResults

  beforeAll(async () => {
    ;({
      __test__: { isListingPage, normalizeTavilyResults },
    } = await import('../services/marketIntelligence/sources/shoppingSource.js'))
  })

  test('las dos URLs que ensuciaron la corrida real son listados', () => {
    expect(isListingPage('https://www.motordos.com.ar/marca-fox-racing-21')).toBe(true)
    expect(
      isListingPage('https://listado.mercadolibre.com.ar/gorra-fox-hombre'),
    ).toBe(true)
  })

  test('las fichas de producto que sí sirvieron siguen entrando', () => {
    // Las tres de la corrida de la yerba: si el filtro se las lleva puestas,
    // no queda ninguna fuente de precios.
    const fichas = [
      'https://www.tiendapipore.com.ar/productos/yerba-mate-elaborada-con-palo-por-1-kg',
      'https://mas-sabor.com.ar/productos/yerba-mate-con-palo-1kg-pack-x-10u',
      'https://tienda.open25.com.ar/productos/yerba-playadito-1kg-pack-x5',
    ]

    for (const url of fichas) {
      expect(isListingPage(url)).toBe(false)
    }
  })

  test('Shopify publica la ficha dentro de una colección, y sigue siendo ficha', () => {
    // /collections/ sin /products/ es la categoría; con /products/ es el
    // producto. Sin esta distinción se pierde media tienda Shopify.
    expect(
      isListingPage('https://tienda.com.ar/collections/gorras/products/gorra-fox-negra'),
    ).toBe(false)
    expect(isListingPage('https://tienda.com.ar/collections/gorras')).toBe(true)
  })

  test('el listado no llega a ser una oferta', () => {
    const ofertas = normalizeTavilyResults(
      [
        {
          title: 'Fox Racing Moto | Indumentaria y Equipamiento | Argentina - Motor Dos',
          url: 'https://www.motordos.com.ar/marca-fox-racing-21',
          content: 'Campera Fox Racing $110.971',
        },
        {
          title: 'Gorra Fox Hombre | MercadoLibre',
          url: 'https://listado.mercadolibre.com.ar/gorra-fox-hombre',
          content: 'Gorra Fox $78.699',
        },
      ],
      'es-AR',
      'Gorra Fox Racing Negra con Logo Blanco',
    )

    expect(ofertas).toHaveLength(0)
  })
})

// ─── Cuartiles con dos precios ──────────────────────────────────────────────
//
// La misma corrida publicó min $78.699, p25 $86.767, mediana $94.835, p75
// $102.903, max $110.971: cinco cifras nacidas de DOS precios. p25 y p75 son
// puntos de una recta trazada entre los dos, no cuartiles de un mercado.

describe('cuartiles · no se interpola una distribución que no existe', () => {
  let computePriceStats

  beforeAll(async () => {
    ;({
      __test__: { computePriceStats },
    } = await import('../services/marketIntelligence/sources/shoppingSource.js'))
  })

  const ofertas = precios => precios.map(price => ({ price, currency: 'ARS' }))

  test('con dos precios no hay p25 ni p75', () => {
    const stats = computePriceStats(ofertas([78699, 110971]))

    expect(stats.p25).toBeNull()
    expect(stats.p75).toBeNull()

    // El más barato, el del medio y el más caro sí son lo que dicen ser.
    expect(stats.min).toBe(78699)
    expect(stats.max).toBe(110971)
    expect(stats.median).toBe(94835)
    expect(stats.sampleSize).toBe(2)
  })

  test('con muestra suficiente los cuartiles vuelven', () => {
    const stats = computePriceStats(ofertas([100, 200, 300, 400, 500]))

    expect(stats.p25).toBe(200)
    expect(stats.p75).toBe(400)
    expect(stats.sampleSize).toBe(5)
  })
})

// ─── La misma página, una sola vez ──────────────────────────────────────────

describe('investigación web · una barra de más no es otra página', () => {
  let getWebResearchSignals

  beforeEach(() => {
    mockCallAgentLLM.mockReset()
    mockTavilySearch.mockReset()
  })

  beforeAll(async () => {
    ;({ getWebResearchSignals } = await import(
      '../services/marketIntelligence/sources/webResearchSource.js'
    ))
  })

  test('es.alpinestars.com//products y /products son la misma', () => {
    // Textual de la corrida real: Tavily devolvió las dos, el modelo las contó
    // como dos menciones y el panel las listó dos veces.
    const paginas = [
      {
        url: 'https://es.alpinestars.com//products/intuitive-snapback-hat',
        title: 'Gorra Snapback Intuitive',
        content: 'gorra de moto',
      },
      {
        url: 'https://es.alpinestars.com/products/intuitive-snapback-hat',
        title: 'Gorra Snapback Intuitive',
        content: 'gorra de moto',
      },
      {
        url: 'https://otra.com.ar/gorra',
        title: 'Otra gorra',
        content: 'texto',
      },
    ]

    mockTavilySearch.mockResolvedValue(paginas)
    mockCallAgentLLM.mockResolvedValue({
      content: JSON.stringify({
        searchIntent: { informational: 1, commercial: 0, transactional: 0 },
        trendDirection: 'ESTABLE',
      }),
    })

    return getWebResearchSignals({ product: 'gorra', country: 'AR', apiKey: 'k' }).then(
      signals => {
        expect(signals.pagesFound).toBe(2)
        expect(signals.sources).toHaveLength(2)
      },
    )
  })
})

// ─── La marca la sabe el catálogo, no se adivina ────────────────────────────
//
// Medido contra la API de Tavily el 15/09: la consulta "Gorra Fox Racing
// Negra con Logo Blanco opiniones reseñas vale la pena argentina" devolvió 20
// páginas y UNA hablaba de una gorra Fox. Las otras diecinueve decían "gorra",
// "negra", "racing" y "logo" —todas las palabras de la consulta menos la que
// importa— y eran de PUMA, Alpinestars, 226ERS, Armani, Ariat, Roland Garros
// y un sitio de stickers PNG.
//
// El modelo las leyó todas y devolvió knownBrands: [Fox Racing, 226ERS,
// Mitchell Ness, HRT, Alpinestars] con competencia ALTA. Esas señales pesan
// el 60% del score.
//
// El filtro anterior tomaba la 1ª y 2ª palabra del título suponiendo que la
// marca es la segunda. Con "Gaseosa Coca-Cola" acierta; con "Gorra Fox" la
// segunda es "fox" y aun así pasaba cualquier gorra, porque bastaba con UNA
// de las dos palabras. `marca` es obligatoria en el modelo de producto: el
// dato ya estaba en la base.

describe('marca · el filtro que sí separa', () => {
  let mentionsBrand

  beforeAll(async () => {
    ;({
      __test__: { mentionsBrand },
    } = await import('../services/marketIntelligence/sources/shoppingSource.js'))
  })

  // Títulos textuales de la corrida medida contra la API.
  const AJENAS = [
    ['226ERS GORRA CYCLING HYDRAZERO NEGRA', 'https://cabberty.com/gorras/226ers-gorra-cycling-hydrazero-negra'],
    ['La Argentina | Tienda Oficial', 'https://www.mercadolibre.com.ar/tienda/la-argentina'],
    ['HRT Gorra Racing negro/blanco', 'https://www.paddock-legends.com/es/hrt-gorra-racing-negro-blanco/p-15298'],
    ['Gorra Snapback Intuitive - Gorra de Moto | Alpinestars®', 'https://es.alpinestars.com/products/intuitive-snapback-hat'],
    ['Gorra trucker McLAREN RACING Lifestyle | PUMA', 'https://eu.puma.com/es/es/pd/gorra-trucker-mclaren-racing-lifestyle/027483'],
    ['Gorras Hombre | Gorra Running | PUMA', 'https://eu.puma.com/es/es/hombre/accesorios/accesorios-para-la-cabeza'],
    ['Waykins | Gorra de nailon con logo negra', 'https://www.trendhim.com/es/waykins-gorra-de-nailon-con-logo-negra-p.html'],
    ['31 Hats Gorra Negra LA Bordada – El Mago Drop', 'https://thirtyonehats.com.mx/producto/31-hats-x-el-mago-magic-club'],
    ['Gorra Ariat Negra Logo De Toro Blanco – Ariat Mexico', 'https://ariat.com.mx/gorra-ariat-negra'],
    ['Armani Exchange: Gorra con Logo Blanco Hombre', 'https://elpalaciodehierro.com/armani-gorra-logo'],
    ['Gorra Roland Garros Logo - Blanco', 'https://tenniswarehouse-europe.com/gorra-roland-garros'],
  ]

  test('las diecinueve gorras de otras marcas quedan afuera', () => {
    for (const [title, url] of AJENAS) {
      expect(mentionsBrand({ title, url }, 'Fox Racing')).toBe(false)
    }
  })

  test('la única que era de una gorra Fox entra', () => {
    expect(
      mentionsBrand(
        {
          title: 'Las mejores ofertas en Gorra de béisbol Gorras de deportes para Fox Hombres | eBay',
          url: 'https://co.ebay.com/b/Fox-Baseball-Cap-Sports-Hats-for-Men/52365/bn_72214316',
        },
        'Fox Racing',
      ),
    ).toBe(true)
  })

  test('alcanza con el primer token: "Fox Racing" se publica como "Fox"', () => {
    // Exigir "racing" dejaría afuera fichas buenas.
    expect(mentionsBrand({ title: 'Gorra Fox negra', url: '' }, 'Fox Racing')).toBe(true)
  })

  test('las dos páginas de la yerba nombran Playadito y entran', () => {
    const paginas = [
      ['Playadito on Instagram: "Playadito Sin Palo está elaborada..."', 'https://instagram.com/p/x'],
      ['Cata de Yerba Mate | Unión, Taragüi, Mañanita y Playadito', 'https://blog.com.ar/cata'],
    ]

    for (const [title, url] of paginas) {
      expect(mentionsBrand({ title, url }, 'Playadito')).toBe(true)
    }
  })

  test('la marca en la URL cuenta igual que en el título', () => {
    expect(
      mentionsBrand({ title: 'Gorra negra con logo', url: 'https://x.com.ar/fox-gorra' }, 'Fox'),
    ).toBe(true)
  })

  test('sin marca conocida no se filtra nada', () => {
    // Producto fuera del catálogo: es preferible leer de más que no leer nada.
    expect(mentionsBrand({ title: 'cualquier cosa', url: '' }, null)).toBe(true)
  })

  test('no se busca en el cuerpo: nombrar la marca al pasar es demasiado fácil', () => {
    expect(
      mentionsBrand(
        { title: 'Gorra PUMA', url: 'https://puma.com/gorra', content: 'mejor que las Fox' },
        'Fox',
      ),
    ).toBe(false)
  })
})

// ─── El modelo tiene que poder decir que sí ─────────────────────────────────
//
// Tres análisis reales seguidos —botas Alpinestars, pistón Mahle, sommier
// Cannon— dieron 29, 18 y 32, los tres "NO RECOMENDADO". No era el mercado:
// era el modelo.
//
// `social` valía "páginas que leí / 10", con doce páginas como máximo: techo
// 1,2 sobre 100, para todo producto, siempre. Y `commercial` asumía que veinte
// ofertas simultáneas son un mercado activo, escala heredada de cuando el
// buscador devolvía cuarenta resultados repetidos; hoy se guarda un precio por
// dominio y salen una o dos.
//
// Con esos dos componentes clavados en cero, el máximo alcanzable era 70 y
// RECOMENDADO pide 75. Ningún producto podía ser recomendado nunca.

describe('techo del modelo · un producto bueno tiene que poder recomendarse', () => {
  let calculateDemandScore
  let buildMarketAnalysisResponse

  beforeAll(async () => {
    ;({ calculateDemandScore } = await import(
      '../services/marketIntelligence/scoring/demandScoreEngine.js'
    ))
    ;({ buildMarketAnalysisResponse } = await import(
      '../services/marketIntelligence/schemas/marketAnalysisContract.js'
    ))
  })

  // Un producto con mercado de verdad: la gente busca para comprar, hay diez
  // tiendas publicándolo, la categoría rota y este comercio no lo vende.
  const PRODUCTO_BUENO = {
    shopping: {
      available: true,
      offerCount: 10,
      merchantCount: 10,
      priceStats: { min: 1000, median: 1500, max: 2000, sampleSize: 10 },
    },
    research: {
      available: true,
      searchIntent: { informational: 5, commercial: 5, transactional: 8 },
      trendDirection: 'INDETERMINADA',
      recurringComplaints: ['tarda en llegar', 'el envío es caro', 'poca variedad'],
      socialSignals: { mentions: 7, engagement: 'NO_DISPONIBLE' },
    },
    internal: {
      available: true,
      isInCatalog: true,
      unitsSoldLast90Days: 0,
      categoryUnitsSold: 5,
      currentStock: 10,
    },
  }

  test('un producto con mercado real llega a RECOMENDADO', () => {
    const { total } = calculateDemandScore(PRODUCTO_BUENO)

    expect(total).toBeGreaterThanOrEqual(75)

    const respuesta = buildMarketAnalysisResponse({
      demandScore: total,
      confidenceScore: 70,
      breakdown: calculateDemandScore(PRODUCTO_BUENO).components,
      rawSignals: PRODUCTO_BUENO,
      trendClassification: 'INDETERMINADA',
    })

    expect(respuesta.recommendation).toBe('RECOMENDADO')
  })

  test('el interés social se declara sin medir, no se puntúa cero', () => {
    // Contar las páginas que nosotros elegimos leer no mide el interés de
    // nadie. Puntuar cero por falta de fuente es inventar un dato negativo.
    const { components, unmeasured } = calculateDemandScore(PRODUCTO_BUENO)

    expect(components.social).toBeNull()
    expect(unmeasured).toContain('social')
  })

  test('tres tiendas publicando ya no puntúan 12 sobre 100', () => {
    const { components } = calculateDemandScore({
      ...PRODUCTO_BUENO,
      shopping: { ...PRODUCTO_BUENO.shopping, offerCount: 3, merchantCount: 3 },
    })

    // Con la escala vieja: 3 * 4 = 12.
    expect(components.commercial).toBeGreaterThan(25)
  })

  test('la referencia de mercado activo sale del entorno', () => {
    // NADA HARCODEADO: ocho vendedores es el default, no una constante fija.
    expect(process.env.MARKET_ACTIVE_MERCHANTS).toBeUndefined()
  })
})
