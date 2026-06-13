import React, { useEffect, useMemo } from 'react'
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

/**
 * HomeProductCard Optimizado
 * - Utiliza MUI para consistencia visual.
 * - Soporta colores dinámicos del Tenant.
 * - Optimizado con React.memo para listas largas.
 */
const HomeProductCard = React.memo(({ data }) => {
  const navigate = useNavigate()

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

  // Extraemos el primer item con seguridad
  const item = useMemo(() => (Array.isArray(data) ? data[0] : data), [data])

  const imageUrl = item ? getProductImage(item) : ''
  const routeId = item ? getProductRouteId(item) : ''
  const productId = item?._id || item?.id || item?.productId
  const productPrice = Number(item?.finalPrice ?? item?.price) || 0
  const aspectRatio =
    productTheme.imageAspectRatio?.replace(':', ' / ') || '1 / 1'
  const hoverTransform = {
    none: 'none',
    zoom: 'scale(1.02)',
    lift: 'translateY(-5px)',
    border: 'none',
    scale: 'scale(1.02)',
  }[productTheme.hoverEffect || 'lift']
  const cardBackground = themeColors.cardBackground
  const cardBorder = themeColors.cardBorder
  const cardText = themeColors.cardText
  const cardMutedText = themeColors.cardMutedText
  const cardPrice = themeColors.cardPrice

  const handleCardClick = () => {
    trackUserMetric({
      eventType: USER_METRIC_EVENTS.PRODUCT_CLICK,
      productId,
      value: productPrice,
      category: item.category || item.categoryName || '',
      metadata: {
        title: item?.title,
        brand: item?.brand || item?.marca || '',
        placement: 'home_product_card',
      },
    })
    navigate(`/product/${routeId}`)
  }

  useEffect(() => {
    if (!productId) return

    trackUserMetric({
      eventType: USER_METRIC_EVENTS.PRODUCT_IMPRESSION,
      productId,
      value: productPrice,
      category: item?.category || item?.categoryName || '',
      metadata: {
        title: item?.title,
        brand: item?.brand || item?.marca || '',
        placement: 'home_product_card',
      },
    })
  }, [
    productId,
    productPrice,
    item?.category,
    item?.categoryName,
    item?.title,
    item?.brand,
    item?.marca,
  ])

  if (!item) return null

  return (
    <Card
      onClick={handleCardClick}
      sx={{
        width: '100%',
        maxWidth: 260,
        borderRadius: 4, // 16px
        overflow: 'hidden',
        margin: '0 auto',
        backgroundColor: cardBackground,
        border: `1px solid ${cardBorder}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        transition: 'transform 0.3s ease, box-shadow 0.3s ease',
        cursor: 'pointer',
        '&:hover': {
          transform: hoverTransform,
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
          borderColor:
            productTheme.hoverEffect === 'border'
              ? themeColors.actionPrimary
              : cardBorder,
        },
      }}
    >
      {/* Contenedor de Imagen */}
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
          alt={item.title}
          sx={{
            position: 'absolute',
            top: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain', // Mejor que cover para productos
            p: 1,
          }}
        />
      </Box>

      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        {/* Marca */}
        <Typography
          variant="caption"
          sx={{
            color: cardMutedText,
            textTransform: 'uppercase',
            letterSpacing: 1,
            fontWeight: 600,
          }}
        >
          {item.brand || 'General'}
        </Typography>

        {/* Título - Limitado a 2 líneas para no romper el diseño */}
        <Typography
          variant="subtitle1"
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
            minHeight: '2.4em', // Mantiene altura constante
            color: cardText,
          }}
        >
          {item.title}
        </Typography>

        {/* Rating */}
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

        {/* Precio */}
        {productTheme.showPrice !== false && (
          <Typography
            variant="h6"
            sx={{
              fontWeight: 800,
              color: cardPrice,
              fontSize: '1.15rem',
            }}
          >
            {formatCurrency(item.price || 0, activeConfig)}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
})

HomeProductCard.displayName = 'HomeProductCard'

HomeProductCard.propTypes = {
  data: PropTypes.oneOfType([PropTypes.array, PropTypes.object]).isRequired,
}

export default HomeProductCard
