// 📁 admin/src/pages/AiCampaignRulesPage.jsx
//
// CRUD de reglas de campaña del Agente IA: carrito abandonado, follow-up de
// leads, post-compra y winback. El admin configura triggers, templates,
// horarios y ofertas. Endpoints: /ai-agent/campaign-rules/*.
import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Add as AddIcon,
  Campaign as CampaignIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import {
  deleteCampaignRule,
  listCampaignRules,
  upsertCampaignRule,
} from '../services/aiCampaignRuleService.js'

const RULE_TYPES = [
  { value: 'abandoned_cart', label: 'Carrito abandonado' },
  { value: 'lead_follow_up', label: 'Follow-up de lead' },
  { value: 'post_purchase', label: 'Post-compra' },
  { value: 'winback', label: 'Winback' },
]

const CHANNEL_OPTIONS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
]

const TYPE_COLOR = {
  abandoned_cart: 'warning',
  lead_follow_up: 'info',
  post_purchase: 'success',
  winback: 'secondary',
}

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''
const toBoolean = v => v === true || v === 'true'

const EMPTY_FORM = {
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

const RuleCard = ({ rule, busy, onEdit, onDelete }) => {
  const typeLabel = RULE_TYPES.find(t => t.value === rule.type)?.label || rule.type
  const channelLabel = CHANNEL_OPTIONS.find(c => c.value === rule.channel)?.label || rule.channel

  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={2}
        flexWrap="wrap"
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" mb={1}>
            <Chip size="small" label={typeLabel} color={TYPE_COLOR[rule.type] || 'default'} />
            <Chip size="small" variant="outlined" label={channelLabel} />
            <Chip
              size="small"
              variant="outlined"
              label={rule.enabled ? 'Activa' : 'Inactiva'}
              color={rule.enabled ? 'success' : 'default'}
            />
            {rule.offer?.enabled && rule.offer?.couponCode && (
              <Chip
                size="small"
                variant="outlined"
                color="secondary"
                label={`Cupón: ${rule.offer.couponCode}`}
              />
            )}
          </Stack>

          <Typography variant="subtitle1" fontWeight={700}>
            {rule.name || 'Sin nombre'}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 80,
              overflow: 'hidden',
            }}
          >
            {rule.messageTemplate}
          </Typography>

          <Stack direction="row" spacing={2} sx={{ mt: 1.5 }} flexWrap="wrap">
            <Typography variant="caption" color="text.secondary">
              Delay: {rule.trigger?.delayMinutes || 30} min
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Max intentos: {rule.trigger?.maxAttempts || 2}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Horario: {rule.trigger?.businessHours?.start || '09:00'} -{' '}
              {rule.trigger?.businessHours?.end || '20:00'}
            </Typography>
            {(rule.stats?.sent > 0 || rule.stats?.conversions > 0) && (
              <Typography variant="caption" color="text.secondary">
                Enviados: {rule.stats?.sent || 0} | Convertidos: {rule.stats?.conversions || 0}
              </Typography>
            )}
          </Stack>
        </Box>

        <Stack spacing={1} sx={{ minWidth: 120 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon />}
            disabled={busy}
            onClick={() => onEdit(rule)}
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
          >
            Eliminar
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

const AiCampaignRulesPage = () => {
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  const [formDialog, setFormDialog] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listCampaignRules()
      setRules(Array.isArray(data) ? data : [])
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
    setFormDialog('edit')
  }

  const setField = (path, value) => {
    setFormData(prev => {
      const parts = path.split('.')
      const next = JSON.parse(JSON.stringify(prev))
      let obj = next
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
      obj[parts[parts.length - 1]] = value
      return next
    })
  }

  const handleSave = useCallback(async () => {
    const name = clean(formData.name)
    const messageTemplate = clean(formData.messageTemplate)
    if (!name || !messageTemplate) {
      flash('Nombre y plantilla de mensaje son obligatorios.', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = { ...formData }
      delete payload._id
      await upsertCampaignRule(payload, formDialog === 'edit' ? formData._id : undefined)
      flash(formDialog === 'edit' ? 'Regla actualizada.' : 'Regla creada.')
      setFormDialog(null)
      load()
    } catch (err) {
      flash(err?.response?.data?.message || err?.message || 'Error al guardar.', 'error')
    } finally {
      setSaving(false)
    }
  }, [formData, formDialog, load])

  const handleDelete = useCallback(async () => {
    if (!deleteDialog) return
    const id = getId(deleteDialog)
    setBusyId(id)
    try {
      await deleteCampaignRule(id)
      flash('Regla eliminada.')
      setDeleteDialog(null)
      load()
    } catch (err) {
      flash(err?.response?.data?.message || err?.message || 'Error al eliminar.', 'error')
    } finally {
      setBusyId(null)
    }
  }, [deleteDialog, load])

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1080, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={2}
        mb={3}
      >
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CampaignIcon color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Reglas de campaña
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Reglas automáticas: carrito abandonado, follow-up, post-compra y winback.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreateDialog}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            Nueva regla
          </Button>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={load}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            Actualizar
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : rules.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
          <Typography color="text.secondary">No hay reglas de campaña configuradas.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {rules.map(rule => (
            <RuleCard
              key={getId(rule)}
              rule={rule}
              busy={busyId === getId(rule)}
              onEdit={openEditDialog}
              onDelete={setDeleteDialog}
            />
          ))}
        </Stack>
      )}

      <Dialog
        open={formDialog !== null}
        onClose={() => !saving && setFormDialog(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {formDialog === 'edit' ? 'Editar regla' : 'Nueva regla de campaña'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              label="Nombre"
              fullWidth
              value={formData.name}
              onChange={e => setField('name', e.target.value)}
              inputProps={{ maxLength: 150 }}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Tipo"
                value={formData.type}
                onChange={e => setField('type', e.target.value)}
                sx={{ minWidth: 200 }}
              >
                {RULE_TYPES.map(t => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
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

            <TextField
              label="Plantilla de mensaje"
              fullWidth
              multiline
              minRows={3}
              maxRows={8}
              value={formData.messageTemplate}
              onChange={e => setField('messageTemplate', e.target.value)}
              inputProps={{ maxLength: 2000 }}
              helperText="Variables: {{customerName}}, {{productName}}, {{cartTotal}}, {{checkoutUrl}}"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={formData.useAiPersonalization}
                  onChange={e => setField('useAiPersonalization', e.target.checked)}
                />
              }
              label="Personalización con IA"
            />

            <Divider />
            <Typography variant="subtitle2" fontWeight={700}>
              Trigger
            </Typography>

            <Grid container spacing={2}>
              <Grid xs={6} sm={4}>
                <TextField
                  label="Delay (min)"
                  type="number"
                  fullWidth
                  value={formData.trigger.delayMinutes}
                  onChange={e => setField('trigger.delayMinutes', Number(e.target.value))}
                  inputProps={{ min: 1, max: 43200 }}
                />
              </Grid>
              <Grid xs={6} sm={4}>
                <TextField
                  label="Max intentos"
                  type="number"
                  fullWidth
                  value={formData.trigger.maxAttempts}
                  onChange={e => setField('trigger.maxAttempts', Number(e.target.value))}
                  inputProps={{ min: 1, max: 5 }}
                />
              </Grid>
              <Grid xs={6} sm={4}>
                <TextField
                  label="Min horas entre contactos"
                  type="number"
                  fullWidth
                  value={formData.trigger.minHoursBetweenContacts}
                  onChange={e =>
                    setField('trigger.minHoursBetweenContacts', Number(e.target.value))
                  }
                  inputProps={{ min: 1, max: 168 }}
                />
              </Grid>
              <Grid xs={6} sm={4}>
                <TextField
                  label="Monto mín. carrito (centavos)"
                  type="number"
                  fullWidth
                  value={formData.trigger.minCartAmountCents}
                  onChange={e => setField('trigger.minCartAmountCents', Number(e.target.value))}
                  inputProps={{ min: 0 }}
                />
              </Grid>
              <Grid xs={6} sm={4}>
                <TextField
                  label="Hora inicio"
                  fullWidth
                  value={formData.trigger.businessHours.start}
                  onChange={e => setField('trigger.businessHours.start', e.target.value)}
                  placeholder="09:00"
                />
              </Grid>
              <Grid xs={6} sm={4}>
                <TextField
                  label="Hora fin"
                  fullWidth
                  value={formData.trigger.businessHours.end}
                  onChange={e => setField('trigger.businessHours.end', e.target.value)}
                  placeholder="20:00"
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

            <Divider />
            <Typography variant="subtitle2" fontWeight={700}>
              Template de WhatsApp (fuera de ventana 24h)
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
                  inputProps={{ maxLength: 120 }}
                />
                <TextField
                  label="Idioma"
                  value={formData.whatsappTemplate.languageCode}
                  onChange={e => setField('whatsappTemplate.languageCode', e.target.value)}
                  inputProps={{ maxLength: 20 }}
                  sx={{ minWidth: 120 }}
                />
              </Stack>
            )}

            <Divider />
            <Typography variant="subtitle2" fontWeight={700}>
              Oferta / Cupón
            </Typography>

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
                onChange={e => setField('offer.couponCode', e.target.value)}
                inputProps={{ maxLength: 80 }}
                sx={{ maxWidth: 300 }}
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
            sx={{ textTransform: 'none' }}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialog !== null} onClose={() => setDeleteDialog(null)} maxWidth="xs">
        <DialogTitle>Eliminar regla</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Eliminar la regla &quot;{deleteDialog?.name}&quot;? Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialog(null)} sx={{ textTransform: 'none' }}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            sx={{ textTransform: 'none' }}
          >
            Eliminar
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
