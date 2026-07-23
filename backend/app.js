// 📁 app.js
import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import morgan from 'morgan'
import mongoSanitize from 'express-mongo-sanitize'
import path from 'path'
import { fileURLToPath } from 'url'
import cors from 'cors'

import {
  csrfProtectionDynamic,
  handleCsrfError,
  logCsrfStatus,
} from './src/middlewares/csrfMiddleware.js'
import { initCsrfTokenStore } from './src/utils/csrfTokenStore.js'

import { env } from './config/env.js'
import { corsOptions } from './config/corsOptions.js'
import logger from './config/logger.js'

import { notFound, errorHandler } from './src/middlewares/errorHandler.js'
import apiRoutes from './src/routes/index.js'

// =======================================================
// APP INIT
// =======================================================

const app = express()

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

app.use(morgan(env.isProduction ? 'combined' : 'dev'))

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

// =======================================================
// STATIC FILES
// =======================================================

app.use(express.static(path.join(__dirname, 'public')))
app.use('/images', express.static(path.join(__dirname, 'public/images')))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// =======================================================
// HEALTHCHECKS
// =======================================================

app.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    service: env.app?.name || 'Henko Commerce API',
    env: env.nodeEnv,
    uptime: process.uptime(),
  })
})

app.get(`${env.apiPrefix}/health`, (req, res) => {
  return res.status(200).json({
    success: true,
    service: env.app?.name || 'Henko Commerce API',
    env: env.nodeEnv,
    uptime: process.uptime(),
  })
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

  if (!env.isProduction && String(process.env.PREDEPLOY_TUNNEL_MODE || '').toLowerCase() === 'true') {
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
  const origin = String(req.headers.origin || '').replace(/\/+$/, '').toLowerCase()

  const allowedPredeployOrigins = [
    'https://henko-web.vercel.app',
    'https://henko-admin.vercel.app',
  ]

  const enabled =
    !env.isProduction &&
    String(process.env.PREDEPLOY_TUNNEL_MODE || '').toLowerCase() === 'true'

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
// Rutas públicas/sensibles que no deben depender de CSRF durante predeploy.
// Login/register deben protegerse con rate-limit, validación y CORS estricto.
const csrfExemptRoutes = [
  { method: 'POST', path: `${env.apiPrefix}/user/login` },
  { method: 'POST', path: `${env.apiPrefix}/user/admin-login` },
  { method: 'POST', path: `${env.apiPrefix}/user/register` },
  { method: 'POST', path: `${env.apiPrefix}/user/register-admin` },

  { method: 'POST', path: `${env.apiPrefix}/user/forgot-password` },
  { method: 'PUT', path: `${env.apiPrefix}/user/reset-password` },

  { method: 'POST', path: `${env.apiPrefix}/ai-webchat/message` },
  { method: 'POST', path: `${env.apiPrefix}/ai-webchat/event` },
  // Webhook externo real de Mercado Pago.
  { method: 'POST', path: `${env.apiPrefix}/payments/webhook/mercadopago` },

  // Webhook externo real de WhatsApp/Meta. Valida firma propia x-hub-signature-256.
  { method: 'POST', path: `${env.apiPrefix}/whatsapp/webhook` },

  // Agente local de análisis por API key. El endpoint mantiene autenticación propia.
  { method: 'POST', path: `${env.apiPrefix}/product-analysis/import` },
  { method: 'POST', path: `${env.apiPrefix}/product-analysis/process-due` },
  { method: 'POST', path: `${env.apiPrefix}/product-analysis/wishlist-promotions/run` },
]

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

  app.use(async (req, res, next) => {
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method)

    if (isSafeMethod || isCsrfExempt(req)) {
      return next()
    }

    // CSRF middleware es async - necesitamos manejar promises
    try {
      return await csrfProtectionDynamic(req, res, next)
    } catch (error) {
      return next(error)
    }
  })
}

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
