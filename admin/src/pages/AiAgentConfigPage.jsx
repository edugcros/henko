// 📁 admin/src/pages/AiAgentConfigPage.jsx
//
// Configuración del Agente IA por tenant. Lee GET /ai-agent/config y guarda
// con PUT /ai-agent/config. Es la pantalla que habilita WhatsApp y ajusta
// personalidad, comportamiento, políticas, guardrails y autolímites.
//
// Los topes reales de consumo NO se editan acá: los fija el plan del comercio
// y se muestran en AiBudgetPanel (GET /ai-agent/budget). Los campos de cuota
// que esta pantalla tenía antes eran editables pero ya no son el tope real,
// así que quedaron reetiquetados como autolímites — solo sirven para gastar
// menos que el plan. Ver backend/docs/AI_COST_CONTAINMENT.md.
//
// Secretos de WhatsApp (accessToken, appSecret, verifyToken): el backend
// NUNCA los devuelve (son select:false). Por eso los campos arrancan vacíos
// y solo se envían si el admin escribe uno nuevo — enviar '' los borraría.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  Insights as InsightsIcon,
  Save as SaveIcon,
  SmartToy as SmartToyIcon,
  WhatsApp as WhatsAppIcon,
} from '@mui/icons-material'
import { getAiAgentConfig, updateAiAgentConfig } from '../services/aiAgentConfigService.js'
import AiBudgetPanel from '../components/aiBudget/AiBudgetPanel.jsx'

const TONE_OPTIONS = [
  { value: 'friendly', label: 'Cercano' },
  { value: 'formal', label: 'Formal' },
  { value: 'premium', label: 'Premium' },
  { value: 'technical', label: 'Técnico' },
  { value: 'sales', label: 'Vendedor' },
]

const clean = value => String(value ?? '').trim()
const toList = value => (Array.isArray(value) ? value.join(', ') : clean(value))
const fromList = value =>
  clean(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

// Mapea el agente que devuelve el backend al estado del formulario, con
// defaults seguros para un agente recién provisionado.
const toForm = agent => {
  const a = agent || {}
  const ch = a.channels || {}
  const wa = ch.whatsapp || {}
  const bc = a.businessContext || {}
  const pol = bc.policies || {}

  return {
    name: a.name || '',
    enabled: Boolean(a.enabled),

    webchatEnabled: ch.webchat?.enabled !== false,

    whatsappEnabled: Boolean(wa.enabled),
    phoneNumberId: wa.phoneNumberId || '',
    businessAccountId: wa.businessAccountId || '',
    // Secretos: siempre vacíos (el backend no los envía).
    accessToken: '',
    appSecret: '',
    verifyToken: '',

    tone: a.personality?.tone || 'friendly',
    language: a.personality?.language || 'es-AR',
    signature: a.personality?.signature || '',

    canRecommendProducts: a.behavior?.canRecommendProducts !== false,
    canCreateCartLinks: a.behavior?.canCreateCartLinks !== false,
    canOfferDiscounts: Boolean(a.behavior?.canOfferDiscounts),
    requireHumanForPayments: a.behavior?.requireHumanForPayments !== false,
    requireHumanForClaims: a.behavior?.requireHumanForClaims !== false,
    maxMessagesBeforeHuman: Number(a.behavior?.maxMessagesBeforeHuman ?? 14),
    minConfidenceToAnswer: Number(a.behavior?.minConfidenceToAnswer ?? 0.55),

    description: bc.description || '',
    shipping: pol.shipping || '',
    returns: pol.returns || '',
    payments: pol.payments || '',
    warranty: pol.warranty || '',
    privacy: pol.privacy || '',

    blockedTopics: toList(a.guardrails?.blockedTopics),
    humanHandoffKeywords: toList(a.guardrails?.humanHandoffKeywords),
    optOutKeywords: toList(a.guardrails?.optOutKeywords),

    learningEnabled: a.learning?.enabled !== false,
    learningRequireApproval: a.learning?.requireApproval !== false,

    monthlyMessageLimit: Number(a.quotas?.monthlyMessageLimit ?? 3000),
    monthlyAiTokenLimit: Number(a.quotas?.monthlyAiTokenLimit ?? 1000000),
  }
}

// Arma el payload del PUT. Los secretos solo se incluyen si el admin
// escribió algo — así no se pisan los ya guardados con un string vacío.
const toPayload = form => {
  const whatsapp = {
    enabled: form.whatsappEnabled,
    phoneNumberId: clean(form.phoneNumberId),
    businessAccountId: clean(form.businessAccountId),
  }
  if (clean(form.accessToken)) whatsapp.accessToken = clean(form.accessToken)
  if (clean(form.appSecret)) whatsapp.appSecret = clean(form.appSecret)
  if (clean(form.verifyToken)) whatsapp.verifyToken = clean(form.verifyToken)

  return {
    name: clean(form.name),
    enabled: form.enabled,
    channels: {
      webchat: { enabled: form.webchatEnabled },
      whatsapp,
    },
    personality: {
      tone: form.tone,
      language: clean(form.language),
      signature: clean(form.signature),
    },
    behavior: {
      canRecommendProducts: form.canRecommendProducts,
      canCreateCartLinks: form.canCreateCartLinks,
      canOfferDiscounts: form.canOfferDiscounts,
      requireHumanForPayments: form.requireHumanForPayments,
      requireHumanForClaims: form.requireHumanForClaims,
      maxMessagesBeforeHuman: Number(form.maxMessagesBeforeHuman) || 14,
      minConfidenceToAnswer: Number(form.minConfidenceToAnswer) || 0.55,
    },
    guardrails: {
      blockedTopics: fromList(form.blockedTopics),
      humanHandoffKeywords: fromList(form.humanHandoffKeywords),
      optOutKeywords: fromList(form.optOutKeywords),
    },
    learning: {
      enabled: form.learningEnabled,
      requireApproval: form.learningRequireApproval,
    },
    businessContext: {
      description: clean(form.description),
      policies: {
        shipping: clean(form.shipping),
        returns: clean(form.returns),
        payments: clean(form.payments),
        warranty: clean(form.warranty),
        privacy: clean(form.privacy),
      },
    },
    quotas: {
      monthlyMessageLimit: Number(form.monthlyMessageLimit) || 0,
      monthlyAiTokenLimit: Number(form.monthlyAiTokenLimit) || 0,
    },
  }
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

const AiAgentConfigPage = () => {
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
      const agent = await getAiAgentConfig()
      setForm(toForm(agent))
    } catch (err) {
      console.error('[AI_AGENT_CONFIG_LOAD_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar la configuración del agente.',
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
      const agent = await updateAiAgentConfig(toPayload(form))
      // Rehidratamos desde la respuesta: limpia los campos de secreto y
      // refleja lo que realmente quedó guardado.
      setForm(toForm(agent))
      setSnackbar({
        open: true,
        severity: 'success',
        message: 'Configuración guardada.',
      })
    } catch (err) {
      console.error('[AI_AGENT_CONFIG_SAVE_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudo guardar la configuración.',
      )
    } finally {
      setSaving(false)
    }
  }, [form])

  const whatsappSecretHelp = useMemo(
    () => (form?.phoneNumberId ? 'Dejá en blanco para no cambiar el valor guardado.' : ''),
    [form?.phoneNumberId],
  )

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
            Agente IA · Configuración
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Activá el agente, conectá WhatsApp y ajustá cómo conversa con tus clientes.
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
          title="General"
          subtitle="Interruptor maestro del agente y su nombre visible."
          icon={<SmartToyIcon color="primary" />}
        >
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={7}>
              <TextField
                fullWidth
                label="Nombre del asistente"
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                inputProps={{ maxLength: 100 }}
              />
            </Grid>
            <Grid item xs={12} sm={5} display="flex" alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={e => setField('enabled', e.target.checked)}
                  />
                }
                label={form.enabled ? 'Agente activado' : 'Agente desactivado'}
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard
          title="Canales"
          subtitle="El webchat funciona sin configuración. Para WhatsApp cargá las credenciales de tu app de Meta."
          icon={<WhatsAppIcon sx={{ color: '#25D366' }} />}
        >
          <Stack spacing={2.5}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.webchatEnabled}
                  onChange={e => setField('webchatEnabled', e.target.checked)}
                />
              }
              label="Webchat en la tienda"
            />

            <Divider />

            <FormControlLabel
              control={
                <Switch
                  checked={form.whatsappEnabled}
                  onChange={e => setField('whatsappEnabled', e.target.checked)}
                />
              }
              label="WhatsApp"
            />

            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Phone Number ID"
                  value={form.phoneNumberId}
                  onChange={e => setField('phoneNumberId', e.target.value)}
                  inputProps={{ maxLength: 300 }}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="Business Account ID"
                  value={form.businessAccountId}
                  onChange={e => setField('businessAccountId', e.target.value)}
                  inputProps={{ maxLength: 300 }}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  type="password"
                  label="Access Token"
                  value={form.accessToken}
                  onChange={e => setField('accessToken', e.target.value)}
                  placeholder="••••••••"
                  helperText={whatsappSecretHelp}
                  autoComplete="new-password"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="password"
                  label="App Secret"
                  value={form.appSecret}
                  onChange={e => setField('appSecret', e.target.value)}
                  placeholder="••••••••"
                  helperText={whatsappSecretHelp}
                  autoComplete="new-password"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  type="password"
                  label="Verify Token"
                  value={form.verifyToken}
                  onChange={e => setField('verifyToken', e.target.value)}
                  placeholder="••••••••"
                  helperText={whatsappSecretHelp}
                  autoComplete="new-password"
                />
              </Grid>
            </Grid>
          </Stack>
        </SectionCard>

        <SectionCard title="Personalidad" subtitle="Cómo se presenta y habla el asistente.">
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={4}>
              <TextField
                select
                fullWidth
                label="Tono"
                value={form.tone}
                onChange={e => setField('tone', e.target.value)}
              >
                {TONE_OPTIONS.map(option => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Idioma"
                value={form.language}
                onChange={e => setField('language', e.target.value)}
                inputProps={{ maxLength: 20 }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Firma"
                value={form.signature}
                onChange={e => setField('signature', e.target.value)}
                inputProps={{ maxLength: 250 }}
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard
          title="Comportamiento"
          subtitle="Qué puede hacer el agente y cuándo derivar a una persona."
        >
          <Grid container spacing={1.5}>
            {[
              ['canRecommendProducts', 'Puede recomendar productos'],
              ['canCreateCartLinks', 'Puede armar links de carrito'],
              ['canOfferDiscounts', 'Puede ofrecer descuentos'],
              ['requireHumanForPayments', 'Deriva a humano en pagos'],
              ['requireHumanForClaims', 'Deriva a humano en reclamos'],
            ].map(([key, label]) => (
              <Grid item xs={12} sm={6} key={key}>
                <FormControlLabel
                  control={
                    <Switch checked={form[key]} onChange={e => setField(key, e.target.checked)} />
                  }
                  label={label}
                />
              </Grid>
            ))}
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Máx. mensajes antes de derivar"
                value={form.maxMessagesBeforeHuman}
                onChange={e => setField('maxMessagesBeforeHuman', e.target.value)}
                inputProps={{ min: 1, max: 80 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Confianza mínima para responder"
                value={form.minConfidenceToAnswer}
                onChange={e => setField('minConfidenceToAnswer', e.target.value)}
                inputProps={{ min: 0, max: 1, step: 0.05 }}
                helperText="Entre 0 y 1"
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard
          title="Contexto y políticas del comercio"
          subtitle="Lo que el agente puede afirmar sobre envíos, pagos, cambios y garantía. Si queda vacío, deriva."
        >
          <Stack spacing={2.5}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Descripción del comercio"
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              inputProps={{ maxLength: 5000 }}
            />
            <Grid container spacing={2.5}>
              {[
                ['shipping', 'Envíos'],
                ['returns', 'Cambios y devoluciones'],
                ['payments', 'Pagos'],
                ['warranty', 'Garantía'],
                ['privacy', 'Privacidad'],
              ].map(([key, label]) => (
                <Grid item xs={12} sm={6} key={key}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    label={label}
                    value={form[key]}
                    onChange={e => setField(key, e.target.value)}
                    inputProps={{ maxLength: 4000 }}
                  />
                </Grid>
              ))}
            </Grid>
          </Stack>
        </SectionCard>

        <SectionCard
          title="Guardrails"
          subtitle="Palabras separadas por coma. Disparan bloqueo, derivación a humano u opt-out."
        >
          <Stack spacing={2.5}>
            <TextField
              fullWidth
              label="Temas bloqueados"
              value={form.blockedTopics}
              onChange={e => setField('blockedTopics', e.target.value)}
              placeholder="política, religión"
            />
            <TextField
              fullWidth
              label="Palabras que derivan a humano"
              value={form.humanHandoffKeywords}
              onChange={e => setField('humanHandoffKeywords', e.target.value)}
              placeholder="reclamo, abogado, estafa"
            />
            <TextField
              fullWidth
              label="Palabras de baja (opt-out)"
              value={form.optOutKeywords}
              onChange={e => setField('optOutKeywords', e.target.value)}
              placeholder="baja, cancelar, no me escribas"
            />
          </Stack>
        </SectionCard>

        <SectionCard
          title="Consumo de IA del mes"
          subtitle="Cuánto llevás usado de cada función, según tu plan."
          icon={<InsightsIcon color="primary" />}
        >
          <AiBudgetPanel />
        </SectionCard>

        <SectionCard
          title="Aprendizaje y autolímites"
          subtitle="Autoaprendizaje con revisión humana, y topes propios para gastar menos que tu plan."
        >
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.learningEnabled}
                    onChange={e => setField('learningEnabled', e.target.checked)}
                  />
                }
                label="Autoaprendizaje activado"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.learningRequireApproval}
                    onChange={e => setField('learningRequireApproval', e.target.checked)}
                  />
                }
                label="Requiere aprobación humana"
              />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info" variant="outlined" sx={{ borderRadius: 2, mt: 1 }}>
                Estos dos valores son <strong>autolímites</strong>: sirven para consumir menos que
                tu plan, no para ampliarlo. El tope real es el del plan y lo ves arriba. Dejalos en
                0 para usar el plan completo.
              </Alert>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Autolímite de mensajes por mes"
                value={form.monthlyMessageLimit}
                onChange={e => setField('monthlyMessageLimit', e.target.value)}
                inputProps={{ min: 0 }}
                helperText="0 = sin autolímite (usa el tope del plan)"
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="number"
                label="Autolímite de tokens por mes"
                value={form.monthlyAiTokenLimit}
                onChange={e => setField('monthlyAiTokenLimit', e.target.value)}
                inputProps={{ min: 0 }}
                helperText="0 = sin autolímite (usa el tope del plan)"
                InputProps={{
                  endAdornment: <InputAdornment position="end">tokens</InputAdornment>,
                }}
              />
            </Grid>
          </Grid>
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

export default AiAgentConfigPage
