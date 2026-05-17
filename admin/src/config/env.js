// 📁 admin/src/config/env.js

const getValue = (...keys) => {
  for (const key of keys) {
    if (process.env[key]) return process.env[key]
  }

  return undefined
}

export const env = {
  nodeEnv: getValue('REACT_APP_NODE_ENV') || process.env.NODE_ENV || 'development',
  isProduction:
    getValue('REACT_APP_NODE_ENV') === 'production' ||
    process.env.NODE_ENV === 'production',

  apiBaseUrl:
    getValue('REACT_APP_API_BASE_URL', 'REACT_APP_API_URL'),
  tenantHeader:
    getValue('REACT_APP_TENANT_HEADER') ||
    'x-tenant-domain',

  publicBaseDomain:
    getValue('REACT_APP_PUBLIC_BASE_DOMAIN', 'REACT_APP_PRODUCTION_DOMAIN'),

  adminBaseDomain:
    getValue('REACT_APP_ADMIN_BASE_DOMAIN'),

  csrfHeaderName:
  getValue('REACT_APP_CSRF_HEADER_NAME') ||
  'x-csrf-token',
    
  assetsBaseUrl:
    getValue('REACT_APP_ASSETS_BASE_URL'),

  enableTenantDomainResolution:
    getValue('REACT_APP_ENABLE_TENANT_DOMAIN_RESOLUTION') !== 'false',

  enableThemeBuilder:
    getValue('REACT_APP_ENABLE_THEME_BUILDER') !== 'false',

  enablePromotionalBlocks:
    getValue('REACT_APP_ENABLE_PROMOTIONAL_BLOCKS') !== 'false',

  enableAiProductAnalysis:
    getValue('REACT_APP_ENABLE_AI_PRODUCT_ANALYSIS') !== 'false',
}

if (env.isProduction) {
  const forbiddenValues = [
    'localhost',
    '127.0.0.1',
    'henko.local',
    'http://',
  ]

  forbiddenValues.forEach(value => {
    if (String(env.apiBaseUrl || '').includes(value)) {
      throw new Error(
        `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`
      )
    }
  })
}

export default env