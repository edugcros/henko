import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import {
  Store as StoreIcon,
  Palette as PaletteIcon,
  Inventory as ProductIcon,
  Payment as PaymentIcon,
  Check as CheckIcon,
} from '@mui/icons-material'
import {
  fetchTenantSettings,
  saveTenantSettings,
  advanceOnboarding,
} from '../features/tenant/tenantSlice'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const STEPS = [
  { key: 'store', label: 'Tu tienda', icon: <StoreIcon /> },
  { key: 'theme', label: 'Apariencia', icon: <PaletteIcon /> },
  { key: 'products', label: 'Productos', icon: <ProductIcon /> },
  { key: 'payments', label: 'Pagos', icon: <PaymentIcon /> },
]

export const stepIndex = key => {
  const idx = STEPS.findIndex(s => s.key === key)
  return idx >= 0 ? idx : 0
}

const looksLikeUrl = value => /^https?:\/\//i.test(String(value || '').trim())

const StepTitle = ({ children }) => (
  <Typography
    component="h2"
    sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 22, letterSpacing: '-0.01em' }}
  >
    {children}
  </Typography>
)

const StoreStep = ({ form, setForm, errors }) => (
  <Stack spacing={3}>
    <StepTitle>Datos de tu tienda</StepTitle>
    <Typography variant="body2" color="text.secondary">
      Esta información aparece en tu tienda online y en los emails a tus clientes.
    </Typography>
    <TextField
      label="Nombre de la tienda"
      value={form.name}
      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
      error={!!errors.name}
      helperText={errors.name}
      fullWidth
      required
    />
    <TextField
      label="Descripción"
      value={form.description}
      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
      multiline
      rows={2}
      fullWidth
      slotProps={{ htmlInput: { maxLength: 300 } }}
      helperText={`${form.description.length}/300`}
    />
    <TextField
      label="Email de contacto"
      value={form.contactEmail}
      onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
      error={!!errors.contactEmail}
      helperText={errors.contactEmail}
      fullWidth
      type="email"
    />
    <TextField
      label="Teléfono de contacto"
      value={form.contactPhone}
      onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
      fullWidth
    />
    <TextField
      label="Dirección"
      value={form.address}
      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
      fullWidth
    />
  </Stack>
)

// Si la imagen no carga se avisa, y si se corrige la dirección se vuelve a intentar: antes se
// escondía tocando el elemento a mano y, una vez escondido, no volvía a aparecer.
const LogoPreview = ({ url }) => {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [url])

  if (!looksLikeUrl(url)) return null

  return (
    <Box
      sx={{
        textAlign: 'center',
        p: 2,
        bgcolor: BRAND.paper,
        border: `1px dashed ${BRAND.line}`,
        borderRadius: 3,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Vista previa
      </Typography>
      {failed ? (
        <Typography variant="body2" color="warning.main">
          No se pudo cargar la imagen: revisá la dirección.
        </Typography>
      ) : (
        <img
          src={String(url).trim()}
          alt="Vista previa del logo"
          style={{ maxWidth: 200, maxHeight: 80, objectFit: 'contain' }}
          onError={() => setFailed(true)}
        />
      )}
    </Box>
  )
}

const ThemeStep = ({ form, setForm }) => (
  <Stack spacing={3}>
    <StepTitle>Apariencia</StepTitle>
    <Typography variant="body2" color="text.secondary">
      Configurá el logo de tu tienda. Podés cambiarlo después desde Diseño Web.
    </Typography>
    <TextField
      label="URL del logo"
      value={form.logoUrl}
      onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
      fullWidth
      placeholder="https://ejemplo.com/mi-logo.png"
      helperText="Pegá la URL de tu logo (recomendado: 200x70px, PNG o SVG)"
    />
    <TextField
      label="URL del favicon"
      value={form.faviconUrl}
      onChange={e => setForm(f => ({ ...f, faviconUrl: e.target.value }))}
      fullWidth
      placeholder="https://ejemplo.com/favicon.ico"
      helperText="Icono que aparece en la pestaña del navegador"
    />
    <LogoPreview url={form.logoUrl} />
  </Stack>
)

const ProductsStep = ({ navigate }) => (
  <Stack spacing={3}>
    <StepTitle>Agregá tu primer producto</StepTitle>
    <Typography variant="body2" color="text.secondary">
      Tu tienda necesita al menos un producto para estar operativa. Podés agregar más después.
    </Typography>
    <Box>
      <Button
        variant="contained"
        startIcon={<ProductIcon />}
        onClick={() => navigate('/admin/AddProduct')}
        size="large"
        sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700, background: GRADIENT }}
      >
        Agregar producto
      </Button>
    </Box>
    <Typography variant="caption" color="text.secondary">
      Si ya tenés productos cargados, podés saltear este paso.
    </Typography>
  </Stack>
)

const PaymentsStep = ({ navigate }) => (
  <Stack spacing={3}>
    <StepTitle>Configurá tus pagos</StepTitle>
    <Typography variant="body2" color="text.secondary">
      Conectá MercadoPago para recibir pagos de tus clientes.
    </Typography>
    <Box>
      <Button
        variant="contained"
        startIcon={<PaymentIcon />}
        onClick={() => navigate('/admin/configuracion-pagos')}
        size="large"
        sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700, background: GRADIENT }}
      >
        Configurar MercadoPago
      </Button>
    </Box>
    <Typography variant="caption" color="text.secondary">
      Podés configurar los pagos más adelante si todavía no tenés las credenciales.
    </Typography>
  </Stack>
)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const OnboardingWizard = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { data: tenant, isLoading } = useSelector(s => s.tenant)

  const [activeStep, setActiveStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const [form, setForm] = useState({
    name: '',
    description: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
    logoUrl: '',
    faviconUrl: '',
  })

  useEffect(() => {
    dispatch(fetchTenantSettings())
  }, [dispatch])

  useEffect(() => {
    if (tenant) {
      setActiveStep(stepIndex(tenant.onboarding?.step || 'store'))
      setForm(f => ({
        ...f,
        name: tenant.name || '',
        description: tenant.settings?.store?.description || '',
        contactEmail: tenant.settings?.store?.contactEmail || '',
        contactPhone: tenant.settings?.store?.contactPhone || '',
        address: tenant.settings?.store?.address || '',
        logoUrl: tenant.settings?.branding?.logoUrl || '',
        faviconUrl: tenant.settings?.branding?.faviconUrl || '',
      }))
    }
  }, [tenant])

  const progress = Math.round(((activeStep + 1) / STEPS.length) * 100)

  const validateStore = () => {
    const errs = {}
    if (!form.name.trim() || form.name.trim().length < 3) errs.name = 'Mínimo 3 caracteres'
    if (form.contactEmail && !EMAIL_RE.test(form.contactEmail)) errs.contactEmail = 'Email inválido'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // Antes un error al guardar se tragaba sin decir nada: «Siguiente» no hacía nada y no había forma
  // de saber por qué.
  const failWith = err => {
    setErrorMsg(
      typeof err === 'string' && err
        ? err
        : 'No se pudieron guardar los datos. Revisalos y probá de nuevo.',
    )
    return false
  }

  const saveStoreSettings = async () => {
    if (!validateStore()) return false
    setSaving(true)
    try {
      await dispatch(
        saveTenantSettings({
          name: form.name.trim(),
          settings: {
            store: {
              description: form.description,
              contactEmail: form.contactEmail,
              contactPhone: form.contactPhone,
              address: form.address,
            },
          },
        }),
      ).unwrap()
      return true
    } catch (err) {
      return failWith(err)
    } finally {
      setSaving(false)
    }
  }

  const saveThemeSettings = async () => {
    setSaving(true)
    try {
      await dispatch(
        saveTenantSettings({
          settings: {
            branding: {
              logoUrl: form.logoUrl,
              faviconUrl: form.faviconUrl,
            },
          },
        }),
      ).unwrap()
      return true
    } catch (err) {
      return failWith(err)
    } finally {
      setSaving(false)
    }
  }

  const goNext = async () => {
    const currentKey = STEPS[activeStep].key

    setErrorMsg('')

    if (currentKey === 'store') {
      const ok = await saveStoreSettings()
      if (!ok) return
    }

    if (currentKey === 'theme') {
      const ok = await saveThemeSettings()
      if (!ok) return
    }

    const nextIdx = activeStep + 1
    if (nextIdx < STEPS.length) {
      const nextKey = STEPS[nextIdx].key
      dispatch(advanceOnboarding(nextKey))
      setActiveStep(nextIdx)
      setSuccessMsg('')
    }
  }

  const goBack = () => {
    setErrorMsg('')
    if (activeStep > 0) setActiveStep(activeStep - 1)
  }

  const finishOnboarding = async () => {
    setSaving(true)
    setErrorMsg('')
    try {
      await dispatch(advanceOnboarding('completed')).unwrap()
      setSuccessMsg('¡Listo! Terminaste la configuración inicial de tu tienda.')
      setTimeout(() => navigate('/admin'), 1500)
    } catch {
      setSuccessMsg('')
      setErrorMsg('No se pudo terminar la configuración. Probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  const currentKey = STEPS[activeStep]?.key
  const isLast = activeStep === STEPS.length - 1

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', py: { xs: 3, md: 5 }, px: 2 }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          PRIMEROS PASOS
        </Typography>
        <Typography
          component="h1"
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: { xs: 26, md: 34 },
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          Configurá tu tienda
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Completá estos pasos para dejar tu tienda lista para vender.
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ color: BRAND.muted, fontWeight: 700, mb: 1 }}>
        Paso {activeStep + 1} de {STEPS.length}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={progress}
        aria-label="Avance de la configuración"
        sx={{
          mb: 3,
          borderRadius: 999,
          height: 8,
          bgcolor: BRAND.line,
          '& .MuiLinearProgress-bar': { borderRadius: 999, background: GRADIENT },
        }}
      />

      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
        {STEPS.map(s => (
          <Step key={s.key}>
            <StepLabel icon={s.icon}>{s.label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2, borderRadius: 3 }}>
          {successMsg}
        </Alert>
      )}

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>
          {errorMsg}
        </Alert>
      )}

      <Paper
        variant="outlined"
        sx={{
          mb: 3,
          p: { xs: 2.5, md: 4 },
          borderRadius: 4,
          borderColor: BRAND.line,
          boxShadow: 'none',
        }}
      >
        {currentKey === 'store' && <StoreStep form={form} setForm={setForm} errors={errors} />}
        {currentKey === 'theme' && <ThemeStep form={form} setForm={setForm} />}
        {currentKey === 'products' && <ProductsStep navigate={navigate} />}
        {currentKey === 'payments' && <PaymentsStep navigate={navigate} />}
      </Paper>

      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          onClick={goBack}
          disabled={activeStep === 0 || saving}
          sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700 }}
        >
          Anterior
        </Button>

        <Stack direction="row" spacing={1}>
          {!isLast && (
            <Button
              variant="text"
              onClick={() => goNext()}
              disabled={saving}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Saltear
            </Button>
          )}
          {isLast ? (
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} /> : <CheckIcon />}
              onClick={finishOnboarding}
              disabled={saving}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 700,
                px: 3,
                background: saving ? undefined : GRADIENT,
              }}
            >
              Finalizar
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={goNext}
              disabled={saving}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 700,
                px: 3,
                background: saving ? undefined : GRADIENT,
              }}
            >
              {/* Texto envuelto, no desnudo: ver website/src/Pages/Login.js. */}
              {saving ? <CircularProgress size={18} /> : <span>Siguiente</span>}
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  )
}

export default OnboardingWizard
