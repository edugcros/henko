/**
 * confidenceCalculator.js
 *
 * Sección 15 del spec: un score alto con confianza baja debe mostrarse
 * explícitamente como tal.
 *
 * La confianza ahora depende también de measuredWeight — qué proporción del
 * modelo de scoring se pudo evaluar realmente. Un score calculado sobre el
 * 10% del modelo (solo BI interna, con MELI y Gemini caídos) no puede
 * reportar la misma confianza que uno calculado sobre el 100%.
 */

const TOTAL_SOURCES = 3 // meli, gemini, internal

/**
 * @param {Object} rawSignals - { meli, gemini, internal }
 * @param {number} measuredWeight - 0..1, proporción del modelo evaluable
 * @returns {number} 0-100
 */
export function calculateConfidence(rawSignals, measuredWeight = 0) {
  const availableSources = [rawSignals.meli, rawSignals.gemini, rawSignals.internal]
    .filter(s => s?.available).length

  // Cobertura del modelo: es la señal más honesta de cuánto sabemos.
  const modelCoverageScore = measuredWeight * 45

  const sourceCoverageScore = (availableSources / TOTAL_SOURCES) * 25

  const hasQuantitativeData = rawSignals.meli?.available && rawSignals.meli?.priceRange != null
  const quantitativeBonus = hasQuantitativeData ? 15 : 0

  const consistencyBonus = checkConsistency(rawSignals) ? 15 : 0

  return Math.round(modelCoverageScore + sourceCoverageScore + quantitativeBonus + consistencyBonus)
}

/**
 * Señal contradictoria entre fuentes: mucha actividad en MELI pero tendencia
 * decreciente según Gemini. No promediamos ciegamente — bajamos confianza.
 */
function checkConsistency(rawSignals) {
  const trend = rawSignals.gemini?.trendDirection
  const sellerCount = rawSignals.meli?.sellerCount

  if (trend == null || sellerCount == null) return false

  const strongMeliActivity = sellerCount >= 10
  const contradictory = strongMeliActivity && trend === 'DECRECIENTE'

  return !contradictory
}
