// src/components/checkout/OrderSummary.jsx
import React from 'react'
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

const OrderSummary = ({ cart, discount = 0, shipping = 0, onCheckout, loading }) => {
  const subtotal =
    cart.items?.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0) || 0

  const total = Math.max(0, subtotal - discount + shipping)

  const summaryItems = [
    { label: 'Subtotal', value: subtotal },
    {
      label: 'Descuento',
      value: -discount,
      color: '#007600',
      showIfZero: false,
    },
    {
      label: 'Envío',
      value: shipping,
      color: shipping === 0 ? '#007600' : 'inherit',
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
              <Typography variant="body1" fontWeight={600} color={item.color || 'inherit'}>
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
        <Typography variant="h5" fontWeight={700} color="#B12704">
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
          bgcolor: '#FFD814',
          color: '#0F1111',
          fontWeight: 700,
          textTransform: 'none',
          fontSize: '1rem',
          '&:hover': { bgcolor: '#F7CA00' },
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
