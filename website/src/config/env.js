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

const nodeEnv =
  getValue('REACT_APP_NODE_ENV') ||
  process.env.NODE_ENV ||
  'development'

const isProduction =
  getValue('REACT_APP_NODE_ENV') === 'production' ||
  process.env.NODE_ENV === 'production'

const predeployMode = parseBoolean(
  getValue('REACT_APP_PREDEPLOY_MODE'),
  false,
)

const apiBaseUrl =
  getValue('REACT_APP_API_BASE_URL', 'REACT_APP_API_URL')

const mercadoPagoPublicKey =
  getValue('REACT_APP_MP_PUBLIC_KEY')

export const env = {
  nodeEnv,
  isProduction,
  predeployMode,

  apiBaseUrl,

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

  mercadoPagoPublicKey,

  gaMeasurementId:
    getValue('REACT_APP_GA_MEASUREMENT_ID'),

  debugApi:
    parseBoolean(getValue('REACT_APP_DEBUG_API'), false),
}

if (env.isProduction) {
  const forbiddenApiValues = [
    'localhost',
    '127.0.0.1',
    'henko.local',
    'http://',
  ]

  forbiddenApiValues.forEach(value => {
    if (String(env.apiBaseUrl || '').includes(value)) {
      throw new Error(
        `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`,
      )
    }
  })

  if (!env.mercadoPagoPublicKey) {
    throw new Error('Falta REACT_APP_MP_PUBLIC_KEY en producción')
  }

  const isTestKey = String(env.mercadoPagoPublicKey).startsWith('TEST-')
  const isProdKey = String(env.mercadoPagoPublicKey).startsWith('APP_USR-')

  if (!isProdKey && !isTestKey) {
    throw new Error('REACT_APP_MP_PUBLIC_KEY inválida')
  }
}

export default env