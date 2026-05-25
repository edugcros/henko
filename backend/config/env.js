// 📁 config/env.js
import dotenv from 'dotenv'

const envFile =
  process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development'

dotenv.config({ path: envFile })

// =====================================================
// Helpers
// =====================================================

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

const parseList = value => {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

const normalizeSameSite = value => {
  const normalized = String(value || '').trim().toLowerCase()

  if (normalized === 'none') return 'None'
  if (normalized === 'lax') return 'Lax'
  if (normalized === 'strict') return 'Strict'

  return process.env.NODE_ENV === 'production' ? 'None' : 'Lax'
}

const getFirstValue = (...values) => {
  return values.find(value => value !== undefined && value !== null && value !== '')
}

const requiredBase = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'REFRESH_TOKEN_SECRET',
]

const missingBase = requiredBase.filter(key => !process.env[key])

if (missingBase.length > 0) {
  Error(`Variables de entorno faltantes: ${missingBase.join(', ')}`)
}

// =====================================================
// ENV
// =====================================================

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',

  port: Number(process.env.PORT || 5000),
  apiPrefix: process.env.API_PREFIX || '/api',

  // DB
  mongoUri: getFirstValue(process.env.MONGODB_URL, process.env.MONGO_URI),
  mongoEnableTransactions: parseBoolean(process.env.MONGO_ENABLE_TRANSACTIONS, process.env.NODE_ENV === 'production'),

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessExpires: getFirstValue(
    process.env.JWT_ACCESS_EXPIRES,
    process.env.JWT_EXPIRES_IN,
    '15m',
  ),

  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET,
  jwtRefreshExpires: getFirstValue(
    process.env.JWT_REFRESH_EXPIRES,
    process.env.REFRESH_TOKEN_EXPIRES_IN,
    '7d',
  ),

  resetKey: process.env.RESET_KEY,
  cookieSecret: getFirstValue(process.env.COOKIE_SECRET, process.env.JWT_SECRET),

  // Domains SaaS
  rootDomain: getFirstValue(process.env.ROOT_DOMAIN, process.env.PRODUCTION_DOMAIN),
  publicBaseDomain: getFirstValue(process.env.PUBLIC_BASE_DOMAIN, process.env.PRODUCTION_DOMAIN),
  adminBaseDomain: process.env.ADMIN_BASE_DOMAIN,
  apiDomain: process.env.API_DOMAIN,

  clientUrl: getFirstValue(process.env.CLIENT_URL, process.env.SHOP_FRONTEND_URL),
  adminUrl: getFirstValue(process.env.ADMIN_URL, process.env.ADMIN_FRONTEND_URL),
  apiUrl: getFirstValue(process.env.API_URL, process.env.BACKEND_URL),
  backendUrl: getFirstValue(process.env.BACKEND_URL, process.env.API_URL),

  // CORS
  corsAllowAll: parseBoolean(process.env.CORS_ALLOW_ALL, false),
  corsCredentials: parseBoolean(process.env.CORS_CREDENTIALS, true),
  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),
  allowedRootDomains: parseList(process.env.ALLOWED_ROOT_DOMAINS),

  allowLocalhost: parseBoolean(process.env.ALLOW_LOCALHOST, false),
  allowCustomDomains: parseBoolean(process.env.ALLOW_CUSTOM_DOMAINS, true),
  allowDynamicTenantOrigins: parseBoolean(process.env.ALLOW_DYNAMIC_TENANT_ORIGINS, true),

  // Tenant
  tenantHeader: process.env.TENANT_HEADER || 'x-tenant-domain',
  tenantAllowSubdomains: parseBoolean(process.env.TENANT_ALLOW_SUBDOMAINS, true),
  tenantAllowCustomDomains: parseBoolean(process.env.TENANT_ALLOW_CUSTOM_DOMAINS, true),
  tenantPublicBaseDomain: getFirstValue(process.env.TENANT_PUBLIC_BASE_DOMAIN, process.env.PUBLIC_BASE_DOMAIN, process.env.PRODUCTION_DOMAIN),
  tenantAdminBaseDomain: getFirstValue(process.env.TENANT_ADMIN_BASE_DOMAIN, process.env.ADMIN_BASE_DOMAIN),

  // Cookies
  cookieSecure: parseBoolean(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  cookieHttpOnly: parseBoolean(process.env.COOKIE_HTTP_ONLY, true),
  cookieSameSite: normalizeSameSite(process.env.COOKIE_SAME_SITE),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  allowDynamicCookieDomain: parseBoolean(process.env.ALLOW_DYNAMIC_COOKIE_DOMAIN, true),

  // CSRF
  csrfEnabled: parseBoolean(process.env.CSRF_ENABLED, true),
  csrfCookieName: process.env.CSRF_COOKIE_NAME || 'XSRF-TOKEN',
  csrfHeaderName: process.env.CSRF_HEADER_NAME || 'x-csrf-token',
  csrfCookieSecure: parseBoolean(process.env.CSRF_COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  csrfCookieSameSite: normalizeSameSite(process.env.CSRF_COOKIE_SAME_SITE),

  // Security
  trustProxy: parseBoolean(process.env.TRUST_PROXY, process.env.NODE_ENV === 'production'),
  disableSslVerify: parseBoolean(process.env.DISABLE_SSL_VERIFY, false),

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
    max: Number(process.env.RATE_LIMIT_MAX || 300),
  },

  // Cloudinary
  storageDriver: process.env.STORAGE_DRIVER || 'cloudinary',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    folder: process.env.CLOUDINARY_FOLDER || 'henko-commerce',
  },

  // Mercado Pago
  mercadoPago: {
    accessToken: getFirstValue(
      process.env.MP_ACCESS_TOKEN,
      process.env.MERCADOPAGO_ACCESS_TOKEN,
    ),
    publicKey: getFirstValue(
      process.env.MP_PUBLIC_KEY,
      process.env.MERCADOPAGO_PUBLIC_KEY,
    ),
    webhookSecret: getFirstValue(
      process.env.MP_WEBHOOK_SECRET,
      process.env.MERCADOPAGO_WEBHOOK_SECRET,
    ),
  },

  // Email
  email: {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 465),
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    adminEmail: process.env.ADMIN_EMAIL,
  },

  app: {
    name: process.env.APP_NAME || 'Henko Commerce API',
    storeName: process.env.STORE_NAME || 'Henko Store',
    url: process.env.APP_URL,
  },

  // AI
  ai: {
    provider: process.env.LLM_PROVIDER || 'google',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: getFirstValue(
      process.env.GEMINI_MODEL,
      process.env.GOOGLE_MODEL,
      'models/gemini-2.5-flash',
    ),
    googleTextModel: process.env.GOOGLE_TEXT_MODEL,
    googleImageModel: process.env.GOOGLE_IMAGE_MODEL,
    minConfidence: Number(process.env.AI_MIN_CONFIDENCE || 0.65),
  },

  // Google Analytics Server
  googleAnalytics: {
    propertyId: process.env.GA_PROPERTY_ID,
    projectId: process.env.GA_PROJECT_ID,
    clientEmail: process.env.GA_CLIENT_EMAIL,
    privateKey: process.env.GA_PRIVATE_KEY
      ? process.env.GA_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
  },

  logLevel: process.env.LOG_LEVEL || 'info',
}

// =====================================================
// Validaciones base
// =====================================================

if (!env.mongoUri) {
  Error('Falta MONGODB_URL o MONGO_URI')
}

if (!env.cookieSecret) {
  Error('Falta COOKIE_SECRET o JWT_SECRET para firmar cookies')
}

// =====================================================
// Validaciones producción
// =====================================================

if (env.isProduction) {
  const requiredProduction = [
    ['ROOT_DOMAIN / PRODUCTION_DOMAIN', env.rootDomain],
    ['PUBLIC_BASE_DOMAIN / PRODUCTION_DOMAIN', env.publicBaseDomain],
    ['ADMIN_BASE_DOMAIN', env.adminBaseDomain],
    ['API_DOMAIN', env.apiDomain],
    ['ALLOWED_ROOT_DOMAINS', env.allowedRootDomains.length],
    ['CLIENT_URL / SHOP_FRONTEND_URL', env.clientUrl],
    ['ADMIN_URL / ADMIN_FRONTEND_URL', env.adminUrl],
    ['API_URL / BACKEND_URL', env.apiUrl],
  ]

  const missingProduction = requiredProduction
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingProduction.length > 0) {
    Error(
      `Variables requeridas para producción faltantes: ${missingProduction.join(', ')}`,
    )
  }

  const productionForbiddenValues = [
    'localhost',
    '127.0.0.1',
    'henko.local',
    'ngrok',
  ]

  const dangerousVars = {
    MONGODB_URL: env.mongoUri,
    API_URL: env.apiUrl,
    BACKEND_URL: env.backendUrl,
    CLIENT_URL: env.clientUrl,
    ADMIN_URL: env.adminUrl,
    ROOT_DOMAIN: env.rootDomain,
    PUBLIC_BASE_DOMAIN: env.publicBaseDomain,
    ADMIN_BASE_DOMAIN: env.adminBaseDomain,
    API_DOMAIN: env.apiDomain,
  }

  Object.entries(dangerousVars).forEach(([key, value]) => {
    if (!value) return

    const hasForbiddenValue = productionForbiddenValues.some(forbidden =>
      String(value).includes(forbidden),
    )

    if (hasForbiddenValue) {
      Error(
        `Variable ${key} tiene valor de desarrollo en producción: ${value}`,
      )
    }
  })

  if (env.corsAllowAll) {
    Error('CORS_ALLOW_ALL=true no está permitido en producción')
  }

  if (env.disableSslVerify) {
    Error('DISABLE_SSL_VERIFY=true no está permitido en producción')
  }

  if (String(env.mercadoPago.accessToken || '').startsWith('APP URS-')) {
    Error('MP_ACCESS_TOKEN de APP URS no está permitido en producción')
  }

  if (!env.cookieSecure) {
    Error('COOKIE_SECURE=false no está permitido en producción')
  }

  if (env.cookieSameSite !== 'None') {
    Error('COOKIE_SAME_SITE debe ser None en producción si usás dominios cruzados')
  }

  if (!env.csrfCookieSecure) {
    Error('CSRF_COOKIE_SECURE=false no está permitido en producción')
  }

  if (env.allowLocalhost) {
    Error('ALLOW_LOCALHOST=true no está permitido en producción')
  }
}

export default env