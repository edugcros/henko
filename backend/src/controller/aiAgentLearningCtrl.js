// 📁 src/controller/aiAgentLearningCtrl.js
import asyncHandler from 'express-async-handler'
import AiLearningSuggestion from '../models/aiLearningSuggestionModel.js'
import {
  approveLearningSuggestion,
  archiveLearningSuggestion,
  rejectLearningSuggestion,
} from '../services/aiAgent/aiAgentLearningService.js'
import { getUserIdFromRequest } from '../utils/requestContext.js'

const clean = value => String(value || '').trim()

const getTenantId = req => {
  return req.tenant?._id || req.resolvedTenant?._id || req.tenantId || req.user?.tenantId
}

export const listAiLearningSuggestions = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  const status = clean(req.query.status || 'pending_review')
  const type = clean(req.query.type)
  const search = clean(req.query.search)
  const page = Math.max(Number(req.query.page || 1), 1)
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const skip = (page - 1) * limit

  const query = {
    tenantId,
  }

  if (status !== 'all') query.status = status
  if (type && type !== 'all') query.type = type

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
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
      .lean(),

    AiLearningSuggestion.countDocuments(query),

    AiLearningSuggestion.aggregate([
      { $match: { tenantId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
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
  const tenantId = getTenantId(req)

  const suggestion = await AiLearningSuggestion.findOne({
    _id: req.params.id,
    tenantId,
  }).lean()

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
  const tenantId = getTenantId(req)
  const reviewerId = getUserIdFromRequest(req)

  const suggestion = await approveLearningSuggestion({
    tenantId,
    suggestionId: req.params.id,
    reviewerId,
    title: req.body?.title,
    content: req.body?.content,
    tags: req.body?.tags,
  })

  return res.status(200).json({
    success: true,
    message: 'Sugerencia aprobada y convertida en conocimiento',
    data: suggestion,
  })
})

export const rejectAiLearningSuggestion = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)
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
  const tenantId = getTenantId(req)
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