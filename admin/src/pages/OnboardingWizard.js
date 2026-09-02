import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
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

const STEPS = [
  { key: 'store', label: 'Tu tienda', icon: <StoreIcon /> },
  { key: 'theme', label: 'Apariencia', icon: <PaletteIcon /> },
  { key: 'products', label: 'Productos', icon: <ProductIcon /> },
  { key: 'payments', label: 'Pagos', icon: <PaymentIcon /> },
]

const stepIndex = key => {
  const idx = STEPS.findIndex(s => s.key === key)
  return idx >= 0 ? idx : 0
}

const StoreStep = ({ form, setForm, errors }) => (
  <Stack spacing={3}>
    <Typography variant="h6">Datos de tu tienda</Typography>
    <Typography variant="body2" color="text.secondary">
      Esta informacion aparece en tu tienda online y en los emails a tus clientes.
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
      label="Descripcion"
      value={form.description}
      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
      multiline
      rows={2}
      fullWidth
      inputProps={{ maxLength: 300 }}
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
      label="Telefono de contacto"
      value={form.contactPhone}
      onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
      fullWidth
    />
    <TextField
      label="Direccion"
      value={form.address}
      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
      fullWidth
    />
  </Stack>
)

const ThemeStep = ({ form, setForm }) => (
  <Stack spacing={3}>
    <Typography variant="h6">Apariencia</Typography>
    <Typography variant="body2" color="text.secondary">
      Configura el logo de tu tienda. Podes cambiarlo despues desde Diseno Web.
    </Typography>
    <TextField
      label="URL del logo"
      value={form.logoUrl}
      onChange={e => setForm(f => ({ ...f, logoUrl: e.target.value }))}
      fullWidth
      placeholder="https://ejemplo.com/mi-logo.png"
      helperText="Pega la URL de tu logo (recomendado: 200x70px, PNG o SVG)"
    />
    <TextField
      label="URL del favicon"
      value={form.faviconUrl}
      onChange={e => setForm(f => ({ ...f, faviconUrl: e.target.value }))}
      fullWidth
      placeholder="https://ejemplo.com/favicon.ico"
      helperText="Icono que aparece en la pestana del navegador"
    />
    {form.logoUrl && (
      <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          Vista previa
        </Typography>
        <img
          src={form.logoUrl}
          alt="Logo preview"
          style={{ maxWidth: 200, maxHeight: 80, objectFit: 'contain' }}
          onError={e => {
            e.target.style.display = 'none'
          }}
        />
      </Box>
    )}
  </Stack>
)

const ProductsStep = ({ navigate }) => (
  <Stack spacing={3}>
    <Typography variant="h6">Agrega tu primer producto</Typography>
    <Typography variant="body2" color="text.secondary">
      Tu tienda necesita al menos un producto para estar operativa. Podes agregar mas despues.
    </Typography>
    <Button
      variant="contained"
      startIcon={<ProductIcon />}
      onClick={() => navigate('/admin/AddProduct')}
      size="large"
    >
      Agregar producto
    </Button>
    <Typography variant="caption" color="text.secondary">
      Si ya tenes productos cargados, podes saltear este paso.
    </Typography>
  </Stack>
)

const PaymentsStep = ({ navigate }) => (
  <Stack spacing={3}>
    <Typography variant="h6">Configura tus pagos</Typography>
    <Typography variant="body2" color="text.secondary">
      Conecta MercadoPago para recibir pagos de tus clientes.
    </Typography>
    <Button
      variant="contained"
      startIcon={<PaymentIcon />}
      onClick={() => navigate('/admin/configuracion-pagos')}
      size="large"
    >
      Configurar MercadoPago
    </Button>
    <Typography variant="caption" color="text.secondary">
      Podes configurar los pagos mas adelante si todavia no tenes las credenciales.
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
    if (!form.name.trim() || form.name.trim().length < 3) errs.name = 'Minimo 3 caracteres'
    if (form.contactEmail && !EMAIL_RE.test(form.contactEmail)) errs.contactEmail = 'Email invalido'
    setErrors(errs)
    return Object.keys(errs).length === 0
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
    } catch {
      return false
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
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }

  const goNext = async () => {
    const currentKey = STEPS[activeStep].key

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
    if (activeStep > 0) setActiveStep(activeStep - 1)
  }

  const finishOnboarding = async () => {
    setSaving(true)
    try {
      await dispatch(advanceOnboarding('completed')).unwrap()
      setSuccessMsg('Onboarding completado')
      setTimeout(() => navigate('/admin'), 1500)
    } catch {
      setSuccessMsg('')
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
    <Box sx={{ maxWidth: 720, mx: 'auto', py: 4, px: 2 }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Configura tu tienda
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Completa estos pasos para dejar tu tienda lista para vender.
      </Typography>

      <LinearProgress
        variant="determinate"
        value={progress}
        sx={{ mb: 3, borderRadius: 1, height: 8 }}
      />

      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
        {STEPS.map(s => (
          <Step key={s.key}>
            <StepLabel icon={s.icon}>{s.label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {successMsg && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMsg}
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          {currentKey === 'store' && <StoreStep form={form} setForm={setForm} errors={errors} />}
          {currentKey === 'theme' && <ThemeStep form={form} setForm={setForm} />}
          {currentKey === 'products' && <ProductsStep navigate={navigate} />}
          {currentKey === 'payments' && <PaymentsStep navigate={navigate} />}
        </CardContent>
      </Card>

      <Stack direction="row" justifyContent="space-between">
        <Button variant="outlined" onClick={goBack} disabled={activeStep === 0 || saving}>
          Anterior
        </Button>

        <Stack direction="row" spacing={1}>
          {!isLast && (
            <Button variant="text" onClick={() => goNext()} disabled={saving}>
              Saltear
            </Button>
          )}
          {isLast ? (
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} /> : <CheckIcon />}
              onClick={finishOnboarding}
              disabled={saving}
            >
              Finalizar
            </Button>
          ) : (
            <Button variant="contained" onClick={goNext} disabled={saving}>
              {saving ? <CircularProgress size={18} /> : 'Siguiente'}
            </Button>
          )}
        </Stack>
      </Stack>
    </Box>
  )
}

export default OnboardingWizard
