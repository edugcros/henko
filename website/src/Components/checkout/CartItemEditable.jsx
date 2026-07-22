// src/components/checkout/CartItemEditable.jsx
import React, { useMemo } from 'react'
import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Paper,
  Tooltip,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { Link } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { useTenant } from '../../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const CartItemEditable = ({
  item,
  quantity,
  onQuantityChange,
  onUpdate,
  onRemove,
  isUpdating,
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

  const themeColors = useMemo(
    () => getThemeColors(activeConfig),
    [activeConfig],
  )

  const productId = item.productId?._id || item.productId
  const needsUpdate = quantity !== item.quantity

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mb: 2,
        borderRadius: '12px',
        border: `1px solid ${themeColors.cardBorder}`,
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
            bgcolor: themeColors.cardBackground,
            borderRadius: '8px',
            border: `1px solid ${themeColors.cardBorder}`,
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
                color: themeColors.cardText,
                textDecoration: 'none',
                lineHeight: 1.3,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                mr: 2,
                '&:hover': {
                  color: themeColors.actionPrimary,
                  textDecoration: 'underline',
                },
              }}
            >
              {item.title}
            </Typography>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: themeColors.price,
                whiteSpace: 'nowrap',
              }}
            >
              ${(item.price * item.quantity).toLocaleString()}
            </Typography>
          </Box>

          <Typography
            variant="caption"
            sx={{
              color: item.stock > 0 ? themeColors.success : themeColors.error,
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
                bgcolor: themeColors.surface,
                borderRadius: '8px',
                px: 1.5,
                py: 0.5,
                border: `1px solid ${themeColors.cardBorder}`,
              }}
            >
              <Typography
                variant="caption"
                sx={{ mr: 1, color: themeColors.mutedText, fontWeight: 700 }}
              >
                Cant:
              </Typography>
              <TextField
                type="number"
                variant="standard"
                value={quantity}
                onChange={e =>
                  onQuantityChange(productId, e.target.value, item.stock)
                }
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
                  bgcolor: themeColors.actionPrimary,
                  color: themeColors.actionPrimaryText,
                  borderRadius: '8px',
                  fontWeight: 600,
                  '&:hover': {
                    bgcolor: themeColors.actionPrimary,
                    filter: 'brightness(0.92)',
                  },
                }}
              >
                {isUpdating ? 'Actualizando...' : 'Actualizar'}
              </Button>
            )}

            <Tooltip title="Eliminar del carrito">
              <IconButton
                onClick={() => onRemove(productId)}
                size="small"
                sx={{
                  color: themeColors.actionPrimary,
                  '&:hover': { color: themeColors.error },
                }}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Tooltip>
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 0.5 }}
          >
            ${item.price.toLocaleString()} c/u
          </Typography>
        </Box>
      </Box>
    </Paper>
  )
}

export default CartItemEditable
