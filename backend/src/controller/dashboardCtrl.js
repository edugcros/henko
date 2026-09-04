import expressAsyncHandler from 'express-async-handler'
import { getDashboardStats } from '../services/statsService.js'
import { resolveAuthorizedTenantFromRequest } from '../utils/requestContext.js'
import { getSubscriptionSummary } from '../services/subscriptionMetricsService.js'
import logger from '../../config/logger.js'

const normalizeTimeframe = value => {
  const raw = String(value || '').trim()
  if (['7d', '30d', '90d', '1y', 'mtd', 'ytd'].includes(raw)) return raw

  const days = Number.parseInt(raw || '30', 10)
  if (days <= 7) return '7d'
  if (days <= 30) return '30d'
  if (days <= 90) return '90d'
  if (days >= 365) return '1y'

  return '30d'
}

// La ruta ya corre resolveTenantByDomain antes de llegar acá (ver
// dashboardRoute.js), así que req.tenantId (resuelto por dominio) existe —
// pero este handler lo ignoraba y confiaba solo en req.user.tenantId (el del
// JWT), sin cruzar uno contra el otro. resolveAuthorizedTenantFromRequest es
// el mismo helper que ya usa el resto del panel admin para esa doble
// verificación.
export const getDashboardData = expressAsyncHandler(async (req, res) => {
  const { tenantId } = resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  })

  const timeframe = normalizeTimeframe(req.query.timeframe || req.query.days)

  let stats
  try {
    stats = await getDashboardStats(tenantId, timeframe)
  } catch (error) {
    logger.error('Dashboard error', { error: error.message, stack: error.stack })
    throw error
  }

  return res.status(200).json({
    success: true,
    configured: true,
    timeframe,
    data: stats,
    ...stats,
  })
})

/**
 * Obtener métricas de suscripciones para el tenant actual
 */
export const getSubscriptionMetrics = expressAsyncHandler(async (req, res) => {
  const { tenantId } = resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  })

  const subscriptionMetrics = await getSubscriptionSummary(tenantId)

  return res.status(200).json({
    success: true,
    data: subscriptionMetrics,
  })
})

export default getDashboardData
