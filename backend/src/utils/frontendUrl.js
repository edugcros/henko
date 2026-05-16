// 📁 src/utils/frontendUrl.js
import { env } from '../../config/env.js'

export const getFrontendBaseUrl = req => {
  if (env.clientUrl) {
    return env.clientUrl.replace(/\/+$/, '')
  }

  if (env.shopFrontendUrl) {
    return env.shopFrontendUrl.replace(/\/+$/, '')
  }

  if (!env.isProduction) {
    return 'http://henko.local:3002'
  }

  throw new Error('CLIENT_URL / SHOP_FRONTEND_URL no configurado')
}

export const buildFrontendUrl = (path, req) => {
  const baseUrl = getFrontendBaseUrl(req)
  const cleanPath = String(path || '').replace(/^\/+/, '')

  return `${baseUrl}/${cleanPath}`
}