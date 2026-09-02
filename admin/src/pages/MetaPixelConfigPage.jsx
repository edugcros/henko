import React, { useCallback, useEffect, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  Link,
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
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material'
import { getMetaPixelConfig, updateMetaPixelConfig } from '../services/metaPixelConfigService.js'

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

const GUIDE_STEPS = [
  {
    tag: 'En Meta',
    title: 'Creá tu cartera de negocios',
    body: (
      <>
        Entrá a{' '}
        <Link href="https://business.facebook.com" target="_blank" rel="noopener">
          business.facebook.com
        </Link>{' '}
        y elegí <strong>Crear cuenta</strong>. Te va a pedir el nombre de tu comercio, tu nombre y
        un email de trabajo.
      </>
    ),
  },
  {
    tag: 'En Meta',
    title: 'Completá los datos de contacto',
    body: (
      <>
        Configuración del negocio → Información del negocio. Cargá un email y teléfono de contacto
        de tu comercio si todavía no los tenés.
      </>
    ),
    warning:
      'Meta no te deja avanzar sin esto — aparece como "Falta información de contacto" en cuanto entrás a gestionar la cartera.',
  },
  {
    tag: 'En Meta',
    title: 'Activá tu clave de acceso (passkey)',
    body: (
      <>
        <Link href="https://accountscenter.facebook.com" target="_blank" rel="noopener">
          accountscenter.facebook.com
        </Link>{' '}
        → Contraseña y seguridad → Claves de acceso → creá una (huella digital, Face ID o el PIN del
        equipo).
      </>
    ),
    warning:
      'Es un requisito de seguridad de Meta para administrar una cartera de negocios — no tiene que ver con tu Pixel en particular, pero te bloquea hasta activarlo.',
  },
  {
    tag: 'En Meta',
    title: 'Creá el Pixel',
    body: (
      <>
        <Link href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener">
          Events Manager
        </Link>{' '}
        → Conectar fuentes de datos → Web → Meta Pixel. Ponele un nombre y creálo — te muestra el{' '}
        <strong>ID de Pixel</strong> (15-16 dígitos).
      </>
    ),
  },
  {
    tag: 'En Meta',
    title: 'Generá tu token de acceso',
    body: (
      <>
        Dentro de ese mismo Pixel: Configuración → Conversions API →{' '}
        <strong>Generar token de acceso</strong>. Tratalo como una contraseña.
      </>
    ),
  },
  {
    tag: 'En HENKO',
    title: 'Pegá tus datos acá arriba',
    body: 'ID de Pixel y token en los campos de esta pantalla, activá el switch y guardá.',
  },
  {
    tag: 'En Meta',
    title: 'Probá que esté funcionando',
    body: 'Events Manager → pestaña "Eventos de prueba". Te da un código temporal — pegalo junto al ID de Pixel acá arriba, navegá tu tienda en otra pestaña, y deberías ver los eventos llegar en tiempo real.',
  },
]

const FAQ_ITEMS = [
  {
    q: '"Necesitás una cuenta publicitaria para acceder a Ads Manager"',
    a: 'Aparece si entraste por Ads Manager en vez de Events Manager. Si solo querés medir (no pautar todavía), entrá directo por Events Manager (paso 4) — ahí no hace falta cuenta publicitaria. Si vas a correr anuncios, creála desde Configuración del negocio → Cuentas → Cuentas publicitarias (ojo: la moneda no se puede cambiar después de creada la cuenta).',
  },
  {
    q: '"La llave de acceso no está activada"',
    a: 'Es el paso 3 — la passkey. No se puede gestionar la cartera de negocios sin activarla al menos una vez.',
  },
  {
    q: '"Falta información de contacto"',
    a: 'Es el paso 2. Completá el email y teléfono del negocio en la información del negocio y el aviso desaparece.',
  },
  {
    q: '¿Puedo usar Gmail o Hotmail para esto?',
    a: 'Sí — para el Pixel, el email de tu cuenta de Facebook no tiene restricciones. Es distinto del dominio de envío de correo de la tienda (ese sí necesita un dominio propio), que es una configuración aparte dentro de HENKO.',
  },
  {
    q: 'En "Eventos de prueba" no aparece nada',
    a: 'Revisá que el switch de esta pantalla esté activado y que el token esté guardado, y que sigas navegando con el código de prueba pegado — se vence a las pocas horas y hay que generar uno nuevo.',
  },
]

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

  const setField = useCallback((key, value) => setForm(prev => ({ ...prev, [key]: value })), [])

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
        err?.response?.data?.message || err?.message || 'No se pudo guardar la configuración.',
      )
    } finally {
      setSaving(false)
    }
  }, [form])

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    )
  }

  if (!form) {
    return (
      <Box p={3}>
        <Alert severity="error" action={<Button onClick={load}>Reintentar</Button>}>
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
            Medí y optimizá campañas de Facebook e Instagram con datos reales de tu tienda.
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
          title="Meta Pixel + Conversions API"
          subtitle="El Pixel mide desde el navegador del comprador; Conversions API manda el mismo evento desde nuestro servidor para que no se pierda por bloqueadores de anuncios o Safari. Los dos juntos dan la medición más completa."
          icon={<InsightsIcon color="primary" />}
        >
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isEnabled}
                    onChange={e => setField('isEnabled', e.target.checked)}
                  />
                }
                label={form.isEnabled ? 'Meta Pixel activado' : 'Meta Pixel desactivado'}
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
          title="Cómo conseguir tu ID de Pixel y tu token"
          subtitle="Paso a paso, incluidos los tropiezos más comunes con Meta."
          icon={<InsightsIcon sx={{ color: '#1877f2' }} />}
        >
          <Stack spacing={0}>
            {GUIDE_STEPS.map((step, index) => (
              <Box
                key={step.title}
                sx={{
                  py: 2,
                  borderBottom: index < GUIDE_STEPS.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <Typography
                    variant="h6"
                    color="text.disabled"
                    sx={{ minWidth: 28, fontWeight: 600 }}
                  >
                    {index + 1}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Chip
                      size="small"
                      label={step.tag}
                      color={step.tag === 'En HENKO' ? 'primary' : 'default'}
                      variant={step.tag === 'En HENKO' ? 'filled' : 'outlined'}
                      sx={{ mb: 1 }}
                    />
                    <Typography variant="subtitle2" fontWeight={700} mb={0.5}>
                      {step.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {step.body}
                    </Typography>
                    {step.warning && (
                      <Alert severity="warning" sx={{ mt: 1.5 }}>
                        {step.warning}
                      </Alert>
                    )}
                  </Box>
                </Stack>
              </Box>
            ))}
          </Stack>
        </SectionCard>

        <SectionCard
          title="Preguntas frecuentes"
          subtitle="Los mensajes de Meta que más confunden — y qué hacer con cada uno."
          icon={<InsightsIcon sx={{ color: '#1877f2' }} />}
        >
          <Stack spacing={1}>
            {FAQ_ITEMS.map(item => (
              <Accordion
                key={item.q}
                disableGutters
                elevation={0}
                variant="outlined"
                sx={{ borderRadius: 2, '&:before': { display: 'none' } }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {item.q}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary">
                    {item.a}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
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

export default MetaPixelConfigPage
