// 📁 website/src/Hooks/useUserMetrics.js
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import {
  trackUserMetric,
  USER_METRIC_EVENTS,
} from '../services/userMetricsService'

const DEFAULT_EXCLUDED_PATHS = ['/theme-preview']

const getDocumentTitle = () => {
  if (typeof document === 'undefined') return ''
  return document.title || ''
}

const normalizePath = location => {
  if (!location) return '/'
  return `${location.pathname || '/'}${location.search || ''}`
}

const getProductIdOrSlugFromPath = pathname => {
  const cleanPath = String(pathname || '').trim()

  if (!cleanPath.startsWith('/product/')) return ''
  if (cleanPath === '/product') return ''

  const rawValue = cleanPath.replace(/^\/product\//, '').split('/')[0]

  try {
    return decodeURIComponent(rawValue)
  } catch {
    return rawValue
  }
}

const shouldIgnorePath = (pathname, excludedPaths = []) => {
  const cleanPath = String(pathname || '').trim()

  return excludedPaths.some(path => {
    if (typeof path === 'function') {
      return path(cleanPath)
    }

    return cleanPath === path || cleanPath.startsWith(`${path}/`)
  })
}

const getProductId = (product, payload = {}) => {
  return String(
    product?._id ||
      product?.id ||
      product?.productId ||
      payload?.productId ||
      product?.slug ||
      '',
  ).trim()
}

const getProductTitle = product => {
  return product?.title || product?.name || ''
}

const getProductSlug = product => {
  return product?.slug || ''
}

const getProductPrice = (product, payload = {}) => {
  const value = payload.value ?? product?.finalPrice ?? product?.price ?? 0
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

const getProductCurrency = (product, payload = {}) => {
  return String(payload.currency || product?.currency || 'ARS').trim().toUpperCase()
}

export const useUserMetrics = ({
  trackPageViews = true,
  trackProductViews = true,
  excludedPaths = DEFAULT_EXCLUDED_PATHS,
} = {}) => {
  const location = useLocation()

  const lastPageRef = useRef('')
  const lastProductViewRef = useRef('')

  const excludedPathList = useMemo(() => {
    return Array.isArray(excludedPaths) ? excludedPaths : DEFAULT_EXCLUDED_PATHS
  }, [excludedPaths])

  const track = useCallback((eventType, payload = {}) => {
    if (!eventType) return null

    return trackUserMetric({
      ...payload,
      eventType,
    })
  }, [])

  const trackEvent = useCallback(
    (eventType, payload = {}) => {
      return track(eventType, payload)
    },
    [track],
  )

  const trackProductClick = useCallback(
    (product, payload = {}) => {
      const productId = getProductId(product, payload)

      if (!productId) return null

      return track(USER_METRIC_EVENTS.PRODUCT_CLICK, {
        ...payload,
        productId,
        value: getProductPrice(product, payload),
        currency: getProductCurrency(product, payload),
        path: payload.path || normalizePath(location),
        metadata: {
          productTitle: getProductTitle(product),
          productSlug: getProductSlug(product),
          ...(payload.metadata || {}),
        },
      })
    },
    [location, track],
  )

  const trackAddToCart = useCallback(
    (product, payload = {}) => {
      const productId = getProductId(product, payload)

      if (!productId) return null

      const quantity = Number(payload.quantity || 1)
      const value = getProductPrice(product, payload)

      return track(USER_METRIC_EVENTS.ADD_TO_CART, {
        ...payload,
        productId,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        value,
        currency: getProductCurrency(product, payload),
        path: payload.path || normalizePath(location),
        metadata: {
          productTitle: getProductTitle(product),
          productSlug: getProductSlug(product),
          variantId: payload.variantId || '',
          variantSku: payload.variantSku || '',
          ...(payload.metadata || {}),
        },
      })
    },
    [location, track],
  )

  const trackRemoveFromCart = useCallback(
    (product, payload = {}) => {
      const productId = getProductId(product, payload)

      if (!productId) return null

      const quantity = Number(payload.quantity || 1)
      const value = getProductPrice(product, payload)

      return track(USER_METRIC_EVENTS.REMOVE_FROM_CART, {
        ...payload,
        productId,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        value,
        currency: getProductCurrency(product, payload),
        path: payload.path || normalizePath(location),
        metadata: {
          productTitle: getProductTitle(product),
          productSlug: getProductSlug(product),
          variantId: payload.variantId || '',
          variantSku: payload.variantSku || '',
          ...(payload.metadata || {}),
        },
      })
    },
    [location, track],
  )

  const trackWishlistAdd = useCallback(
    (product, payload = {}) => {
      const productId = getProductId(product, payload)

      if (!productId) return null

      return track(USER_METRIC_EVENTS.WISHLIST_ADD, {
        ...payload,
        productId,
        path: payload.path || normalizePath(location),
        metadata: {
          productTitle: getProductTitle(product),
          productSlug: getProductSlug(product),
          ...(payload.metadata || {}),
        },
      })
    },
    [location, track],
  )

  const trackWishlistRemove = useCallback(
    (product, payload = {}) => {
      const productId = getProductId(product, payload)

      if (!productId) return null

      return track(USER_METRIC_EVENTS.WISHLIST_REMOVE, {
        ...payload,
        productId,
        path: payload.path || normalizePath(location),
        metadata: {
          productTitle: getProductTitle(product),
          productSlug: getProductSlug(product),
          ...(payload.metadata || {}),
        },
      })
    },
    [location, track],
  )

  useEffect(() => {
    const pathname = location.pathname || '/'
    const path = normalizePath(location)

    if (!trackPageViews) return
    if (shouldIgnorePath(pathname, excludedPathList)) return
    if (lastPageRef.current === path) return

    lastPageRef.current = path

    track(USER_METRIC_EVENTS.PAGE_VIEW, {
      path,
      metadata: {
        title: getDocumentTitle(),
      },
    })
  }, [location, track, trackPageViews, excludedPathList])

  useEffect(() => {
    if (!trackProductViews) return

    const pathname = location.pathname || '/'
    const path = normalizePath(location)

    if (shouldIgnorePath(pathname, excludedPathList)) return

    const productIdOrSlug = getProductIdOrSlugFromPath(pathname)

    if (!productIdOrSlug) return

    const productViewKey = `${path}::${productIdOrSlug}`

    if (lastProductViewRef.current === productViewKey) return

    lastProductViewRef.current = productViewKey

    track(USER_METRIC_EVENTS.PRODUCT_VIEW, {
      productId: productIdOrSlug,
      path,
      metadata: {
        productPath: productIdOrSlug,
        title: getDocumentTitle(),
      },
    })
  }, [location, track, trackProductViews, excludedPathList])

  return {
    track,
    trackEvent,
    trackProductClick,
    trackAddToCart,
    trackRemoveFromCart,
    trackWishlistAdd,
    trackWishlistRemove,
    events: USER_METRIC_EVENTS,
  }
}

export default useUserMetrics