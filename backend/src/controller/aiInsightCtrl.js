// 📁 src/controller/aiInsightCtrl.js
//
// Mismo esqueleto que aiAgentLearningCtrl.js (la cola de sugerencias de
// aprendizaje del agente) — lista + get + 3 acciones.

import asyncHandler from 'express-async-handler'
import AiInsight from '../models/aiInsightModel.js'
import {
  acknowledgeInsight,
  archiveInsight,
  dismissInsight,
} from '../services/insights/aiInsightService.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
  resolveAuthorizedTenantFromRequest,
} from '../utils/requestContext.js'

const clean = value => String(value || '').trim()

const allowedStatuses = new Set([
  'pending_review',
  'measuring',
  'resolved',
  'dismissed',
  'archived',
])
const allowedTypes = new Set([
  'product_underperformance',
  'cart_conversion_drop',
  'campaign_underperformance',
  'customer_inactivity',
])

const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, { requireUserTenant: true }).tenantId

const validateInsightId = (req, res) => {
  if (isValidObjectId(req.params.id)) return true

  res.status(400).json({ success: false, message: 'ID de insight inválido' })
  return false
}

export const listAiInsights = asyncHandler(async (req, res) => {
  const { tenantId, tenantObjectId } = resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  })

  const status = clean(req.query.status || 'pending_review')
  const type = clean(req.query.type)
  const page = Math.max(Number(req.query.page || 1), 1)
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const skip = (page - 1) * limit

  const query = { tenantId }
  if (status !== 'all' && allowedStatuses.has(status)) query.status = status
  if (type && type !== 'all' && allowedTypes.has(type)) query.type = type

  const [items, total, counters] = await Promise.all([
    AiInsight.find(query)
      .sort({ priority: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .setOptions({ tenantId })
      .lean(),

    AiInsight.countDocuments(query).setOptions({ tenantId }),

    AiInsight.aggregate([
      { $match: { tenantId: tenantObjectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).option({ tenantId }),
  ])

  return res.status(200).json({
    success: true,
    data: {
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      counters: counters.reduce((acc, item) => {
        acc[item._id] = item.count
        return acc
      }, {}),
    },
  })
})

export const getAiInsightById = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateInsightId(req, res)) return

  const insight = await AiInsight.findOne({ _id: req.params.id, tenantId })
    .setOptions({ tenantId })
    .lean()

  if (!insight) {
    return res.status(404).json({ success: false, message: 'Insight no encontrado' })
  }

  return res.status(200).json({ success: true, data: insight })
})

export const acknowledgeAiInsight = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateInsightId(req, res)) return
  const userId = getUserIdFromRequest(req)

  const insight = await acknowledgeInsight({ insightId: req.params.id, tenantId, userId })

  return res.status(200).json({
    success: true,
    message: 'Insight marcado en curso — se va a volver a medir más adelante',
    data: insight,
  })
})

export const dismissAiInsight = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateInsightId(req, res)) return
  const userId = getUserIdFromRequest(req)

  const insight = await dismissInsight({
    insightId: req.params.id,
    tenantId,
    userId,
    reason: req.body?.reason,
  })

  return res.status(200).json({ success: true, message: 'Insight descartado', data: insight })
})

export const archiveAiInsight = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateInsightId(req, res)) return

  const insight = await archiveInsight({ insightId: req.params.id, tenantId })

  return res.status(200).json({ success: true, message: 'Insight archivado', data: insight })
})
