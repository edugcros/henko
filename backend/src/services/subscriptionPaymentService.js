// 📁 src/services/subscriptionPaymentService.js
// Servicio para procesar pagos de suscripción con Mercado Pago
// Valida plan, crea PaymentIntent y maneja confirmación

import crypto from 'node:crypto'
import { Money } from '../utils/money.js'
import { normalizePlan, getPlanMonthlyPriceArs } from './ai/aiPlanPolicy.js'
import { MercadoPagoConfig, PreApproval } from 'mercadopago'

import { env } from '../../config/env.js'
import { getWebhookUrl } from '../config/subscriptionConfig.js'
import logger from '../../config/logger.js'

/**
 * Cliente de SUSCRIPCIONES de Mercado Pago.
 *
 * QUÉ ESTABA MAL
 *
 * subscriptionCtrl construía su cliente con
 * `createMercadoPagoPaymentClient(tenant._id)`, y eso fallaba de tres formas a
 * la vez:
 *
 *   1. Esa función espera un TOKEN DE ACCESO y valida que empiece con
 *      `APP_USR-` o `TEST-`. Le pasaban el id del comercio, así que lanzaba
 *      MP_ACCESS_TOKEN_INVALID y el controlador devolvía 503 antes de tocar
 *      Mercado Pago.
 *   2. Devuelve un cliente de PAGOS. Las suscripciones son otro recurso.
 *   3. El código llamaba `mpClient.subscription.create(...)`, un método que el
 *      cliente de pagos no tiene.
 *
 * O sea que el alta de suscripciones nunca llegó a ejecutarse. No es que se
 * perdían: no se creaba ninguna.
 *
 * DE QUIÉN SON LAS CREDENCIALES
 *
 * De HENKO, no del comercio. Acá el comercio le paga a la plataforma, así que
 * la plata entra a la cuenta de la plataforma. Pasar `tenant._id` sugiere que
 * la intención original era usar las credenciales del propio comercio — eso
 * sería el comercio cobrándose a sí mismo, y además el token de un comercio no
 * puede crear una suscripción a favor de otro.
 */
export const createSubscriptionClient = () => {
  const accessToken = String(env.mercadoPago?.accessToken || '').trim()

  // Mismo criterio que paymentTenantConfigService: si no tiene forma de
  // credencial de Mercado Pago, no se intenta la llamada.
  if (!accessToken.startsWith('APP_USR-') && !accessToken.startsWith('TEST-')) {
    const error = new Error('MP_ACCESS_TOKEN_INVALID')
    error.statusCode = 500
    error.details = 'MP_ACCESS_TOKEN de plataforma ausente o con formato inválido'
    throw error
  }

  return new PreApproval(
    new MercadoPagoConfig({ accessToken, options: { timeout: 15000 } }),
  )
}

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  return value.trim() || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))

/**
 * Construir datos de pago recurrente para Mercado Pago.
 *
 * La suscripción en MP se crea con:
 * - Pago inicial (si aplica)
 * - Cobro automático mensual
 * - Reintentos en caso de fallo
 */
export const buildMercadoPagoSubscriptionData = ({
  plan,
  tenantId,
  userId,
  email,
  paymentMethodId,
  token,
  issuerId,
  payer,
  autoRenew = true,
}) => {
  const normalizedPlan = normalizePlan(plan)
  const priceArs = getPlanMonthlyPriceArs(normalizedPlan)

  // Validar que el plan tenga precio definido
  if (!Number.isFinite(priceArs) || priceArs <= 0) {
    const error = new Error('SUBSCRIPTION_PLAN_INVALID')
    error.statusCode = 400
    error.details = `Plan ${normalizedPlan} no tiene precio definido`
    throw error
  }

  const amountCents = Math.round(priceArs * 100)
  const payerEmail = normalizeEmail(email)

  if (!payerEmail || !isValidEmail(payerEmail)) {
    const error = new Error('PAYER_EMAIL_INVALID')
    error.statusCode = 400
    throw error
  }

  // EL CONTRATO REAL DE /preapproval
  //
  // Verificado contra los tipos del SDK (PreApprovalRequest en
  // clients/preApproval/commonTypes.d.ts). Acepta exactamente:
  // auto_recurring, back_url, card_token_id, external_reference, payer_email,
  // preapproval_plan_id, reason y status. Nada más.
  //
  // Lo que había acá mandaba `payer: { email, name, identification }`. El SDK
  // serializa el body con JSON.stringify tal cual, así que ese objeto viajaba y
  // Mercado Pago lo ignoraba: **el email del suscriptor nunca llegaba**, y es el
  // campo con el que identifica a quién le cobra.
  //
  // Faltaba también `status`. Sin él, Mercado Pago crea la suscripción en
  // 'pending' y devuelve un init_point para que el comprador la autorice a mano.
  // Con un card_token_id y status 'authorized' cobra en el acto, que es lo que
  // este checkout promete.
  //
  // `metadata` e `issuer_id` no son parte del contrato y se van: la correlación
  // con el comercio y el usuario viaja en external_reference, que sí lo es.
  const subscriptionData = {
    reason: `Suscripción Henko Plan ${normalizedPlan}`,
    external_reference: `sub:${tenantId}:${userId}:${Date.now()}`,
    payer_email: payerEmail,
    status: 'authorized',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      // En PESOS, que es lo que cobra HENKO y lo único que admite una
      // suscripción de una cuenta de Mercado Pago argentina. Mandarle USD a una
      // cuenta MLA es un rechazo asegurado, y era lo que estaba escrito.
      transaction_amount: priceArs,
      currency_id: 'ARS',
      start_date: new Date().toISOString(),
    },
    // ADMIN_BASE_URL no existe en config/env.js: quedaba "undefined/..." y
    // Mercado Pago rechaza una back_url inválida. env.adminUrl sí es
    // obligatoria en producción. La ruta también estaba mal: el router del
    // panel no tiene /subscription/success, sí /admin/mi-suscripcion.
    back_url:
      process.env.SUBSCRIPTION_SUCCESS_URL || `${env.adminUrl}/admin/mi-suscripcion`,
    // notification_url NO está en PreApprovalRequest. Se sigue mandando porque
    // el SDK pasa el body tal cual y no cuesta nada si lo ignoran, pero la vía
    // confiable para los webhooks de suscripción es configurar la URL en el
    // panel de Mercado Pago (Tus integraciones → Webhooks). Ver getWebhookUrl.
    notification_url: buildNotificationUrl(),
  }

  // Las dos ramas que había acá ponían el mismo card_token_id, así que el
  // paymentMethodId no decidía nada. Se cobra con el token o no se cobra.
  if (token && token !== 'undefined') {
    subscriptionData.card_token_id = token
  }

  return {
    subscriptionData,
    planPrice: priceArs,
    amountCents,
  }
}

/**
 * Mapear errores de Mercado Pago a mensajes amigables
 */
export const mapMercadoPagoSubscriptionError = error => {
  const rawMessage = String(error?.message || '').toLowerCase()
  const cause = Array.isArray(error?.cause) ? error.cause : []

  const causeText = cause
    .map(item => String(item?.description || '').toLowerCase())
    .join(' | ')

  const combined = `${rawMessage} ${causeText}`
  const status = Number(error?.status || error?.statusCode || 400)

  if (
    combined.includes('invalid access token') ||
    combined.includes('access_token') ||
    combined.includes('unauthorized')
  ) {
    return {
      status: 503,
      code: 'MP_ACCESS_TOKEN_INVALID',
      message: 'Mercado Pago no está configurado correctamente',
      details: 'Error de autenticación con Mercado Pago',
    }
  }

  if (
    combined.includes('invalid card token') ||
    combined.includes('card_token') ||
    combined.includes('token not found')
  ) {
    return {
      status: 400,
      code: 'CARD_TOKEN_INVALID',
      message: 'Token de tarjeta inválido',
      details: 'El token de pago expiró o es inválido. Intenta nuevamente.',
    }
  }

  if (combined.includes('security_code') || combined.includes('cvv')) {
    return {
      status: 400,
      code: 'CARD_CVV_INVALID',
      message: 'Código de seguridad inválido',
      details: 'Verifica el CVV de la tarjeta.',
    }
  }

  if (combined.includes('amount')) {
    return {
      status: 400,
      code: 'PAYMENT_AMOUNT_INVALID',
      message: 'Monto de pago inválido',
      details: error?.message || 'Mercado Pago rechazó el monto.',
    }
  }

  return {
    status: 400,
    code: 'SUBSCRIPTION_PAYMENT_ERROR',
    message: 'No se pudo procesar el pago de suscripción',
    details: error?.message || 'Error desconocido',
  }
}

/**
 * Construir URL de notificación para webhooks de Mercado Pago
 */
const buildNotificationUrl = () => {
  // La URL la arma subscriptionConfig, que es donde vive la ruta real. Acá se
  // armaba una segunda vez, apuntando a `/subscriptions/webhook/mercadopago`:
  // una ruta que no existe en ningún router. Cada suscripción creada quedaba
  // registrada contra un 404 y ningún evento de Mercado Pago llegaba nunca.
  const url = getWebhookUrl()

  if (!url) {
    logger.warn('⚠️ notification_url omitida: falta PUBLIC_BACKEND_URL HTTPS pública')
    return null
  }

  return url
}

/**
 * Fecha del proveedor, o null. Nunca una inventada.
 *
 * Un valor nulo dice "Mercado Pago todavía no lo informó", y eso es un dato:
 * quien lo lee sabe que no sabe. La versión anterior escribía
 * `Date.now() + 30 días` y producía una fecha que se ve exactamente igual de
 * confiable que una real — el comercio veía "próximo cobro: 15/10" con la misma
 * tipografía viniera de donde viniera, y nadie podía distinguir el dato del
 * supuesto.
 */
const providerDate = value => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Ciclo de facturación tal como lo informa Mercado Pago.
 *
 * `next_payment_date` y `auto_recurring.start_date` son campos del proveedor.
 * `currentPeriodEnd` se deriva del primero y no de un calendario nuestro: en una
 * suscripción que cobra al inicio de cada período, el período vigente termina
 * cuando llega el próximo cobro. Es una definición, no una estimación — y si el
 * proveedor no informó el próximo cobro, queda nula como todo lo demás.
 */
export const readProviderBillingDates = (mpSubscription = {}) => {
  const nextBillingAt = providerDate(mpSubscription?.next_payment_date)

  return {
    currentPeriodStart:
      providerDate(mpSubscription?.summarized?.last_charged_date) ||
      providerDate(mpSubscription?.auto_recurring?.start_date),
    currentPeriodEnd: nextBillingAt,
    nextBillingAt,
  }
}

/**
 * Mapear estado de suscripción MP a nuestro domain
 */
export const mapMercadoPagoSubscriptionStatus = (mpStatus, mpReason) => {
  const status = sanitizeString(mpStatus).toLowerCase()
  const reason = sanitizeString(mpReason).toLowerCase()

  // Estados de MP para suscripciones: authorized, pending, processing, paused, cancelled, suspended
  const statusMap = {
    authorized: 'active',      // Suscripción autorizada y activa
    pending: 'pending',        // Pendiente de confirmación
    processing: 'pending',     // En procesamiento
    paused: 'paused',         // Pausa temporal
    cancelled: 'cancelled',   // Cancelada por usuario
    suspended: 'cancelled',   // Suspendida (timeout de pagos)
  }

  return statusMap[status] || 'pending'
}

export default {
  buildMercadoPagoSubscriptionData,
  mapMercadoPagoSubscriptionError,
  mapMercadoPagoSubscriptionStatus,
}
