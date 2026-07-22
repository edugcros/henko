// 📁 website/src/utils/aiCartActionUtils.js

const STORAGE_NAMESPACE =
  process.env.REACT_APP_AI_STORAGE_NAMESPACE || 'commerce_ai'

const clean = value => String(value || '').trim()

const getTenantScope = () => {
  if (typeof window === 'undefined') return 'default'

  return clean(window.location.host || 'default')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')
}

export const AI_PENDING_CART_ACTION_KEY = `${STORAGE_NAMESPACE}_pending_cart_action_${getTenantScope()}`

const canUseLocalStorage = () => {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export const savePendingAiCartAction = action => {
  if (!action || !canUseLocalStorage()) return

  try {
    localStorage.setItem(AI_PENDING_CART_ACTION_KEY, JSON.stringify(action))
  } catch {
    // Storage deshabilitado o lleno.
  }
}

export const readPendingAiCartAction = () => {
  if (!canUseLocalStorage()) return null

  try {
    const raw = localStorage.getItem(AI_PENDING_CART_ACTION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const clearPendingAiCartAction = () => {
  if (!canUseLocalStorage()) return

  try {
    localStorage.removeItem(AI_PENDING_CART_ACTION_KEY)
  } catch {
    // Storage deshabilitado.
  }
}

export const normalizeAiCartAction = action => {
  if (!action || action.type !== 'add_to_cart') return null

  const quantity = Math.max(Number(action.quantity || 1), 1)

  return {
    type: 'add_to_cart',
    productId: clean(action.productId || action.id) || null,
    variantId: clean(action.variantId) || null,
    variantSku: clean(action.variantSku || action.variantSKU || action.sku),
    quantity,
    title: clean(action.title),
    price: Number(action.price || 0),
    stock: Number(action.stock || 0),
    slug: clean(action.slug),
    url: clean(action.url),
    selectedAttributes:
      action.selectedAttributes ||
      action.variantAttributes ||
      action.attributes ||
      {},
  }
}

export const getAiEventNamespace = () => {
  return process.env.REACT_APP_AI_EVENT_NAMESPACE || 'commerce:ai'
}

export const getAiAddToCartEventName = () => {
  return `${getAiEventNamespace()}:add-to-cart`
}

export const getAiCartActionResultEventName = () => {
  return `${getAiEventNamespace()}:cart-action-result`
}

export const dispatchAiAddToCartEvent = action => {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new window.CustomEvent(getAiAddToCartEventName(), {
      detail: action,
    }),
  )
}

export const dispatchAiCartActionResultEvent = detail => {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new window.CustomEvent(getAiCartActionResultEventName(), {
      detail,
    }),
  )
}
