import React, { useEffect, useMemo } from 'react'
import { useFormik } from 'formik'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, Link } from 'react-router-dom'
import * as yup from 'yup'
import {
  Box,
  Button,
  CircularProgress,
  Container,
  TextField,
  Typography,
  Paper,
  Stack,
  Grid,
  InputAdornment,
} from '@mui/material'
import Meta from '@components/Meta'
import BreadCrumb from '@components/BreadCrumb'
import { registerUser, clearState } from '@features/user/userSlice'
import { useTenant } from '../contexts/TenantContext'
import { getThemeColors } from '@utils/themeRuntime'

const validationSchema = yup.object({
  firstname: yup.string().required('El nombre es obligatorio'),
  lastname: yup.string().required('El apellido es obligatorio'),
  email: yup.string().email('Correo inválido').required('El correo es obligatorio'),
  mobile: yup.string().required('El número de celular es obligatorio'),
  password: yup.string().required('La contraseña es obligatoria'),
})

const Signup = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { isSuccess, isError, message } = useSelector(state => state.user || {})
  const { themeConfig } = useTenant()
  const themeColors = useMemo(() => getThemeColors(themeConfig || {}), [themeConfig])

  useEffect(() => {
    dispatch(clearState())
  }, [dispatch])

  const formik = useFormik({
    initialValues: {
      firstname: '',
      lastname: '',
      email: '',
      mobile: '',
      password: '',
    },
    validationSchema,
    onSubmit: async (values, { resetForm }) => {
      try {
        await dispatch(registerUser(values)).unwrap()
        resetForm()
        dispatch(clearState())
        navigate('/login')
      } catch (error) {
        console.error('Error during registration:', error)
      }
    },
  })

  const { handleSubmit, handleChange, handleBlur, values, errors, touched, setFieldValue } = formik

  return (
    <>
      <Meta title="Registro" />
      <BreadCrumb title="Sign Up" />
      <Box
        sx={{
          minHeight: '100vh',
          background: themeColors.background,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 4,
        }}
      >
        <Container maxWidth="sm">
          <Paper
            elevation={6}
            sx={{
              p: 4,
              borderRadius: 3,
              backgroundColor: themeColors.surface,
            }}
          >
            <Typography variant="h5" align="center" fontWeight="600" gutterBottom>
              Crear cuenta
            </Typography>
            <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
              Registrate para acceder a tu cuenta
            </Typography>

            <form onSubmit={handleSubmit} noValidate>
              <Stack spacing={2}>
                {/* Nombre, Apellido y Celular en una fila en md+ */}
                <Grid container spacing={2}>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      id="firstname"
                      name="firstname"
                      label="Nombre"
                      value={values.firstname}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      error={touched.firstname && Boolean(errors.firstname)}
                      helperText={touched.firstname && errors.firstname}
                      variant="outlined"
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      id="lastname"
                      name="lastname"
                      label="Apellido"
                      value={values.lastname}
                      onChange={handleChange}
                      onBlur={handleBlur}
                      error={touched.lastname && Boolean(errors.lastname)}
                      helperText={touched.lastname && errors.lastname}
                      variant="outlined"
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField
                      fullWidth
                      id="mobile"
                      name="mobile"
                      label="Celular"
                      // Mostramos ayuda clara para el formato argentino
                      placeholder="3585132769"
                      value={values.mobile}
                      onChange={e => {
                        // Limpieza en tiempo real: solo números y quitar el '0' o '15' inicial si lo pegan
                        const val = e.target.value.replace(/\D/g, '')
                        const cleanedVal = val.startsWith('0') ? val.substring(1) : val
                        // Actualizamos Formik manualmente para asegurar la limpieza
                        setFieldValue('mobile', cleanedVal)
                      }}
                      onBlur={handleBlur}
                      error={touched.mobile && Boolean(errors.mobile)}
                      helperText={
                        (touched.mobile && errors.mobile) || 'Sin 0 y sin 15. Ej: 3585132769'
                      }
                      variant="outlined"
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Typography color="text.secondary" variant="body2">
                              +54 9
                            </Typography>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Grid>
                </Grid>

                {/* Email */}
                <TextField
                  fullWidth
                  id="email"
                  name="email"
                  label="Correo electrónico"
                  value={values.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  error={touched.email && Boolean(errors.email)}
                  helperText={touched.email && errors.email}
                  variant="outlined"
                />

                {/* Contraseña */}
                <TextField
                  fullWidth
                  id="password"
                  name="password"
                  label="Contraseña"
                  type="password"
                  value={values.password}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  error={touched.password && Boolean(errors.password)}
                  helperText={touched.password && errors.password}
                  variant="outlined"
                />

                {/* Mensajes de error o éxito */}
                {isError && (
                  <Typography variant="body2" color="error" align="center">
                    {message || 'Error al registrarse'}
                  </Typography>
                )}
                {isSuccess && (
                  <Typography variant="body2" color="success.main" align="center">
                    Usuario registrado correctamente
                  </Typography>
                )}

                {/* Botón de envío */}
                <Button
                  type="submit"
                  fullWidth
                  variant="contained"
                  sx={{
                    backgroundColor: themeColors.actionPrimary,
                    color: themeColors.actionPrimaryText,
                    fontWeight: 600,
                    '&:hover': {
                      backgroundColor: themeColors.actionPrimary,
                      filter: 'brightness(0.92)',
                    },
                    py: 1.2,
                    borderRadius: 2,
                  }}
                >
                  {formik.isSubmitting ? (
                    <CircularProgress size={24} sx={{ color: themeColors.actionPrimaryText }} />
                  ) : (
                    'Registrarse'
                  )}
                </Button>

                {/* Link a login */}
                <Typography variant="body2" align="center" color="text.secondary">
                  ¿Ya tenés cuenta?{' '}
                  <Link
                    to="/login"
                    style={{
                      textDecoration: 'none',
                      color: themeColors.actionPrimary,
                    }}
                  >
                    Iniciar sesión
                  </Link>
                </Typography>
              </Stack>
            </form>
          </Paper>
        </Container>
      </Box>
    </>
  )
}

export default Signup
