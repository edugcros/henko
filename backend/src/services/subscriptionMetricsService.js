// 📁 src/services/subscriptionMetricsService.js
// Servicio para calcular métricas de suscripciones

import Tenant from '../models/tenantModel.js'
import logger from '../../config/logger.js'

/**
 * Obtener resumen de suscripciones para un tenant
 * Incluye conteos por estado y plan
 */
export const getSubscriptionSummary = async tenantId => {
  try {
    // Obtener el tenant para ver su estado de suscripción
    const tenant = await Tenant.findById(tenantId)
      .select('plan subscriptionStatus subscriptionPastDueAt integrations.subscriptionMercadoPago')
      .lean()

    if (!tenant) {
      return {
        currentPlan: 'free',
        status: 'none',
        isActive: false,
        mrr: 0,
        nextBillingDate: null,
      }
    }

    const planPrices = {
      starter: 26.14,
      pro: 99,
      free: 0,
    }

    const isActive = tenant.subscriptionStatus === 'active'
    const mrr = isActive ? planPrices[tenant.plan] || 0 : 0

    return {
      currentPlan: tenant.plan || 'free',
      status: tenant.subscriptionStatus || 'none',
      isActive,
      mrr,
      pastDueAt: tenant.subscriptionPastDueAt || null,
      lastPaymentAt: tenant.integrations?.subscriptionMercadoPago?.lastPaymentAt || null,
    }
  } catch (error) {
    logger.error('Error calculando resumen de suscripciones', {
      tenantId,
      error: error.message,
    })
    return {
      currentPlan: 'free',
      status: 'none',
      isActive: false,
      mrr: 0,
      nextBillingDate: null,
    }
  }
}

/**
 * Obtener métricas de suscripciones para todos los tenants (admin view)
 * Solo disponible para administradores de plataforma
 */
export const getPlatformSubscriptionMetrics = async () => {
  try {
    const tenants = await Tenant.aggregate([
      {
        $group: {
          _id: null,
          totalTenants: { $sum: 1 },
          activeSubscriptions: {
            $sum: {
              $cond: [{ $eq: ['$subscriptionStatus', 'active'] }, 1, 0],
            },
          },
          trialSubscriptions: {
            $sum: {
              $cond: [{ $eq: ['$subscriptionStatus', 'trialing'] }, 1, 0],
            },
          },
          pastDueSubscriptions: {
            $sum: {
              $cond: [{ $eq: ['$subscriptionStatus', 'past_due'] }, 1, 0],
            },
          },
          cancelledSubscriptions: {
            $sum: {
              $cond: [{ $eq: ['$subscriptionStatus', 'cancelled'] }, 1, 0],
            },
          },
          starterSubscriptions: {
            $sum: {
              $cond: [{ $eq: ['$plan', 'starter'] }, 1, 0],
            },
          },
          proSubscriptions: {
            $sum: {
              $cond: [{ $eq: ['$plan', 'pro'] }, 1, 0],
            },
          },
          totalMRR: {
            $sum: {
              $cond: [
                { $eq: ['$subscriptionStatus', 'active'] },
                {
                  $cond: [
                    { $eq: ['$plan', 'pro'] },
                    99,
                    {
                      $cond: [{ $eq: ['$plan', 'starter'] }, 26.14, 0],
                    },
                  ],
                },
                0,
              ],
            },
          },
        },
      },
    ])

    const metrics = tenants[0] || {
      totalTenants: 0,
      activeSubscriptions: 0,
      trialSubscriptions: 0,
      pastDueSubscriptions: 0,
      cancelledSubscriptions: 0,
      starterSubscriptions: 0,
      proSubscriptions: 0,
      totalMRR: 0,
    }

    return {
      ...metrics,
      conversionRate: metrics.totalTenants
        ? ((metrics.activeSubscriptions / metrics.totalTenants) * 100).toFixed(2)
        : 0,
      churnRate: metrics.totalTenants
        ? ((metrics.cancelledSubscriptions / metrics.totalTenants) * 100).toFixed(2)
        : 0,
    }
  } catch (error) {
    logger.error('Error obteniendo métricas de suscripciones de plataforma', {
      error: error.message,
    })
    return {
      totalTenants: 0,
      activeSubscriptions: 0,
      trialSubscriptions: 0,
      pastDueSubscriptions: 0,
      cancelledSubscriptions: 0,
      starterSubscriptions: 0,
      proSubscriptions: 0,
      totalMRR: 0,
      conversionRate: 0,
      churnRate: 0,
    }
  }
}

/**
 * Obtener desglose de ingresos por plan
 */
export const getRevenueByPlan = async () => {
  try {
    const revenue = await Tenant.aggregate([
      {
        $match: {
          subscriptionStatus: 'active',
        },
      },
      {
        $group: {
          _id: '$plan',
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $eq: ['$plan', 'pro'] },
                99,
                {
                  $cond: [{ $eq: ['$plan', 'starter'] }, 26.14, 0],
                },
              ],
            },
          },
        },
      },
      {
        $sort: { revenue: -1 },
      },
    ])

    return revenue.map(item => ({
      plan: item._id || 'free',
      subscriptions: item.count,
      mrr: Number(item.revenue.toFixed(2)),
    }))
  } catch (error) {
    logger.error('Error obteniendo ingresos por plan', {
      error: error.message,
    })
    return []
  }
}

/**
 * Obtener histórico de cambios de suscripción
 */
export const getSubscriptionHistory = async (tenantId, days = 30) => {
  try {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const tenant = await Tenant.findById(tenantId)
      .select('plan subscriptionStatus integrations.subscriptionMercadoPago')
      .lean()

    if (!tenant) {
      return {
        currentPlan: 'free',
        previousPlans: [],
        statusChanges: [],
      }
    }

    // TODO: Implementar log de cambios de suscripción cuando se agregue auditoría
    return {
      currentPlan: tenant.plan || 'free',
      previousPlans: [],
      statusChanges: [],
    }
  } catch (error) {
    logger.error('Error obteniendo histórico de suscripciones', {
      tenantId,
      error: error.message,
    })
    return {
      currentPlan: 'free',
      previousPlans: [],
      statusChanges: [],
    }
  }
}

export default {
  getSubscriptionSummary,
  getPlatformSubscriptionMetrics,
  getRevenueByPlan,
  getSubscriptionHistory,
}
