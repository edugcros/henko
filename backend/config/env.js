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

const optionalNumber = (key, fallback) => {
  const value = process.env[key]

  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return parsed
}

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

const normalizeUrl = value => {
  const clean = String(value || '').trim()
  if (!clean) return ''
  return clean.replace(/\/+$/, '')
}

const normalizeHostname = value => {
  const clean = String(value || '').trim()
  if (!clean) return ''

  return clean
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/^\.+/, '')
    .replace(/:\d+$/, match => match)
    .toLowerCase()
}

const normalizeSameSite = value => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()

  if (normalized === 'none') return 'None'
  if (normalized === 'lax') return 'Lax'
  if (normalized === 'strict') return 'Strict'

  return process.env.NODE_ENV === 'production' ? 'None' : 'Lax'
}

const getFirstValue = (...values) => {
  return values.find(
    value => value !== undefined && value !== null && value !== '',
  )
}

const requiredNumber = key => {
  const value = process.env[key]

  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Variable numérica requerida faltante: ${key}`)
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new Error(`Variable numérica inválida: ${key}`)
  }

  return parsed
}

const requiredBase = ['NODE_ENV', 'PORT', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET']

const missingBase = requiredBase.filter(key => !process.env[key])

if (missingBase.length > 0) {
  throw new Error(`Variables de entorno faltantes: ${missingBase.join(', ')}`)
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
  mongoEnableTransactions: parseBoolean(
    process.env.MONGO_ENABLE_TRANSACTIONS,
    process.env.NODE_ENV === 'production',
  ),

  // Auth
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessExpires: getFirstValue(
    process.env.JWT_ACCESS_EXPIRES,
    process.env.JWT_EXPIRES_IN,
    '15m',
  ),

  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET,
  jwtIssuer: getFirstValue(
    process.env.JWT_ISSUER,
    'commerce-platform-api',
  ),
  jwtAudience: getFirstValue(
    process.env.JWT_AUDIENCE,
    'commerce-platform-client',
  ),
  jwtRefreshExpires: getFirstValue(
    process.env.JWT_REFRESH_EXPIRES,
    process.env.REFRESH_TOKEN_EXPIRES_IN,
    '7d',
  ),

  resetKey: process.env.RESET_KEY,
  cookieSecret: getFirstValue(
    process.env.COOKIE_SECRET,
    process.env.JWT_SECRET,
  ),

  // Domains SaaS
  rootDomain: normalizeHostname(
    getFirstValue(process.env.ROOT_DOMAIN, process.env.PRODUCTION_DOMAIN),
  ),
  publicBaseDomain: normalizeHostname(
    getFirstValue(
      process.env.PUBLIC_BASE_DOMAIN,
      process.env.PRODUCTION_DOMAIN,
    ),
  ),
  adminBaseDomain: normalizeHostname(process.env.ADMIN_BASE_DOMAIN),
  apiDomain: normalizeHostname(process.env.API_DOMAIN),

  clientUrl: normalizeUrl(
    getFirstValue(process.env.CLIENT_URL, process.env.SHOP_FRONTEND_URL),
  ),
  shopFrontendUrl: normalizeUrl(
    getFirstValue(process.env.SHOP_FRONTEND_URL, process.env.CLIENT_URL),
  ),
  adminUrl: normalizeUrl(
    getFirstValue(process.env.ADMIN_URL, process.env.ADMIN_FRONTEND_URL),
  ),
  adminFrontendUrl: normalizeUrl(
    getFirstValue(process.env.ADMIN_FRONTEND_URL, process.env.ADMIN_URL),
  ),
  apiUrl: normalizeUrl(
    getFirstValue(process.env.API_URL, process.env.BACKEND_URL),
  ),
  backendUrl: normalizeUrl(
    getFirstValue(process.env.BACKEND_URL, process.env.API_URL),
  ),

  // CORS
  corsAllowAll: parseBoolean(process.env.CORS_ALLOW_ALL, false),
  corsCredentials: parseBoolean(process.env.CORS_CREDENTIALS, true),
  allowedOrigins: parseList(process.env.ALLOWED_ORIGINS),
  allowedRootDomains: parseList(process.env.ALLOWED_ROOT_DOMAINS),

  allowLocalhost: parseBoolean(process.env.ALLOW_LOCALHOST, false),
  allowCustomDomains: parseBoolean(process.env.ALLOW_CUSTOM_DOMAINS, true),
  allowDynamicTenantOrigins: parseBoolean(
    process.env.ALLOW_DYNAMIC_TENANT_ORIGINS,
    true,
  ),

  // Tenant
  tenantHeader: process.env.TENANT_HEADER || 'x-tenant-domain',
  tenantAllowSubdomains: parseBoolean(
    process.env.TENANT_ALLOW_SUBDOMAINS,
    true,
  ),
  tenantAllowCustomDomains: parseBoolean(
    process.env.TENANT_ALLOW_CUSTOM_DOMAINS,
    true,
  ),
  tenantPublicBaseDomain: normalizeHostname(
    getFirstValue(
      process.env.TENANT_PUBLIC_BASE_DOMAIN,
      process.env.PUBLIC_BASE_DOMAIN,
      process.env.PRODUCTION_DOMAIN,
    ),
  ),
  tenantAdminBaseDomain: normalizeHostname(
    getFirstValue(
      process.env.TENANT_ADMIN_BASE_DOMAIN,
      process.env.ADMIN_BASE_DOMAIN,
    ),
  ),

  // Cookies
  cookieSecure: parseBoolean(
    process.env.COOKIE_SECURE,
    process.env.NODE_ENV === 'production',
  ),
  cookieHttpOnly: parseBoolean(process.env.COOKIE_HTTP_ONLY, true),
  cookieSameSite: normalizeSameSite(process.env.COOKIE_SAME_SITE),
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  allowDynamicCookieDomain: parseBoolean(
    process.env.ALLOW_DYNAMIC_COOKIE_DOMAIN,
    true,
  ),

  // CSRF
  csrfEnabled: parseBoolean(process.env.CSRF_ENABLED, true),
  csrfCookieName: process.env.CSRF_COOKIE_NAME || 'XSRF-TOKEN',
  csrfHeaderName: process.env.CSRF_HEADER_NAME || 'x-csrf-token',
  csrfCookieSecure: parseBoolean(
    process.env.CSRF_COOKIE_SECURE,
    process.env.NODE_ENV === 'production',
  ),
  csrfCookieSameSite: normalizeSameSite(process.env.CSRF_COOKIE_SAME_SITE),

  // Security
  trustProxy: parseBoolean(
    process.env.TRUST_PROXY,
    process.env.NODE_ENV === 'production',
  ),
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
    folder: process.env.CLOUDINARY_FOLDER || 'commerce-platform',
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
    testPayerEmail: getFirstValue(
      process.env.MP_TEST_PAYER_EMAIL,
      process.env.MERCADOPAGO_TEST_PAYER_EMAIL,
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
    name: process.env.APP_NAME || 'Commerce Platform API',
    storeName: process.env.STORE_NAME || 'Commerce Store',
    url: process.env.APP_URL,
  },

  // AI
  ai: {
    provider: process.env.LLM_PROVIDER || 'google',
    geminiApiKey: process.env.GEMINI_API_KEY,

    geminiModel: getFirstValue(
      process.env.GEMINI_MODEL,
      process.env.GOOGLE_MODEL,
      'gemini-2.0-flash',
    ),

    geminiImageModel: getFirstValue(
      process.env.GEMINI_IMAGE_MODEL,
      process.env.GOOGLE_IMAGE_MODEL,
      process.env.GEMINI_MODEL,
      process.env.GOOGLE_MODEL,
      'gemini-2.0-flash',
    ),

    googleTextModel: process.env.GOOGLE_TEXT_MODEL || 'gemini-2.0-flash',
    googleImageModel: process.env.GOOGLE_IMAGE_MODEL || 'gemini-2.0-flash',
    minConfidence: Number(process.env.AI_MIN_CONFIDENCE || 0.65),
  },

  aiAgent: {
    provider: process.env.AI_AGENT_PROVIDER || 'gemini',
    debug: parseBoolean(process.env.AI_AGENT_DEBUG, false),
    maxHistoryMessages: Number(process.env.AI_AGENT_MAX_HISTORY_MESSAGES || 12),
    maxStoredMessages: Number(process.env.AI_AGENT_MAX_STORED_MESSAGES || 200),
    maxOutputTokens: Number(process.env.AI_AGENT_MAX_OUTPUT_TOKENS || 1200),
    maxSystemPromptChars: Number(
      process.env.AI_AGENT_MAX_SYSTEM_PROMPT_CHARS || 50000,
    ),
    topP: Number(process.env.AI_AGENT_TOP_P || 0.9),
    topK: Number(process.env.AI_AGENT_TOP_K || 40),
    llmTimeoutMs: Number(process.env.AI_AGENT_LLM_TIMEOUT_MS || 15000),
    llmMaxAttempts: Number(process.env.AI_AGENT_LLM_MAX_ATTEMPTS || 3),
    catalogSnapshotTtlMs: Number(
      process.env.AI_CATALOG_SNAPSHOT_TTL_MS || 60000,
    ),
    cartRecoveryLeaseMs: Number(
      process.env.AI_CART_RECOVERY_LEASE_MS || 120000,
    ),
    allowGlobalStorefrontUrl: parseBoolean(
      process.env.AI_ALLOW_GLOBAL_STOREFRONT_URL,
      false,
    ),
    allowLegacyPlaintextSecrets: parseBoolean(
      process.env.AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS,
      process.env.NODE_ENV !== 'production',
    ),
    secretEncryptionKey: process.env.AI_AGENT_SECRET_ENCRYPTION_KEY,
  },

  whatsapp: {
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || 'v20.0',
    apiTimeoutMs: Number(process.env.WHATSAPP_API_TIMEOUT_MS || 15000),
    apiMaxAttempts: Number(process.env.WHATSAPP_API_MAX_ATTEMPTS || 3),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  },

  productAnalysis: {
    agentKeysJson: process.env.PRODUCT_ANALYSIS_AGENT_KEYS_JSON,
    rateLimitWindowMs: Number(
      process.env.PRODUCT_ANALYSIS_RATE_LIMIT_WINDOW_MS || 900000,
    ),
    rateLimitMax: Number(process.env.PRODUCT_ANALYSIS_RATE_LIMIT_MAX || 240),
    autoPublishMinConfidence: Number(
      process.env.AI_AUTO_PUBLISH_MIN_CONFIDENCE || 0.9,
    ),
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

  metrics: {
    abandonedCartMinutes: optionalNumber('METRICS_ABANDONED_CART_MINUTES', 60),
    lowStockThreshold: optionalNumber('METRICS_LOW_STOCK_THRESHOLD', 5),
    latestAbandonedCartsLimit: optionalNumber(
      'METRICS_LATEST_ABANDONED_CARTS_LIMIT',
      10,
    ),
    abandonedCartProductPreviewLimit: optionalNumber(
      'METRICS_ABANDONED_CART_PRODUCT_PREVIEW_LIMIT',
      3,
    ),
    topProductsLimit: optionalNumber('METRICS_TOP_PRODUCTS_LIMIT', 10),
    topPagesLimit: optionalNumber('METRICS_TOP_PAGES_LIMIT', 10),
    topSearchesLimit: optionalNumber('METRICS_TOP_SEARCHES_LIMIT', 10),
    trafficSourcesLimit: optionalNumber('METRICS_TRAFFIC_SOURCES_LIMIT', 10),
    eventBatchMax: optionalNumber('METRICS_EVENT_BATCH_MAX', 50),
    internalPeriodDays: optionalNumber('METRICS_INTERNAL_PERIOD_DAYS', 30),
    ga4ProductPerformanceLimit: optionalNumber(
      'METRICS_GA4_PRODUCT_PERFORMANCE_LIMIT',
      10,
    ),
    realtimeWindowMinutes: optionalNumber('METRICS_REALTIME_WINDOW_MINUTES', 5),
  },

  logLevel: process.env.LOG_LEVEL || 'info',
}

// =====================================================
// Validaciones base
// =====================================================

if (!env.mongoUri) {
  throw new Error('Falta MONGODB_URL o MONGO_URI')
}

if (!env.cookieSecret) {
  throw new Error('Falta COOKIE_SECRET o JWT_SECRET para firmar cookies')
}

const ensureUrlMatchesHostname = (label, urlValue, hostnameValue) => {
  if (!urlValue || !hostnameValue) return

  let parsedHostname = ''
  try {
    parsedHostname = new URL(urlValue).hostname.toLowerCase()
  } catch {
    throw new Error(`${label} inválida: ${urlValue}`)
  }

  const normalizedHost = normalizeHostname(hostnameValue)

  if (parsedHostname !== normalizedHost) {
    throw new Error(
      `${label} debe apuntar a ${normalizedHost} y actualmente apunta a ${parsedHostname}`,
    )
  }
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
    ['PRODUCT_ANALYSIS_AGENT_KEYS_JSON', env.productAnalysis.agentKeysJson],
    ['AI_AGENT_SECRET_ENCRYPTION_KEY', env.aiAgent.secretEncryptionKey],
    ['WHATSAPP_VERIFY_TOKEN', env.whatsapp.verifyToken],
  ]

  const missingProduction = requiredProduction
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingProduction.length > 0) {
    throw new Error(
      `Variables requeridas para producción faltantes: ${missingProduction.join(', ')}`,
    )
  }

  ensureUrlMatchesHostname(
    'CLIENT_URL / SHOP_FRONTEND_URL',
    env.clientUrl,
    env.publicBaseDomain,
  )
  ensureUrlMatchesHostname(
    'ADMIN_URL / ADMIN_FRONTEND_URL',
    env.adminUrl,
    env.adminBaseDomain,
  )
  ensureUrlMatchesHostname('BACKEND_URL', env.backendUrl, env.apiDomain)

  if (
    env.apiUrl &&
    !env.apiUrl.startsWith(`${env.backendUrl}${env.apiPrefix}`)
  ) {
    throw new Error(
      `API_URL debe derivar de BACKEND_URL + API_PREFIX. Recibido: ${env.apiUrl}`,
    )
  }

  if (
    env.tenantAllowSubdomains &&
    !env.publicBaseDomain.endsWith(env.rootDomain)
  ) {
    throw new Error(
      'PUBLIC_BASE_DOMAIN debe pertenecer al ROOT_DOMAIN cuando TENANT_ALLOW_SUBDOMAINS=true',
    )
  }

  if (
    env.tenantAllowSubdomains &&
    !env.adminBaseDomain.endsWith(env.rootDomain)
  ) {
    throw new Error(
      'ADMIN_BASE_DOMAIN debe pertenecer al ROOT_DOMAIN cuando TENANT_ALLOW_SUBDOMAINS=true',
    )
  }

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

  Object.entries(dangerousVars).forEach(([, value]) => {
    if (!value) return
  })

  /*if (env.corsAllowAll) {
    throw new Error('CORS_ALLOW_ALL=true no está permitido en producción')
  }*/

  if (env.disableSslVerify) {
    throw new Error('DISABLE_SSL_VERIFY=true no está permitido en producción')
  }

  const mpAccessToken = String(env.mercadoPago.accessToken || '').trim()

  /*if (mpAccessToken.startsWith('TEST-')) {
    throw new Error(
      'MP_ACCESS_TOKEN de prueba no está permitido en producción',
    )
  }*/

  /*if (mpAccessToken && !mpAccessToken.startsWith('APP_USR-')) {
    throw new Error(
      'MP_ACCESS_TOKEN debe ser una credencial productiva APP_USR- en producción',
    )
  }*/

  if (!env.cookieSecure) {
    throw new Error('COOKIE_SECURE=false no está permitido en producción')
  }

  if (env.cookieSameSite !== 'None') {
    throw new Error(
      'COOKIE_SAME_SITE debe ser None en producción si usás dominios cruzados',
    )
  }

  if (!env.csrfCookieSecure) {
    throw new Error('CSRF_COOKIE_SECURE=false no está permitido en producción')
  }

 /* if (env.allowLocalhost) {
    throw new Error('ALLOW_LOCALHOST=true no está permitido en producción')
  }*/

  /*if (process.env.PRODUCT_ANALYSIS_AGENT_KEY) {
    throw new Error(
      'PRODUCT_ANALYSIS_AGENT_KEY global no está permitido en producción; use PRODUCT_ANALYSIS_AGENT_KEYS_JSON',
    )
  }*/

  let productAnalysisAgentKeys
  try {
    productAnalysisAgentKeys = JSON.parse(env.productAnalysis.agentKeysJson)
  } catch {
    throw new Error(
      'PRODUCT_ANALYSIS_AGENT_KEYS_JSON debe contener JSON válido',
    )
  }

  const invalidAgentKeys = Object.entries(
    productAnalysisAgentKeys || {},
  ).filter(
    ([domain, keyHash]) =>
      !normalizeHostname(domain) ||
      !/^[a-f0-9]{64}$/i.test(String(keyHash || '').trim()),
  )

  if (
    !productAnalysisAgentKeys ||
    Array.isArray(productAnalysisAgentKeys) ||
    Object.keys(productAnalysisAgentKeys).length === 0 ||
    invalidAgentKeys.length > 0
  ) {
    throw new Error(
      'PRODUCT_ANALYSIS_AGENT_KEYS_JSON debe mapear cada dominio a un hash SHA-256',
    )
  }
}

export default env
