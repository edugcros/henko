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
    const tenant = await Tenant.findById(tenantId)
      .populate({
        path: 'ownerUserId',
        select: 'email',
      })
      .lean()

    if (!tenant) {
      return {
        storeName:
          sanitizeString(process.env.STORE_NAME) ||
          sanitizeString(process.env.APP_NAME) ||
          'Tienda',
        storeLogo: sanitizeString(process.env.EMAIL_LOGO_URL) || null,
        adminEmail:
          (!isProd ? normalizeEmail(process.env.ADMIN_EMAIL) : null) ||
          null,
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
        normalizeEmail(tenant.ownerUserId?.email) ||
        normalizeEmail(tenant.settings?.store?.contactEmail) ||
        normalizeEmail(tenant.footer?.email) ||
        (!isProd ? normalizeEmail(process.env.ADMIN_EMAIL) : null) ||
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
      adminEmail:
        (!isProd ? normalizeEmail(process.env.ADMIN_EMAIL) : null) ||
        null,
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
  const context = await getTenantMercadoPagoContext(tenantId)
  return context.accessToken
}

export const getTenantMercadoPagoContext = async tenantId => {
  const tenant = await Tenant.findById(tenantId)
    .select(
      '+integrations.mercadopago.accessToken integrations.mercadopago.publicKey integrations.mercadopago.isEnabled integrations.mercadopago.mode',
    )
    .lean()

  if (!tenant) {
    const error = new Error('Comercio no encontrado')
    error.statusCode = 404
    throw error
  }

  const mercadoPago = tenant.integrations?.mercadopago || {}
  const tenantAccessToken = sanitizeString(mercadoPago.accessToken)
  const tenantPublicKey = sanitizeString(mercadoPago.publicKey)
  const envAccessToken = sanitizeString(env.mercadoPago?.accessToken)
  const envPublicKey = sanitizeString(env.mercadoPago?.publicKey)

  const useTenantCredentials = Boolean(mercadoPago.isEnabled)
  const useDevelopmentFallback = !isProd && !useTenantCredentials

  const accessToken = useTenantCredentials
    ? tenantAccessToken
    : useDevelopmentFallback
      ? envAccessToken
      : ''
  const publicKey = useTenantCredentials
    ? tenantPublicKey
    : useDevelopmentFallback
      ? envPublicKey
      : ''
  const accessTokenMode = inferMpTokenMode(accessToken)
  const publicKeyMode = inferMpPublicKeyMode(publicKey)
  const configuredMode = sanitizeString(mercadoPago.mode)

  logger.info('🔐 Resolviendo credenciales Mercado Pago', {
    tenantId: tenant._id?.toString?.() || String(tenantId),
    source: useTenantCredentials ? 'tenant' : useDevelopmentFallback ? 'development-env' : 'none',
    configuredMode: configuredMode || null,
    accessTokenMode,
    publicKeyMode,
    accessTokenPrefix: isValidMpAccessToken(accessToken)
      ? getMpTokenPrefix(accessToken)
      : null,
    hasPublicKey: Boolean(publicKeyMode),
  })

  if (!isValidMpAccessToken(accessToken) || !publicKey || !publicKeyMode) {
    const error = new Error(
      'Mercado Pago no tiene credenciales válidas para este comercio',
    )
    error.statusCode = 503
    error.code = 'MP_CREDENTIALS_NOT_FOUND'
    throw error
  }

  assertCompatibleMpMode({
    token: accessToken,
    tenantMode: configuredMode || null,
  })

  if (accessTokenMode !== publicKeyMode) {
    const error = new Error(
      `MP_MODE_MISMATCH: accessToken=${accessTokenMode}, publicKey=${publicKeyMode}`,
    )
    error.statusCode = 503
    error.code = 'MP_MODE_MISMATCH'
    throw error
  }

  return {
    enabled: true,
    source: useTenantCredentials ? 'tenant' : 'development-env',
    accessToken,
    publicKey,
    mode: accessTokenMode,
  }
}

export const getTenantPaymentPublicConfig = async tenantId => {
  const context = await getTenantMercadoPagoContext(tenantId)

  return {
    enabled: context.enabled,
    publicKey: context.publicKey,
    mode: context.mode,
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
