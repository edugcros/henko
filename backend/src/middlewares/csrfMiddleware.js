// 📁 src/middlewares/csrfMiddleware.js
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import crypto from 'node:crypto'
import { getCookieDomain, usePartitionedCookies } from '../utils/cookieHelper.js'
import {
  SUBSCRIPTION_WEBHOOK_PATH,
  SENDGRID_WEBHOOK_PATH,
} from '../config/subscriptionConfig.js'

/**
 * Rutas que no pasan por CSRF.
 *
 * POR QUÉ VIVE ACÁ Y NO EN app.js
 *
 * Qué queda fuera del CSRF es una decisión del CSRF. Estando en el ensamblado
 * de la app, para comprobarla había que importar app.js entero —con todas las
 * rutas, modelos y servicios detrás—, y por eso no había ninguna prueba que
 * notara una ausencia. Acá se puede mirar la lista sin levantar nada.
 *
 * Cada entrada necesita su propia razón de ser inmune: un login se protege con
 * rate-limit y CORS estricto; un webhook externo, con la firma del proveedor.
 * Agregar una ruta que no tenga ninguna de las dos la deja abierta.
 */
export const csrfExemptRoutes = [
  { method: 'POST', path: `${env.apiPrefix}/user/login` },
  { method: 'POST', path: `${env.apiPrefix}/user/admin-login` },
  { method: 'POST', path: `${env.apiPrefix}/user/register` },
  { method: 'POST', path: `${env.apiPrefix}/user/register-admin` },

  { method: 'POST', path: `${env.apiPrefix}/metrics/events` },
  { method: 'POST', path: `${env.apiPrefix}/user/forgot-password` },
  { method: 'PUT', path: `${env.apiPrefix}/user/reset-password` },

  { method: 'POST', path: `${env.apiPrefix}/ai-webchat/message` },
  { method: 'POST', path: `${env.apiPrefix}/ai-webchat/event` },
  // Webhook externo real de Mercado Pago.
  { method: 'POST', path: `${env.apiPrefix}/payments/webhook/mercadopago` },

  // Webhook de SUSCRIPCIONES de Mercado Pago. Faltaba, y el olvido no se veía:
  // el alta de una suscripción la activa el flujo síncrono del panel, así que
  // todo parecía andar. Lo que llega SOLO por acá son las renovaciones
  // mensuales, los pagos rechazados y las cancelaciones — con 403, una
  // suscripción dada de baja en Mercado Pago seguía figurando activa en HENKO
  // y nadie se enteraba hasta la fecha de cobro.
  //
  // La ruta se toma de subscriptionConfig, la misma constante con la que se
  // monta el router y con la que getWebhookUrl() arma la URL que se configura
  // en Mercado Pago. Escrita a mano, las tres se desincronizan sin que nada
  // falle en el momento — ya pasó una vez con la URL declarada.
  //
  // Eximirlo es seguro porque verifica la firma HMAC de Mercado Pago
  // (verifyMercadoPagoWebhookSignature, en subscriptionWebhookCtrl): un
  // webhook servidor-a-servidor no trae cookies, así que el CSRF no puede
  // protegerlo, y la firma sí.
  { method: 'POST', path: `${env.apiPrefix}${SUBSCRIPTION_WEBHOOK_PATH}` },

  // Eventos de entrega de SendGrid. Verifica firma ECDSA sobre el cuerpo crudo
  // (verifySendgridSignature). Mismo razonamiento que arriba: sin cookies, el
  // CSRF no puede protegerlo y la firma sí.
  { method: 'POST', path: `${env.apiPrefix}${SENDGRID_WEBHOOK_PATH}` },

  // Webhook externo real de WhatsApp/Meta. Valida firma propia x-hub-signature-256.
  { method: 'POST', path: `${env.apiPrefix}/whatsapp/webhook` },

  // Agente local de análisis por API key. El endpoint mantiene autenticación propia.
  { method: 'POST', path: `${env.apiPrefix}/product-analysis/import` },
  { method: 'POST', path: `${env.apiPrefix}/product-analysis/process-due` },
  { method: 'POST', path: `${env.apiPrefix}/product-analysis/wishlist-promotions/run` },

  // Sesión - refresh y logout (requieren autenticación JWT, no CSRF)
  { method: 'POST', path: `${env.apiPrefix}/user/refresh` },
  { method: 'POST', path: `${env.apiPrefix}/user/logout` },
]

/**
 * Middleware CSRF recomendado para arquitectura multi-tenant.
 * Calcula domain dinámico por request.
 */
const CSRF_SECRET_COOKIE = '_csrf'
const CSRF_TOKEN_MAX_AGE_MS = 15 * 60 * 1000

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const getCsrfSigningSecret = () => {
  const secret =
    env.csrfSecret ||
    process.env.CSRF_SECRET ||
    env.cookieSecret ||
    process.env.COOKIE_SECRET

  if (!secret) {
    throw new Error('CSRF_SECRET or COOKIE_SECRET is required')
  }

  if (env.isProduction && String(secret).length < 32) {
    throw new Error('CSRF secret must contain at least 32 characters in production')
  }

  return String(secret)
}

const signValue = value => {
  return crypto
    .createHmac('sha256', getCsrfSigningSecret())
    .update(String(value))
    .digest('base64url')
}

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))

  if (left.length !== right.length) {
    return false
  }

  return crypto.timingSafeEqual(left, right)
}

const createSignedSecretCookie = () => {
  const secretValue = crypto.randomBytes(32).toString('base64url')
  const signature = signValue(secretValue)

  return {
    secretValue,
    cookieValue: `${secretValue}.${signature}`,
  }
}

const readSignedSecretCookie = req => {
  const raw = String(req.cookies?.[CSRF_SECRET_COOKIE] || '')
  const [secretValue, signature] = raw.split('.')

  if (!secretValue || !signature) {
    return null
  }

  const expectedSignature = signValue(secretValue)

  if (!safeEqual(signature, expectedSignature)) {
    return null
  }

  return secretValue
}

const setSignedSecretCookie = (req, res) => {
  const { secretValue, cookieValue } = createSignedSecretCookie()
  const cookieDomain = getCookieDomain(req)

  res.cookie(CSRF_SECRET_COOKIE, cookieValue, {
    httpOnly: true,
    secure: env.csrfCookieSecure,
    sameSite: env.csrfCookieSameSite,
    domain: cookieDomain,
    path: '/',
    maxAge: CSRF_TOKEN_MAX_AGE_MS,
    // ESTO FALTABA, Y ROMPÍA EL DOMINIO PROPIO SIN DECIRLO
    //
    // token y refreshToken salían con Partitioned y `_csrf` no. En un comercio
    // con dominio propio Chrome bloquea las cookies de terceros sin partición:
    // la sesión sobrevive y el secreto de CSRF no llega, así que el comprador
    // queda logueado y ningún POST le pasa. Comprobado en producción con
    // AUTH_COOKIE_PARTITIONED=true: Set-Cookie: _csrf=…; SameSite=None, sin
    // Partitioned.
    ...(usePartitionedCookies(env.csrfCookieSameSite) ? { partitioned: true } : {}),
  })

  return secretValue
}

const createPublicCsrfToken = secretValue => {
  const nonce = crypto.randomBytes(32).toString('base64url')
  const signature = signValue(`${secretValue}.${nonce}`)

  return `${nonce}.${signature}`
}

const verifyPublicCsrfToken = (token, secretValue) => {
  if (!token || typeof token !== 'string') {
    return false
  }

  const [nonce, signature] = token.split('.')

  if (!nonce || !signature) {
    return false
  }

  const expectedSignature = signValue(`${secretValue}.${nonce}`)

  return safeEqual(signature, expectedSignature)
}

const getCsrfTokenFromRequest = req => {
  const configuredHeader = String(env.csrfHeaderName || 'x-csrf-token').toLowerCase()

  return (
    req.headers[configuredHeader] ||
    req.headers['x-csrf-token'] ||
    req.headers['X-CSRF-Token'] ||
    req.body?._csrf
  )
}

const createCsrfError = () => {
  const error = new Error('CSRF token inválido o ausente')
  error.code = 'EBADCSRFTOKEN'
  error.statusCode = 403
  return error
}

/**
 * Middleware CSRF compatible con el contrato anterior de csurf:
 * - Mantiene req.csrfToken()
 * - Mantiene cookie interna _csrf
 * - Mantiene validación por header X-CSRF-Token
 * - Mantiene dominio dinámico multi-tenant
 */
export const csrfProtectionDynamic = (req, res, next) => {
  try {
    const method = String(req.method || '').toUpperCase()
    const isUnsafeMethod = unsafeMethods.has(method)

    let secretValue = readSignedSecretCookie(req)

    if (!secretValue) {
      if (isUnsafeMethod) {
        return next(createCsrfError())
      }

      secretValue = setSignedSecretCookie(req, res)
    }

    req.csrfToken = (options = {}) => {
      if (options?.overwrite) {
        secretValue = setSignedSecretCookie(req, res)
      }

      return createPublicCsrfToken(secretValue)
    }

    if (!isUnsafeMethod) {
      return next()
    }

    const requestToken = getCsrfTokenFromRequest(req)

    if (!verifyPublicCsrfToken(requestToken, secretValue)) {
      return next(createCsrfError())
    }

    return next()
  } catch (error) {
    return next(error)
  }
}
/**
 * Handler único y centralizado para errores CSRF.
 */
export const handleCsrfError = (err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') {
    return next(err)
  }

  const cookieDomain = getCookieDomain(req)

  logger.warn(
    `CSRF Violation: ${req.method} ${req.originalUrl} | Host: ${req.get('host')} | Origin: ${req.get('origin') || 'n/a'}`,
  )

  // Los atributos del borrado tienen que coincidir con los del seteo —incluido
  // Partitioned— o el navegador trata la cookie a borrar como otra distinta y
  // la original se queda viva. Mismo criterio que clearAuthCookies.
  const particionada = usePartitionedCookies(env.csrfCookieSameSite)

  res.clearCookie('_csrf', {
    domain: cookieDomain,
    path: '/',
    httpOnly: true,
    secure: env.csrfCookieSecure,
    sameSite: env.csrfCookieSameSite,
    ...(particionada ? { partitioned: true } : {}),
  })

  res.clearCookie(env.csrfCookieName || 'XSRF-TOKEN', {
    domain: cookieDomain,
    path: '/',
    httpOnly: false,
    secure: env.csrfCookieSecure,
    sameSite: env.csrfCookieSameSite,
    ...(particionada ? { partitioned: true } : {}),
  })

  return res.status(403).json({
    success: false,
    code: 'EBADCSRFTOKEN',
    message: 'CSRF token inválido o ausente',
  })
}

/**
 * Log solo en desarrollo.
 */
export const logCsrfStatus = (req, res, next) => {
  if (!env.isProduction) {
    const hasSecret = req.cookies?._csrf ? '✅' : '❌'
    const tokenInHeader =
      req.headers[env.csrfHeaderName || 'x-csrf-token']
        ? '✅'
        : '❌'

    logger.debug(
      `[CSRF] Secret: ${hasSecret} | Header: ${tokenInHeader} | Method: ${req.method} | Host: ${req.get('host')}`,
    )
  }

  return next()
}
