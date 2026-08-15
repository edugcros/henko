// 📁 src/middlewares/turnstileMiddleware.js
import logger from '../../config/logger.js'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const getSecretKey = () => String(process.env.TURNSTILE_SECRET_KEY || '').trim()

let warnedOnce = false

/**
 * Sin TURNSTILE_SECRET_KEY configurada, deja pasar todo sin verificar (con un
 * único warning) en vez de bloquear el registro. Así el código se puede
 * deployar antes de tener la key de Cloudflare, igual que sendgrid_api pudo
 * deployarse antes de estar habilitado — nunca acoplar un deploy de código a
 * un secreto todavía no cargado en el dashboard.
 */
export const verifyTurnstile = async (req, res, next) => {
  const secretKey = getSecretKey()

  if (!secretKey) {
    if (!warnedOnce) {
      warnedOnce = true
      logger.warn(
        '[TURNSTILE] TURNSTILE_SECRET_KEY no configurada: el registro no está protegido contra bots.',
      )
    }

    return next()
  }

  const token = String(req.body?.turnstileToken || '').trim()

  if (!token) {
    return res.status(400).json({
      success: false,
      code: 'TURNSTILE_TOKEN_MISSING',
      message: 'Verificación anti-bot requerida.',
    })
  }

  try {
    const params = new URLSearchParams({
      secret: secretKey,
      response: token,
    })

    if (req.ip) params.set('remoteip', req.ip)

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    })

    const result = await response.json()

    if (!result.success) {
      logger.warn('[TURNSTILE] Verificación rechazada', {
        errorCodes: result['error-codes'],
        ip: req.ip,
      })

      return res.status(400).json({
        success: false,
        code: 'TURNSTILE_VERIFICATION_FAILED',
        message: 'No pudimos verificar que sos una persona. Intentá de nuevo.',
      })
    }

    return next()
  } catch (error) {
    // Cloudflare caído o inalcanzable: no es el bot el problema. Fail-open
    // para no tumbar el registro entero por una dependencia externa.
    logger.error('[TURNSTILE] Error consultando siteverify', {
      message: error.message,
    })

    return next()
  }
}
