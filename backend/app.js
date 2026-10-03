// 📁 app.js
import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import morgan from 'morgan'
import mongoSanitize from 'express-mongo-sanitize'
import path from 'path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'url'
import cors from 'cors'

import {
  csrfExemptRoutes,
  csrfProtectionDynamic,
  handleCsrfError,
  logCsrfStatus,
} from './src/middlewares/csrfMiddleware.js'

import { env } from './config/env.js'
import { estadoDeBase } from './config/connectDB.js'
import { corsOptions } from './config/corsOptions.js'
import logger from './config/logger.js'

import { notFound, errorHandler } from './src/middlewares/errorHandler.js'
import { globalApiLimiter } from './src/middlewares/globalApiLimiter.js'
import { requestId } from './src/middlewares/requestId.js'
import apiRoutes from './src/routes/index.js'

// Los ocho trabajos periódicos, para poder dispararlos desde afuera. El
// porqué está en la sección correspondiente, más abajo.
import { runRecoveryCycle } from './src/workers/aiCartRecoveryWorker.js'
import { runInsightCycle } from './src/workers/aiInsightWorker.js'
import { sweepStaleOperations } from './src/services/ai/aiBudgetService.js'
import { runAccountingAudit } from './src/services/ai/aiAccountingService.js'
import { refreshPendingCertificates } from './src/services/tenant/tenantDomainService.js'
import { runSubscriptionAudit } from './src/services/subscriptionPaymentService.js'
import { runPriceHistoryAudit } from './src/services/pricing/priceHistoryAuditService.js'
import { runOrderReconciliation } from './src/services/paymentOrderService.js'

// =======================================================
// APP INIT
// =======================================================

const app = express()

app.set('trust proxy', env.trustProxy ? 1 : false)
// =======================================================
// PATHS
// =======================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// =======================================================
// TRUST PROXY
// =======================================================

app.set('trust proxy', env.trustProxy ? 1 : false)

// =======================================================
// CORS DINÁMICO MULTI-TENANT
// =======================================================

app.use(cors(corsOptions))
// Bare '*' — la sintaxis correcta para la versión vieja de path-to-regexp
// que trae Express 4 (0.1.13). PR #116 lo había cambiado a '/*splat' para
// la sintaxis nueva de path-to-regexp v7/v8 que trae Express 5 — pero
// Express se volvió a la 4.x (ver PR #117: la 5.x se coló sin querer en un
// bump de Dependabot y rompía en cadena). Confirmado con path-to-regexp
// 0.1.13 en mano: '*' matchea cualquier ruta, '/*splat' NO — solo
// matchearía una URL que terminara literalmente en "splat".
app.options('*', cors(corsOptions))

// =======================================================
// SECURITY LAYER
// =======================================================

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }),
)

// El handshake GET del webhook de WhatsApp manda WHATSAPP_VERIFY_TOKEN como
// query param (hub.verify_token) — morgan 'combined' loguea la URL completa,
// así que sin este token quedaba el secreto en texto plano en los access logs
// cada vez que Meta (re)valida el webhook.
morgan.token('safe-url', req => {
  const url = req.originalUrl || req.url || ''
  return url.replace(/([?&]hub\.verify_token=)[^&]+/i, '$1[redacted]')
})

const PRODUCTION_LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'

app.use(morgan(env.isProduction ? PRODUCTION_LOG_FORMAT : 'dev'))

// =======================================================
// BODY PARSERS
// =======================================================

app.use(
  express.json({
    limit: env.isProduction ? '1mb' : '5mb',
    verify: (req, res, buf) => {
      // Necesario para validar x-hub-signature-256 de Meta/WhatsApp.
      req.rawBody = buf
    },
  }),
)

app.use(
  express.urlencoded({
    extended: true,
    limit: env.isProduction ? '1mb' : '5mb',
  }),
)

// =======================================================
// COOKIES / SANITIZATION
// =======================================================

app.use(cookieParser(env.cookieSecret))
app.use(mongoSanitize())

// Antes de las rutas y antes del rate limiter: si una request se rechaza por
// cuota, ese rechazo también tiene que poder rastrearse.
app.use(requestId)

// =======================================================
// STATIC FILES
// =======================================================

app.use(express.static(path.join(__dirname, 'public')))
app.use('/images', express.static(path.join(__dirname, 'public/images')))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// =======================================================
// HEALTHCHECKS
// =======================================================

// Devolvía 200 fijo, así que informaba "sano" con la base caída. Apuntar el
// health check de Render a eso es peor que no tener ninguno: deja en rotación
// un proceso que no puede contestar nada, y encima con el aval del panel.
//
// El criterio de `listo` —haberse conectado alguna vez, no estar conectado
// ahora— está explicado en `estadoDeBase`, en config/connectDB.js.
//
// Un solo manejador para las dos rutas: antes eran dos copias textuales, y una
// de las dos se iba a quedar atrás en el primer cambio.
const health = (req, res) => {
  const base = estadoDeBase()

  return res.status(base.listo ? 200 : 503).json({
    success: base.listo,
    service: env.app?.name || 'Henko Commerce API',
    env: env.nodeEnv,
    uptime: process.uptime(),
    db: base,
  })
}

app.get('/health', health)
app.get(`${env.apiPrefix}/health`, health)

// =======================================================
// DISPARADOR EXTERNO DE LOS TRABAJOS PERIÓDICOS
// =======================================================
//
// POR QUÉ EXISTE
//
// Los ocho trabajos de abajo se programan con `setInterval` dentro del proceso
// web (ver server.js). Eso funciona mientras el proceso viva, y en el plan
// actual de Render NO vive: el servicio se duerme por inactividad, y un
// temporizador dormido no alcanza su intervalo nunca. Cada despertar vuelve a
// arrancar la cuenta desde cero, así que un trabajo diario podía pasar semanas
// sin correr una vez entera.
//
// Hasta ahora tampoco había forma de ejecutarlos desde afuera: ninguna ruta,
// ningún comando. La única manera de que corrieran era que alguien entrara al
// sitio y esperara los dos minutos de la pasada de arranque.
//
// Esto le pone una puerta. El trabajo sigue viviendo donde vivía; lo único que
// cambia es que ahora se puede golpear desde un programador externo que sí
// está despierto. Los `setInterval` se dejan tal cual: en un plan que no
// duerma vuelven a ser el camino principal, y en desarrollo siguen siendo
// cómodos.
//
// DÓNDE ESTÁ MONTADO Y POR QUÉ ACÁ
//
// Antes del CSRF y del límite de tasa globales, igual que los health checks.
// No es casualidad: un cron no tiene cómo traer un token CSRF, y pasarlo por
// el limitador global lo dejaría sujeto al tráfico de los compradores.
//
// CÓMO SE AUTENTICA
//
// Con un secreto propio, no con una sesión: no hay “usuario” detrás de un
// cron, y las rutas de plataforma exigen un JWT de administrador que una
// máquina no puede obtener. El secreto es solo para esto —`env.js` ya valida
// que los secretos de sesión no se compartan entre sí por el mismo motivo— y
// se compara en tiempo constante.
//
// Si no está configurado, el endpoint responde 503 y no ejecuta nada. Esa es
// la razón de que `JOBS_TRIGGER_SECRET` sea opcional: olvidarse de ponerlo
// deja todo exactamente como estaba, en vez de tumbar el arranque.
const TRABAJOS = {
  'recuperacion-de-carritos': () => runRecoveryCycle({ logger }),
  insights: () => runInsightCycle({ logger }),
  'operaciones-colgadas': () => sweepStaleOperations({ logger }),
  'contabilidad-ia': () => runAccountingAudit({ logger }),
  certificados: () => refreshPendingCertificates({ logger }),
  suscripciones: () => runSubscriptionAudit(),
  'historial-de-precios': () => runPriceHistoryAudit(),
  ordenes: () => runOrderReconciliation(),
}

// Ninguno de los ocho se protege por dentro contra correr dos veces a la vez,
// y ahora hay dos disparadores posibles: el intervalo y esta ruta. Sin esto,
// una pasada lenta podía solaparse con la siguiente y consultar dos veces al
// proveedor por las mismas órdenes.
const trabajosEnCurso = new Set()

const secretoValido = recibido => {
  const esperado = env.jobsTriggerSecret

  if (!esperado) return false

  const a = Buffer.from(String(recibido || ''))
  const b = Buffer.from(esperado)

  // timingSafeEqual exige el mismo largo; comparar antes no filtra nada que
  // el atacante no pueda medir probando largos.
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

app.post(`${env.apiPrefix}/internal/jobs/:nombre`, async (req, res) => {
  if (!env.jobsTriggerSecret) {
    return res.status(503).json({
      success: false,
      message: 'JOBS_TRIGGER_SECRET no está configurado; no se ejecuta nada.',
    })
  }

  if (!secretoValido(req.headers['x-jobs-secret'])) {
    logger.warn('[TRABAJOS] Intento con secreto inválido', {
      trabajo: req.params.nombre,
      ip: req.ip,
    })
    return res.status(401).json({ success: false, message: 'No autorizado' })
  }

  const { nombre } = req.params
  const trabajo = TRABAJOS[nombre]

  if (!trabajo) {
    return res.status(404).json({
      success: false,
      message: `Trabajo desconocido: ${nombre}`,
      disponibles: Object.keys(TRABAJOS),
    })
  }

  if (trabajosEnCurso.has(nombre)) {
    // 409 y no 200: que el programador externo lo vea como lo que es —una
    // pasada que no ocurrió— en vez de creer que corrió.
    return res.status(409).json({
      success: false,
      message: `${nombre} ya está corriendo`,
    })
  }

  trabajosEnCurso.add(nombre)
  const inicio = Date.now()

  try {
    const resultado = await trabajo()

    logger.info('[TRABAJOS] Ejecutado desde afuera', {
      trabajo: nombre,
      ms: Date.now() - inicio,
    })

    return res.json({
      success: true,
      trabajo: nombre,
      ms: Date.now() - inicio,
      resultado: resultado ?? null,
    })
  } catch (error) {
    logger.error('[TRABAJOS] Falló', {
      trabajo: nombre,
      ms: Date.now() - inicio,
      error: error.message,
    })

    // Se contesta acá en vez de delegar al manejador global para que el cron
    // reciba QUÉ trabajo falló y por qué, no un 500 genérico.
    return res.status(500).json({
      success: false,
      trabajo: nombre,
      message: error.message,
    })
  } finally {
    trabajosEnCurso.delete(nombre)
  }
})

// =======================================================
// CSRF GLOBAL DINÁMICO
// =======================================================

const normalizePath = value => {
  const raw = String(value || '').split('?')[0]
  const normalized = raw.replace(/\/+$/, '')
  return normalized || '/'
}

const routePatternToRegex = pattern => {
  const normalized = normalizePath(pattern)

  const regexSource = normalized
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith(':')) {
        return '[^/]+'
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')

  return new RegExp(`^/${regexSource}$`)
}

const matchesRoute = (req, route) => {
  const reqMethod = String(req.method || '').toUpperCase()
  const routeMethod = String(route.method || '').toUpperCase()

  const reqPath = normalizePath(req.originalUrl || req.path || req.url)
  const regex = routePatternToRegex(route.path)

  const matched = routeMethod === reqMethod && regex.test(reqPath)

  if (
    !env.isProduction &&
    String(process.env.PREDEPLOY_TUNNEL_MODE || '').toLowerCase() === 'true'
  ) {
    logger.debug('[CSRF ROUTE MATCH]', {
      route: route.path,
      routeMethod,
      reqMethod,
      reqPath,
      regex: String(regex),
      matched,
    })
  }

  return matched
}

const isTrustedPredeployTunnelRequest = req => {
  const origin = String(req.headers.origin || '')
    .replace(/\/+$/, '')
    .toLowerCase()

  const allowedPredeployOrigins = [env.clientUrl, env.adminFrontendUrl]
    .filter(Boolean)
    .map(u => u.replace(/\/+$/, '').toLowerCase())

  const enabled =
    !env.isProduction && String(process.env.PREDEPLOY_TUNNEL_MODE || '').toLowerCase() === 'true'

  if (enabled) {
    logger.debug('[PREDEPLOY CSRF CHECK]', {
      enabled,
      origin,
      path: req.path,
      originalUrl: req.originalUrl,
      method: req.method,
    })
  }

  return enabled && allowedPredeployOrigins.includes(origin)
}
// La lista vive en csrfMiddleware: qué rutas quedan fuera del CSRF es una
// decisión del CSRF, no del ensamblado de la app. Además así se puede probar
// sin levantar el grafo entero de rutas — que es lo que impidió, hasta ahora,
// tener un test que notara la ausencia del webhook de suscripciones.

// Solo para etapa Vercel + TryCloudflare.
const tunnelCsrfExemptRoutes = [
  // Sesión
  { method: 'POST', path: `${env.apiPrefix}/user/refresh` },
  { method: 'POST', path: `${env.apiPrefix}/user/logout` },

  // Payment
  // Payments storefront predeploy
  { method: 'POST', path: `${env.apiPrefix}/payments/process` },
  { method: 'POST', path: `${env.apiPrefix}/payments/create-preference` },
  { method: 'POST', path: `${env.apiPrefix}/payments/create-payment` },
  { method: 'POST', path: `${env.apiPrefix}/payments/confirm` },

  // Producto
  // Productos admin predeploy
  { method: 'POST', path: `${env.apiPrefix}/product` },
  { method: 'POST', path: `${env.apiPrefix}/product/` },
  { method: 'PUT', path: `${env.apiPrefix}/product/:id` },
  { method: 'PATCH', path: `${env.apiPrefix}/product/:id` },
  { method: 'DELETE', path: `${env.apiPrefix}/product/:id` },
  { method: 'POST', path: `${env.apiPrefix}/product/analyze-visual` },
  { method: 'DELETE', path: `${env.apiPrefix}/product/:productId/image` },
  { method: 'PUT', path: `${env.apiPrefix}/product/:productId/variant-image` },
  { method: 'POST', path: `${env.apiPrefix}/product/:id/upload-image` },
  { method: 'POST', path: `${env.apiPrefix}/product/:productId/upload-image` },
  // Wishlist
  { method: 'PUT', path: `${env.apiPrefix}/user/wishlist/:productId` },

  // Carrito storefront predeploy
  { method: 'POST', path: `${env.apiPrefix}/user/cart` },
  { method: 'PUT', path: `${env.apiPrefix}/user/cart` },
  { method: 'DELETE', path: `${env.apiPrefix}/user/cart` },
  { method: 'DELETE', path: `${env.apiPrefix}/user/cart/:productId` },
  { method: 'DELETE', path: `${env.apiPrefix}/user/cart/empty` },
  { method: 'POST', path: `${env.apiPrefix}/user/cart/cash-order` },

  // Órdenes
  { method: 'POST', path: `${env.apiPrefix}/order/create` },
  { method: 'POST', path: `${env.apiPrefix}/order/:orderId/resend-email` },
  { method: 'PUT', path: `${env.apiPrefix}/order/:id/status` },
  { method: 'PUT', path: `${env.apiPrefix}/order/:id/payment-status` },
  { method: 'PUT', path: `${env.apiPrefix}/order/:id/fulfillment-status` },
  { method: 'POST', path: `${env.apiPrefix}/order/:id/cancel` },
  { method: 'POST', path: `${env.apiPrefix}/order/:id/refund` },
  { method: 'DELETE', path: `${env.apiPrefix}/order/:id` },

  // Productos
  { method: 'PUT', path: `${env.apiPrefix}/product/rating/:productId` },
  { method: 'PUT', path: `${env.apiPrefix}/product/:productId/rating/:ratingId/helpful` },
]

const isCsrfExempt = req => {
  if (csrfExemptRoutes.some(route => matchesRoute(req, route))) {
    return true
  }

  if (isTrustedPredeployTunnelRequest(req)) {
    if (tunnelCsrfExemptRoutes.some(route => matchesRoute(req, route))) {
      return true
    }
  }

  return false
}

if (env.csrfEnabled) {
  app.use(logCsrfStatus)

  app.use((req, res, next) => {
    if (isCsrfExempt(req)) {
      return next()
    }

    // csrfProtectionDynamic ya distingue internamente métodos seguros
    // (setea la cookie y expone req.csrfToken sin exigir validación) de
    // los inseguros (además valida el token). Saltarlo para GET/HEAD/OPTIONS
    // dejaba a /user/csrf-token sin req.csrfToken nunca — el propio
    // endpoint que debe entregar el token quedaba siempre en 500.
    return csrfProtectionDynamic(req, res, next)
  })
}

// =======================================================
// LÍMITE DE TASA GLOBAL
// =======================================================
//
// env.rateLimit existía con sus dos valores desde hacía tiempo y no lo consumía
// nadie: configuración que PARECE protección cuando uno lee el .env y no lo es.
// O se monta o se borra; dejarla ahí es lo peor de las dos opciones.
//
// El login ya tiene bloqueo por intentos, así que la fuerza bruta estaba
// cubierta. Lo que quedaba sin techo era todo lo demás: alta de cuentas,
// recuperación de contraseña, y cualquier endpoint autenticado.
//
// Es un piso, no un reemplazo: los límites finos siguen donde estaban —el chat
// de IA, las consultas, los pagos— porque cada uno protege otra cosa y con otro
// número.

app.use(env.apiPrefix, globalApiLimiter)

// =======================================================
// API ROUTES
// =======================================================

app.use(env.apiPrefix, apiRoutes)

// =======================================================
// CSRF ERROR HANDLER
// =======================================================

app.use(handleCsrfError)

// =======================================================
// 404 + GLOBAL ERROR HANDLER
// =======================================================

app.use(notFound)
app.use(errorHandler)

// =======================================================
// EXPORT
// =======================================================

export default app
