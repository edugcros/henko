// 📁 backend/src/controller/aiLeadAdminCtrl.js
import asyncHandler from 'express-async-handler'
import mongoose from 'mongoose'
import AiLead from '../models/aiLeadModel.js'
import AiConversation from '../models/aiConversationModel.js'
import {
  addLeadNote,
  assignLead,
  scheduleLeadFollowUp,
  updateLeadStatus,
} from '../services/aiAgent/aiLeadCommercialService.js'

const { Types } = mongoose

const clean = value => String(value || '').trim()
const clampLimit = value => Math.min(Math.max(Number(value || 20), 1), 100)
const toPage = value => Math.max(Number(value || 1), 1)
const isValidObjectId = value => Types.ObjectId.isValid(String(value || ''))

const getRequestTenantId = req => {
  const rawTenantId =
    req?.user?.tenantId ||
    req?.user?.tenant?._id ||
    req?.tenantId ||
    req?.tenant?._id ||
    req?.headers?.['x-tenant-id']

  const tenantId = clean(rawTenantId)

  if (!tenantId || !Types.ObjectId.isValid(tenantId)) {
    return null
  }

  return tenantId
}

const requireTenantId = req => {
  const tenantId = getRequestTenantId(req)

  if (!tenantId) {
    const error = new Error('Tenant no identificado')
    error.statusCode = 400
    throw error
  }

  return tenantId
}

const sendNotFound = res =>
  res.status(404).json({
    success: false,
    message: 'Lead no encontrado',
  })

const normalizeLead = lead => {
  const obj = typeof lead?.toObject === 'function' ? lead.toObject() : lead
  if (!obj) return null

  const displayName =
    obj.customer?.name ||
    obj.customer?.email ||
    obj.customer?.phone ||
    'Cliente web'

  return {
    ...obj,
    id: String(obj._id),
    displayName,
    contactAvailable: Boolean(obj.customer?.email || obj.customer?.phone),
  }
}

const escapeRegex = value => clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildLeadMatch = req => {
  const tenantId = requireTenantId(req)
  const { status, intent, assignedTo, channel, q, withContact, followUp } = req.query
  const match = {
    tenantId,
    deletedAt: { $exists: false },
  }

  if (status && status !== 'all') match.status = status
  if (intent && intent !== 'all') match.intent = intent
  if (channel && channel !== 'all') match.channel = channel

  if (assignedTo === 'me' && req.user?._id) {
    match.assignedTo = req.user._id
  } else if (assignedTo === 'unassigned') {
    match.assignedTo = null
  } else if (isValidObjectId(assignedTo)) {
    match.assignedTo = assignedTo
  }

  if (withContact === 'true') {
    match.$or = [{ 'customer.email': { $ne: '' } }, { 'customer.phone': { $ne: '' } }]
  }

  if (followUp === 'pending') {
    match.nextFollowUpAt = { $ne: null, $lte: new Date() }
    match.status = { $in: ['follow_up', 'qualified', 'hot'] }
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i')
    const searchOr = [
      { 'customer.name': regex },
      { 'customer.email': regex },
      { 'customer.phone': regex },
      { lastMessage: regex },
      { 'productsOfInterest.title': regex },
      { 'productsOfInterest.slug': regex },
      { 'productsOfInterest.sku': regex },
    ]

    if (match.$or) {
      match.$and = [{ $or: match.$or }, { $or: searchOr }]
      delete match.$or
    } else {
      match.$or = searchOr
    }
  }

  return match
}

const buildProductOfInterest = product => ({
  productId: isValidObjectId(product?.productId)
    ? product.productId
    : isValidObjectId(product?._id)
      ? product._id
      : null,
  title: clean(product?.title || product?.name || product?.nombre).slice(0, 180),
  slug: clean(product?.slug).slice(0, 180),
  sku: clean(product?.sku || product?.variantSku || product?.variantSKU).slice(0, 120),
  price: Math.max(Number(product?.price || 0), 0),
  lastMentionedAt: product?.lastMentionedAt
    ? new Date(product.lastMentionedAt)
    : new Date(),
})

export const getAiLeadSummary = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const tenantObjectId = new Types.ObjectId(String(tenantId))
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const [byStatus, today, pendingFollowUps, scoreStats] = await Promise.all([
    AiLead.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          deletedAt: { $exists: false },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    AiLead.countDocuments({
      tenantId,
      deletedAt: { $exists: false },
      createdAt: { $gte: startOfDay },
    }).setOptions({ tenantId }),
    AiLead.countDocuments({
      tenantId,
      deletedAt: { $exists: false },
      nextFollowUpAt: { $ne: null, $lte: now },
      status: { $in: ['follow_up', 'qualified', 'hot'] },
    }).setOptions({ tenantId }),
    AiLead.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          deletedAt: { $exists: false },
        },
      },
      {
        $group: {
          _id: null,
          averageLeadScore: { $avg: '$leadScore' },
          total: { $sum: 1 },
        },
      },
    ]),
  ])

  const statusMap = byStatus.reduce((acc, item) => {
    acc[item._id || 'unknown'] = item.count
    return acc
  }, {})

  return res.json({
    success: true,
    data: {
      total: scoreStats[0]?.total || 0,
      today,
      new: statusMap.new || 0,
      qualified: statusMap.qualified || 0,
      hot: statusMap.hot || 0,
      followUp: statusMap.follow_up || 0,
      won: statusMap.won || 0,
      lost: statusMap.lost || 0,
      discarded: statusMap.discarded || 0,
      pendingFollowUps,
      averageLeadScore: Math.round(scoreStats[0]?.averageLeadScore || 0),
    },
  })
})

export const listAiLeads = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const page = toPage(req.query.page)
  const limit = clampLimit(req.query.limit)
  const skip = (page - 1) * limit
  const match = buildLeadMatch(req)

  const sort =
    req.query.sort === 'score'
      ? { leadScore: -1, lastInteractionAt: -1 }
      : { lastInteractionAt: -1, updatedAt: -1 }

  const [items, total] = await Promise.all([
    AiLead.find(match)
      .setOptions({ tenantId })
      .populate('assignedTo', 'name email role')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    AiLead.countDocuments(match).setOptions({ tenantId }),
  ])

  return res.json({
    success: true,
    data: {
      items: items.map(normalizeLead),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  })
})

export const getAiLeadById = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { leadId } = req.params

  if (!isValidObjectId(leadId)) return sendNotFound(res)

  const lead = await AiLead.findOne({
    _id: leadId,
    tenantId,
    deletedAt: { $exists: false },
  })
    .setOptions({ tenantId })
    .populate('assignedTo', 'name email role')
    .lean()

  if (!lead) return sendNotFound(res)

  const conversationId = lead.lastConversationId || lead.conversationId
  const conversation = conversationId
    ? await AiConversation.findOne({ _id: conversationId, tenantId })
      .setOptions({ tenantId })
      .select(
        '_id channel status externalUserId customer customerName customerEmail customerPhone messages lastMessageAt createdAt updatedAt',
      )
      .lean()
    : null

  return res.json({
    success: true,
    data: {
      lead: normalizeLead(lead),
      conversation,
    },
  })
})

export const patchAiLeadStatus = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const lead = await updateLeadStatus({
    tenantId,
    leadId: req.params.leadId,
    status: clean(req.body.status),
    reason: clean(req.body.reason),
    user: req.user,
  })

  if (!lead) return sendNotFound(res)

  return res.json({ success: true, data: normalizeLead(lead) })
})

export const patchAiLeadAssign = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const lead = await assignLead({
    tenantId,
    leadId: req.params.leadId,
    assignedTo: req.body.assignedTo || null,
  })

  if (!lead) return sendNotFound(res)

  return res.json({ success: true, data: normalizeLead(lead) })
})

export const patchAiLeadFollowUp = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const lead = await scheduleLeadFollowUp({
    tenantId,
    leadId: req.params.leadId,
    nextFollowUpAt: req.body.nextFollowUpAt || null,
  })

  if (!lead) return sendNotFound(res)

  return res.json({ success: true, data: normalizeLead(lead) })
})

export const postAiLeadNote = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const text = clean(req.body.text)

  if (!text) {
    return res.status(400).json({
      success: false,
      message: 'La nota no puede estar vacía',
    })
  }

  const lead = await addLeadNote({
    tenantId,
    leadId: req.params.leadId,
    text,
    user: req.user,
  })

  if (!lead) return sendNotFound(res)

  return res.status(201).json({ success: true, data: normalizeLead(lead) })
})

export const markAiLeadWon = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const lead = await updateLeadStatus({
    tenantId,
    leadId: req.params.leadId,
    status: 'won',
    reason: clean(req.body.reason),
    user: req.user,
  })

  if (!lead) return sendNotFound(res)

  return res.json({ success: true, data: normalizeLead(lead) })
})

export const markAiLeadLost = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const lead = await updateLeadStatus({
    tenantId,
    leadId: req.params.leadId,
    status: 'lost',
    reason: clean(req.body.reason),
    user: req.user,
  })

  if (!lead) return sendNotFound(res)

  return res.json({ success: true, data: normalizeLead(lead) })
})

export const discardAiLead = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)

  const lead = await updateLeadStatus({
    tenantId,
    leadId: req.params.leadId,
    status: 'discarded',
    reason: clean(req.body.reason),
    user: req.user,
  })

  if (!lead) return sendNotFound(res)

  return res.json({ success: true, data: normalizeLead(lead) })
})

export const deleteAiLead = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { leadId } = req.params

  if (!isValidObjectId(leadId)) return sendNotFound(res)

  const reason = clean(req.body?.reason)

  const lead = await AiLead.findOneAndUpdate(
    {
      _id: leadId,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $set: {
        status: 'discarded',
        deletedAt: new Date(),
        deletedBy: req.user?._id || null,
        deletedReason: reason,
      },
      $push: {
        notes: {
          text: reason
            ? `Lead eliminado lógicamente. Motivo: ${reason}`
            : 'Lead eliminado lógicamente desde bandeja comercial.',
          createdBy: req.user?._id || null,
        },
      },
    },
    {
      new: true,
    },
  ).setOptions({ tenantId })

  if (!lead) return sendNotFound(res)

  return res.json({
    success: true,
    data: normalizeLead(lead),
  })
})

export const removeLeadProductOfInterest = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { leadId } = req.params
  const productRef = decodeURIComponent(clean(req.params.productRef))

  if (!isValidObjectId(leadId)) return sendNotFound(res)
  if (!productRef) {
    return res.status(400).json({
      success: false,
      message: 'Referencia de producto requerida',
    })
  }

  const lead = await AiLead.findOne({
    _id: leadId,
    tenantId,
    deletedAt: { $exists: false },
  }).setOptions({ tenantId })

  if (!lead) return sendNotFound(res)

  const before = lead.productsOfInterest?.length || 0

  lead.productsOfInterest = (lead.productsOfInterest || []).filter(product => {
    const refs = [
      product?._id,
      product?.productId,
      product?.slug,
      product?.sku,
      product?.title,
    ]
      .map(value => clean(value))
      .filter(Boolean)

    return !refs.includes(productRef)
  })

  const after = lead.productsOfInterest.length
  const reason = clean(req.body?.reason)

  lead.notes.push({
    text:
      before === after
        ? `Se intentó remover un producto de interés no encontrado: ${productRef}`
        : `Producto de interés removido: ${productRef}${
          reason ? `. Motivo: ${reason}` : ''
        }`,
    createdBy: req.user?._id || null,
  })

  await lead.save()

  return res.json({
    success: true,
    data: normalizeLead(lead),
  })
})

export const updateLeadProductsOfInterest = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const { leadId } = req.params

  if (!isValidObjectId(leadId)) return sendNotFound(res)

  const products = Array.isArray(req.body?.productsOfInterest)
    ? req.body.productsOfInterest
    : []

  const normalizedProducts = products
    .map(buildProductOfInterest)
    .filter(product => product.productId || product.title || product.slug || product.sku)
    .slice(0, 20)

  const lead = await AiLead.findOneAndUpdate(
    {
      _id: leadId,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $set: {
        productsOfInterest: normalizedProducts,
      },
      $push: {
        notes: {
          text: `Productos de interés actualizados manualmente. Total: ${normalizedProducts.length}`,
          createdBy: req.user?._id || null,
        },
      },
    },
    {
      new: true,
    },
  ).setOptions({ tenantId })

  if (!lead) return sendNotFound(res)

  return res.json({
    success: true,
    data: normalizeLead(lead),
  })
})