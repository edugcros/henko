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
import { loginUser, clearState, setCsrfToken } from '@features/auth/authSlice'
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import { Newprimary } from '../theme/colors'
import { useState } from 'react'

// Esquema de validación
const validationSchema = yup.object({
  email: yup.string().email('Debe ser un correo válido').required('El correo es obligatorio'),
  password: yup.string().required('La contraseña es obligatoria'),
})

const Login = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Extraemos el estado global de Redux
  const { user, isError, isSuccess, message, isNotVerified } = useSelector(
    state => state.user || {},
  )

  const [resendState, setResendState] = useState({
    sending: false,
    message: '',
    error: false,
  })

  const handleResendVerification = async () => {
    setResendState({ sending: true, message: '', error: false })

    try {
      const { data } = await api.post('/user/resend-verification', {
        email: formik.values.email,
      })

      setResendState({
        sending: false,
        error: false,
        message: data?.message || 'Listo, revisá tu correo.',
      })
    } catch (error) {
      setResendState({
        sending: false,
        error: true,
        message:
          error?.response?.data?.message ||
          'No pudimos reenviar el correo. Probá de nuevo en unos minutos.',
      })
    }
  }

  // 1. Limpieza: Al desmontar el componente, reseteamos errores y estados de carga
  useEffect(() => {
    return () => {
      dispatch(clearState())
    }
  }, [dispatch])

  // 2. Efecto de Redirección: Solo se dispara cuando el login es exitoso
  // Cuando el login fue exitoso → obtener CSRF + redirigir
  //
  // Antes esto dependía de `token` (leído de Redux) para decidir si
  // redirigir — desde la fase 2 del refactor de JWT, el token ya no vive
  // en Redux (es una cookie httpOnly), así que `token` quedó
  // permanentemente undefined y este efecto nunca disparaba: el login
  // "funcionaba" (el usuario quedaba autenticado en Redux) pero la
  // pantalla se quedaba trabada en el spinner para siempre.
  // loginUser.fulfilled ya setea isSuccess y user juntos, así que alcanza
  // con eso para saber que el login anduvo.
  useEffect(() => {
    if (isSuccess && user) {
      fetchCsrfToken().then(csrf => {
        if (csrf) dispatch(setCsrfToken(csrf))
        navigate('/')
      })
    } else if (isError) {
      setIsSubmitting(false)
    }
  }, [isSuccess, isError, user, navigate, dispatch])

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
            variant="h5"
            align="center"
            sx={{ fontWeight: 600, mb: 1, color: Newprimary.darkCyan }}
          >
            Panel de Administración
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
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

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, mb: 2 }}>
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
              {isSubmitting ? <CircularProgress size={24} color="inherit" /> : 'Ingresar'}
            </Button>

            {isError && !isNotVerified && (
              <Typography color="error" align="center" sx={{ mt: 2, fontSize: '0.875rem' }}>
                {message || 'Credenciales inválidas o error de conexión.'}
              </Typography>
            )}

            {/* Cuenta sin verificar: no es un error de credenciales, es una
                cuenta a medio activar. Sin esta salida el correo perdido
                dejaba al comercio afuera para siempre — el alta rechaza el
                email repetido y el login no lo deja pasar. */}
            {isError && isNotVerified && (
              <Box sx={{ mt: 2 }}>
                <Typography align="center" sx={{ fontSize: '0.875rem', mb: 1.5 }}>
                  {message}
                </Typography>

                {resendState.message && (
                  <Typography
                    align="center"
                    color={resendState.error ? 'error' : 'success.main'}
                    sx={{ fontSize: '0.8rem', mb: 1.5 }}
                  >
                    {resendState.message}
                  </Typography>
                )}

                <Button
                  fullWidth
                  variant="outlined"
                  disabled={resendState.sending || !formik.values.email}
                  onClick={handleResendVerification}
                  sx={{ textTransform: 'none' }}
                >
                  {resendState.sending ? 'Enviando...' : 'Reenviar correo de verificación'}
                </Button>
              </Box>
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
