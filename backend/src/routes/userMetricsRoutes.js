// 📁 src/routes/userMetricsRoutes.js
import express from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { SharedRateLimitStore } from '../middlewares/sharedRateLimitStore.js'

import { reportClientCrash, trackUserMetricEvent } from '../controller/userMetricsCtrl.js'
import { requireTenant, resolveTenantByDomain } from '../middlewares/tenantMiddleware.js'

const router = express.Router()

const getTenantKey = req => {
  return (
    req.tenant?._id?.toString?.() ||
    req.resolvedTenant?._id?.toString?.() ||
    req.tenantId?.toString?.() ||
    req.headers?.['x-tenant-domain'] ||
    req.headers?.host ||
    req.hostname ||
    'unknown-tenant'
  )
}

// Clavea sobre req.ip y no sobre el primer valor de x-forwarded-for.
//
// EL AGUJERO
//
// El limiter de /events tomaba la IP del primer valor crudo de
// x-forwarded-for, que lo elige quien llama. Mandando un header distinto en
// cada request, cada intento caía en un cubo nuevo y el techo de 180/min no
// frenaba absolutamente nada: /api/metrics/events es público y cada evento
// aceptado es una escritura en userMetricEvent, la colección que más crece y la
// única de las ocho sin TTL. O sea que el límite que protege la base de un
// flood era decorativo.
//
// req.ip sale de `trust proxy: 1` (app.js): lo resuelve el proxy contando
// saltos de confianza y el cliente no lo decide. Es lo que ya usan
// globalApiLimiter, enqRoute, paymentRoutes, subscriptionRoutes y
// aiWebchatLimiter — éste era el único que quedaba.
//
// Se exporta para poder probarla: express-rate-limit no expone el keyGenerator
// del middleware ya construido, así que sin esto la prueba comparaba undefined
// contra undefined y pasaba sin verificar nada.
export const claveDeRateLimit = req => `${getTenantKey(req)}:${ipKeyGenerator(req.ip)}`

const metricsRateLimiter = rateLimit({
  // Compartido entre instancias: con el almacén por defecto, que vive en la
  // memoria del proceso, este techo se multiplica por la cantidad de procesos.
  store: new SharedRateLimitStore('user-metrics'),
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: claveDeRateLimit,
  handler: (req, res, _next, options) => {
    const retryAfter = Math.ceil((options.windowMs || 60 * 1000) / 1000)

    res.setHeader('Retry-After', String(retryAfter))

    return res.status(429).json({
      success: false,
      message: 'Demasiados eventos enviados. Intenta nuevamente en unos segundos.',
      retryAfter,
    })
  },
})

// Techo propio y mucho más bajo que el de eventos: un crash en bucle de
// render puede disparar reportes sin freno, y alcanza con los primeros para
// entender la falla.
//
// Clavea sobre req.ip y NO sobre getClientIp: ese helper toma el primer valor
// crudo de x-forwarded-for, que lo elige quien llama. Con un header distinto
// por request cada intento cae en un cubo nuevo y el techo no frena nada —y
// cada reporte aceptado escribe varios kilobytes al log. req.ip sale de
// `trust proxy: 1`, así que lo resuelve el proxy y el cliente no lo decide.
// Es además lo que ya usan globalApiLimiter y enqRoute.
const crashRateLimiter = rateLimit({
  store: new SharedRateLimitStore('client-crash'),
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: claveDeRateLimit,
  // El cliente ya está roto: no tiene sentido devolverle un cuerpo de error
  // ni que reintente.
  handler: (_req, res) => res.status(204).end(),
})

router.post(
  '/events',
  metricsRateLimiter,
  resolveTenantByDomain,
  requireTenant,
  trackUserMetricEvent,
)

// A diferencia de /events, acá NO va resolveTenantByDomain. Ese middleware no
// sólo adjunta el comercio: ante un dominio desconocido o inactivo contesta 404
// y no llama a next(). O sea que en el escenario que este endpoint existe para
// diagnosticar —el dominio que no resuelve— la request moría antes del handler
// y el crash no quedaba registrado en ninguna parte.
//
// El comercio se identifica por el dominio, que el handler ya lee de los
// headers. Alcanza para saber de qué tienda es el crash, y de paso saca a Mongo
// del camino: el reporte de una falla no debería depender de que la base esté
// arriba.
router.post('/client-error', crashRateLimiter, reportClientCrash)

export default router
