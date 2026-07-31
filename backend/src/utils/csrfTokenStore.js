// 📁 src/utils/csrfTokenStore.js
import crypto from 'node:crypto'
import { createClient } from 'redis'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const CSRF_TOKEN_PREFIX = 'csrf:token:'
const CSRF_TOKEN_TTL = 15 * 60 // 15 minutes

let redisClient = null

export const initCsrfTokenStore = async () => {
  logger.info('[CSRF] initCsrfTokenStore starting...')

  if (!env.redisUrl) {
    logger.error('[CSRF] ❌ REDIS_URL NO CONFIGURADO - CSRF token storage fallará')
    logger.error('[CSRF] env.redisUrl:', env.redisUrl)
    redisClient = null
    return
  }

  const urlObj = new URL(env.redisUrl)
  const safeUrl = `${urlObj.protocol}//*:*@${urlObj.host}${urlObj.pathname}`
  logger.info('[CSRF] 🔄 Conectando a Redis:', safeUrl)
  logger.debug('[CSRF] Protocol:', urlObj.protocol, 'Host:', urlObj.host, 'Port:', urlObj.port)

  try {
    redisClient = createClient({
      url: env.redisUrl,
      socket: {
        reconnectStrategy: retries => Math.min(retries * 50, 500),
        keepAlive: 30000,
        noDelay: true,
      },
      legacyMode: false,
    })

    redisClient.on('error', err => {
      logger.error('[CSRF Redis] ❌ Error:', {
        message: err?.message,
        code: err?.code,
        name: err?.name,
        stack: err?.stack,
      })
    })

    redisClient.on('connect', () => {
      logger.info('[CSRF Redis] ✅ Conectado')
    })

    await redisClient.connect()
    logger.info('[CSRF] ✅ Redis inicializado correctamente')
  } catch (error) {
    logger.error('[CSRF] ❌ Redis connection failed:', error.message)
    logger.error('[CSRF] Error stack:', error.stack)
    redisClient = null
  }
}

export const generateCsrfToken = async userId => {
  if (!userId) {
    throw new Error('userId requerido para generar CSRF token')
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  logger.debug(`[CSRF] Generando token para usuario: ${userId}`)
  logger.debug(`[CSRF] Redis client existe: ${!!redisClient}`)

  if (redisClient) {
    try {
      await redisClient.setEx(key, CSRF_TOKEN_TTL, token)
      logger.debug(`[CSRF] ✅ Token guardado en Redis: ${key}`)
    } catch (error) {
      logger.error('[CSRF] ❌ Error storing token in Redis:', {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        stack: error?.stack,
        redisStatus: redisClient?.status || 'unknown',
      })
    }
  } else {
    logger.warn('[CSRF] ⚠️ Redis client NO está inicializado - token no se guardará')
  }

  return token
}

export const verifyCsrfToken = async (userId, token) => {
  if (!userId || !token) {
    logger.warn(`[CSRF] Validación fallida - userId: ${!!userId}, token: ${!!token}`)
    return false
  }

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  logger.debug(`[CSRF] Validando token para usuario: ${userId}`)
  logger.debug(`[CSRF] Redis client existe: ${!!redisClient}`)

  if (redisClient) {
    try {
      const storedToken = await redisClient.get(key)
      const isValid = storedToken === token

      logger.debug(`[CSRF] Token en Redis: ${!!storedToken}, Coincide: ${isValid}`)

      if (!isValid) {
        logger.warn(`[CSRF] ❌ Token inválido - esperado: ${storedToken?.substring(0, 10)}..., recibido: ${token?.substring(0, 10)}...`)
      }

      return isValid
    } catch (error) {
      logger.error('[CSRF] ❌ Error verifying token:', {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        redisStatus: redisClient?.status || 'unknown',
      })
      return false
    }
  } else {
    logger.error('[CSRF] ❌ Redis client NO está inicializado - no se puede validar token')
    return false
  }
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
