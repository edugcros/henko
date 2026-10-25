// 📁 admin/src/pages/AiCampaignRulesPage.jsx
//
// CRUD de reglas de campaña del Agente IA: carrito abandonado, follow-up de
// leads, post-compra y winback. El admin configura triggers, templates,
// horarios y ofertas. Endpoints: /ai-agent/campaign-rules/*.
//
// HOY SOLO SE EJECUTAN LAS DE CARRITO ABANDONADO: los workers del backend buscan únicamente
// `type: 'abandoned_cart'` (aiCartRecoveryService / aiCartRecoveryWorkerService). Las de los otros
// tipos se guardan y se pueden activar, pero nada las usa; la pantalla lo dice en vez de mostrarlas
// igual que las que trabajan.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import {
  deleteCampaignRule,
  listCampaignRules,
  upsertCampaignRule,
} from '../services/aiCampaignRuleService.js'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// `runs`: si hoy hay algo en el backend que ejecute reglas de ese tipo.
export const RULE_TYPES = [
  { value: 'abandoned_cart', label: 'Carrito abandonado', runs: true },
  { value: 'lead_follow_up', label: 'Seguimiento de lead', runs: false },
  { value: 'post_purchase', label: 'Post-compra', runs: false },
  { value: 'winback', label: 'Recuperar clientes inactivos', runs: false },
]

const CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
]

// Las que reemplaza el worker al armar el mensaje (replaceTemplateVars). `{{itemCount}}` existía y
// la ayuda no lo nombraba.
export const TEMPLATE_VARIABLES = [
  { token: '{{customerName}}', label: 'Nombre del cliente', sample: 'Lucía' },
  { token: '{{productName}}', label: 'Producto', sample: 'Zapatillas Runner Pro' },
  { token: '{{itemCount}}', label: 'Cantidad de productos', sample: '2' },
  { token: '{{cartTotal}}', label: 'Total del carrito', sample: '$ 84.900' },
  { token: '{{checkoutUrl}}', label: 'Link al checkout', sample: 'https://tutienda.com/checkout' },
]

export const renderPreview = template =>
  TEMPLATE_VARIABLES.reduce(
    (text, variable) => text.replaceAll(variable.token, variable.sample),
    String(template || ''),
  )

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''
const toBoolean = v => v === true || v === 'true'

const HOUR_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

export const EMPTY_FORM = {
  name: '',
  type: 'abandoned_cart',
  enabled: true,
  channel: 'whatsapp',
  messageTemplate: '',
  useAiPersonalization: true,
  trigger: {
    delayMinutes: 30,
    minCartAmountCents: 0,
    maxAttempts: 2,
    onlyBusinessHours: true,
    businessHours: { start: '09:00', end: '20:00' },
    minHoursBetweenContacts: 6,
  },
  whatsappTemplate: { enabled: false, name: '', languageCode: 'es_AR' },
  offer: { enabled: false, couponCode: '' },
}

const inRange = (value, min, max) =>
  value !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max

// Lo mismo que valida el backend, antes de mandar. Antes los números se guardaban recortados sin
// avisar (un 0 en la espera quedaba en 1) y un horario mal escrito volvía como error del servidor.
export const validateRule = form => {
  if (!clean(form.name) || !clean(form.messageTemplate)) {
    return 'Nombre y plantilla de mensaje son obligatorios.'
  }
  if (!inRange(form.trigger.delayMinutes, 1, 43200)) {
    return 'La espera tiene que ser de 1 a 43.200 minutos (30 días).'
  }
  if (!inRange(form.trigger.maxAttempts, 1, 5)) {
    return 'Los intentos tienen que ser de 1 a 5.'
  }
  if (!inRange(form.trigger.minHoursBetweenContacts, 1, 168)) {
    return 'Las horas entre contactos tienen que ser de 1 a 168 (7 días).'
  }
  if (!(Number(form.trigger.minCartAmountCents) >= 0)) {
    return 'El monto mínimo no puede ser negativo.'
  }
  if (
    !HOUR_REGEX.test(form.trigger.businessHours.start) ||
    !HOUR_REGEX.test(form.trigger.businessHours.end)
  ) {
    return 'El horario comercial tiene que tener el formato HH:mm.'
  }
  if (
    form.channel === 'whatsapp' &&
    form.whatsappTemplate.enabled &&
    !clean(form.whatsappTemplate.name)
  ) {
    return 'Falta el nombre de la plantilla aprobada por Meta.'
  }
  if (form.offer.enabled && !clean(form.offer.couponCode)) {
    return 'Falta el código del cupón.'
  }
  return ''
}

export const toPayload = form => {
  const payload = JSON.parse(JSON.stringify(form))
  delete payload._id
  payload.name = clean(payload.name)
  payload.messageTemplate = clean(payload.messageTemplate)
  payload.offer.couponCode = clean(payload.offer.couponCode).toUpperCase()
  return payload
}

const formatPesos = cents =>
  (Number(cents || 0) / 100).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  })

// 43200 min no dice nada a simple vista; 30 días, sí.
export const formatDelay = minutes => {
  const m = Number(minutes) || 0
  if (m >= 1440 && m % 1440 === 0) return m === 1440 ? '1 día' : `${m / 1440} días`
  if (m >= 60 && m % 60 === 0) return m === 60 ? '1 hora' : `${m / 60} horas`
  return `${m} min`
}

// El disparador dicho como lo entiende quien lo configuró. Antes: «Delay: 45 min | Max intentos».
export const describeTrigger = trigger => {
  const t = trigger || {}
  const parts = [`Espera ${formatDelay(t.delayMinutes ?? 30)}`]
  const attempts = t.maxAttempts ?? 2
  parts.push(attempts === 1 ? '1 intento' : `Hasta ${attempts} intentos`)
  if (t.minCartAmountCents > 0) parts.push(`Carritos desde ${formatPesos(t.minCartAmountCents)}`)
  if (t.onlyBusinessHours !== false) {
    parts.push(`De ${t.businessHours?.start || '09:00'} a ${t.businessHours?.end || '20:00'}`)
  } else {
    parts.push('A cualquier hora')
  }
  parts.push(`${t.minHoursBetweenContacts ?? 6} h entre contactos`)
  return parts
}

const Pill = ({ label, color = BRAND.muted, bg = '#eef1fb', outlined = false }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      px: 1.25,
      py: 0.25,
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.6,
      whiteSpace: 'nowrap',
      color,
      bgcolor: outlined ? 'transparent' : bg,
      border: `1px solid ${outlined ? BRAND.line : 'transparent'}`,
    }}
  >
    {label}
  </Box>
)

const SectionLabel = ({ children }) => (
  <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 15, color: BRAND.ink }}>
    {children}
  </Typography>
)

const RuleCard = ({ rule, busy, onEdit, onDelete }) => {
  const typeMeta = RULE_TYPES.find(t => t.value === rule.type)
  const channelLabel = CHANNEL_OPTIONS.find(c => c.value === rule.channel)?.label || rule.channel
  const runs = typeMeta?.runs !== false
  const sent = rule.stats?.sent || 0
  const conversions = rule.stats?.conversions || 0

  return (
    <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2, sm: 2.5 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
            <Pill label={typeMeta?.label || rule.type} color={BRAND.blue} bg="#e7f0ff" />
            <Pill label={channelLabel} outlined />
            <Pill
              label={rule.enabled ? 'Activa' : 'Inactiva'}
              color={rule.enabled ? '#047857' : BRAND.muted}
              bg={rule.enabled ? '#e6f6ef' : '#eef1fb'}
            />
            {rule.offer?.enabled && rule.offer?.couponCode && (
              <Pill label={`Cupón: ${rule.offer.couponCode}`} color="#6d28d9" bg="#f1e8ff" />
            )}
            {!runs && <Pill label="Todavía no se ejecuta" color="#9a5b00" bg="#fff3dd" />}
          </Stack>

          <Typography
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: 17,
              overflowWrap: 'anywhere',
            }}
          >
            {rule.name || 'Sin nombre'}
          </Typography>

          <Typography
            variant="body2"
            sx={{
              mt: 0.5,
              color: BRAND.muted,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {rule.messageTemplate}
          </Typography>

          <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: BRAND.muted }}>
            {describeTrigger(rule.trigger).join(' · ')}
          </Typography>

          {(sent > 0 || conversions > 0) && (
            <Typography variant="caption" sx={{ display: 'block', color: BRAND.muted }}>
              {`${sent} ${sent === 1 ? 'enviado' : 'enviados'} · ${conversions} ${conversions === 1 ? 'convertido' : 'convertidos'}`}
            </Typography>
          )}

          {!runs && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#9a5b00' }}>
              Por ahora el asistente solo ejecuta reglas de carrito abandonado: esta queda guardada,
              pero no le escribe a nadie.
            </Typography>
          )}
        </Box>

        <Stack
          direction={{ xs: 'row', md: 'column' }}
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', minWidth: { md: 130 }, alignSelf: { md: 'flex-start' } }}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon />}
            disabled={busy}
            onClick={() => onEdit(rule)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Editar
          </Button>
          <Button
            size="small"
            variant="text"
            color="error"
            startIcon={<DeleteIcon />}
            disabled={busy}
            onClick={() => onDelete(rule)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Eliminar
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

// Por qué la recuperación de carritos no está corriendo. El backend manda el
// motivo; acá se traduce a algo que se pueda leer y accionar.
const READINESS_MESSAGES = {
  agent_missing:
    'Todavía no hay un asistente de IA configurado para esta tienda, así que ninguna regla de recuperación se ejecuta.',
  agent_disabled:
    'El asistente de IA está apagado. Mientras siga así, las reglas de recuperación de carrito no se ejecutan.',
  whatsapp_channel_disabled:
    'Tus reglas activas son de WhatsApp y ese canal está apagado en Configuración del agente. Dos salidas: prenderlo, o crear una regla de carrito abandonado por Email — el correo no necesita nada de Meta y le llega a cualquier comprador que haya dejado su dirección.',
  no_active_abandoned_cart_rule:
    'No hay ninguna regla activa de tipo "carrito abandonado" por WhatsApp, así que no se recupera ningún carrito.',
  default: 'La recuperación de carritos no puede ejecutarse con la configuración actual.',
}

const AiCampaignRulesPage = () => {
  const isMobile = useMediaQuery('(max-width:600px)')

  const [rules, setRules] = useState([])
  // Si la recuperación de carritos puede correr, y si no, por qué. Una regla
  // activa con el canal apagado no hace nada, y así se veía igual que una que
  // sí trabaja.
  const [readiness, setReadiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  const [formDialog, setFormDialog] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const templateRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listCampaignRules()
      setRules(Array.isArray(data?.items) ? data.items : [])
      setReadiness(data?.readiness || null)
      setLoaded(true)
    } catch (err) {
      console.error('[AI_CAMPAIGN_RULES_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudieron cargar las reglas de campaña.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const flash = (message, severity = 'success') => setSnackbar({ open: true, severity, message })

  const openCreateDialog = () => {
    setFormData(EMPTY_FORM)
    setFormError('')
    setFormDialog('create')
  }

  const openEditDialog = rule => {
    setFormData({
      name: rule.name || '',
      type: rule.type || 'abandoned_cart',
      enabled: rule.enabled !== false,
      channel: rule.channel || 'whatsapp',
      messageTemplate: rule.messageTemplate || '',
      useAiPersonalization: rule.useAiPersonalization !== false,
      trigger: {
        delayMinutes: rule.trigger?.delayMinutes ?? 30,
        minCartAmountCents: rule.trigger?.minCartAmountCents ?? 0,
        maxAttempts: rule.trigger?.maxAttempts ?? 2,
        onlyBusinessHours: rule.trigger?.onlyBusinessHours !== false,
        businessHours: {
          start: rule.trigger?.businessHours?.start || '09:00',
          end: rule.trigger?.businessHours?.end || '20:00',
        },
        minHoursBetweenContacts: rule.trigger?.minHoursBetweenContacts ?? 6,
      },
      whatsappTemplate: {
        enabled: toBoolean(rule.whatsappTemplate?.enabled),
        name: rule.whatsappTemplate?.name || '',
        languageCode: rule.whatsappTemplate?.languageCode || 'es_AR',
      },
      offer: {
        enabled: toBoolean(rule.offer?.enabled),
        couponCode: rule.offer?.couponCode || '',
      },
      _id: getId(rule),
    })
    setFormError('')
    setFormDialog('edit')
  }

  const setField = (path, value) => {
    setFormError('')
    setFormData(prev => {
      const parts = path.split('.')
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
      obj[parts[parts.length - 1]] = value
      return next
    })
  }

  // Un número vacío queda vacío mientras se escribe (antes se convertía en 0 al instante).
  const setNumber = path => event => {
    const raw = event.target.value
    setField(path, raw === '' ? '' : Number(raw))
  }

  const insertVariable = token => {
    const input = templateRef.current
    const current = formData.messageTemplate
    const start = input?.selectionStart ?? current.length
    const end = input?.selectionEnd ?? current.length
    setField('messageTemplate', `${current.slice(0, start)}${token}${current.slice(end)}`)
    requestAnimationFrame(() => {
      if (!input) return
      input.focus()
      input.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const handleSave = useCallback(async () => {
    const problem = validateRule(formData)
    if (problem) {
      setFormError(problem)
      return
    }

    setSaving(true)
    setFormError('')
    try {
      await upsertCampaignRule(
        toPayload(formData),
        formDialog === 'edit' ? formData._id : undefined,
      )
      flash(formDialog === 'edit' ? 'Regla actualizada.' : 'Regla creada.')
      setFormDialog(null)
      load()
    } catch (err) {
      setFormError(err?.response?.data?.message || err?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }, [formData, formDialog, load])

  const handleDelete = useCallback(async () => {
    if (!deleteDialog || busyId) return
    const id = getId(deleteDialog)
    setBusyId(id)
    setDeleteError('')
    try {
      await deleteCampaignRule(id)
      flash('Regla eliminada.')
      setDeleteDialog(null)
      load()
    } catch (err) {
      setDeleteError(err?.response?.data?.message || err?.message || 'Error al eliminar.')
    } finally {
      setBusyId(null)
    }
  }, [deleteDialog, busyId, load])

  const selectedType = RULE_TYPES.find(t => t.value === formData.type)
  const activeCount = rules.filter(rule => rule.enabled).length

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1180, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          AGENTE DE IA
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' } }}
        >
          <Box>
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
              Campañas automáticas
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Los mensajes que el asistente manda solo, por WhatsApp o correo.
              {loaded &&
                rules.length > 0 &&
                ` ${activeCount === 1 ? '1 regla activa' : `${activeCount} reglas activas`} de ${rules.length}.`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreateDialog}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              Nueva regla
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={load}
              disabled={loading}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              Actualizar
            </Button>
          </Stack>
        </Stack>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={load}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {!loading && readiness && !readiness.ready && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {READINESS_MESSAGES[readiness.reason] || READINESS_MESSAGES.default}
        </Alert>
      )}

      {loading && !loaded ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : rules.length === 0 ? (
        !error && (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: 6, textAlign: 'center' }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 0.5 }}>
              No hay reglas de campaña configuradas.
            </Typography>
            <Typography sx={{ color: BRAND.muted, mb: 2.5 }}>
              Empezá por una de carrito abandonado: le escribe a quien dejó productos sin pagar.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreateDialog}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Crear la primera regla
            </Button>
          </Paper>
        )
      ) : (
        <Stack spacing={2} sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          {rules.map(rule => (
            <RuleCard
              key={getId(rule)}
              rule={rule}
              busy={busyId === getId(rule)}
              onEdit={openEditDialog}
              onDelete={value => {
                setDeleteError('')
                setDeleteDialog(value)
              }}
            />
          ))}
        </Stack>
      )}

      <Dialog
        open={formDialog !== null}
        onClose={() => !saving && setFormDialog(null)}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          {formDialog === 'edit' ? 'Editar regla' : 'Nueva regla de campaña'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField
              label="Nombre"
              fullWidth
              value={formData.name}
              onChange={e => setField('name', e.target.value)}
              slotProps={{ htmlInput: { maxLength: 150 } }}
            />

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <TextField
                select
                label="Tipo"
                value={formData.type}
                onChange={e => setField('type', e.target.value)}
                sx={{ minWidth: 240 }}
              >
                {RULE_TYPES.map(t => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.runs ? t.label : `${t.label} (todavía no se ejecuta)`}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Canal"
                value={formData.channel}
                onChange={e => setField('channel', e.target.value)}
                sx={{ minWidth: 150 }}
              >
                {CHANNEL_OPTIONS.map(c => (
                  <MenuItem key={c.value} value={c.value}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.enabled}
                    onChange={e => setField('enabled', e.target.checked)}
                  />
                }
                label="Activa"
              />
            </Stack>

            {!selectedType?.runs && (
              <Alert severity="warning">
                Por ahora el asistente solo ejecuta reglas de carrito abandonado. Esta regla se
                guarda, pero no le va a escribir a nadie hasta que ese tipo esté disponible.
              </Alert>
            )}

            <Box>
              <TextField
                label="Plantilla de mensaje"
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                value={formData.messageTemplate}
                onChange={e => setField('messageTemplate', e.target.value)}
                inputRef={templateRef}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
                helperText={`${formData.messageTemplate.length}/2000 · Tocá una variable para insertarla donde está el cursor.`}
              />
              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                sx={{ flexWrap: 'wrap', mt: 1 }}
                role="group"
                aria-label="Variables de la plantilla"
              >
                {TEMPLATE_VARIABLES.map(variable => (
                  <Button
                    key={variable.token}
                    size="small"
                    variant="outlined"
                    onClick={() => insertVariable(variable.token)}
                    title={variable.label}
                    sx={{ textTransform: 'none', borderRadius: 99, fontFamily: 'monospace', py: 0 }}
                  >
                    {variable.token}
                  </Button>
                ))}
              </Stack>
              {clean(formData.messageTemplate) && (
                <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 3, bgcolor: BRAND.paper }}>
                  <Typography variant="caption" sx={{ color: BRAND.muted, fontWeight: 700 }}>
                    Así le llega, con datos de ejemplo
                    {formData.useAiPersonalization && ' (la IA puede reformularlo)'}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5 }}
                  >
                    {renderPreview(formData.messageTemplate)}
                  </Typography>
                </Box>
              )}
            </Box>

            <FormControlLabel
              control={
                <Switch
                  checked={formData.useAiPersonalization}
                  onChange={e => setField('useAiPersonalization', e.target.checked)}
                />
              }
              label="Personalización con IA"
            />

            <SectionLabel>Cuándo se manda</SectionLabel>

            <Grid container spacing={2}>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Delay (min)"
                  type="number"
                  fullWidth
                  value={formData.trigger.delayMinutes}
                  onChange={setNumber('trigger.delayMinutes')}
                  slotProps={{ htmlInput: { min: 1, max: 43200 } }}
                  helperText="Espera desde que se abandona"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Max intentos"
                  type="number"
                  fullWidth
                  value={formData.trigger.maxAttempts}
                  onChange={setNumber('trigger.maxAttempts')}
                  slotProps={{ htmlInput: { min: 1, max: 5 } }}
                  helperText="De 1 a 5"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Min horas entre contactos"
                  type="number"
                  fullWidth
                  value={formData.trigger.minHoursBetweenContacts}
                  onChange={setNumber('trigger.minHoursBetweenContacts')}
                  slotProps={{ htmlInput: { min: 1, max: 168 } }}
                  helperText="De 1 a 168"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  // Se pedía en CENTAVOS. Quien administra la tienda piensa en
                  // pesos: escribir "5000" queriendo decir cinco mil dejaba la
                  // regla disparando desde los cincuenta, o sea en la práctica
                  // para cualquier carrito. El campo se guarda igual —el
                  // backend y el modelo siguen en centavos— pero se pide y se
                  // muestra en pesos.
                  label="Monto mín. carrito ($)"
                  type="number"
                  fullWidth
                  value={Math.round((formData.trigger.minCartAmountCents || 0) / 100)}
                  onChange={e =>
                    setField(
                      'trigger.minCartAmountCents',
                      Math.max(0, Math.round(Number(e.target.value) * 100)),
                    )
                  }
                  slotProps={{ htmlInput: { min: 0 } }}
                  helperText="0 = sin mínimo"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Hora inicio"
                  type="time"
                  fullWidth
                  value={formData.trigger.businessHours.start}
                  onChange={e => setField('trigger.businessHours.start', e.target.value)}
                  disabled={!formData.trigger.onlyBusinessHours}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField
                  label="Hora fin"
                  type="time"
                  fullWidth
                  value={formData.trigger.businessHours.end}
                  onChange={e => setField('trigger.businessHours.end', e.target.value)}
                  disabled={!formData.trigger.onlyBusinessHours}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
            </Grid>

            <FormControlLabel
              control={
                <Switch
                  checked={formData.trigger.onlyBusinessHours}
                  onChange={e => setField('trigger.onlyBusinessHours', e.target.checked)}
                />
              }
              label="Solo en horario comercial"
            />

            {/* La plantilla aprobada por Meta solo existe en WhatsApp: con correo no hace nada. */}
            {formData.channel === 'whatsapp' && (
              <>
                <SectionLabel>Plantilla de WhatsApp (fuera de la ventana de 24 h)</SectionLabel>
                <Typography variant="body2" sx={{ color: BRAND.muted, mt: -1.5 }}>
                  Si pasaron más de 24 h desde el último mensaje del cliente, Meta solo deja mandar
                  una plantilla aprobada.
                </Typography>

                <FormControlLabel
                  control={
                    <Switch
                      checked={formData.whatsappTemplate.enabled}
                      onChange={e => setField('whatsappTemplate.enabled', e.target.checked)}
                    />
                  }
                  label="Usar template aprobado por Meta"
                />

                {formData.whatsappTemplate.enabled && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      label="Nombre del template"
                      fullWidth
                      value={formData.whatsappTemplate.name}
                      onChange={e => setField('whatsappTemplate.name', e.target.value)}
                      slotProps={{ htmlInput: { maxLength: 120 } }}
                    />
                    <TextField
                      label="Idioma"
                      value={formData.whatsappTemplate.languageCode}
                      onChange={e => setField('whatsappTemplate.languageCode', e.target.value)}
                      slotProps={{ htmlInput: { maxLength: 20 } }}
                      sx={{ minWidth: 120 }}
                    />
                  </Stack>
                )}
              </>
            )}

            <SectionLabel>Oferta / Cupón</SectionLabel>

            <FormControlLabel
              control={
                <Switch
                  checked={formData.offer.enabled}
                  onChange={e => setField('offer.enabled', e.target.checked)}
                />
              }
              label="Incluir cupón de descuento"
            />

            {formData.offer.enabled && (
              <TextField
                label="Código de cupón"
                value={formData.offer.couponCode}
                onChange={e => setField('offer.couponCode', e.target.value.toUpperCase())}
                slotProps={{ htmlInput: { maxLength: 80 } }}
                helperText="Tiene que existir en Cupones: acá no se verifica."
                sx={{ maxWidth: 360 }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setFormDialog(null)}
            disabled={saving}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialog !== null}
        onClose={() => !busyId && setDeleteDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>Eliminar regla</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {deleteError && <Alert severity="error">{deleteError}</Alert>}
            <DialogContentText sx={{ overflowWrap: 'anywhere' }}>
              ¿Eliminar la regla &quot;{deleteDialog?.name}&quot;? Esta acción no se puede deshacer.
              Si solo querés que deje de mandar mensajes, editala y desactivala.
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDeleteDialog(null)}
            disabled={Boolean(busyId)}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={Boolean(busyId)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {busyId ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default AiCampaignRulesPage
