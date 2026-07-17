import React, { useMemo } from 'react'
import PropTypes from 'prop-types'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Divider,
  Button,
  Chip,
  Stack,
  CircularProgress,
} from '@mui/material'
import {
  ShoppingCart as CartIcon,
  LocalShipping as ShippingIcon,
  LocalOffer as CouponIcon,
} from '@mui/icons-material'
import CouponInput from './CouponInput'
import { useCoupon } from '@hooks/useCoupon'

const CartSummary = ({ cart, onCheckout }) => {
  const {
    appliedCoupon,
    discount,
    validating,
    validateCoupon,
    removeCoupon,
    calculateTotal,
    error,
    setError,
  } = useCoupon()

  // --- ⚙️ CÁLCULOS MEMOIZADOS ---
  // Evitamos cálculos costosos en cada render
  const items = useMemo(() => cart?.items || [], [cart?.items])
  const itemCount = items.length

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + (item.price || 0) * (item.quantity || 0),
        0,
      ),
    [items],
  )

  // Umbral de envío gratis (configurable)
  const SHIPPING_THRESHOLD = 5000
  const SHIPPING_COST = 500

  const shipping = useMemo(
    () =>
      subtotal >= SHIPPING_THRESHOLD || subtotal === 0 ? 0 : SHIPPING_COST,
    [subtotal],
  )

  const discountAmount = discount || 0

  // El total final neto
  const finalTotal = useMemo(
    () => calculateTotal(subtotal) + shipping,
    [calculateTotal, subtotal, shipping],
  )

  // --- 🛠 MANEJADORES ---
  const handleCheckout = () => {
    if (itemCount === 0) return

    // Estructura de datos limpia para la API/Redux
    const orderSummary = {
      items,
      coupon: appliedCoupon
        ? {
            id: appliedCoupon._id || appliedCoupon.id,
            code: appliedCoupon.code,
            discount: discountAmount,
          }
        : null,
      breakdown: {
        subtotal,
        shipping,
        discount: discountAmount,
        total: finalTotal,
        currency: 'ARS',
      },
    }

    onCheckout(orderSummary)
  }

  // Formateador estándar profesional
  const formatCurrency = amount =>
    new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(amount)

  return (
    <Card elevation={4} sx={{ borderRadius: 3, position: 'relative' }}>
      <CardContent sx={{ p: 3 }}>
        <Typography
          variant="h6"
          fontWeight="700"
          gutterBottom
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
        >
          <CartIcon color="primary" />
          Resumen de compra
        </Typography>

        <Stack spacing={2} sx={{ mt: 3 }}>
          {/* Conteo de productos */}
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography color="text.secondary" variant="body1">
              Productos ({itemCount})
            </Typography>
            <Typography fontWeight="500">{formatCurrency(subtotal)}</Typography>
          </Box>

          <Divider sx={{ my: 1 }} />

          {/* Sección de Cupón */}
          <CouponInput
            onApply={code => validateCoupon(code, cart)}
            onRemove={removeCoupon}
            appliedCoupon={appliedCoupon}
            discount={discount}
            loading={validating}
            disabled={itemCount === 0}
            error={error}
            onClearError={() => setError(null)}
          />

          {/* Descuento Aplicado */}
          {discountAmount > 0 && (
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                bgcolor: 'success.light',
                p: 1,
                borderRadius: 1,
                color: 'success.contrastText',
              }}
            >
              <Typography
                variant="body2"
                display="flex"
                alignItems="center"
                gap={0.5}
                fontWeight="600"
              >
                <CouponIcon fontSize="small" />
                Descuento aplicado
              </Typography>
              <Typography variant="body2" fontWeight="800">
                -{formatCurrency(discountAmount)}
              </Typography>
            </Box>
          )}

          {/* Envío */}
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography
              variant="body1"
              display="flex"
              alignItems="center"
              gap={1}
              color="text.secondary"
            >
              <ShippingIcon fontSize="small" />
              Envío
            </Typography>
            <Typography
              color={
                shipping === 0 && subtotal > 0 ? 'success.main' : 'text.primary'
              }
              fontWeight="600"
            >
              {shipping === 0
                ? subtotal === 0
                  ? formatCurrency(0)
                  : 'GRATIS'
                : formatCurrency(shipping)}
            </Typography>
          </Box>

          {/* Banner de Envío Gratis */}
          {subtotal > 0 && subtotal < SHIPPING_THRESHOLD && (
            <Chip
              label={`¡Estás a ${formatCurrency(SHIPPING_THRESHOLD - subtotal)} del envío gratis!`}
              variant="outlined"
              color="info"
              size="small"
              sx={{
                py: 1.5,
                borderStyle: 'dashed',
                fontWeight: '600',
              }}
            />
          )}

          <Divider sx={{ borderStyle: 'dashed', my: 1, borderWidth: 1 }} />

          {/* Total Final */}
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            sx={{ pt: 1 }}
          >
            <Typography variant="h5" fontWeight="800">
              Total
            </Typography>
            <Typography variant="h5" color="primary" fontWeight="900">
              {formatCurrency(finalTotal)}
            </Typography>
          </Box>
        </Stack>

        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleCheckout}
          disabled={itemCount === 0 || validating}
          sx={{
            mt: 4,
            py: 1.5,
            borderRadius: 2,
            fontWeight: 'bold',
            fontSize: '1.1rem',
            boxShadow: 4,
          }}
        >
          {validating ? (
            <CircularProgress size={24} color="inherit" />
          ) : (
            'Finalizar compra'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

CartSummary.propTypes = {
  cart: PropTypes.shape({
    items: PropTypes.array,
  }),
  onCheckout: PropTypes.func.isRequired,
}

export default CartSummary
