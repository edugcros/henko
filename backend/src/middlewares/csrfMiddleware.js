// 📁 src/middlewares/csrfMiddleware.js
// NUEVA ESTRATEGIA: Validar contra sesión del usuario, no contra cookies
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import { verifyCsrfToken, invalidateCsrfToken } from '../utils/csrfTokenStore.js'
import { getUserIdFromRequest } from '../utils/requestContext.js'

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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
 * CSRF Middleware nuevo - valida contra sesión del usuario
 * NO REQUIERE COOKIES - funciona cross-site sin problemas
 */
export const csrfProtectionDynamic = async (req, res, next) => {
  try {
    const method = String(req.method || '').toUpperCase()
    const isUnsafeMethod = unsafeMethods.has(method)

    // GET/HEAD/OPTIONS no requieren CSRF
    if (!isUnsafeMethod) {
      return next()
    }

    // Para unsafe methods: validar token contra sesión del usuario
    const userId = getUserIdFromRequest(req)

    if (!userId) {
      return next(createCsrfError())
    }

    const requestToken = getCsrfTokenFromRequest(req)

    if (!requestToken) {
      return next(createCsrfError())
    }

    const isValid = await verifyCsrfToken(userId, requestToken)

    if (!isValid) {
      return next(createCsrfError())
    }

    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Handler para errores CSRF
 */
export const handleCsrfError = (err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') {
    return next(err)
  }

  logger.warn(
    `CSRF Violation: ${req.method} ${req.originalUrl} | Host: ${req.get('host')} | Origin: ${req.get('origin') || 'n/a'}`,
  )

  return res.status(403).json({
    success: false,
    code: 'EBADCSRFTOKEN',
    message: 'CSRF token inválido o ausente',
  })
}

/**
 * Log solo en desarrollo
 */
export const logCsrfStatus = (req, res, next) => {
  if (!env.isProduction) {
    const tokenInHeader =
      req.headers[env.csrfHeaderName || 'x-csrf-token']
        ? '✅'
        : '❌'

    logger.debug(
      `[CSRF] Token in header: ${tokenInHeader} | Method: ${req.method} | User: ${getUserIdFromRequest(req) || 'anon'}`,
    )
  }

  return next()
}
