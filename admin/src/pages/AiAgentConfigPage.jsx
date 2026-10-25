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
// Secretos de WhatsApp (accessToken, appSecret): el backend
// NUNCA los devuelve (son select:false). Por eso los campos arrancan vacíos
// y solo se envían si el admin escribe uno nuevo — enviar '' los borraría.
//
// Los rangos de validación copian los de buildAgentConfigUpdate
// (backend/src/controller/aiAgentCtrl.js). El backend no rechaza un valor
// fuera de rango: lo recorta o lo cambia por el default sin avisar, así que
// si no se valida acá el comercio guarda una cosa y queda otra.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Collapse,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Link,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  CheckCircle as CheckIcon,
  ContentCopy as CopyIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  ReportProblem as WarningIcon,
  Save as SaveIcon,
  WhatsApp as WhatsAppIcon,
} from '@mui/icons-material'
import { env } from '../config/env.js'
import {
  checkWhatsappConnection,
  getAiAgentConfig,
  updateAiAgentConfig,
} from '../services/aiAgentConfigService.js'
import AiBudgetPanel from '../components/aiBudget/AiBudgetPanel.jsx'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
  amber: '#b45309',
  red: '#b42318',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// Lo que se revisa al probar la conexión, en el orden en que se rompe.
const CONNECTION_ITEMS = [
  { key: 'accessToken', label: 'Access Token' },
  { key: 'phoneNumberId', label: 'Número de WhatsApp' },
  { key: 'appSecret', label: 'App Secret (para recibir mensajes)' },
  { key: 'webhook', label: 'Webhook suscripto en Meta' },
]

// La URL que hay que pegar en Meta. Sale de la misma base con la que el panel
// le habla al backend, así que no puede quedar desactualizada respecto del
// deploy que estás mirando.
const WEBHOOK_URL = `${String(env.apiBaseUrl || '').replace(/\/+$/, '')}/whatsapp/webhook`

const TONE_OPTIONS = [
  { value: 'friendly', label: 'Cercano' },
  { value: 'formal', label: 'Formal' },
  { value: 'premium', label: 'Premium' },
  { value: 'technical', label: 'Técnico' },
  { value: 'sales', label: 'Vendedor' },
]

const BEHAVIOR_SWITCHES = [
  {
    key: 'canRecommendProducts',
    label: 'Puede recomendar productos',
    help: 'Sugiere productos del catálogo según lo que pregunta el cliente.',
  },
  {
    key: 'canCreateCartLinks',
    label: 'Puede armar links de carrito',
    help: 'Manda un link con los productos ya cargados para comprar.',
  },
  {
    key: 'canOfferDiscounts',
    label: 'Puede ofrecer descuentos',
    help: 'Si el cliente pregunta por promociones, sugiere un cupón activo de la tienda.',
  },
  {
    key: 'requireHumanForPayments',
    label: 'Deriva a humano en pagos',
    help: 'Pagos rechazados, contracargos, comprobantes de transferencia.',
  },
  {
    key: 'requireHumanForClaims',
    label: 'Deriva a humano en reclamos',
    help: 'Reclamos, devoluciones, reembolsos o denuncias.',
  },
]

const POLICY_FIELDS = [
  ['shipping', 'Envíos'],
  ['returns', 'Cambios y devoluciones'],
  ['payments', 'Pagos'],
  ['warranty', 'Garantía'],
  ['privacy', 'Privacidad'],
]

const GUARDRAIL_FIELDS = [
  { key: 'blockedTopics', label: 'Temas bloqueados', placeholder: 'política, religión' },
  {
    key: 'humanHandoffKeywords',
    label: 'Palabras que derivan a humano',
    placeholder: 'reclamo, abogado, estafa',
  },
  {
    key: 'optOutKeywords',
    label: 'Palabras de baja (opt-out)',
    placeholder: 'baja, cancelar, no me escribas',
  },
]

// Las credenciales que usa "Probar la conexión". Si alguna cambió y no se
// guardó, la prueba revisaría los datos viejos.
const WHATSAPP_CREDENTIAL_KEYS = ['phoneNumberId', 'businessAccountId', 'accessToken', 'appSecret']

const MAX_LIST_ITEMS = 80

// La firma, la confianza mínima y "requiere aprobación" se guardan, pero
// ningún servicio del backend los lee todavía. Decirlo es mejor que prometer
// un efecto que no existe.
const NOT_USED_YET = 'Se guarda, pero el asistente todavía no lo tiene en cuenta.'

const clean = value => String(value ?? '').trim()
const toList = value => (Array.isArray(value) ? value.join(', ') : clean(value))
const fromList = value =>
  clean(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// '' cuenta como "no hay número", no como cero: Number('') es 0 y con eso un
// campo vacío pasaba la validación.
const toNumber = value => (clean(value) === '' ? NaN : Number(value))

// Mapea el agente que devuelve el backend al estado del formulario, con
// defaults seguros para un agente recién provisionado.
export const toForm = agent => {
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

    // 0 = sin autolímite, que es lo que dicen los dos campos del formulario.
    // El fallback viejo (3000 / 1M) reescribía un autolímite que el comercio
    // nunca pidió cada vez que guardaba cualquier otra cosa de esta pantalla.
    monthlyMessageLimit: Number(a.quotas?.monthlyMessageLimit ?? 0),
    monthlyAiTokenLimit: Number(a.quotas?.monthlyAiTokenLimit ?? 0),
  }
}

const wholeNumberError = (value, min, max, label) => {
  const number = toNumber(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    return `${label} entre ${min.toLocaleString('es-AR')} y ${max.toLocaleString('es-AR')}, sin decimales.`
  }
  return ''
}

// Devuelve { campo: mensaje } con lo que el backend recortaría o cambiaría
// sin avisar. Vacío = se puede guardar.
export const validateForm = form => {
  const errors = {}

  if (!clean(form.name)) errors.name = 'Poné un nombre: es como se presenta el asistente.'

  const maxMessages = wholeNumberError(form.maxMessagesBeforeHuman, 1, 80, 'Tiene que ser')
  if (maxMessages) errors.maxMessagesBeforeHuman = maxMessages

  const confidence = toNumber(form.minConfidenceToAnswer)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.minConfidenceToAnswer = 'Tiene que ser un número entre 0 y 1 (por ejemplo 0,55).'
  }

  const messages = wholeNumberError(form.monthlyMessageLimit, 0, 1000000, 'Tiene que ser')
  if (messages) errors.monthlyMessageLimit = messages

  const tokens = wholeNumberError(form.monthlyAiTokenLimit, 0, 1000000000, 'Tiene que ser')
  if (tokens) errors.monthlyAiTokenLimit = tokens

  for (const { key } of GUARDRAIL_FIELDS) {
    const count = fromList(form[key]).length
    if (count > MAX_LIST_ITEMS) {
      errors[key] =
        `Hay ${count} palabras y se guardan hasta ${MAX_LIST_ITEMS}: las demás se perderían.`
    }
  }

  return errors
}

// Arma el payload del PUT. Los secretos solo se incluyen si el admin
// escribió algo — así no se pisan los ya guardados con un string vacío.
// Los números llegan ya validados: nada de `|| default`, que convertía una
// confianza mínima de 0 en 0,55.
export const toPayload = form => {
  const whatsapp = {
    enabled: form.whatsappEnabled,
    phoneNumberId: clean(form.phoneNumberId),
    businessAccountId: clean(form.businessAccountId),
  }
  if (clean(form.accessToken)) whatsapp.accessToken = clean(form.accessToken)
  if (clean(form.appSecret)) whatsapp.appSecret = clean(form.appSecret)

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
      maxMessagesBeforeHuman: toNumber(form.maxMessagesBeforeHuman),
      minConfidenceToAnswer: toNumber(form.minConfidenceToAnswer),
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
      monthlyMessageLimit: toNumber(form.monthlyMessageLimit),
      monthlyAiTokenLimit: toNumber(form.monthlyAiTokenLimit),
    },
  }
}

const sameValue = (a, b) => String(a ?? '') === String(b ?? '')

// Qué dice el resumen sobre WhatsApp, con lo guardado y la última prueba.
export const whatsappStatus = (saved, connection) => {
  if (!saved.whatsappEnabled) return { label: 'Apagado', color: BRAND.muted }
  if (!saved.phoneNumberId) return { label: 'Faltan datos', color: BRAND.amber }
  if (!connection?.checks) return { label: 'Sin probar', color: BRAND.blue }
  return connection.connected
    ? { label: 'Conectado', color: BRAND.green }
    : { label: 'Con problemas', color: BRAND.red }
}

const learningStatus = saved => {
  if (!saved.learningEnabled) return { label: 'Apagado', color: BRAND.muted }
  return saved.learningRequireApproval
    ? { label: 'Con revisión', color: BRAND.green }
    : { label: 'Sin revisión', color: BRAND.amber }
}

const onOff = value =>
  value ? { label: 'Activo', color: BRAND.green } : { label: 'Apagado', color: BRAND.muted }

// Cada celda del resumen lleva a su sección.
const StatusTile = ({ title, status, target }) => (
  <ButtonBase
    onClick={() => document.getElementById(target)?.scrollIntoView?.({ behavior: 'smooth' })}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 0.25,
      width: '100%',
      p: 2,
      textAlign: 'left',
      '&:hover': { bgcolor: BRAND.paper },
    }}
  >
    <Typography
      component="span"
      variant="caption"
      sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
    >
      {title}
    </Typography>
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box
        component="span"
        sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: status.color, flexShrink: 0 }}
      />
      <Typography
        component="span"
        sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 17, color: BRAND.ink }}
      >
        {status.label}
      </Typography>
    </Stack>
  </ButtonBase>
)

const Section = ({ id, title, subtitle, action, children }) => (
  <Paper
    component="section"
    id={id}
    aria-labelledby={`${id}-titulo`}
    variant="outlined"
    sx={{ ...PANEL_SX, p: { xs: 2, sm: 3 }, scrollMarginTop: 80 }}
  >
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, mb: 2.5 }}
    >
      <Box>
        <Typography
          id={`${id}-titulo`}
          component="h2"
          sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 19, color: BRAND.ink }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ color: BRAND.muted, mt: 0.5, maxWidth: 640 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
    {children}
  </Paper>
)

// Un interruptor con su explicación debajo. La explicación queda fuera del
// label para que el nombre accesible del switch siga siendo corto.
const SwitchRow = ({ checked, onChange, label, help }) => (
  <Box>
    <FormControlLabel
      control={<Switch checked={checked} onChange={e => onChange(e.target.checked)} />}
      label={label}
    />
    {help && (
      <Typography variant="caption" component="p" sx={{ color: BRAND.muted, ml: 6, mt: -0.5 }}>
        {help}
      </Typography>
    )}
  </Box>
)

const CopyField = ({ label, value, copied, onCopy, disabled, ariaLabel }) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
    <TextField
      fullWidth
      size="small"
      label={label}
      value={value}
      slotProps={{ input: { readOnly: true } }}
      onFocus={event => event.target.select()}
    />
    <Tooltip title={copied ? 'Copiado' : 'Copiar'}>
      <span>
        <IconButton
          disabled={disabled}
          onClick={onCopy}
          color={copied ? 'success' : 'default'}
          aria-label={ariaLabel}
        >
          <CopyIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  </Stack>
)

const AiAgentConfigPage = () => {
  const isMobile = useMediaQuery('(max-width:600px)')
  const [form, setForm] = useState(null)
  // Lo último que confirmó el backend. Contra esto se compara para saber si
  // hay cambios sin guardar y para "Descartar cambios".
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [triedToSave, setTriedToSave] = useState(false)
  const [snackbar, setSnackbar] = useState({ open: false, message: '' })

  const [copied, setCopied] = useState('')
  const [checking, setChecking] = useState(false)
  const [connection, setConnection] = useState(null)
  const [checkError, setCheckError] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)

  const applyAgent = useCallback(agent => {
    const next = toForm(agent)
    setForm(next)
    setSaved(next)
    return next
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const next = applyAgent(await getAiAgentConfig())
      // La guía arranca abierta mientras WhatsApp no tenga ni el número.
      setGuideOpen(!next.phoneNumberId)
    } catch (err) {
      console.error('[AI_AGENT_CONFIG_LOAD_ERROR]', err)
      setLoadError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar la configuración del agente.',
      )
    } finally {
      setLoading(false)
    }
  }, [applyAgent])

  useEffect(() => {
    load()
  }, [load])

  const setField = useCallback((key, value) => setForm(prev => ({ ...prev, [key]: value })), [])

  const errors = useMemo(() => (form ? validateForm(form) : {}), [form])
  const errorCount = Object.keys(errors).length

  const dirty = useMemo(
    () =>
      Boolean(form && saved) && Object.keys(form).some(key => !sameValue(form[key], saved[key])),
    [form, saved],
  )

  const credentialsDirty = useMemo(
    () =>
      Boolean(form && saved) &&
      WHATSAPP_CREDENTIAL_KEYS.some(key => !sameValue(form[key], saved[key])),
    [form, saved],
  )

  // Un error se muestra en cuanto el campo tiene algo inválido, salvo el
  // nombre vacío: ese recién después de intentar guardar, para no retar a
  // nadie mientras borra para reescribir.
  const fieldError = key => (key === 'name' && !triedToSave ? '' : errors[key] || '')

  const handleSave = useCallback(async () => {
    if (!form || saving) return
    setTriedToSave(true)
    setSaveError('')
    if (errorCount > 0) return

    setSaving(true)
    try {
      // Rehidratamos desde la respuesta: limpia los campos de secreto y
      // refleja lo que realmente quedó guardado.
      applyAgent(await updateAiAgentConfig(toPayload(form)))
      setTriedToSave(false)
      setSnackbar({ open: true, message: 'Configuración guardada.' })
    } catch (err) {
      console.error('[AI_AGENT_CONFIG_SAVE_ERROR]', err)
      setSaveError(
        err?.response?.data?.message || err?.message || 'No se pudo guardar la configuración.',
      )
    } finally {
      setSaving(false)
    }
  }, [applyAgent, errorCount, form, saving])

  const discardChanges = useCallback(() => {
    setForm(saved)
    setSaveError('')
    setTriedToSave(false)
  }, [saved])

  const copyValue = useCallback(async (key, value) => {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied(''), 2000)
    } catch {
      // Sin permiso de portapapeles el campo igual se puede seleccionar y
      // copiar a mano: no vale la pena molestar con un error por esto.
    }
  }, [])

  // Le pregunta a Meta si los datos guardados sirven. No manda mensajes: solo
  // lee el número y la suscripción del webhook, y traduce lo que responde.
  const runConnectionCheck = useCallback(async () => {
    setChecking(true)
    setCheckError('')

    try {
      setConnection(await checkWhatsappConnection())
    } catch (err) {
      setCheckError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo verificar la conexión de WhatsApp.',
      )
    } finally {
      setChecking(false)
    }
  }, [])

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
          {loadError || 'No se pudo cargar la configuración.'}
        </Alert>
      </Box>
    )
  }

  const secretHelp = saved.phoneNumberId
    ? 'Dejalo vacío para no cambiar el guardado. Nunca se muestra el valor guardado.'
    : 'Pegalo desde el panel de Meta.'
  const failingChecks = connection?.checks
    ? CONNECTION_ITEMS.filter(item => !connection.checks[item.key]?.ok).length
    : 0

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 980, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          ASISTENTE
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
          Configuración
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Prendé el asistente, conectá WhatsApp y decidí qué puede hacer cuando habla con tus
          clientes.
        </Typography>
      </Box>

      <Paper
        component="section"
        aria-label="Estado del asistente"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          }}
        >
          <StatusTile title="Asistente" status={onOff(saved.enabled)} target="config-general" />
          <StatusTile
            title="Webchat"
            status={onOff(saved.webchatEnabled)}
            target="config-canales"
          />
          <StatusTile
            title="WhatsApp"
            status={whatsappStatus(saved, connection)}
            target="config-whatsapp"
          />
          <StatusTile
            title="Aprendizaje"
            status={learningStatus(saved)}
            target="config-aprendizaje"
          />
        </Box>
      </Paper>

      <Stack spacing={3}>
        <Section
          id="config-general"
          title="General"
          subtitle="El interruptor maestro: apagado, el asistente no contesta en ningún canal."
        >
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField
                fullWidth
                label="Nombre del asistente"
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                error={Boolean(fieldError('name'))}
                helperText={fieldError('name') || 'Así se presenta ante tus clientes.'}
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }} sx={{ display: 'flex', alignItems: 'center' }}>
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
        </Section>

        <Section
          id="config-canales"
          title="Webchat"
          subtitle="La burbuja de chat en tu tienda. Funciona sin configurar nada más."
        >
          <SwitchRow
            checked={form.webchatEnabled}
            onChange={value => setField('webchatEnabled', value)}
            label="Webchat en la tienda"
          />
        </Section>

        <Section
          id="config-whatsapp"
          title="WhatsApp"
          subtitle="El asistente contesta en el WhatsApp de tu negocio. Necesita una app de Meta, que se arma una sola vez."
          action={<WhatsAppIcon sx={{ color: '#25D366', display: { xs: 'none', sm: 'block' } }} />}
        >
          <Stack spacing={2.5}>
            <SwitchRow
              checked={form.whatsappEnabled}
              onChange={value => setField('whatsappEnabled', value)}
              label="WhatsApp"
              help={
                form.whatsappEnabled && !clean(form.phoneNumberId)
                  ? 'Prendido pero sin Phone Number ID: no va a entrar ni salir ningún mensaje.'
                  : ''
              }
            />

            {/*
              Los seis pasos, escritos para quien nunca abrió el panel de Meta.
              Antes no había nada: ni la URL del webhook, ni qué campo sale de
              dónde, ni qué pasa si falta uno. Todo eso vivía en el código.
            */}
            <Box sx={{ border: `1px solid ${BRAND.line}`, borderRadius: 3, bgcolor: BRAND.paper }}>
              <ButtonBase
                onClick={() => setGuideOpen(open => !open)}
                aria-expanded={guideOpen}
                aria-controls="guia-whatsapp"
                sx={{
                  width: '100%',
                  justifyContent: 'space-between',
                  px: 2.5,
                  py: 1.75,
                  borderRadius: 3,
                  textAlign: 'left',
                }}
              >
                <Typography sx={{ fontWeight: 700, color: BRAND.ink }}>
                  Cómo conectar WhatsApp: se hace una sola vez
                </Typography>
                {guideOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </ButtonBase>

              <Collapse in={guideOpen} id="guia-whatsapp">
                <Box sx={{ px: 2.5, pb: 2.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Vas a necesitar un número de celular que <strong>no</strong> esté usando
                    WhatsApp (ni el común ni el Business) y una cuenta de Facebook. Todo lo que
                    sigue se hace en el sitio de Meta, y después se pega en los campos de abajo.
                  </Typography>

                  <Box component="ol" sx={{ pl: 2.5, m: 0, '& li': { mb: 1.25 } }}>
                    <li>
                      <Typography variant="body2">
                        Entrá a{' '}
                        <Link
                          href="https://developers.facebook.com/apps"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          developers.facebook.com/apps
                        </Link>{' '}
                        y creá una aplicación. Cuando pregunte de qué tipo, elegí{' '}
                        <strong>Empresa</strong>.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        Dentro de la aplicación agregá el producto <strong>WhatsApp</strong>. Meta
                        va a pedirte asociar una cuenta de empresa: creala ahí mismo si no tenés.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        En <strong>WhatsApp → Configuración de la API</strong> están el{' '}
                        <strong>Phone Number ID</strong> y el <strong>Business Account ID</strong>.
                        Copialos abajo. Ojo: es el identificador del número, no el número de
                        teléfono.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        En esa misma pantalla hay un <strong>Access Token</strong> temporal. Sirve
                        para probar hoy, pero <strong>vence en 24 horas</strong>: para que no se
                        corte, generá uno permanente en{' '}
                        <em>Configuración del negocio → Usuarios del sistema</em>.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2">
                        El <strong>App Secret</strong> está en{' '}
                        <em>Configuración de la app → Básico</em>, botón &quot;Mostrar&quot;. Sin
                        este dato <strong>no entra ningún mensaje</strong>: es con lo que se
                        comprueba que lo que llega viene de Meta y no de un tercero.
                      </Typography>
                    </li>
                    <li>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        Por último el webhook: en <em>WhatsApp → Configuración → Editar</em>, pegá
                        estos dos valores y marcá la casilla <strong>messages</strong>.
                      </Typography>

                      <Stack spacing={1}>
                        <CopyField
                          label="URL de devolución de llamada"
                          value={WEBHOOK_URL}
                          copied={copied === 'url'}
                          onCopy={() => copyValue('url', WEBHOOK_URL)}
                          ariaLabel="Copiar la URL del webhook"
                        />
                        <CopyField
                          label="Token de verificación"
                          value={
                            connection?.verifyToken || 'Tocá "Probar la conexión" para generarlo'
                          }
                          copied={copied === 'token'}
                          disabled={!connection?.verifyToken}
                          onCopy={() => copyValue('token', connection?.verifyToken)}
                          ariaLabel="Copiar el token de verificación"
                        />
                      </Stack>
                    </li>
                  </Box>
                </Box>
              </Collapse>
            </Box>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Phone Number ID"
                  value={form.phoneNumberId}
                  onChange={e => setField('phoneNumberId', e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 300 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Business Account ID"
                  value={form.businessAccountId}
                  onChange={e => setField('businessAccountId', e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 300 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  type="password"
                  label="Access Token"
                  value={form.accessToken}
                  onChange={e => setField('accessToken', e.target.value)}
                  placeholder="••••••••"
                  helperText={secretHelp}
                  autoComplete="new-password"
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  type="password"
                  label="App Secret"
                  value={form.appSecret}
                  onChange={e => setField('appSecret', e.target.value)}
                  placeholder="••••••••"
                  helperText={secretHelp}
                  autoComplete="new-password"
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
              </Grid>
            </Grid>

            <Box sx={{ borderTop: `1px solid ${BRAND.line}`, pt: 2.5 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <Button
                  variant="outlined"
                  onClick={runConnectionCheck}
                  disabled={checking || credentialsDirty}
                  startIcon={
                    checking ? <CircularProgress size={16} color="inherit" /> : <WhatsAppIcon />
                  }
                  sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
                >
                  {checking ? 'Revisando…' : 'Probar la conexión'}
                </Button>
                <Typography variant="caption" sx={{ color: BRAND.muted }}>
                  {credentialsDirty
                    ? 'Guardá los cambios antes de probar: la prueba usa los datos guardados, no los que estás escribiendo.'
                    : 'Le pregunta a Meta si los datos guardados sirven. No envía ningún mensaje.'}
                </Typography>
              </Stack>

              {checkError && (
                <Alert severity="error" sx={{ mt: 2, borderRadius: 2 }}>
                  {checkError}
                </Alert>
              )}

              {connection?.checks && (
                <Box sx={{ mt: 2 }}>
                  <Typography
                    sx={{
                      fontWeight: 700,
                      mb: 1,
                      color: connection.connected ? BRAND.green : BRAND.red,
                    }}
                  >
                    {connection.connected
                      ? 'Conectado: el asistente puede recibir y contestar mensajes.'
                      : `${plural(failingChecks, 'punto', 'puntos')} para revisar.`}
                  </Typography>
                  <Stack spacing={0.75}>
                    {CONNECTION_ITEMS.map(item => {
                      const check = connection.checks[item.key] || {}

                      return (
                        <Stack
                          key={item.key}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'flex-start' }}
                        >
                          {check.ok ? (
                            <CheckIcon sx={{ color: BRAND.green }} fontSize="small" />
                          ) : (
                            <WarningIcon sx={{ color: BRAND.amber }} fontSize="small" />
                          )}
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {item.label}
                            </Typography>
                            {check.detail && (
                              <Typography variant="caption" color="text.secondary">
                                {check.detail}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      )
                    })}
                  </Stack>
                </Box>
              )}
            </Box>
          </Stack>
        </Section>

        <Section
          id="config-personalidad"
          title="Personalidad"
          subtitle="Cómo se presenta y habla el asistente."
        >
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 4 }}>
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
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Idioma"
                value={form.language}
                onChange={e => setField('language', e.target.value)}
                helperText="Por ejemplo es-AR"
                slotProps={{ htmlInput: { maxLength: 20 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                fullWidth
                label="Firma"
                value={form.signature}
                onChange={e => setField('signature', e.target.value)}
                helperText={NOT_USED_YET}
                slotProps={{ htmlInput: { maxLength: 250 } }}
              />
            </Grid>
          </Grid>
        </Section>

        <Section
          id="config-comportamiento"
          title="Comportamiento"
          subtitle="Qué puede hacer el asistente y cuándo le pasa la conversación a una persona."
        >
          <Grid container spacing={2}>
            {BEHAVIOR_SWITCHES.map(({ key, label, help }) => (
              <Grid size={{ xs: 12, sm: 6 }} key={key}>
                <SwitchRow
                  checked={form[key]}
                  onChange={value => setField(key, value)}
                  label={label}
                  help={help}
                />
              </Grid>
            ))}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Máx. mensajes antes de derivar"
                value={form.maxMessagesBeforeHuman}
                onChange={e => setField('maxMessagesBeforeHuman', e.target.value)}
                error={Boolean(fieldError('maxMessagesBeforeHuman'))}
                helperText={
                  fieldError('maxMessagesBeforeHuman') ||
                  'Cuando la conversación llega a esta cantidad de mensajes, contando los dos lados, deriva. Entre 1 y 80.'
                }
                slotProps={{ htmlInput: { min: 1, max: 80, step: 1 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Confianza mínima para responder"
                value={form.minConfidenceToAnswer}
                onChange={e => setField('minConfidenceToAnswer', e.target.value)}
                error={Boolean(fieldError('minConfidenceToAnswer'))}
                helperText={fieldError('minConfidenceToAnswer') || `Entre 0 y 1. ${NOT_USED_YET}`}
                slotProps={{ htmlInput: { min: 0, max: 1, step: 0.05 } }}
              />
            </Grid>
          </Grid>
        </Section>

        <Section
          id="config-politicas"
          title="Contexto y políticas del comercio"
          subtitle="Lo único que el asistente puede afirmar sobre envíos, pagos, cambios y garantía. Si un campo queda vacío, contesta que hay que consultar con el comercio."
        >
          <Stack spacing={2.5}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Descripción del comercio"
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
            <Grid container spacing={2.5}>
              {POLICY_FIELDS.map(([key, label]) => (
                <Grid size={{ xs: 12, sm: 6 }} key={key}>
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    label={label}
                    value={form[key]}
                    onChange={e => setField(key, e.target.value)}
                    helperText={
                      clean(form[key]) ? '' : 'Vacío: contesta «Consultar con el comercio».'
                    }
                    slotProps={{ htmlInput: { maxLength: 4000 } }}
                  />
                </Grid>
              ))}
            </Grid>
          </Stack>
        </Section>

        <Section
          id="config-guardrails"
          title="Palabras clave"
          subtitle="Separadas por coma. Bloquean un tema, pasan la charla a una persona o dan de baja al cliente de los mensajes."
        >
          <Stack spacing={2.5}>
            {GUARDRAIL_FIELDS.map(({ key, label, placeholder }) => {
              const count = fromList(form[key]).length
              return (
                <TextField
                  key={key}
                  fullWidth
                  label={label}
                  value={form[key]}
                  onChange={e => setField(key, e.target.value)}
                  placeholder={placeholder}
                  error={Boolean(fieldError(key))}
                  helperText={
                    fieldError(key) || (count ? plural(count, 'palabra', 'palabras') : 'Ninguna')
                  }
                />
              )
            })}
          </Stack>
        </Section>

        <Section
          id="config-consumo"
          title="Consumo de IA del mes"
          subtitle="Cuánto llevás usado de cada función, según tu plan."
        >
          <AiBudgetPanel />
        </Section>

        <Section
          id="config-aprendizaje"
          title="Aprendizaje y autolímites"
          subtitle="Autoaprendizaje con revisión humana, y topes propios para gastar menos que tu plan."
        >
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <SwitchRow
                checked={form.learningEnabled}
                onChange={value => setField('learningEnabled', value)}
                label="Autoaprendizaje activado"
                help="Propone respuestas nuevas a partir de las conversaciones."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <SwitchRow
                checked={form.learningRequireApproval}
                onChange={value => setField('learningRequireApproval', value)}
                label="Requiere aprobación humana"
                help={`Hoy todo lo aprendido espera tu aprobación en «Aprendizaje». ${NOT_USED_YET}`}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Alert severity="info" variant="outlined" sx={{ borderRadius: 2 }}>
                Estos dos valores son <strong>autolímites</strong>: sirven para consumir menos que
                tu plan, no para ampliarlo. El tope real es el del plan y lo ves arriba. Dejalos en
                0 para usar el plan completo.
              </Alert>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Autolímite de mensajes por mes"
                value={form.monthlyMessageLimit}
                onChange={e => setField('monthlyMessageLimit', e.target.value)}
                error={Boolean(fieldError('monthlyMessageLimit'))}
                helperText={
                  fieldError('monthlyMessageLimit') || '0 = sin autolímite (usa el tope del plan)'
                }
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                type="number"
                label="Autolímite de tokens por mes"
                value={form.monthlyAiTokenLimit}
                onChange={e => setField('monthlyAiTokenLimit', e.target.value)}
                error={Boolean(fieldError('monthlyAiTokenLimit'))}
                helperText={
                  fieldError('monthlyAiTokenLimit') || '0 = sin autolímite (usa el tope del plan)'
                }
                slotProps={{
                  htmlInput: { min: 0, step: 1 },
                  input: { endAdornment: <InputAdornment position="end">tokens</InputAdornment> },
                }}
              />
            </Grid>
          </Grid>
        </Section>

        {/*
          La barra de guardar queda pegada abajo: el formulario es largo y el
          error de guardado tiene que verse donde está el botón, no arriba de
          todo donde nadie mira.
        */}
        <Paper
          variant="outlined"
          sx={{
            ...PANEL_SX,
            p: 2,
            position: 'sticky',
            bottom: 16,
            zIndex: 2,
            borderColor: dirty ? BRAND.blue : BRAND.line,
            boxShadow: dirty ? '0 8px 24px rgba(11, 107, 255, 0.12)' : 'none',
          }}
        >
          {saveError && (
            <Alert severity="error" sx={{ mb: 1.5, borderRadius: 2 }}>
              {saveError}
            </Alert>
          )}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
          >
            <Typography
              role="status"
              sx={{
                fontWeight: 700,
                color: triedToSave && errorCount ? BRAND.red : dirty ? BRAND.ink : BRAND.muted,
              }}
            >
              {triedToSave && errorCount
                ? `Revisá ${plural(errorCount, 'campo marcado', 'campos marcados')} antes de guardar.`
                : dirty
                  ? 'Tenés cambios sin guardar.'
                  : 'Todo guardado.'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              {dirty && (
                <Button
                  onClick={discardChanges}
                  disabled={saving}
                  sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                >
                  Descartar cambios
                </Button>
              )}
              <Button
                variant="contained"
                size={isMobile ? 'medium' : 'large'}
                startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
                onClick={handleSave}
                disabled={saving || !dirty}
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, px: 3 }}
              >
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Stack>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          severity="success"
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
