// src/services/aiAgent/aiCatalogEventService.js
import mongoose from 'mongoose'
import { invalidateCatalogSnapshot } from './aiCatalogSnapshotService.js'

const MAX_STRING_LENGTH = 180
const MAX_METADATA_KEYS = 30
const MAX_ARRAY_LENGTH = 30
const MAX_DEPTH = 3

export const AI_CATALOG_CHANGE_TYPES = {
  PRODUCT_CREATED: 'product_created',
  PRODUCT_UPDATED: 'product_updated',
  PRODUCT_DELETED: 'product_deleted',
  PRODUCT_RESTORED: 'product_restored',
  PRODUCT_PUBLISHED: 'product_published',
  PRODUCT_UNPUBLISHED: 'product_unpublished',
  PRODUCT_APPROVED_FROM_AI: 'product_approved_from_ai',
  PRODUCT_IMPORTED_FROM_AI: 'product_imported_from_ai',
  PRICE_CHANGED: 'price_changed',
  STOCK_CHANGED: 'stock_changed',
  VARIANT_CHANGED: 'variant_changed',
  CATEGORY_CHANGED: 'category_changed',
  CATALOG_REINDEX_REQUESTED: 'catalog_reindex_requested',
  UNKNOWN: 'unknown',
}

const clean = (value, max = MAX_STRING_LENGTH) => {
  if (value === undefined || value === null) return ''

  return String(value).trim().slice(0, max)
}

const cleanLower = value => clean(value).toLowerCase()

const isValidObjectIdLike = value => {
  const text = clean(value, 80)

  return mongoose.Types.ObjectId.isValid(text)
}

const normalizeTenantId = tenantId => {
  const value = clean(tenantId, 80)

  if (!value) return ''

  return value
}

const normalizeChangeType = changeType => {
  const value = cleanLower(changeType)

  if (!value) return AI_CATALOG_CHANGE_TYPES.UNKNOWN

  const allowed = new Set(Object.values(AI_CATALOG_CHANGE_TYPES))

  return allowed.has(value) ? value : AI_CATALOG_CHANGE_TYPES.UNKNOWN
}

const sanitizeValue = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return null

  if (value === undefined || value === null) return null

  if (typeof value === 'string') return clean(value, 500)
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map(item => sanitizeValue(item, depth + 1))
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .slice(0, MAX_METADATA_KEYS)
      .reduce((acc, [key, entryValue]) => {
        const safeKey = clean(key, 80)

        if (!safeKey) return acc

        acc[safeKey] = sanitizeValue(entryValue, depth + 1)
        return acc
      }, {})
  }

  return clean(value)
}

const buildCatalogChangePayload = ({
  tenantId,
  changeType,
  productId,
  source,
  actorId,
  metadata,
} = {}) => {
  const cleanTenantId = normalizeTenantId(tenantId)

  return {
    tenantId: cleanTenantId,
    changeType: normalizeChangeType(changeType),
    productId: productId ? clean(productId, 80) : '',
    source: clean(source || 'system', 80),
    actorId: actorId ? clean(actorId, 80) : '',
    metadata: sanitizeValue(metadata) || {},
    occurredAt: new Date().toISOString(),
  }
}

export const registerAiCatalogChangedEvent = async ({
  tenantId,
  changeType = AI_CATALOG_CHANGE_TYPES.UNKNOWN,
  productId = '',
  source = 'system',
  actorId = '',
  metadata = {},
} = {}) => {
  const event = buildCatalogChangePayload({
    tenantId,
    changeType,
    productId,
    source,
    actorId,
    metadata,
  })

  if (!event.tenantId) {
    return {
      invalidated: false,
      reason: 'missing_tenant_id',
      event,
    }
  }

  if (!isValidObjectIdLike(event.tenantId)) {
    return {
      invalidated: false,
      reason: 'invalid_tenant_id',
      event,
    }
  }

  if (event.productId && !isValidObjectIdLike(event.productId)) {
    return {
      invalidated: false,
      reason: 'invalid_product_id',
      event,
    }
  }

  try {
    await Promise.resolve(invalidateCatalogSnapshot(event.tenantId))

    return {
      invalidated: true,
      tenantId: event.tenantId,
      changeType: event.changeType,
      productId: event.productId || null,
      source: event.source,
      event,
    }
  } catch (error) {
    return {
      invalidated: false,
      reason: 'snapshot_invalidation_failed',
      message: error.message,
      event,
    }
  }
}

export const registerManyAiCatalogChangedEvents = async ({
  tenantId,
  events = [],
  source = 'system',
  actorId = '',
} = {}) => {
  const cleanTenantId = normalizeTenantId(tenantId)

  if (!cleanTenantId) {
    return {
      invalidated: false,
      reason: 'missing_tenant_id',
      total: 0,
      results: [],
    }
  }

  if (!Array.isArray(events) || events.length === 0) {
    return {
      invalidated: false,
      reason: 'missing_events',
      tenantId: cleanTenantId,
      total: 0,
      results: [],
    }
  }

  const results = []

  for (const event of events.slice(0, MAX_ARRAY_LENGTH)) {
    const result = await registerAiCatalogChangedEvent({
      tenantId: cleanTenantId,
      changeType: event.changeType,
      productId: event.productId,
      source: event.source || source,
      actorId: event.actorId || actorId,
      metadata: event.metadata,
    })

    results.push(result)
  }

  return {
    invalidated: results.some(result => result.invalidated),
    tenantId: cleanTenantId,
    total: results.length,
    results,
  }
}

export default {
  AI_CATALOG_CHANGE_TYPES,
  registerAiCatalogChangedEvent,
  registerManyAiCatalogChangedEvents,
}