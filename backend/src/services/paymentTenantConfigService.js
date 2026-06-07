import { MercadoPagoConfig, Payment } from 'mercadopago'

import Tenant from '../models/tenantModel.js'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const isProd = process.env.NODE_ENV === 'production'

const MP_TOKEN_PLACEHOLDERS = [
  'APP_USR_TU_ACCESS_TOKEN_REAL',
  'APP_USR_ACCESS_TOKEN_REAL',
  'APP_USR_ACCESS_TOKEN_REAL_COPIADO_DESDE_MERCADO_PAGO',
  'TEST_TU_ACCESS_TOKEN_REAL',
  'TEST_ACCESS_TOKEN_REAL',
  'TU_ACCESS_TOKEN',
  'YOUR_ACCESS_TOKEN',
  'ACCESS_TOKEN_REAL',
  'REEMPLAZAR',
  'REPLACE_ME',
  'PEGAR_ACA',
]

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const getSafeErrorMessage = error => {
  return error?.message || 'Error inesperado'
}

const getMpTokenPrefix = token => {
  const clean = sanitizeString(token)
  if (!clean) return null
  return clean.slice(0, 14)
}

const hasPlaceholder = value => {
  const clean = sanitizeString(value).toUpperCase()

  return MP_TOKEN_PLACEHOLDERS.some(placeholder => {
    return clean.includes(placeholder.toUpperCase())
  })
}

const isValidMpAccessToken = token => {
  const clean = sanitizeString(token)

  if (!clean) return false
  if (hasPlaceholder(clean)) return false

  return clean.startsWith('APP_USR-') || clean.startsWith('TEST-')
}

const inferMpTokenMode = token => {
  const clean = sanitizeString(token)

  if (clean.startsWith('APP_USR-')) return 'production'
  if (clean.startsWith('TEST-')) return 'test'

  return null
}

const inferMpPublicKeyMode = publicKey => {
  const clean = sanitizeString(publicKey)

  if (clean.startsWith('TEST-')) return 'test'
  if (clean.startsWith('APP_USR-')) return 'production'

  return null
}

const assertCompatibleMpMode = ({ token, tenantMode }) => {
  const tokenMode = inferMpTokenMode(token)

  if (!tokenMode) {
    const error = new Error('MP_ACCESS_TOKEN_INVALID_FORMAT')
    error.statusCode = 500
    throw error
  }

  if (tenantMode && ['test', 'production'].includes(tenantMode)) {
    if (tenantMode !== tokenMode) {
      const error = new Error(
        `MP_MODE_MISMATCH: tenant=${tenantMode}, token=${tokenMode}`,
      )
      error.statusCode = 500
      throw error
    }
  }

  return true
}

export const getTenantConfig = async tenantId => {
  try {
    const tenant = await Tenant.findById(tenantId).lean()

    if (!tenant) {
      return {
        storeName:
          sanitizeString(process.env.STORE_NAME) ||
          sanitizeString(process.env.APP_NAME) ||
          'Tienda',
        storeLogo: sanitizeString(process.env.EMAIL_LOGO_URL) || null,
        adminEmail: normalizeEmail(process.env.ADMIN_EMAIL) || null,
        primaryColor:
          sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
          '#111827',
        currency:
          sanitizeString(process.env.DEFAULT_CURRENCY) ||
          'ARS',
      }
    }

    return {
      storeName:
        sanitizeString(tenant.name) ||
        sanitizeString(tenant.general?.storeName) ||
        sanitizeString(process.env.STORE_NAME) ||
        sanitizeString(process.env.APP_NAME) ||
        'Tienda',
      storeLogo:
        sanitizeString(tenant.settings?.branding?.logoUrl) ||
        sanitizeString(tenant.general?.logo) ||
        sanitizeString(process.env.EMAIL_LOGO_URL) ||
        null,
      adminEmail:
        normalizeEmail(tenant.adminEmail) ||
        normalizeEmail(tenant.settings?.store?.contactEmail) ||
        normalizeEmail(tenant.footer?.email) ||
        normalizeEmail(process.env.ADMIN_EMAIL) ||
        null,
      primaryColor:
        sanitizeString(tenant.settings?.branding?.primaryColor) ||
        sanitizeString(tenant.colors?.primary) ||
        sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
        '#111827',
      currency:
        sanitizeString(tenant.currency) ||
        sanitizeString(tenant.settings?.checkout?.defaultCurrency) ||
        sanitizeString(process.env.DEFAULT_CURRENCY) ||
        'ARS',
      supportEmail:
        normalizeEmail(tenant.settings?.store?.contactEmail) ||
        normalizeEmail(tenant.footer?.email) ||
        normalizeEmail(process.env.SUPPORT_EMAIL) ||
        normalizeEmail(process.env.EMAIL_FROM) ||
        normalizeEmail(process.env.EMAIL_USER) ||
        null,
      storeUrl:
        sanitizeString(tenant.primaryDomain) ||
        sanitizeString(env.clientUrl) ||
        sanitizeString(env.shopFrontendUrl) ||
        '',
    }
  } catch (error) {
    logger.error('❌ Error obteniendo config de tenant', {
      message: getSafeErrorMessage(error),
      tenantId: String(tenantId),
    })

    return {
      storeName:
        sanitizeString(process.env.STORE_NAME) ||
        sanitizeString(process.env.APP_NAME) ||
        'Tienda',
      storeLogo: sanitizeString(process.env.EMAIL_LOGO_URL) || null,
      adminEmail: normalizeEmail(process.env.ADMIN_EMAIL) || null,
      primaryColor:
        sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
        '#111827',
      currency:
        sanitizeString(process.env.DEFAULT_CURRENCY) ||
        'ARS',
    }
  }
}

export const getTenantToken = async tenantId => {
  try {
    const tenant = await Tenant.findById(tenantId)
      .select(
        '+integrations.mercadopago.accessToken integrations.mercadopago.publicKey integrations.mercadopago.isEnabled integrations.mercadopago.mode',
      )
      .lean()

    const mercadoPago = tenant?.integrations?.mercadopago || {}

    const tenantToken = sanitizeString(mercadoPago.accessToken)
    const envToken = sanitizeString(env.mercadoPago?.accessToken)

    const tenantTokenIsValid = isValidMpAccessToken(tenantToken)
    const envTokenIsValid = isValidMpAccessToken(envToken)

    logger.info('🔐 Resolviendo token Mercado Pago', {
      tenantId: tenant?._id?.toString?.() || null,
      mpEnabled: Boolean(mercadoPago.isEnabled),
      mpMode: mercadoPago.mode || null,
      hasTenantToken: tenantTokenIsValid,
      tenantTokenPrefix: tenantTokenIsValid ? getMpTokenPrefix(tenantToken) : null,
      hasEnvToken: envTokenIsValid,
      envTokenPrefix: envTokenIsValid ? getMpTokenPrefix(envToken) : null,
      nodeEnv: process.env.NODE_ENV,
    })

    if (mercadoPago.isEnabled && tenantToken) {
      if (!tenantTokenIsValid) {
        const error = new Error(
          'Mercado Pago del tenant tiene un Access Token inválido o placeholder',
        )
        error.statusCode = 500
        throw error
      }

      assertCompatibleMpMode({
        token: tenantToken,
        tenantMode: mercadoPago.mode,
      })

      return tenantToken
    }

    if (!isProd && envTokenIsValid) {
      logger.warn('⚠️ Usando MP_ACCESS_TOKEN global por fallback en desarrollo', {
        tenantId: tenant?._id?.toString?.() || null,
        envTokenPrefix: getMpTokenPrefix(envToken),
      })

      return envToken
    }

    const error = new Error('Mercado Pago no está configurado para este comercio')
    error.statusCode = 400
    throw error
  } catch (error) {
    logger.error('❌ Error obteniendo token Mercado Pago', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
      statusCode: error.statusCode,
    })

    return null
  }
}

export const getTenantPaymentPublicConfig = async tenantId => {
  const tenant = await Tenant.findById(tenantId)
    .select(
      'integrations.mercadopago.publicKey integrations.mercadopago.isEnabled integrations.mercadopago.mode',
    )
    .lean()

  if (!tenant) {
    const error = new Error('Comercio no encontrado')
    error.statusCode = 404
    throw error
  }

  const mercadoPago = tenant.integrations?.mercadopago || {}
  const tenantPublicKey = sanitizeString(mercadoPago.publicKey)
  const envPublicKey = sanitizeString(env.mercadoPago?.publicKey)
  const publicKey =
    mercadoPago.isEnabled && tenantPublicKey
      ? tenantPublicKey
      : !isProd
        ? envPublicKey
        : ''
  const mode = inferMpPublicKeyMode(publicKey)

  if (!publicKey || !mode) {
    const error = new Error(
      'Mercado Pago no tiene una Public Key válida para este comercio',
    )
    error.statusCode = 503
    throw error
  }

  if (
    mercadoPago.mode &&
    ['test', 'production'].includes(mercadoPago.mode) &&
    mercadoPago.mode !== mode
  ) {
    const error = new Error(
      `MP_MODE_MISMATCH: tenant=${mercadoPago.mode}, publicKey=${mode}`,
    )
    error.statusCode = 503
    throw error
  }

  return {
    enabled: Boolean(mercadoPago.isEnabled || (!isProd && envPublicKey)),
    publicKey,
    mode,
  }
}

export const createMercadoPagoPaymentClient = accessToken => {
  if (!isValidMpAccessToken(accessToken)) {
    const error = new Error('MP_ACCESS_TOKEN_INVALID')
    error.statusCode = 500
    throw error
  }

  const client = new MercadoPagoConfig({
    accessToken,
    options: {
      timeout: 15000,
    },
  })

  return new Payment(client)
}
