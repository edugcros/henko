// 📁 admin/src/config/env.js

const clean = value => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

const bool = (value, fallback = false) => {
  const cleanValue = clean(value)

  if (!cleanValue) return fallback

  return cleanValue.toLowerCase() === 'true'
}

const nodeEnv =
  clean(process.env.REACT_APP_NODE_ENV) ||
  clean(process.env.NODE_ENV) ||
  'development'

const apiBaseUrl =
  clean(process.env.REACT_APP_API_BASE_URL) ||
  clean(process.env.REACT_APP_API_URL)

const apiUrl =
  clean(process.env.REACT_APP_API_URL) ||
  clean(process.env.REACT_APP_API_BASE_URL)

const assetsBaseUrl =
  clean(process.env.REACT_APP_ASSETS_BASE_URL)

export const env = {
  nodeEnv,

  isProduction: nodeEnv === 'production',

  apiBaseUrl,
  apiUrl,
  assetsBaseUrl,

  storefrontPreviewUrl:
    clean(process.env.REACT_APP_STOREFRONT_PREVIEW_URL),

  publicBaseDomain:
    clean(process.env.REACT_APP_PUBLIC_BASE_DOMAIN) ||
    clean(process.env.REACT_APP_PRODUCTION_DOMAIN),

  adminBaseDomain:
    clean(process.env.REACT_APP_ADMIN_BASE_DOMAIN),

  tenantHeader:
    clean(process.env.REACT_APP_TENANT_HEADER) ||
    'x-tenant-domain',

  csrfHeaderName:
    clean(process.env.REACT_APP_CSRF_HEADER_NAME) ||
    'x-csrf-token',

  enableTenantDomainResolution:
    bool(process.env.REACT_APP_ENABLE_TENANT_DOMAIN_RESOLUTION, true),

  debugApi:
    bool(process.env.REACT_APP_DEBUG_API, false),

  enablePromotionalBlocks:
    bool(process.env.REACT_APP_ENABLE_PROMOTIONAL_BLOCKS, true),

  enableAiFeatures:
    bool(process.env.REACT_APP_ENABLE_AI_FEATURES, true),

  mercadoPagoPublicKey:
    clean(process.env.REACT_APP_MP_PUBLIC_KEY),

  gaMeasurementId:
    clean(process.env.REACT_APP_GA_MEASUREMENT_ID),
}

if (env.isProduction) {
  if (!env.apiBaseUrl) {
    throw new Error('REACT_APP_API_BASE_URL es obligatorio en producción')
  }

  if (!env.publicBaseDomain) {
    throw new Error('REACT_APP_PUBLIC_BASE_DOMAIN es obligatorio en producción')
  }

  if (!env.adminBaseDomain) {
    throw new Error('REACT_APP_ADMIN_BASE_DOMAIN es obligatorio en producción')
  }

  if (/localhost|127\.0\.0\.1|henko\.local/i.test(env.apiBaseUrl)) {
    throw new Error(
      `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`,
    )
  }
}

export default env
