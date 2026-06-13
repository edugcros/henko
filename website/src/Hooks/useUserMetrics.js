import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import {
  trackUserMetric,
  USER_METRIC_EVENTS,
} from '../services/userMetricsService'

export const useUserMetrics = ({ trackPageViews = true } = {}) => {
  const location = useLocation()
  const lastPageRef = useRef('')

  const track = useCallback((eventType, payload = {}) => {
    return trackUserMetric({
      eventType,
      ...payload,
    })
  }, [])

  useEffect(() => {
    const path = `${location.pathname}${location.search}`

    if (
      !trackPageViews ||
      lastPageRef.current === path ||
      location.pathname === '/theme-preview'
    ) {
      return
    }

    lastPageRef.current = path

    track(USER_METRIC_EVENTS.PAGE_VIEW, {
      path,
      metadata: {
        title: document.title,
      },
    })

    if (
      location.pathname.startsWith('/product/') &&
      location.pathname !== '/product'
    ) {
      const productIdOrSlug = decodeURIComponent(
        location.pathname.replace('/product/', ''),
      )

      track(USER_METRIC_EVENTS.PRODUCT_VIEW, {
        path,
        metadata: {
          productPath: productIdOrSlug,
        },
      })
    }
  }, [location, track, trackPageViews])

  return {
    track,
    events: USER_METRIC_EVENTS,
  }
}

export default useUserMetrics
