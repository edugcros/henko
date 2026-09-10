// 📁 src/utils/cache.js
//
// Caché con TTL, compartida entre instancias cuando hay Redis y en memoria
// cuando no.
//
// POR QUÉ DEJÓ DE ALCANZAR LA MEMORIA
//
// Este módulo era un Map del proceso. Con una sola instancia funciona; con dos
// deja de ser una caché y pasa a ser dos, y tres cosas del sistema dependen de
// que sea una sola:
//
//   1. El disyuntor de gasto de IA cachea 30 s si el presupuesto se agotó.
//      Con una copia por instancia, la que no vio el cruce sigue autorizando
//      gasto, y el `cacheDel` que se dispara al cruzar solo limpia la local.
//   2. El límite del chat público se apoya en su propio almacén, pero el
//      patrón es el mismo: N instancias son N veces el límite.
//   3. El perfil de IA del comercio se cachea 60 s. Un comercio que revoca su
//      API key porque se filtró sigue teniéndola en uso en las demás.
//
// LA INTERFAZ NO CAMBIA
//
// Las mismas tres funciones asíncronas de siempre. Nadie más se entera: es
// deliberado, porque el módulo lo importa medio backend y un cambio de forma
// convertiría un arreglo de infraestructura en un refactor.
//
// DEGRADACIÓN
//
// Si Redis no está configurado, se usa memoria y listo — es el modo de
// desarrollo y de los tests. Si está configurado y falla, también se usa
// memoria, pero eso NO es equivalente: se vuelve al comportamiento por proceso
// que este archivo vino a resolver. Por eso se registra con nivel warn en vez
// de seguir en silencio.

import logger from '../../config/logger.js'

const REDIS_URL = String(process.env.REDIS_URL || '').trim()

// Prefijo por si la instancia de Redis se comparte con otra cosa. Dos servicios
// escribiendo la clave 'ai:platform:breaker' sin prefijo se pisan.
const PREFIX = String(process.env.CACHE_KEY_PREFIX || 'henko:').trim()

// Ninguna operación de caché puede hacer esperar a un request: si Redis tarda
// más que esto, se responde con lo que haya en memoria. Una caché lenta es peor
// que una caché fría.
const OP_TIMEOUT_MS = Number(process.env.CACHE_TIMEOUT_MS || 250)

// ─── Memoria ─────────────────────────────────────────────
//
// Sigue existiendo aunque haya Redis: es el respaldo cuando Redis falla, y la
// implementación completa cuando no está configurado.

const memoryCache = new Map()

const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.expiresAt <= now) memoryCache.delete(key)
  }
}, 60 * 1000)

cleanupInterval.unref?.()

const memorySet = (key, value, ttlSec) => {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 })
}

const memoryGet = key => {
  const entry = memoryCache.get(key)
  if (!entry) return null

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key)
    return null
  }

  return entry.value
}

const memoryDel = key => {
  memoryCache.delete(key)
}

// ─── Redis ───────────────────────────────────────────────

// Cuánto se deja de intentar Redis después de un fallo de conexión.
//
// Sin esto, cada operación reintenta conectar y paga el costo del intento. Con
// Redis caído medido en la práctica eso son ~12 s por llamada: el cliente
// reintenta con backoff antes de rechazar, así que la caché deja de ser una
// caché y pasa a ser el cuello de botella. Degradar tiene que ser barato o no
// es degradar.
const RETRY_COOLDOWN_MS = Number(process.env.CACHE_RETRY_COOLDOWN_MS || 30_000)

let client = null
let connecting = null
let degradedSince = 0
let nextRetryAt = 0

// Una advertencia por minuto como mucho. Si Redis se cae, cada request pasaría
// por acá y el log se volvería ilegible justo cuando hace falta leerlo.
const warnDegraded = message => {
  const now = Date.now()
  if (now - degradedSince < 60_000) return

  degradedSince = now
  logger.warn('[CACHE] Redis no disponible, se usa memoria por proceso', {
    detail: message,
  })
}

/**
 * Conecta a Redis a lo sumo una vez. No se llama al importar el módulo: el
 * arranque del servidor no debe depender de que Redis esté levantado.
 */
const getClient = async () => {
  if (!REDIS_URL) return null
  if (client?.isOpen) return client
  if (connecting) return connecting

  // Se falló hace poco: no se vuelve a intentar hasta que pase el enfriamiento.
  // Salir por acá cuesta cero, que es lo que hace viable la degradación.
  if (Date.now() < nextRetryAt) return null

  connecting = (async () => {
    try {
      const { createClient } = await import('redis')

      const nextClient = createClient({
        url: REDIS_URL,
        socket: {
          connectTimeout: OP_TIMEOUT_MS * 4,
          // Sin reconexión automática: reintentar lo decide getClient con su
          // propio enfriamiento. Dejársela al cliente hacía que el connect()
          // inicial tardara segundos en rechazar mientras reintentaba solo.
          reconnectStrategy: false,
        },
      })

      // Obligatorio: sin un handler de 'error', un fallo de conexión sube como
      // excepción no capturada y tumba el proceso.
      nextClient.on('error', error => warnDegraded(error.message))

      // El connect también va con techo de tiempo. Que la operación lo tenga
      // no alcanza si conectarse puede tardar más que la operación entera.
      const connected = await withTimeout(() => nextClient.connect())

      if (connected === FAILED) {
        nextRetryAt = Date.now() + RETRY_COOLDOWN_MS
        nextClient.destroy?.()
        return null
      }

      client = nextClient
      nextRetryAt = 0
      logger.info('[CACHE] Redis conectado, caché compartida entre instancias')

      return client
    } catch (error) {
      warnDegraded(error.message)
      nextRetryAt = Date.now() + RETRY_COOLDOWN_MS
      return null
    } finally {
      connecting = null
    }
  })()

  return connecting
}

/**
 * Corre una operación de Redis con techo de tiempo. Devuelve el símbolo
 * `FAILED` en vez de lanzar, para que quien llama decida caer a memoria.
 */
const FAILED = Symbol('cache-failed')

const withTimeout = async operation => {
  let timer

  try {
    return await Promise.race([
      operation(),
      new Promise(resolve => {
        timer = setTimeout(() => resolve(FAILED), OP_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    warnDegraded(error.message)
    return FAILED
  } finally {
    clearTimeout(timer)
  }
}

const namespaced = key => `${PREFIX}${key}`

// ─── Interfaz pública ────────────────────────────────────

export const cacheSet = async (key, value, ttlSec = 3600) => {
  const ttl = Math.max(1, Math.floor(Number(ttlSec) || 1))

  // Siempre se escribe en memoria además de en Redis: si Redis se cae después,
  // esta instancia sigue teniendo algo con qué responder.
  memorySet(key, value, ttl)

  const redis = await getClient()
  if (!redis) return true

  const result = await withTimeout(() =>
    redis.set(namespaced(key), JSON.stringify(value), { EX: ttl }),
  )

  if (result === FAILED) warnDegraded('set agotó el tiempo')

  return true
}

export const cacheGet = async key => {
  const redis = await getClient()

  if (redis) {
    const raw = await withTimeout(() => redis.get(namespaced(key)))

    if (raw !== FAILED) {
      // null de Redis es una respuesta legítima: la clave no está o venció.
      // No se cae a memoria en ese caso, o volvería el valor por proceso que
      // esto vino a eliminar.
      if (raw === null) return null

      try {
        return JSON.parse(raw)
      } catch {
        // Un valor corrupto se trata como ausente en vez de propagar el error.
        return null
      }
    }
  }

  return memoryGet(key)
}

export const cacheDel = async key => {
  memoryDel(key)

  const redis = await getClient()
  if (!redis) return true

  const result = await withTimeout(() => redis.del(namespaced(key)))
  if (result === FAILED) warnDegraded('del agotó el tiempo')

  return true
}

/**
 * Incrementa un contador y devuelve el valor resultante. El TTL se fija en el
 * primer incremento, así que la ventana empieza a correr con el primer uso.
 *
 * Existe para los topes que hay que contar sin poder reservar: un límite diario
 * de mensajes, por ejemplo. Un `cacheGet` seguido de un `cacheSet` no sirve —
 * entre las dos operaciones entran las demás peticiones y el tope se pasa por
 * la cantidad de peticiones concurrentes, que es exactamente el escenario del
 * que uno se quiere proteger.
 *
 * Con Redis el conteo es exacto entre instancias. Sin Redis cuenta por proceso,
 * y entonces el tope efectivo se multiplica por la cantidad de instancias: es
 * una degradación real, no una equivalencia, y por eso el módulo avisa cuando
 * Redis se cae.
 */
export const cacheIncr = async (key, ttlSec = 3600) => {
  const ttl = Math.max(1, Math.floor(Number(ttlSec) || 1))
  const redis = await getClient()

  if (redis) {
    const value = await withTimeout(async () => {
      const next = await redis.incr(namespaced(key))
      // Solo en el primero: volver a fijarlo en cada incremento correría la
      // ventana hacia adelante y el contador no vencería nunca mientras haya
      // tráfico.
      if (next === 1) await redis.expire(namespaced(key), ttl)
      return next
    })

    if (value !== FAILED) return Number(value)

    warnDegraded('incr agotó el tiempo')
  }

  const current = Number(memoryGet(key) || 0) + 1
  memorySet(key, current, ttl)

  return current
}


export default { cacheSet, cacheGet, cacheDel, cacheIncr }
