import { PAYMENT_STATUS } from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import logger from '../../config/logger.js'

const CASH_METHODS = [
  'rapipago',
  'pagofacil',
  'cobroexpress',
  'redlink',
  'bapropagos',
  'cargavirtual',
  'account_money',
]

const MP_TO_DOMAIN_PAYMENT_STATUS = {
  approved: PAYMENT_STATUS.APPROVED,
  pending: PAYMENT_STATUS.PENDING,
  in_process: PAYMENT_STATUS.PENDING,
  rejected: PAYMENT_STATUS.REJECTED,
  cancelled: PAYMENT_STATUS.CANCELLED,
  refunded: PAYMENT_STATUS.REFUNDED,
}

export const FINAL_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUS.APPROVED,
  PAYMENT_STATUS.REJECTED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
])

export const NEGATIVE_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUS.REJECTED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
])

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))

export const normalizeMpStatus = status => {
  return MP_TO_DOMAIN_PAYMENT_STATUS[sanitizeString(status).toLowerCase()] || null
}

export const getStatusMessage = status => {
  const messages = {
    approved: 'Pago aprobado exitosamente',
    pending: 'Pago pendiente de confirmación',
    in_process: 'Pago en proceso',
    rejected: 'Pago rechazado',
    cancelled: 'Pago cancelado',
    refunded: 'Pago reembolsado',
  }

  return messages[status] || 'Estado desconocido'
}

const isCashPaymentMethod = paymentMethodId => {
  const method = sanitizeString(paymentMethodId).toLowerCase()

  return CASH_METHODS.some(candidate => {
    return method.includes(candidate)
  })
}

const validateInstallments = (installments, paymentMethodId) => {
  if (isCashPaymentMethod(paymentMethodId)) return 1

  let parsed = Number.parseInt(installments, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    parsed = 1
  }

  if (parsed > 12) {
    logger.warn('Installments mayor a 12, limitando', {
      installments: parsed,
    })

    parsed = 12
  }

  return parsed
}

const isPublicNotificationUrl = value => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()

    const isLocalDomain =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.test')

    return url.protocol === 'https:' && !isLocalDomain
  } catch {
    return false
  }
}

const buildNotificationUrl = () => {
  const publicBackendUrl = sanitizeString(
    process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL,
  ).replace(/\/+$/, '')

  if (!isPublicNotificationUrl(publicBackendUrl)) {
    logger.warn(
      '⚠️ notification_url omitida: falta PUBLIC_BACKEND_URL HTTPS pública para Mercado Pago',
    )

    return null
  }

  const apiPrefix = `/${sanitizeString(process.env.API_PREFIX, '/api').replace(
    /^\/+|\/+$/g,
    '',
  )}`

  return `${publicBackendUrl}${apiPrefix}/payments/webhook/mercadopago?source_news=webhooks`
}

export const buildMercadoPagoPaymentData = ({
  order,
  userId,
  tenantId,
  token,
  paymentMethodId,
  installments,
  issuerId,
  payer,
}) => {
  const amountCents = Number(order.paymentIntent?.amountCents || 0)

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    const error = new Error('INVALID_ORDER_AMOUNT')
    error.statusCode = 400
    throw error
  }

  const transactionAmount = Money.toDecimal(amountCents)
  const validatedInstallments = validateInstallments(installments, paymentMethodId)

  const payerEmail = normalizeEmail(payer.email)

  if (!payerEmail || !isValidEmail(payerEmail)) {
    const error = new Error('PAYER_EMAIL_INVALID')
    error.statusCode = 400
    throw error
  }

  const paymentData = {
    transaction_amount: Number(transactionAmount),
    token: sanitizeString(token),
    description: `Orden #${order._id}`,
    installments: Number(validatedInstallments),
    payment_method_id: sanitizeString(paymentMethodId).toLowerCase(),
    payer: {
      email: payerEmail,
      identification: {
        type: sanitizeString(payer.identification?.type, 'DNI'),
        number: String(payer.identification?.number || '')
          .replace(/\D/g, '')
          .slice(0, 20),
      },
    },
    external_reference: order._id.toString(),
    metadata: {
      order_id: order._id.toString(),
      user_id: userId.toString(),
      tenant_id: tenantId.toString(),
    },
  }

  const issuerNum = Number(issuerId)

  if (
    issuerId &&
    issuerId !== 'undefined' &&
    issuerId !== 'null' &&
    Number.isFinite(issuerNum) &&
    issuerNum > 0
  ) {
    paymentData.issuer_id = issuerNum
  }

  const notificationUrl = buildNotificationUrl()

  if (notificationUrl) {
    paymentData.notification_url = notificationUrl
  }

  return {
    paymentData,
    transactionAmount,
    validatedInstallments,
  }
}

export const mapMercadoPagoError = error => {
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
    combined.includes('must provide your access_token') ||
    combined.includes('unauthorized use of live credentials') ||
    status === 401
  ) {
    return {
      status: 503,
      code: 'MP_ACCESS_TOKEN_INVALID',
      message: 'Mercado Pago no está configurado correctamente para este comercio.',
      details: 'El Access Token del backend es inválido, vencido o no pertenece a esta integración.',
    }
  }

  if (
    combined.includes('invalid card token') ||
    combined.includes('card token') ||
    combined.includes('card_token') ||
    combined.includes('token not found') ||
    combined.includes('token already used')
  ) {
    return {
      status: 400,
      code: 'CARD_TOKEN_INVALID',
      message: 'TOKEN_INVALIDO',
      details: 'Error con el token de tarjeta. Genera un nuevo intento de pago.',
    }
  }

  if (combined.includes('security_code') || combined.includes('cvv')) {
    return {
      status: 400,
      code: 'CARD_CVV_INVALID',
      message: 'Código de seguridad inválido.',
      details: 'Verifica el CVV de la tarjeta.',
    }
  }

  if (combined.includes('insufficient_amount') || combined.includes('amount')) {
    return {
      status: 400,
      code: 'PAYMENT_AMOUNT_INVALID',
      message: 'Monto de pago inválido.',
      details: error?.message || 'Mercado Pago rechazó el monto enviado.',
    }
  }

  return {
    status: 400,
    code: 'PAYMENT_ERROR',
    message: 'No se pudo procesar el pago.',
    details: error?.message || 'Error desconocido del proveedor de pagos.',
  }
}
