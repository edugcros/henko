/**
 * trendClassifier.js
 *
 * Clasifica la tendencia según sección 6 del spec original. Lógica pura,
 * separada del score numérico para que la etiqueta (🚀/📈/➡️/📉/🔄/⚠️/❓)
 * pueda evolucionar sin tocar demandScoreEngine.js.
 */

/**
 * Solo las etiquetas que alguna fuente puede emitir hoy.
 *
 * EXPLOSIVA, ESTACIONAL y VOLÁTIL necesitan una serie histórica. Existieron
 * mientras Google Trends fue fuente; sin ella, dejarlas declaradas es prometer
 * una clasificación que el clasificador nunca devuelve.
 */
const TREND_LABELS = {
  CRECIENTE: '📈 CRECIENTE',
  ESTABLE: '➡️ ESTABLE',
  DECRECIENTE: '📉 DECRECIENTE',
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
  const direction = rawSignals.research?.trendDirection

  if (!direction || direction === 'INDETERMINADA') return 'INDETERMINADA'
  if (direction === 'CRECIENTE') return 'CRECIENTE'
  if (direction === 'ESTABLE') return 'ESTABLE'
  if (direction === 'DECRECIENTE') return 'DECRECIENTE'

  return 'INDETERMINADA'
}

export { classifyTrend, TREND_LABELS }
