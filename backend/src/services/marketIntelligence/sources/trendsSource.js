/**
 * trendsSource.js
 *
 * Interés de búsqueda real, 12 meses, por país: Google Trends a través del
 * mismo proveedor de scraping que ya sirve los precios.
 *
 * POR QUÉ EXISTE
 *
 * La demanda y la tendencia salían únicamente de la búsqueda con IA, que
 * necesita el tool de Google Search — y ese tool tiene cuota propia, aparte de
 * los tokens del modelo. Comprobado contra la API con la key de producción: la
 * misma llamada sin `tools` devuelve 200 y con `tools` devuelve 429, en todos
 * los modelos, en v1 y en v1beta, y una herramienta inventada devuelve 400, así
 * que el pedido está bien formado y lo que falta es cupo. Con esa cuota agotada
 * el análisis perdía el 50% del modelo de scoring y no podía contestar la
 * pregunta para la que existe.
 *
 * Trends no depende de esa cuota y trae algo que la IA no puede dar: una serie
 * histórica. El clasificador de tendencia documentaba desde el principio que
 * sin serie no podía emitir sus etiquetas — ahora sí.
 *
 * LO QUE ESTE DATO NO ES
 *
 * El índice de Trends es RELATIVO al propio término: 100 es el mejor momento de
 * esa búsqueda, no un volumen absoluto. Un producto que busca poca gente puede
 * marcar 100. Por eso de acá sale la dirección —que sí es comparable contra sí
 * misma— y un aporte de demanda topeado, nunca un "demanda excepcional".
 *
 * Y una serie vacía tampoco se lee como "no hay demanda". Google no publica
 * series para términos sin volumen suficiente y no documenta su umbral, así que
 * puede significar que casi nadie lo busca o que el término seguía siendo
 * demasiado específico. Se informa como no medido.
 */

import axios from 'axios'

import logger from '../../../../config/logger.js'

const REQUEST_TIMEOUT_MS = 20000
const WINDOW_WEEKS = 4

/** Cambio mínimo para no llamarlo "estable". */
const DIRECTION_THRESHOLD_PERCENT = 15

/** Desvío relativo desde el que la serie se considera errática. */
const VOLATILITY_THRESHOLD = 0.6

const SUPPORTED_GEOS = new Set(['AR', 'MX', 'CL', 'CO', 'UY', 'PE', 'BR'])

/** Cuántas palabras conserva la consulta. Verificado contra Trends: con el
 * título completo la serie viene vacía SIEMPRE —nadie escribe en Google
 * "Gaseosa Coca-Cola Original Taste Botella 2.25L Pack x6"— y con tres
 * palabras hay serie. */
const QUERY_WORDS = 3

/** Palabras que describen presentación o variante, no lo que se busca. */
const NOISE_WORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'por', 'y', 'o',
  'a', 'en', 'un', 'una', 'al', 'su', 'x', 'talle', 'talles', 'medida',
  'medidas', 'color', 'colores', 'pack', 'unidad', 'unidades', 'combo', 'set',
  'kit', 'modelo', 'nuevo', 'nueva', 'original', 'importado', 'oferta',
  'promo', 'envio', 'gratis', 'cuotas', 'negro', 'blanco', 'rojo', 'azul',
  'verde', 'gris', 'amarillo', 'rosa', 'marron', 'beige', 'bicolor',
])

/**
 * Del título del producto a algo que una persona escribiría en Google.
 *
 * Se descartan las palabras de presentación y todo lo que sea número o medida
 * (2.25l, 1kg, 43, zx-10r), y se conservan las primeras que quedan.
 */
export function buildTrendQueries(product) {
  const tokens = String(product || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !NOISE_WORDS.has(word))
    .filter(word => !/\d/.test(word))
    .filter(word => word.length > 2)

  if (tokens.length === 0) return []

  const principal = tokens.slice(0, QUERY_WORDS).join(' ')

  // Segundo intento sin la palabra más genérica, que suele ser la primera:
  // "motocicleta kawasaki ninja" no tiene serie y "kawasaki ninja" sí.
  const alternativa =
    tokens.length >= 3
      ? tokens.slice(1, QUERY_WORDS).join(' ')
      : tokens.slice(0, 2).join(' ')

  return [...new Set([principal, alternativa].filter(q => q && q.length > 2))]
}

const round = (value, decimals = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

const average = values =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {string} params.country - ISO-2
 * @returns {Promise<TrendsSignals>}
 *
 * @typedef {Object} TrendsSignals
 * @property {boolean} available
 * @property {boolean} hasVolume      - false = Google no publica serie para ese término (no medido)
 * @property {string} direction       - CRECIENTE | ESTABLE | DECRECIENTE | INDETERMINADA
 * @property {number} changePercent   - últimas 4 semanas contra las 4 anteriores
 * @property {number} vsYearPercent   - últimas 4 semanas contra el promedio del año
 * @property {number} weeksWithInterest - proporción de semanas con búsquedas
 * @property {Array} points           - serie recortada, para mostrar en el panel
 */
export async function getTrendsSignals({ product, country }) {
  // Esta serie sale de Google Trends a través de scrape.do. Tavily, que
  // reemplazó a scrape.do en los precios, NO tiene nada equivalente: devuelve
  // páginas con su texto, y de ahí no sale una serie de 52 semanas.
  //
  // Se podría contar cuántas notas se publicaron por mes y llamarlo "interés",
  // pero eso mide cobertura de prensa, no gente buscando. Ponerle nombre de
  // demanda a otra cosa es exactamente lo que esta pantalla dejó de hacer, así
  // que cuando el proveedor de tendencias está apagado se informa como no
  // medido y el panel lo dice.
  const provider = (process.env.TRENDS_PROVIDER || process.env.SHOPPING_PROVIDER || 'scrapedo')
    .trim()
    .toLowerCase()

  if (provider !== 'scrapedo') {
    return {
      available: false,
      reason: `NO_DISPONIBLE: el proveedor "${provider}" no publica series de interés de búsqueda`,
    }
  }

  const apiKey = String(process.env.SCRAPEDO_API_KEY || '').trim()

  if (!apiKey) {
    return { available: false, reason: 'NO_DISPONIBLE: el buscador de tendencias no está configurado' }
  }

  const geo = String(country || '').toUpperCase()

  if (!SUPPORTED_GEOS.has(geo)) {
    return { available: false, reason: `NO_DISPONIBLE: país ${geo} sin tendencias configuradas` }
  }

  const queries = buildTrendQueries(product)

  if (queries.length === 0) {
    return { available: false, reason: 'NO_DISPONIBLE: el texto buscado no tiene palabras con las que consultar tendencias' }
  }

  let points = []
  let query = queries[0]

  for (const candidate of queries) {
    let data

    try {
      const response = await axios.get('https://api.scrape.do/plugin/google/trends', {
        params: { token: apiKey, q: candidate, geo, hl: 'es', date: 'today 12-m' },
        timeout: REQUEST_TIMEOUT_MS,
      })

      data = response.data
    } catch (error) {
      logger.warn('[trendsSource] Google Trends no respondió', {
        status: error?.response?.status,
        message: error.message,
      })

      return { available: false, reason: 'NO_DISPONIBLE: el buscador de tendencias no respondió' }
    }

    points = normalizePoints(data?.interest_over_time?.timeline_data)
    query = candidate

    if (points.length > 0) break
  }

  // Serie vacía después de probar las dos consultas.
  //
  // NO se puntúa como demanda baja. Google no documenta su umbral, y el
  // término puede seguir siendo demasiado específico aunque lo hayamos
  // acortado: afirmar "casi nadie lo busca" a partir de eso sería inventar un
  // dato negativo, que es exactamente lo que esta pantalla no puede hacer.
  // Queda como no medido y se dice en pantalla.
  if (points.length === 0) {
    return {
      available: true,
      hasVolume: false,
      geo,
      query,
      direction: 'INDETERMINADA',
      changePercent: null,
      vsYearPercent: null,
      weeksWithInterest: 0,
      points: [],
    }
  }

  const values = points.map(p => p.value)

  const recent = values.slice(-WINDOW_WEEKS)
  const prior = values.slice(-WINDOW_WEEKS * 2, -WINDOW_WEEKS)

  const recentAvg = average(recent)
  const priorAvg = average(prior)
  const yearAvg = average(values)

  // Contra cero no hay porcentaje que calcular: pasar de nada a algo no es
  // "+100%", es demanda nueva, y decir un número sería inventarle una base.
  const changePercent =
    priorAvg > 0 ? round(((recentAvg - priorAvg) / priorAvg) * 100) : null

  const vsYearPercent =
    yearAvg > 0 ? round(((recentAvg - yearAvg) / yearAvg) * 100) : null

  const weeksWithInterest = round(
    values.filter(v => v > 0).length / values.length,
    2,
  )

  return {
    available: true,
    hasVolume: true,
    geo,
    // Con qué se consultó, porque no es el título del producto: el comerciante
    // tiene que poder juzgar si el término representa lo que vende.
    query,
    weeks: values.length,
    recentAverage: round(recentAvg),
    priorAverage: round(priorAvg),
    yearAverage: round(yearAvg),
    peak: Math.max(...values),
    changePercent,
    vsYearPercent,
    weeksWithInterest,
    volatility: round(coefficientOfVariation(values), 2),
    direction: classifyDirection({ changePercent, values }),
    // Las últimas 12 semanas alcanzan para que se vea la forma en el panel sin
    // mandar 54 puntos por cada análisis.
    points: points.slice(-12),
  }
}

function normalizePoints(timeline) {
  if (!Array.isArray(timeline)) return []

  return timeline
    .map(point => {
      const raw = point?.values?.[0]
      const value = Number(raw?.extracted_value ?? raw?.value)

      if (!Number.isFinite(value)) return null

      return { date: String(point?.date || ''), value }
    })
    .filter(Boolean)
}

/**
 * La dirección sale del cambio entre las últimas cuatro semanas y las cuatro
 * anteriores, no de la última semana suelta: una semana puede moverse por un
 * feriado o por un pico de noticias.
 */
function classifyDirection({ changePercent, values }) {
  if (changePercent === null) return 'INDETERMINADA'

  // Una serie que salta sin patrón no es "creciente" aunque las últimas cuatro
  // semanas hayan subido: es errática, y decir lo contrario sería más
  // afirmación de la que el dato sostiene.
  if (coefficientOfVariation(values) > VOLATILITY_THRESHOLD) return 'VOLATIL'

  if (changePercent >= DIRECTION_THRESHOLD_PERCENT) return 'CRECIENTE'
  if (changePercent <= -DIRECTION_THRESHOLD_PERCENT) return 'DECRECIENTE'

  return 'ESTABLE'
}

function coefficientOfVariation(values) {
  const mean = average(values)
  if (mean <= 0) return 0

  const variance = average(values.map(v => (v - mean) ** 2))
  return Math.sqrt(variance) / mean
}
