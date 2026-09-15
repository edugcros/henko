/**
 * confidenceCalculator.js
 *
 * Sección 15 del spec: un score alto con confianza baja debe mostrarse
 * explícitamente como tal.
 *
 * La confianza depende de measuredWeight — qué proporción del modelo de
 * scoring se pudo evaluar realmente. Un score calculado sobre el 10% del
 * modelo no puede reportar la misma confianza que uno calculado sobre el 100%.
 *
 * LAS FUENTES QUE SE CUENTAN SON LAS QUE EXISTEN.
 *
 * Hasta la corrección de esta versión se contaban meli, gemini e internal.
 * MercadoLibre está retirado desde que cerró su API —siempre no disponible—,
 * y el buscador de precios, que es hoy la fuente externa que sí responde, no
 * se contaba. Con eso, el bonus cuantitativo (que miraba `meli.priceRange`) y
 * el chequeo de consistencia (que miraba `meli.sellerCount`) eran código
 * muerto: valían 0 siempre.
 *
 * El techo real quedaba en 45 × cobertura + 8,3 puntos. Los doce análisis de
 * producción reportaron todos 33/100 de confianza, y como el contrato marca
 * "DATOS INSUFICIENTES" por debajo de 40, la herramienta contestaba eso
 * siempre, tuviera los datos que tuviera.
 */

const TOTAL_SOURCES = 3 // shopping, gemini, internal

/** Con menos de esto, una mediana de precios describe anécdotas, no un mercado. */
const MIN_REPRESENTATIVE_SAMPLE = 5

/**
 * @param {Object} rawSignals - { shopping, gemini, internal }
 * @param {number} measuredWeight - 0..1, proporción del modelo evaluable
 * @returns {number} 0-100
 */
export function calculateConfidence(rawSignals, measuredWeight = 0) {
  const availableSources = [
    rawSignals.shopping,
    rawSignals.gemini,
    rawSignals.internal,
  ].filter(s => s?.available).length

  // Cobertura del modelo: es la señal más honesta de cuánto sabemos.
  const modelCoverageScore = measuredWeight * 45

  const sourceCoverageScore = (availableSources / TOTAL_SOURCES) * 25

  // Dato cuantitativo real: precios medidos sobre una muestra que alcanza.
  const sampleSize = Number(rawSignals.shopping?.priceStats?.sampleSize || 0)
  const quantitativeBonus = sampleSize >= MIN_REPRESENTATIVE_SAMPLE ? 15 : 0

  const consistencyBonus = checkConsistency(rawSignals) ? 15 : 0

  return Math.round(
    modelCoverageScore + sourceCoverageScore + quantitativeBonus + consistencyBonus,
  )
}

/**
 * Señal contradictoria entre fuentes: muchos vendedores publicando el producto
 * hoy, pero tendencia decreciente según lo que se leyó buscando. No se
 * promedia a ciegas — se baja la confianza.
 *
 * Sin las dos señales no hay contradicción que detectar, y tampoco confirmación
 * que premiar: el bonus se otorga solo cuando las dos existen y coinciden.
 */
function checkConsistency(rawSignals) {
  const trend = rawSignals.gemini?.trendDirection
  const merchantCount = rawSignals.shopping?.available
    ? Number(rawSignals.shopping.merchantCount || 0)
    : null

  if (!trend || trend === 'INDETERMINADA' || merchantCount === null) return false

  const strongMarketActivity = merchantCount >= 10
  const contradictory = strongMarketActivity && trend === 'DECRECIENTE'

  return !contradictory
}
