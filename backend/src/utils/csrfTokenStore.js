
// 📁 src/utils/csrfTokenStore.js

import crypto from 'node:crypto'
import { createClient } from 'redis'
import NodeCache from 'node-cache'

import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

/**
 * CSRF token storage
 *
 * Production:
 *   Redis obligatorio.
 *
 * Development:
 *   Redis opcional.
 *   Si REDIS_URL no existe o Redis no está disponible durante
 *   la inicialización, se utiliza NodeCache.
 *
 * IMPORTANTE:
 *   No se cambia dinámicamente entre Redis y MemoryCache ante
 *   cada evento "error". Eso evita inconsistencias de tokens
 *   entre instancias y evita loops de fallback/reconnect.
 */

const CSRF_TOKEN_PREFIX = 'csrf:token:'
const CSRF_TOKEN_TTL = 15 * 60 // 15 minutos

const MEMORY_CACHE_CHECK_PERIOD = 120
const REDIS_CONNECT_TIMEOUT = 10_000

let redisClient = null
let memoryCache = null

let storeMode = 'uninitialized'
let initializationPromise = null

/**
 * Determina si estamos ejecutando en producción.
 *
 * Se intenta mantener compatible con las diferentes estructuras
 * de env utilizadas por el proyecto.
 */
const isProduction =
  env.nodeEnv === 'production' ||
  env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'production'

/**
 * Devuelve una URL Redis segura para logs.
 *
 * Nunca se imprimen password, username ni credenciales.
 */
const getSafeRedisUrl = redisUrl => {
  try {
    const url = new URL(redisUrl)

    return `${url.protocol}//${url.hostname}:${url.port || 'default'}${url.pathname || ''}`
  } catch {
    return '[invalid-redis-url]'
  }
}

/**
 * Inicializa el cache en memoria.
 */
const initMemoryCache = () => {
  if (memoryCache) {
    return memoryCache
  }

  memoryCache = new NodeCache({
    stdTTL: CSRF_TOKEN_TTL,
    checkperiod: MEMORY_CACHE_CHECK_PERIOD,
    deleteOnExpire: true,
    useClones: false,
  })

  return memoryCache
}

/**
 * Comprueba que un token sea válido mediante comparación
 * en tiempo constante.
 */
const tokensMatch = (storedToken, providedToken) => {
  if (
    typeof storedToken !== 'string' ||
    typeof providedToken !== 'string' ||
    !storedToken ||
    !providedToken
  ) {
    return false
  }

  const storedBuffer = Buffer.from(storedToken, 'utf8')
  const providedBuffer = Buffer.from(providedToken, 'utf8')

  if (storedBuffer.length !== providedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(storedBuffer, providedBuffer)
}

/**
 * Obtiene el modo actual del store.
 */
export const getCsrfTokenStoreStatus = () => ({
  mode: storeMode,
  redisConfigured: Boolean(env.redisUrl),
  redisConnected: Boolean(redisClient?.isReady),
  memoryCacheEnabled: Boolean(memoryCache),
  production: isProduction,
})

/**
 * Inicializa el almacenamiento CSRF.
 *
 * Reglas:
 *
 * Production:
 *   REDIS_URL es obligatorio.
 *   Si Redis no puede inicializarse, se lanza el error.
 *
 * Development:
 *   Redis es opcional.
 *   Si no existe o no conecta, se utiliza MemoryCache.
 */
export const initCsrfTokenStore = async () => {
  if (storeMode === 'ready') {
    return getCsrfTokenStoreStatus()
  }

  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = (async () => {
    logger.info('[CSRF] initCsrfTokenStore starting...', {
      environment: isProduction ? 'production' : 'development',
    })

    /**
     * ------------------------------------------------------------
     * SIN REDIS_URL
     * ------------------------------------------------------------
     */
    if (!env.redisUrl) {
      if (isProduction) {
        const error = new Error(
          '[CSRF] REDIS_URL es obligatorio en producción'
        )

        logger.error('[CSRF] ❌ Redis no configurado en producción')

        storeMode = 'failed'

        throw error
      }

      initMemoryCache()

      storeMode = 'memory'

      logger.warn(
        '[CSRF] ⚠️ REDIS_URL no configurado - usando MemoryCache para development'
      )

      return getCsrfTokenStoreStatus()
    }

    /**
     * ------------------------------------------------------------
     * REDIS CONFIGURADO
     * ------------------------------------------------------------
     */

    const safeUrl = getSafeRedisUrl(env.redisUrl)

    logger.info('[CSRF] 🔄 Inicializando Redis', {
      endpoint: safeUrl,
    })

    try {
      /**
       * Evita crear múltiples clientes si una inicialización
       * anterior dejó una instancia parcialmente abierta.
       */
      if (redisClient) {
        try {
          if (redisClient.isOpen) {
            await redisClient.quit()
          }
        } catch {
          // Ignoramos errores de limpieza de una instancia anterior.
        }

        redisClient = null
      }

      redisClient = createClient({
        url: env.redisUrl,

        socket: {
          connectTimeout: REDIS_CONNECT_TIMEOUT,

          /**
           * Backoff exponencial con jitter.
           *
           * Evita el comportamiento anterior:
           *
           * 500ms
           * 500ms
           * 500ms
           * ...
           *
           * que estaba saturando los logs de Render.
           */
          reconnectStrategy: retries => {
            const baseDelay = Math.min(
              1_000 * 2 ** Math.min(retries, 5),
              30_000
            )

            const jitter = Math.floor(Math.random() * 500)

            const delay = baseDelay + jitter

            logger.warn('[CSRF Redis] ⚠️ Reintentando conexión', {
              retry: retries,
              delayMs: delay,
            })

            return delay
          },

          keepAlive: 30_000,
          noDelay: true,
        },

        /**
         * Evita que comandos CSRF queden acumulados indefinidamente
         * mientras Redis está desconectado.
         *
         * Esto es especialmente importante para un token de corta
         * duración.
         */
        disableOfflineQueue: true,
      })

      /**
       * ----------------------------------------------------------
       * REDIS EVENTS
       * ----------------------------------------------------------
       *
       * NO cambiamos storeMode a "memory" desde estos eventos.
       *
       * El error de Redis no debe provocar un cambio dinámico de
       * backend que pueda generar tokens inconsistentes entre
       * instancias.
       */

      redisClient.on('connect', () => {
        logger.info('[CSRF Redis] 🔌 Conexión TCP establecida')
      })

      redisClient.on('ready', () => {
        logger.info('[CSRF Redis] ✅ Redis READY')
      })

      redisClient.on('reconnecting', () => {
        logger.warn('[CSRF Redis] 🔄 Redis reconnecting...')
      })

      redisClient.on('end', () => {
        logger.warn('[CSRF Redis] 🔌 Conexión Redis finalizada')
      })

      redisClient.on('error', error => {
        logger.error('[CSRF Redis] ❌ Redis error', {
          name: error?.name,
          message: error?.message,
          code: error?.code,
        })
      })

      /**
       * ----------------------------------------------------------
       * CONNECT
       * ----------------------------------------------------------
       */

      await redisClient.connect()

      /**
       * connect() no se utiliza como única garantía.
       *
       * Ejecutamos PING para verificar que Redis realmente
       * responde a comandos.
       */
      const pong = await redisClient.ping()

      if (pong !== 'PONG') {
        throw new Error(
          `Redis PING inválido. Respuesta recibida: ${String(pong)}`
        )
      }

      /**
       * Redis queda oficialmente como store activo únicamente
       * después de:
       *
       * connect()
       * +
       * ping() === PONG
       */
      storeMode = 'redis'

      logger.info('[CSRF] ✅ Redis inicializado correctamente', {
        mode: storeMode,
        endpoint: safeUrl,
      })

      return getCsrfTokenStoreStatus()
    } catch (error) {
      logger.error('[CSRF] ❌ Redis initialization failed', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      })

      /**
       * Cerramos la instancia fallida.
       */
      if (redisClient) {
        try {
          if (redisClient.isOpen) {
            await redisClient.quit()
          }
        } catch {
          // No ocultamos el error original.
        }
      }

      redisClient = null

      /**
       * ----------------------------------------------------------
       * PRODUCTION
       * ----------------------------------------------------------
       *
       * No hacemos fallback a MemoryCache.
       *
       * En una arquitectura multi-instancia esto podría generar:
       *
       * Instance A -> MemoryCache A
       * Instance B -> MemoryCache B
       *
       * y producir falsos 403.
       */
      if (isProduction) {
        storeMode = 'failed'

        const productionError = new Error(
          '[CSRF] Redis no está disponible en producción'
        )

        productionError.cause = error

        throw productionError
      }

      /**
       * ----------------------------------------------------------
       * DEVELOPMENT
       * ----------------------------------------------------------
       */

      initMemoryCache()

      storeMode = 'memory'

      logger.warn(
        '[CSRF] ⚠️ Redis no disponible - usando MemoryCache para development',
        {
          reason: error?.message,
        }
      )

      return getCsrfTokenStoreStatus()
    } finally {
      initializationPromise = null
    }
  })()

  return initializationPromise
}

/**
 * Verifica que el store haya sido inicializado.
 */
const ensureInitialized = () => {
  if (storeMode === 'uninitialized') {
    throw new Error(
      '[CSRF] Token store no inicializado. Ejecutá initCsrfTokenStore() durante el bootstrap.'
    )
  }
}

/**
 * Genera y almacena un token CSRF.
 */
export const generateCsrfToken = async userId => {
  if (!userId) {
    throw new Error('userId requerido para generar CSRF token')
  }

  ensureInitialized()

  const token = crypto.randomBytes(32).toString('base64url')
  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  logger.debug('[CSRF] Generando token', {
    userId,
    mode: storeMode,
  })

  /**
   * ------------------------------------------------------------
   * REDIS
   * ------------------------------------------------------------
   */
  if (storeMode === 'redis') {
    if (!redisClient?.isReady) {
      logger.error('[CSRF] ❌ Redis no está READY al generar token')

      throw new Error(
        '[CSRF] Redis no está disponible para almacenar el token'
      )
    }

    try {
      await redisClient.setEx(
        key,
        CSRF_TOKEN_TTL,
        token
      )

      logger.debug('[CSRF] ✅ Token almacenado en Redis')

      return token
    } catch (error) {
      logger.error('[CSRF] ❌ Error almacenando token en Redis', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      })

      /**
       * En production NO hacemos fallback.
       *
       * Generar un token que otro proceso no puede verificar
       * es peor que rechazar la operación.
       */
      throw error
    }
  }

  /**
   * ------------------------------------------------------------
   * MEMORY
   * ------------------------------------------------------------
   */

  if (storeMode === 'memory') {
    initMemoryCache()

    memoryCache.set(
      key,
      token,
      CSRF_TOKEN_TTL
    )

    logger.debug('[CSRF] ✅ Token almacenado en MemoryCache')

    return token
  }

  throw new Error(
    `[CSRF] Store no disponible. Estado actual: ${storeMode}`
  )
}

/**
 * Verifica un token CSRF.
 */
export const verifyCsrfToken = async (userId, token) => {
  if (!userId || !token) {
    logger.warn('[CSRF] Validación fallida', {
      hasUserId: Boolean(userId),
      hasToken: Boolean(token),
    })

    return false
  }

  ensureInitialized()

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  logger.debug('[CSRF] Validando token', {
    userId,
    mode: storeMode,
  })

  /**
   * ------------------------------------------------------------
   * REDIS
   * ------------------------------------------------------------
   */
  if (storeMode === 'redis') {
    if (!redisClient?.isReady) {
      logger.error(
        '[CSRF] ❌ Redis no está READY durante validación'
      )

      /**
       * Fail closed:
       *
       * Si no podemos consultar el store centralizado,
       * no asumimos que el token es válido.
       */
      return false
    }

    try {
      const storedToken = await redisClient.get(key)

      if (!storedToken) {
        logger.warn('[CSRF] ❌ Token no encontrado en Redis')
        return false
      }

      const isValid = tokensMatch(
        storedToken,
        token
      )

      if (!isValid) {
        logger.warn('[CSRF] ❌ Token inválido')
      } else {
        logger.debug('[CSRF] ✅ Token válido')
      }

      return isValid
    } catch (error) {
      logger.error('[CSRF] ❌ Error verificando token en Redis', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      })

      /**
       * No hacemos fallback a MemoryCache.
       *
       * Un token generado en Redis puede no existir en memoria.
       */
      return false
    }
  }

  /**
   * ------------------------------------------------------------
   * MEMORY
   * ------------------------------------------------------------
   */

  if (storeMode === 'memory') {
    initMemoryCache()

    const storedToken = memoryCache.get(key)

    if (!storedToken) {
      logger.warn('[CSRF] ❌ Token no encontrado en MemoryCache')
      return false
    }

    const isValid = tokensMatch(
      storedToken,
      token
    )

    if (!isValid) {
      logger.warn('[CSRF] ❌ Token inválido')
    } else {
      logger.debug('[CSRF] ✅ Token válido')
    }

    return isValid
  }

  logger.error(
    `[CSRF] ❌ Store inválido durante validación: ${storeMode}`
  )

  return false
}

/**
 * Invalida un token CSRF.
 */
export const invalidateCsrfToken = async userId => {
  if (!userId) {
    return
  }

  const key = `${CSRF_TOKEN_PREFIX}${userId}`

  /**
   * Redis
   */
  if (storeMode === 'redis' && redisClient?.isReady) {
    try {
      await redisClient.del(key)

      logger.debug('[CSRF] ✅ Token invalidado en Redis')
    } catch (error) {
      logger.error('[CSRF] ❌ Error invalidando token en Redis', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      })
    }

    return
  }

  /**
   * Memory
   */
  if (storeMode === 'memory') {
    initMemoryCache()

    memoryCache.del(key)

    logger.debug('[CSRF] ✅ Token invalidado en MemoryCache')
  }
}

/**
 * Cierra correctamente el CSRF token store.
 */
export const closeCsrfTokenStore = async () => {
  logger.info('[CSRF] Cerrando token store...')

  /**
   * Redis
   */
  if (redisClient) {
    try {
      if (redisClient.isOpen) {
        await redisClient.quit()
      }

      logger.info('[CSRF Redis] ✅ Redis desconectado correctamente')
    } catch (error) {
      logger.error('[CSRF Redis] ❌ Error cerrando Redis', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
      })

      /**
       * Como último recurso cerramos el socket.
       */
      try {
        if (redisClient.isOpen) {
          redisClient.destroy()
        }
      } catch {
        // Ignorado intencionalmente durante shutdown.
      }
    } finally {
      redisClient = null
    }
  }

  /**
   * MemoryCache
   */
  if (memoryCache) {
    memoryCache.close()
    memoryCache = null
  }

  storeMode = 'uninitialized'
  initializationPromise = null

  logger.info('[CSRF] ✅ Token store cerrado')
}