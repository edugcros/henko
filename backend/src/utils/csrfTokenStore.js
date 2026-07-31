// 📁 src/utils/csrfTokenStore.js
import crypto from 'node:crypto'
import NodeCache from 'node-cache'
import logger from '../../config/logger.js'

const CSRF_TOKEN_PREFIX = 'csrf:token:'
const CSRF_TOKEN_TTL = 15 * 60 // 15 minutes

let memoryCache = new NodeCache({ stdTTL: CSRF_TOKEN_TTL })

export const initCsrfTokenStore = async () => {
  logger.info('[CSRF] initCsrfTokenStore starting...')
  logger.info('[CSRF] ✅ Usando memory cache para CSRF tokens')
}

export const generateCsrfToken = async userId => {
  if (!userId) {
    throw new Error('userId requerido para generar CSRF token')
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  memoryCache.set(key, token, CSRF_TOKEN_TTL)
  logger.debug(`[CSRF] Token guardado en memory cache`)

  return token
}

export const verifyCsrfToken = async (userId, token) => {
  if (!userId || !token) {
    logger.warn(`[CSRF] Validación fallida - userId: ${!!userId}, token: ${!!token}`)
    return false
  }

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  try {
    const storedToken = memoryCache.get(key)
    const isValid = storedToken === token

    if (!isValid) {
      logger.warn(`[CSRF] ❌ Token inválido`)
    } else {
      logger.debug(`[CSRF] ✅ Token válido`)
    }

    return isValid
  } catch (error) {
    logger.warn('[CSRF] ⚠️ Error verifying token:', error?.message)
    return false
  }
}

export const invalidateCsrfToken = async userId => {
  if (!userId) return

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  try {
    memoryCache.del(key)
  } catch (error) {
    logger.error('[CSRF] Error invalidating token:', error.message)
  }
}

export const closeCsrfTokenStore = async () => {
  logger.info('[CSRF] Memory cache cleared')
}
