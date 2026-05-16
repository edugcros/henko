// src/components/cart/CartItemsList.jsx
import React from 'react'
import {
  Box,
  Typography,
  IconButton,
  Button,
  Paper,
  Stack,
  Chip,
  Divider,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  Image as ImageIcon,
  ShoppingCart as EmptyCartIcon,
} from '@mui/icons-material'

const icons = {
  delete: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  ),
  add: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  ),
  remove: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M19 13H5v-2h14v2z" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" width="80" height="80" fill="currentColor">
      <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" />
    </svg>
  ),
}

const CartItemsList = ({ items, onUpdateQuantity, onRemove }) => {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))

  if (!items || items.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 6,
          textAlign: 'center',
          bgcolor: 'grey.50',
          borderRadius: 3,
        }}
      >
        <EmptyCartIcon sx={{ fontSize: 80, color: 'grey.400', mb: 2 }} />
        <Typography variant="h6" color="text.secondary" gutterBottom>
          Tu carrito está vacío
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Agrega algunos productos para comenzar
        </Typography>
        <Button variant="contained" href="/products" size="large">
          Ver productos
        </Button>
      </Paper>
    )
  }

  const formatPrice = price => `$${(price || 0).toFixed(2)}`

  return (
    <Stack spacing={2}>
      {items.map(item => (
        <Paper
          key={item.id || item._id}
          elevation={1}
          sx={{
            p: 2,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: 2,
            alignItems: isMobile ? 'stretch' : 'center',
            position: 'relative',
            transition: 'box-shadow 0.2s',
            '&:hover': {
              boxShadow: 3,
            },
          }}
        >
          {/* Imagen */}
          <Box
            sx={{
              width: isMobile ? '100%' : 80,
              height: isMobile ? 200 : 80,
              borderRadius: 2,
              overflow: 'hidden',
              bgcolor: 'grey.100',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {item.image || item.images?.[0] ? (
              <Box
                component="img"
                src={item.image || item.images[0]}
                alt={item.name || item.title}
                onError={e => {
                  e.target.onerror = null
                  e.target.src = '/placeholder-product.png'
                }}
                sx={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <ImageIcon sx={{ fontSize: 40, color: 'grey.400' }} />
            )}
          </Box>

          {/* Info del producto */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} noWrap sx={{ mb: 0.5 }}>
              {item.name || item.title}
            </Typography>

            {item.sku && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                fontFamily="monospace"
              >
                SKU: {item.sku}
              </Typography>
            )}

            {item.category && (
              <Chip
                label={item.category}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ mt: 1, height: 24 }}
              />
            )}

            {/* Precio mobile */}
            {isMobile && (
              <Typography variant="h6" color="primary" sx={{ mt: 1 }}>
                {formatPrice(item.price)}
              </Typography>
            )}
          </Box>

          {/* Precio desktop */}
          {!isMobile && (
            <Box sx={{ textAlign: 'center', minWidth: 100 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Precio
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {formatPrice(item.price)}
              </Typography>
            </Box>
          )}

          {/* Cantidad */}
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Cantidad
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                justifyContent: 'center',
              }}
            >
              <IconButton
                size="small"
                onClick={() => onUpdateQuantity?.(item.id, (item.quantity || 1) - 1)}
                disabled={(item.quantity || 1) <= 1}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  '&:hover:not(:disabled)': {
                    borderColor: 'primary.main',
                    color: 'primary.main',
                  },
                }}
              >
                <RemoveIcon fontSize="small" />
              </IconButton>

              <Typography
                variant="body1"
                fontWeight={600}
                sx={{ minWidth: 40, textAlign: 'center' }}
              >
                {item.quantity || 1}
              </Typography>

              <IconButton
                size="small"
                onClick={() => onUpdateQuantity?.(item.id, (item.quantity || 1) + 1)}
                disabled={(item.quantity || 1) >= (item.stock || 99)}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  '&:hover:not(:disabled)': {
                    borderColor: 'primary.main',
                    color: 'primary.main',
                  },
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>

            {item.stock <= 5 && item.stock > 0 && (
              <Chip
                label={`¡Solo ${item.stock} disponibles!`}
                size="small"
                color="warning"
                sx={{ mt: 1, height: 20, fontSize: 11 }}
              />
            )}
          </Box>

          {/* Subtotal desktop */}
          {!isMobile && (
            <Box sx={{ textAlign: 'center', minWidth: 100 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                Subtotal
              </Typography>
              <Typography variant="body1" fontWeight={700} color="primary">
                {formatPrice((item.price || 0) * (item.quantity || 1))}
              </Typography>
            </Box>
          )}

          {/* Subtotal mobile */}
          {isMobile && (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mt: 1,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                Subtotal
              </Typography>
              <Typography variant="h6" fontWeight={700} color="primary">
                {formatPrice((item.price || 0) * (item.quantity || 1))}
              </Typography>
            </Box>
          )}

          {/* Eliminar */}
          <IconButton
            onClick={() => onRemove?.(item.id)}
            color="error"
            sx={{
              bgcolor: 'error.light',
              color: 'error.main',
              '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' },
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Paper>
      ))}

      {/* Resumen móvil */}
      {isMobile && (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            bgcolor: 'primary.light',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography variant="body2">{items.length} productos</Typography>
          <Typography variant="h6" fontWeight={700} color="primary">
            Total: {formatPrice(items.reduce((sum, item) => sum + item.price * item.quantity, 0))}
          </Typography>
        </Paper>
      )}
    </Stack>
  )
}

export default CartItemsList
