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
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  Save as SaveIcon,
  Insights as InsightsIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material'
import {
  getMetaPixelConfig,
  updateMetaPixelConfig,
} from '../services/metaPixelConfigService.js'

const clean = value => String(value ?? '').trim()

const toForm = data => {
  const meta = data?.meta || {}
  return {
    pixelId: meta.pixelId || '',
    accessToken: '',
    isEnabled: Boolean(meta.isEnabled),
    hasAccessToken: Boolean(meta.hasAccessToken),
    connectedAt: meta.connectedAt || null,
    updatedAt: meta.updatedAt || null,
  }
}

const toPayload = form => {
  const meta = {
    pixelId: clean(form.pixelId),
    isEnabled: form.isEnabled,
  }
  if (clean(form.accessToken)) {
    meta.accessToken = clean(form.accessToken)
  }
  return { meta }
}

const SectionCard = ({ title, subtitle, icon, children }) => (
  <Card variant="outlined" sx={{ borderRadius: 3 }}>
    <CardContent>
      <Stack direction="row" spacing={1.5} alignItems="center" mb={0.5}>
        {icon}
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
      </Stack>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" mb={2}>
          {subtitle}
        </Typography>
      )}
      <Divider sx={{ mb: 2.5 }} />
      {children}
    </CardContent>
  </Card>
)

const MetaPixelConfigPage = () => {
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
      const data = await getMetaPixelConfig()
      setForm(toForm(data))
    } catch (err) {
      console.error('[META_PIXEL_CONFIG_LOAD_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar la configuración de Meta Pixel.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setField = useCallback(
    (key, value) => setForm(prev => ({ ...prev, [key]: value })),
    [],
  )

  const handleSave = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setError('')
    try {
      const data = await updateMetaPixelConfig(toPayload(form))
      setForm(toForm(data))
      setSnackbar({
        open: true,
        severity: 'success',
        message: 'Configuración de Meta Pixel guardada.',
      })
    } catch (err) {
      console.error('[META_PIXEL_CONFIG_SAVE_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo guardar la configuración.',
      )
    } finally {
      setSaving(false)
    }
  }, [form])

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="60vh"
      >
        <CircularProgress />
      </Box>
    )
  }

  if (!form) {
    return (
      <Box p={3}>
        <Alert
          severity="error"
          action={<Button onClick={load}>Reintentar</Button>}
        >
          {error || 'No se pudo cargar la configuración.'}
        </Alert>
      </Box>
    )
  }

  const secretHelp = form.hasAccessToken
    ? 'Ya hay un token guardado. Dejá en blanco para no cambiarlo.'
    : 'Pegá el Access Token de Conversions API de tu Pixel.'

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 980, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={2}
        mb={3}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Meta Pixel
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Medí y optimizá campañas de Facebook e Instagram con datos reales de
            tu tienda.
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={
            saving ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <SaveIcon />
            )
          }
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
          title="Meta Pixel + Conversions API"
          subtitle="El Pixel mide desde el navegador del comprador; Conversions API manda el mismo evento desde nuestro servidor para que no se pierda por bloqueadores de anuncios o Safari. Los dos juntos dan la medición más completa."
          icon={<InsightsIcon color="primary" />}
        >
          <Stack spacing={2.5}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              flexWrap="wrap"
            >
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isEnabled}
                    onChange={e => setField('isEnabled', e.target.checked)}
                  />
                }
                label={
                  form.isEnabled
                    ? 'Meta Pixel activado'
                    : 'Meta Pixel desactivado'
                }
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
                  Conectado:{' '}
                  {new Date(form.connectedAt).toLocaleDateString('es-AR')}
                </Typography>
              )}
            </Stack>

            <Divider />

            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={5}>
                <TextField
                  fullWidth
                  label="ID de Pixel"
                  value={form.pixelId}
                  onChange={e => setField('pixelId', e.target.value)}
                  placeholder="123456789012345"
                  inputProps={{ maxLength: 20 }}
                />
              </Grid>
              <Grid item xs={12} sm={7}>
                <TextField
                  fullWidth
                  type="password"
                  label="Conversions API Access Token"
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
          subtitle="Cómo obtener tu ID de Pixel y tu Access Token."
          icon={<InsightsIcon sx={{ color: '#1877f2' }} />}
        >
          <Typography variant="body2" color="text.secondary" component="div">
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              <li>
                Ingresá a <strong>business.facebook.com/events_manager</strong>{' '}
                con tu cuenta de Meta Business.
              </li>
              <li>
                Elegí tu Pixel (o creá uno) y copiá el <em>ID de Pixel</em>{' '}
                desde la pestaña de configuración.
              </li>
              <li>
                En <strong>Configuración → Conversions API</strong> generá un{' '}
                <em>Access Token</em> del sistema.
              </li>
              <li>Pegá ambos valores en los campos de arriba.</li>
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
            startIcon={
              saving ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <SaveIcon />
              )
            }
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

export default MetaPixelConfigPage
