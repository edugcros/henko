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

    expect(sources.map(s => s.key)).toEqual(['shopping', 'gemini', 'internal'])
    expect(sources.find(s => s.key === 'shopping').detail).toMatch(/8 ofertas de 7 vendedores/i)
    expect(sources.find(s => s.key === 'internal').detail).toMatch(/catálogo/i)
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
