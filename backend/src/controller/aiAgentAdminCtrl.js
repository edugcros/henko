// 📁 src/controller/aiAgentAdminCtrl.js
import asyncHandler from 'express-async-handler'
import AiConversation from '../models/aiConversationModel.js'
import AiLead from '../models/aiLeadModel.js'
import mongoose from 'mongoose'

const clean = value => String(value || '').trim()

const getTenantId = req => {
  return req.tenant?._id || req.tenantId || req.user?.tenantId || null
}

export const listAiConversation = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  const page = Math.max(Number(req.query.page || 1), 1)
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const status = clean(req.query.status)
  const channel = clean(req.query.channel)
  const search = clean(req.query.search)

  const query = {
    tenantId,
  }

  if (status) query.status = status
  if (channel) query.channel = channel

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

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
  const tenantId = getTenantId(req)
  const { id } = req.params

  const conversation = await AiConversation.findOne({
    _id: id,
    tenantId,
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
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  const [
    totalConversations,
    openConversations,
    waitingHuman,
    closedConversations,
    hotLeads,
  ] = await Promise.all([
    AiConversation.countDocuments({ tenantId }).setOptions({ tenantId }),
    AiConversation.countDocuments({ tenantId, status: 'open' }).setOptions({ tenantId }),
    AiConversation.countDocuments({ tenantId, status: 'waiting_human' }).setOptions({ tenantId }),
    AiConversation.countDocuments({ tenantId, status: 'closed' }).setOptions({ tenantId }),
    AiLead.countDocuments({ tenantId, score: { $gte: 75 } }).setOptions({ tenantId }),
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
  const tenantId = getTenantId(req)
  const { id } = req.params
  const status = clean(req.body?.status)

  const allowed = ['open', 'waiting_customer', 'waiting_human', 'closed']

  if (!allowed.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Estado inválido',
    })
  }

  const conversation = await AiConversation.findOneAndUpdate(
    {
      _id: id,
      tenantId,
    },
    {
      $set: {
        status,
        handoffRequired: status === 'waiting_human',
        updatedAt: new Date(),
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
  const tenantId = getTenantId(req)
  const { id } = req.params

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de conversación inválido',
    })
  }

  const conversation = await AiConversation.findOne({
    _id: id,
    tenantId,
  }).setOptions({ tenantId })

  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: 'Conversación no encontrada',
    })
  }

  await Promise.all([
    AiConversation.deleteOne({
      _id: id,
      tenantId,
    }).setOptions({ tenantId }),

    AiLead.deleteMany({
      tenantId,
      conversationId: id,
    }).setOptions({ tenantId }),
  ])

  return res.status(200).json({
    success: true,
    message: 'Conversación eliminada correctamente',
    data: {
      deletedConversationId: id,
    },
  })
})