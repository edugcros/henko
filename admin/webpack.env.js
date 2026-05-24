// 📁 admin/webpack.env.js
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import webpack from 'webpack'

const __dirname = path.resolve()

const NODE_ENV = process.env.NODE_ENV || 'development'

const envFile =
  NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development'

const envPath = path.resolve(__dirname, envFile)

if (fs.existsSync(envPath)) {
  console.log(`[webpack] Cargando variables desde ${envFile}`)
  dotenv.config({ path: envPath, override: true })
} else {
  console.warn(
    `[webpack] No se encontró ${envFile}; usando variables del entorno del sistema/Vercel`,
  )
}

const REQUIRED_PRODUCTION_KEYS = [
  'REACT_APP_NODE_ENV',
  'REACT_APP_API_BASE_URL',
  'REACT_APP_API_URL',
  'REACT_APP_ASSETS_BASE_URL',
  'REACT_APP_TENANT_HEADER',
  'REACT_APP_CSRF_HEADER_NAME',
]

const getEnvValue = key => {
  const value = process.env[key]

  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined
  }

  return String(value).trim()
}

if (NODE_ENV === 'production') {
  const missing = REQUIRED_PRODUCTION_KEYS.filter(key => !getEnvValue(key))

  if (missing.length > 0) {
    throw new Error(
      `Variables REACT_APP requeridas faltantes para producción: ${missing.join(', ')}`,
    )
  }
}

export const getClientEnvironment = () => {
  const raw = Object.keys(process.env)
    .filter(key => key.startsWith('REACT_APP_'))
    .reduce(
      (acc, key) => {
        acc[key] = getEnvValue(key) || ''
        return acc
      },
      {
        NODE_ENV,
      },
    )

  return {
    raw,
    stringified: {
      'process.env.NODE_ENV': JSON.stringify(raw.NODE_ENV),
      ...Object.keys(raw).reduce((acc, key) => {
        acc[`process.env.${key}`] = JSON.stringify(raw[key])
        return acc
      }, {}),
    },
  }
}

export const createEnvPlugin = () => {
  const clientEnv = getClientEnvironment()

  console.log('[webpack] Variables públicas inyectadas:', {
    NODE_ENV: clientEnv.raw.NODE_ENV,
    REACT_APP_API_BASE_URL: clientEnv.raw.REACT_APP_API_BASE_URL,
    REACT_APP_API_URL: clientEnv.raw.REACT_APP_API_URL,
    REACT_APP_ASSETS_BASE_URL: clientEnv.raw.REACT_APP_ASSETS_BASE_URL,
  })

  return {
  raw,
  stringified: {
    'process.env.NODE_ENV': JSON.stringify(raw.NODE_ENV),
    ...Object.keys(raw).reduce((acc, key) => {
      acc[`process.env.${key}`] = JSON.stringify(raw[key])
      return acc
    }, {}),
  },
}
}

export default createEnvPlugin