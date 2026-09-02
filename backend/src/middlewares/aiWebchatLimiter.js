// 📁 src/middlewares/aiWebchatLimiter.js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

const clean = value => String(value || '').trim()

// req.ip ya resuelve la IP real del cliente respetando la config de
// "trust proxy" de Express (app.js). Leer x-forwarded-for a mano acá
// (como se hacía antes) confía en un header que cualquier cliente puede
// falsificar si el proxy de confianza no lo está sobrescribiendo.
const getClientIp = req =>
  ipKeyGenerator(req.ip)

export const aiWebchatLimiter = rateLimit({
  windowMs: Number(process.env.AI_WEBCHAT_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.AI_WEBCHAT_RATE_LIMIT_MAX || 20),
  // La clave se ancla SOLO en tenant+IP. visitorId/sessionId los define
  // el cliente sin ninguna firma que los respalde — usarlos como parte
  // (u override) de la clave permitía evadir el límite por completo
  // mandando un valor distinto en cada request.
  keyGenerator: req => {
    const tenantId = String(req.tenantId || req.tenant?._id || 'unknown')
    return `${tenantId}:${getClientIp(req)}`
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'AI_WEBCHAT_RATE_LIMIT',
    message: 'Demasiados mensajes. Esperá un momento y volvé a intentar.',
  },
})
