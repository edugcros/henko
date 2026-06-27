// 📁 src/controller/aiAgentAdminCtrl.js
import asyncHandler from 'express-async-handler'
import AiConversation from '../models/aiConversationModel.js'
import AiLead from '../models/aiLeadModel.js'
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

export const getAiAgentMetrics = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const activeFilter = { tenantId, deletedAt: { $exists: false } }

  const [
    totalConversations,
    openConversations,
    waitingHuman,
    closedConversations,
    hotLeads,
  ] = await Promise.all([
    AiConversation.countDocuments(activeFilter).setOptions({ tenantId }),
    AiConversation.countDocuments({
      ...activeFilter,
      status: 'open',
    }).setOptions({ tenantId }),
    AiConversation.countDocuments({
      ...activeFilter,
      status: 'waiting_human',
    }).setOptions({ tenantId }),
    AiConversation.countDocuments({
      ...activeFilter,
      status: 'closed',
    }).setOptions({ tenantId }),
    AiLead.countDocuments({
      tenantId,
      deletedAt: { $exists: false },
      score: { $gte: 75 },
    }).setOptions({ tenantId }),
  ])

  return res.status(200).json({
    success: true,
    data: {
      totalConversations,
      openConversations,
      waitingHuman,
      closedConversations,
      hotLeads,
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
