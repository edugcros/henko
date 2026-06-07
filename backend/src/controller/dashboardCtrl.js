import { getDashboardStats } from '../services/statsService.js'
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

export const getDashboardData = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant no identificado',
      })
    }

    const timeframe = normalizeTimeframe(req.query.timeframe || req.query.days)
    const stats = await getDashboardStats(tenantId, timeframe)

    return res.status(200).json({
      success: true,
      configured: true,
      timeframe,
      data: stats,
      ...stats,
    })
  } catch (error) {
    logger.error('Dashboard error', { error: error.message, stack: error.stack })

    return res.status(500).json({
      success: false,
      message: 'Error obteniendo datos del dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    })
  }
}

export default getDashboardData
