// 📁 src/utils/csrfTokenStore.js
import crypto from 'node:crypto'
import { createClient } from 'redis'
import NodeCache from 'node-cache'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const CSRF_TOKEN_PREFIX = 'csrf:token:'
const CSRF_TOKEN_TTL = 15 * 60 // 15 minutes

let redisClient = null
let memoryCache = new NodeCache({ stdTTL: CSRF_TOKEN_TTL })
let useMemoryCache = false

export const initCsrfTokenStore = async () => {
  logger.info('[CSRF] initCsrfTokenStore starting...')

  if (!env.redisUrl) {
    logger.warn('[CSRF] ⚠️ REDIS_URL NO CONFIGURADO - Usando memory cache')
    useMemoryCache = true
    return
  }

  const urlObj = new URL(env.redisUrl)
  const safeUrl = `${urlObj.protocol}//*:*@${urlObj.host}${urlObj.pathname}`
  logger.info('[CSRF] 🔄 Conectando a Redis:', safeUrl)

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
      logger.warn('[CSRF Redis] ⚠️ Error (usando memory cache):', err?.message)
      useMemoryCache = true
    })

    redisClient.on('connect', () => {
      logger.info('[CSRF Redis] ✅ Conectado')
      useMemoryCache = false
    })

    await redisClient.connect()
    logger.info('[CSRF] ✅ Redis inicializado correctamente')
  } catch (error) {
    logger.warn('[CSRF] ⚠️ Redis connection fallback a memory cache:', error.message)
    redisClient = null
    useMemoryCache = true
  }
}

export const generateCsrfToken = async userId => {
  if (!userId) {
    throw new Error('userId requerido para generar CSRF token')
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  logger.debug(`[CSRF] Generando token para usuario: ${userId}`)

  if (!useMemoryCache && redisClient) {
    try {
      await redisClient.setEx(key, CSRF_TOKEN_TTL, token)
      logger.debug(`[CSRF] Token guardado en Redis`)
    } catch (error) {
      logger.warn('[CSRF] ⚠️ Error storing in Redis, falling back to memory:', error?.message)
      useMemoryCache = true
      memoryCache.set(key, token, CSRF_TOKEN_TTL)
    }
  } else {
    memoryCache.set(key, token, CSRF_TOKEN_TTL)
    logger.debug(`[CSRF] Token guardado en memory cache`)
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

  try {
    let storedToken

    if (!useMemoryCache && redisClient) {
      storedToken = await redisClient.get(key)
      logger.debug(`[CSRF] Verificado en Redis`)
    } else {
      storedToken = memoryCache.get(key)
      logger.debug(`[CSRF] Verificado en memory cache`)
    }

    const isValid = storedToken === token

    if (!isValid) {
      logger.warn(`[CSRF] ❌ Token inválido`)
    } else {
      logger.debug(`[CSRF] ✅ Token válido`)
    }

    return isValid
  } catch (error) {
    logger.warn('[CSRF] ⚠️ Error verifying token, verificando en memory:', error?.message)
    const storedToken = memoryCache.get(key)
    return storedToken === token
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
