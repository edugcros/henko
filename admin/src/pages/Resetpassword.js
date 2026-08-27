// 📁 src/pages/Resetpassword.js
import React, { useState } from 'react'
import { useFormik } from 'formik'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as yup from 'yup'
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  CircularProgress,
} from '@mui/material'
import authService from '@features/auth/authServices'
import { Newprimary } from '../theme/colors'

const validationSchema = yup.object({
  password: yup
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .required('La contraseña es obligatoria'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'Las contraseñas no coinciden')
    .required('Confirmá la contraseña'),
})

const Resetpassword = () => {
  const { token } = useParams()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState({ done: false, error: '' })

  const formik = useFormik({
    initialValues: { password: '', confirmPassword: '' },
    validationSchema,
    onSubmit: async values => {
      setIsSubmitting(true)
      setResult({ done: false, error: '' })

      try {
        await authService.resetPassword({ token, password: values.password })
        setResult({ done: true, error: '' })
        setTimeout(() => navigate('/login'), 2500)
      } catch (error) {
        setResult({
          done: false,
          error: error?.message || 'Token inválido o expirado. Solicitá uno nuevo.',
        })
      } finally {
        setIsSubmitting(false)
      }
    },
  })

  if (!token) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(to bottom, #f5f5f5, #b0b0b0)',
        }}
      >
        <Card sx={{ width: 380, borderRadius: 4, p: 2 }}>
          <CardContent>
            <Typography align="center" color="error">
              El enlace de recuperación no es válido. Solicitá uno nuevo.
            </Typography>
            <Typography align="center" sx={{ mt: 2 }}>
              <Link to="/forgot-password" style={{ color: Newprimary.darkCyan }}>
                Pedir un nuevo enlace
              </Link>
            </Typography>
          </CardContent>
        </Card>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(to bottom, #f5f5f5, #b0b0b0)',
      }}
    >
      <Card
        sx={{
          width: 380,
          borderRadius: 4,
          boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Typography
            variant="h5"
            align="center"
            sx={{ fontWeight: 600, mb: 1, color: Newprimary.darkCyan }}
          >
            Restablecer contraseña
          </Typography>
          <Typography
            variant="body2"
            align="center"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Elegí tu nueva contraseña.
          </Typography>

          {result.done ? (
            <Typography
              align="center"
              color="success.main"
              sx={{ fontSize: '0.9rem' }}
            >
              Contraseña restablecida correctamente. Te redirigimos al login...
            </Typography>
          ) : (
            <form onSubmit={formik.handleSubmit} noValidate>
              <TextField
                fullWidth
                id="password"
                name="password"
                label="Nueva contraseña"
                type="password"
                variant="outlined"
                margin="normal"
                {...formik.getFieldProps('password')}
                error={formik.touched.password && Boolean(formik.errors.password)}
                helperText={formik.touched.password && formik.errors.password}
              />

              <TextField
                fullWidth
                id="confirmPassword"
                name="confirmPassword"
                label="Confirmar contraseña"
                type="password"
                variant="outlined"
                margin="normal"
                {...formik.getFieldProps('confirmPassword')}
                error={
                  formik.touched.confirmPassword &&
                  Boolean(formik.errors.confirmPassword)
                }
                helperText={
                  formik.touched.confirmPassword && formik.errors.confirmPassword
                }
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{
                  backgroundColor: Newprimary.darkCyan,
                  color: '#fff',
                  fontWeight: 600,
                  py: 1.2,
                  borderRadius: 2,
                  mt: 2,
                  '&:hover': { backgroundColor: '#056178' },
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  'Restablecer contraseña'
                )}
              </Button>

              {result.error && (
                <Typography
                  color="error"
                  align="center"
                  sx={{ mt: 2, fontSize: '0.875rem' }}
                >
                  {result.error}
                </Typography>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}

export default Resetpassword
