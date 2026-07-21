// 📁 website/src/services/aiAgentService.js
import api from '@utils/axiosConfig'

const STORAGE_NAMESPACE = process.env.REACT_APP_WEBCHAT_STORAGE_NAMESPACE || 'commerce_ai_webchat'

const AI_WEBCHAT_SESSION_PREFIX = `${STORAGE_NAMESPACE}_session`
const AI_WEBCHAT_VISITOR_PREFIX = `${STORAGE_NAMESPACE}_visitor`
const AI_WEBCHAT_PROFILE_PREFIX = `${STORAGE_NAMESPACE}_profile`

const clean = value => String(value || '').trim()

const hasBrowserStorage = () => {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

const hasSessionStorage = () => {
  return typeof window !== 'undefined' && Boolean(window.sessionStorage)
}

const getTenantScope = () => {
  if (typeof window === 'undefined') return 'default'

  return clean(window.location.host || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
}

const createId = prefix => {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

const getStorageKey = key => `${key}_${getTenantScope()}`

const getLocalStorageValue = key => {
  if (!hasBrowserStorage()) return ''

  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

const setLocalStorageValue = (key, value) => {
  if (!hasBrowserStorage()) return

  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage deshabilitado o lleno.
  }
}

const removeLocalStorageValue = key => {
  if (!hasBrowserStorage()) return

  try {
    localStorage.removeItem(key)
  } catch {
    // Storage deshabilitado.
  }
}

const getSessionStorageValue = key => {
  if (!hasSessionStorage()) return ''

  try {
    return sessionStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

const setSessionStorageValue = (key, value) => {
  if (!hasSessionStorage()) return

  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Storage deshabilitado o lleno.
  }
}

const removeSessionStorageValue = key => {
  if (!hasSessionStorage()) return

  try {
    sessionStorage.removeItem(key)
  } catch {
    // Storage deshabilitado.
  }
}

export const normalizeAiCustomerProfile = profile => {
  const source = profile || {}

  return {
    name: clean(source.name || source.customerName),
    email: clean(source.email || source.customerEmail).toLowerCase(),
    phone: clean(source.phone || source.customerPhone),
  }
}

export const getAiWebchatCustomerProfile = () => {
  const key = getStorageKey(AI_WEBCHAT_PROFILE_PREFIX)
  const raw = getLocalStorageValue(key)

  if (!raw) return { name: '', email: '', phone: '' }

  try {
    return normalizeAiCustomerProfile(JSON.parse(raw))
  } catch {
    return { name: '', email: '', phone: '' }
  }
}

export const saveAiWebchatCustomerProfile = profile => {
  const current = getAiWebchatCustomerProfile()
  const next = normalizeAiCustomerProfile({ ...current, ...(profile || {}) })

  const key = getStorageKey(AI_WEBCHAT_PROFILE_PREFIX)
  setLocalStorageValue(key, JSON.stringify(next))

  return next
}

export const clearAiWebchatCustomerProfile = () => {
  const key = getStorageKey(AI_WEBCHAT_PROFILE_PREFIX)
  removeLocalStorageValue(key)
}

export const extractAiCustomerDataFromText = text => {
  const value = clean(text)

  if (!value) return { name: '', email: '', phone: '' }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)

  const phoneMatch = value.match(
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/,
  )

  const nameMatch = value.match(
    /\b(?:soy|me llamo|mi nombre es|mi nombre|nombre es)\s+([a-záéíóúñü]+(?:\s+[a-záéíóúñü]+){0,3})/i,
  )

  return normalizeAiCustomerProfile({
    name: nameMatch?.[1] || '',
    email: emailMatch?.[0] || '',
    phone: phoneMatch?.[0]?.replace(/[^\d+]/g, '') || '',
  })
}

export const mergeAiCustomerProfileFromMessage = ({ message, profile } = {}) => {
  const extracted = extractAiCustomerDataFromText(message)
  const current = normalizeAiCustomerProfile(profile || getAiWebchatCustomerProfile())

  return saveAiWebchatCustomerProfile({
    name: current.name || extracted.name,
    email: current.email || extracted.email,
    phone: current.phone || extracted.phone,
  })
}

export const getAiWebchatVisitorId = () => {
  const key = getStorageKey(AI_WEBCHAT_VISITOR_PREFIX)
  let visitorId = getLocalStorageValue(key)

  if (!visitorId) {
    visitorId = createId('visitor')
    setLocalStorageValue(key, visitorId)
  }

  return visitorId
}

export const getAiWebchatSessionId = () => {
  const key = getStorageKey(AI_WEBCHAT_SESSION_PREFIX)
  let sessionId = getSessionStorageValue(key)

  if (!sessionId) {
    sessionId = createId('session')
    setSessionStorageValue(key, sessionId)
  }

  return sessionId
}

export const resetAiWebchatSession = () => {
  const key = getStorageKey(AI_WEBCHAT_SESSION_PREFIX)
  removeSessionStorageValue(key)

  return getAiWebchatSessionId()
}

export const clearAiWebchatIdentity = ({ clearProfile = false } = {}) => {
  resetAiWebchatSession()

  if (clearProfile) {
    clearAiWebchatCustomerProfile()
  }
}

const getTenantDomain = () => {
  if (typeof window === 'undefined') return ''
  return window.location.hostname || ''
}

const getCurrentPath = () => {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname || ''}${window.location.search || ''}`
}

export const normalizeAiWebchatResponse = response => {
  const payload = response?.data?.data || response?.data || response || {}

  const customer = normalizeAiCustomerProfile(payload?.customer || payload?.lead?.customer || {})

  if (customer.name || customer.email || customer.phone) {
    saveAiWebchatCustomerProfile(customer)
  }

  return {
    reply: payload?.reply || payload?.message || payload?.content || payload?.answer || '',
    intent: payload?.intent || '',
    leadScore: payload?.leadScore ?? payload?.score ?? null,
    actions: Array.isArray(payload?.actions) ? payload.actions : [],
    handoffRequired: Boolean(payload?.handoffRequired),
    conversationId: payload?.conversationId || null,
    sessionId: payload?.sessionId || '',
    visitorId: payload?.visitorId || '',
    externalUserId: payload?.externalUserId || '',
    customer,
    lead: payload?.lead || null,
  }
}

export const trackAiWebchatEvent = async ({
  type,
  actionType = '',
  conversationId = '',
  externalUserId = '',
  productId = '',
  couponCode = '',
  value = 0,
  label = '',
  url = '',
  intent = '',
  leadScore = null,
  rawAction = null,
} = {}) => {
  if (!type) return null

  const visitorId = getAiWebchatVisitorId()
  const sessionId = getAiWebchatSessionId()
  const customer = getAiWebchatCustomerProfile()

  try {
    const { data } = await api.post('/ai-webchat/event', {
      type,
      actionType,
      conversationId,
      externalUserId,
      productId,
      couponCode,
      value,
      label,
      url,
      intent,
      leadScore,
      rawAction,
      sessionId,
      visitorId,
      tenantDomain: getTenantDomain(),
      path: getCurrentPath(),
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
    })

    return data
  } catch (error) {
    console.warn('[AI_WEBCHAT_EVENT_ERROR]', {
      type,
      message: error?.message,
    })

    return null
  }
}

export const sendAiWebchatMessage = async ({
  message,
  customerName = '',
  customerEmail = '',
  customerPhone = '',
  newConversation = false,
} = {}) => {
  const cleanMessage = clean(message)

  if (!cleanMessage) {
    throw new Error('message requerido')
  }

  const sessionId = newConversation ? resetAiWebchatSession() : getAiWebchatSessionId()

  const visitorId = getAiWebchatVisitorId()

  const mergedProfile = mergeAiCustomerProfileFromMessage({
    message: cleanMessage,
    profile: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    },
  })

  const { data } = await api.post('/ai-webchat/message', {
    message: cleanMessage,
    sessionId,
    visitorId,
    externalUserId: visitorId,
    customerName: mergedProfile.name,
    customerEmail: mergedProfile.email,
    customerPhone: mergedProfile.phone,
    tenantDomain: getTenantDomain(),
    path: getCurrentPath(),
  })

  return data
}

export default {
  getAiWebchatVisitorId,
  getAiWebchatSessionId,
  getAiWebchatCustomerProfile,
  saveAiWebchatCustomerProfile,
  clearAiWebchatCustomerProfile,
  clearAiWebchatIdentity,
  extractAiCustomerDataFromText,
  mergeAiCustomerProfileFromMessage,
  normalizeAiWebchatResponse,
  resetAiWebchatSession,
  sendAiWebchatMessage,
  trackAiWebchatEvent,
}
