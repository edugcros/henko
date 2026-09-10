// 📁 src/middlewares/sharedRateLimitStore.js
//
// Almacén de express-rate-limit apoyado en la caché compartida.
//
// POR QUÉ
//
// El almacén por defecto de express-rate-limit vive en la memoria del proceso.
// Con una instancia funciona; con N, cada una lleva su propia cuenta y el
// límite efectivo pasa a ser N veces el configurado. Un límite que se multiplica
// solo al escalar no es un límite, es una sugerencia.
//
// No se instala `rate-limit-redis` porque no hace falta: la caché de este
// proyecto ya habla con Redis cuando está configurado y cae a memoria cuando no,
// con su propia degradación avisada. Una dependencia menos que mantener y un
// solo lugar donde arreglar el día que Redis se comporte raro.
//
// SOBRE LA DEGRADACIÓN
//
// Sin Redis esto cuenta por proceso, igual que el almacén por defecto: no
// empeora nada, y mejora en cuanto Redis exista. Es deliberado que el límite
// afloje en vez de endurecerse cuando la caché falla — un limitador que se
// rompe hacia el lado de negar deja afuera a gente que no hizo nada.

import { cacheIncr, cacheGet, cacheSet, cacheDel } from '../utils/cache.js'

const PREFIX = 'ratelimit:'

export class SharedRateLimitStore {
  /** express-rate-limit llama a esto con las opciones ya resueltas. */
  init(options) {
    this.windowMs = options.windowMs
  }

  /**
   * Suma uno y devuelve el total de la ventana.
   *
   * La ventana arranca con el primer golpe de esa clave y vence sola por TTL,
   * que es el mismo modelo que usa el almacén de memoria de la librería.
   */
  async increment(key) {
    const ttlSec = Math.max(1, Math.ceil(this.windowMs / 1000))
    const totalHits = await cacheIncr(`${PREFIX}${key}`, ttlSec)

    // La librería usa resetTime para el header Retry-After. Se guarda aparte
    // en el primer golpe: Redis sabe cuándo vence la clave, pero preguntárselo
    // sería un viaje más por cada request.
    const resetKey = `${PREFIX}reset:${key}`

    if (totalHits === 1) {
      const resetTime = new Date(Date.now() + this.windowMs)
      await cacheSet(resetKey, resetTime.toISOString(), ttlSec)
      return { totalHits, resetTime }
    }

    const stored = await cacheGet(resetKey)

    return {
      totalHits,
      resetTime: stored ? new Date(stored) : new Date(Date.now() + this.windowMs),
    }
  }

  /**
   * Descuenta un golpe. Lo usa `skipSuccessfulRequests` y similares.
   *
   * No baja de cero: un contador negativo daría ventana infinita a esa clave.
   */
  async decrement(key) {
    const cacheKey = `${PREFIX}${key}`
    const current = Number(await cacheGet(cacheKey)) || 0

    if (current <= 1) {
      await cacheDel(cacheKey)
      return
    }

    await cacheSet(cacheKey, current - 1, Math.max(1, Math.ceil(this.windowMs / 1000)))
  }

  async resetKey(key) {
    await cacheDel(`${PREFIX}${key}`)
    await cacheDel(`${PREFIX}reset:${key}`)
  }
}

export default SharedRateLimitStore
