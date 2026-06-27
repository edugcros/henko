// 📁 src/controller/aiAgentLearningCtrl.js
import asyncHandler from 'express-async-handler'
import AiLearningSuggestion from '../models/aiLearningSuggestionModel.js'
import {
  approveLearningSuggestion,
  archiveLearningSuggestion,
  rejectLearningSuggestion,
} from '../services/aiAgent/aiAgentLearningService.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
  resolveAuthorizedTenantFromRequest,
} from '../utils/requestContext.js'

const clean = value => String(value || '').trim()
const allowedStatuses = new Set([
  'pending_review',
  'approving',
  'approved',
  'rejected',
  'archived',
])
const allowedTypes = new Set([
  'faq_suggestion',
  'product_gap',
  'policy_gap',
  'handoff_pattern',
  'conversion_pattern',
  'negative_signal',
  'general',
])
const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  }).tenantId

const validateSuggestionId = (req, res) => {
  if (isValidObjectId(req.params.id)) return true

  res.status(400).json({
    success: false,
    message: 'ID de sugerencia inválido',
  })
  return false
}

export const listAiLearningSuggestions = asyncHandler(async (req, res) => {
  const { tenantId, tenantObjectId } =
    resolveAuthorizedTenantFromRequest(req, {
      requireUserTenant: true,
    })

  const status = clean(req.query.status || 'pending_review')
  const type = clean(req.query.type)
  const search = clean(req.query.search)
  const page = Math.max(Number(req.query.page || 1), 1)
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const skip = (page - 1) * limit

  const query = {
    tenantId,
  }

  if (status !== 'all' && allowedStatuses.has(status)) query.status = status
  if (type && type !== 'all' && allowedTypes.has(type)) query.type = type

  if (search) {
    const regex = new RegExp(
      search
        .slice(0, 120)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    )
    query.$or = [
      { title: regex },
      { question: regex },
      { suggestedAnswer: regex },
      { tags: regex },
    ]
  }

  const [items, total, counters] = await Promise.all([
    AiLearningSuggestion.find(query)
      .sort({
        priority: -1,
        confidence: -1,
        updatedAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .setOptions({ tenantId })
      .lean(),

    AiLearningSuggestion.countDocuments(query).setOptions({ tenantId }),

    AiLearningSuggestion.aggregate([
      { $match: { tenantId: tenantObjectId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]).option({ tenantId }),
  ])

  return res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      counters: counters.reduce((acc, item) => {
        acc[item._id] = item.count
        return acc
      }, {}),
    },
  })
})

export const getAiLearningSuggestionById = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateSuggestionId(req, res)) return

  const suggestion = await AiLearningSuggestion.findOne({
    _id: req.params.id,
    tenantId,
  })
    .setOptions({ tenantId })
    .lean()

  if (!suggestion) {
    return res.status(404).json({
      success: false,
      message: 'Sugerencia no encontrada',
    })
  }

  return res.status(200).json({
    success: true,
    data: suggestion,
  })
})

export const approveAiLearningSuggestion = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateSuggestionId(req, res)) return
  const reviewerId = getUserIdFromRequest(req)

  const suggestion = await approveLearningSuggestion({
    tenantId,
    suggestionId: req.params.id,
    reviewerId,
    title: clean(req.body?.title).slice(0, 200),
    content: clean(req.body?.content).slice(0, 10000),
    tags: Array.isArray(req.body?.tags)
      ? req.body.tags.map(clean).filter(Boolean).slice(0, 50)
      : [],
  })

  return res.status(200).json({
    success: true,
    message: 'Sugerencia aprobada y convertida en conocimiento',
    data: suggestion,
  })
})

export const rejectAiLearningSuggestion = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateSuggestionId(req, res)) return
  const reviewerId = getUserIdFromRequest(req)

  const suggestion = await rejectLearningSuggestion({
    tenantId,
    suggestionId: req.params.id,
    reviewerId,
    reason: req.body?.reason,
  })

  return res.status(200).json({
    success: true,
    message: 'Sugerencia rechazada',
    data: suggestion,
  })
})

export const archiveAiLearningSuggestion = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!validateSuggestionId(req, res)) return
  const reviewerId = getUserIdFromRequest(req)

  const suggestion = await archiveLearningSuggestion({
    tenantId,
    suggestionId: req.params.id,
    reviewerId,
  })

  return res.status(200).json({
    success: true,
    message: 'Sugerencia archivada',
    data: suggestion,
  })
})
