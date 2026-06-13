// 📁 website/src/services/userMetricsService.js
import api from '../Utils/axiosConfig'

const SESSION_KEY = 'henko_metric_session_id'
const SOURCE = 'storefront'

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

const canUseBrowser = () => typeof window !== 'undefined'

const createSessionId = () => {
  if (
    canUseBrowser() &&
    window.crypto &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const getMetricSessionId = () => {
  if (!canUseBrowser()) return createSessionId()

  try {
    const existing = window.localStorage.getItem(SESSION_KEY)
    if (existing) return existing

    const next = createSessionId()
    window.localStorage.setItem(SESSION_KEY, next)

    return next
  } catch {
    return createSessionId()
  }
}

const getAttribution = () => {
  if (!canUseBrowser()) return {}

  try {
    const params = new window.URLSearchParams(window.location.search)

    return {
      utmSource: params.get('utm_source') || '',
      utmMedium: params.get('utm_medium') || '',
      utmCampaign: params.get('utm_campaign') || '',
    }
  } catch {
    return {}
  }
}

const getDevice = () => {
  if (!canUseBrowser()) return {}

  return {
    language: window.navigator?.language || '',
  }
}

const getCurrentPath = () => {
  if (!canUseBrowser()) return ''

  return `${window.location.pathname}${window.location.search}`
}

const getCurrentReferrer = () => {
  if (typeof document === 'undefined') return ''

  return document.referrer || ''
}

const normalizeEvent = event => ({
  ...event,
  source: SOURCE,
  sessionId: event.sessionId || getMetricSessionId(),
  path: event.path || getCurrentPath(),
  referrer: event.referrer ?? getCurrentReferrer(),
  attribution: {
    ...getAttribution(),
    ...(event.attribution || {}),
  },
  device: {
    ...getDevice(),
    ...(event.device || {}),
  },
  occurredAt: event.occurredAt || new Date().toISOString(),
})

export const trackUserMetric = async event => {
  if (!event?.eventType || !canUseBrowser()) return null

  try {
    return await api.post('/metrics/events', normalizeEvent(event), {
      skipAuthRefresh: true,
      skipCsrfRetry: true,
    })
  } catch (error) {
    if (process.env.REACT_APP_DEBUG_API === 'true') {
      console.warn('[UserMetrics] Evento no registrado', {
        eventType: event.eventType,
        message: error?.message,
        status: error?.response?.status,
      })
    }

    return null
  }
}

export const trackUserMetricBatch = async events => {
  const validEvents = (events || []).filter(event => event?.eventType)

  if (validEvents.length === 0 || !canUseBrowser()) return null

  try {
    return await api.post(
      '/metrics/events',
      {
        events: validEvents.map(normalizeEvent),
      },
      {
        skipAuthRefresh: true,
        skipCsrfRetry: true,
      },
    )
  } catch {
    return null
  }
}

export default {
  trackUserMetric,
  trackUserMetricBatch,
  getMetricSessionId,
  events: USER_METRIC_EVENTS,
}
