// src/components/cart/CouponInput.jsx
import React, { useState } from 'react'
import {
  Box,
  TextField,
  Button,
  Chip,
  Typography,
  IconButton,
  CircularProgress,
  Alert,
  Paper,
  InputAdornment,
} from '@mui/material'
import {
  LocalOffer as CouponIcon,
  Close as CloseIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material'

const CouponInput = ({
  onApply,
  onRemove,
  appliedCoupon,
  discount,
  loading,
  disabled,
  error,
  onClearError,
}) => {
  const [code, setCode] = useState('')

  const handleSubmit = e => {
    e.preventDefault()
    if (code.trim()) {
      onApply(code.trim())
    }
  }

  const handleRemove = () => {
    setCode('')
    onRemove()
  }

  // Cupón aplicado
  if (appliedCoupon) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 2,
          bgcolor: 'success.light',
          border: '2px solid',
          borderColor: 'success.main',
          borderRadius: 2,
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Box>
            <Chip
              icon={<CheckIcon />}
              label={appliedCoupon.code}
              color="success"
              sx={{
                fontWeight: 'bold',
                fontFamily: 'monospace',
                fontSize: '1rem',
                mb: 0.5,
              }}
            />
            <Typography variant="body2" color="success.dark">
              {appliedCoupon.discountType === 'percentage'
                ? `${appliedCoupon.discountValue}% de descuento`
                : `$${discount} de descuento`}
            </Typography>
          </Box>

          <IconButton
            onClick={handleRemove}
            disabled={disabled}
            color="error"
            size="small"
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </Paper>
    )
  }

  // Input para ingresar cupón
  return (
    <Box component="form" onSubmit={handleSubmit}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={onClearError}>
          {error}
        </Alert>
      )}

      <TextField
        fullWidth
        placeholder="Código de descuento"
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        disabled={loading || disabled}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <CouponIcon color="action" />
            </InputAdornment>
          ),
          endAdornment: loading && (
            <InputAdornment position="end">
              <CircularProgress size={20} />
            </InputAdornment>
          ),
        }}
        sx={{
          '& input': {
            textTransform: 'uppercase',
            fontFamily: 'monospace',
            letterSpacing: 1,
          },
        }}
      />

      <Button
        type="submit"
        variant="contained"
        fullWidth
        disabled={!code.trim() || loading || disabled}
        sx={{ mt: 1.5 }}
      >
        {loading ? 'Validando...' : 'Aplicar cupón'}
      </Button>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mt: 1, display: 'block' }}
      >
        ¿Tienes un cupón de descuento? Ingrésalo aquí
      </Typography>
    </Box>
  )
}

export default CouponInput
