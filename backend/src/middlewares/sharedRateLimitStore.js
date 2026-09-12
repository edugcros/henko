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
  /**
   * @param {string} name  Identifica a QUÉ limitador pertenece este almacén.
   *
   * NO ES DECORATIVO, Y FALTABA.
   *
   * Todos los almacenes usaban el mismo prefijo `ratelimit:`, así que dos
   * limitadores distintos cuya clave coincidiera —la misma IP, por ejemplo—
   * compartían contador: los golpes contra el límite global le descontaban al
   * de pagos, que admite 10 por hora. Hoy no chocan porque sus keyGenerator
   * producen strings distintos, o sea por casualidad y no por diseño.
   *
   * `prefix` además es el campo por el que express-rate-limit distingue
   * limitadores al validar. Sin él tomaba a todos por el mismo y avisaba
   * ERR_ERL_DOUBLE_COUNT en cada request que pasa por dos limitadores — que son
   * todas, porque el global está montado sobre /api entero.
   */
  constructor(name) {
    if (!name) {
      throw new Error('SharedRateLimitStore necesita un nombre para no compartir contador con otro limitador')
    }

    this.prefix = `${PREFIX}${name}:`
  }

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
    const totalHits = await cacheIncr(`${this.prefix}${key}`, ttlSec)

    // La librería usa resetTime para el header Retry-After. Se guarda aparte
    // en el primer golpe: Redis sabe cuándo vence la clave, pero preguntárselo
    // sería un viaje más por cada request.
    const resetKey = `${this.prefix}reset:${key}`

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
    const cacheKey = `${this.prefix}${key}`
    const current = Number(await cacheGet(cacheKey)) || 0

    if (current <= 1) {
      await cacheDel(cacheKey)
      return
    }

    await cacheSet(cacheKey, current - 1, Math.max(1, Math.ceil(this.windowMs / 1000)))
  }

  async resetKey(key) {
    await cacheDel(`${this.prefix}${key}`)
    await cacheDel(`${this.prefix}reset:${key}`)
  }
}

export default SharedRateLimitStore
