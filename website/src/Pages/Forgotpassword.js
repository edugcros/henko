import React, { useState, useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  CircularProgress,
} from '@mui/material'
import { requestPasswordReset, clearState } from '@features/user/userSlice'
import Container from '@components/Container'
import { useTenant } from '../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const ForgotPassword = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const { themeConfig } = useTenant()
  const themeColors = useMemo(() => getThemeColors(themeConfig || {}), [themeConfig])

  const { isLoading, isError, isSuccess, message } = useSelector(state => state.user)

  useEffect(() => {
    if (isError) {
      toast.error(message || 'Error al enviar el correo. Intenta de nuevo.')
      dispatch(clearState())
      return
    }

    if (isSuccess) {
      toast.success(message || 'Te enviamos un correo para restablecer tu contraseña.')

      setEmail('')

      const redirectTimer = window.setTimeout(() => {
        dispatch(clearState())
        navigate('/login')
      }, 5000)

      return () => {
        window.clearTimeout(redirectTimer)
      }
    }

    return undefined
  }, [isError, isSuccess, message, dispatch, navigate])

  const validateEmail = value => {
    const cleanEmail = String(value || '')
      .trim()
      .toLowerCase()
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    return regex.test(cleanEmail)
  }

  const handleSubmit = e => {
    e.preventDefault()

    const cleanEmail = email.trim().toLowerCase()

    if (!validateEmail(cleanEmail)) {
      toast.error('Por favor, ingresa un correo electrónico válido.')
      return
    }

    dispatch(requestPasswordReset(cleanEmail))
  }

  return (
    <Container>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          bgcolor: themeColors.background,
          py: 5,
        }}
      >
        <Card
          sx={{
            width: '100%',
            maxWidth: 500,
            borderRadius: 3,
            bgcolor: themeColors.surface,
          }}
        >
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h6" align="center" sx={{ mb: 1, color: themeColors.text }}>
              Restablecer Contraseña
            </Typography>

            <Typography variant="body2" align="center" sx={{ mb: 3, color: themeColors.mutedText }}>
              Ingresa tu correo electrónico para enviarte un enlace de recuperación.
            </Typography>

            <form onSubmit={handleSubmit} noValidate>
              <TextField
                fullWidth
                type="email"
                name="email"
                label="Correo electrónico"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                disabled={isLoading}
                variant="outlined"
                sx={{ mb: 3 }}
              />

              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  disabled={isLoading}
                  sx={{
                    backgroundColor: themeColors.actionPrimary,
                    color: themeColors.actionPrimaryText,
                    fontWeight: 600,
                    py: 1.2,
                    '&:hover': {
                      backgroundColor: themeColors.actionPrimary,
                      filter: 'brightness(0.92)',
                    },
                  }}
                >
                  {isLoading ? (
                    <CircularProgress size={24} sx={{ color: themeColors.actionPrimaryText }} />
                  ) : (
                    'Enviar'
                  )}
                </Button>

                <Link
                  to="/login"
                  style={{
                    textDecoration: 'none',
                    color: themeColors.actionPrimary,
                    fontSize: 14,
                  }}
                >
                  Cancelar
                </Link>
              </Box>
            </form>
          </CardContent>
        </Card>
      </Box>
    </Container>
  )
}

export default ForgotPassword
