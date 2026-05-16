// src/components/checkout/CartItemEditable.jsx
import React from 'react'
import { Box, Typography, TextField, Button, IconButton, Paper, Tooltip } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { Link } from 'react-router-dom'

const CartItemEditable = ({ item, quantity, onQuantityChange, onUpdate, onRemove, isUpdating }) => {
  const productId = item.productId?._id || item.productId
  const needsUpdate = quantity !== item.quantity

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mb: 2,
        borderRadius: '12px',
        border: '1px solid #e0e0e0',
        transition: 'all 0.2s ease',
        '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      <Box sx={{ display: 'flex', gap: 2 }}>
        {/* Imagen */}
        <Box
          sx={{
            width: 100,
            height: 100,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: '#fff',
            borderRadius: '8px',
            border: '1px solid #eee',
            overflow: 'hidden',
          }}
        >
          <img
            src={item.image}
            alt={item.title}
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
          />
        </Box>

        {/* Info */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <Typography
              component={Link}
              to={`/product/${productId}`}
              variant="subtitle1"
              sx={{
                fontWeight: 600,
                color: '#111',
                textDecoration: 'none',
                lineHeight: 1.3,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                mr: 2,
                '&:hover': { color: '#007185', textDecoration: 'underline' },
              }}
            >
              {item.title}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#000', whiteSpace: 'nowrap' }}>
              ${(item.price * item.quantity).toLocaleString()}
            </Typography>
          </Box>

          <Typography
            variant="caption"
            sx={{
              color: item.stock > 0 ? '#007600' : '#b12704',
              fontWeight: 600,
              display: 'block',
              mb: 1,
            }}
          >
            {item.stock > 0 ? 'En stock' : 'Agotado momentáneamente'}
          </Typography>

          {/* Controles */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                bgcolor: '#F0F2F2',
                borderRadius: '8px',
                px: 1.5,
                py: 0.5,
                border: '1px solid #D5D9D9',
              }}
            >
              <Typography variant="caption" sx={{ mr: 1, color: '#565959', fontWeight: 700 }}>
                Cant:
              </Typography>
              <TextField
                type="number"
                variant="standard"
                value={quantity}
                onChange={e => onQuantityChange(productId, e.target.value, item.stock)}
                disabled={isUpdating}
                InputProps={{ disableUnderline: true }}
                inputProps={{
                  min: 1,
                  max: item.stock || 999,
                  style: {
                    width: '40px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: 700,
                  },
                }}
              />
            </Box>

            {needsUpdate && (
              <Button
                size="small"
                variant="contained"
                onClick={() => onUpdate(item, quantity)}
                disabled={isUpdating}
                sx={{
                  textTransform: 'none',
                  bgcolor: '#FFD814',
                  color: '#0F1111',
                  borderRadius: '8px',
                  fontWeight: 600,
                  '&:hover': { bgcolor: '#F7CA00' },
                }}
              >
                {isUpdating ? 'Actualizando...' : 'Actualizar'}
              </Button>
            )}

            <Tooltip title="Eliminar del carrito">
              <IconButton
                onClick={() => onRemove(productId)}
                size="small"
                sx={{ color: '#007185', '&:hover': { color: '#C7511F' } }}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            ${item.price.toLocaleString()} c/u
          </Typography>
        </Box>
      </Box>
    </Paper>
  )
}

export default CartItemEditable
