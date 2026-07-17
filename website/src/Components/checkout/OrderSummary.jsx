// src/components/checkout/OrderSummary.jsx
import React, { useMemo } from 'react'
import {
  Paper,
  Typography,
  Box,
  Divider,
  Button,
  List,
  ListItem,
  ListItemText,
} from '@mui/material'
import ShoppingCartCheckoutIcon from '@mui/icons-material/ShoppingCartCheckout'
import { useSelector } from 'react-redux'
import { useTenant } from '../../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const OrderSummary = ({
  cart,
  discount = 0,
  shipping = 0,
  onCheckout,
  loading,
}) => {
  const tenantContext = useTenant()
  const themeState = useSelector(state => state.theme)

  const tenantConfig = tenantContext?.themeConfig
  const reduxConfig = themeState?.config
  const previewConfig = themeState?.previewConfig
  const previewMode = themeState?.previewMode

  const activeConfig = useMemo(() => {
    if (previewMode && previewConfig) return previewConfig
    if (reduxConfig) return reduxConfig
    if (tenantConfig) return tenantConfig
    return {}
  }, [reduxConfig, tenantConfig, previewConfig, previewMode])

  const themeColors = useMemo(() => getThemeColors(activeConfig), [activeConfig])

  const subtotal =
    cart.items?.reduce(
      (sum, item) => sum + item.price * (item.quantity || 1),
      0,
    ) || 0

  const total = Math.max(0, subtotal - discount + shipping)

  const summaryItems = [
    { label: 'Subtotal', value: subtotal },
    {
      label: 'Descuento',
      value: -discount,
      color: themeColors.success,
      showIfZero: false,
    },
    {
      label: 'Envío',
      value: shipping,
      color: shipping === 0 ? themeColors.success : 'inherit',
    },
  ]

  return (
    <Paper sx={{ p: 3, borderRadius: '12px', position: 'sticky', top: 24 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Resumen del pedido
      </Typography>

      <List dense>
        {summaryItems.map(item => {
          if (!item.showIfZero && item.value === 0) return null
          const isNegative = item.value < 0
          return (
            <ListItem key={item.label} sx={{ px: 0, py: 0.5 }}>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ color: 'text.secondary' }}
              />
              <Typography
                variant="body1"
                fontWeight={600}
                color={item.color || 'inherit'}
              >
                {isNegative ? '-' : ''}${Math.abs(item.value).toLocaleString()}
                {item.label === 'Envío' && shipping === 0 && ' (Gratis)'}
              </Typography>
            </ListItem>
          )
        })}
      </List>

      <Divider sx={{ my: 2 }} />

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
        }}
      >
        <Typography variant="h6" fontWeight={700}>
          Total
        </Typography>
        <Typography variant="h5" fontWeight={700} color={themeColors.price}>
          ${total.toLocaleString()}
        </Typography>
      </Box>

      <Button
        variant="contained"
        fullWidth
        size="large"
        onClick={onCheckout}
        disabled={loading || !cart.items?.length}
        startIcon={<ShoppingCartCheckoutIcon />}
        sx={{
          py: 1.5,
          borderRadius: '10px',
          bgcolor: themeColors.actionPrimary,
          color: themeColors.actionPrimaryText,
          fontWeight: 700,
          fontSize: '1rem',
          '&:hover': {
            bgcolor: themeColors.actionPrimary,
            filter: 'brightness(0.92)',
          },
          '&:disabled': { bgcolor: '#ddd', color: '#999' },
        }}
      >
        {loading ? 'Procesando...' : 'Confirmar pedido'}
      </Button>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 2, textAlign: 'center' }}
      >
        Al confirmar, aceptas los términos y condiciones de compra
      </Typography>
    </Paper>
  )
}

export default OrderSummary
