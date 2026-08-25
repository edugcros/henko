// 📁 src/services/insights/aiInsightService.js
//
// Orquesta los 6 detectores (aiInsightDetectionService.js) y persiste sus
// candidatos. Mismo patrón de upsert-sin-pisar-lo-ya-tocado que
// aiAgentLearningService.js::upsertLearningSuggestion — un re-escaneo
// actualiza los números de un insight todavía pending_review, pero nunca
// pisa uno que un humano ya reconoció/descartó/archivó.

import AiInsight from '../../models/aiInsightModel.js'
import logger from '../../../config/logger.js'
import {
  detectProductUnderperformance,
  detectCartConversionDrop,
  detectCampaignUnderperformance,
  detectCustomerInactivity,
  detectCartRecoveryUnderperformance,
  detectProductLowMargin,
  measureProductConversion,
  measureOverallConversion,
  measureCampaignConversion,
  measureCustomerDaysSinceLastOrder,
  measureCartRecoveryConversion,
  measureProductMargin,
} from './aiInsightDetectionService.js'

// Solo un insight en pending_review puede refrescarse solo en un re-escaneo
// — cualquier otro estado significa que un humano (o el propio ciclo de
// medición) ya lo tocó.
const MUTABLE_STATUSES = ['pending_review']

const readEnvNumber = (name, fallback) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

const buildFingerprint = ({ type, entityId }) => `${type}:${entityId || 'tenant'}`

const upsertInsight = async (tenantId, candidate) => {
  const fingerprint = buildFingerprint({ type: candidate.type, entityId: candidate.entity?.id })

  const existing = await AiInsight.findOne({ tenantId, fingerprint }).setOptions({ tenantId }).lean()

  if (existing && !MUTABLE_STATUSES.includes(existing.status)) {
    return existing
  }

  const update = {
    $set: {
      type: candidate.type,
      priority: candidate.priority,
      title: candidate.title,
      description: candidate.description,
      entity: candidate.entity,
      evidence: candidate.evidence,
      'measurement.metricName': candidate.measurement?.metricName || '',
      'measurement.beforeValue': candidate.measurement?.beforeValue ?? null,
      detectedAt: new Date(),
    },
  }

  try {
    return await AiInsight.findOneAndUpdate(
      { tenantId, fingerprint, status: { $in: MUTABLE_STATUSES } },
      update,
      { upsert: !existing, new: true, setDefaultsOnInsert: true },
    )
      .setOptions({ tenantId })
      .lean()
  } catch (error) {
    // Carrera entre dos escaneos concurrentes del mismo tenant — el índice
    // único {tenantId, fingerprint} ya resolvió cuál gana, solo devolvemos
    // el que quedó.
    if (error?.code !== 11000) throw error
    return AiInsight.findOne({ tenantId, fingerprint }).setOptions({ tenantId }).lean()
  }
}

export const runInsightScanForTenant = async tenantId => {
  const detectorRuns = await Promise.allSettled([
    detectProductUnderperformance(tenantId),
    detectCartConversionDrop(tenantId),
    detectCampaignUnderperformance(tenantId),
    detectCustomerInactivity(tenantId),
    detectCartRecoveryUnderperformance(tenantId),
    detectProductLowMargin(tenantId),
  ])

  const candidates = []
  for (const run of detectorRuns) {
    if (run.status === 'fulfilled') {
      candidates.push(...run.value)
    } else {
      logger.warn('[AI Insights] Un detector falló, se sigue con el resto', {
        tenantId: String(tenantId),
        error: run.reason?.message,
      })
    }
  }

  const results = []
  for (const candidate of candidates) {
    try {
      results.push(await upsertInsight(tenantId, candidate))
    } catch (error) {
      logger.warn('[AI Insights] No se pudo guardar un candidato', {
        tenantId: String(tenantId),
        type: candidate.type,
        error: error.message,
      })
    }
  }

  return results
}

export const acknowledgeInsight = async ({ insightId, tenantId, userId }) => {
  const remeasureDays = readEnvNumber('AI_INSIGHT_REMEASURE_DAYS', 14)
  const measureAfterDate = new Date(Date.now() + remeasureDays * 86400000)

  const insight = await AiInsight.findOneAndUpdate(
    { _id: insightId, tenantId, status: 'pending_review' },
    {
      $set: {
        status: 'measuring',
        acknowledgedBy: userId || null,
        acknowledgedAt: new Date(),
        'measurement.measureAfterDate': measureAfterDate,
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  if (!insight) {
    const error = new Error('Insight no encontrado o ya no está pendiente de revisión')
    error.statusCode = 404
    throw error
  }

  return insight
}

export const dismissInsight = async ({ insightId, tenantId, userId, reason = '' }) => {
  const insight = await AiInsight.findOneAndUpdate(
    { _id: insightId, tenantId, status: { $in: ['pending_review', 'measuring'] } },
    {
      $set: {
        status: 'dismissed',
        dismissedBy: userId || null,
        dismissedAt: new Date(),
        dismissReason: String(reason || '').slice(0, 500),
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  if (!insight) {
    const error = new Error('Insight no encontrado o ya no se puede descartar')
    error.statusCode = 404
    throw error
  }

  return insight
}

export const archiveInsight = async ({ insightId, tenantId }) => {
  const insight = await AiInsight.findOneAndUpdate(
    { _id: insightId, tenantId },
    { $set: { status: 'archived' } },
    { new: true },
  ).setOptions({ tenantId })

  if (!insight) {
    const error = new Error('Insight no encontrado')
    error.statusCode = 404
    throw error
  }

  return insight
}

const remeasureOne = async insight => {
  const { type, entity } = insight

  if (type === 'product_underperformance') {
    return measureProductConversion(insight.tenantId, entity.id)
  }
  if (type === 'cart_conversion_drop') {
    return measureOverallConversion(insight.tenantId)
  }
  if (type === 'campaign_underperformance') {
    return measureCampaignConversion(insight.tenantId, entity.id)
  }
  if (type === 'customer_inactivity') {
    return measureCustomerDaysSinceLastOrder(insight.tenantId, entity.id)
  }
  if (type === 'cart_recovery_underperformance') {
    return measureCartRecoveryConversion(insight.tenantId)
  }
  if (type === 'product_low_margin') {
    return measureProductMargin(insight.tenantId, entity.id)
  }
  return null
}

const afterValueFromMeasurement = (type, measured) => {
  if (!measured) return null
  if (type === 'customer_inactivity') return measured.daysSinceLastOrder
  if (type === 'product_low_margin') return measured.marginPct
  return measured.conversionRate
}

/**
 * Cross-tenant a propósito (mismo escape hatch que platformMarginService.js)
 * — barre insights vencidos de todos los comercios en una sola pasada,
 * llamado desde el worker (ver aiInsightWorker.js).
 */
export const remeasureDueInsights = async (limit = 50) => {
  const dueInsights = await AiInsight.find({
    status: 'measuring',
    'measurement.measureAfterDate': { $lte: new Date() },
  })
    .limit(limit)
    .setOptions({ ignoreTenant: true })

  const results = []

  for (const insight of dueInsights) {
    try {
      const measured = await remeasureOne(insight)
      const afterValue = afterValueFromMeasurement(insight.type, measured)

      insight.status = 'resolved'
      insight.measurement.afterValue = afterValue
      insight.measurement.measuredAt = new Date()
      await insight.save({ tenantId: insight.tenantId })

      results.push({ insightId: insight._id, resolved: true })
    } catch (error) {
      logger.warn('[AI Insights] No se pudo remedir un insight', {
        insightId: String(insight._id),
        tenantId: String(insight.tenantId),
        error: error.message,
      })
      results.push({ insightId: insight._id, resolved: false })
    }
  }

  return results
}

export default {
  runInsightScanForTenant,
  acknowledgeInsight,
  dismissInsight,
  archiveInsight,
  remeasureDueInsights,
}
