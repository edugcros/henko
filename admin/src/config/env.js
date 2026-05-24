// 📁 admin/src/config/env.js

const getValue = (...keys) => {
  for (const key of keys) {
    const value = process.env[key]

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }

  return undefined
}

const parseBool = (value, fallback = false) => {
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
    getValue('REACT_APP_API_BASE_URL', 'REACT_APP_API_URL') ||
    '',

  apiUrl:
    getValue('REACT_APP_API_URL', 'REACT_APP_API_BASE_URL') ||
    '',

  assetsBaseUrl:
    getValue('REACT_APP_ASSETS_BASE_URL') ||
    '',

  publicBaseDomain:
    getValue('REACT_APP_PUBLIC_BASE_DOMAIN') ||
    '',

  adminBaseDomain:
    getValue('REACT_APP_ADMIN_BASE_DOMAIN') ||
    '',

  tenantHeader:
    getValue('REACT_APP_TENANT_HEADER') ||
    'x-tenant-domain',

  csrfHeaderName:
    getValue('REACT_APP_CSRF_HEADER_NAME') ||
    'x-csrf-token',

  enableTenantDomainResolution:
    parseBool(
      getValue('REACT_APP_ENABLE_TENANT_DOMAIN_RESOLUTION'),
      true,
    ),

  debugApi:
    parseBool(getValue('REACT_APP_DEBUG_API'), false),
}

if (env.isProduction && !env.apiBaseUrl) {
  throw new Error('REACT_APP_API_BASE_URL es obligatorio en producción')
}

if (
  env.isProduction &&
  /localhost|127\.0\.0\.1|henko\.local/i.test(env.apiBaseUrl)
) {
  throw new Error(
    `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`,
  )
}

export default env