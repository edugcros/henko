import React, { useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import ReactGA from 'react-ga4'
import { getCart, addOrUpdateCartItem, removeCartItem, emptyCart } from '@features/cart/cartSlice'
import {
  Box,
  Typography,
  Grid,
  Button,
  Divider,
  CircularProgress,
  Paper,
  Snackbar,
  Alert,
  Skeleton,
  Fade,
  IconButton,
  useTheme,
} from '@mui/material'
import ShoppingBagOutlinedIcon from '@mui/icons-material/ShoppingBagOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import { useTenant } from '../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const CURRENCY = 'ARS'
const FREE_SHIPPING_THRESHOLD = 0
const FALLBACK_IMAGE = '/assets/images/placeholder.png'

const getItemLineId = item => {
  return item.cartKey || item.rowId || `${item.productId}::${item.variantId || 'base'}`
}

const getItemProductId = item => {
  return item.productId?._id || item.productId
}

const getItemImage = item => {
  return item.image || item.selectedVariant?.image || FALLBACK_IMAGE
}

const getVariantLabel = item => {
  const attrs =
    item.selectedAttributes || item.variantAttributes || item.selectedVariant?.attributes || {}
  const values = Object.entries(attrs)
    .filter(([, value]) => Boolean(value))
    .map(([, value]) => value)

  if (values.length > 0) return values.join(' / ')
  if (item.variantSku || item.selectedVariant?.sku)
    return item.variantSku || item.selectedVariant?.sku
  return null
}

const buildCartPayloadFromItem = (item, quantity) => ({
  productId: getItemProductId(item),
  tenantId: item.tenantId || item.product?.tenantId || null,
  quantity,
  title: item.title,
  image: getItemImage(item),
  price: item.price,
  cartKey: item.cartKey,

  variantId: item.variantId || item.selectedVariant?.id || null,
  variantSku: item.variantSku || item.variantSKU || item.selectedVariant?.sku || null,
  variantSKU: item.variantSKU || item.variantSku || item.selectedVariant?.sku || null,
  selectedAttributes: item.selectedAttributes || {},
  variantAttributes: item.variantAttributes || item.selectedAttributes || {},
  selectedVariant: item.selectedVariant
    ? {
        ...item.selectedVariant,
        image: item.selectedVariant.image || getItemImage(item),
      }
    : null,
  hasVariants: item.hasVariants || Boolean(item.variantId),

  colorId: item.colorId || null,
  size: item.size || null,
  gender: item.gender || null,
})

const QuantityInput = memo(
  ({ value, onChange, onIncrement, onDecrement, disabled, max, themeColors }) => {
    const displayValue = value === '' || value === undefined || value === null ? '' : String(value)

    const handleChange = e => {
      const val = e.target.value
      if (val === '' || /^\d+$/.test(val)) {
        onChange(val === '' ? '' : parseInt(val, 10))
      }
    }

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          bgcolor: '#F0F2F2',
          borderRadius: 2,
          border: '1px solid #D5D9D9',
          boxShadow: '0 2px 5px rgba(15,17,17,.15)',
          overflow: 'hidden',
          height: '40px',
        }}
      >
        <IconButton
          onClick={onDecrement}
          disabled={disabled || value <= 1}
          size="small"
          sx={{
            borderRadius: 0,
            p: 1,
            height: '100%',
            '&:hover': { bgcolor: '#E3E6E6' },
            '&:disabled': { color: '#ccc' },
          }}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
          style={{
            width: '50px',
            height: '100%',
            textAlign: 'center',
            fontSize: '14px',
            fontWeight: 700,
            color: disabled ? '#999' : themeColors.cardText,
            border: 'none',
            backgroundColor: 'transparent',
            outline: 'none',
            padding: '0 4px',
            fontFamily: 'inherit',
          }}
        />

        <IconButton
          onClick={onIncrement}
          disabled={disabled || value >= max}
          size="small"
          sx={{
            borderRadius: 0,
            p: 1,
            height: '100%',
            '&:hover': { bgcolor: '#E3E6E6' },
            '&:disabled': { color: '#ccc' },
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
    )
  },
)

QuantityInput.displayName = 'QuantityInput'

const CartItem = memo(
  ({
    item,
    quantity,
    onQuantityChange,
    onUpdateQuantity,
    onRemoveItem,
    isUpdating = false,
    themeColors,
  }) => {
    const productId = getItemProductId(item)
    const lineId = getItemLineId(item)
    const currentQty = typeof quantity === 'number' ? quantity : item.quantity || 1
    const needsUpdate = currentQty !== item.quantity
    const isOutOfStock = item.stock <= 0
    const maxStock = Math.max(1, item.stock || 999)
    const variantLabel = getVariantLabel(item)
    const displayImage = getItemImage(item)

    const handleQtyChange = useCallback(
      val => {
        if (val === '' || (typeof val === 'number' && val >= 1 && val <= maxStock)) {
          onQuantityChange(lineId, val)
        }
      },
      [lineId, maxStock, onQuantityChange],
    )

    const handleIncrement = useCallback(() => {
      if (currentQty < maxStock) {
        onQuantityChange(lineId, currentQty + 1)
      }
    }, [currentQty, maxStock, lineId, onQuantityChange])

    const handleDecrement = useCallback(() => {
      if (currentQty > 1) {
        onQuantityChange(lineId, currentQty - 1)
      }
    }, [currentQty, lineId, onQuantityChange])

    const handleUpdate = useCallback(() => {
      onUpdateQuantity(item, currentQty)
    }, [item, currentQty, onUpdateQuantity])

    const handleRemove = useCallback(() => {
      onRemoveItem(item)
    }, [item, onRemoveItem])

    return (
      <Fade in timeout={300}>
        <Paper
          elevation={0}
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2,
            mb: 1,
            backgroundColor: '#fff',
            transition: 'all 0.2s ease-in-out',
            border: '1px solid transparent',
            '&:hover': {
              backgroundColor: '#fafafa',
              borderColor: '#e0e0e0',
              transform: 'translateY(-1px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            },
          }}
        >
          <Box sx={{ display: 'flex', gap: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                width: { xs: 100, sm: 120 },
                height: { xs: 100, sm: 120 },
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: '#fff',
                borderRadius: 2,
                border: '1px solid #eee',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <img
                src={displayImage}
                alt={item.title}
                loading="lazy"
                style={{
                  maxWidth: '90%',
                  maxHeight: '90%',
                  objectFit: 'contain',
                  filter: isOutOfStock ? 'grayscale(100%)' : 'none',
                  opacity: isOutOfStock ? 0.6 : 1,
                }}
                onError={e => {
                  e.currentTarget.src = FALLBACK_IMAGE
                }}
              />
              {isOutOfStock && (
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'rgba(255,255,255,0.7)',
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700, color: themeColors.error }}>
                    Agotado
                  </Typography>
                </Box>
              )}
            </Box>

            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 2,
                  mb: 0.5,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    component={Link}
                    to={`/product/${productId}`}
                    variant="subtitle1"
                    sx={{
                      fontWeight: 600,
                      color: themeColors.cardText,
                      textDecoration: 'none',
                      lineHeight: 1.3,
                      fontSize: { xs: '0.9rem', sm: '1rem' },
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      '&:hover': {
                        color: themeColors.link,
                        textDecoration: 'underline',
                      },
                    }}
                  >
                    {item.title}
                  </Typography>

                  {variantLabel && (
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mt: 0.5,
                        color: themeColors.cardMutedText,
                        fontWeight: 600,
                      }}
                    >
                      Variante: {variantLabel}
                    </Typography>
                  )}

                  {(item.variantSku || item.selectedVariant?.sku) && (
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mt: 0.25,
                        color: themeColors.link,
                        fontWeight: 600,
                      }}
                    >
                      SKU: {item.variantSku || item.selectedVariant?.sku}
                    </Typography>
                  )}
                </Box>

                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700,
                    color: themeColors.cardPrice,
                    fontSize: { xs: '1rem', sm: '1.25rem' },
                    whiteSpace: 'nowrap',
                  }}
                >
                  ${item.price.toLocaleString('es-AR')}
                </Typography>
              </Box>

              <Typography
                variant="caption"
                sx={{
                  color: isOutOfStock ? themeColors.error : themeColors.success,
                  fontWeight: 600,
                  mb: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: isOutOfStock ? themeColors.error : themeColors.success,
                    display: 'inline-block',
                  }}
                />
                {isOutOfStock ? 'Agotado momentáneamente' : `En stock (${item.stock} disponibles)`}
              </Typography>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  mt: 'auto',
                }}
              >
                <QuantityInput
                  value={currentQty}
                  onChange={handleQtyChange}
                  onIncrement={handleIncrement}
                  onDecrement={handleDecrement}
                  disabled={isUpdating || isOutOfStock}
                  max={maxStock}
                  themeColors={themeColors}
                />

                {needsUpdate && !isOutOfStock && (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    sx={{
                      bgcolor: themeColors.actionPrimary,
                      color: themeColors.actionPrimaryText,
                      borderRadius: 2,
                      fontWeight: 600,
                      px: 2,
                      boxShadow: '0 2px 5px rgba(213,217,217,0.5)',
                      '&:hover': { filter: 'brightness(0.92)', boxShadow: 'none' },
                      '&:disabled': { bgcolor: '#ddd', color: '#666' },
                    }}
                  >
                    {isUpdating ? (
                      <CircularProgress size={16} sx={{ color: themeColors.actionPrimaryText }} />
                    ) : (
                      <span>Actualizar</span>
                    )}
                  </Button>
                )}

                <Divider orientation="vertical" flexItem sx={{ height: 20, my: 'auto', mx: 0.5 }} />

                <Button
                  size="small"
                  onClick={handleRemove}
                  disabled={isUpdating}
                  startIcon={<DeleteOutlineIcon fontSize="small" />}
                  sx={{
                    color: themeColors.actionPrimaryText,
                    fontWeight: 500,
                    fontSize: '12px',
                    minWidth: 'auto',
                    p: '4px 8px',
                    '&:hover': {
                      color: themeColors.actionPrimaryText,
                      bgcolor: 'transparent',
                      textDecoration: 'underline',
                    },
                  }}
                >
                  <span>Eliminar</span>
                </Button>
              </Box>

              <Typography
                variant="body2"
                sx={{
                  mt: 1,
                  color: themeColors.cardMutedText,
                  fontWeight: 500,
                }}
              >
                <span>Subtotal: ${(item.price * currentQty).toLocaleString('es-AR')}</span>
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Fade>
    )
  },
)

CartItem.displayName = 'CartItem'

const Cart = () => {
  const dispatch = useDispatch()
  const theme = useTheme()
  const { themeConfig } = useTenant()
  const { cartItems, isLoading } = useSelector(state => state.cart)
  const themeColors = useMemo(() => getThemeColors(themeConfig || {}), [themeConfig])
  const [quantities, setQuantities] = useState({})
  const [updatingItems, setUpdatingItems] = useState(new Set())
  const [notification, setNotification] = useState({
    open: false,
    message: '',
    severity: 'success',
    itemId: null,
  })

  const { totalAmount, totalQuantity, isEligibleForFreeShipping } = useMemo(() => {
    let amount = 0
    let quantity = 0

    cartItems?.forEach(item => {
      const lineId = getItemLineId(item)
      const q = quantities[lineId] ?? item.quantity ?? 0
      amount += item.price * q
      quantity += q
    })

    return {
      totalAmount: amount,
      totalQuantity: quantity,
      isEligibleForFreeShipping: amount >= FREE_SHIPPING_THRESHOLD,
    }
  }, [cartItems, quantities])

  const trackViewCart = useCallback(items => {
    if (items.length > 0 && typeof ReactGA !== 'undefined') {
      ReactGA.event('view_cart', {
        currency: CURRENCY,
        value: items.reduce((acc, item) => acc + item.price * item.quantity, 0),
        items: items.map(item => ({
          item_id: getItemProductId(item),
          item_name: item.title,
          item_variant: getVariantLabel(item) || undefined,
          price: item.price,
          quantity: item.quantity,
        })),
      })
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadCart = async () => {
      try {
        const action = await dispatch(getCart()).unwrap()

        if (!isMounted) return

        const data = Array.isArray(action?.products)
          ? action.products
          : Array.isArray(action)
            ? action
            : []

        trackViewCart(data)

        const qts = {}
        data.forEach(item => {
          const lineId = getItemLineId(item)
          qts[lineId] = item.quantity || 1
        })
        setQuantities(qts)
      } catch (err) {
        if (isMounted) {
          setNotification({
            open: true,
            message: err.message || 'Error al cargar el carrito',
            severity: 'error',
            itemId: null,
          })
        }
      }
    }

    loadCart()

    return () => {
      isMounted = false
    }
  }, [dispatch, trackViewCart])

  useEffect(() => {
    if (cartItems.length === 0) {
      setQuantities({})
      return
    }

    setQuantities(prev => {
      const updated = { ...prev }
      let hasChanges = false

      cartItems.forEach(item => {
        const lineId = getItemLineId(item)
        const serverQty = item.quantity || 1

        if (updated[lineId] === undefined || !updatingItems.has(lineId)) {
          if (updated[lineId] !== serverQty) {
            updated[lineId] = serverQty
            hasChanges = true
          }
        }
      })

      Object.keys(updated).forEach(key => {
        const exists = cartItems.some(item => getItemLineId(item) === key)
        if (!exists) {
          delete updated[key]
          hasChanges = true
        }
      })

      return hasChanges ? updated : prev
    })
  }, [cartItems, updatingItems])

  const handleQuantityChange = useCallback((lineId, val) => {
    setQuantities(prev => ({ ...prev, [lineId]: val }))
  }, [])

  const handleUpdateQuantity = useCallback(
    async (item, newQty) => {
      const lineId = getItemLineId(item)
      const numericQty = Number(newQty)

      if (isNaN(numericQty) || numericQty < 1) {
        setNotification({
          open: true,
          message: 'La cantidad debe ser al menos 1',
          severity: 'warning',
          itemId: lineId,
        })
        return
      }

      if (numericQty > item.stock) {
        setNotification({
          open: true,
          message: `Solo hay ${item.stock} unidades disponibles`,
          severity: 'warning',
          itemId: lineId,
        })
        return
      }

      setUpdatingItems(prev => new Set(prev).add(lineId))

      try {
        await dispatch(
          removeCartItem({
            productId: getItemProductId(item),
            variantId: item.variantId || null,
            cartKey: item.cartKey || null,
          }),
        ).unwrap()

        await dispatch(addOrUpdateCartItem(buildCartPayloadFromItem(item, numericQty))).unwrap()

        setNotification({
          open: true,
          message: 'Cantidad actualizada correctamente',
          severity: 'success',
          itemId: lineId,
        })
      } catch (err) {
        setQuantities(prev => ({ ...prev, [lineId]: item.quantity }))
        setNotification({
          open: true,
          message: err.message || 'Error al actualizar la cantidad',
          severity: 'error',
          itemId: lineId,
        })
      } finally {
        setUpdatingItems(prev => {
          const next = new Set(prev)
          next.delete(lineId)
          return next
        })
      }
    },
    [dispatch],
  )

  const handleRemoveItem = useCallback(
    async item => {
      const lineId = getItemLineId(item)
      const productId = getItemProductId(item)
      const itemTotal = item.price * item.quantity

      if (itemTotal > 100000) {
        const confirmed = window.confirm(`¿Estás seguro de eliminar "${item.title}" del carrito?`)
        if (!confirmed) return
      }

      setUpdatingItems(prev => new Set(prev).add(lineId))

      try {
        if (typeof ReactGA !== 'undefined') {
          ReactGA.event('remove_from_cart', {
            currency: CURRENCY,
            value: item.price * item.quantity,
            items: [
              {
                item_id: productId,
                item_name: item.title,
                item_variant: getVariantLabel(item) || undefined,
                price: item.price,
                quantity: item.quantity,
              },
            ],
          })
        }

        await dispatch(
          removeCartItem({
            productId,
            variantId: item.variantId || null,
            cartKey: item.cartKey || null,
          }),
        ).unwrap()

        setNotification({
          open: true,
          message: 'Producto eliminado del carrito',
          severity: 'success',
          itemId: lineId,
        })
      } catch (err) {
        setNotification({
          open: true,
          message: err.message || 'Error al eliminar el producto',
          severity: 'error',
          itemId: lineId,
        })
      } finally {
        setUpdatingItems(prev => {
          const next = new Set(prev)
          next.delete(lineId)
          return next
        })
      }
    },
    [dispatch],
  )

  const handleEmptyCart = useCallback(async () => {
    const confirmed = window.confirm('¿Estás seguro de vaciar todo el carrito?')
    if (!confirmed) return

    try {
      await dispatch(emptyCart()).unwrap()
      setQuantities({})
      setNotification({
        open: true,
        message: 'Carrito vaciado correctamente',
        severity: 'success',
        itemId: null,
      })
    } catch (err) {
      setNotification({
        open: true,
        message: err.message || 'Error al vaciar el carrito',
        severity: 'error',
        itemId: null,
      })
    }
  }, [dispatch])

  const handleBeginCheckout = useCallback(() => {
    if (cartItems.length === 0) return

    const outOfStockItems = cartItems.filter(item => item.stock <= 0)
    if (outOfStockItems.length > 0) {
      setNotification({
        open: true,
        message: `Hay productos agotados en tu carrito: ${outOfStockItems.map(i => i.title).join(', ')}`,
        severity: 'warning',
        itemId: null,
      })
      return
    }

    if (typeof ReactGA !== 'undefined') {
      ReactGA.event('begin_checkout', {
        currency: CURRENCY,
        value: totalAmount,
        items: cartItems.map(item => {
          const lineId = getItemLineId(item)
          return {
            item_id: getItemProductId(item),
            item_name: item.title,
            item_variant: getVariantLabel(item) || undefined,
            price: item.price,
            quantity: quantities[lineId] ?? item.quantity,
          }
        }),
      })
    }
  }, [cartItems, totalAmount, quantities])

  const handleCloseNotification = useCallback((event, reason) => {
    if (reason === 'clickaway') return
    setNotification(prev => ({ ...prev, open: false }))
  }, [])

  if (isLoading && !cartItems.length) {
    return (
      <Box
        sx={{
          bgcolor: themeColors.background,
          minHeight: '100vh',
          py: { xs: 2, md: 5 },
        }}
      >
        <Box sx={{ maxWidth: '1200px', mx: 'auto', px: { xs: 2, md: 4 } }}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={9}>
              <Paper sx={{ p: 3, borderRadius: 2 }}>
                <Skeleton variant="text" width="60%" height={40} sx={{ mb: 2 }} />
                {[1, 2, 3].map(i => (
                  <Box key={i} sx={{ display: 'flex', gap: 2, mb: 2 }}>
                    <Skeleton variant="rectangular" width={120} height={120} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width="80%" />
                      <Skeleton variant="text" width="40%" />
                      <Skeleton variant="text" width="30%" />
                    </Box>
                  </Box>
                ))}
              </Paper>
            </Grid>
            <Grid item xs={12} md={3}>
              <Paper sx={{ p: 3, borderRadius: 2 }}>
                <Skeleton variant="text" width="100%" height={30} sx={{ mb: 2 }} />
                <Skeleton variant="rectangular" width="100%" height={50} />
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </Box>
    )
  }

  if (!cartItems.length && !isLoading) {
    return (
      <Box
        sx={{
          textAlign: 'center',
          py: 15,
          bgcolor: themeColors.background,
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ShoppingBagOutlinedIcon sx={{ fontSize: 80, color: '#ccc', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Tu carrito está vacío
        </Typography>
        <Typography variant="body1" color="text.secondary" mb={3}>
          ¡Agrega algunos productos para empezar a comprar!
        </Typography>
        <Button
          component={Link}
          to="/product"
          variant="contained"
          size="large"
          sx={{
            bgcolor: themeColors.actionPrimary,
            color: themeColors.actionPrimaryText,
            borderRadius: 2,
            px: 4,
            py: 1.5,
            fontWeight: 600,
            '&:hover': { bgcolor: themeColors.actionSecondary },
          }}
        >
          <span>Explorar Tienda</span>
        </Button>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        bgcolor: themeColors.background,
        minHeight: '100vh',
        py: { xs: 2, md: 5 },
      }}
    >
      <Box sx={{ maxWidth: '1200px', mx: 'auto', mb: 4, px: { xs: 2, md: 4 } }}>
        <Grid container spacing={4}>
          <Grid item xs={12} md={9}>
            <Paper
              sx={{
                p: { xs: 2, sm: 3 },
                borderRadius: 2,
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                position: 'relative',
                bgcolor: themeColors.cardBackground,
                color: themeColors.cardText,
                border: `1px solid ${themeColors.cardBorder}`,
              }}
            >
              <Box sx={{ mb: 2 }}>
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 700,
                    fontSize: { xs: '1.5rem', sm: '1.75rem' },
                  }}
                >
                  Carrito de compras
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <span>
                    {totalQuantity} {totalQuantity === 1 ? 'producto' : 'productos'}
                  </span>
                </Typography>
              </Box>

              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {cartItems.map(item => {
                  const lineId = getItemLineId(item)
                  return (
                    <CartItem
                      key={lineId}
                      item={item}
                      quantity={quantities[lineId]}
                      onQuantityChange={handleQuantityChange}
                      onUpdateQuantity={handleUpdateQuantity}
                      onRemoveItem={handleRemoveItem}
                      isUpdating={updatingItems.has(lineId)}
                      themeColors={themeColors}
                    />
                  )
                })}
              </Box>

              <Box
                sx={{
                  display: { xs: 'block', md: 'none' },
                  mt: 3,
                  pt: 2,
                  borderTop: `1px solid ${themeColors.cardBorder}`,
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, textAlign: 'right' }}>
                  <span>
                    Subtotal ({totalQuantity} {totalQuantity === 1 ? 'producto' : 'productos'}):
                  </span>
                  <Box component="span" sx={{ color: themeColors.cardPrice, ml: 1 }}>
                    ${totalAmount.toLocaleString('es-AR')}
                  </Box>
                </Typography>
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} md={3}>
            <Box sx={{ position: 'sticky', top: 24 }}>
              <Paper
                sx={{
                  p: 3,
                  borderRadius: 2,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  mb: 2,
                  bgcolor: themeColors.cardBackground,
                  color: themeColors.cardText,
                  border: `1px solid ${themeColors.cardBorder}`,
                }}
              >
                {isEligibleForFreeShipping && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      mb: 2,
                      p: 1.5,
                      bgcolor: themeColors.success ? `${themeColors.success}20` : '#e7f4e4',
                      borderRadius: 1,
                    }}
                  >
                    <Typography
                      sx={{
                        color: themeColors.success,
                        fontSize: '14px',
                        fontWeight: 700,
                        mr: 1,
                      }}
                    >
                      <span>✓</span>
                    </Typography>
                    <Typography
                      color={themeColors.success}
                      sx={{ fontWeight: 600, fontSize: '13px' }}
                    >
                      <span>Tu pedido califica para ENVÍO GRATIS.</span>
                    </Typography>
                  </Box>
                )}

                <Typography
                  variant="h6"
                  sx={{
                    fontFamily: 'sans-serif',
                    fontWeight: 700,
                    mb: 1,
                    fontSize: '1.1rem',
                    color: themeColors.cardText,
                  }}
                >
                  <span>Productos: {totalQuantity}</span>
                </Typography>

                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    mb: 3,
                    fontSize: '1.25rem',
                    color: themeColors.cardText,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 1,
                  }}
                >
                  <span>Total:</span>
                  <Box component="span" sx={{ fontSize: '1.5rem', color: themeColors.cardPrice }}>
                    $ {totalAmount.toLocaleString('es-AR')}
                  </Box>
                </Typography>

                <Button
                  component={Link}
                  to="/checkout"
                  variant="contained"
                  fullWidth
                  onClick={handleBeginCheckout}
                  disabled={cartItems.every(item => item.stock <= 0)}
                  sx={{
                    py: 1.5,
                    borderRadius: 2,
                    bgcolor: themeColors.actionPrimary,
                    color: themeColors.actionPrimaryText,
                    fontWeight: 700,
                    fontSize: '15px',
                    boxShadow: '0 2px 5px rgba(213,217,217,0.5)',
                    '&:hover': {
                      bgcolor: themeColors.actionSecondary,
                      boxShadow: 'none',
                    },
                    '&:disabled': {
                      bgcolor: '#ddd',
                      color: 'text.disabled',
                    },
                    mb: 2,
                  }}
                >
                  {cartItems.every(item => item.stock <= 0) ? (
                    <span>Productos agotados</span>
                  ) : (
                    <span>Proceder al pago</span>
                  )}
                </Button>

                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    textAlign: 'center',
                    color: themeColors.cardMutedText,
                  }}
                >
                  <span>Envío e impuestos calculados en el checkout</span>
                </Typography>
              </Paper>

              <Button
                variant="outlined"
                fullWidth
                onClick={handleEmptyCart}
                startIcon={<DeleteOutlineIcon />}
                sx={{
                  borderColor: themeColors.cardBorder,
                  color: themeColors.cardText,
                  bgcolor: themeColors.cardBackground,
                  borderRadius: 2,
                  fontWeight: 600,
                  py: 1,
                  '&:hover': {
                    bgcolor: themeColors.cardBackground,
                    borderColor: themeColors.cardBorder,
                  },
                }}
              >
                <span>Vaciar Carrito</span>
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Box>

      <Snackbar
        open={notification.open}
        autoHideDuration={4000}
        onClose={handleCloseNotification}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 8 }}
      >
        <Alert
          severity={notification.severity}
          variant="filled"
          sx={{ width: '100%', borderRadius: 2 }}
          onClose={handleCloseNotification}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default Cart
