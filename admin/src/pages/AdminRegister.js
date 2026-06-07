// 📁 AdminRegister.js
import React, { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useFormik } from 'formik'
import { useDispatch, useSelector } from 'react-redux'
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
  Alert,
  AlertTitle,
  InputAdornment,
  Fade,
  Chip,
  alpha,
} from '@mui/material'

import {
  Storefront,
  AdminPanelSettings,
  Email,
  Phone,
  Lock,
  RocketLaunch,
  Terminal,
  ArrowForward,
  Badge,
} from '@mui/icons-material'

import { createUserAdmin } from '@features/auth/authSlice'
import { env } from '../config/env'

// =====================================================
// Helpers
// =====================================================

const normalizeSlug = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

const PUBLIC_SIGNUP_PLANS = new Set(['starter', 'pro'])

const resolveSignupPlan = (...candidates) => {
  const selectedPlan = candidates.find(candidate =>
    PUBLIC_SIGNUP_PLANS.has(String(candidate || '').toLowerCase()),
  )

  return selectedPlan ? String(selectedPlan).toLowerCase() : 'starter'
}

const ensureUrl = value => {
  if (!value) return null

  const clean = String(value).trim()

  if (clean.startsWith('http://') || clean.startsWith('https://')) {
    return clean
  }

  return `https://${clean}`
}

const appendAdminPath = url => {
  if (!url) return null

  const clean = String(url).replace(/\/+$/, '')

  if (clean.endsWith('/admin')) return clean

  return `${clean}/admin`
}

const getHostnameFromUrl = value => {
  if (!value) return ''

  try {
    return new URL(ensureUrl(value)).hostname
  } catch {
    return String(value)
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .split(':')[0]
  }
}

// =====================================================
// Validation
// =====================================================

const validationSchema = yup.object({
  firstname: yup
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .required('El nombre es obligatorio'),

  lastname: yup
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .required('El apellido es obligatorio'),

  email: yup
    .string()
    .trim()
    .email('Correo inválido')
    .required('El correo es obligatorio'),

  mobile: yup
    .string()
    .trim()
    .min(8, 'Celular demasiado corto')
    .required('El celular es obligatorio'),

  storeName: yup
    .string()
    .trim()
    .min(3, 'Mínimo 3 caracteres')
    .max(80, 'Máximo 80 caracteres')
    .required('El nombre de la tienda es obligatorio'),

  storeSlug: yup
    .string()
    .trim()
    .lowercase()
    .min(3, 'Mínimo 3 caracteres')
    .max(60, 'Máximo 60 caracteres')
    .matches(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Usá solo letras, números y guiones. Ej: mi-tienda'
    )
    .required('El identificador de tienda es obligatorio'),

  password: yup
    .string()
    .min(8, 'Mínimo 8 caracteres')
    .required('La contraseña es obligatoria'),

  plan: yup
    .string()
    .oneOf([...PUBLIC_SIGNUP_PLANS], 'El plan seleccionado no es válido')
    .required('Seleccioná un plan'),
})

// =====================================================
// Component
// =====================================================

const AdminRegister = () => {
  const dispatch = useDispatch()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const {
    isSuccess,
    isError,
    message,
    loading = {},
    user,
  } = useSelector(state => state.user || {})

  const isLoading = loading.createAdmin === true

  const platformDomain = env.publicBaseDomain || 'henko.com'
  const isProduction = env.isProduction
  const selectedPlan = resolveSignupPlan(
    searchParams.get('plan'),
    location.state?.planId,
  )

  const formik = useFormik({
    initialValues: {
      firstname: '',
      lastname: '',
      email: '',
      mobile: '',
      storeName: '',
      storeSlug: '',
      password: '',
      plan: selectedPlan,
    },
    validationSchema,
    onSubmit: async values => {
      const payload = {
        firstname: values.firstname.trim(),
        lastname: values.lastname.trim(),
        email: values.email.trim().toLowerCase(),
        mobile: values.mobile.trim(),
        storeName: values.storeName.trim(),
        storeSlug: normalizeSlug(values.storeSlug),
        plan: values.plan || 'starter',
        password: values.password,
      }

      try {
        await dispatch(createUserAdmin(payload)).unwrap()
      } catch (err) {
        console.error('Error en el registro:', err)
      }
    },
  })

  const storefrontPreview = useMemo(() => {
    const slug = normalizeSlug(formik.values.storeSlug)

    if (!slug) return null

    return `${slug}.${platformDomain}`
  }, [formik.values.storeSlug, platformDomain])

  const adminPreview = useMemo(() => {
    const slug = normalizeSlug(formik.values.storeSlug)

    if (!slug) return null

    return `admin.${slug}.${platformDomain}`
  }, [formik.values.storeSlug, platformDomain])

  const tenantData = user?.tenant || user?.data?.tenant || null

  const shopUrl =
    tenantData?.shopUrl ||
    tenantData?.storefrontUrl ||
    tenantData?.urls?.storefront ||
    tenantData?.primaryDomain ||
    storefrontPreview

  const adminUrl =
    tenantData?.adminUrl ||
    tenantData?.urls?.admin ||
    adminPreview

  const handleGoToAdmin = () => {
    const finalUrl = appendAdminPath(ensureUrl(adminUrl))

    if (!finalUrl) {
      console.error('No se encontró la URL del administrador.')
      return
    }

    window.location.href = finalUrl
  }

  const handleStoreNameChange = event => {
    const storeName = event.target.value

    formik.setFieldValue('storeName', storeName)

    if (!formik.touched.storeSlug || !formik.values.storeSlug) {
      formik.setFieldValue('storeSlug', normalizeSlug(storeName))
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        position: 'relative',
        overflow: 'hidden',
        py: 6,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: theme => alpha(theme.palette.primary.main, 0.05),
        },
      }}
    >
      <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Fade in timeout={800}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 4, md: 6 },
              borderRadius: 8,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 40px 80px -20px rgba(0,0,0,0.08)',
              background: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <Box sx={{ textAlign: 'center', mb: 5 }}>
              <Typography
                variant="h3"
                fontWeight={900}
                color="primary"
                sx={{ letterSpacing: '-2px', mb: 1 }}
              >
                henko
              </Typography>

              <Typography
                variant="h6"
                color="text.secondary"
                fontWeight={500}
                sx={{ opacity: 0.8 }}
              >
                Creá tu tienda online
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1 }}
              >
                Tu tienda queda lista con storefront, panel admin y dominio interno.
              </Typography>
            </Box>

            {isSuccess && user ? (
              <Stack spacing={4}>
                <Alert
                  severity="success"
                  icon={<RocketLaunch />}
                  sx={{
                    borderRadius: 4,
                    fontSize: '1rem',
                    '& .MuiAlert-icon': { fontSize: 30 },
                  }}
                >
                  <AlertTitle sx={{ fontWeight: 800, fontSize: '1.1rem' }}>
                    ¡Tienda creada!
                  </AlertTitle>
                  La tienda{' '}
                  <strong>
                    {tenantData?.name || formik.values.storeName}
                  </strong>{' '}
                  fue creada correctamente.
                </Alert>

                <Box
                  sx={{
                    p: 3,
                    bgcolor: '#0f172a',
                    borderRadius: 4,
                    border: '1px solid #334155',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ mb: 2, color: '#94a3b8' }}>
                    <Terminal sx={{ fontSize: 20 }} />
                    <Typography
                      variant="caption"
                      fontWeight={800}
                      sx={{ letterSpacing: 1 }}
                    >
                      DOMINIOS CREADOS
                    </Typography>
                  </Stack>

                  <Box
                    component="code"
                    sx={{
                      color: '#38bdf8',
                      fontSize: '0.9rem',
                      fontFamily: "'JetBrains Mono', monospace",
                      lineHeight: 1.8,
                    }}
                  >
                    Storefront: {getHostnameFromUrl(shopUrl)}
                    <br />
                    Admin: {getHostnameFromUrl(adminUrl)}
                  </Box>

                  {!isProduction && (
                    <Alert severity="info" sx={{ mt: 2, borderRadius: 3 }}>
                      En desarrollo agregá estos dominios al archivo hosts de Windows.
                    </Alert>
                  )}
                </Box>

                <Button
                  variant="contained"
                  size="large"
                  onClick={handleGoToAdmin}
                  fullWidth
                  endIcon={<ArrowForward />}
                  sx={{
                    py: 2.5,
                    borderRadius: 4,
                    fontWeight: 800,
                    textTransform: 'none',
                    fontSize: '1.1rem',
                    boxShadow: theme =>
                      `0 10px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
                  }}
                >
                  Abrir Panel de Control
                </Button>
              </Stack>
            ) : (
              <form onSubmit={formik.handleSubmit}>
                <Stack spacing={3}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Nombre"
                        placeholder="Ej. Juan"
                        {...formik.getFieldProps('firstname')}
                        error={formik.touched.firstname && Boolean(formik.errors.firstname)}
                        helperText={formik.touched.firstname && formik.errors.firstname}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                      />
                    </Grid>

                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Apellido"
                        placeholder="Ej. Pérez"
                        {...formik.getFieldProps('lastname')}
                        error={formik.touched.lastname && Boolean(formik.errors.lastname)}
                        helperText={formik.touched.lastname && formik.errors.lastname}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                      />
                    </Grid>
                  </Grid>

                  <TextField
                    fullWidth
                    label="Correo"
                    {...formik.getFieldProps('email')}
                    error={formik.touched.email && Boolean(formik.errors.email)}
                    helperText={formik.touched.email && formik.errors.email}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Email color="action" />
                        </InputAdornment>
                      ),
                      sx: { borderRadius: 3 },
                    }}
                  />

                  <TextField
                    fullWidth
                    id="mobile"
                    name="mobile"
                    label="Celular"
                    placeholder="3585132769"
                    value={formik.values.mobile}
                    onChange={event => {
                      const val = event.target.value.replace(/\D/g, '')
                      const cleanedVal = val.startsWith('0') ? val.substring(1) : val
                      formik.setFieldValue('mobile', cleanedVal)
                    }}
                    onBlur={formik.handleBlur}
                    error={formik.touched.mobile && Boolean(formik.errors.mobile)}
                    helperText={
                      (formik.touched.mobile && formik.errors.mobile) ||
                      'Sin 0 y sin 15. Ej: 3585132769'
                    }
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Phone color="action" />
                        </InputAdornment>
                      ),
                      sx: { borderRadius: 3 },
                    }}
                  />

                  <TextField
                    fullWidth
                    label="Nombre de la tienda"
                    placeholder="Ej. Repuestos BMW Córdoba"
                    value={formik.values.storeName}
                    onChange={handleStoreNameChange}
                    onBlur={formik.handleBlur}
                    name="storeName"
                    error={formik.touched.storeName && Boolean(formik.errors.storeName)}
                    helperText={formik.touched.storeName && formik.errors.storeName}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Storefront color="action" />
                        </InputAdornment>
                      ),
                      sx: { borderRadius: 3 },
                    }}
                  />

                  <Box>
                    <TextField
                      fullWidth
                      label="Identificador de tienda"
                      placeholder="mi-tienda"
                      value={formik.values.storeSlug}
                      onChange={event =>
                        formik.setFieldValue('storeSlug', normalizeSlug(event.target.value))
                      }
                      onBlur={formik.handleBlur}
                      name="storeSlug"
                      error={formik.touched.storeSlug && Boolean(formik.errors.storeSlug)}
                      helperText={
                        (formik.touched.storeSlug && formik.errors.storeSlug) ||
                        'Se usará para crear tu subdominio interno.'
                      }
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Badge color="action" />
                          </InputAdornment>
                        ),
                        sx: { borderRadius: 3 },
                      }}
                    />

                    {storefrontPreview && !formik.errors.storeSlug && (
                      <Fade in>
                        <Stack spacing={1} sx={{ mt: 1.5 }}>
                          <Chip
                            icon={<Storefront />}
                            label={`Tienda: ${storefrontPreview}`}
                            color="primary"
                            variant="outlined"
                            sx={{ justifyContent: 'flex-start', fontWeight: 700 }}
                          />

                          <Chip
                            icon={<AdminPanelSettings />}
                            label={`Admin: ${adminPreview}`}
                            color="secondary"
                            variant="outlined"
                            sx={{ justifyContent: 'flex-start', fontWeight: 700 }}
                          />
                        </Stack>
                      </Fade>
                    )}
                  </Box>

                  <TextField
                    fullWidth
                    type="password"
                    label="Contraseña"
                    {...formik.getFieldProps('password')}
                    error={formik.touched.password && Boolean(formik.errors.password)}
                    helperText={formik.touched.password && formik.errors.password}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Lock color="action" />
                        </InputAdornment>
                      ),
                      sx: { borderRadius: 3 },
                    }}
                  />

                  {isError && (
                    <Alert severity="error" variant="filled" sx={{ borderRadius: 3 }}>
                      {message || 'Error creando la tienda'}
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    disabled={isLoading}
                    sx={{
                      py: 2.2,
                      borderRadius: 4,
                      fontWeight: 800,
                      fontSize: '1rem',
                      textTransform: 'none',
                      mt: 2,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                  >
                    {isLoading ? (
                      <CircularProgress size={26} color="inherit" />
                    ) : (
                      'Crear tienda'
                    )}
                  </Button>
                </Stack>
              </form>
            )}
          </Paper>
        </Fade>
      </Container>
    </Box>
  )
}

export default AdminRegister
