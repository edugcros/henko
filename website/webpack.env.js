// 📁 website/webpack.env.js
import fs from 'fs'
import path from 'path'
import webpack from 'webpack'
import dotenv from 'dotenv'

const CLIENT_ENV_PREFIX = /^REACT_APP_/i

export const getEnvFile = () => {
  const nodeEnv = process.env.NODE_ENV || 'development'

  if (nodeEnv === 'production') return '.env.production'
  if (nodeEnv === 'staging') return '.env.staging'

  return '.env.development'
}

export const loadEnvFileIfExists = () => {
  const envFile = getEnvFile()
  const envPath = path.resolve(process.cwd(), envFile)

  if (!fs.existsSync(envPath)) {
    console.log(
      `[webpack] ${envFile} no encontrado. Usando variables del sistema/Vercel.`
    )

    return {}
  }

  console.log(`[webpack] Cargando variables desde ${envFile}`)

  const result = dotenv.config({ path: envPath })

  if (result.error) {
    console.warn(`[webpack] No se pudo cargar ${envFile}: ${result.error.message}`)
    return {}
  }

  return result.parsed || {}
}

export const getClientEnvironment = () => {
  const fileEnv = loadEnvFileIfExists()

  const mergedEnv = {
    ...fileEnv,
    ...process.env,
  }

  const raw = Object.keys(mergedEnv)
    .filter(key => CLIENT_ENV_PREFIX.test(key))
    .reduce(
      (acc, key) => {
        acc[key] = mergedEnv[key]
        return acc
      },
      {
        NODE_ENV: process.env.NODE_ENV || 'development',
      }
    )

  const stringified = {
    'process.env': Object.keys(raw).reduce((acc, key) => {
      acc[key] = JSON.stringify(raw[key])
      return acc
    }, {}),
  }

  return { raw, stringified }
}

export const createEnvPlugin = () => {
  const { stringified } = getClientEnvironment()

  return new webpack.DefinePlugin(stringified)
}