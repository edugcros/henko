// 📁 src/pages/Login.js
import React, { useEffect } from 'react'
import { useFormik } from 'formik'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import * as yup from 'yup'
import {
  Box,
  Typography,
  TextField,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
} from '@mui/material'
import {
  loginUser,
  clearState,
  setCsrfToken,
} from '@features/user/userSlice.js'
import { fetchCsrfToken } from '@utils/axiosConfig'
import { Newprimary } from '../theme/colors'
import { useState } from 'react'

// Esquema de validación
const validationSchema = yup.object({
  email: yup
    .string()
    .email('Debe ser un correo válido')
    .required('El correo es obligatorio'),
  password: yup.string().required('La contraseña es obligatoria'),
})

const Login = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Extraemos el estado global de Redux
  const { user, token, isError, isSuccess, message } = useSelector(
    state => state.user || {},
  )

  // 1. Limpieza: Al desmontar el componente, reseteamos errores y estados de carga
  useEffect(() => {
    return () => {
      dispatch(clearState())
    }
  }, [dispatch])

  // 2. Efecto de Redirección: Solo se dispara cuando el login es exitoso
  // Cuando el login fue exitoso → obtener CSRF + redirigir
  useEffect(() => {
    if (isSuccess && (token || (user && token))) {
      fetchCsrfToken().then(csrf => {
        if (csrf) dispatch(setCsrfToken(csrf))
        navigate('/')
      })
    } else if (isError) {
      setIsSubmitting(false)
    }
  }, [isSuccess, isError, token, user, navigate, dispatch])

  // 3. Configuración de Formik
  const formik = useFormik({
    initialValues: { email: '', password: '' },
    validationSchema,
    onSubmit: async values => {
      setIsSubmitting(true)
      try {
        await dispatch(loginUser(values)).unwrap()
      } catch {
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
            variant="body2"
            align="center"
            color="text.secondary"
            sx={{ mb: 3 }}
          >
            Accedé a tu cuenta para continuar.
          </Typography>

          <form onSubmit={formik.handleSubmit} noValidate>
            <TextField
              fullWidth
              id="email"
              name="email"
              label="Correo electrónico"
              variant="outlined"
              margin="normal"
              {...formik.getFieldProps('email')}
              error={formik.touched.email && Boolean(formik.errors.email)}
              helperText={formik.touched.email && formik.errors.email}
            />

            <TextField
              fullWidth
              id="password"
              name="password"
              label="Contraseña"
              type="password"
              variant="outlined"
              margin="normal"
              {...formik.getFieldProps('password')}
              error={formik.touched.password && Boolean(formik.errors.password)}
              helperText={formik.touched.password && formik.errors.password}
            />

            <Box display="flex" justifyContent="flex-end" sx={{ mt: 1, mb: 2 }}>
              <Link
                to="/forgot-password"
                style={{
                  textDecoration: 'none',
                  color: Newprimary.darkCyan,
                  fontSize: 14,
                }}
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </Box>

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
                mt: 1,
                '&:hover': {
                  backgroundColor: '#056178',
                },
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                'Ingresar'
              )}
            </Button>

            {isError && (
              <Typography
                color="error"
                align="center"
                sx={{ mt: 2, fontSize: '0.875rem' }}
              >
                {message || 'Credenciales inválidas o error de conexión.'}
              </Typography>
            )}

            <Divider sx={{ my: 3 }} />

            <Typography align="center" variant="body2" color="text.secondary">
              ¿No tenés una cuenta?{' '}
              <Link
                to="/signup"
                style={{
                  textDecoration: 'none',
                  color: Newprimary.darkCyan,
                  fontWeight: 600,
                }}
              >
                Registrate
              </Link>
            </Typography>
          </form>
        </CardContent>
      </Card>
    </Box>
  )
}

export default Login
