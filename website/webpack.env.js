// 📁 admin/webpack.env.js
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import webpack from 'webpack'

const __dirname = path.resolve()

// =====================================================
// ENV RESOLUTION
// =====================================================

const clean = value => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

const normalizeAppEnv = value => {
  const normalized = clean(value).toLowerCase()

  if (['development', 'staging', 'production'].includes(normalized)) {
    return normalized
  }

  return 'development'
}

/**
 * NODE_ENV debe quedar reservado para React/Webpack:
 * - development en dev server
 * - production en builds optimizados
 *
 * APP_ENV define qué archivo .env cargar:
 * - .env.development
 * - .env.staging
 * - .env.production
 */
const APP_ENV = normalizeAppEnv(
  process.env.APP_ENV || process.env.REACT_APP_NODE_ENV || process.env.NODE_ENV || 'development',
)

const WEBPACK_MODE = clean(process.env.NODE_ENV) || 'production'

const envFileMap = {
  development: '.env.development',
  staging: '.env.staging',
  production: '.env.production',
}

const envFile = envFileMap[APP_ENV] || '.env.development'
const envPath = path.resolve(__dirname, envFile)

if (fs.existsSync(envPath)) {
  console.log(`[webpack] Cargando variables desde ${envFile}`)
  dotenv.config({ path: envPath, override: true })
} else {
  console.warn(
    `[webpack] No se encontró ${envFile}; usando variables del entorno del sistema/Vercel`,
  )
}

// Forzamos coherencia pública después de cargar dotenv.
process.env.REACT_APP_NODE_ENV = APP_ENV

const REQUIRED_DEPLOY_KEYS = [
  'REACT_APP_NODE_ENV',
  'REACT_APP_API_BASE_URL',
  'REACT_APP_API_URL',
  'REACT_APP_ASSETS_BASE_URL',
  'REACT_APP_PUBLIC_BASE_DOMAIN',
  'REACT_APP_ADMIN_BASE_DOMAIN',
  'REACT_APP_TENANT_HEADER',
  'REACT_APP_CSRF_HEADER_NAME',
]

const DEPLOY_ENVS = new Set(['staging', 'production'])

const getEnvValue = key => {
  const value = process.env[key]

  if (value === undefined || value === null || String(value).trim() === '') {
    return ''
  }

  return String(value).trim()
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

const hasForbiddenDeployValue = value => {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|henko\.local|\.local|\.test/i.test(String(value || ''))
}

const hasPlaceholder = value => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()

  if (!normalized) return false

  return ['CHANGE_ME', 'REPLACE_ME', 'REEMPLAZAR', 'PEGAR_ACA', 'YOUR_', 'TU_'].some(token =>
    normalized.includes(token),
  )
}

const assertDeployEnv = () => {
  const missing = REQUIRED_DEPLOY_KEYS.filter(key => !getEnvValue(key))

  if (missing.length > 0) {
    throw new Error(
      `Variables REACT_APP requeridas faltantes para ${APP_ENV}: ${missing.join(', ')}`,
    )
  }

  const apiBaseUrl = getEnvValue('REACT_APP_API_BASE_URL')
  const apiUrl = getEnvValue('REACT_APP_API_URL')
  const assetsBaseUrl = getEnvValue('REACT_APP_ASSETS_BASE_URL')
  const publicBaseDomain = getEnvValue('REACT_APP_PUBLIC_BASE_DOMAIN')
  const adminBaseDomain = getEnvValue('REACT_APP_ADMIN_BASE_DOMAIN')
  const storefrontPreviewUrl = getEnvValue('REACT_APP_STOREFRONT_PREVIEW_URL')
  const mpPublicKey = getEnvValue('REACT_APP_MP_PUBLIC_KEY')
  const debugApi = getEnvValue('REACT_APP_DEBUG_API').toLowerCase()

  if (!isValidUrl(apiBaseUrl)) {
    throw new Error(`REACT_APP_API_BASE_URL inválido: ${apiBaseUrl}`)
  }

  if (!apiBaseUrl.endsWith('/api')) {
    throw new Error(`REACT_APP_API_BASE_URL debe terminar en /api. Recibido: ${apiBaseUrl}`)
  }

  if (apiUrl && !isValidUrl(apiUrl)) {
    throw new Error(`REACT_APP_API_URL inválido: ${apiUrl}`)
  }

  if (assetsBaseUrl && !isValidUrl(assetsBaseUrl)) {
    throw new Error(`REACT_APP_ASSETS_BASE_URL inválido: ${assetsBaseUrl}`)
  }

  if (storefrontPreviewUrl && !isValidUrl(storefrontPreviewUrl)) {
    throw new Error(`REACT_APP_STOREFRONT_PREVIEW_URL inválido: ${storefrontPreviewUrl}`)
  }

  ;[
    apiBaseUrl,
    apiUrl,
    assetsBaseUrl,
    publicBaseDomain,
    adminBaseDomain,
    storefrontPreviewUrl,
  ].forEach(value => {
    if (value && hasForbiddenDeployValue(value)) {
      throw new Error(`Configuración inválida para ${APP_ENV} en admin: ${value}`)
    }
  })
  ;[apiBaseUrl, apiUrl, assetsBaseUrl, storefrontPreviewUrl].filter(Boolean).forEach(value => {
    if (!isHttpsUrl(value)) {
      throw new Error(`Las URLs públicas deben usar HTTPS en ${APP_ENV}: ${value}`)
    }
  })

  if (debugApi === 'true') {
    throw new Error(`REACT_APP_DEBUG_API=true no está permitido en ${APP_ENV}`)
  }

  if (hasPlaceholder(mpPublicKey)) {
    throw new Error('REACT_APP_MP_PUBLIC_KEY contiene placeholder')
  }
}

if (DEPLOY_ENVS.has(APP_ENV)) {
  assertDeployEnv()
}

// =====================================================
// CLIENT ENV
// =====================================================

export const getClientEnvironment = () => {
  const raw = Object.keys(process.env)
    .filter(key => key.startsWith('REACT_APP_'))
    .reduce(
      (acc, key) => {
        acc[key] = getEnvValue(key)
        return acc
      },
      {
        /**
         * Para webpack --mode production, NODE_ENV debe ser production.
         * Para webpack serve --mode development, NODE_ENV debe ser development.
         */
        NODE_ENV: WEBPACK_MODE,
        REACT_APP_NODE_ENV: APP_ENV,
      },
    )

  const stringified = {
    // 🔒 Clave principal: elimina process.env dinámico del bundle
    'process.env': JSON.stringify(raw),

    // 🔒 Claves directas: mantiene reemplazos explícitos y optimización
    'process.env.NODE_ENV': JSON.stringify(raw.NODE_ENV),
  }

  Object.keys(raw).forEach(key => {
    stringified[`process.env.${key}`] = JSON.stringify(raw[key])
  })

  return {
    raw,
    stringified,
  }
}

export const createEnvPlugin = () => {
  const clientEnv = getClientEnvironment()

  console.log('[webpack] Variables públicas inyectadas:', {
    NODE_ENV: clientEnv.raw.NODE_ENV,
    APP_ENV,
    REACT_APP_NODE_ENV: clientEnv.raw.REACT_APP_NODE_ENV,
    REACT_APP_API_BASE_URL: clientEnv.raw.REACT_APP_API_BASE_URL,
    REACT_APP_API_URL: clientEnv.raw.REACT_APP_API_URL,
    REACT_APP_ASSETS_BASE_URL: clientEnv.raw.REACT_APP_ASSETS_BASE_URL,
  })

  return new webpack.DefinePlugin(clientEnv.stringified)
}

export default createEnvPlugin
