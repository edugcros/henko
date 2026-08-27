// 📁 admin/src/config/env.js

const clean = value => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

const cleanUrl = value => {
  const normalized = clean(value)
  if (!normalized) return ''
  return normalized.replace(/\/+$/, '')
}

const bool = (value, fallback = false) => {
  const cleanValue = clean(value)

  if (!cleanValue) return fallback

  return ['true', '1', 'yes', 'on'].includes(cleanValue.toLowerCase())
}

const number = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeDomain = value => {
  const raw = clean(value)

  if (!raw) return ''

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname.toLowerCase()
    }
  } catch {
    // fallback manual
  }

  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^\.+/, '')
    .toLowerCase()
}

const isLocalValue = value => {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|henko\.local|\.local|\.test/i.test(
    clean(value),
  )
}

const isHttpsUrl = value => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const isValidUrl = value => {
  try {
    const url = new URL(value)
    return Boolean(url.protocol && url.hostname)
  } catch {
    return false
  }
}

// REACT_APP_API_BASE_URL puede ser una ruta relativa ("/api") en vez de una
// URL absoluta — es el caso cuando el backend vive en un dominio distinto al
// frontend (Vercel vs. Render, por ejemplo) y se resuelve con un rewrite de
// proxy en vercel.json en vez de pegarle directo. Los navegadores modernos
// bloquean cookies de terceros por default: si el frontend está en
// foo.vercel.app y el backend en bar.onrender.com, cualquier cookie httpOnly
// que el backend intente setear (token/refreshToken/_csrf) es de tercero y
// el navegador la descarta — el login "funciona" pero la sesión nunca
// persiste. Con una ruta relativa, las requests salen hacia el propio
// dominio del frontend y Vercel las reenvía server-side; para el navegador
// nunca salieron de un solo origen, así que las cookies quedan de primera
// parte. Sin dominio propio compartido entre frontend y backend, es la
// única forma de que el login por cookie httpOnly funcione de verdad.
const isRelativeApiPath = value => /^\/(?!\/)/.test(clean(value))

const hasPlaceholder = value => {
  const normalized = clean(value).toUpperCase()

  if (!normalized) return false

  return [
    'CHANGE_ME',
    'REPLACE_ME',
    'REEMPLAZAR',
    'PEGAR_ACA',
    'YOUR_',
    'TU_',
  ].some(token => normalized.includes(token))
}

const getFirst = (...values) => {
  return values.find(value => clean(value))
}

const nodeEnv =
  clean(process.env.REACT_APP_NODE_ENV) ||
  clean(process.env.NODE_ENV) ||
  'development'

const apiBaseUrl = cleanUrl(
  getFirst(process.env.REACT_APP_API_BASE_URL, process.env.REACT_APP_API_URL),
)

const apiUrl = cleanUrl(
  getFirst(process.env.REACT_APP_API_URL, process.env.REACT_APP_API_BASE_URL),
)

const assetsBaseUrl = cleanUrl(process.env.REACT_APP_ASSETS_BASE_URL)

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isDevelopment: nodeEnv !== 'production',

  apiBaseUrl,
  apiUrl,
  assetsBaseUrl,

  storefrontPreviewUrl: cleanUrl(process.env.REACT_APP_STOREFRONT_PREVIEW_URL),

  publicBaseDomain: normalizeDomain(
    getFirst(
      process.env.REACT_APP_PUBLIC_BASE_DOMAIN,
      process.env.REACT_APP_PRODUCTION_DOMAIN,
    ),
  ),

  adminBaseDomain: normalizeDomain(process.env.REACT_APP_ADMIN_BASE_DOMAIN),

  productionDomain: normalizeDomain(process.env.REACT_APP_PRODUCTION_DOMAIN),

  shopPort: number(process.env.REACT_APP_SHOP_PORT, 3002),

  tenantHeader: clean(process.env.REACT_APP_TENANT_HEADER) || 'x-tenant-domain',

  csrfHeaderName:
    clean(process.env.REACT_APP_CSRF_HEADER_NAME) || 'x-csrf-token',

  enableTenantDomainResolution: bool(
    process.env.REACT_APP_ENABLE_TENANT_DOMAIN_RESOLUTION,
    true,
  ),

  enablePromotionalBlocks: bool(
    process.env.REACT_APP_ENABLE_PROMOTIONAL_BLOCKS,
    true,
  ),

  enableAiProductAnalysis: bool(
    process.env.REACT_APP_ENABLE_AI_PRODUCT_ANALYSIS,
    true,
  ),

  enableAiFeatures: bool(process.env.REACT_APP_ENABLE_AI_FEATURES, true),

  debugApi: bool(process.env.REACT_APP_DEBUG_API, false),

  mercadoPagoPublicKey: clean(process.env.REACT_APP_MP_PUBLIC_KEY),

  gaMeasurementId: clean(process.env.REACT_APP_GA_MEASUREMENT_ID),

  // Opcional a propósito: sin esta key el widget de Turnstile simplemente no
  // se renderiza (ver components/TurnstileWidget.jsx) y el alta de tienda
  // sigue funcionando como hoy. No la vuelvas obligatoria en producción sin
  // confirmar antes que el backend tiene TURNSTILE_SECRET_KEY cargada.
  turnstileSiteKey: clean(process.env.REACT_APP_TURNSTILE_SITE_KEY),
}

// =====================================================
// VALIDACIONES BASE
// =====================================================

if (!env.apiBaseUrl) {
  throw new Error('REACT_APP_API_BASE_URL es obligatorio')
}

if (!isRelativeApiPath(env.apiBaseUrl) && !isValidUrl(env.apiBaseUrl)) {
  throw new Error(`REACT_APP_API_BASE_URL inválido: ${env.apiBaseUrl}`)
}

if (!env.apiBaseUrl.endsWith('/api')) {
  throw new Error(
    `REACT_APP_API_BASE_URL debe terminar en /api. Recibido: ${env.apiBaseUrl}`,
  )
}

if (env.apiUrl && !isRelativeApiPath(env.apiUrl) && !isValidUrl(env.apiUrl)) {
  throw new Error(`REACT_APP_API_URL inválido: ${env.apiUrl}`)
}

if (env.assetsBaseUrl && !isValidUrl(env.assetsBaseUrl)) {
  throw new Error(`REACT_APP_ASSETS_BASE_URL inválido: ${env.assetsBaseUrl}`)
}

if (!env.tenantHeader) {
  throw new Error('REACT_APP_TENANT_HEADER es obligatorio')
}

if (!env.csrfHeaderName) {
  throw new Error('REACT_APP_CSRF_HEADER_NAME es obligatorio')
}

// =====================================================
// VALIDACIONES PRODUCCIÓN
// =====================================================

if (env.isProduction) {
  if (!env.publicBaseDomain) {
    throw new Error('REACT_APP_PUBLIC_BASE_DOMAIN es obligatorio en producción')
  }

  if (!env.adminBaseDomain) {
    throw new Error('REACT_APP_ADMIN_BASE_DOMAIN es obligatorio en producción')
  }

  if (!env.storefrontPreviewUrl) {
    throw new Error(
      'REACT_APP_STOREFRONT_PREVIEW_URL es obligatorio en producción',
    )
  }

  if (!isValidUrl(env.storefrontPreviewUrl)) {
    throw new Error(
      `REACT_APP_STOREFRONT_PREVIEW_URL inválido: ${env.storefrontPreviewUrl}`,
    )
  }

  if (!isRelativeApiPath(env.apiBaseUrl) && !isHttpsUrl(env.apiBaseUrl)) {
    throw new Error(
      `REACT_APP_API_BASE_URL debe usar HTTPS en producción: ${env.apiBaseUrl}`,
    )
  }

  if (!isHttpsUrl(env.storefrontPreviewUrl)) {
    throw new Error(
      `REACT_APP_STOREFRONT_PREVIEW_URL debe usar HTTPS en producción: ${env.storefrontPreviewUrl}`,
    )
  }

  if (env.assetsBaseUrl && !isHttpsUrl(env.assetsBaseUrl)) {
    throw new Error(
      `REACT_APP_ASSETS_BASE_URL debe usar HTTPS en producción: ${env.assetsBaseUrl}`,
    )
  }

  if (isLocalValue(env.apiBaseUrl)) {
    throw new Error(
      `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`,
    )
  }

  if (isLocalValue(env.publicBaseDomain)) {
    throw new Error(
      `REACT_APP_PUBLIC_BASE_DOMAIN inválido para producción: ${env.publicBaseDomain}`,
    )
  }

  if (isLocalValue(env.adminBaseDomain)) {
    throw new Error(
      `REACT_APP_ADMIN_BASE_DOMAIN inválido para producción: ${env.adminBaseDomain}`,
    )
  }

  if (env.debugApi) {
    throw new Error('REACT_APP_DEBUG_API=true no está permitido en producción')
  }

  if (
    env.mercadoPagoPublicKey &&
    env.mercadoPagoPublicKey.startsWith('TEST-')
  ) {
    throw new Error(
      'REACT_APP_MP_PUBLIC_KEY de prueba no está permitida en producción',
    )
  }

  if (hasPlaceholder(env.mercadoPagoPublicKey)) {
    throw new Error('REACT_APP_MP_PUBLIC_KEY contiene placeholder')
  }
}

export default env
