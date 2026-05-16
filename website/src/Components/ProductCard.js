import React, { useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import PropTypes from 'prop-types'
import ReactGA from 'react-ga4'

import { Card, CardMedia, CardContent, Typography, IconButton, Box, Tooltip } from '@mui/material'

import {
  FavoriteBorder as FavoriteBorderIcon,
  Favorite as FavoriteIcon,
  ShoppingCart as ShoppingCartIcon,
  CompareArrows as CompareArrowsIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material'

import { toggleWishlist } from '@features/user/userSlice'
import { addToCompare } from '@features/compare/compareSlice'
import { addOrUpdateCartItem } from '@features/cart/cartSlice'
import { Newprimary } from '../theme/colors'

const EMPTY_ARRAY = []

const formatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
})

const TOAST_POSITION = 'bottom-center'

const getToastBaseStyle = () => ({
  borderRadius: '16px',
  padding: '12px 14px',
  fontSize: '0.95rem',
  fontWeight: 600,
  minHeight: '54px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
  border: `1px solid ${Newprimary?.borderGray || '#e5e7eb'}`,
  backdropFilter: 'blur(8px)',
})

const notify = {
  success: (message, options = {}) =>
    toast.success(message, {
      position: TOAST_POSITION,
      autoClose: 2200,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
      toastId: options.toastId,
      icon: '🛒',
      style: {
        ...getToastBaseStyle(),
        background: 'rgba(255,255,255,0.98)',
        color: Newprimary?.textSecondary || '#111827',
      },
      progressStyle: {
        background: Newprimary?.RoyalBlue || Newprimary?.primary || '#2563eb',
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
      icon: '⚠️',
      style: {
        ...getToastBaseStyle(),
        background: '#fff7ed',
        color: '#9a3412',
        border: '1px solid #fdba74',
      },
      progressStyle: {
        background: '#f59e0b',
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
      icon: '⛔',
      style: {
        ...getToastBaseStyle(),
        background: '#fef2f2',
        color: '#991b1b',
        border: '1px solid #fecaca',
      },
      progressStyle: {
        background: '#dc2626',
      },
    }),
}

const cardStyles = {
  width: 280,
  m: 1,
  position: 'relative',
  overflow: 'hidden',
  background: `linear-gradient(180deg, ${Newprimary?.borderGray || '#f8fafc'} 0%, #ffffff 100%)`,
  borderRadius: 4,
  border: `1px solid ${Newprimary?.borderGray || '#e5e7eb'}`,
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  transition: 'transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease',
  display: 'flex',
  flexDirection: 'column',
  '&:hover': {
    transform: 'translateY(-6px)',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.14)',
    borderColor: Newprimary?.primary || '#cbd5e1',
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
  background: 'linear-gradient(180deg, rgb(62, 50, 50) 0%, rgba(248,250,252,1) 100%)',
  borderBottom: `3px solid ${Newprimary?.borderGray || '#e5e7eb'}`,
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
  bgcolor: '#fff',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.12)',
  border: `1px solid ${Newprimary?.borderGray || '#e5e7eb'}`,
  '&:hover': {
    bgcolor: Newprimary?.gainsGray || '#f3f4f6',
  },
}

const primaryActionButtonStyles = {
  bgcolor: Newprimary?.primary || '#111827',
  color: '#fff',
  boxShadow: '0 10px 20px rgba(15, 23, 42, 0.18)',
  '&:hover': {
    bgcolor: Newprimary?.RoyalBlue || '#1d4ed8',
  },
}

const ProductCard = ({ item }) => {
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const wishlistIds = useSelector(state => state.user?.wishlist?.wishlist) || EMPTY_ARRAY
  const compareItems = useSelector(state => state.compare?.items) || EMPTY_ARRAY
  const user = useSelector(state => state.user?.user)

  const isFavorite = useMemo(() => {
    if (!Array.isArray(wishlistIds)) return false

    return wishlistIds.some(entry => {
      if (typeof entry === 'string') return entry === item?._id
      if (entry && typeof entry === 'object') return entry._id === item?._id
      return false
    })
  }, [wishlistIds, item?._id])

  const productImage = item?.images?.[0]?.url || '/assets/images/placeholder.png'
  const productBrand = item?.marca || item?.brand || 'Marca'
  const productPrice = Number(item?.finalPrice ?? item?.price) || 0
  const originalPrice = Number(item?.originalPrice ?? item?.price) || 0
  const discountPercentage = Number(item?.discountPercentage || 0)
  const hasPromotion = Boolean(
    item?.hasPromotion && discountPercentage > 0 && productPrice < originalPrice,
  )
  const trackAddToCart = useCallback(product => {
    try {
      const finalPrice = Number(product?.finalPrice ?? product?.price) || 0

      ReactGA.event('add_to_cart', {
        currency: 'ARS',
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
  }, [])

  const handleWishlist = useCallback(
    async e => {
      e.preventDefault()
      e.stopPropagation()

      if (!user) {
        notify.warning('Debes iniciar sesión para guardar favoritos.', {
          toastId: 'wishlist-login-required',
        })
        return
      }

      try {
        await dispatch(toggleWishlist(item._id)).unwrap()
      } catch {
        notify.error('No se pudo actualizar la lista de deseos.', {
          toastId: `wishlist-update-error-${item._id}`,
        })
      }
    },
    [dispatch, item?._id, user],
  )

  const handleCompare = useCallback(
    e => {
      e.preventDefault()
      e.stopPropagation()

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
    [dispatch, item, compareItems.length, navigate],
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
    ],
  )

  if (!item?._id) return null

  return (
    <Card component="article" sx={cardStyles}>
      <Box sx={floatingWishlistStyles}>
        <Tooltip title={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}>
          <IconButton
            onClick={handleWishlist}
            color="error"
            aria-label={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            sx={wishlistButtonStyles}
          >
            {isFavorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Link
        to={`/product/${item._id}`}
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

      <CardContent sx={{ flexGrow: 1, pt: 1.5, px: 2, pb: 2 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 2,
            fontSize: '0.69rem',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: Newprimary?.error || '#2563eb',
          }}
        >
          {productBrand}
        </Typography>

        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'math',
            color: Newprimary?.black || '#111827',
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
          {hasPromotion && (
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 600,
                color: 'text.secondary',
                textDecoration: 'line-through',
                lineHeight: 1.2,
              }}
            >
              {formatter.format(originalPrice)}
            </Typography>
          )}

          <Typography
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'start',
              fontWeight: 800,
              fontSize: 18,
              color: hasPromotion
                ? Newprimary?.error || '#dc2626'
                : Newprimary?.darkBlue || '#1d4ed8',
              letterSpacing: '-0.02em',
            }}
          >
            {formatter.format(productPrice)}
          </Typography>

          {hasPromotion && (
            <Typography
              sx={{
                mt: 0.4,
                display: 'inline-flex',
                px: 1,
                py: 0.25,
                borderRadius: 999,
                bgcolor: '#fee2e2',
                color: '#991b1b',
                fontWeight: 800,
                fontSize: 11,
              }}
            >
              {discountPercentage}% OFF
            </Typography>
          )}
        </Box>
      </CardContent>

      <Box className="action-buttons" sx={actionButtonsStyles}>
        <Tooltip title="Comparar" placement="left">
          <IconButton
            onClick={handleCompare}
            sx={secondaryActionButtonStyles}
            size="small"
            aria-label="Comparar producto"
          >
            <CompareArrowsIcon fontSize="small" color="primary" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Vista rápida" placement="left">
          <IconButton
            component={Link}
            to={`/product/${item._id}`}
            sx={secondaryActionButtonStyles}
            size="small"
            aria-label="Ver producto"
          >
            <VisibilityIcon fontSize="small" color="info" />
          </IconButton>
        </Tooltip>
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
