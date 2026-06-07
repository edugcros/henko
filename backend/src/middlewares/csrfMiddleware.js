// 📁 src/middlewares/csrfMiddleware.js
import csurf from 'csurf'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

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
export const csrfProtectionDynamic = (req, res, next) => {
  const dynamicDomain = getCookieDomain(req)

  return csurf({
    cookie: {
      key: '_csrf',
      httpOnly: true,
      secure: env.csrfCookieSecure,
      sameSite: env.csrfCookieSameSite,
      domain: dynamicDomain,
      path: '/',
    },
  })(req, res, next)
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
