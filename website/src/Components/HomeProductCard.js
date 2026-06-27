// 📁 website/src/components/HomeProductCard.jsx
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import PropTypes from 'prop-types'
import ReactStars from 'react-stars'
import { useNavigate } from 'react-router-dom'
import { Card, CardMedia, CardContent, Typography, Box } from '@mui/material'
import { useSelector } from 'react-redux'

import {
  formatCurrency,
  getActiveThemeConfig,
  getProductThemeConfig,
  getProductImage,
  getProductRouteId,
  getThemeColors,
} from '@utils/themeRuntime'

import {
  trackUserMetric,
  USER_METRIC_EVENTS,
} from '../services/userMetricsService'

const FALLBACK_IMAGE = '/assets/images/placeholder.png'

const getProductId = item => {
  return item?._id || item?.id || item?.productId || item?.slug || ''
}

const getProductTitle = item => {
  return item?.title || item?.name || 'Producto'
}

const getProductBrand = item => {
  return item?.brand || item?.marca || item?.manufacturer || 'General'
}

const getProductCategory = item => {
  return item?.category || item?.categoryName || item?.categoria || ''
}

const getProductPrice = item => {
  return Number(item?.finalPrice ?? item?.price ?? item?.precio ?? 0) || 0
}

const normalizeAspectRatio = value => {
  const clean = String(value || '').trim()

  if (!clean) return '1 / 1'

  return clean.replace(':', ' / ')
}

const getHoverTransform = effect => {
  const effects = {
    none: 'none',
    zoom: 'scale(1.02)',
    lift: 'translateY(-5px)',
    border: 'none',
    scale: 'scale(1.02)',
  }

  return effects[effect] || effects.lift
}

/**
 * HomeProductCard Producción
 * - Compatible con theme runtime multitenant.
 * - Registra product_impression y product_click.
 * - Evita impresiones duplicadas por React StrictMode.
 * - Usa finalPrice cuando exista.
 * - Accesible con teclado.
 */
const HomeProductCard = React.memo(({ data, placement = 'home_product_card' }) => {
  const navigate = useNavigate()
  const impressionTrackedRef = useRef('')

  const themeState = useSelector(state => state.theme) || {}

  const activeConfig = useMemo(
    () => getActiveThemeConfig(themeState),
    [themeState],
  )

  const themeColors = useMemo(
    () => getThemeColors(activeConfig),
    [activeConfig],
  )

  const productTheme = useMemo(
    () => getProductThemeConfig(activeConfig),
    [activeConfig],
  )

  const item = useMemo(() => {
    if (Array.isArray(data)) return data[0] || null
    return data || null
  }, [data])

  const productId = useMemo(() => getProductId(item), [item])
  const routeId = useMemo(() => (item ? getProductRouteId(item) : ''), [item])
  const title = useMemo(() => getProductTitle(item), [item])
  const brand = useMemo(() => getProductBrand(item), [item])
  const category = useMemo(() => getProductCategory(item), [item])
  const productPrice = useMemo(() => getProductPrice(item), [item])
  const imageUrl = useMemo(() => {
    return item ? getProductImage(item) || FALLBACK_IMAGE : FALLBACK_IMAGE
  }, [item])

  const aspectRatio = normalizeAspectRatio(productTheme.imageAspectRatio)
  const hoverTransform = getHoverTransform(productTheme.hoverEffect)

  const cardBackground = themeColors.cardBackground
  const cardBorder = themeColors.cardBorder
  const cardText = themeColors.cardText
  const cardMutedText = themeColors.cardMutedText
  const cardPrice = themeColors.cardPrice

  const metricPayload = useMemo(() => ({
    productId,
    value: productPrice,
    category,
    currency: item?.currency || activeConfig?.currency || 'ARS',
    metadata: {
      title,
      brand,
      slug: item?.slug || '',
      routeId,
      placement,
    },
  }), [
    productId,
    productPrice,
    category,
    item?.currency,
    item?.slug,
    activeConfig?.currency,
    title,
    brand,
    routeId,
    placement,
  ])

  const handleCardClick = useCallback(() => {
    if (!item || !routeId) return

    trackUserMetric({
      eventType: USER_METRIC_EVENTS.PRODUCT_CLICK,
      ...metricPayload,
    })

    navigate(`/product/${routeId}`)
  }, [item, routeId, metricPayload, navigate])

  const handleKeyDown = useCallback(event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleCardClick()
    }
  }, [handleCardClick])

  useEffect(() => {
    if (!item || !productId) return

    const impressionKey = `${productId}:${routeId}:${placement}`

    if (impressionTrackedRef.current === impressionKey) return

    impressionTrackedRef.current = impressionKey

    trackUserMetric({
      eventType: USER_METRIC_EVENTS.PRODUCT_IMPRESSION,
      ...metricPayload,
    })
  }, [item, productId, routeId, placement, metricPayload])

  if (!item) return null

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Ver producto ${title}`}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      sx={{
        width: '100%',
        maxWidth: 260,
        borderRadius: 4,
        overflow: 'hidden',
        margin: '0 auto',
        backgroundColor: cardBackground,
        border: `1px solid ${cardBorder}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
        cursor: routeId ? 'pointer' : 'default',
        outline: 'none',
        '&:hover': {
          transform: routeId ? hoverTransform : 'none',
          boxShadow: routeId
            ? '0 8px 20px rgba(0,0,0,0.12)'
            : '0 4px 12px rgba(0,0,0,0.08)',
          borderColor:
            productTheme.hoverEffect === 'border'
              ? themeColors.actionPrimary
              : cardBorder,
        },
        '&:focus-visible': {
          boxShadow: `0 0 0 3px ${themeColors.actionPrimary || '#111827'}33`,
          borderColor: themeColors.actionPrimary || cardBorder,
        },
      }}
    >
      <Box
        sx={{
          position: 'relative',
          aspectRatio,
          bgcolor: cardBackground,
        }}
      >
        <CardMedia
          component="img"
          image={imageUrl}
          alt={title}
          loading="lazy"
          onError={event => {
            event.currentTarget.src = FALLBACK_IMAGE
          }}
          sx={{
            position: 'absolute',
            top: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            p: 1,
          }}
        />
      </Box>

      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography
          variant="caption"
          sx={{
            color: cardMutedText,
            textTransform: 'uppercase',
            letterSpacing: 1,
            fontWeight: 600,
            display: 'block',
          }}
        >
          {brand}
        </Typography>

        <Typography
          variant="subtitle1"
          title={title}
          sx={{
            mt: 0.5,
            mb: 1,
            fontWeight: 600,
            fontSize: '1rem',
            lineHeight: 1.2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.4em',
            color: cardText,
          }}
        >
          {title}
        </Typography>

        {productTheme.showRating !== false && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <ReactStars
              count={5}
              size={18}
              value={Number(item.totalrating) || 0}
              edit={false}
              color2={themeColors.warning}
            />
          </Box>
        )}

        {productTheme.showPrice !== false && (
          <Typography
            variant="h6"
            sx={{
              fontWeight: 800,
              color: cardPrice,
              fontSize: '1.15rem',
            }}
          >
            {formatCurrency(productPrice, activeConfig)}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
})

HomeProductCard.displayName = 'HomeProductCard'

HomeProductCard.propTypes = {
  data: PropTypes.oneOfType([
    PropTypes.array,
    PropTypes.object,
  ]).isRequired,
  placement: PropTypes.string,
}

export default HomeProductCard