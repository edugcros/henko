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
import logger from '../../config/logger.js'

const MAX_BATCH_SIZE = Number(env?.metrics?.eventBatchMax || 50)
const MAX_ITEMS = 50
const MAX_METADATA_KEYS = 50
const MAX_METADATA_DEPTH = 4
const MAX_STRING_LENGTH = 500

const ALLOWED_EVENTS = new Set(Object.values(USER_METRIC_EVENTS))

const getOptionalUserFromRequest = getOptionalUserFromAccessToken

const clean = (value, max = MAX_STRING_LENGTH) => {
  if (value === undefined || value === null) return ''

  return String(value).trim().slice(0, max)
}

const cleanLower = (value, max = MAX_STRING_LENGTH) => clean(value, max).toLowerCase()
const cleanUpper = (value, max = MAX_STRING_LENGTH) => clean(value, max).toUpperCase()

const isObjectId = isValidObjectId

const optionalObjectId = value => {
  const text = clean(value, 120)

  return text && isObjectId(text) ? toObjectId(text) : null
}

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

const getTenantDomainFromRequest = req => {
  return cleanLower(
    req.headers?.['x-tenant-domain'] ||
      req.headers?.['x-forwarded-host'] ||
      req.headers?.host ||
      '',
    180,
  )
}

const getClientIp = req => {
  return clean(
    String(req.headers?.['x-forwarded-for'] || '')
      .split(',')[0]
      .trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '',
    80,
  )
}

const sanitizeMetadataValue = (value, depth = 0) => {
  if (depth > MAX_METADATA_DEPTH) return null

  if (value === undefined || value === null) return null

  if (typeof value === 'string') return clean(value, 1000)
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map(item => sanitizeMetadataValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .slice(0, MAX_METADATA_KEYS)
      .reduce((acc, [key, entryValue]) => {
        const safeKey = clean(key, 80)

        if (!safeKey) return acc

        acc[safeKey] = sanitizeMetadataValue(entryValue, depth + 1)
        return acc
      }, {})
  }

  return clean(value)
}

const sanitizeMetadata = metadata => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return sanitizeMetadataValue(metadata) || {}
}

const sanitizeItems = items => {
  if (!Array.isArray(items)) return []

  return items.slice(0, MAX_ITEMS).map(item => {
    const productId = clean(
      item?.productId ||
        item?.id ||
        item?.item_id ||
        item?.productObjectId ||
        '',
      120,
    )

    return {
      productId,
      productObjectId: optionalObjectId(productId),
      title: clean(item?.title || item?.name || item?.item_name || '', 180),
      sku: clean(item?.sku || '', 120),
      quantity: finiteNumber(item?.quantity),
      price: finiteNumber(item?.price),
      subtotal: finiteNumber(item?.subtotal),
    }
  })
}

const normalizeSource = value => {
  const source = cleanLower(value || 'storefront', 40)

  const allowed = new Set([
    'storefront',
    'website',
    'admin',
    'agent',
    'system',
    'webchat',
    'whatsapp',
    'unknown',
  ])

  return allowed.has(source) ? source : 'unknown'
}

const normalizeOccurredAt = value => {
  const date = value ? new Date(value) : new Date()

  return Number.isNaN(date.getTime()) ? new Date() : date
}

const normalizeEventPayload = ({ req, rawEvent, tenantId, user }) => {
  const eventType = cleanLower(rawEvent?.eventType, 100)

  if (!ALLOWED_EVENTS.has(eventType)) {
    return null
  }

  const sessionId = clean(rawEvent?.sessionId, 180)

  if (!sessionId) {
    return null
  }

  const orderId = clean(rawEvent?.orderId, 180)
  const productRef = clean(rawEvent?.productId, 120)

  const userId =
    user?._id && isObjectId(user._id)
      ? toObjectId(user._id)
      : user?.id && isObjectId(user.id)
        ? toObjectId(user.id)
        : null

  const userAgent = clean(req.headers?.['user-agent'] || rawEvent?.device?.userAgent || '', 500)

  return {
    tenantId,
    userId,

    eventId: clean(rawEvent?.eventId || rawEvent?.id, 180),

    sessionId,
    tenantDomain: cleanLower(
      rawEvent?.tenantDomain || getTenantDomainFromRequest(req),
      180,
    ),

    eventType,
    source: normalizeSource(rawEvent?.source),

    path: clean(rawEvent?.path || req.originalUrl || req.path || '/', 1000),
    referrer: clean(rawEvent?.referrer || '', 1000),

    productId: optionalObjectId(rawEvent?.productId),
    productRef,

    cartId: optionalObjectId(rawEvent?.cartId),

    orderId,
    orderObjectId: optionalObjectId(orderId),

    paymentId: clean(rawEvent?.paymentId, 180),

    searchQuery: clean(rawEvent?.searchQuery || rawEvent?.query, 160),
    category: clean(rawEvent?.category, 120),

    value: finiteNumber(rawEvent?.value),
    quantity: finiteNumber(rawEvent?.quantity),
    currency: cleanUpper(rawEvent?.currency, 12),

    commerce: {
      cartValue: finiteNumber(rawEvent?.commerce?.cartValue),
      orderValue: finiteNumber(rawEvent?.commerce?.orderValue),
      discountValue: finiteNumber(rawEvent?.commerce?.discountValue),
      shippingValue: finiteNumber(rawEvent?.commerce?.shippingValue),
      taxValue: finiteNumber(rawEvent?.commerce?.taxValue),
      itemsCount: finiteNumber(rawEvent?.commerce?.itemsCount),
    },

    items: sanitizeItems(rawEvent?.items),

    device: {
      type: rawEvent?.device?.type || getDeviceType(userAgent),
      userAgent,
      language: clean(rawEvent?.device?.language || req.headers?.['accept-language'] || '', 30),
      platform: clean(rawEvent?.device?.platform || '', 80),
      viewport: {
        width: finiteNumber(rawEvent?.device?.viewport?.width),
        height: finiteNumber(rawEvent?.device?.viewport?.height),
      },
    },

    attribution: {
      utmSource: clean(rawEvent?.attribution?.utmSource, 120),
      utmMedium: clean(rawEvent?.attribution?.utmMedium, 120),
      utmCampaign: clean(rawEvent?.attribution?.utmCampaign, 160),
      utmContent: clean(rawEvent?.attribution?.utmContent, 160),
      utmTerm: clean(rawEvent?.attribution?.utmTerm, 160),
    },

    metadata: {
      ...sanitizeMetadata(rawEvent?.metadata),
      ip: getClientIp(req),
    },

    occurredAt: normalizeOccurredAt(rawEvent?.occurredAt),
  }
}

export const trackUserMetricEvent = asyncHandler(async (req, res) => {
  const tenantId = getTenantIdFromRequest(req)

  if (!tenantId || !isObjectId(tenantId)) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no identificado',
    })
  }

  const user = await Promise.resolve(getOptionalUserFromRequest(req))

  const rawEvents = Array.isArray(req.body?.events)
    ? req.body.events.slice(0, MAX_BATCH_SIZE)
    : [req.body]

  const events = rawEvents
    .map(rawEvent =>
      normalizeEventPayload({
        req,
        rawEvent,
        tenantId,
        user,
      }),
    )
    .filter(Boolean)

  if (events.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Evento inválido',
    })
  }

  try {
    const inserted = await UserMetricEvent.insertMany(events, {
      ordered: false,
      rawResult: false,
    })

    return res.status(201).json({
      success: true,
      inserted: inserted.length,
    })
  } catch (error) {
    /**
     * Si agregaste índice único por tenantId + eventId,
     * insertMany con ordered:false puede insertar algunos y fallar otros por duplicado.
     * Para métricas, eso no debe romper el frontend.
     */
    if (error?.code === 11000 || error?.writeErrors?.length) {
      const duplicateCount = Array.isArray(error.writeErrors)
        ? error.writeErrors.filter(item => item?.code === 11000).length
        : 1

      logger.warn('[Metrics] Algunos eventos fueron duplicados o no insertados', {
        attempted: events.length,
        duplicateCount,
        message: error.message,
      })

      return res.status(201).json({
        success: true,
        inserted: Math.max(0, events.length - duplicateCount),
        duplicates: duplicateCount,
      })
    }

    throw error
  }
})