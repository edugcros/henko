import React, { useState, useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams, useNavigate } from 'react-router-dom'
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
import { resetPassword, clearState } from '@features/user/userSlice'
import Container from '@components/Container'
import { useTenant } from '../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const ResetPassword = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { token } = useParams() // ✅ Captura el token de la URL
  console.log(token)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { themeConfig } = useTenant()
  const themeColors = useMemo(
    () => getThemeColors(themeConfig || {}),
    [themeConfig],
  )

  const { isLoading, isError, isSuccess, message } = useSelector(
    state => state.user,
  )

  const handleSubmit = e => {
    e.preventDefault()
    if (!password || !confirmPassword) {
      toast.error('Todos los campos son obligatorios.')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden.')
      return
    }

    // ✅ Envía el token y la nueva contraseña al backend
    dispatch(resetPassword({ token, password, confirmPassword }))
  }

  useEffect(() => {
    if (isError) {
      toast.error(message || 'Error al restablecer la contraseña.')
      dispatch(clearState())
    }
    if (isSuccess) {
      toast.success(message || 'Contraseña restablecida con éxito.')
      setTimeout(() => {
        navigate('/login')
        dispatch(clearState())
      }, 35000)
    }
  }, [isError, isSuccess, message, dispatch, navigate])

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
            <Typography
              variant="h6"
              align="center"
              sx={{ mb: 3, color: themeColors.text }}
            >
              Restablecer Contraseña
            </Typography>

            <form onSubmit={handleSubmit} noValidate>
              <TextField
                fullWidth
                type="password"
                name="password"
                label="Nueva Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                variant="outlined"
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                type="password"
                name="confirmPassword"
                label="Confirmar Contraseña"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                variant="outlined"
                sx={{ mb: 3 }}
              />

              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
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
                    <CircularProgress
                      size={24}
                      sx={{ color: themeColors.actionPrimaryText }}
                    />
                  ) : (
                    'Restablecer'
                  )}
                </Button>
              </Box>
            </form>
          </CardContent>
        </Card>
      </Box>
    </Container>
  )
}

export default ResetPassword
