// 📁 src/services/aiUsageService.js
//
// Cuota mensual de análisis IA por tenant, atada al plan del tenant.
// El chequeo+incremento es atómico (findOneAndUpdate con filtro por
// límite + upsert) para que dos análisis concurrentes del mismo tenant
// no puedan pasarse del límite por una condición de carrera.

import AiUsage from '../models/aiUsageModel.js'
import Tenant from '../models/tenantModel.js'
import logger from '../../config/logger.js'

const PLAN_MONTHLY_LIMITS = Object.freeze({
  free: Number(process.env.AI_MONTHLY_LIMIT_FREE || 50),
  starter: Number(process.env.AI_MONTHLY_LIMIT_STARTER || 300),
  pro: Number(process.env.AI_MONTHLY_LIMIT_PRO || 1500),
  enterprise: Number(process.env.AI_MONTHLY_LIMIT_ENTERPRISE || 0),
})

// 0 = sin límite (enterprise por defecto).
const UNLIMITED = 0

const getCurrentPeriod = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const getLimitForPlan = plan => {
  const limit = PLAN_MONTHLY_LIMITS[plan]
  return Number.isFinite(limit) ? limit : PLAN_MONTHLY_LIMITS.free
}

/**
 * Snapshot de uso actual, para mostrar en el admin (sin reservar nada).
 */
export const getAiUsageSnapshot = async tenantId => {
  const period = getCurrentPeriod()

  const [tenant, usage] = await Promise.all([
    Tenant.findById(tenantId).select('plan').lean(),
    AiUsage.findOne({ tenantId, period }).setOptions({ tenantId }).lean(),
  ])

  const limit = getLimitForPlan(tenant?.plan)
  const used = usage?.analysisCount || 0

  return {
    period,
    plan: tenant?.plan || 'free',
    used,
    limit,
    unlimited: limit === UNLIMITED,
    remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
  }
}

/**
 * Reserva un análisis IA para el tenant en el período actual. Se llama
 * ANTES de gastar la llamada a Gemini — si devuelve allowed:false, no
 * se debe llamar al proveedor.
 */
export const reserveAiUsage = async tenantId => {
  const period = getCurrentPeriod()
  const tenant = await Tenant.findById(tenantId).select('plan').lean()
  const limit = getLimitForPlan(tenant?.plan)

  if (limit === UNLIMITED) {
    await AiUsage.findOneAndUpdate(
      { tenantId, period },
      { $inc: { analysisCount: 1 }, $set: { lastAnalysisAt: new Date() } },
      { upsert: true },
    ).setOptions({ tenantId })

    return { allowed: true, unlimited: true, limit: 0 }
  }

  try {
    // El filtro incluye analysisCount:{$lt:limit}. Si el doc existe pero
    // ya llegó al límite, este filtro no matchea nada — con upsert:true
    // Mongo intenta insertar uno nuevo, choca contra el índice único
    // {tenantId,period} y tira E11000. Eso es exactamente la señal de
    // "sin cupo", la capturamos abajo.
    const updated = await AiUsage.findOneAndUpdate(
      { tenantId, period, analysisCount: { $lt: limit } },
      { $inc: { analysisCount: 1 }, $set: { lastAnalysisAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).setOptions({ tenantId })

    return { allowed: true, used: updated.analysisCount, limit }
  } catch (error) {
    if (error?.code === 11000) {
      return { allowed: false, used: limit, limit }
    }
    throw error
  }
}

/**
 * Devuelve una reserva cuando el análisis falló del lado del proveedor
 * (no fue culpa del tenant, no debería contarle contra su cupo).
 */
export const refundAiUsage = async tenantId => {
  const period = getCurrentPeriod()

  try {
    await AiUsage.findOneAndUpdate(
      { tenantId, period, analysisCount: { $gt: 0 } },
      { $inc: { analysisCount: -1 } },
    ).setOptions({ tenantId })
  } catch (error) {
    logger.warn('[AI USAGE] No se pudo devolver la reserva de cuota', {
      tenantId: String(tenantId),
      error: error.message,
    })
  }
}
