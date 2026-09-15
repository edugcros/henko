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
import { classifyTrend } from '../services/marketIntelligence/scoring/trendClassifier.js'
import { buildTrendQueries } from '../services/marketIntelligence/sources/trendsSource.js'
import { buildMarketAnalysisResponse } from '../services/marketIntelligence/schemas/marketAnalysisContract.js'

const CUOTA_AGOTADA =
  'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.'

/** Producción, tal cual: buscador con datos, IA sin cuota, tienda con una venta. */
const señalesReales = (extra = {}) => ({
  meli: { available: false, retired: true },
  shopping: {
    available: true,
    provider: 'scrapedo',
    offerCount: 8,
    merchantCount: 7,
    priceStats: { min: 4450, p25: 4786, median: 8000, p75: 20060, max: 30600, currency: 'ARS', sampleSize: 8 },
    offers: [],
  },
  gemini: { available: false, error: CUOTA_AGOTADA },
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
        gemini: {
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
    const ia = sources.find(s => s.key === 'gemini')

    expect(ia.available).toBe(false)
    expect(ia.detail).not.toMatch(/quota|billing/i)
    expect(ia.detail).toMatch(/límite de consultas/i)
  })

  test('cada fuente dice qué aporta y qué contestó', () => {
    const { sources } = respuesta()

    expect(sources.map(s => s.key)).toEqual([
      'shopping',
      'trends',
      'gemini',
      'internal',
    ])
    expect(sources.find(s => s.key === 'shopping').detail).toMatch(/8 ofertas de 7 vendedores/i)
    expect(sources.find(s => s.key === 'internal').detail).toMatch(/catálogo/i)
  })

  test('la cuota de búsqueda no se confunde con la de tokens', () => {
    // Es el caso real: la clave tiene tokens —el análisis de imágenes anda—
    // pero la búsqueda con Google, que se mide aparte, está agotada.
    const { sources } = respuesta(
      señalesReales({
        gemini: {
          available: false,
          code: 'AI_GROUNDING_QUOTA',
          error: 'You exceeded your current quota, please check your plan and billing details.',
        },
      }),
    )

    const ia = sources.find(s => s.key === 'gemini')

    expect(ia.detail).toMatch(/búsquedas en Google/i)
    expect(ia.detail).toMatch(/aparte de los tokens/i)
  })

  test('un modelo dado de baja manda a donde se cambia', () => {
    const { sources } = respuesta(
      señalesReales({
        gemini: {
          available: false,
          error: 'This model models/gemini-2.5-flash-lite is no longer available to new users.',
        },
      }),
    )

    expect(sources.find(s => s.key === 'gemini').detail).toMatch(
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

jest.unstable_mockModule('../services/aiAgent/aiAgentLLMService.js', () => ({
  callAgentLLM: mockCallAgentLLM,
  callAgentLLMForRepair: jest.fn(),
}))

describe('búsqueda con IA · el segundo paso no puede tirar el primero', () => {
  let getGroundingSignals

  const TEXTO_GROUNDED = 'El mercado de cascos en Argentina crece.'

  const SENALES = {
    searchIntent: { informational: 3, commercial: 4, transactional: 5 },
    trendDirection: 'CRECIENTE',
  }

  const respuestaDeBusqueda = () => ({
    content: TEXTO_GROUNDED,
    groundingMetadata: {
      groundingChunks: [{ web: { uri: 'https://ejemplo.com', title: 'Ejemplo' } }],
    },
    usageMetadata: { totalTokenCount: 4359 },
  })

  beforeAll(async () => {
    ({ getGroundingSignals } = await import(
      '../services/marketIntelligence/sources/geminiGroundingSource.js'
    ))
  })

  beforeEach(() => {
    mockCallAgentLLM.mockReset()
  })

  test('el JSON envuelto en un bloque de código se recupera igual', async () => {
    mockCallAgentLLM
      .mockResolvedValueOnce(respuestaDeBusqueda())
      .mockResolvedValueOnce({
        content: '```json\n' + JSON.stringify(SENALES) + '\n```',
        usageMetadata: { totalTokenCount: 200 },
      })

    const signals = await getGroundingSignals({
      product: 'casco',
      country: 'AR',
      apiKey: 'k',
    })

    expect(signals.available).toBe(true)
    expect(signals.trendDirection).toBe('CRECIENTE')
    expect(signals.sources).toHaveLength(1)
  })

  test('la búsqueda no comparte el tope de salida del agente de ventas', async () => {
    // El tope global es 1200 tokens: alcanza para una respuesta de WhatsApp y
    // no para un informe de seis puntos escrito por un modelo que además
    // razona con ese mismo presupuesto.
    mockCallAgentLLM
      .mockResolvedValueOnce(respuestaDeBusqueda())
      .mockResolvedValueOnce({ content: JSON.stringify(SENALES) })

    await getGroundingSignals({ product: 'casco', country: 'AR', apiKey: 'k' })

    expect(mockCallAgentLLM.mock.calls[0][0].maxOutputTokens).toBeGreaterThanOrEqual(2000)
  })

  test('el segundo paso no gasta la salida en razonar', async () => {
    // Con el presupuesto por defecto, un modelo "thinking" corta el JSON por
    // MAX_TOKENS a mitad de camino. Este paso no razona: reordena.
    mockCallAgentLLM
      .mockResolvedValueOnce(respuestaDeBusqueda())
      .mockResolvedValueOnce({ content: JSON.stringify(SENALES) })

    await getGroundingSignals({ product: 'casco', country: 'AR', apiKey: 'k' })

    expect(mockCallAgentLLM.mock.calls[1][0]).toMatchObject({ thinkingBudget: 1 })
  })

  test('si el JSON no se recupera, el texto buscado vuelve igual', async () => {
    mockCallAgentLLM
      .mockResolvedValueOnce(respuestaDeBusqueda())
      .mockResolvedValueOnce({ content: 'perdón, no puedo' })

    const signals = await getGroundingSignals({
      product: 'casco',
      country: 'AR',
      apiKey: 'k',
    })

    expect(signals.available).toBe(false)
    expect(signals.groundedText).toBe(TEXTO_GROUNDED)
    expect(signals.sources).toHaveLength(1)
    // Y los tokens del paso 1 se siguen cobrando: ya se gastaron.
    expect(signals.tokensUsed).toBeGreaterThan(0)
  })
})

// ─── Interés de búsqueda medido ─────────────────────────────────────────────
//
// La demanda y la tendencia dependían de la búsqueda con IA, que necesita el
// tool de Google Search — y ese tool tiene cuota propia, agotada. Google Trends
// entra por otra puerta: 12 meses de interés real, semana a semana, sin esa
// cuota. Es además la serie histórica que el clasificador de tendencia
// documentaba como faltante desde el principio.

const serie = valores =>
  valores.map((value, i) => ({ date: `sem ${i + 1}`, value }))

const conTendencia = (extra = {}) => ({
  available: true,
  hasVolume: true,
  geo: 'AR',
  query: 'campera cuero',
  weeks: 12,
  changePercent: 30,
  vsYearPercent: 10,
  weeksWithInterest: 1,
  volatility: 0.1,
  direction: 'CRECIENTE',
  points: serie([40, 42, 41, 43, 44, 45, 46, 48, 50, 52, 54, 56]),
  ...extra,
})

describe('consulta a tendencias · no se busca el título completo', () => {
  test('del título sale algo que una persona escribiría en Google', () => {
    // Verificado contra Trends: con el título entero la serie viene vacía
    // siempre; con tres palabras hay 54 semanas de datos.
    expect(buildTrendQueries('Gaseosa Coca-Cola Original Taste Botella 2.25L Pack x 6')[0]).toBe(
      'gaseosa coca cola',
    )
    expect(buildTrendQueries('botas cuero talle 43 color negro')[0]).toBe('botas cuero')
  })

  test('el segundo intento suelta la palabra genérica del principio', () => {
    // "motocicleta kawasaki ninja" no tiene serie; "kawasaki ninja" sí.
    const [principal, alternativa] = buildTrendQueries('Motocicleta Kawasaki Ninja ZX-10R')

    expect(principal).toBe('motocicleta kawasaki ninja')
    expect(alternativa).toBe('kawasaki ninja')
  })

  test('un texto sin palabras útiles no consulta nada', () => {
    expect(buildTrendQueries('2.25 43 x6')).toEqual([])
  })
})

describe('puntaje · la tendencia se mide con la serie, no con una opinión', () => {
  test('la serie manda sobre la lectura del modelo', () => {
    const { components } = calculateDemandScore(
      señalesReales({
        trends: conTendencia({ direction: 'DECRECIENTE' }),
        gemini: { available: true, trendDirection: 'CRECIENTE' },
      }),
    )

    expect(components.trend).toBe(20)
  })

  test('con la IA sin cupo, la demanda deja de estar sin medir', () => {
    const { components, measuredWeight } = calculateDemandScore(
      señalesReales({ trends: conTendencia() }),
    )

    expect(components.demand).not.toBeNull()
    // Topeado: el índice de Trends es relativo al término, no un volumen.
    expect(components.demand).toBeLessThanOrEqual(60)
    expect(measuredWeight).toBeGreaterThanOrEqual(0.9)
  })

  test('sin serie no se afirma que nadie lo busca', () => {
    // Google no publica series para términos con poco volumen y no documenta
    // su umbral: puntuar eso como demanda baja sería inventar un dato negativo.
    const { components } = calculateDemandScore(
      señalesReales({
        trends: { available: true, hasVolume: false, query: 'x', direction: 'INDETERMINADA' },
      }),
    )

    expect(components.demand).toBeNull()
    expect(components.trend).toBeNull()
  })

  test('la etiqueta VOLÁTIL ya se puede emitir, y EXPLOSIVA también', () => {
    // Las dos estaban documentadas como imposibles sin serie histórica.
    expect(classifyTrend(señalesReales({ trends: conTendencia({ direction: 'VOLATIL' }) }))).toBe(
      'VOLATIL',
    )

    expect(
      classifyTrend(señalesReales({ trends: conTendencia({ changePercent: 140 }) })),
    ).toBe('EXPLOSIVA')
  })

  test('tendencias cuenta como fuente para la confianza', () => {
    const conFuente = calculateConfidence(señalesReales({ trends: conTendencia() }), 0.9)
    const sinFuente = calculateConfidence(señalesReales(), 0.9)

    expect(conFuente).toBeGreaterThan(sinFuente)
  })
})

// ─── Tavily como proveedor de precios ───────────────────────────────────────
//
// scrape.do devolvía ofertas ya estructuradas (precio, vendedor, link). Tavily
// devuelve páginas con un fragmento de texto, así que el precio hay que
// encontrarlo ahí adentro — y ahí es donde este cambio se puede ir de las
// manos: un número mal leído entra directo a la mediana y a la tarjeta de
// rentabilidad.

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

describe('tendencias · sin proveedor que las publique se dice, no se inventa', () => {
  let getTrendsSignals

  beforeAll(async () => {
    ;({ getTrendsSignals } = await import(
      '../services/marketIntelligence/sources/trendsSource.js'
    ))
  })

  test('con Tavily configurado, la serie queda como no medida', async () => {
    const previo = process.env.SHOPPING_PROVIDER
    process.env.SHOPPING_PROVIDER = 'tavily'

    try {
      const signals = await getTrendsSignals({ product: 'campera de cuero', country: 'AR' })

      expect(signals.available).toBe(false)
      expect(signals.reason).toMatch(/no publica series/i)
    } finally {
      if (previo === undefined) delete process.env.SHOPPING_PROVIDER
      else process.env.SHOPPING_PROVIDER = previo
    }
  })
})
