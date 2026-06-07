import asyncHandler from 'express-async-handler'

import UserMetricEvent, {
  USER_METRIC_EVENTS,
} from '../models/userMetricEventModel.js'
import { getOptionalUserFromAccessToken } from '../utils/authRequest.js'
import {
  getTenantIdFromRequest,
  isValidObjectId,
  toObjectId,
} from '../utils/requestContext.js'
import { env } from '../../config/env.js'

const MAX_BATCH_SIZE = env.metrics.eventBatchMax

const getOptionalUserFromRequest = getOptionalUserFromAccessToken

const isObjectId = isValidObjectId

const optionalObjectId = value => (value && isObjectId(value) ? toObjectId(value) : null)

const finiteNumber = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const getDeviceType = userAgent => {
  const ua = String(userAgent || '').toLowerCase()
  if (!ua) return 'unknown'
  if (/ipad|tablet/.test(ua)) return 'tablet'
  if (/mobile|android|iphone|ipod/.test(ua)) return 'mobile'
  return 'desktop'
}

const sanitizeMetadata = metadata => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  const allowed = {}
  const entries = Object.entries(metadata).slice(0, 20)

  entries.forEach(([key, value]) => {
    const safeKey = String(key || '').trim().slice(0, 60)
    if (!safeKey) return

    if (['string', 'number', 'boolean'].includes(typeof value)) {
      allowed[safeKey] = typeof value === 'string' ? value.slice(0, 250) : value
    }
  })

  return allowed
}

const sanitizeItems = items => {
  if (!Array.isArray(items)) return []

  return items.slice(0, 100).map(item => ({
    productId: optionalObjectId(item?.productId),
    title: String(item?.title || '').trim().slice(0, 180),
    sku: String(item?.sku || '').trim().slice(0, 120),
    quantity: finiteNumber(item?.quantity),
    price: finiteNumber(item?.price),
    subtotal: finiteNumber(item?.subtotal),
  }))
}

const normalizeEventPayload = ({ req, rawEvent, tenantId, user }) => {
  const eventType = String(rawEvent?.eventType || '').trim()

  if (!Object.values(USER_METRIC_EVENTS).includes(eventType)) {
    return null
  }

  const occurredAt = rawEvent.occurredAt
    ? new Date(rawEvent.occurredAt)
    : new Date()

  return {
    tenantId,
    userId: user?.id && isObjectId(user.id) ? toObjectId(user.id) : null,
    sessionId: String(rawEvent.sessionId || '').trim().slice(0, 128),
    eventType,
    source: rawEvent.source || 'storefront',
    path: rawEvent.path || '/',
    referrer: rawEvent.referrer || '',
    productId: optionalObjectId(rawEvent.productId),
    cartId: optionalObjectId(rawEvent.cartId),
    orderId: optionalObjectId(rawEvent.orderId),
    paymentId: String(rawEvent.paymentId || '').trim().slice(0, 160),
    searchQuery: rawEvent.searchQuery || '',
    category: rawEvent.category || '',
    value: finiteNumber(rawEvent.value),
    quantity: finiteNumber(rawEvent.quantity),
    currency: String(rawEvent.currency || '').trim().toUpperCase().slice(0, 12),
    commerce: {
      cartValue: finiteNumber(rawEvent.commerce?.cartValue),
      orderValue: finiteNumber(rawEvent.commerce?.orderValue),
      discountValue: finiteNumber(rawEvent.commerce?.discountValue),
      shippingValue: finiteNumber(rawEvent.commerce?.shippingValue),
      taxValue: finiteNumber(rawEvent.commerce?.taxValue),
      itemsCount: finiteNumber(rawEvent.commerce?.itemsCount),
    },
    items: sanitizeItems(rawEvent.items),
    device: {
      type: rawEvent.device?.type || getDeviceType(req.headers['user-agent']),
      userAgent: req.headers['user-agent'] || rawEvent.device?.userAgent || '',
      language: rawEvent.device?.language || req.headers['accept-language'] || '',
    },
    attribution: {
      utmSource: rawEvent.attribution?.utmSource || '',
      utmMedium: rawEvent.attribution?.utmMedium || '',
      utmCampaign: rawEvent.attribution?.utmCampaign || '',
    },
    metadata: sanitizeMetadata(rawEvent.metadata),
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
  }
}

export const trackUserMetricEvent = asyncHandler(async (req, res) => {
  const tenantId = getTenantIdFromRequest(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no identificado',
    })
  }

  const user = getOptionalUserFromRequest(req)
  const rawEvents = Array.isArray(req.body?.events)
    ? req.body.events.slice(0, MAX_BATCH_SIZE)
    : [req.body]

  const events = rawEvents
    .map(rawEvent => normalizeEventPayload({ req, rawEvent, tenantId, user }))
    .filter(Boolean)
    .filter(event => event.sessionId)

  if (events.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Evento inválido',
    })
  }

  await UserMetricEvent.insertMany(events, {
    ordered: false,
  })

  return res.status(201).json({
    success: true,
    inserted: events.length,
  })
})
