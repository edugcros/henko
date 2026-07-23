// 📁 src/utils/csrfTokenStore.js
import crypto from 'node:crypto'
import { createClient } from 'redis'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const CSRF_TOKEN_PREFIX = 'csrf:token:'
const CSRF_TOKEN_TTL = 15 * 60 // 15 minutes

let redisClient = null

export const initCsrfTokenStore = async () => {
  if (!env.redisUrl) {
    logger.warn('[CSRF] Redis URL no configurado - usando fallback sin persistencia')
    return
  }

  try {
    redisClient = createClient({
      url: env.redisUrl,
      socket: {
        reconnectStrategy: retries => Math.min(retries * 50, 500),
      },
    })

    redisClient.on('error', err => {
      logger.error('[CSRF Redis] Error:', err.message)
    })

    await redisClient.connect()
    logger.info('[CSRF] Redis conectado')
  } catch (error) {
    logger.error('[CSRF] Redis connection failed:', error.message)
    redisClient = null
  }
}

export const generateCsrfToken = async userId => {
  if (!userId) {
    throw new Error('userId requerido para generar CSRF token')
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  if (redisClient) {
    try {
      await redisClient.setEx(key, CSRF_TOKEN_TTL, token)
    } catch (error) {
      logger.error('[CSRF] Error storing token in Redis:', error.message)
      // Continuar sin Redis si falla
    }
  }

  return token
}

export const verifyCsrfToken = async (userId, token) => {
  if (!userId || !token) {
    return false
  }

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  if (redisClient) {
    try {
      const storedToken = await redisClient.get(key)
      return storedToken === token
    } catch (error) {
      logger.error('[CSRF] Error verifying token:', error.message)
      return false
    }
  }

  return false
}

export const invalidateCsrfToken = async userId => {
  if (!userId) return

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  if (redisClient) {
    try {
      await redisClient.del(key)
    } catch (error) {
      logger.error('[CSRF] Error invalidating token:', error.message)
    }
  }
}

export const closeCsrfTokenStore = async () => {
  if (redisClient) {
    try {
      await redisClient.quit()
      logger.info('[CSRF] Redis desconectado')
    } catch (error) {
      logger.error('[CSRF] Error closing Redis:', error.message)
    }
  }
}
