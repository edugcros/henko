import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  Save as SaveIcon,
  Payment as PaymentIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material'
import { getPaymentConfig, updatePaymentConfig } from '../services/paymentConfigService.js'

const MODE_OPTIONS = [
  { value: 'test', label: 'Test (sandbox)' },
  { value: 'production', label: 'Producción' },
]

const clean = value => String(value ?? '').trim()

const toForm = data => {
  const mp = data?.mercadopago || {}
  return {
    mode: mp.mode || 'test',
    publicKey: mp.publicKey || '',
    accessToken: '',
    isEnabled: Boolean(mp.isEnabled),
    hasAccessToken: Boolean(mp.hasAccessToken),
    connectedAt: mp.connectedAt || null,
    updatedAt: mp.updatedAt || null,
  }
}

const toPayload = form => {
  const mercadopago = {
    mode: form.mode,
    publicKey: clean(form.publicKey),
    isEnabled: form.isEnabled,
  }
  if (clean(form.accessToken)) {
    mercadopago.accessToken = clean(form.accessToken)
  }
  return { mercadopago }
}

const SectionCard = ({ title, subtitle, icon, children }) => (
  <Card variant="outlined" sx={{ borderRadius: 3 }}>
    <CardContent>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
        {icon}
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Stack>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {subtitle}
        </Typography>
      )}
      <Divider sx={{ mb: 2.5 }} />
      {children}
    </CardContent>
  </Card>
)

const PaymentConfigPage = () => {
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await getPaymentConfig()
      setForm(toForm(data))
    } catch (err) {
      console.error('[PAYMENT_CONFIG_LOAD_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar la configuración de pagos.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setField = useCallback((key, value) => setForm(prev => ({ ...prev, [key]: value })), [])

  const handleSave = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setError('')
    try {
      const data = await updatePaymentConfig(toPayload(form))
      setForm(toForm(data))
      setSnackbar({
        open: true,
        severity: 'success',
        message: 'Configuración de pagos guardada.',
      })
    } catch (err) {
      console.error('[PAYMENT_CONFIG_SAVE_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudo guardar la configuración.',
      )
    } finally {
      setSaving(false)
    }
  }, [form])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!form) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" action={<Button onClick={load}>Reintentar</Button>}>
          {error || 'No se pudo cargar la configuración.'}
        </Alert>
      </Box>
    )
  }

  const secretHelp = form.hasAccessToken
    ? 'Ya hay un token guardado. Dejá en blanco para no cambiarlo.'
    : 'Pegá el Access Token de tu aplicación de Mercado Pago.'

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 980, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }} 
        
        spacing={2}
        
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Configuración de Pagos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Conectá tu cuenta de Mercado Pago para recibir pagos en tu tienda.
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          sx={{ borderRadius: 2, textTransform: 'none', px: 3 }}
        >
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        <SectionCard
          title="Mercado Pago"
          subtitle="Credenciales y modo de operación de tu integración con Mercado Pago."
          icon={<PaymentIcon color="primary" />}
        >
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isEnabled}
                    onChange={e => setField('isEnabled', e.target.checked)}
                  />
                }
                label={form.isEnabled ? 'Mercado Pago activado' : 'Mercado Pago desactivado'}
              />
              {form.hasAccessToken ? (
                <Chip
                  icon={<CheckCircleIcon />}
                  label="Token configurado"
                  color="success"
                  size="small"
                  variant="outlined"
                />
              ) : (
                <Chip
                  icon={<CancelIcon />}
                  label="Sin token"
                  color="warning"
                  size="small"
                  variant="outlined"
                />
              )}
              {form.connectedAt && (
                <Typography variant="caption" color="text.secondary">
                  Conectado: {new Date(form.connectedAt).toLocaleDateString('es-AR')}
                </Typography>
              )}
            </Stack>

            <Divider />

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  select
                  fullWidth
                  label="Modo"
                  value={form.mode}
                  onChange={e => setField('mode', e.target.value)}
                >
                  {MODE_OPTIONS.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField
                  fullWidth
                  label="Public Key"
                  value={form.publicKey}
                  onChange={e => setField('publicKey', e.target.value)}
                  placeholder={
                    form.mode === 'test'
                      ? 'TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                      : 'APP_USR-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                  }
                  inputProps={{ maxLength: 300 }}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  type="password"
                  label="Access Token"
                  value={form.accessToken}
                  onChange={e => setField('accessToken', e.target.value)}
                  placeholder="••••••••"
                  helperText={secretHelp}
                  autoComplete="new-password"
                />
              </Grid>
            </Grid>
          </Stack>
        </SectionCard>

        <SectionCard
          title="Ayuda"
          subtitle="Cómo obtener tus credenciales de Mercado Pago."
          icon={<PaymentIcon sx={{ color: '#00b1ea' }} />}
        >
          <Typography variant="body2" color="text.secondary" component="div">
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              <li>
                Ingresá a <strong>mercadopago.com.ar/developers</strong> con tu cuenta de Mercado
                Pago.
              </li>
              <li>
                Creá una aplicación (o usá una existente) en <strong>Tus integraciones</strong>.
              </li>
              <li>
                En <strong>Credenciales de producción</strong> (o de test) copiá la{' '}
                <em>Public Key</em> y el <em>Access Token</em>.
              </li>
              <li>
                Pegá ambos valores en los campos de arriba y seleccioná el modo correspondiente.
              </li>
              <li>Activá el switch y guardá los cambios.</li>
            </ol>
          </Typography>
        </SectionCard>

        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderRadius: 3,
            position: 'sticky',
            bottom: 16,
            textAlign: 'right',
          }}
        >
          <Button
            variant="contained"
            size="large"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving}
            sx={{ borderRadius: 2, textTransform: 'none', px: 4 }}
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </Paper>
      </Stack>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default PaymentConfigPage
