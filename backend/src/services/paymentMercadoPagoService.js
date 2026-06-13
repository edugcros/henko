import { PAYMENT_STATUS } from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import logger from '../../config/logger.js'

// =====================================================
// CONSTANTES
// =====================================================

const CASH_METHODS = [
  'rapipago',
  'pagofacil',
  'pago_facil',
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
  authorized: PAYMENT_STATUS.PENDING,
  in_mediation: PAYMENT_STATUS.PENDING,
  rejected: PAYMENT_STATUS.REJECTED,
  cancelled: PAYMENT_STATUS.CANCELLED,
  canceled: PAYMENT_STATUS.CANCELLED,
  refunded: PAYMENT_STATUS.REFUNDED,
  charged_back: PAYMENT_STATUS.REFUNDED,
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

const MAX_INSTALLMENTS = 12
const MIN_CARD_TOKEN_LENGTH = 10
const MAX_DESCRIPTION_LENGTH = 250

// =====================================================
// HELPERS
// =====================================================

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeLower = value => sanitizeString(value).toLowerCase()

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const isValidEmail = value => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))
}

const buildHttpError = ({ message, statusCode = 400, code, details = null }) => {
  const error = new Error(message)
  error.statusCode = statusCode
  if (code) error.code = code
  if (details) error.details = details
  return error
}

const parseBooleanEnv = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback

  return ['true', '1', 'yes', 'on'].includes(
    String(value).trim().toLowerCase(),
  )
}

const getPublicBackendUrl = () => {
  return sanitizeString(
    process.env.PUBLIC_BACKEND_URL ||
      process.env.BACKEND_PUBLIC_URL ||
      process.env.API_PUBLIC_URL ||
      process.env.BACKEND_URL,
  ).replace(/\/+$/, '')
}

const getApiPrefix = () => {
  const rawPrefix = sanitizeString(process.env.API_PREFIX, '/api')
  const cleanPrefix = rawPrefix.replace(/^\/+|\/+$/g, '')

  return cleanPrefix ? `/${cleanPrefix}` : ''
}

const isPublicNotificationUrl = value => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()

    const isLocalDomain =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.test') ||
      hostname.endsWith('.localhost')

    return url.protocol === 'https:' && !isLocalDomain
  } catch {
    return false
  }
}

const buildNotificationUrl = () => {
  const publicBackendUrl = getPublicBackendUrl()

  if (!isPublicNotificationUrl(publicBackendUrl)) {
    logger.warn(
      '⚠️ notification_url omitida: falta PUBLIC_BACKEND_URL HTTPS pública para Mercado Pago',
    )

    return null
  }

  return `${publicBackendUrl}${getApiPrefix()}/payments/webhook/mercadopago?source_news=webhooks`
}

const isCashPaymentMethod = paymentMethodId => {
  const method = normalizeLower(paymentMethodId)

  if (!method) return false

  return CASH_METHODS.some(candidate => method.includes(candidate))
}

const shouldUseBinaryMode = paymentMethodId => {
  if (isCashPaymentMethod(paymentMethodId)) return false

  return parseBooleanEnv(process.env.MP_BINARY_MODE, true)
}

const validatePaymentMethodId = paymentMethodId => {
  const cleanPaymentMethodId = normalizeLower(paymentMethodId)

  if (!cleanPaymentMethodId) {
    throw buildHttpError({
      message: 'PAYMENT_METHOD_INVALID',
      statusCode: 400,
      code: 'PAYMENT_METHOD_INVALID',
    })
  }

  return cleanPaymentMethodId
}

const validateInstallments = (installments, paymentMethodId) => {
  if (isCashPaymentMethod(paymentMethodId)) return 1

  let parsed = Number.parseInt(installments, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    parsed = 1
  }

  if (parsed > MAX_INSTALLMENTS) {
    logger.warn('Installments mayor al máximo permitido, limitando', {
      installments: parsed,
      maxInstallments: MAX_INSTALLMENTS,
    })

    parsed = MAX_INSTALLMENTS
  }

  return parsed
}

const validateCardToken = ({ token, paymentMethodId }) => {
  if (isCashPaymentMethod(paymentMethodId)) {
    return sanitizeString(token)
  }

  const cleanToken = sanitizeString(token)

  if (!cleanToken || cleanToken.length < MIN_CARD_TOKEN_LENGTH) {
    throw buildHttpError({
      message: 'CARD_TOKEN_INVALID',
      statusCode: 400,
      code: 'CARD_TOKEN_INVALID',
    })
  }

  return cleanToken
}

const sanitizeIdentificationType = value => {
  return sanitizeString(value, 'DNI').toUpperCase().slice(0, 20)
}

const sanitizeIdentificationNumber = value => {
  return String(value || '').replace(/\D/g, '').slice(0, 20)
}

const buildPayerPayload = payer => {
  const payerEmail = normalizeEmail(payer?.email)

  if (!payerEmail || !isValidEmail(payerEmail)) {
    throw buildHttpError({
      message: 'PAYER_EMAIL_INVALID',
      statusCode: 400,
      code: 'PAYER_EMAIL_INVALID',
    })
  }

  const identificationType = sanitizeIdentificationType(
    payer?.identification?.type,
  )

  const identificationNumber = sanitizeIdentificationNumber(
    payer?.identification?.number,
  )

  const payload = {
    email: payerEmail,
  }

  if (identificationNumber) {
    payload.identification = {
      type: identificationType,
      number: identificationNumber,
    }
  }

  return payload
}

const buildDescription = order => {
  const raw =
    order?.idempotencyKey ||
    order?._id?.toString?.() ||
    'sin-id'

  return `Orden #${String(raw).slice(-12)}`.slice(0, MAX_DESCRIPTION_LENGTH)
}

const parseIssuerId = issuerId => {
  const raw = sanitizeString(issuerId)

  if (!raw || raw === 'undefined' || raw === 'null') {
    return null
  }

  const issuerNum = Number(raw)

  if (!Number.isFinite(issuerNum) || issuerNum <= 0) {
    return null
  }

  return issuerNum
}

const extractProviderCauseText = error => {
  const cause = Array.isArray(error?.cause)
    ? error.cause
    : Array.isArray(error?.api_response?.cause)
      ? error.api_response.cause
      : Array.isArray(error?.response?.data?.cause)
        ? error.response.data.cause
        : []

  return cause
    .map(item => {
      return [
        item?.code,
        item?.description,
        item?.message,
      ]
        .filter(Boolean)
        .join(' ')
    })
    .join(' | ')
    .toLowerCase()
}

const extractProviderMessage = error => {
  return [
    error?.message,
    error?.error,
    error?.details,
    error?.api_response?.message,
    error?.api_response?.error,
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.response?.data?.status,
    error?.response?.data?.status_detail,
    extractProviderCauseText(error),
  ]
    .filter(Boolean)
    .map(value => String(value).toLowerCase())
    .join(' ')
}

const getProviderStatus = error => {
  return Number(
    error?.status ||
      error?.statusCode ||
      error?.api_response?.status ||
      error?.response?.status ||
      400,
  )
}

const getSafeProviderDetails = error => {
  return (
    error?.details ||
    error?.message ||
    error?.api_response?.message ||
    error?.response?.data?.message ||
    'Error desconocido del proveedor de pagos.'
  )
}

// =====================================================
// STATUS
// =====================================================

export const normalizeMpStatus = status => {
  return MP_TO_DOMAIN_PAYMENT_STATUS[normalizeLower(status)] || null
}

export const getStatusMessage = status => {
  const normalized = normalizeLower(status)

  const messages = {
    approved: 'Pago aprobado exitosamente',
    pending: 'Pago pendiente de confirmación',
    in_process: 'Pago en proceso',
    authorized: 'Pago autorizado, pendiente de captura o confirmación',
    in_mediation: 'Pago en mediación',
    rejected: 'Pago rechazado',
    cancelled: 'Pago cancelado',
    canceled: 'Pago cancelado',
    refunded: 'Pago reembolsado',
    charged_back: 'Pago contracargado',
  }

  return messages[normalized] || 'Estado desconocido'
}

// =====================================================
// BUILD PAYMENT DATA
// =====================================================

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
  const amountCents = Number(order?.paymentIntent?.amountCents || 0)

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw buildHttpError({
      message: 'INVALID_ORDER_AMOUNT',
      statusCode: 400,
      code: 'INVALID_ORDER_AMOUNT',
    })
  }

  if (!order?._id) {
    throw buildHttpError({
      message: 'ORDER_ID_REQUIRED',
      statusCode: 400,
      code: 'ORDER_ID_REQUIRED',
    })
  }

  if (!userId || !tenantId) {
    throw buildHttpError({
      message: 'PAYMENT_CONTEXT_INVALID',
      statusCode: 400,
      code: 'PAYMENT_CONTEXT_INVALID',
    })
  }

  const cleanPaymentMethodId = validatePaymentMethodId(paymentMethodId)

  const cleanToken = validateCardToken({
    token,
    paymentMethodId: cleanPaymentMethodId,
  })

  const transactionAmount = Money.toDecimal(amountCents)

  if (!Number.isFinite(transactionAmount) || transactionAmount <= 0) {
    throw buildHttpError({
      message: 'TRANSACTION_AMOUNT_INVALID',
      statusCode: 400,
      code: 'TRANSACTION_AMOUNT_INVALID',
    })
  }

  const validatedInstallments = validateInstallments(
    installments,
    cleanPaymentMethodId,
  )

  const paymentData = {
    transaction_amount: Number(transactionAmount),
    description: buildDescription(order),
    installments: Number(validatedInstallments),
    payment_method_id: cleanPaymentMethodId,
    payer: buildPayerPayload(payer),
    external_reference: order._id.toString(),
    metadata: {
      order_id: order._id.toString(),
      user_id: userId.toString(),
      tenant_id: tenantId.toString(),
    },
  }

  if (cleanToken) {
    paymentData.token = cleanToken
  }

  const binaryMode = shouldUseBinaryMode(cleanPaymentMethodId)

  if (binaryMode) {
    paymentData.binary_mode = true
  }

  const parsedIssuerId = parseIssuerId(issuerId)

  if (parsedIssuerId) {
    paymentData.issuer_id = parsedIssuerId
  }

  const notificationUrl = buildNotificationUrl()

  if (notificationUrl) {
    paymentData.notification_url = notificationUrl
  }

  logger.info('💳 Mercado Pago paymentData construido', {
    orderId: order._id?.toString?.(),
    tenantId: tenantId?.toString?.() || String(tenantId),
    paymentMethodId: cleanPaymentMethodId,
    installments: validatedInstallments,
    issuerId: parsedIssuerId,
    binaryMode,
    hasNotificationUrl: Boolean(notificationUrl),
    transactionAmount,
  })

  return {
    paymentData,
    transactionAmount,
    validatedInstallments,
  }
}

// =====================================================
// ERROR MAPPING
// =====================================================

export const mapMercadoPagoError = error => {
  const combined = extractProviderMessage(error)
  const status = getProviderStatus(error)

  logger.error('❌ Mercado Pago raw error mapeado', {
    status,
    message: error?.message || null,
    code: error?.code || null,
    cause: Array.isArray(error?.cause)
      ? error.cause.map(item => ({
        code: item?.code,
        description: item?.description,
      }))
      : null,
    apiResponseStatus: error?.api_response?.status || null,
    apiResponseMessage: error?.api_response?.message || null,
    responseStatus: error?.response?.status || null,
    responseData: error?.response?.data
      ? {
        message: error.response.data.message,
        error: error.response.data.error,
        status: error.response.data.status,
        status_detail: error.response.data.status_detail,
      }
      : null,
  })

  if (
    error?.code === 'MP_CREDENTIALS_NOT_FOUND' ||
    error?.code === 'MP_MODE_MISMATCH' ||
    error?.message?.includes('MP_MODE_MISMATCH')
  ) {
    return {
      status: 503,
      code: error.code || 'MP_CREDENTIALS_INVALID',
      message: 'Mercado Pago no está configurado correctamente para este comercio.',
      details: getSafeProviderDetails(error),
    }
  }

  if (
    combined.includes('invalid access token') ||
    combined.includes('access_token') ||
    combined.includes('must provide your access_token') ||
    combined.includes('unauthorized use of live credentials') ||
    combined.includes('unauthorized') ||
    status === 401
  ) {
    return {
      status: 503,
      code: 'MP_ACCESS_TOKEN_INVALID',
      message: 'Mercado Pago no está configurado correctamente para este comercio.',
      details:
        'El Access Token del backend es inválido, vencido o no pertenece a esta integración.',
    }
  }

  if (
    combined.includes('public_key') ||
    combined.includes('collector_id') ||
    combined.includes('invalid users involved') ||
    combined.includes('credentials')
  ) {
    return {
      status: 503,
      code: 'MP_CREDENTIALS_INVALID',
      message: 'Mercado Pago no está configurado correctamente para este comercio.',
      details:
        'Las credenciales públicas/privadas del comercio no corresponden a la misma cuenta o ambiente.',
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
      details: 'Error con el token de tarjeta. Generá un nuevo intento de pago.',
    }
  }

  if (
    combined.includes('security_code') ||
    combined.includes('cvv') ||
    combined.includes('security code')
  ) {
    return {
      status: 400,
      code: 'CARD_CVV_INVALID',
      message: 'Código de seguridad inválido.',
      details: 'Verificá el CVV de la tarjeta.',
    }
  }

  if (
    combined.includes('insufficient_amount') ||
    combined.includes('transaction_amount') ||
    combined.includes('invalid amount') ||
    combined.includes('amount must be')
  ) {
    return {
      status: 400,
      code: 'PAYMENT_AMOUNT_INVALID',
      message: 'Monto de pago inválido.',
      details: getSafeProviderDetails(error),
    }
  }

  if (
    combined.includes('payer.email') ||
    combined.includes('payer email') ||
    combined.includes('invalid email')
  ) {
    return {
      status: 400,
      code: 'PAYER_EMAIL_INVALID',
      message: 'Email del pagador inválido.',
      details: 'Verificá el email informado para el pago.',
    }
  }

  if (
    combined.includes('payment_method_id') ||
    combined.includes('payment method') ||
    combined.includes('invalid payment')
  ) {
    return {
      status: 400,
      code: 'PAYMENT_METHOD_INVALID',
      message: 'Medio de pago inválido.',
      details: 'El medio de pago seleccionado no está disponible.',
    }
  }

  if (
    combined.includes('installments') ||
    combined.includes('installment')
  ) {
    return {
      status: 400,
      code: 'INSTALLMENTS_INVALID',
      message: 'Cantidad de cuotas inválida.',
      details: 'La cantidad de cuotas seleccionada no está disponible.',
    }
  }

  if (
    combined.includes('buyer and seller must be different') ||
    combined.includes('cannot operate between users') ||
    combined.includes('same user') ||
    combined.includes('same account')
  ) {
    return {
      status: 400,
      code: 'MP_BUYER_SELLER_SAME_ACCOUNT',
      message: 'El comprador y el vendedor no pueden ser la misma cuenta.',
      details:
        'Usá un usuario comprador de prueba distinto al usuario vendedor de Mercado Pago.',
    }
  }

  if (
    combined.includes('cc_rejected') ||
    combined.includes('card_disabled') ||
    combined.includes('card rejected') ||
    combined.includes('rejected')
  ) {
    return {
      status: 400,
      code: 'CARD_REJECTED',
      message: 'La tarjeta fue rechazada.',
      details:
        'Probá con otra tarjeta de prueba o revisá los datos ingresados.',
    }
  }

  if (
    combined.includes('internal_error') ||
    combined.includes('internal server error')
  ) {
    return {
      status: 503,
      code: 'MP_INTERNAL_ERROR',
      message: 'Mercado Pago no pudo procesar el pago en este momento.',
      details:
        'El proveedor devolvió internal_error. Verificá credenciales TEST/LIVE, usuario comprador/vendedor y tarjeta de prueba.',
    }
  }

  if (
    combined.includes('rate limit') ||
    combined.includes('too many request') ||
    status === 429
  ) {
    return {
      status: 429,
      code: 'MP_RATE_LIMITED',
      message: 'Mercado Pago está limitando temporalmente los intentos.',
      details: 'Esperá unos segundos y volvé a intentar.',
    }
  }

  if (status >= 500) {
    return {
      status: 503,
      code: 'MP_PROVIDER_UNAVAILABLE',
      message: 'Mercado Pago no está disponible temporalmente.',
      details: 'Intentá nuevamente en unos minutos.',
    }
  }

  return {
    status: 400,
    code: error?.code || 'PAYMENT_ERROR',
    message: 'No se pudo procesar el pago.',
    details: getSafeProviderDetails(error),
  }
}
