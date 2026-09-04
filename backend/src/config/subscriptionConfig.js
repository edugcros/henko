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
 * URL de webhook de Mercado Pago
 * Debe estar configurada en dashboard de MP:
 * https://<dominio>/api/webhooks/mercadopago/subscription
 *
 * Eventos que dispara:
 * - subscription_authorized: pago aprobado
 * - subscription_failed: pago rechazado
 * - subscription_update: cambio en suscripción
 * - subscription_canceled: cancelación
 */
const getWebhookUrl = () => {
  const baseUrl = process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL
  if (!baseUrl) {
    throw new Error(
      'WEBHOOK_BASE_URL o API_BASE_URL no configurado para webhooks de Mercado Pago',
    )
  }
  return `${baseUrl}/api/webhooks/mercadopago/subscription`
}

/**
 * Período de gracia después de pago fallido (días)
 * Durante este tiempo, los usuarios mantienen acceso a features premium
 */
const getGracePeriodDays = () => {
  const days = Number(process.env.AI_SUBSCRIPTION_GRACE_DAYS)
  return Number.isFinite(days) && days > 0 ? days : 7
}

export default {
  isEnforcementEnabled,
  getWebhookUrl,
  getGracePeriodDays,
}
