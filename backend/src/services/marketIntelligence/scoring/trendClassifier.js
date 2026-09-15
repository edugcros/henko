/**
 * trendClassifier.js
 *
 * Clasifica la tendencia según sección 6 del spec original. Lógica pura,
 * separada del score numérico para que la etiqueta (🚀/📈/➡️/📉/🔄/⚠️/❓)
 * pueda evolucionar sin tocar demandScoreEngine.js.
 */

const TREND_LABELS = {
  EXPLOSIVA: '🚀 EXPLOSIVA',
  CRECIENTE: '📈 CRECIENTE',
  ESTABLE: '➡️ ESTABLE',
  DECRECIENTE: '📉 DECRECIENTE',
  ESTACIONAL: '🔄 ESTACIONAL',
  VOLATIL: '⚠️ VOLÁTIL',
  INDETERMINADA: '❓ INDETERMINADA',
}

/**
 * @param {Object} rawSignals
 * @returns {string} Una de las claves de TREND_LABELS
 *
 * EXPLOSIVA, ESTACIONAL y VOLATIL necesitan una serie histórica, y hoy ninguna
 * fuente la provee: la búsqueda con IA da un snapshot puntual. Google Trends sí
 * la daba y llegó a habilitar EXPLOSIVA y VOLATIL, pero se fue con scrape.do.
 * Documentado para no fingir estas clasificaciones sin base.
 */
function classifyTrend(rawSignals) {
  const direction = rawSignals.gemini?.trendDirection

  if (!direction || direction === 'INDETERMINADA') return 'INDETERMINADA'
  if (direction === 'CRECIENTE') return 'CRECIENTE' // TODO: promover a EXPLOSIVA si Google Trends muestra pendiente pronunciada
  if (direction === 'ESTABLE') return 'ESTABLE'
  if (direction === 'DECRECIENTE') return 'DECRECIENTE'

  return 'INDETERMINADA'
}

export { classifyTrend, TREND_LABELS }
