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
  getCookieDomain,
  handleCsrfError,
  logCsrfStatus,
} from './src/middlewares/csrfMiddleware.js'

import { env } from './config/env.js'
import { corsOptions } from './config/corsOptions.js'

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
  const normalized = String(value || '').replace(/\/+$/, '')
  return normalized || '/'
}

const csrfExemptRoutes = [
  { method: 'POST', path: `${env.apiPrefix}/user/register-admin` },
  { method: 'POST', path: `${env.apiPrefix}/user/forgot-password` },
  { method: 'PUT', path: `${env.apiPrefix}/user/reset-password` },

  // Webhook externo real de Mercado Pago
  { method: 'POST', path: `${env.apiPrefix}/payments/webhook/mercadopago` },
]

const isCsrfExempt = req => {
  const requestPath = normalizePath(req.path)

  return csrfExemptRoutes.some(route => {
    return (
      route.method === req.method &&
      normalizePath(route.path) === requestPath
    )
  })
}

if (env.csrfEnabled) {
  app.use(logCsrfStatus)

  app.use((req, res, next) => {
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method)

    if (isSafeMethod || isCsrfExempt(req)) {
      return next()
    }

    return csrfProtectionDynamic(req, res, next)
  })

  /**
   * Endpoint centralizado para emitir token CSRF.
   * El token legible viaja en XSRF-TOKEN;
   * el secreto interno queda en _csrf.
   */
  app.get(
    `${env.apiPrefix}/user/csrf-token`,
    csrfProtectionDynamic,
    (req, res) => {
      const token = req.csrfToken()
      const cookieDomain = getCookieDomain(req)

      res.cookie(env.csrfCookieName || 'XSRF-TOKEN', token, {
        httpOnly: false,
        secure: env.csrfCookieSecure,
        sameSite: env.csrfCookieSameSite,
        domain: cookieDomain,
        path: '/',
        maxAge: 15 * 60 * 1000,
      })

      return res.status(200).json({
        success: true,
        csrfToken: token,
      })
    },
  )
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