// 📁 website/src/components/HomeProductCard.jsx
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import PropTypes from 'prop-types'
import ReactStars from 'react-stars'
import ReactGA from 'react-ga4'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  IconButton,
  Tooltip,
  Chip,
  Stack,
} from '@mui/material'
import {
  FavoriteBorder as FavoriteBorderIcon,
  Favorite as FavoriteIcon,
  ShoppingCart as ShoppingCartIcon,
  CompareArrows as CompareArrowsIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material'

import {
  selectIsAuthenticated,
  selectWishlistIds,
  toggleWishlist,
} from '@features/user/userSlice'
import { addToCompare } from '@features/compare/compareSlice'
import { addOrUpdateCartItem } from '@features/cart/cartSlice'
import {
  formatCurrency,
  getActiveThemeConfig,
  getCommerceSettings,
  getProductThemeConfig,
  getProductImage,
  getProductRouteId,
  getThemeColors,
} from '@utils/themeRuntime'
import {
  trackUserMetric,
  USER_METRIC_EVENTS,
} from '../services/userMetricsService'

// ==========================================
// CONSTANTES
// ==========================================
const EMPTY_ARRAY = []
const FALLBACK_IMAGE = '/assets/images/placeholder.png'
const TOAST_POSITION = 'bottom-center'
const DEFAULT_MAX_WIDTH = 260
const DEFAULT_PLACEMENT = 'home_product_card'
const IMPRESSION_TRACKING_DEBOUNCE = 500

// ==========================================
// UTILIDADES PRIVADAS
// ==========================================

const safeString = value => String(value || '').trim()

const resolveItem = ({ data, item }) => {
  if (item) return item
  if (Array.isArray(data)) return data[0] || null
  return data || null
}

const normalizeAspectRatio = value => {
  const clean = safeString(value)
  return !clean ? '1 / 1' : clean.replace(':', ' / ')
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

const getToastBaseStyle = colors => ({
  borderRadius: '16px',
  padding: '12px 14px',
  fontSize: '0.95rem',
  fontWeight: 600,
  minHeight: '54px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
  border: `1px solid ${colors.cardBorder || colors.border || '#e5e7eb'}`,
  backdropFilter: 'blur(8px)',
})

const createNotify = colors => ({
  success: (message, options = {}) =>
    toast.success(message, {
      position: TOAST_POSITION,
      autoClose: 2200,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      toastId: options.toastId,
      style: {
        ...getToastBaseStyle(colors),
        background: 'rgba(255,255,255,0.98)',
        color: colors.cardText || colors.text || '#111827',
      },
      progressStyle: {
        background: colors.actionPrimary || colors.primary || '#111827',
      },
    }),

  warning: (message, options = {}) =>
    toast.warning(message, {
      position: TOAST_POSITION,
      autoClose: 2600,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      toastId: options.toastId,
      style: {
        ...getToastBaseStyle(colors),
        background: colors.cardBackground || '#fff',
        color: colors.warning || '#d97706',
        border: `1px solid ${colors.warning || '#d97706'}`,
      },
      progressStyle: {
        background: colors.warning || '#d97706',
      },
    }),

  error: (message, options = {}) =>
    toast.error(message, {
      position: TOAST_POSITION,
      autoClose: 2800,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      toastId: options.toastId,
      style: {
        ...getToastBaseStyle(colors),
        background: colors.cardBackground || '#fff',
        color: colors.error || '#dc2626',
        border: `1px solid ${colors.error || '#dc2626'}`,
      },
      progressStyle: {
        background: colors.error || '#dc2626',
      },
    }),
})

const safeTrackMetric = payload => {
  try {
    trackUserMetric(payload)
  } catch {
    // Las métricas no deben romper la experiencia de compra
  }
}

const stopCardEvent = event => {
  event.preventDefault()
  event.stopPropagation()
}

// ==========================================
// EXTRACTORES DE PRODUCTO (optimizados)
// ==========================================

const getProductId = item => item?._id || item?.id || item?.productId || item?.slug || ''
const getProductTitle = item => item?.title || item?.name || item?.nombre || 'Producto'
const getProductBrand = item => item?.marca || item?.brand || item?.manufacturer || 'Marca'
const getProductCategory = item => item?.category || item?.categoryName || item?.categoria || ''
const getProductPrice = item => Number(item?.finalPrice ?? item?.price ?? item?.precio ?? 0) || 0
const getOriginalPrice = item => Number(item?.originalPrice ?? item?.price ?? item?.precio ?? 0) || 0
const getDiscountPercentage = item => Number(item?.discountPercentage || item?.discount || 0) || 0

const getAvailableStock = item => {
  if (!item) return 0
  if (Array.isArray(item.variants) && item.variants.length > 0) {
    return item.variants
      .filter(v => v?.isActive !== false)
      .reduce((total, v) => total + Number(v?.stock || 0), 0)
  }
  return Number(item.stock ?? item.cantidad ?? 0) || 0
}

const hasProductVariants = item => 
  Boolean(item?.hasVariants || (Array.isArray(item?.variants) && item.variants.length > 0))

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================

/**
 * HomeProductCard: Tarjeta de producto unificada para producción
 *
 * Características:
 * - Tema multitenant con theme runtime
 * - Tracking de impresiones y clicks
 * - Favoritos, comparación, vista rápida
 * - Carrito rápido con descuentos y promociones
 * - Analytics con ReactGA
 * - Accesibilidad completa (teclado, ARIA)
 * - Compatible con props antiguas: data={product} o item={product}
 *
 * @param {Object} data - Producto o array de productos (compatibilidad legacy)
 * @param {Object} item - Producto (alternativa a data)
 * @param {string} placement - Ubicación para analytics
 * @param {number|string} maxWidth - Ancho máximo de la tarjeta
 * @param {boolean} showActions - Mostrar acciones (compara, vista rápida, carrito)
 * @param {boolean} showAddToCart - Mostrar botón "Añadir al carrito"
 */
const HomeProductCard = React.memo(
  ({
    data = null,
    item: itemProp = null,
    placement = DEFAULT_PLACEMENT,
    maxWidth = DEFAULT_MAX_WIDTH,
    showActions = true,
    showAddToCart = undefined,
  }) => {
    const navigate = useNavigate()
    const dispatch = useDispatch()
    const impressionTrackedRef = useRef('')

    // ==========================================
    // SELECTS Y STATE
    // ==========================================

    const item = useMemo(
      () => resolveItem({ data, itemProp }),
      [data, itemProp],
    )

    const themeState = useSelector(state => state.theme) || {}
    const user = useSelector(state => state.user?.user)
    const isAuthenticated = useSelector(selectIsAuthenticated)
    const wishlistIds = useSelector(selectWishlistIds) || EMPTY_ARRAY
    const compareItems = useSelector(state => state.compare?.items) || EMPTY_ARRAY

    // ==========================================
    // THEME Y COLORES
    // ==========================================

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

    const commerceSettings = useMemo(
      () => getCommerceSettings(activeConfig),
      [activeConfig],
    )

    const notify = useMemo(() => createNotify(themeColors), [themeColors])

    // ==========================================
    // DATOS DEL PRODUCTO
    // ==========================================

    const productId = useMemo(() => getProductId(item), [item])
    const routeId = useMemo(() => (item ? getProductRouteId(item) : ''), [item])
    const productImage = useMemo(
      () => (item ? getProductImage(item) || FALLBACK_IMAGE : FALLBACK_IMAGE),
      [item],
    )

    // NO memoizar estos: son strings simples
    const title = getProductTitle(item)
    const brand = getProductBrand(item)
    const category = getProductCategory(item)
    const productPrice = getProductPrice(item)
    const originalPrice = getOriginalPrice(item)
    const discountPercentage = getDiscountPercentage(item)
    const stock = getAvailableStock(item)
    const hasVariants = hasProductVariants(item)

    const hasPromotion = Boolean(
      productTheme.showBadge !== false &&
      item?.hasPromotion &&
      discountPercentage > 0 &&
      productPrice < originalPrice,
    )

    // ==========================================
    // ESTILOS
    // ==========================================

    const aspectRatio = normalizeAspectRatio(productTheme.imageAspectRatio)
    const hoverTransform = getHoverTransform(productTheme.hoverEffect)

    const cardBackground = themeColors.cardBackground || '#fff'
    const cardBorder = themeColors.cardBorder || '#e5e7eb'
    const cardText = themeColors.cardText || '#111827'
    const cardMutedText = themeColors.cardMutedText || '#6b7280'
    const cardPrice = themeColors.cardPrice || themeColors.salePrice || '#111827'
    const actionPrimary = themeColors.actionPrimary || themeColors.primary || '#111827'
    const actionPrimaryText = themeColors.actionPrimaryText || '#fff'

    // ==========================================
    // ESTADO WISHLIST
    // ==========================================

    const isFavorite = useMemo(() => {
      if (!Array.isArray(wishlistIds) || !productId) return false
      return wishlistIds.some(entry => {
        if (typeof entry === 'string') return entry === productId
        if (entry && typeof entry === 'object') {
          return [entry._id, entry.id, entry.productId].some(
            value => value === productId,
          )
        }
        return false
      })
    }, [wishlistIds, productId])

    // ==========================================
    // PAYLOAD DE ANALYTICS
    // ==========================================

    const metricPayload = useMemo(
      () => ({
        productId,
        value: productPrice,
        category,
        currency:
          item?.currency ||
          commerceSettings?.currency ||
          activeConfig?.currency ||
          'ARS',
        metadata: {
          title,
          brand,
          slug: item?.slug || '',
          routeId,
          placement,
        },
      }),
      [
        productId,
        productPrice,
        category,
        item?.currency,
        item?.slug,
        commerceSettings?.currency,
        activeConfig?.currency,
        title,
        brand,
        routeId,
        placement,
      ],
    )

    // ==========================================
    // HANDLERS
    // ==========================================

    const handleNavigate = useCallback(() => {
      if (!item || !routeId) return

      safeTrackMetric({
        eventType: USER_METRIC_EVENTS.PRODUCT_CLICK,
        ...metricPayload,
      })

      navigate(`/product/${routeId}`)
    }, [item, routeId, metricPayload, navigate])

    const handleKeyDown = useCallback(
      event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleNavigate()
        }
      },
      [handleNavigate],
    )

    const trackAddToCart = useCallback(
      product => {
        try {
          const finalPrice = Number(product?.finalPrice ?? product?.price) || 0

          ReactGA.event('add_to_cart', {
            currency: commerceSettings.currency,
            value: finalPrice,
            items: [
              {
                item_id: product?._id || product?.id,
                item_name: getProductTitle(product),
                item_brand: getProductBrand(product),
                item_category: getProductCategory(product),
                price: finalPrice,
                quantity: 1,
              },
            ],
          })
        } catch {
          // Analytics no debe romper la UX
        }
      },
      [commerceSettings.currency],
    )

    const handleWishlist = useCallback(
      async event => {
        stopCardEvent(event)

        if (productTheme.showWishlist === false) return

        if (!user || !isAuthenticated) {
          notify.warning('Debes iniciar sesión para guardar favoritos.', {
            toastId: 'wishlist-login-required',
          })
          return
        }

        try {
          await dispatch(toggleWishlist(productId)).unwrap()
          safeTrackMetric({
            eventType: isFavorite
              ? USER_METRIC_EVENTS.WISHLIST_REMOVE
              : USER_METRIC_EVENTS.WISHLIST_ADD,
            ...metricPayload,
          })
        } catch {
          notify.error('No se pudo actualizar la lista de deseos.', {
            toastId: `wishlist-update-error-${productId}`,
          })
        }
      },
      [
        dispatch,
        isAuthenticated,
        isFavorite,
        metricPayload,
        notify,
        productId,
        productTheme.showWishlist,
        user,
      ],
    )

    const handleCompare = useCallback(
      event => {
        stopCardEvent(event)

        if (productTheme.showCompare === false || !item) return

        dispatch(addToCompare(item))

        safeTrackMetric({
          eventType: USER_METRIC_EVENTS.COMPARE_ADD || 'compare_add',
          ...metricPayload,
        })

        const currentCompareCount = compareItems.length + 1

        if (currentCompareCount > 1) {
          notify.success('Producto agregado. Comparación lista.', {
            toastId: 'compare-ready',
          })
          navigate('/compare-product')
          return
        }

        notify.success('Producto agregado para comparar.', {
          toastId: `compare-added-${productId}`,
        })
      },
      [
        compareItems.length,
        dispatch,
        item,
        metricPayload,
        navigate,
        notify,
        productId,
        productTheme.showCompare,
      ],
    )

    const handleQuickView = useCallback(
      event => {
        stopCardEvent(event)
        handleNavigate()
      },
      [handleNavigate],
    )

    const handleAddToCart = useCallback(
      async event => {
        stopCardEvent(event)

        if (productTheme.showAddToCart === false) return

        if (!user || !isAuthenticated) {
          notify.warning('Por favor, inicia sesión para comprar.', {
            toastId: 'cart-login-required',
          })
          return
        }

        if (hasVariants) {
          notify.warning(
            'Seleccioná las opciones del producto antes de comprar.',
            {
              toastId: `cart-variants-required-${productId}`,
            },
          )
          handleNavigate()
          return
        }

        if (stock <= 0) {
          notify.warning('Este producto está agotado.', {
            toastId: `cart-stock-empty-${productId}`,
          })
          return
        }

        try {
          const cartData = {
            productId,
            tenantId: item.tenantId || null,
            title,
            price: productPrice,
            originalPrice,
            discountPercentage: hasPromotion ? discountPercentage : 0,
            promotionId: item.promotionId || null,
            promotionTitle: item.promotionTitle || null,
            promotionType: item.promotionType || null,
            hasPromotion,
            image: productImage,
            quantity: 1,
            cartKey: `${productId}::base`,
          }

          const resultAction = await dispatch(addOrUpdateCartItem(cartData))

          if (addOrUpdateCartItem.fulfilled.match(resultAction)) {
            trackAddToCart(item)
            safeTrackMetric({
              eventType: USER_METRIC_EVENTS.ADD_TO_CART,
              ...metricPayload,
              quantity: 1,
              items: [
                {
                  productId,
                  title,
                  sku: item.sku || '',
                  quantity: 1,
                  price: productPrice,
                  subtotal: productPrice,
                },
              ],
            })
            notify.success('Producto añadido al carrito.', {
              toastId: `cart-added-${productId}`,
            })
            return
          }

          notify.error('No se pudo añadir el producto al carrito.', {
            toastId: `cart-add-error-${productId}`,
          })
        } catch {
          notify.error('Ocurrió un error al procesar la acción.', {
            toastId: `cart-catch-error-${productId}`,
          })
        }
      },
      [
        dispatch,
        discountPercentage,
        handleNavigate,
        hasPromotion,
        hasVariants,
        isAuthenticated,
        item,
        metricPayload,
        notify,
        originalPrice,
        productId,
        productImage,
        productPrice,
        productTheme.showAddToCart,
        stock,
        title,
        trackAddToCart,
        user,
      ],
    )

    // ==========================================
    // EFECTOS
    // ==========================================

    useEffect(() => {
      if (!item || !productId) return

      const impressionKey = `${productId}:${routeId || ''}:${placement}`
      if (impressionTrackedRef.current === impressionKey) return

      impressionTrackedRef.current = impressionKey

      safeTrackMetric({
        eventType: USER_METRIC_EVENTS.PRODUCT_IMPRESSION,
        ...metricPayload,
      })
    }, [item, productId, routeId, placement, metricPayload])

    // ==========================================
    // RENDER
    // ==========================================

    if (!item || !productId) return null

    const shouldShowActions = showActions !== false
    const shouldShowAddToCart = showAddToCart ?? productTheme.showAddToCart === true

    return (
      <Card
        component="article"
        role="button"
        tabIndex={0}
        aria-label={`Ver producto ${title}`}
        onClick={handleNavigate}
        onKeyDown={handleKeyDown}
        sx={{
          width: '100%',
          maxWidth,
          mx: 'auto',
          my: 1,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          backgroundColor: cardBackground,
          border: `1px solid ${cardBorder}`,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          transition:
            'transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
          cursor: routeId ? 'pointer' : 'default',
          outline: 'none',
          display: 'flex',
          flexDirection: 'column',
          '&:hover': {
            transform: routeId ? hoverTransform : 'none',
            boxShadow: routeId
              ? '0 12px 28px rgba(15,23,42,0.14)'
              : '0 4px 12px rgba(0,0,0,0.08)',
            borderColor:
              productTheme.hoverEffect === 'border'
                ? actionPrimary
                : cardBorder,
            '& .product-card-actions': {
              opacity: 1,
              right: 12,
            },
            '& .product-card-image': {
              transform:
                productTheme.hoverEffect === 'zoom'
                  ? 'scale(1.035)'
                  : 'scale(1.02)',
            },
          },
          '&:focus-visible': {
            boxShadow: `0 0 0 3px ${actionPrimary}33`,
            borderColor: actionPrimary,
          },
        }}
      >
        {/* Botón Favoritos */}
        {productTheme.showWishlist !== false && (
          <Box
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 4,
            }}
          >
            <Tooltip
              title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            >
              <IconButton
                onClick={handleWishlist}
                color="error"
                aria-label={
                  isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'
                }
                sx={{
                  width: 38,
                  height: 38,
                  backgroundColor: 'rgba(255,255,255,0.9)',
                  backdropFilter: 'blur(6px)',
                  border: '1px solid rgba(255,255,255,0.65)',
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.14)',
                  '&:hover': {
                    backgroundColor: '#ffffff',
                  },
                }}
              >
                {isFavorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {/* Badge de Promoción */}
        {hasPromotion && (
          <Chip
            label={`${discountPercentage}% OFF`}
            size="small"
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              zIndex: 4,
              fontWeight: 900,
              bgcolor: themeColors.badgeBackground || actionPrimary,
              color: themeColors.badgeText || actionPrimaryText,
              boxShadow: '0 8px 20px rgba(15,23,42,.12)',
            }}
          />
        )}

        {/* Imagen y Acciones */}
        <Box
          sx={{
            position: 'relative',
            aspectRatio,
            bgcolor: cardBackground,
            borderBottom: `1px solid ${cardBorder}`,
          }}
        >
          <CardMedia
            className="product-card-image"
            component="img"
            image={productImage}
            alt={`Imagen de ${title}`}
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
              p: 1.25,
              transition: 'transform 0.3s ease',
            }}
          />

          {shouldShowActions && (
            <Stack
              className="product-card-actions"
              spacing={1.1}
              sx={{
                position: 'absolute',
                top: '42%',
                right: -48,
                transform: 'translateY(-50%)',
                opacity: 0,
                transition: 'all 0.28s ease',
                zIndex: 4,
              }}
            >
              {productTheme.showCompare !== false && (
                <Tooltip title="Comparar" placement="left">
                  <IconButton
                    onClick={handleCompare}
                    size="small"
                    aria-label="Comparar producto"
                    sx={{
                      bgcolor: cardBackground,
                      color: actionPrimary,
                      boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
                      border: `1px solid ${cardBorder}`,
                      '&:hover': {
                        bgcolor: cardBackground,
                        transform: 'scale(1.04)',
                      },
                    }}
                  >
                    <CompareArrowsIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}

              {productTheme.showQuickView !== false && (
                <Tooltip title="Ver producto" placement="left">
                  <IconButton
                    onClick={handleQuickView}
                    size="small"
                    aria-label="Ver producto"
                    sx={{
                      bgcolor: cardBackground,
                      color: actionPrimary,
                      boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
                      border: `1px solid ${cardBorder}`,
                      '&:hover': {
                        bgcolor: cardBackground,
                        transform: 'scale(1.04)',
                      },
                    }}
                  >
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}

              {shouldShowAddToCart && productTheme.showPrice !== false && (
                <Tooltip
                  title={hasVariants ? 'Elegir opciones' : 'Añadir al carrito'}
                  placement="left"
                >
                  <IconButton
                    onClick={handleAddToCart}
                    size="small"
                    aria-label={
                      hasVariants
                        ? 'Elegir opciones del producto'
                        : 'Añadir al carrito'
                    }
                    sx={{
                      bgcolor: actionPrimary,
                      color: actionPrimaryText,
                      boxShadow: '0 10px 20px rgba(15, 23, 42, 0.18)',
                      '&:hover': {
                        bgcolor: themeColors.actionSecondary || actionPrimary,
                        color:
                          themeColors.actionSecondaryText || actionPrimaryText,
                        transform: 'scale(1.04)',
                      },
                    }}
                  >
                    <ShoppingCartIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          )}
        </Box>

        {/* Contenido: Título, Precio, etc */}
        <CardContent
          sx={{
            p:
              productTheme.cardPadding != null
                ? `${productTheme.cardPadding}px`
                : 2,
            '&:last-child': {
              pb:
                productTheme.cardPadding != null
                  ? `${productTheme.cardPadding}px`
                  : 2,
            },
            flexGrow: 1,
          }}
        >
          {productTheme.showBrand !== false && (
            <Typography
              variant="caption"
              title={brand}
              sx={{
                color: cardMutedText,
                textTransform: 'uppercase',
                letterSpacing: 1,
                fontWeight: 700,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {brand}
            </Typography>
          )}

          <Typography
            variant="subtitle1"
            title={title}
            sx={{
              mt: 0.5,
              mb: productTheme.showRating !== false ? 0.8 : 1,
              fontWeight: 700,
              fontSize: '1rem',
              lineHeight: 1.25,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: '2.5em',
              color: cardText,
            }}
          >
            {title}
          </Typography>

          {productTheme.showCategory === true && category && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mb: 0.8,
                color: cardMutedText,
                fontWeight: 600,
              }}
            >
              {category}
            </Typography>
          )}

          {productTheme.showRating !== false && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <ReactStars
                count={5}
                size={18}
                value={Number(item.totalrating) || 0}
                edit={false}
                color2={themeColors.warning || '#f59e0b'}
              />
            </Box>
          )}

          {productTheme.showPrice !== false && (
            <Box>
              {hasPromotion && (
                <Typography
                  sx={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: cardMutedText,
                    textDecoration: 'line-through',
                    lineHeight: 1.2,
                  }}
                >
                  {formatCurrency(originalPrice, activeConfig)}
                </Typography>
              )}

              <Typography
                variant="h6"
                sx={{
                  fontWeight: 900,
                  color: cardPrice,
                  fontSize: '1.15rem',
                  lineHeight: 1.25,
                }}
              >
                {formatCurrency(productPrice, activeConfig)}
              </Typography>
            </Box>
          )}

          {productTheme.showStock === true && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                mt: 0.75,
                color:
                  stock > 0
                    ? themeColors.success || '#16a34a'
                    : themeColors.error || '#dc2626',
                fontWeight: 700,
              }}
            >
              {stock > 0 ? `${stock} disponibles` : 'Agotado'}
            </Typography>
          )}
        </CardContent>
      </Card>
    )
  },
)

// ==========================================
// DISPLAYNAME Y PROPTYPES
// ==========================================

HomeProductCard.displayName = 'HomeProductCard'

HomeProductCard.propTypes = {
  data: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
  item: PropTypes.object,
  placement: PropTypes.string,
  maxWidth: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  showActions: PropTypes.bool,
  showAddToCart: PropTypes.bool,
}

// ==========================================
// EXPORTS
// ==========================================

export const ProductCard = HomeProductCard
export default HomeProductCard