import React, { useState, useCallback, useMemo, useEffect } from 'react'
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  Chip,
  Collapse,
  Alert,
  CircularProgress,
  Stack,
  Divider,
} from '@mui/material'
import {
  LocalOffer as LocalOfferIcon,
  Error as ErrorIcon,
  Timer as TimerIcon,
  FlashOn as FlashIcon,
} from '@mui/icons-material'
import { useTheme } from '@mui/material/styles'
import { useCoupon } from '@hooks/useCoupon'

const CouponSection = ({ cart, onCouponApplied }) => {
  const theme = useTheme()
  const [code, setCode] = useState('')
  const [expanded, setExpanded] = useState(false)

  const {
    validateCoupon,
    fetchProductCoupons,
    productCoupons,
    appliedCoupon,
    discount,
    validating,
    error,
    removeCoupon,
    loadingProductCoupons,
  } = useCoupon()

  // --- 🎯 Lógica de Cupones (Normalización de IDs corregida) ---
  const exclusiveDeals = useMemo(() => {
    if (!productCoupons || !Array.isArray(productCoupons)) return []

    return productCoupons.filter(coupon => {
      const isAvailable = coupon.isActive && (coupon.usageLimit > coupon.usageCount || 0)

      // Buscamos si algún ID del cupón coincide con algún ID del producto en el carrito
      const isApplicable = cart.items?.some(item => {
        const cartId = item.productId || item._id || item.id
        return coupon.applicableProducts?.includes(cartId)
      })

      return isAvailable && isApplicable
    })
  }, [productCoupons, cart.items])

  // --- 🔎 Búsqueda automática al montar ---
  useEffect(() => {
    if (cart.items?.length > 0) {
      // Recopilamos todos los IDs únicos para evitar llamadas duplicadas
      const uniqueIds = [...new Set(cart.items.map(item => item.productId || item._id || item.id))]
      uniqueIds.forEach(id => fetchProductCoupons(id, cart.userId))
    }
  }, [cart.items, cart.userId, fetchProductCoupons])

  const handleApplyCode = async inputCode => {
    const targetCode = typeof inputCode === 'string' ? inputCode : code
    if (!targetCode.trim()) return

    try {
      // Importante: Enviamos el cart completo para que el backend valide subtotal e items
      const result = await validateCoupon(targetCode.toUpperCase().trim(), cart)

      if (result) {
        // Informamos al padre (CheckoutPage) para que actualice el CartSummary
        onCouponApplied?.(result)
        setCode('')
        setExpanded(false)
      }
    } catch (err) {
      console.error('Error applying coupon:', err)
    }
  }

  const handleRemove = () => {
    removeCoupon()
    onCouponApplied?.(null)
  }

  return (
    <Paper elevation={0}>
      {!appliedCoupon && (
        <>
          {error && (
            <Alert
              severity="error"
              sx={{ mt: 2, borderRadius: 2 }}
              icon={<ErrorIcon fontSize="inherit" />}
            >
              {error}
            </Alert>
          )}

          {exclusiveDeals.length > 0 && (
            <Button
              fullWidth
              onClick={() => setExpanded(!expanded)}
              endIcon={
                <Chip
                  label={exclusiveDeals.length}
                  size="small"
                  color="error"
                  sx={{ height: 18 }}
                />
              }
              sx={{ mt: 1.5, textTransform: 'none', fontSize: '0.85rem' }}
            >
              {expanded ? 'Ocultar ofertas' : 'Ver cupones para tus productos'}
            </Button>
          )}

          <Collapse in={expanded}>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {loadingProductCoupons ? (
                <Stack alignItems="center">
                  <CircularProgress size={24} />
                </Stack>
              ) : (
                exclusiveDeals.map(coupon => (
                  <Paper
                    key={coupon._id}
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 3,
                      borderStyle: 'dashed',
                      borderColor:
                        coupon.usageLimit <= 5 ? 'error.main' : theme.palette.brand.main,
                      position: 'relative',
                      bgcolor: theme.palette.card.background,
                    }}
                  >
                    <Box sx={{ pr: 7 }}>
                      <Typography
                        variant="subtitle2"
                        fontWeight="800"
                        sx={{ color: theme.palette.brand.main }}
                      >
                        {coupon.code} <FlashIcon sx={{ fontSize: 14 }} />
                      </Typography>
                      <Typography variant="caption" display="block" sx={{ mb: 1 }}>
                        {coupon.description}
                      </Typography>
                      <Typography variant="body2" fontWeight="700" color="success.main">
                        {coupon.discountValue}% DE DESCUENTO
                      </Typography>
                    </Box>

                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => handleApplyCode(coupon.code)}
                      sx={{ position: 'absolute', bottom: 12, right: 12 }}
                    >
                      Aplicar
                    </Button>
                  </Paper>
                ))
              )}
            </Box>
          </Collapse>
        </>
      )}
    </Paper>
  )
}

export default CouponSection
