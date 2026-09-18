// 📁 AdminRegister.js
import React, { useMemo, useRef, useState } from 'react'
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
import TurnstileWidget from '../components/TurnstileWidget'
import { env } from '../config/env'
import { SELLABLE_PLANS } from '../constants/plans.js'

// =====================================================
// Helpers
// =====================================================

/**
 * Limpia el identificador dejando lo que el backend acepta.
 *
 * NO recorta los guiones de los extremos, y eso es deliberado: ver
 * normalizeSlugFinal.
 */
const normalizeSlug = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
}

/**
 * La forma definitiva, para cuando el identificador deja de editarse.
 *
 * POR QU\u00c9 EL RECORTE VA AC\u00c1 Y NO EN CADA TECLA
 *
 * Quitar los guiones de los extremos corriendo en cada onChange hace imposible
 * escribir un identificador con guiones: se tipea "prueba-", el guion queda al
 * final, se borra, y la letra siguiente se pega \u2014 "pruebaqa2" en vez de
 * "prueba-qa-2".
 *
 * Pas\u00f3 en producci\u00f3n el 18/09/2026: se quiso registrar "prueba-qa-2" y no se
 * pudo escribir. El placeholder del campo dice "mi-tienda", o sea que el
 * formulario sugiere exactamente lo que imped\u00eda tipear.
 *
 * Un guion colgando mientras alguien escribe es un estado intermedio leg\u00edtimo.
 * Lo que no puede salir con guiones sueltos es el valor que se env\u00eda.
 */
const normalizeSlugFinal = value => normalizeSlug(value).replace(/(^-|-$)+/g, '')

const RESERVED_SLUGS = new Set([
  'api',
  'admin',
  'www',
  'mail',
  'smtp',
  'imap',
  'pop',
  'ftp',
  'sftp',
  'ssh',
  'cdn',
  'assets',
  'static',
  'media',
  'ns1',
  'ns2',
  'ns3',
  'dns',
  'mx',
  'autoconfig',
  'autodiscover',
  'webmail',
  'cpanel',
  'whm',
  'cgi',
  'status',
  'health',
  'blog',
  'docs',
  'support',
  'help',
  'app',
  'dashboard',
  'login',
  'signup',
  'register',
  'auth',
  'oauth',
  'sso',
  'graphql',
  'ws',
  'wss',
  'socket',
  'realtime',
  'test',
  'staging',
  'dev',
  'demo',
  'sandbox',
  'preview',
  'null',
  'undefined',
  'root',
  'system',
  'platform',
  'billing',
  'payment',
  'checkout',
  'store',
  'shop',
  'henko',
  'noreply',
  'no-reply',
  'postmaster',
  'abuse',
])

// Distancia de edición simple (Levenshtein) para atrapar typos de slugs
// reservados críticos (ej. "henkoo", "henk0" en vez de "henko") — debe
// coincidir con backend/src/utils/domainUtils.js.
const levenshteinDistance = (a, b) => {
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)])
  matrix[0] = Array.from({ length: cols }, (_, j) => j)

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  return matrix[rows - 1][cols - 1]
}

const TYPO_SENSITIVE_SLUGS = ['henko']
const TYPO_DISTANCE_THRESHOLD = 1

const isReservedSlug = slug => {
  const normalized = normalizeSlugFinal(slug)

  if (RESERVED_SLUGS.has(normalized)) return true

  return TYPO_SENSITIVE_SLUGS.some(
    reserved => levenshteinDistance(normalized, reserved) <= TYPO_DISTANCE_THRESHOLD,
  )
}

// Qué planes se pueden contratar sale de constants/plans.js. Acá había una
// cuarta lista con los mismos dos valores: agregar un plan obligaba a acordarse
// de este archivo, y olvidarse significaba que el alta lo rechazara en silencio
// y cayera al starter.
const resolveSignupPlan = (...candidates) => {
  const selectedPlan = candidates.find(candidate =>
    SELLABLE_PLANS.includes(String(candidate || '').toLowerCase()),
  )

  return selectedPlan ? String(selectedPlan).toLowerCase() : SELLABLE_PLANS[0]
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

const buildTenantDomainPreview = ({ slug, publicBaseDomain, adminBaseDomain }) => {
  const normalizedSlug = normalizeSlugFinal(slug)
  const publicBase = getHostnameFromUrl(publicBaseDomain)
  const adminBase = getHostnameFromUrl(adminBaseDomain)

  if (!normalizedSlug || !publicBase) {
    return { storefront: null, admin: null }
  }

  const storefront =
    publicBase === normalizedSlug || publicBase.startsWith(`${normalizedSlug}.`)
      ? publicBase
      : `${normalizedSlug}.${publicBase}`

  // EL PANEL ES COMPARTIDO — ESTA VISTA PREVIA PROMETÍA UNA URL INEXISTENTE
  //
  // Acá había una copia de la lógica vieja del backend, que para un adminBase
  // subdominio de la raíz devolvía admin.<slug>.<raíz>. Son DOS niveles, y un
  // certificado comodín cubre uno solo: admin.kiosco.henkart.com.ar falla el
  // handshake TLS.
  //
  // El backend dejó de asignar ese dominio (buildPlatformTenantDomains), pero
  // esta copia quedó atrás y el formulario le seguía mostrando al comerciante
  // la dirección de panel que no iba a poder abrir.
  //
  // Todos los comercios entran por el mismo panel y el comercio sale de la
  // sesión, así que la respuesta es siempre adminBase. Si no hay adminBase
  // configurado no se inventa ninguno: mostrar admin.<tienda> sería volver a
  // prometer los dos niveles.
  return {
    storefront,
    admin: adminBase || null,
  }
}

// =====================================================
// Validation
// =====================================================

const validationSchema = yup.object({
  firstname: yup.string().trim().min(2, 'Mínimo 2 caracteres').required('El nombre es obligatorio'),

  lastname: yup
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .required('El apellido es obligatorio'),

  email: yup.string().trim().email('Correo inválido').required('El correo es obligatorio'),

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
    .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usá solo letras, números y guiones. Ej: mi-tienda')
    .test(
      'not-reserved',
      'Ese identificador está reservado. Elegí otro.',
      value => !value || !isReservedSlug(value),
    )
    .required('El identificador de tienda es obligatorio'),

  password: yup.string().min(8, 'Mínimo 8 caracteres').required('La contraseña es obligatoria'),

  plan: yup
    .string()
    .oneOf([...SELLABLE_PLANS], 'El plan seleccionado no es válido')
    .required('Seleccioná un plan'),
})

// =====================================================
// Component
// =====================================================

const AdminRegister = () => {
  const dispatch = useDispatch()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const { isSuccess, isError, message, loading = {}, user } = useSelector(state => state.user || {})

  const isLoading = loading.createAdmin === true
  const [turnstileToken, setTurnstileToken] = useState('')
  const [captchaError, setCaptchaError] = useState('')

  // Pendiente solo mientras el desafío TODAVÍA puede resolverse. Si falló, el
  // botón deja de estar bloqueado por él: el visitante no puede hacer nada
  // para conseguir un token, y dejarlo deshabilitado sin explicación es la
  // pantalla muerta que este formulario tenía. Se deja intentar y, si el
  // backend exige el token, contesta un error que al menos se lee.
  const captchaPending =
    Boolean(env.turnstileSiteKey) && !turnstileToken && !captchaError

  // Si el reintento funciona, el aviso de fallo tiene que irse: dejarlo puesto
  // haría que alguien que YA resolvió el desafío siga leyendo que algo anda mal.
  const setCaptchaToken = React.useCallback(token => {
    setTurnstileToken(token)
    setCaptchaError('')
  }, [])

  const platformDomain = env.publicBaseDomain || env.productionDomain || ''
  const isProduction = env.isProduction
  const selectedPlan = resolveSignupPlan(searchParams.get('plan'), location.state?.planId)

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
        storeSlug: normalizeSlugFinal(values.storeSlug),
        plan: values.plan || 'starter',
        password: values.password,
        turnstileToken,
      }

      try {
        await dispatch(createUserAdmin(payload)).unwrap()
      } catch (err) {
        console.error('Error en el registro:', err)
      }
    },
  })

  const domainPreview = useMemo(
    () =>
      buildTenantDomainPreview({
        slug: formik.values.storeSlug,
        publicBaseDomain: platformDomain,
        adminBaseDomain: env.adminBaseDomain,
      }),
    [formik.values.storeSlug, platformDomain],
  )

  const storefrontPreview = domainPreview.storefront
  const adminPreview = domainPreview.admin

  const tenantData = user?.tenant || user?.data?.tenant || null

  const shopUrl =
    tenantData?.shopUrl ||
    tenantData?.storefrontUrl ||
    tenantData?.urls?.storefront ||
    tenantData?.primaryDomain ||
    storefrontPreview

  const adminUrl = tenantData?.adminUrl || tenantData?.urls?.admin || adminPreview

  const handleGoToAdmin = () => {
    const finalUrl = appendAdminPath(ensureUrl(adminUrl))

    if (!finalUrl) {
      console.error('No se encontró la URL del administrador.')
      return
    }

    window.location.href = finalUrl
  }

  // POR QUÉ NO ALCANZA CON formik.touched
  //
  // touched se marca en el BLUR, y el campo del identificador escribe con
  // setFieldValue, que tampoco lo marca. O sea que alguien podía tipear su
  // identificador, volver a retocar el nombre de la tienda sin haber salido
  // del campo, y el nombre le pisaba el identificador en silencio.
  //
  // Pasó en producción el 18/09/2026: se pidió "prueba-qa-2" y el comercio
  // quedó como "tienda-de-prueba-qa". No es cosmético — el identificador es la
  // dirección pública de la tienda, y se lo cambiamos sin avisar.
  //
  // Va en una ref y no en estado: no hay que volver a renderizar por esto, y
  // el valor tiene que estar disponible en el mismo tick del onChange.
  const identificadorEscritoAMano = useRef(false)

  const handleStoreNameChange = event => {
    const storeName = event.target.value

    formik.setFieldValue('storeName', storeName)

    // Mientras el identificador siga siendo el sugerido, acompaña al nombre.
    // Apenas alguien lo escribe, deja de tocarse.
    if (!identificadorEscritoAMano.current) {
      formik.setFieldValue('storeSlug', normalizeSlugFinal(storeName))
    }
  }

  const handleStoreSlugChange = event => {
    // Vaciarlo vuelve a delegar en el nombre: es la forma natural de decir
    // "no quiero elegirlo yo".
    identificadorEscritoAMano.current = event.target.value.trim() !== ''

    // Mientras se escribe NO se recortan los guiones de los extremos, o sería
    // imposible tipear "prueba-qa-2". Se recortan al salir del campo.
    formik.setFieldValue('storeSlug', normalizeSlug(event.target.value))
  }

  const handleStoreSlugBlur = event => {
    formik.setFieldValue('storeSlug', normalizeSlugFinal(event.target.value))
    formik.handleBlur(event)
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

                color="primary"
                sx={{ fontWeight: 900, letterSpacing: '-2px', mb: 1 }}
              >
                henko
              </Typography>

              <Typography
                variant="h6"
                color="text.secondary"

                sx={{ fontWeight: 500, opacity: 0.8 }}
              >
                Creá tu tienda online
              </Typography>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
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
                  La tienda <strong>{tenantData?.name || formik.values.storeName}</strong> fue
                  creada correctamente.
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
                    <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 1 }}>
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
                    boxShadow: theme => `0 10px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
                  }}
                >
                  Abrir Panel de Control
                </Button>
              </Stack>
            ) : (
              <form onSubmit={formik.handleSubmit}>
                <Stack spacing={3}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>
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

                    <Grid size={{ xs: 12, sm: 6 }}>
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
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Email color="action" />
                          </InputAdornment>
                        ),
                        sx: { borderRadius: 3 },
                      },
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
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Phone color="action" />
                          </InputAdornment>
                        ),
                        sx: { borderRadius: 3 },
                      },
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
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Storefront color="action" />
                          </InputAdornment>
                        ),
                        sx: { borderRadius: 3 },
                      },
                    }}
                  />

                  <Box>
                    <TextField
                      fullWidth
                      label="Identificador de tienda"
                      placeholder="mi-tienda"
                      value={formik.values.storeSlug}
                      onChange={handleStoreSlugChange}
                      onBlur={handleStoreSlugBlur}
                      name="storeSlug"
                      error={formik.touched.storeSlug && Boolean(formik.errors.storeSlug)}
                      helperText={
                        (formik.touched.storeSlug && formik.errors.storeSlug) ||
                        'Se usará para crear tu subdominio interno.'
                      }
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <Badge color="action" />
                            </InputAdornment>
                          ),
                          sx: { borderRadius: 3 },
                        },
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
                            sx={{
                              justifyContent: 'flex-start',
                              fontWeight: 700,
                            }}
                          />

                          <Chip
                            icon={<AdminPanelSettings />}
                            label={`Admin: ${adminPreview}`}
                            color="secondary"
                            variant="outlined"
                            sx={{
                              justifyContent: 'flex-start',
                              fontWeight: 700,
                            }}
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
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Lock color="action" />
                          </InputAdornment>
                        ),
                        sx: { borderRadius: 3 },
                      },
                    }}
                  />

                  {env.turnstileSiteKey && (
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <TurnstileWidget
                        siteKey={env.turnstileSiteKey}
                        onVerify={token => {
                          setCaptchaToken(token)
                        }}
                        onExpire={() => setTurnstileToken('')}
                        onError={setCaptchaError}
                      />
                    </Box>
                  )}

                  {captchaError && (
                    <Alert
                      severity="warning"
                      variant="outlined"
                      sx={{ borderRadius: 3 }}
                    >
                      No pudimos verificar que no seas un robot. Podés intentar
                      crear la tienda igual; si no funciona, recargá la página o
                      probá desde otra red.
                    </Alert>
                  )}

                  {isError && (
                    <Alert severity="error" variant="filled" sx={{ borderRadius: 3 }}>
                      {message || 'Error creando la tienda'}
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    disabled={isLoading || captchaPending}
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
                    {isLoading ? <CircularProgress size={26} color="inherit" /> : 'Crear tienda'}
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
