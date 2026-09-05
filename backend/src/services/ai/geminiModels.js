import logger from '../../../config/logger.js'

/**
 * Resolución resiliente de modelos Gemini.
 *
 * Google retira modelos sin aviso. Cuando el modelo vive en una variable de
 * entorno, un retiro rompe producción en silencio y sólo se arregla editando
 * el dashboard. Este módulo mantiene una cadena de respaldos y recuerda qué
 * modelos ya se probaron inservibles.
 *
 * DOS TIPOS DE FALLA, DOS TRATAMIENTOS (corrección de un problema real):
 *
 * La versión anterior trataba igual un 404 y un 429 por cuota: los dos
 * marcaban el modelo muerto para el resto del proceso. Pero significan cosas
 * opuestas:
 *
 *   404 → el modelo ya no existe. Permanente. No volver a probarlo nunca.
 *   429 → la cuota se agotó. TEMPORAL. Vuelve cuando Google la resetea.
 *
 * Marcar un 429 como muerte permanente convertía un problema de una hora en
 * uno que duraba hasta el próximo reinicio del server — y como este estado es
 * global al proceso, un pico de uso en una herramienta interna podía dejar
 * sin modelo al agente de ventas de WhatsApp, que es producto en vivo.
 *
 * Ahora un 429 pone el modelo en cooldown con vencimiento, y se reintenta
 * solo cuando expira.
 */

/**
 * Cadena de respaldos, en orden de preferencia.
 *
 * IMPORTANTE — corrección de un error de nomenclatura previo:
 *
 * Esta lista tenía "gemini-3.5-flash" y "gemini-3.5-flash-lite". Google no
 * tiene una versión 3.5: la familia va 1.0 → 1.5 → 2.0 → 2.5. Esos nombres
 * nunca existieron, probablemente por mezcla con nomenclatura de OpenAI o
 * Anthropic. Cuando la API se le pega a un modelo inexistente en el path
 * "generativelanguage.googleapis.com/v1beta/models/<x>:generateContent",
 * Google no siempre devuelve 404: para algunos alias devuelve 503 "This
 * model is currently experiencing high demand", que hace parecer una
 * indisponibilidad temporal cuando en realidad el modelo no existe.
 *
 * Los comentarios anteriores decían que "gemini-2.5-flash está retirado"
 * y que "gemini-3.5-flash-lite existe (429 = cuota)"; eso llevó a rearmar
 * la cadena eliminando modelos reales y dejando nombres imaginarios. La
 * lectura correcta: un 429 CON texto de "quota/billing/plan" es cuota
 * (temporal, cooldown); un 429 sin ese texto puede ser cualquier cosa,
 * incluido "no existe" — no alcanza para afirmar que un modelo exista.
 *
 * Modelos vigentes (septiembre 2026) que Google mantiene:
 *   gemini-3.6-flash       → generación más reciente (recomendado por Google)
 *   gemini-2.5-flash       → modelo anterior, aún disponible
 *   gemini-2.5-flash-lite  → versión económica
 *
 * TODO: revisar cada vez que Google anuncie retiros o nuevas versiones.
 */
const FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]

/** Modelos retirados por Google (404). Permanente para este proceso. */
const deadModels = new Set()

/** Modelos sin cuota (429). Map de modelo → timestamp en que vuelve a probarse. */
const cooldownModels = new Map()

/**
 * Cuánto esperar antes de reintentar un modelo que dio 429.
 *
 * 15 minutos es un compromiso: suficiente para no martillar la API mientras
 * la cuota sigue agotada, y corto frente a una cuota que se resetea por día o
 * por minuto, según el límite que se haya tocado.
 */
const QUOTA_COOLDOWN_MS = Number(process.env.GEMINI_QUOTA_COOLDOWN_MS) || 15 * 60 * 1000

export const normalizeModelName = value =>
  String(value || '').trim().replace(/^models\//, '')

/** ¿Este modelo está en cooldown ahora mismo? Limpia la entrada si ya venció. */
const isCoolingDown = model => {
  const until = cooldownModels.get(model)
  if (until === undefined) return false

  if (Date.now() >= until) {
    cooldownModels.delete(model)
    logger.info('[GEMINI] Cooldown vencido, el modelo vuelve a la cadena', { model })
    return false
  }

  return true
}

/**
 * Cadena de modelos a intentar, en orden de preferencia y sin los descartados.
 *
 * Si todos están muertos o en cooldown se devuelven igual los respaldos: es
 * preferible fallar contra la API con un error real que con una lista vacía,
 * que produciría un error interno mucho más confuso de diagnosticar.
 */
export const getModelChain = (...preferred) => {
  const chain = [...preferred, ...FALLBACK_MODELS]
    .map(normalizeModelName)
    .filter(Boolean)

  const unique = [...new Set(chain)]
  const usable = unique.filter(model => !deadModels.has(model) && !isCoolingDown(model))

  if (usable.length > 0) return usable

  // Todos descartados. Se reintentan los que solo estaban en cooldown, no los
  // que dieron 404: esos no van a resucitar y probarlos es latencia perdida.
  const notPermanentlyDead = unique.filter(model => !deadModels.has(model))
  return notPermanentlyDead.length > 0 ? notPermanentlyDead : unique
}

/** ¿Es un fallo por cuota agotada (temporal) y no por modelo inexistente? */
export const isQuotaError = (status, body = '') =>
  status === 429 && /quota|billing|plan/i.test(String(body))

/** ¿El fallo indica que conviene pasar al siguiente modelo de la cadena? */
export const isModelUnavailable = (status, body = '') => {
  if (status === 404) return true
  if (status === 400 && /not found|not supported/i.test(body)) return true
  if (isQuotaError(status, body)) return true
  return false
}

/**
 * Igual que isModelUnavailable pero a partir del error crudo. Cada capa
 * reporta el status distinto: fetch usa response.status, el SDK de Google
 * expone `.status` y además embebe "[404 Not Found]" en el mensaje.
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

/**
 * Descarta un modelo. `status` decide si es permanente o temporal — pasarlo
 * es lo que distingue "Google lo retiró" de "se acabó la cuota".
 *
 * Sin status se asume permanente, que es el comportamiento anterior: los
 * llamadores viejos siguen funcionando igual, solo pierden el cooldown.
 */
export const markModelDead = (model, reason, status = null) => {
  const name = normalizeModelName(model)
  if (!name) return

  if (isQuotaError(status, reason)) {
    if (cooldownModels.has(name)) return

    const until = Date.now() + QUOTA_COOLDOWN_MS
    cooldownModels.set(name, until)

    logger.warn('[GEMINI] Modelo sin cuota, en pausa temporal', {
      model: name,
      reason,
      retryAt: new Date(until).toISOString(),
      cooldownMinutes: Math.round(QUOTA_COOLDOWN_MS / 60000),
    })
    return
  }

  if (deadModels.has(name)) return

  deadModels.add(name)
  logger.warn('[GEMINI] Modelo retirado por el proveedor, descartado', {
    model: name,
    reason,
  })
}

export const isModelDead = model => {
  const name = normalizeModelName(model)
  return deadModels.has(name) || isCoolingDown(name)
}

/** Estado actual, para diagnóstico desde el panel o un healthcheck. */
export const getModelHealth = () => ({
  chain: FALLBACK_MODELS,
  dead: [...deadModels],
  coolingDown: [...cooldownModels.entries()].map(([model, until]) => ({
    model,
    retryAt: new Date(until).toISOString(),
  })),
})

/** Sólo para tests. */
export const resetDeadModels = () => {
  deadModels.clear()
  cooldownModels.clear()
}
