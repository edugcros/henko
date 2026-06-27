// 📁 src/routes/userMetricsRoutes.js
import express from 'express'
import rateLimit from 'express-rate-limit'

import { trackUserMetricEvent } from '../controller/userMetricsCtrl.js'
import {
  requireTenant,
  resolveTenantByDomain,
} from '../middlewares/tenantMiddleware.js'

const router = express.Router()

const getClientIp = req => {
  return (
    String(req.headers?.['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown-client'
  )
}

const getTenantKey = req => {
  return (
    req.tenant?._id?.toString?.() ||
    req.resolvedTenant?._id?.toString?.() ||
    req.tenantId?.toString?.() ||
    req.headers?.['x-tenant-domain'] ||
    req.headers?.host ||
    req.hostname ||
    'unknown-tenant'
  )
}

const metricsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => `${getTenantKey(req)}:${getClientIp(req)}`,
  handler: (req, res, _next, options) => {
    const retryAfter = Math.ceil((options.windowMs || 60 * 1000) / 1000)

    res.setHeader('Retry-After', String(retryAfter))

    return res.status(429).json({
      success: false,
      message: 'Demasiados eventos enviados. Intenta nuevamente en unos segundos.',
      retryAfter,
    })
  },
})

router.post(
  '/events',
  metricsRateLimiter,
  resolveTenantByDomain,
  requireTenant,
  trackUserMetricEvent,
)

export default router