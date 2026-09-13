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

/** Suba desde la que el crecimiento deja de ser "crecimiento" y es un salto. */
const EXPLOSIVE_CHANGE_PERCENT = 100

/**
 * @param {Object} rawSignals
 * @returns {string} Una de las claves de TREND_LABELS
 *
 * Con la serie de Google Trends ya se pueden emitir EXPLOSIVA y VOLATIL, que
 * antes estaban documentadas como imposibles: la búsqueda con IA daba una foto
 * del momento y estas etiquetas necesitan histórico.
 *
 * ESTACIONAL sigue sin emitirse. Detectar estacionalidad pide comparar el mismo
 * mes contra años anteriores, y la serie que traemos es de 12 meses: alcanza
 * para ver un pico, no para saber si ese pico se repite todos los años.
 */
function classifyTrend(rawSignals) {
  const trends = rawSignals.trends

  if (trends?.available && trends.hasVolume !== false) {
    if (trends.direction === 'VOLATIL') return 'VOLATIL'

    const change = Number(trends.changePercent)

    if (Number.isFinite(change) && change >= EXPLOSIVE_CHANGE_PERCENT) {
      return 'EXPLOSIVA'
    }

    if (trends.direction && trends.direction !== 'INDETERMINADA') {
      return trends.direction
    }
  }

  const direction = rawSignals.gemini?.trendDirection

  if (!direction || direction === 'INDETERMINADA') return 'INDETERMINADA'
  if (direction === 'CRECIENTE') return 'CRECIENTE' // TODO: promover a EXPLOSIVA si Google Trends muestra pendiente pronunciada
  if (direction === 'ESTABLE') return 'ESTABLE'
  if (direction === 'DECRECIENTE') return 'DECRECIENTE'

  return 'INDETERMINADA'
}

export { classifyTrend, TREND_LABELS }
