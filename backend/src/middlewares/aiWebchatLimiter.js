// 📁 src/middlewares/aiWebchatLimiter.js
import rateLimit from 'express-rate-limit'

const clean = value => String(value || '').trim()

const getClientIp = req => {
  const forwardedFor = clean(req.headers['x-forwarded-for'])
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  return clean(req.ip || req.socket?.remoteAddress || 'unknown')
}

export const aiWebchatLimiter = rateLimit({
  windowMs: Number(process.env.AI_WEBCHAT_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.AI_WEBCHAT_RATE_LIMIT_MAX || 20),
  keyGenerator: req => {
    const tenantId = String(req.tenantId || req.tenant?._id || 'unknown')
    const visitorId = clean(req.body?.visitorId || req.headers['x-ai-visitor-id']).slice(0, 160)
    const sessionId = clean(req.body?.sessionId || req.headers['x-ai-session-id']).slice(0, 160)
    const ip = getClientIp(req)

    return `${tenantId}:${visitorId || sessionId || ip}`
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'AI_WEBCHAT_RATE_LIMIT',
    message: 'Demasiados mensajes. Esperá un momento y volvé a intentar.',
  },
})
