import React, { useMemo, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import PropTypes from 'prop-types'
import ReactGA from 'react-ga4'

import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  IconButton,
  Box,
  Tooltip,
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
import { Newprimary } from '../theme/colors'

const EMPTY_ARRAY = []

const TOAST_POSITION = 'bottom-center'

const getToastBaseStyle = colors => ({
  borderRadius: '16px',
  padding: '12px 14px',
  fontSize: '0.95rem',
  fontWeight: 600,
  minHeight: '54px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
  border: `1px solid ${colors.border}`,
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
        color: colors.text,
      },
      progressStyle: {
        background: colors.primary,
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
        background: colors.surface,
        color: colors.warning,
        border: `1px solid ${colors.warning}`,
      },
      progressStyle: {
        background: colors.warning,
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
        background: colors.surface,
        color: colors.error,
        border: `1px solid ${colors.error}`,
      },
      progressStyle: {
        background: colors.error,
      },
    }),
})

const cardStyles = {
  width: '100%',
  maxWidth: 280,
  mx: 'auto',
  my: 1,
  position: 'relative',
  overflow: 'hidden',
  background:
    'linear-gradient(180deg, var(--product-soft-bg) 0%, var(--product-surface) 100%)',
  borderRadius: 4,
  border: '1px solid var(--product-border)',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  transition:
    'transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease',
  display: 'flex',
  flexDirection: 'column',
  '&:hover': {
    transform: 'translateY(-6px)',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.14)',
    borderColor: Newprimary.huesoCrema,
    '& .action-buttons': {
      opacity: 1,
      right: 12,
    },
    '& .product-image': {
      transform: 'scale(1.03)',
    },
  },
}

const imageWrapperStyles = {
  background:
    'linear-gradient(180deg, var(--product-image-bg) 0%, var(--product-soft-bg) 100%)',
  borderBottom: '3px solid var(--product-border)',
}

const imageStyles = {
  height: 240,
  objectFit: 'contain',
  p: 2,
  transition: 'transform 0.3s ease',
}

const floatingWishlistStyles = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 3,
}

const wishlistButtonStyles = {
  backgroundColor: 'rgba(255,255,255,0.88)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.55)',
  boxShadow: '0 6px 16px rgba(15, 23, 42, 0.12)',
  '&:hover': {
    backgroundColor: '#ffffff',
  },
}

const actionButtonsStyles = {
  position: 'absolute',
  top: '28%',
  right: -42,
  display: 'flex',
  flexDirection: 'column',
  gap: 1.25,
  transition: 'all 0.28s ease',
  opacity: 0,
  zIndex: 3,
}

const secondaryActionButtonStyles = {
  bgcolor: 'var(--product-surface)',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
  border: '1px solid var(--product-border)',
  '&:hover': {
    bgcolor: 'var(--product-soft-bg)',
  },
}

const primaryActionButtonStyles = {
  bgcolor: 'var(--product-action-primary)',
  color: 'var(--product-action-primary-text)',
  boxShadow: '0 10px 20px rgba(15, 23, 42, 0.18)',
  '&:hover': {
    bgcolor: 'var(--product-action-secondary)',
    color: 'var(--product-action-secondary-text)',
  },
}

const ProductCard = ({ item }) => {
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const wishlistIds = useSelector(selectWishlistIds) || EMPTY_ARRAY
  const compareItems = useSelector(state => state.compare?.items) || EMPTY_ARRAY
  const user = useSelector(state => state.user?.user)
  const isAuthenticated = useSelector(selectIsAuthenticated)
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
  const commerceSettings = useMemo(
    () => getCommerceSettings(activeConfig),
    [activeConfig],
  )
  const notify = useMemo(() => createNotify(themeColors), [themeColors])
  const themedCardStyles = useMemo(
    () => ({
      ...cardStyles,
      '--product-card-surface': themeColors.cardBackground,
      '--product-card-border': themeColors.cardBorder,
      '--product-card-text': themeColors.cardText,
      '--product-card-muted': themeColors.cardMutedText,
      '--product-card-price': themeColors.cardPrice,
      '--product-primary': themeColors.primary,
      '--product-secondary': themeColors.secondary,
      '--product-accent': themeColors.accent,
      '--product-action-primary': themeColors.actionPrimary,
      '--product-action-primary-text': themeColors.actionPrimaryText,
      '--product-action-secondary': themeColors.actionSecondary,
      '--product-action-secondary-text': themeColors.actionSecondaryText,
      '--product-price': themeColors.cardPrice,
      '--product-sale-price': themeColors.salePrice,
      '--product-badge-bg': themeColors.badgeBackground,
      '--product-badge-text': themeColors.badgeText,
      '--product-error': themeColors.error,
      '--product-border': themeColors.cardBorder,
      '--product-surface': themeColors.cardBackground,
      '--product-soft-bg': themeColors.cardBackground,
      '--product-text': themeColors.cardText,
      '--product-muted': themeColors.cardMutedText,
      '--product-image-bg': themeColors.cardBackground,
      '--product-card-padding': `${productTheme.cardPadding ?? activeConfig?.spacing?.cardPadding ?? 0}px`,
    }),
    [activeConfig?.spacing?.cardPadding, productTheme.cardPadding, themeColors],
  )

  const isFavorite = useMemo(() => {
    if (!Array.isArray(wishlistIds)) return false

    return wishlistIds.some(entry => {
      if (typeof entry === 'string') return entry === item?._id
      if (entry && typeof entry === 'object') return entry._id === item?._id
      return false
    })
  }, [wishlistIds, item?._id])

  const productImage = getProductImage(item)
  const productRouteId = getProductRouteId(item)
  const productBrand = item?.marca || item?.brand || 'Marca'
  const productPrice = Number(item?.finalPrice ?? item?.price) || 0
  const originalPrice = Number(item?.originalPrice ?? item?.price) || 0
  const discountPercentage = Number(item?.discountPercentage || 0)
  const hasPromotion = Boolean(
    productTheme.showBadge !== false &&
    item?.hasPromotion &&
    discountPercentage > 0 &&
    productPrice < originalPrice,
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
              item_id: product?._id,
              item_name: product?.title,
              item_brand: product?.brand || product?.marca || 'Generic',
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

  useEffect(() => {
    if (!item?._id) return

    trackUserMetric({
      eventType: USER_METRIC_EVENTS.PRODUCT_IMPRESSION,
      productId: item._id,
      value: productPrice,
      currency: commerceSettings.currency,
      category: item.category || item.categoryName || '',
      metadata: {
        title: item.title,
        brand: productBrand,
        placement: 'product_card',
      },
    })
  }, [
    item?._id,
    item?.title,
    item?.category,
    item?.categoryName,
    productBrand,
    productPrice,
    commerceSettings.currency,
  ])

  const handleProductClick = useCallback(() => {
    trackUserMetric({
      eventType: USER_METRIC_EVENTS.PRODUCT_CLICK,
      productId: item._id,
      value: productPrice,
      currency: commerceSettings.currency,
      category: item.category || item.categoryName || '',
      metadata: {
        title: item.title,
        brand: productBrand,
        placement: 'product_card',
      },
    })
  }, [commerceSettings.currency, item, productBrand, productPrice])

  const handleWishlist = useCallback(
    async e => {
      e.preventDefault()
      e.stopPropagation()

      if (productTheme.showWishlist === false) return

      if (!user || !isAuthenticated) {
        notify.warning('Debes iniciar sesión para guardar favoritos.', {
          toastId: 'wishlist-login-required',
        })
        return
      }

      try {
        await dispatch(toggleWishlist(item._id)).unwrap()
        trackUserMetric({
          eventType: isFavorite
            ? USER_METRIC_EVENTS.WISHLIST_REMOVE
            : USER_METRIC_EVENTS.WISHLIST_ADD,
          productId: item._id,
          value: productPrice,
          currency: commerceSettings.currency,
          metadata: {
            title: item.title,
            placement: 'product_card',
          },
        })
      } catch {
        notify.error('No se pudo actualizar la lista de deseos.', {
          toastId: `wishlist-update-error-${item._id}`,
        })
      }
    },
    [
      dispatch,
      isAuthenticated,
      isFavorite,
      item,
      notify,
      productPrice,
      productTheme.showWishlist,
      user,
      commerceSettings.currency,
    ],
  )

  const handleCompare = useCallback(
    e => {
      e.preventDefault()
      e.stopPropagation()

      if (productTheme.showCompare === false) return

      dispatch(addToCompare(item))

      const currentCompareCount = compareItems.length + 1

      if (currentCompareCount > 1) {
        notify.success('Producto agregado. Comparación lista.', {
          toastId: 'compare-ready',
        })
        navigate('/compare-product')
      } else {
        notify.success('Producto agregado para comparar.', {
          toastId: `compare-added-${item._id}`,
        })
      }
    },
    [
      dispatch,
      item,
      compareItems.length,
      navigate,
      notify,
      productTheme.showCompare,
    ],
  )

  const handleAddToCart = useCallback(
    async e => {
      e.preventDefault()
      e.stopPropagation()

      if (!user) {
        notify.warning('Por favor, inicia sesión para comprar.', {
          toastId: 'cart-login-required',
        })
        return
      }

      try {
        const cartData = {
          productId: item._id,
          tenantId: item.tenantId || null,
          title: item.title,
          price: productPrice,
          originalPrice,
          discountPercentage: hasPromotion ? discountPercentage : 0,
          promotionId: item.promotionId || null,
          promotionTitle: item.promotionTitle || null,
          promotionType: item.promotionType || null,
          hasPromotion,
          image: productImage,
          quantity: 1,
        }

        const resultAction = await dispatch(addOrUpdateCartItem(cartData))

        if (addOrUpdateCartItem.fulfilled.match(resultAction)) {
          trackAddToCart(item)
          trackUserMetric({
            eventType: USER_METRIC_EVENTS.ADD_TO_CART,
            productId: item._id,
            value: productPrice,
            currency: commerceSettings.currency,
            quantity: 1,
            items: [
              {
                productId: item._id,
                title: item.title,
                sku: item.sku || '',
                quantity: 1,
                price: productPrice,
                subtotal: productPrice,
              },
            ],
            metadata: {
              title: item.title,
              placement: 'product_card',
            },
          })
          notify.success('Producto añadido al carrito.', {
            toastId: `cart-added-${item._id}`,
          })
          return
        }

        notify.error('No se pudo añadir el producto al carrito.', {
          toastId: `cart-add-error-${item._id}`,
        })
      } catch {
        notify.error('Ocurrió un error al procesar la acción.', {
          toastId: `cart-catch-error-${item._id}`,
        })
      }
    },
    [
      dispatch,
      item,
      productImage,
      productPrice,
      trackAddToCart,
      user,
      originalPrice,
      discountPercentage,
      hasPromotion,
      notify,
      commerceSettings.currency,
    ],
  )

  if (!item?._id) return null

  return (
    <Card component="article" sx={themedCardStyles}>
      {productTheme.showWishlist !== false && (
        <Box sx={floatingWishlistStyles}>
          <Tooltip
            title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
          >
            <IconButton
              onClick={handleWishlist}
              color="error"
              aria-label={
                isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'
              }
              sx={wishlistButtonStyles}
            >
              {isFavorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Link
        to={`/product/${productRouteId}`}
        onClick={handleProductClick}
        style={{ textDecoration: 'none', color: 'inherit' }}
        aria-label={`Ver producto ${item.title}`}
      >
        <Box sx={imageWrapperStyles}>
          <CardMedia
            className="product-image"
            component="img"
            image={productImage}
            alt={`Imagen de ${item.title}`}
            sx={imageStyles}
            onError={e => {
              e.currentTarget.src = '/assets/images/placeholder.png'
            }}
          />
        </Box>
      </Link>

      <CardContent
        sx={{
          flexGrow: 1,
          p: 'var(--product-card-padding)',
          '&:last-child': { pb: 'var(--product-card-padding)' },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 2,
            fontSize: '0.69rem',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--product-accent)',
          }}
        >
          {productBrand}
        </Typography>

        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            color: 'var(--product-text)',
            mb: 1,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '2.9rem',
            lineHeight: 1.45,
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          {item?.title}
        </Typography>

        <Box>
          {productTheme.showPrice !== false && hasPromotion && (
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 600,
                color: 'text.secondary',
                textDecoration: 'line-through',
                lineHeight: 1.2,
              }}
            >
              {formatCurrency(originalPrice, activeConfig)}
            </Typography>
          )}

          {productTheme.showPrice !== false && (
            <Typography
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'start',
                fontWeight: 800,
                fontSize: 18,
                color: 'var(--product-price)',
                letterSpacing: 0,
              }}
            >
              {formatCurrency(productPrice, activeConfig)}
            </Typography>
          )}

          {hasPromotion && (
            <Typography
              sx={{
                mt: 0.4,
                display: 'inline-flex',
                px: 1,
                py: 0.25,
                borderRadius: 999,
                bgcolor: 'var(--product-badge-bg)',
                color: 'var(--product-badge-text)',
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              {discountPercentage}% OFF
            </Typography>
          )}
        </Box>
      </CardContent>

      {(productTheme.showCompare !== false ||
        productTheme.showQuickView !== false) && (
        <Box className="action-buttons" sx={actionButtonsStyles}>
          {productTheme.showCompare !== false && (
            <Tooltip title="Comparar" placement="left">
              <IconButton
                onClick={handleCompare}
                sx={secondaryActionButtonStyles}
                size="small"
                aria-label="Comparar producto"
              >
                <CompareArrowsIcon
                  fontSize="small"
                  sx={{ color: 'var(--product-action-primary)' }}
                />
              </IconButton>
            </Tooltip>
          )}

          {productTheme.showQuickView !== false && (
            <Tooltip title="Vista rápida" placement="left">
              <IconButton
                component={Link}
                to={`/product/${productRouteId}`}
                sx={secondaryActionButtonStyles}
                size="small"
                aria-label="Ver producto"
              >
                <VisibilityIcon
                  fontSize="small"
                  sx={{ color: 'var(--product-action-primary)' }}
                />
              </IconButton>
            </Tooltip>
          )}
          {/*
        <Tooltip title="Añadir al carrito" placement="left">
          <IconButton
            onClick={handleAddToCart}
            sx={primaryActionButtonStyles}
            size="small"
            aria-label="Añadir al carrito"
          >
            <ShoppingCartIcon fontSize="small" />
          </IconButton>
        </Tooltip>
*/}
        </Box>
      )}
    </Card>
  )
}

ProductCard.propTypes = {
  item: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    marca: PropTypes.string,
    brand: PropTypes.string,
    price: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    images: PropTypes.arrayOf(
      PropTypes.shape({
        url: PropTypes.string,
      }),
    ),
  }).isRequired,
}

export default React.memo(ProductCard)
