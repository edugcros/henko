// 📁 src/controller/aiAgentEventCtrl.js
import asyncHandler from 'express-async-handler'
import { registerAiAgentEvent } from '../services/aiAgent/aiAgentEventService.js'
import { isValidObjectId } from '../utils/requestContext.js'

const MAX_STRING_LENGTH = 500
const MAX_METADATA_KEYS = 50
const MAX_ARRAY_LENGTH = 50
const MAX_BATCH_EVENTS = 25
const MAX_DEPTH = 4

const DEFAULT_CHANNEL = 'storefront'

const ALLOWED_CHANNELS = new Set([
  'storefront',
  'website',
  'webchat',
  'whatsapp',
  'admin',
  'system',
])

const ALLOWED_EVENT_TYPES = new Set([
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

  // Eventos propios del agente IA
  'ai_agent_message',
  'ai_agent_action',
  'ai_agent_tool_call',
  'ai_agent_recommendation',
  'ai_agent_lead',
  'ai_agent_cart_recovery',
])

const clean = (value, max = MAX_STRING_LENGTH) => {
  if (value === undefined || value === null) return ''

  return String(value).trim().slice(0, max)
}

const cleanUpper = value => clean(value).toUpperCase()

const toNumber = (value, defaultValue = 0) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : defaultValue
}

const getTenantId = req => {
  return (
    req.tenant?._id ||
    req.resolvedTenant?._id ||
    req.tenantId ||
    req.user?.tenantId ||
    null
  )
}

const getClientIp = req => {
  return (
    req.headers['x-forwarded-for']?.split(',')?.[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    ''
  )
}

const isSafeEventType = value => {
  const type = clean(value, 100).toLowerCase()

  if (!type) return false
  if (ALLOWED_EVENT_TYPES.has(type)) return true

  return /^[a-z0-9_:-]{2,100}$/.test(type)
}

const normalizeChannel = value => {
  const channel = clean(value || DEFAULT_CHANNEL, 40).toLowerCase()

  return ALLOWED_CHANNELS.has(channel) ? channel : DEFAULT_CHANNEL
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
    productId: clean(item?.productId || item?.id || item?.item_id),
    title: clean(item?.title || item?.name || item?.item_name),
    sku: clean(item?.sku),
    quantity: Math.max(0, toNumber(item?.quantity, 0)),
    price: toNumber(item?.price, 0),
    subtotal: toNumber(item?.subtotal, 0),
  }))
}

const validateOptionalObjectId = ({ value, fieldName, res }) => {
  if (!value) return true

  if (!isValidObjectId(value)) {
    res.status(400).json({
      success: false,
      message: `${fieldName} inválido`,
    })

    return false
  }

  return true
}

const normalizeEventBody = ({ req, rawEvent }) => {
  const type = clean(rawEvent?.type || rawEvent?.eventType).toLowerCase()
  const actionType = clean(rawEvent?.actionType || rawEvent?.action).toLowerCase()
  const channel = normalizeChannel(rawEvent?.channel || rawEvent?.source)

  const items = sanitizeItems(rawEvent?.items)

  return {
    eventId: clean(rawEvent?.eventId || rawEvent?.id),
    conversationId: rawEvent?.conversationId || null,
    channel,
    externalUserId: clean(
      rawEvent?.externalUserId ||
        rawEvent?.userId ||
        rawEvent?.sessionId ||
        rawEvent?.anonymousId,
    ),
    type,
    actionType,
    productId: rawEvent?.productId || null,
    couponCode: rawEvent?.couponCode
      ? cleanUpper(rawEvent.couponCode)
      : rawEvent?.coupon
        ? cleanUpper(rawEvent.coupon)
        : '',
    value: toNumber(rawEvent?.value, 0),
    metadata: {
      label: clean(rawEvent?.label),
      url: clean(rawEvent?.url),
      intent: clean(rawEvent?.intent),
      leadScore: toNumber(rawEvent?.leadScore, 0),
      path: clean(rawEvent?.path),
      referrer: clean(rawEvent?.referrer),
      rawAction: sanitizeMetricValue(rawEvent?.rawAction),
      userAgent: clean(req.headers['user-agent'], 300),

      // Compatibilidad con userMetricsService / checkout
      source: clean(rawEvent?.source || 'storefront'),
      sessionId: clean(rawEvent?.sessionId),
      tenantDomain: clean(rawEvent?.tenantDomain || req.headers.host),
      orderId: clean(rawEvent?.orderId),
      paymentId: clean(rawEvent?.paymentId),
      currency: clean(rawEvent?.currency),
      quantity: toNumber(rawEvent?.quantity, 0),
      items,
      commerce: sanitizeMetricValue(rawEvent?.commerce),
      attribution: sanitizeMetricValue(rawEvent?.attribution),
      device: sanitizeMetricValue(rawEvent?.device),
      occurredAt: clean(rawEvent?.occurredAt || new Date().toISOString()),
      ip: clean(getClientIp(req), 80),
      metadata: sanitizeMetricValue(rawEvent?.metadata),
    },
  }
}

const registerOneEvent = async ({ req, tenantId, rawEvent }) => {
  const normalized = normalizeEventBody({ req, rawEvent })

  return registerAiAgentEvent({
    tenantId,
    eventId: normalized.eventId,
    conversationId: normalized.conversationId,
    channel: normalized.channel,
    externalUserId: normalized.externalUserId,
    type: normalized.type,
    actionType: normalized.actionType,
    productId: normalized.productId,
    couponCode: normalized.couponCode,
    value: normalized.value,
    metadata: normalized.metadata,
  })
}

export const trackAiAgentEvent = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  if (!isValidObjectId(tenantId)) {
    return res.status(400).json({
      success: false,
      message: 'Tenant inválido',
    })
  }

  const rawEvents = Array.isArray(req.body?.events)
    ? req.body.events
    : [req.body]

  if (rawEvents.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No se recibieron eventos',
    })
  }

  if (rawEvents.length > MAX_BATCH_EVENTS) {
    return res.status(413).json({
      success: false,
      message: `Máximo ${MAX_BATCH_EVENTS} eventos por solicitud`,
    })
  }

  const results = []
  let createdCount = 0
  let duplicateCount = 0

  for (const rawEvent of rawEvents) {
    const eventType = clean(rawEvent?.type || rawEvent?.eventType).toLowerCase()

    if (!isSafeEventType(eventType)) {
      return res.status(400).json({
        success: false,
        message: 'Tipo de evento inválido',
      })
    }

    if (
      !validateOptionalObjectId({
        value: rawEvent?.conversationId,
        fieldName: 'ID de conversación',
        res,
      })
    ) {
      return
    }

    if (
      !validateOptionalObjectId({
        value: rawEvent?.productId,
        fieldName: 'ID de producto',
        res,
      })
    ) {
      return
    }

    const event = await registerOneEvent({
      req,
      tenantId,
      rawEvent,
    })

    if (event?.duplicate) {
      duplicateCount += 1
    } else {
      createdCount += 1
    }

    results.push(event)
  }

  const isBatch = Array.isArray(req.body?.events)

  return res.status(createdCount > 0 ? 201 : 200).json({
    success: true,
    data: isBatch ? results : results[0],
    meta: {
      total: results.length,
      created: createdCount,
      duplicates: duplicateCount,
    },
  })
})