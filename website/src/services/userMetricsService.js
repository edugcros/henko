// 📁 website/src/services/userMetricsService.js
import api from '@utils/axiosConfig'

const SESSION_KEY = 'henko_metric_session_id'
const SESSION_EXPIRES_AT_KEY = 'henko_metric_session_expires_at'
const ATTRIBUTION_KEY = 'henko_metric_attribution'
const SOURCE = 'storefront'

// Sesión analítica: 30 minutos de inactividad.
// Si querés seguir al usuario por más tiempo, subilo a 24h.
const SESSION_TTL_MS = 30 * 60 * 1000
const ATTRIBUTION_TTL_MS = 24 * 60 * 60 * 1000

const MAX_STRING_LENGTH = 500
const MAX_ARRAY_LENGTH = 50
const MAX_METADATA_KEYS = 40
const MAX_METADATA_DEPTH = 4
const REQUEST_TIMEOUT_MS = 3500
const BATCH_REQUEST_TIMEOUT_MS = 5000

export const USER_METRIC_EVENTS = {
  PAGE_VIEW: 'page_view',
  PRODUCT_IMPRESSION: 'product_impression',
  PRODUCT_CLICK: 'product_click',
  PRODUCT_VIEW: 'product_view',
  SEARCH: 'search',
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  WISHLIST_ADD: 'wishlist_add',
  WISHLIST_REMOVE: 'wishlist_remove',
  CHECKOUT_START: 'checkout_start',
  CHECKOUT_STEP: 'checkout_step',
  PAYMENT_ATTEMPT: 'payment_attempt',
  PAYMENT_APPROVED: 'payment_approved',
  PAYMENT_REJECTED: 'payment_rejected',
  PURCHASE: 'purchase',
  LOGIN: 'login',
  LOGOUT: 'logout',
}

const ALLOWED_EVENT_TYPES = new Set(Object.values(USER_METRIC_EVENTS))

const canUseBrowser = () => typeof window !== 'undefined'

const isDebugEnabled = () => {
  return String(process.env.REACT_APP_DEBUG_API || '').toLowerCase() === 'true'
}

const safeString = (value, maxLength = MAX_STRING_LENGTH) => {
  if (value === undefined || value === null) return ''

  return String(value).trim().slice(0, maxLength)
}

const safeNumber = value => {
  const number = Number(value)

  return Number.isFinite(number) ? number : 0
}

const safePositiveNumber = value => Math.max(0, safeNumber(value))

const isValidMetricEventType = eventType => {
  return ALLOWED_EVENT_TYPES.has(safeString(eventType, 100))
}

const createRandomId = () => {
  if (
    canUseBrowser() &&
    window.crypto &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const createEventId = eventType => {
  return `${safeString(eventType, 80) || 'event'}-${createRandomId()}`
}

const createSessionId = () => createRandomId()

const getStorageItem = key => {
  if (!canUseBrowser()) return null

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorageItem = (key, value) => {
  if (!canUseBrowser()) return

  try {
    window.localStorage.setItem(key, value)
  } catch {
    // noop: métricas no deben bloquear la experiencia del usuario
  }
}

const removeStorageItem = key => {
  if (!canUseBrowser()) return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // noop
  }
}

const safeJsonParse = (value, fallback = null) => {
  if (!value) return fallback

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const isSessionExpired = () => {
  const expiresAt = Number(getStorageItem(SESSION_EXPIRES_AT_KEY) || 0)

  return !expiresAt || !Number.isFinite(expiresAt) || Date.now() > expiresAt
}

const refreshSessionExpiration = () => {
  setStorageItem(SESSION_EXPIRES_AT_KEY, String(Date.now() + SESSION_TTL_MS))
}

export const getMetricSessionId = () => {
  if (!canUseBrowser()) return createSessionId()

  const existing = getStorageItem(SESSION_KEY)

  if (existing && !isSessionExpired()) {
    refreshSessionExpiration()
    return safeString(existing, 128)
  }

  const next = createSessionId()

  setStorageItem(SESSION_KEY, next)
  refreshSessionExpiration()

  return next
}

export const resetMetricSession = () => {
  removeStorageItem(SESSION_KEY)
  removeStorageItem(SESSION_EXPIRES_AT_KEY)

  return getMetricSessionId()
}

const getStoredAttribution = () => {
  const stored = safeJsonParse(getStorageItem(ATTRIBUTION_KEY), null)

  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}

  const expiresAt = Number(stored.expiresAt || 0)

  if (!expiresAt || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    removeStorageItem(ATTRIBUTION_KEY)
    return {}
  }

  return sanitizeObject(stored.value || {})
}

const persistAttribution = attribution => {
  const value = sanitizeObject(attribution)
  const hasAttribution = Object.values(value).some(Boolean)

  if (!hasAttribution) return

  setStorageItem(
    ATTRIBUTION_KEY,
    JSON.stringify({
      value,
      expiresAt: Date.now() + ATTRIBUTION_TTL_MS,
    }),
  )
}

const getAttribution = () => {
  if (!canUseBrowser()) return {}

  try {
    const params = new window.URLSearchParams(window.location.search)

    const current = {
      utmSource: safeString(params.get('utm_source') || '', 120),
      utmMedium: safeString(params.get('utm_medium') || '', 120),
      utmCampaign: safeString(params.get('utm_campaign') || '', 160),
      utmContent: safeString(params.get('utm_content') || '', 160),
      utmTerm: safeString(params.get('utm_term') || '', 160),
    }

    const hasCurrentAttribution = Object.values(current).some(Boolean)

    if (hasCurrentAttribution) {
      persistAttribution(current)
      return current
    }

    return getStoredAttribution()
  } catch {
    return getStoredAttribution()
  }
}

const getDevice = () => {
  if (!canUseBrowser()) return {}

  return {
    language: safeString(window.navigator?.language || '', 40),
    platform: safeString(window.navigator?.platform || '', 120),
    viewport: {
      width: safePositiveNumber(window.innerWidth || 0),
      height: safePositiveNumber(window.innerHeight || 0),
    },
  }
}

const getCurrentPath = () => {
  if (!canUseBrowser()) return ''

  return safeString(
    `${window.location.pathname}${window.location.search}`,
    1000,
  )
}

const getCurrentReferrer = () => {
  if (typeof document === 'undefined') return ''

  return safeString(document.referrer || '', 1000)
}

const getTenantDomain = () => {
  if (!canUseBrowser()) return ''

  return safeString(window.location.host || '', 180)
}

const sanitizeArray = (value, depth = 0) => {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, MAX_ARRAY_LENGTH)
    .map(item => sanitizeMetricValue(item, depth + 1))
}

function sanitizeObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  if (depth > MAX_METADATA_DEPTH) return {}

  return Object.entries(value)
    .slice(0, MAX_METADATA_KEYS)
    .reduce((acc, [key, entryValue]) => {
      const safeKey = safeString(key, 80)

      if (!safeKey) return acc

      acc[safeKey] = sanitizeMetricValue(entryValue, depth + 1)
      return acc
    }, {})
}

function sanitizeMetricValue(value, depth = 0) {
  if (value === undefined || value === null) return null

  if (typeof value === 'string') return safeString(value)
  if (typeof value === 'number') return safeNumber(value)
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return sanitizeArray(value, depth + 1)
  if (typeof value === 'object') return sanitizeObject(value, depth + 1)

  return safeString(value)
}

const sanitizeItems = items => {
  if (!Array.isArray(items)) return []

  return items.slice(0, MAX_ARRAY_LENGTH).map(item => ({
    productId: safeString(
      item?.productId || item?.id || item?.item_id || '',
      120,
    ),
    title: safeString(item?.title || item?.name || item?.item_name || '', 180),
    sku: safeString(item?.sku || '', 120),
    quantity: safePositiveNumber(item?.quantity),
    price: safeNumber(item?.price),
    subtotal: safeNumber(item?.subtotal),
  }))
}

const normalizeCommerce = commerce => {
  const safeCommerce = sanitizeObject(commerce)

  return {
    ...safeCommerce,
    cartValue: safePositiveNumber(commerce?.cartValue),
    orderValue: safePositiveNumber(commerce?.orderValue),
    discountValue: safePositiveNumber(commerce?.discountValue),
    shippingValue: safePositiveNumber(commerce?.shippingValue),
    taxValue: safePositiveNumber(commerce?.taxValue),
    itemsCount: safePositiveNumber(commerce?.itemsCount),
  }
}

const normalizeEvent = event => {
  const eventType = safeString(event?.eventType, 100)

  const normalized = {
    ...sanitizeObject(event),
    eventId: safeString(event?.eventId || createEventId(eventType), 180),
    source: SOURCE,
    eventType,
    sessionId: safeString(event?.sessionId || getMetricSessionId(), 128),
    tenantDomain: safeString(event?.tenantDomain || getTenantDomain(), 180),
    path: safeString(event?.path || getCurrentPath(), 1000),
    referrer: safeString(event?.referrer ?? getCurrentReferrer(), 1000),
    attribution: {
      ...getAttribution(),
      ...sanitizeObject(event?.attribution),
    },
    device: {
      ...getDevice(),
      ...sanitizeObject(event?.device),
    },
    occurredAt: safeString(event?.occurredAt || new Date().toISOString(), 80),
  }

  if (event?.userId) normalized.userId = safeString(event.userId, 120)
  if (event?.productId) normalized.productId = safeString(event.productId, 120)
  if (event?.cartId) normalized.cartId = safeString(event.cartId, 120)
  if (event?.orderId) normalized.orderId = safeString(event.orderId, 180)
  if (event?.paymentId) normalized.paymentId = safeString(event.paymentId, 180)
  if (event?.searchQuery)
    normalized.searchQuery = safeString(event.searchQuery, 160)
  if (event?.category) normalized.category = safeString(event.category, 160)
  if (event?.value !== undefined) normalized.value = safeNumber(event.value)
  if (event?.currency)
    normalized.currency = safeString(event.currency, 12).toUpperCase()
  if (event?.quantity !== undefined)
    normalized.quantity = safePositiveNumber(event.quantity)
  if (event?.items) normalized.items = sanitizeItems(event.items)
  if (event?.commerce) normalized.commerce = normalizeCommerce(event.commerce)
  if (event?.metadata) normalized.metadata = sanitizeObject(event.metadata)

  return normalized
}

const metricsRequestConfig = timeout => ({
  skipAuthRefresh: true,
  skipCsrf: true,
  skipCsrfToken: true,
  skipCsrfRetry: true,
  timeout,
})

const logMetricError = ({ label, error, eventType, count }) => {
  if (!isDebugEnabled()) return

  console.warn(label, {
    eventType,
    count,
    message: error?.message,
    status: error?.response?.status,
    code: error?.response?.data?.code,
  })
}

export const trackUserMetric = async event => {
  if (!canUseBrowser()) return null
  if (!event?.eventType || !isValidMetricEventType(event.eventType)) return null

  try {
    return await api.post(
      '/metrics/events',
      normalizeEvent(event),
      metricsRequestConfig(REQUEST_TIMEOUT_MS),
    )
  } catch (error) {
    logMetricError({
      label: '[UserMetrics] Evento no registrado',
      error,
      eventType: event.eventType,
    })

    return null
  }
}

export const trackUserMetricBatch = async events => {
  if (!canUseBrowser()) return null

  const validEvents = (events || []).filter(event => {
    return event?.eventType && isValidMetricEventType(event.eventType)
  })

  if (validEvents.length === 0) return null

  try {
    return await api.post(
      '/metrics/events',
      {
        events: validEvents.slice(0, MAX_ARRAY_LENGTH).map(normalizeEvent),
      },
      metricsRequestConfig(BATCH_REQUEST_TIMEOUT_MS),
    )
  } catch (error) {
    logMetricError({
      label: '[UserMetrics] Batch no registrado',
      error,
      count: validEvents.length,
    })

    return null
  }
}

export const trackPageView = (metadata = {}) => {
  return trackUserMetric({
    eventType: USER_METRIC_EVENTS.PAGE_VIEW,
    metadata,
  })
}

export const trackProductView = ({
  productId,
  value,
  currency,
  metadata,
} = {}) => {
  return trackUserMetric({
    eventType: USER_METRIC_EVENTS.PRODUCT_VIEW,
    productId,
    value,
    currency,
    metadata,
  })
}

export const trackAddToCart = ({
  productId,
  quantity,
  value,
  currency,
  items,
  metadata,
} = {}) => {
  return trackUserMetric({
    eventType: USER_METRIC_EVENTS.ADD_TO_CART,
    productId,
    quantity,
    value,
    currency,
    items,
    metadata,
  })
}

export const trackPurchase = ({
  orderId,
  paymentId,
  value,
  currency,
  items,
  commerce,
  metadata,
} = {}) => {
  return trackUserMetric({
    eventType: USER_METRIC_EVENTS.PURCHASE,
    orderId,
    paymentId,
    value,
    currency,
    items,
    commerce,
    metadata,
  })
}

export default {
  trackUserMetric,
  trackUserMetricBatch,
  trackPageView,
  trackProductView,
  trackAddToCart,
  trackPurchase,
  getMetricSessionId,
  resetMetricSession,
  events: USER_METRIC_EVENTS,
}
