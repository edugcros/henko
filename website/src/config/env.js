// 📁 website/src/config/env.js

const getValue = (...keys) => {
  for (const key of keys) {
    const value = process.env[key]

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }

  return undefined
}

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return String(value).trim().toLowerCase() === 'true'
}

export const env = {
  nodeEnv:
    getValue('REACT_APP_NODE_ENV') ||
    process.env.NODE_ENV ||
    'development',

  isProduction:
    getValue('REACT_APP_NODE_ENV') === 'production' ||
    process.env.NODE_ENV === 'production',

  apiBaseUrl:
    getValue('REACT_APP_API_BASE_URL', 'REACT_APP_API_URL'),

  tenantHeader:
    getValue('REACT_APP_TENANT_HEADER') ||
    'x-tenant-domain',

  csrfHeaderName:
    getValue('REACT_APP_CSRF_HEADER_NAME') ||
    'x-csrf-token',

  publicBaseDomain:
    getValue('REACT_APP_PUBLIC_BASE_DOMAIN', 'REACT_APP_PRODUCTION_DOMAIN'),

  assetsBaseUrl:
    getValue('REACT_APP_ASSETS_BASE_URL'),

  enableTenantDomainResolution:
    parseBoolean(
      getValue('REACT_APP_ENABLE_TENANT_DOMAIN_RESOLUTION'),
      true,
    ),

  enablePromotionalBlocks:
    parseBoolean(
      getValue('REACT_APP_ENABLE_PROMOTIONAL_BLOCKS'),
      true,
    ),

  enableAiFeatures:
    parseBoolean(
      getValue('REACT_APP_ENABLE_AI_FEATURES'),
      true,
    ),

  mercadoPagoPublicKey:
    getValue('REACT_APP_MP_PUBLIC_KEY'),

  gaMeasurementId:
    getValue('REACT_APP_GA_MEASUREMENT_ID'),
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
        `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`,
      )
    }
  })

  if (!env.mercadoPagoPublicKey) {
    throw new Error('Falta REACT_APP_MP_PUBLIC_KEY en producción')
  }

  if (String(env.mercadoPagoPublicKey).startsWith('TEST-')) {
    throw new Error('REACT_APP_MP_PUBLIC_KEY de TEST no está permitido en producción')
  }

  if (!String(env.mercadoPagoPublicKey).startsWith('APP_USR-')) {
    throw new Error('REACT_APP_MP_PUBLIC_KEY productiva inválida')
  }
}

export default env