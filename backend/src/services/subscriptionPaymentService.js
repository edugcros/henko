// 📁 src/services/subscriptionPaymentService.js
// Servicio para procesar pagos de suscripción con Mercado Pago
// Valida plan, crea PaymentIntent y maneja confirmación

import crypto from 'node:crypto'
import { Money } from '../utils/money.js'
import { normalizePlan, getPlanMonthlyPriceUsd } from './ai/aiPlanPolicy.js'
import logger from '../../config/logger.js'

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
  const priceUsd = getPlanMonthlyPriceUsd(normalizedPlan)

  // Validar que el plan tenga precio definido
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    const error = new Error('SUBSCRIPTION_PLAN_INVALID')
    error.statusCode = 400
    error.details = `Plan ${normalizedPlan} no tiene precio definido`
    throw error
  }

  const amountCents = Math.round(priceUsd * 100)
  const payerEmail = normalizeEmail(email)

  if (!payerEmail || !isValidEmail(payerEmail)) {
    const error = new Error('PAYER_EMAIL_INVALID')
    error.statusCode = 400
    throw error
  }

  const subscriptionData = {
    reason: `Suscripción Henko Plan ${normalizedPlan}`,
    external_reference: `sub:${tenantId}:${Date.now()}`,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: Number((priceUsd).toFixed(2)),
      currency_id: 'USD',
      start_date: new Date().toISOString(),
    },
    payer: {
      email: payerEmail,
      name: payer?.name || 'Cliente Henko',
      identification: {
        type: sanitizeString(payer?.identification?.type, 'DNI'),
        number: String(payer?.identification?.number || '')
          .replace(/\D/g, '')
          .slice(0, 20),
      },
    },
    back_url: process.env.SUBSCRIPTION_SUCCESS_URL || `${process.env.ADMIN_BASE_URL}/subscription/success`,
    notification_url: buildNotificationUrl(),
    metadata: {
      tenant_id: tenantId.toString(),
      user_id: userId.toString(),
      plan: normalizedPlan,
      payment_type: 'subscription',
    },
  }

  if (paymentMethodId === 'account_money') {
    // Para billetera de MP, usar card_token si aplica
    subscriptionData.card_token_id = token
  } else if (token && token !== 'undefined') {
    subscriptionData.card_token_id = token
  }

  // Emisor de tarjeta (si se proporciona)
  const issuerNum = Number(issuerId)
  if (
    issuerId &&
    issuerId !== 'undefined' &&
    issuerId !== 'null' &&
    Number.isFinite(issuerNum) &&
    issuerNum > 0
  ) {
    subscriptionData.issuer_id = issuerNum
  }

  return {
    subscriptionData,
    planPrice: priceUsd,
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
  const publicBackendUrl = sanitizeString(
    process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL,
  ).replace(/\/+$/, '')

  if (!publicBackendUrl || !publicBackendUrl.startsWith('https://')) {
    logger.warn('⚠️ notification_url omitida: falta PUBLIC_BACKEND_URL HTTPS pública')
    return null
  }

  const apiPrefix = `/${sanitizeString(process.env.API_PREFIX, 'api').replace(
    /^\/+|\/+$/g,
    '',
  )}`

  return `${publicBackendUrl}${apiPrefix}/subscriptions/webhook/mercadopago`
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
