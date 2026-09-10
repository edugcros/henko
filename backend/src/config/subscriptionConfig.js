// 📁 src/config/subscriptionConfig.js
// Configuración de sistema de suscripciones

const clean = val => String(val || '').trim()

/**
 * Activar enforcement de suscripciones
 *
 * Cuando está habilitado:
 * - Los usuarios sin suscripción activa o con pago pendiente se les bloquea acceso a features premium
 * - Los planes free tienen cuotas limitadas (50 vision, 300 agent messages)
 * - Los planes paid tienen cuotas más altas según el plan
 * - Los intentos de acceder a features premium sin créditos retorna 402 Payment Required
 *
 * Configuración: AI_ENFORCE_SUBSCRIPTION=true (o 1, yes, si, sí, on)
 */
const isEnforcementEnabled = () => {
  const raw = clean(process.env.AI_ENFORCE_SUBSCRIPTION).toLowerCase()
  if (!raw) return false
  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(raw)
}

/**
 * Ruta del webhook de suscripciones, relativa al prefijo de la API.
 *
 * ESTE ES EL ÚNICO LUGAR DONDE SE ESCRIBE.
 *
 * La ruta estaba escrita dos veces y las dos copias divergieron: el router
 * publicaba `/webhooks/mercadopago/subscription` y
 * subscriptionPaymentService le declaraba a Mercado Pago
 * `/subscriptions/webhook/mercadopago`, que nunca existió. O sea que cada
 * suscripción creada quedaba registrada contra un 404 y ningún evento de cobro,
 * rechazo o cancelación llegaba nunca.
 *
 * El router la importa de acá y el constructor de la URL también, así que no
 * pueden volver a separarse sin que falle el test que las compara.
 *
 * Eventos que dispara:
 * - subscription_authorized: pago aprobado
 * - subscription_failed: pago rechazado
 * - subscription_update: cambio en suscripción
 * - subscription_canceled: cancelación
 */
export const SUBSCRIPTION_WEBHOOK_MOUNT = '/webhooks'
export const SUBSCRIPTION_WEBHOOK_ROUTE = '/mercadopago/subscription'
export const SUBSCRIPTION_WEBHOOK_PATH = `${SUBSCRIPTION_WEBHOOK_MOUNT}${SUBSCRIPTION_WEBHOOK_ROUTE}`

const getApiPrefix = () => `/${clean(process.env.API_PREFIX || 'api').replace(/^\/+|\/+$/g, '')}`

/**
 * URL pública completa que se le declara a Mercado Pago.
 *
 * Devuelve null en vez de lanzar: sin URL pública la suscripción se crea igual
 * (Mercado Pago no la exige) y el caller avisa. Lanzar acá dejaría a un
 * comercio sin poder suscribirse por una variable de entorno faltante.
 *
 * El orden de las variables no es arbitrario: PUBLIC_BACKEND_URL es la que está
 * puesta en producción hoy. Las otras dos quedan como respaldo porque la versión
 * anterior de esta función las usaba, y sacarlas rompería cualquier entorno que
 * las tenga configuradas.
 */
const getWebhookUrl = () => {
  const baseUrl = clean(
    process.env.PUBLIC_BACKEND_URL ||
      process.env.BACKEND_URL ||
      process.env.WEBHOOK_BASE_URL ||
      process.env.API_BASE_URL,
  ).replace(/\/+$/, '')

  if (!baseUrl || !baseUrl.startsWith('https://')) return null

  return `${baseUrl}${getApiPrefix()}${SUBSCRIPTION_WEBHOOK_PATH}`
}

/**
 * Período de gracia después de pago fallido (días)
 * Durante este tiempo, los usuarios mantienen acceso a features premium
 */
const getGracePeriodDays = () => {
  const days = Number(process.env.AI_SUBSCRIPTION_GRACE_DAYS)
  return Number.isFinite(days) && days > 0 ? days : 7
}

export { getWebhookUrl }

export default {
  isEnforcementEnabled,
  getWebhookUrl,
  getGracePeriodDays,
}
