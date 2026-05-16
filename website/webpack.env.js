// 📁 website/webpack.env.js
import path from 'path'
import Dotenv from 'dotenv-webpack'

export const getEnvFile = () => {
  if (process.env.NODE_ENV === 'production') {
    return '.env.production'
  }

  if (process.env.NODE_ENV === 'staging') {
    return '.env.staging'
  }

  return '.env.development'
}

export const createDotenvPlugin = () => {
  const envFile = getEnvFile()

  console.log(`[webpack] Cargando variables desde ${envFile}`)

  return new Dotenv({
    path: path.resolve(process.cwd(), envFile),
    systemvars: true,
    safe: false,
    defaults: false,
  })
}