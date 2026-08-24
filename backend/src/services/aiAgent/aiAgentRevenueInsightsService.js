// 📁 src/services/aiAgent/aiAgentRevenueInsightsService.js
//
// Agregaciones de ingreso ligadas al agente de IA — recuperación de carritos
// (Bloque 3) y ventas influenciadas (Bloque 4). Extraídas de
// aiAgentAdminCtrl.js para que el tablero económico general
// (statsService.js::getDashboardStats) pueda usar exactamente los mismos
// números sin duplicar la query.

import mongoose from 'mongoose'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import UserMetricEvent, { USER_METRIC_EVENTS } from '../../models/userMetricEventModel.js'

const buildPeriodMatch = (tenantObjectId, periodDate, extra = {}) => ({
  tenantId: tenantObjectId,
  ...extra,
  ...(periodDate ? { createdAt: { $gte: periodDate } } : {}),
})

/**
 * Recuperación de carritos por WhatsApp/email — mismo cálculo que ya usaba
 * aiAgentAdminCtrl.js::getAiAgentMetrics (revenue = suma de
 * cartSnapshot.subtotalCents de los AiCartRecovery en status:'converted',
 * ver commerceEvents/... markCartRecoveryConverted del Bloque 3).
 */
export const getCartRecoveryRevenue = async (tenantId, periodDate) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))

  const recoveryStats = await AiCartRecovery.aggregate([
    { $match: buildPeriodMatch(tenantObjectId, periodDate) },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        revenue: {
          $sum: {
            $cond: [{ $eq: ['$status', 'converted'] }, '$cartSnapshot.subtotalCents', 0],
          },
        },
      },
    },
  ])

  const recByStatus = Object.fromEntries(recoveryStats.map(s => [s._id, s.count]))
  const total = recoveryStats.reduce((sum, s) => sum + s.count, 0)
  const converted = recByStatus.converted || 0
  const recoveredRevenueCents = recoveryStats.find(s => s._id === 'converted')?.revenue || 0

  return {
    total,
    sent: recByStatus.sent || 0,
    converted,
    failed: recByStatus.failed || 0,
    pending: (recByStatus.pending || 0) + (recByStatus.scheduled || 0),
    conversionRate: total > 0 ? Math.round((converted / total) * 10000) / 100 : 0,
    recoveredRevenueCents,
  }
}

/**
 * Ventas influenciadas por IA — mismo cálculo que ya usaba
 * aiAgentAdminCtrl.js::getAiAgentMetrics, sobre el registro server-side de
 * PURCHASE (Bloque 1) y el flag que le agrega
 * commerceEventService.js::markOrderAiInfluenced (Bloque 4). `totalRevenue`/
 * `aiInfluencedRevenue` son decimales (UserMetricEvent.value ya viaja
 * convertido con Money.toDecimal) — el nombre sin "Cents" es intencional,
 * corrige un mislabel del Bloque 4 que nadie llegó a consumir todavía.
 */
export const getAiInfluencedSalesStats = async (tenantId, periodDate) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))

  const [facet] = await UserMetricEvent.aggregate([
    {
      $match: buildPeriodMatch(tenantObjectId, periodDate, {
        eventType: USER_METRIC_EVENTS.PURCHASE,
        source: 'system',
      }),
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$value' },
        aiInfluencedRevenue: { $sum: { $cond: ['$metadata.aiInfluenced', '$value', 0] } },
        totalOrders: { $sum: 1 },
        aiInfluencedOrders: { $sum: { $cond: ['$metadata.aiInfluenced', 1, 0] } },
      },
    },
  ])

  const totalRevenue = facet?.totalRevenue || 0
  const aiInfluencedRevenue = facet?.aiInfluencedRevenue || 0

  return {
    totalRevenue,
    aiInfluencedRevenue,
    totalOrders: facet?.totalOrders || 0,
    aiInfluencedOrders: facet?.aiInfluencedOrders || 0,
    percentage: totalRevenue > 0 ? Math.round((aiInfluencedRevenue / totalRevenue) * 10000) / 100 : 0,
  }
}

export default { getCartRecoveryRevenue, getAiInfluencedSalesStats }
