import React, { useCallback, useEffect, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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

const clean = value => String(value ?? '').trim()

// Mismo criterio que el backend (metaPixelConfigCtrl): el ID de Pixel es solo números.
const PIXEL_ID_REGEX = /^\d{6,20}$/

export const toForm = data => {
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

export const toPayload = form => {
  const meta = {
    pixelId: clean(form.pixelId),
    isEnabled: form.isEnabled,
  }
  if (clean(form.accessToken)) {
    meta.accessToken = clean(form.accessToken)
  }
  return { meta }
}

// Lo que el servidor va a rechazar con un 400, dicho antes de mandarlo: un ID que no es numérico y
// activar el Pixel sin ID o sin token. Un ID vacío no borra el guardado (el servidor lo conserva),
// así que cuenta como «hay ID» si ya había uno.
export const getConfigProblems = (form, saved) => {
  const problems = []
  const pixelId = clean(form.pixelId)
  const hasPixelId = Boolean(pixelId) || Boolean(clean(saved.pixelId))
  const hasToken = saved.hasAccessToken || Boolean(clean(form.accessToken))

  if (pixelId && !PIXEL_ID_REGEX.test(pixelId)) {
    problems.push({
      key: 'id-invalido',
      field: 'pixelId',
      text: 'El ID de Pixel tiene que ser numérico (de 6 a 20 dígitos). Lo encontrás en Events Manager.',
    })
  }

  if (form.isEnabled && !hasPixelId) {
    problems.push({
      key: 'sin-id',
      field: 'pixelId',
      text: 'Para activar Meta Pixel falta el ID de Pixel.',
    })
  }

  if (form.isEnabled && !hasToken) {
    problems.push({
      key: 'sin-token',
      field: 'accessToken',
      text: 'Para activar Meta Pixel falta el token de acceso de Conversions API.',
    })
  }

  return problems
}

const formatDate = value => (value ? new Date(value).toLocaleDateString('es-AR') : '—')

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

const StatusTile = ({ title, value, ok, span }) => (
  <Box sx={{ p: 2, minWidth: 0, gridColumn: span }}>
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
        overflowWrap: 'anywhere',
        color: ok === undefined ? BRAND.ink : ok ? '#047857' : '#9a5b00',
      }}
    >
      {value}
    </Typography>
  </Box>
)

const MetaPixelConfigPage = () => {
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
      const data = await getMetaPixelConfig()
      const next = toForm(data)

      setForm(next)
      setSaved(next)
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

  const problems = form && saved ? getConfigProblems(form, saved) : []
  const canSave = problems.length === 0 && !saving

  const handleSave = useCallback(async () => {
    if (!form || !canSave) return
    setSaving(true)
    setError('')
    try {
      const data = await updateMetaPixelConfig(toPayload(form))
      const next = toForm(data)

      setForm(next)
      setSaved(next)
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
  }, [form, canSave])

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
    : 'Pegá el Access Token de Conversions API de tu Pixel.'

  const problemFor = field => problems.find(problem => problem.field === field)

  const saveButton = (sx = {}) => (
    <Button
      variant="contained"
      size="large"
      startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
      onClick={handleSave}
      disabled={!canSave}
      sx={{
        borderRadius: 3,
        textTransform: 'none',
        fontWeight: 700,
        px: 3,
        background: canSave ? GRADIENT : undefined,
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
            MARKETING
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
            Meta Pixel
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Medí y optimizá campañas de Facebook e Instagram con datos reales de tu tienda.
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
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          }}
        >
          <StatusTile
            title="Meta Pixel"
            value={saved.isEnabled ? 'Activado' : 'Desactivado'}
            ok={saved.isEnabled}
          />
          <StatusTile
            title="ID de Pixel"
            value={clean(saved.pixelId) || 'Sin ID'}
            ok={Boolean(clean(saved.pixelId))}
            span={{ xs: 'span 2', md: 'span 1' }}
          />
          <StatusTile
            title="Access Token"
            value={saved.hasAccessToken ? 'Configurado' : 'Falta'}
            ok={saved.hasAccessToken}
          />
          <StatusTile title="Conectado" value={formatDate(saved.connectedAt)} />
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 3 }}>
          {error}
        </Alert>
      )}

      {problems.length > 0 && (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {problems.map(problem => (
            <Alert key={problem.key} severity="warning" sx={{ borderRadius: 3 }}>
              {problem.text}
            </Alert>
          ))}
        </Stack>
      )}

      <Stack spacing={3}>
        <SectionCard
          title="Meta Pixel + Conversions API"
          subtitle="El Pixel mide desde el navegador del comprador; Conversions API manda el mismo evento desde nuestro servidor para que no se pierda por bloqueadores de anuncios o Safari. Los dos juntos dan la medición más completa."
          icon={<InsightsIcon sx={{ color: BRAND.blue }} />}
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

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  fullWidth
                  label="ID de Pixel"
                  value={form.pixelId}
                  onChange={e => setField('pixelId', e.target.value)}
                  placeholder="123456789012345"
                  error={Boolean(problemFor('pixelId'))}
                  slotProps={{ htmlInput: { maxLength: 20 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField
                  fullWidth
                  type="password"
                  label="Conversions API Access Token"
                  value={form.accessToken}
                  onChange={e => setField('accessToken', e.target.value)}
                  placeholder="••••••••"
                  error={Boolean(problemFor('accessToken'))}
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
                  borderColor: BRAND.line,
                }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <Typography
                    sx={{
                      minWidth: 28,
                      fontFamily: DISPLAY_FONT,
                      fontWeight: 800,
                      fontSize: 20,
                      color: BRAND.blue,
                    }}
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
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                      {step.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" component="div">
                      {step.body}
                    </Typography>
                    {step.warning && (
                      <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 3 }}>
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
                sx={{
                  borderRadius: 3,
                  borderColor: BRAND.line,
                  '&:before': { display: 'none' },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
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

export default MetaPixelConfigPage
