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
 * Esta lista tenía "gemini-3.5-flash" y "gemini-3.6-flash". Google no
 * tiene una versión 3.5: la familia va 1.0 → 1.5 → 2.0 → 2.5. Esos nombres
 * nunca existieron, probablemente por mezcla con nomenclatura de OpenAI o
 * Anthropic. Cuando la API se le pega a un modelo inexistente en el path
 * "generativelanguage.googleapis.com/v1beta/models/<x>:generateContent",
 * Google no siempre devuelve 404: para algunos alias devuelve 503 "This
 * model is currently experiencing high demand", que hace parecer una
 * indisponibilidad temporal cuando en realidad el modelo no existe.
 *
 * La lectura correcta de los códigos: un 429 CON texto de "quota/billing/plan"
 * es cuota (temporal, cooldown); un 429 sin ese texto puede ser cualquier cosa,
 * incluido "no existe" — no alcanza para afirmar que un modelo exista.
 *
 * SEPTIEMBRE 2026 — segunda corrección, esta vez contra la API y no de memoria.
 *
 * El texto anterior afirmaba que "Google no tiene una versión 3.5: la familia
 * va 1.0 → 1.5 → 2.0 → 2.5" y por esa premisa eliminó gemini-3.5-flash como
 * nombre imaginario. Es falso: GET /v1beta/models lista gemini-3.5-flash y
 * gemini-3.5-flash-lite. Sacarlo igual estuvo bien, pero por el motivo
 * contrario al que se escribió — cuesta el doble que 3.6 (USD 1.50/9.00 por
 * 1M contra 0.75/3.75).
 *
 * El daño real fue otro: los tres nombres de esta lista quedaron idénticos
 * tras un reemplazo global, así que getModelChain deduplicaba a UN modelo y
 * la cadena de respaldo no podía respaldar nada. Todo el aparato de cooldowns
 * y modelos muertos de este archivo quedó inerte.
 *
 * Cadena verificada con generateContent real contra la key del proyecto:
 *   gemini-3.6-flash       200 en el catálogo, USD 0.75/3.75 por 1M
 *   gemini-3.7-flash       200 verificado, mismo precio, generación más nueva
 *   gemini-3.1-flash-lite  200 verificado, USD 0.25/1.50 — degradación barata
 *
 * No se incluye gemini-2.5-flash-lite: da 404 con esta key pese a figurar en
 * la documentación de precios.
 *
 * OJO con los precios: los modelos 3.x duplican tarifa el 1/1/2027
 * (0.75/3.75 → 1.50/7.50). El flash-lite 3.1 no tiene ese ajuste anunciado.
 *
 * TODO: revisar cada vez que Google anuncie retiros o nuevas versiones, y
 * verificar con una llamada real antes de agregar un nombre acá.
 */
const FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
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

/**
 * ¿El proveedor está saturado? Google devuelve 503 "This model is currently
 * experiencing high demand" cuando un modelo no da abasto. Es transitorio y
 * NO significa que el modelo no exista, así que se trata como la cuota: se
 * pausa el modelo un rato y se sigue por el siguiente de la cadena.
 *
 * Verificado el 07/09/2026: gemini-3.6-flash devolvía 503 de forma sostenida
 * mientras gemini-3.7-flash respondía normal. Sin este caso, el 503 se
 * propagaba como error y la IA fallaba entera aun teniendo alternativas.
 */
export const isOverloadError = status => Number(status) === 503

/** ¿El fallo indica que conviene pasar al siguiente modelo de la cadena? */
export const isModelUnavailable = (status, body = '') => {
  if (status === 404) return true
  if (status === 400 && /not found|not supported/i.test(body)) return true
  if (isQuotaError(status, body)) return true
  if (isOverloadError(status)) return true
  return false
}

/**
 * Igual que isModelUnavailable pero a partir del error crudo. Cada capa
 * reporta el status distinto: fetch usa response.status, el SDK de Google
 * expone `.status` y además embebe "[404 Not Found]" en el mensaje.
 */
/**
 * Status HTTP de un error crudo, mirando los tres lugares donde puede estar.
 * Se exporta porque markModelDead necesita el mismo número para decidir entre
 * pausa temporal y descarte permanente: sin él, un 429 o un 503 se tratan como
 * "Google retiró el modelo" y lo sacan de la cadena por lo que queda del
 * proceso. Devuelve undefined si no se pudo determinar.
 */
export const extractErrorStatus = error => {
  if (!error) return undefined

  const fromMessage = Number(String(error.message || '').match(/\[(\d{3})\s/)?.[1])

  return (
    error.status ??
    error.statusCode ??
    (Number.isFinite(fromMessage) ? fromMessage : undefined)
  )
}

export const isModelUnavailableError = error => {
  if (!error) return false

  const message = String(error.message || '')
  const status = extractErrorStatus(error)

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

  // Cuota agotada (429) y saturación del proveedor (503) son las dos causas
  // transitorias: el modelo existe y va a volver. Marcarlas como muerte
  // permanente sacaría de la cadena a un modelo sano por el resto del proceso.
  if (isQuotaError(status, reason) || isOverloadError(status)) {
    if (cooldownModels.has(name)) return

    const until = Date.now() + QUOTA_COOLDOWN_MS
    cooldownModels.set(name, until)

    logger.warn('[GEMINI] Modelo no disponible temporalmente, en pausa', {
      model: name,
      cause: isOverloadError(status) ? 'saturación (503)' : 'cuota (429)',
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
