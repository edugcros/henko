import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const MODE_OPTIONS = [
  { value: 'test', label: 'Test (sandbox)' },
  { value: 'production', label: 'Producción' },
]

const clean = value => String(value ?? '').trim()

export const toForm = data => {
  const mp = data?.mercadopago || {}
  return {
    mode: mp.mode || 'test',
    publicKey: mp.publicKey || '',
    accessToken: '',
    webhookSecret: '',
    isEnabled: Boolean(mp.isEnabled),
    hasAccessToken: Boolean(mp.hasAccessToken),
    hasWebhookSecret: Boolean(mp.hasWebhookSecret),
    connectedAt: mp.connectedAt || null,
    updatedAt: mp.updatedAt || null,
  }
}

export const toPayload = form => {
  const mercadopago = {
    mode: form.mode,
    publicKey: clean(form.publicKey),
    isEnabled: form.isEnabled,
  }
  if (clean(form.accessToken)) {
    mercadopago.accessToken = clean(form.accessToken)
  }
  if (clean(form.webhookSecret)) {
    mercadopago.webhookSecret = clean(form.webhookSecret)
  }
  return { mercadopago }
}

// Avisos antes de guardar: no frenan nada (el servidor tiene la última palabra), pero son las tres
// combinaciones que dejan al comercio sin poder cobrar o cobrando mal sin que se note.
export const getConfigWarnings = (form, saved) => {
  const warnings = []
  const hasToken = saved.hasAccessToken || Boolean(clean(form.accessToken))
  const hasWebhookSecret = saved.hasWebhookSecret || Boolean(clean(form.webhookSecret))

  if (form.isEnabled && !hasToken) {
    warnings.push({
      key: 'sin-token',
      severity: 'warning',
      text: 'Mercado Pago está activado pero todavía no hay un Access Token: tus clientes no van a poder pagar. Pegalo en el campo de abajo antes de guardar.',
    })
  }

  if (form.mode === 'production' && clean(form.publicKey).toUpperCase().startsWith('TEST-')) {
    warnings.push({
      key: 'clave-de-prueba',
      severity: 'warning',
      text: 'El modo es Producción pero la Public Key parece de prueba (empieza con TEST-). Revisá que hayas copiado las credenciales de producción.',
    })
  }

  if (form.isEnabled && form.mode === 'production' && !hasWebhookSecret) {
    warnings.push({
      key: 'sin-webhook',
      severity: 'info',
      text: 'Sin la clave secreta del webhook, Mercado Pago puede avisar un pago y la tienda ignorarlo.',
    })
  }

  return warnings
}

const formatDate = value => (value ? new Date(value).toLocaleDateString('es-AR') : '—')

const SectionCard = ({ title, subtitle, icon, children }) => (
  <Paper component="section" variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2.5, md: 3.5 } }}>
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
      {icon}
      <Typography component="h2" sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
        {title}
      </Typography>
    </Stack>
    {subtitle && (
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        {subtitle}
      </Typography>
    )}
    {children}
  </Paper>
)

const StatusTile = ({ title, value, ok }) => (
  <Box sx={{ p: 2, minWidth: 0 }}>
    <Typography
      component="span"
      variant="caption"
      sx={{ display: 'block', color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
    >
      {title}
    </Typography>
    <Typography
      component="div"
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 18,
        lineHeight: 1.3,
        color: ok === undefined ? BRAND.ink : ok ? '#047857' : '#9a5b00',
      }}
    >
      {value}
    </Typography>
  </Box>
)

const PaymentConfigPage = () => {
  const [form, setForm] = useState(null)
  // Lo que está guardado en el servidor: el resumen de arriba muestra esto, no lo que se está
  // escribiendo, para no decir «activado» antes de que se guarde.
  const [saved, setSaved] = useState(null)
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
      const next = toForm(data)

      setForm(next)
      setSaved(next)
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
      const next = toForm(data)

      setForm(next)
      setSaved(next)
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
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
      >
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

  const webhookSecretHelp = form.hasWebhookSecret
    ? 'Ya hay una clave guardada. Dejá en blanco para no cambiarla.'
    : 'En Tus integraciones → Webhooks → Clave secreta. Sin ella, Mercado Pago puede avisar un pago y la tienda ignorarlo.'

  const warnings = getConfigWarnings(form, saved)

  const saveButton = (sx = {}) => (
    <Button
      variant="contained"
      size="large"
      startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
      onClick={handleSave}
      disabled={saving}
      sx={{
        borderRadius: 3,
        textTransform: 'none',
        fontWeight: 700,
        px: 3,
        background: GRADIENT,
        ...sx,
      }}
    >
      {saving ? 'Guardando...' : 'Guardar cambios'}
    </Button>
  )

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 980, mx: 'auto' }}>
      <Box
        component="header"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'flex-end' },
          gap: 2,
          mb: 4,
        }}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
          >
            COBROS
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
            Configuración de Pagos
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Conectá tu cuenta de Mercado Pago para recibir pagos en tu tienda.
          </Typography>
        </Box>
        {saveButton({ flexShrink: 0 })}
      </Box>

      <Paper
        component="section"
        aria-label="Estado de la conexión"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' },
          }}
        >
          <StatusTile
            title="Mercado Pago"
            value={saved.isEnabled ? 'Activado' : 'Desactivado'}
            ok={saved.isEnabled}
          />
          <StatusTile title="Modo" value={saved.mode === 'production' ? 'Producción' : 'Prueba'} />
          <StatusTile
            title="Access Token"
            value={saved.hasAccessToken ? 'Configurado' : 'Falta'}
            ok={saved.hasAccessToken}
          />
          <StatusTile
            title="Webhook"
            value={saved.hasWebhookSecret ? 'Con clave' : 'Sin clave'}
            ok={saved.hasWebhookSecret}
          />
          <StatusTile title="Conectado" value={formatDate(saved.connectedAt)} />
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>
          {error}
        </Alert>
      )}

      {warnings.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {warnings.map(warning => (
            <Alert key={warning.key} severity={warning.severity} sx={{ borderRadius: 3 }}>
              {warning.text}
            </Alert>
          ))}
        </Stack>
      )}

      <Stack spacing={3}>
        <SectionCard
          title="Mercado Pago"
          subtitle="Credenciales y modo de operación de tu integración con Mercado Pago."
          icon={<PaymentIcon sx={{ color: BRAND.blue }} />}
        >
          <Stack spacing={2.5}>
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
            >
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
                  slotProps={{ htmlInput: { maxLength: 300 } }}
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
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  type="password"
                  label="Clave secreta del webhook"
                  value={form.webhookSecret}
                  onChange={e => setField('webhookSecret', e.target.value)}
                  placeholder="••••••••"
                  helperText={webhookSecretHelp}
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
            ...PANEL_SX,
            p: 2,
            position: 'sticky',
            bottom: 16,
            textAlign: 'right',
          }}
        >
          {saveButton({ px: 4, width: { xs: '100%', sm: 'auto' } })}
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
