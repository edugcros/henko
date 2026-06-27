// 📁 src/middlewares/csrfMiddleware.js
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import crypto from 'node:crypto'

/**
 * Determina el dominio de cookie de forma segura.
 *
 * Reglas:
 * - localhost / 127.0.0.1 => undefined
 * - root domain de plataforma => .rootDomain
 * - subdominios bajo root domain => .rootDomain
 * - henko.local en development => .henko.local
 * - custom domains externos => undefined
 */
export const getCookieDomain = req => {
  const host = String(
    req.hostname ||
      req.get('host')?.split(':')[0] ||
      '',
  )
    .trim()
    .toLowerCase()

  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return undefined
  }

  const rootDomain = String(
    env.rootDomain ||
      env.publicBaseDomain ||
      '',
  )
    .replace(/^\./, '')
    .trim()
    .toLowerCase()

  if (rootDomain && host === rootDomain) {
    return `.${rootDomain}`
  }

  if (rootDomain && host.endsWith(`.${rootDomain}`)) {
    return `.${rootDomain}`
  }

  // Desarrollo local tipo admin.henko.local / api.henko.local / henko.local
  if (
    env.isDevelopment &&
    (host === 'henko.local' || host.endsWith('.henko.local'))
  ) {
    return '.henko.local'
  }

  // Custom domains externos:
  // no seteamos domain global; el navegador la asocia al host exacto.
  return undefined
}

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

  res.clearCookie('_csrf', {
    domain: cookieDomain,
    path: '/',
    httpOnly: true,
    secure: env.csrfCookieSecure,
    sameSite: env.csrfCookieSameSite,
  })

  res.clearCookie(env.csrfCookieName || 'XSRF-TOKEN', {
    domain: cookieDomain,
    path: '/',
    httpOnly: false,
    secure: env.csrfCookieSecure,
    sameSite: env.csrfCookieSameSite,
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
