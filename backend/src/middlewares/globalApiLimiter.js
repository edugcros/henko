// 📁 src/middlewares/globalApiLimiter.js
//
// Techo de peticiones por IP para toda la API.
//
// `env.rateLimit` traía sus dos valores —ventana y máximo— desde hacía tiempo y
// no lo consumía nadie. Eso es peor que no tenerlo: quien leía el .env veía una
// protección configurada que no existía.
//
// QUÉ PROTEGE Y QUÉ NO
//
// El login ya tenía bloqueo por intentos, así que la fuerza bruta de
// contraseñas estaba cubierta. Lo que quedaba sin ningún techo era el alta de
// cuentas, la recuperación de contraseña y cualquier endpoint autenticado.
//
// Es un piso amplio, no un reemplazo de los límites finos. El chat de IA, las
// consultas y los pagos siguen teniendo el suyo, más ajustado, porque cada uno
// protege algo distinto: este evita que alguien martille la API entera, no que
// abuse de una función cara.
//
// LO QUE QUEDA AFUERA, Y POR QUÉ
//
// Los webhooks de Mercado Pago y de WhatsApp. Llegan desde un puñado de IPs del
// proveedor y en ráfaga: un pico legítimo de notificaciones de pago se comería
// el cupo de una IP en segundos, y perder un webhook de pago es perder plata.
// Los dos validan firma propia, que es un control más fuerte que contar
// peticiones.
//
// Y los healthchecks, que los llama Render y no deben depender de esto.

import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import { env } from '../../config/env.js'
import { SharedRateLimitStore } from './sharedRateLimitStore.js'

const RUTAS_EXENTAS = [
  '/webhooks',
  '/payments/webhook',
  '/whatsapp/webhook',
  '/health',
]

export const globalApiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,

  // Compartido entre instancias: el almacén por defecto vive en la memoria del
  // proceso, con lo cual el límite efectivo se multiplica por la cantidad de
  // instancias justo cuando más falta hace.
  store: new SharedRateLimitStore('global-api'),

  // req.ip respeta la config de trust proxy de app.js. Leer x-forwarded-for a
  // mano confiaría en un header que cualquiera puede falsificar.
  keyGenerator: req => ipKeyGenerator(req.ip),

  skip: req => RUTAS_EXENTAS.some(ruta => req.path.startsWith(ruta)),

  standardHeaders: true,
  legacyHeaders: false,

  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Demasiadas peticiones. Esperá un momento y volvé a intentar.',
  },
})

export default globalApiLimiter
