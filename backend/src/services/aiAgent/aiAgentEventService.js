// 📁 src/services/aiAgent/aiAgentEventService.js
import mongoose from 'mongoose'
import AiAgentEvent from '../../models/aiAgentEventModel.js'
import AiLearningSuggestion from '../../models/aiLearningSuggestionModel.js'
import AiConversation from '../../models/aiConversationModel.js'
import Product from '../../models/productModel.js'

const MAX_STRING_LENGTH = 500
const MAX_METADATA_KEYS = 60
const MAX_ARRAY_LENGTH = 50
const MAX_DEPTH = 4

const clean = (value, max = MAX_STRING_LENGTH) => {
  if (value === undefined || value === null) return ''

  return String(value).trim().slice(0, max)
}

const cleanLower = (value, max = MAX_STRING_LENGTH) => clean(value, max).toLowerCase()
const cleanUpper = (value, max = MAX_STRING_LENGTH) => clean(value, max).toUpperCase()

const allowedChannels = new Set([
  'storefront',
  'website',
  'webchat',
  'whatsapp',
  'admin',
  'admin_test',
  'system',
  'unknown',
])

const knownEventTypes = new Set([
  // Storefront / métricas
  'page_view',
  'product_impression',
  'product_click',
  'product_view',
  'search',
  'add_to_cart',
  'remove_from_cart',
  'wishlist_add',
  'wishlist_remove',
  'checkout_start',
  'checkout_step',
  'payment_attempt',
  'payment_approved',
  'payment_rejected',
  'purchase',
  'login',
  'logout',

  // Legacy / agente IA
  'message_sent',
  'assistant_replied',
  'action_clicked',
  'view_product',
  'coupon_copied',
  'request_human',
  'positive_feedback',
  'negative_feedback',
  'checkout_started',
  'purchase_completed',

  // Agente IA avanzado
  'ai_agent_message',
  'ai_agent_action',
  'ai_agent_tool_call',
  'ai_agent_recommendation',
  'ai_agent_lead',
  'ai_agent_cart_recovery',
])

const isAllowedEventType = value => {
  const type = cleanLower(value, 100)

  if (!type) return false
  if (knownEventTypes.has(type)) return true

  // Permite eventos nuevos controlados sin tener que redeployar por cada nombre nuevo.
  return /^[a-z0-9_:-]{2,100}$/.test(type)
}

const normalizeChannel = value => {
  const channel = cleanLower(value || 'unknown', 40)

  return allowedChannels.has(channel) ? channel : 'unknown'
}

const toObjectIdOrNull = value => {
  const cleanValue = clean(value, 80)

  return mongoose.Types.ObjectId.isValid(cleanValue)
    ? new mongoose.Types.ObjectId(cleanValue)
    : null
}

const clampNumber = ({ value, min = 0, max = 1_000_000_000 } = {}) => {
  const number = Number(value)

  if (!Number.isFinite(number)) return 0

  return Math.min(Math.max(number, min), max)
}

const sanitizeMetricValue = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return null

  if (value === undefined || value === null) return null

  if (typeof value === 'string') return clean(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map(item => sanitizeMetricValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .slice(0, MAX_METADATA_KEYS)
      .reduce((acc, [key, entryValue]) => {
        const safeKey = clean(key, 80)

        if (!safeKey) return acc

        acc[safeKey] = sanitizeMetricValue(entryValue, depth + 1)
        return acc
      }, {})
  }

  return clean(value)
}

const sanitizeItems = items => {
  if (!Array.isArray(items)) return []

  return items.slice(0, MAX_ARRAY_LENGTH).map(item => ({
    productId: clean(item?.productId || item?.id || item?.item_id, 120),
    title: clean(item?.title || item?.name || item?.item_name, 250),
    sku: clean(item?.sku, 120),
    quantity: clampNumber({ value: item?.quantity, max: 100000 }),
    price: clampNumber({ value: item?.price }),
    subtotal: clampNumber({ value: item?.subtotal }),
  }))
}

const normalizeOccurredAt = value => {
  if (!value) return null

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

const sanitizeMetadata = metadata => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  const rawAction = sanitizeMetricValue(metadata.rawAction)
  const nestedMetadata = sanitizeMetricValue(metadata.metadata)
  const commerce = sanitizeMetricValue(metadata.commerce)
  const attribution = sanitizeMetricValue(metadata.attribution)
  const device = sanitizeMetricValue(metadata.device)
  const items = sanitizeItems(metadata.items)

  return {
    label: clean(metadata.label, 200),
    url: clean(metadata.url, 1000),
    intent: clean(metadata.intent, 120),
    leadScore: clampNumber({ value: metadata.leadScore, min: 0, max: 100 }),
    userAgent: clean(metadata.userAgent, 500),
    path: clean(metadata.path, 1000),
    referrer: clean(metadata.referrer, 1000),
    rawAction,

    // Compatibilidad storefront / checkout / userMetricsService
    source: clean(metadata.source, 80),
    sessionId: clean(metadata.sessionId, 180),
    tenantDomain: clean(metadata.tenantDomain, 180),
    orderId: clean(metadata.orderId, 120),
    paymentId: clean(metadata.paymentId, 120),
    currency: cleanUpper(metadata.currency, 12),
    quantity: clampNumber({ value: metadata.quantity, max: 100000 }),
    items,
    commerce,
    attribution,
    device,
    occurredAt: normalizeOccurredAt(metadata.occurredAt),
    ip: clean(metadata.ip, 80),
    metadata: nestedMetadata || {},
  }
}

const eventToSignalUpdate = type => {
  const normalizedType = cleanLower(type, 100)

  if (normalizedType === 'view_product') return { 'signals.productClicks': 1 }
  if (normalizedType === 'product_view') return { 'signals.productClicks': 1 }
  if (normalizedType === 'product_click') return { 'signals.productClicks': 1 }
  if (normalizedType === 'action_clicked') return { 'signals.productClicks': 1 }

  if (normalizedType === 'add_to_cart') return { 'signals.cartAdds': 1 }

  if (normalizedType === 'negative_feedback') {
    return { 'signals.negativeFeedback': 1 }
  }

  if (normalizedType === 'positive_feedback') {
    return { 'signals.positiveFeedback': 1 }
  }

  if (normalizedType === 'purchase' || normalizedType === 'purchase_completed') {
    return { 'signals.purchases': 1 }
  }

  return null
}

const assertConversationBelongsToTenant = async ({
  tenantId,
  conversationId,
}) => {
  if (!conversationId) return true

  const exists = await AiConversation.exists({
    _id: conversationId,
    tenantId,
    deletedAt: { $exists: false },
  }).setOptions({ tenantId })

  if (!exists) {
    const error = new Error('La conversación no pertenece al comercio')
    error.statusCode = 404
    throw error
  }

  return true
}

const resolveProductIdForTenant = async ({ tenantId, productId, metadata }) => {
  if (!productId) return null

  const exists = await Product.exists({
    _id: productId,
    tenantId,
    isDeleted: { $ne: true },
  }).setOptions({ tenantId })

  if (exists) return productId

  // Para métricas públicas no conviene romper todo el evento.
  // Lo guardamos sin vínculo fuerte y dejamos warning en metadata.
  if (metadata) {
    metadata.referenceWarning = 'product_not_found_or_not_owned_by_tenant'
    metadata.originalProductId = clean(productId, 80)
  }

  return null
}

export const registerAiAgentEvent = async ({
  tenantId,
  eventId = '',
  conversationId,
  channel = 'webchat',
  externalUserId = '',
  type,
  actionType = '',
  productId = null,
  couponCode = '',
  value = 0,
  metadata = {},
} = {}) => {
  const safeTenantId = toObjectIdOrNull(tenantId)

  if (!safeTenantId || !type) {
    const error = new Error('tenantId y type son obligatorios')
    error.statusCode = 400
    throw error
  }

  const safeType = cleanLower(type, 100)

  if (!isAllowedEventType(safeType)) {
    const error = new Error('Tipo de evento inválido')
    error.statusCode = 400
    throw error
  }

  const safeChannel = normalizeChannel(channel)
  const safeEventId = clean(eventId, 180)
  const safeConversationId = toObjectIdOrNull(conversationId)
  const requestedProductId = toObjectIdOrNull(productId)
  const safeMetadata = sanitizeMetadata(metadata)

  if (safeEventId) {
    const existing = await AiAgentEvent.findOne({
      tenantId: safeTenantId,
      eventId: safeEventId,
    })
      .setOptions({ tenantId: safeTenantId })
      .lean()

    if (existing) {
      return { ...existing, duplicate: true }
    }
  }

  await assertConversationBelongsToTenant({
    tenantId: safeTenantId,
    conversationId: safeConversationId,
  })

  const safeProductId = await resolveProductIdForTenant({
    tenantId: safeTenantId,
    productId: requestedProductId,
    metadata: safeMetadata,
  })

  const safeItems = sanitizeItems(safeMetadata.items)

  let event

  try {
    event = await AiAgentEvent.create({
      tenantId: safeTenantId,
      eventId: safeEventId,
      conversationId: safeConversationId,
      channel: safeChannel,
      externalUserId: clean(externalUserId, 200),
      type: safeType,
      actionType: cleanLower(actionType, 100),
      productId: safeProductId,
      couponCode: cleanUpper(couponCode, 100),
      value: clampNumber({ value }),

      // Campos top-level compatibles con modelo nuevo.
      source: clean(safeMetadata.source, 80),
      sessionId: clean(safeMetadata.sessionId, 180),
      tenantDomain: clean(safeMetadata.tenantDomain, 180),
      orderId: clean(safeMetadata.orderId, 120),
      paymentId: clean(safeMetadata.paymentId, 120),
      currency: cleanUpper(safeMetadata.currency, 12),
      quantity: clampNumber({ value: safeMetadata.quantity, max: 100000 }),
      items: safeItems,

      metadata: {
        ...safeMetadata,
        items: safeItems,
      },
    })
  } catch (error) {
    if (error?.code === 11000 && safeEventId) {
      const existing = await AiAgentEvent.findOne({
        tenantId: safeTenantId,
        eventId: safeEventId,
      })
        .setOptions({ tenantId: safeTenantId })
        .lean()

      if (existing) {
        return { ...existing, duplicate: true }
      }
    }

    throw error
  }

  const signalUpdate = eventToSignalUpdate(safeType)

  if (signalUpdate && safeConversationId) {
    await AiLearningSuggestion.updateMany(
      {
        tenantId: safeTenantId,
        sourceConversationIds: safeConversationId,
        status: 'pending_review',
      },
      {
        $inc: signalUpdate,
        $addToSet: { sourceEventIds: event._id },
      },
    ).setOptions({ tenantId: safeTenantId })
  }

  return event.toObject()
}