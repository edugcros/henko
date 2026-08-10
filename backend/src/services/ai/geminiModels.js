import logger from '../../../config/logger.js'

/**
 * Resolución resiliente de modelos Gemini.
 *
 * Google retira modelos sin aviso: `gemini-2.5-flash-lite` devuelve 404
 * ("no longer available to new users") y `gemini-2.0-flash` devuelve 429 por
 * cuota agotada. Cuando el modelo vive en una variable de entorno, un retiro
 * rompe producción en silencio y sólo se arregla editando el dashboard.
 *
 * Este módulo mantiene una cadena de respaldos y recuerda, por proceso, qué
 * modelos ya se probaron muertos, para no volver a gastar latencia en ellos.
 */

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-flash-lite-latest']

/** Modelos que este proceso ya comprobó inservibles (404 / cuota agotada). */
const deadModels = new Set()

export const normalizeModelName = value =>
  String(value || '').trim().replace(/^models\//, '')

/**
 * Cadena de modelos a intentar, en orden de preferencia y sin los ya
 * descartados. Si todos murieron, devolvemos los respaldos igual para que la
 * llamada falle contra la API con un error real en vez de con una lista vacía.
 */
export const getModelChain = (...preferred) => {
  const chain = [...preferred, ...FALLBACK_MODELS]
    .map(normalizeModelName)
    .filter(Boolean)

  const unique = [...new Set(chain)]
  const alive = unique.filter(model => !deadModels.has(model))

  return alive.length > 0 ? alive : unique
}

/** ¿El fallo indica que el modelo no sirve y conviene pasar al siguiente? */
export const isModelUnavailable = (status, body = '') => {
  if (status === 404) return true
  if (status === 400 && /not found|not supported/i.test(body)) return true
  if (status === 429 && /quota|billing|plan/i.test(body)) return true
  return false
}

/**
 * Igual que isModelUnavailable pero a partir del error crudo. Cada capa reporta
 * el status distinto: fetch usa response.status, el SDK de Google expone
 * `.status` y además embebe "[404 Not Found]" en el mensaje.
 */
export const isModelUnavailableError = error => {
  if (!error) return false

  const message = String(error.message || '')
  const fromMessage = Number(message.match(/\[(\d{3})\s/)?.[1])

  const status =
    error.status ??
    error.statusCode ??
    (Number.isFinite(fromMessage) ? fromMessage : undefined)

  if (isModelUnavailable(status, message)) return true

  return /no longer available|not found for api version|is not supported/i.test(message)
}

export const markModelDead = (model, reason) => {
  const name = normalizeModelName(model)
  if (!name || deadModels.has(name)) return

  deadModels.add(name)
  logger.warn('[GEMINI] Modelo descartado para el resto del proceso', {
    model: name,
    reason,
  })
}

export const isModelDead = model => deadModels.has(normalizeModelName(model))

/** Sólo para tests. */
export const resetDeadModels = () => deadModels.clear()
