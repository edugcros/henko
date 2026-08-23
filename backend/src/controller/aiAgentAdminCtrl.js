// 📁 src/controller/aiAgentAdminCtrl.js
import asyncHandler from 'express-async-handler'
import mongoose from 'mongoose'
import AiConversation from '../models/aiConversationModel.js'
import AiCartRecovery from '../models/aiCartRecoveryModel.js'
import AiLead from '../models/aiLeadModel.js'
import UserMetricEvent from '../models/userMetricEventModel.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
  resolveAuthorizedTenantFromRequest,
} from '../utils/requestContext.js'

const clean = value => String(value || '').trim()
const allowedStatuses = new Set([
  'open',
  'waiting_customer',
  'waiting_human',
  'human_active',
  'closed',
  'converted',
  'lost',
])
const allowedChannels = new Set(['whatsapp', 'webchat'])
const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  }).tenantId

export const listAiConversation = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const page = Math.max(Number(req.query.page || 1), 1)
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const status = clean(req.query.status)
  const channel = clean(req.query.channel)
  const search = clean(req.query.search)

  const query = {
    tenantId,
    deletedAt: { $exists: false },
  }

  if (status && allowedStatuses.has(status)) query.status = status
  if (channel && allowedChannels.has(channel)) query.channel = channel

  if (search) {
    const regex = new RegExp(
      search
        .slice(0, 120)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    )

    query.$or = [
      { externalUserId: regex },
      { 'customer.name': regex },
      { 'customer.email': regex },
      { 'customer.phone': regex },
      { 'messages.content': regex },
    ]
  }

  const [items, total] = await Promise.all([
    AiConversation.find(query)
      .setOptions({ tenantId })
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(
        'channel externalUserId customer status intent leadScore handoffRequired handoffReason lastMessageAt messages createdAt updatedAt',
      )
      .lean(),
    AiConversation.countDocuments(query).setOptions({ tenantId }),
  ])

  const normalizedItems = items.map(item => {
    const lastMessage = Array.isArray(item.messages)
      ? item.messages[item.messages.length - 1]
      : null

    return {
      ...item,
      lastMessage: lastMessage
        ? {
          role: lastMessage.role,
          content: lastMessage.content,
          createdAt: lastMessage.createdAt,
        }
        : null,
      messagesCount: Array.isArray(item.messages) ? item.messages.length : 0,
      messages: undefined,
    }
  })

  return res.status(200).json({
    success: true,
    data: {
      items: normalizedItems,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  })
})

export const getAiConversationById = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { id } = req.params

  if (!isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de conversación inválido',
    })
  }

  const conversation = await AiConversation.findOne({
    _id: id,
    tenantId,
    deletedAt: { $exists: false },
  })
    .setOptions({ tenantId })
    .lean()

  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversación no encontrada',
    })
  }

  const lead = await AiLead.findOne({
    tenantId,
    conversationId: conversation._id,
  })
    .setOptions({ tenantId })
    .lean()

  return res.status(200).json({
    success: true,
    data: {
      conversation,
      lead,
    },
  })
})

const PERIOD_MS = {
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
  '90d': 90 * 86400000,
}

const resolvePeriodDate = period => {
  const ms = PERIOD_MS[period]
  return ms ? new Date(Date.now() - ms) : null
}

export const getAiAgentMetrics = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const periodDate = resolvePeriodDate(clean(req.query.period))

  const baseMatch = {
    tenantId: tenantObjectId,
    deletedAt: { $exists: false },
  }

  const conversationMatch = periodDate
    ? { ...baseMatch, createdAt: { $gte: periodDate } }
    : baseMatch

  const [conversationStats, leadStats, recoveryStats, salesInfluenceStats] = await Promise.all([
    AiConversation.aggregate([
      { $match: conversationMatch },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),

    AiLead.aggregate([
      { $match: periodDate ? { ...baseMatch, createdAt: { $gte: periodDate } } : baseMatch },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          hotLeads: [
            { $match: { leadScore: { $gte: 75 } } },
            { $count: 'count' },
          ],
          scoreStats: [
            {
              $group: {
                _id: null,
                avg: { $avg: '$leadScore' },
                total: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),

    AiCartRecovery.aggregate([
      { $match: periodDate ? { tenantId: tenantObjectId, createdAt: { $gte: periodDate } } : { tenantId: tenantObjectId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'converted'] },
                '$cartSnapshot.subtotalCents',
                0,
              ],
            },
          },
        },
      },
    ]),

    // Ventas influenciadas por IA — se apoya en el mismo registro server-side
    // de PURCHASE (Bloque 1) que ya sirve de fuente de verdad de ingresos, y
    // en el flag que le agrega commerceEventService.js::markOrderAiInfluenced
    // cuando alguno de los productos de la orden llegó al carrito por una
    // acción explícita del agente (no por haber "charlado" con él).
    UserMetricEvent.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          eventType: 'purchase',
          source: 'system',
          ...(periodDate ? { occurredAt: { $gte: periodDate } } : {}),
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$value' },
          aiInfluencedRevenue: {
            $sum: { $cond: ['$metadata.aiInfluenced', '$value', 0] },
          },
          totalOrders: { $sum: 1 },
          aiInfluencedOrders: {
            $sum: { $cond: ['$metadata.aiInfluenced', 1, 0] },
          },
        },
      },
    ]),
  ])

  const convByStatus = Object.fromEntries(
    conversationStats.map(s => [s._id, s.count]),
  )
  const totalConversations = conversationStats.reduce((sum, s) => sum + s.count, 0)

  const leadFacet = leadStats[0] || {}
  const leadByStatus = Object.fromEntries(
    (leadFacet.byStatus || []).map(s => [s._id, s.count]),
  )
  const totalLeads = Object.values(leadByStatus).reduce((sum, c) => sum + c, 0)

  const recByStatus = Object.fromEntries(
    recoveryStats.map(s => [s._id, s.count]),
  )
  const totalRecoveries = recoveryStats.reduce((sum, s) => sum + s.count, 0)
  const convertedRecoveries = recByStatus.converted || 0
  const recoveredRevenueCents = recoveryStats.find(s => s._id === 'converted')?.revenue || 0

  const salesFacet = salesInfluenceStats[0] || {}

  return res.status(200).json({
    success: true,
    data: {
      period: req.query.period || 'all',

      conversations: {
        total: totalConversations,
        open: convByStatus.open || 0,
        waitingHuman: convByStatus.waiting_human || 0,
        closed: convByStatus.closed || 0,
        converted: convByStatus.converted || 0,
        conversionRate: totalConversations > 0
          ? Math.round(((convByStatus.converted || 0) / totalConversations) * 10000) / 100
          : 0,
      },

      leads: {
        total: totalLeads,
        hot: leadFacet.hotLeads?.[0]?.count || 0,
        new: leadByStatus.new || 0,
        qualified: leadByStatus.qualified || 0,
        won: leadByStatus.won || 0,
        lost: leadByStatus.lost || 0,
        followUp: leadByStatus.follow_up || 0,
        averageScore: Math.round(leadFacet.scoreStats?.[0]?.avg || 0),
      },

      cartRecovery: {
        total: totalRecoveries,
        sent: recByStatus.sent || 0,
        converted: convertedRecoveries,
        failed: recByStatus.failed || 0,
        pending: (recByStatus.pending || 0) + (recByStatus.scheduled || 0),
        conversionRate: totalRecoveries > 0
          ? Math.round((convertedRecoveries / totalRecoveries) * 10000) / 100
          : 0,
        recoveredRevenueCents,
      },

      salesInfluence: {
        totalRevenueCents: salesFacet.totalRevenue || 0,
        aiInfluencedRevenueCents: salesFacet.aiInfluencedRevenue || 0,
        aiInfluencedOrders: salesFacet.aiInfluencedOrders || 0,
        totalOrders: salesFacet.totalOrders || 0,
        percentage: salesFacet.totalRevenue > 0
          ? Math.round((salesFacet.aiInfluencedRevenue / salesFacet.totalRevenue) * 10000) / 100
          : 0,
      },

      // Backwards compat: flat keys the old frontend expects
      totalConversations,
      openConversations: convByStatus.open || 0,
      waitingHuman: convByStatus.waiting_human || 0,
      closedConversations: convByStatus.closed || 0,
      hotLeads: leadFacet.hotLeads?.[0]?.count || 0,
    },
  })
})

export const updateAiConversationStatus = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { id } = req.params
  const status = clean(req.body?.status)

  if (!isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de conversación inválido',
    })
  }

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({
      success: false,
      message: 'Estado inválido',
    })
  }

  const conversation = await AiConversation.findOneAndUpdate(
    {
      _id: id,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $set: {
        status,
        handoffRequired: status === 'waiting_human',
        handoffReason:
          status === 'waiting_human'
            ? clean(req.body?.reason).slice(0, 500) || 'admin_requested'
            : '',
      },
    },
    {
      new: true,
    },
  ).setOptions({ tenantId })

  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversación no encontrada',
    })
  }

  return res.status(200).json({
    success: true,
    data: conversation,
  })
})

export const deleteAiConversation = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { id } = req.params

  if (!isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de conversación inválido',
    })
  }

  const deletedAt = new Date()
  const deletedBy = getUserIdFromRequest(req)
  const deletedReason = clean(req.body?.reason).slice(0, 500)
  const conversation = await AiConversation.findOneAndUpdate(
    {
      _id: id,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $set: {
        status: 'closed',
        handoffRequired: false,
        deletedAt,
        deletedBy,
        deletedReason,
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversación no encontrada',
    })
  }

  await AiLead.updateMany(
    {
      tenantId,
      conversationId: id,
      deletedAt: { $exists: false },
    },
    {
      $set: {
        status: 'discarded',
        deletedAt,
        deletedBy,
        deletedReason:
          deletedReason || 'Conversación eliminada desde administración',
        discardedAt: deletedAt,
      },
    },
  ).setOptions({ tenantId })

  return res.status(200).json({
    success: true,
    message: 'Conversación eliminada correctamente',
    data: {
      deletedConversationId: id,
    },
  })
})

export const permanentlyDeleteAiConversation = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { id } = req.params

  if (!isValidObjectId(id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de conversación inválido',
    })
  }

  const conversation = await AiConversation.findOne({
    _id: id,
    tenantId,
  })
    .setOptions({ tenantId })
    .select('_id')
    .lean()

  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversación no encontrada',
    })
  }

  await AiConversation.deleteOne({
    _id: id,
    tenantId,
  }).setOptions({ tenantId })

  await AiLead.updateMany(
    {
      tenantId,
      $or: [{ conversationId: id }, { lastConversationId: id }],
    },
    {
      $unset: {
        conversationId: '',
        lastConversationId: '',
      },
      $set: {
        'metadata.lastConversationDeletedAt': new Date(),
      },
    },
  ).setOptions({ tenantId })

  return res.status(200).json({
    success: true,
    message: 'Conversación eliminada permanentemente',
    data: {
      deletedConversationId: id,
    },
  })
})
