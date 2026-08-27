// 📁 src/pages/Forgotpassword.js
import React, { useState } from 'react'
import { useFormik } from 'formik'
import { Link } from 'react-router-dom'
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
  email: yup
    .string()
    .email('Debe ser un correo válido')
    .required('El correo es obligatorio'),
})

const Forgotpassword = () => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState({ sent: false, error: '' })

  const formik = useFormik({
    initialValues: { email: '' },
    validationSchema,
    onSubmit: async values => {
      setIsSubmitting(true)
      setResult({ sent: false, error: '' })

      try {
        await authService.forgotPassword(values.email.trim().toLowerCase())
        // El backend siempre responde éxito exista o no la cuenta (evita
        // que este formulario sirva para confirmar qué emails están
        // registrados) — el mensaje refleja eso, no "listo, te llegó".
        setResult({ sent: true, error: '' })
      } catch (error) {
        setResult({
          sent: false,
          error:
            error?.message ||
            'No pudimos procesar la solicitud. Probá de nuevo en unos minutos.',
        })
      } finally {
        setIsSubmitting(false)
      }
    },
  })

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
            Recuperar contraseña
          </Typography>
          <Typography
            variant="body2"
            align="center"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Ingresá el correo de tu cuenta y te enviamos un enlace para
            restablecerla.
          </Typography>

          {result.sent ? (
            <Typography
              align="center"
              color="success.main"
              sx={{ fontSize: '0.9rem' }}
            >
              Si el correo existe en nuestro sistema, vas a recibir un enlace
              para restablecer tu contraseña en unos minutos.
            </Typography>
          ) : (
            <form onSubmit={formik.handleSubmit} noValidate>
              <TextField
                fullWidth
                id="email"
                name="email"
                label="Correo electrónico"
                type="email"
                variant="outlined"
                margin="normal"
                {...formik.getFieldProps('email')}
                error={formik.touched.email && Boolean(formik.errors.email)}
                helperText={formik.touched.email && formik.errors.email}
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
                  'Enviar enlace'
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

          <Typography align="center" variant="body2" sx={{ mt: 3 }}>
            <Link
              to="/login"
              style={{
                textDecoration: 'none',
                color: Newprimary.darkCyan,
                fontWeight: 600,
              }}
            >
              Volver a iniciar sesión
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}

export default Forgotpassword
