// 📁 admin/src/pages/AiInsightsPage.jsx
//
// Motor de diagnóstico (Bloque 8.4-8.9) — HENKO detecta problemas de negocio
// (producto con baja conversión, caída de conversión general, campaña de
// bajo rendimiento, cliente inactivo), explica la causa con datos reales, y
// recomienda qué hacer. Para cliente inactivo hay un primer paso de acción
// (8.8, alcance acotado): HENKO arma un mensaje de reactivación, pero nunca
// lo manda sin que el admin lo revise/edite y confirme en el diálogo. Mismo
// esqueleto que AiLearningReviewPage.jsx.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  Archive as ArchiveIcon,
  MarkEmailRead as ReactivationIcon,
  PlayCircleOutlined as AcknowledgeIcon,
  Refresh as RefreshIcon,
  Cancel as DismissIcon,
  Bolt as ReinforcementIcon,
  Sell as PriceReductionIcon,
} from '@mui/icons-material'
import {
  acknowledgeInsight,
  archiveInsight,
  dismissInsight,
  listInsights,
  previewReactivationMessage,
  sendReactivationMessage,
  previewCartRecoveryReinforcement,
  applyCartRecoveryReinforcement,
  previewPriceReduction,
  applyPriceReduction,
} from '../services/aiInsightService.js'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
  red: '#b42318',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const PAGE_SIZE = 50
const DEFAULT_STATUS = 'pending_review'

export const STATUS_META = {
  pending_review: { label: 'Pendientes', color: '#9a5b00' },
  measuring: { label: 'En curso', color: BRAND.blue },
  resolved: { label: 'Medidos', color: BRAND.green },
  dismissed: { label: 'Descartados', color: BRAND.muted },
  archived: { label: 'Archivados', color: BRAND.muted },
}

const SUMMARY_STATUSES = ['pending_review', 'measuring', 'resolved', 'dismissed', 'archived']

const TYPE_META = {
  product_underperformance: { label: 'Producto' },
  cart_conversion_drop: { label: 'Conversión' },
  campaign_underperformance: { label: 'Campaña' },
  customer_inactivity: { label: 'Cliente inactivo' },
  cart_recovery_underperformance: { label: 'Recuperación de carrito' },
  product_low_margin: { label: 'Margen bajo' },
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos los tipos' },
  ...Object.entries(TYPE_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

const PRIORITY_META = {
  high: { label: 'Prioridad alta', color: BRAND.red, bg: '#fdebea' },
  medium: { label: 'Prioridad media', color: '#9a5b00', bg: '#fff3dd' },
  low: { label: 'Prioridad baja', color: BRAND.muted, bg: '#eef1fb' },
}

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''

export const formatPesos = value =>
  Number(value || 0).toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

const formatPercent = value =>
  `${Number(value || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`

const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

const formatDay = value => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-AR')
}

// Las claves que manda el detector (aiInsightDetectionService), dichas en castellano y con su
// formato. Antes se mostraban tal cual: «conversionRate: 0.83 · costoUnitario: 1200 · lastOrderAt:
// 2026-07-20T00:00:00.000Z». Las tasas ya vienen en porcentaje; los montos, en pesos.
const EVIDENCE_FIELDS = {
  views: { label: 'Visitas', format: formatNumber },
  purchases: { label: 'Compras', format: formatNumber },
  conversionRate: { label: 'Conversión', format: formatPercent },
  currentConversionRate: { label: 'Conversión actual', format: formatPercent },
  previousConversionRate: { label: 'Conversión anterior', format: formatPercent },
  dropPct: { label: 'Caída', format: formatPercent },
  currentOrders: { label: 'Pedidos', format: formatNumber },
  currentSessions: { label: 'Sesiones', format: formatNumber },
  revenue: { label: 'Ventas', format: formatPesos },
  cost: { label: 'Costo', format: formatPesos },
  margin: { label: 'Margen', format: formatPesos },
  marginPct: { label: 'Margen', format: formatPercent },
  units: { label: 'Unidades', format: formatNumber },
  costoUnitario: { label: 'Costo unitario', format: formatPesos },
  currentSent: { label: 'Enviados', format: formatNumber },
  currentConverted: { label: 'Convertidos', format: formatNumber },
  previousSent: { label: 'Enviados antes', format: formatNumber },
  previousConverted: { label: 'Convertidos antes', format: formatNumber },
  sessions: { label: 'Sesiones', format: formatNumber },
  conversions: { label: 'Compras', format: formatNumber },
  orderCount: { label: 'Compras', format: formatNumber },
  lastOrderAt: { label: 'Última compra', format: formatDay },
  daysSinceLastOrder: { label: 'Días sin comprar', format: formatNumber },
}

const HIDDEN_EVIDENCE = new Set(['days', 'windowDays'])

export const describeEvidence = evidence => {
  if (!evidence || typeof evidence !== 'object') return []
  return Object.entries(evidence)
    .filter(([key, value]) => !HIDDEN_EVIDENCE.has(key) && value !== null && value !== undefined)
    .map(([key, value]) => {
      const field = EVIDENCE_FIELDS[key]
      return field
        ? { label: field.label, value: field.format(value) }
        : { label: key, value: String(value) }
    })
}

// Qué se volvió a medir y si es mejor que antes. En «días sin comprar», bajar es lo bueno.
const METRIC_META = {
  conversionRate: { label: 'Conversión', format: formatPercent, higherIsBetter: true },
  recoveryConversionRate: {
    label: 'Tasa de recupero',
    format: formatPercent,
    higherIsBetter: true,
  },
  marginPct: { label: 'Margen', format: formatPercent, higherIsBetter: true },
  daysSinceLastOrder: {
    label: 'Días sin comprar',
    format: value => formatNumber(value),
    higherIsBetter: false,
  },
}

export const describeMeasurement = measurement => {
  if (!measurement || measurement.afterValue === undefined || measurement.afterValue === null) {
    return null
  }
  const meta = METRIC_META[measurement.metricName] || {
    label: measurement.metricName || 'Resultado',
    format: value => String(value),
    higherIsBetter: true,
  }
  const before = Number(measurement.beforeValue)
  const after = Number(measurement.afterValue)
  let verdict = 'igual'
  if (after !== before) verdict = after > before === meta.higherIsBetter ? 'mejor' : 'peor'
  return {
    label: meta.label,
    before: meta.format(measurement.beforeValue),
    after: meta.format(measurement.afterValue),
    verdict,
  }
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

const CHANNEL_LABEL = { email: 'email', whatsapp: 'WhatsApp' }

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

// Cada cifra del resumen es también un filtro rápido.
const SummaryTile = ({ title, value, color, onClick, active }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={active}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 0.25,
      width: '100%',
      height: '100%',
      p: 2,
      textAlign: 'left',
      borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
      bgcolor: active ? BRAND.paper : 'transparent',
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
    <Typography
      component="span"
      sx={{
        fontFamily: DISPLAY_FONT,
        fontWeight: 800,
        fontSize: 28,
        lineHeight: 1.2,
        color,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {value}
    </Typography>
  </ButtonBase>
)

const InsightCard = ({
  insight,
  busy,
  onAcknowledge,
  onDismiss,
  onArchive,
  onReactivate,
  onReinforce,
  onReducePrice,
}) => {
  const typeLabel = TYPE_META[insight.type]?.label || insight.type
  const priority = PRIORITY_META[insight.priority]
  const isPending = insight.status === 'pending_review'
  const isMeasuring = insight.status === 'measuring'
  const canArchive = ['resolved', 'dismissed'].includes(insight.status)
  const actionable = (isPending || isMeasuring) && !insight.action?.actionType
  const canReactivate = insight.type === 'customer_inactivity' && actionable
  const canReinforce = insight.type === 'cart_recovery_underperformance' && actionable
  const canReducePrice = insight.type === 'product_underperformance' && actionable
  const evidence = describeEvidence(insight.evidence)
  const measurement =
    insight.status === 'resolved' ? describeMeasurement(insight.measurement) : null
  const action = insight.action
  const executedAt = action?.executedAt ? ` el ${formatDay(action.executedAt)}` : ''

  return (
    <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2, sm: 2.5 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
            <Pill label={typeLabel} color={BRAND.blue} bg="#e7f0ff" />
            {priority && <Pill label={priority.label} color={priority.color} bg={priority.bg} />}
            {insight.entity?.label && <Pill label={insight.entity.label} outlined />}
          </Stack>

          <Typography
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: 17,
              overflowWrap: 'anywhere',
            }}
          >
            {insight.title}
          </Typography>

          <Typography
            variant="body2"
            sx={{ mt: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: BRAND.ink }}
          >
            {insight.description}
          </Typography>

          {evidence.length > 0 && (
            <Box
              component="dl"
              sx={{
                mt: 1.5,
                mb: 0,
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, minmax(0, 1fr))' },
                gap: 1,
              }}
            >
              {evidence.map(item => (
                <Box key={item.label} sx={{ p: 1, borderRadius: 2, bgcolor: BRAND.paper, m: 0 }}>
                  <Typography
                    component="dt"
                    variant="caption"
                    sx={{ color: BRAND.muted, fontWeight: 700 }}
                  >
                    {item.label}
                  </Typography>
                  <Typography
                    component="dd"
                    sx={{ m: 0, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {item.value}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {isMeasuring && insight.measurement?.measureAfterDate && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: BRAND.muted }}>
              Se vuelve a medir el {formatDay(insight.measurement.measureAfterDate)}
            </Typography>
          )}

          {measurement && (
            <Typography
              variant="body2"
              sx={{
                mt: 1.5,
                fontWeight: 700,
                color:
                  measurement.verdict === 'mejor'
                    ? BRAND.green
                    : measurement.verdict === 'peor'
                      ? BRAND.red
                      : BRAND.muted,
              }}
            >
              {`${measurement.label}: antes ${measurement.before} → ahora ${measurement.after}`}
              {measurement.verdict === 'mejor' && ' · mejoró'}
              {measurement.verdict === 'peor' && ' · empeoró'}
              {measurement.verdict === 'igual' && ' · sin cambios'}
            </Typography>
          )}

          {action?.actionType === 'reactivation_message' && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: BRAND.muted }}>
              Mensaje de reactivación enviado por {CHANNEL_LABEL[action.channel] || action.channel}
              {executedAt}.
            </Typography>
          )}

          {action?.actionType === 'cart_recovery_reinforcement' && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: BRAND.muted }}>
              {`Recuperación reforzada${executedAt} (${plural(action.detail?.rulesUpdated?.length || 0, 'regla ajustada', 'reglas ajustadas')}).`}
            </Typography>
          )}

          {action?.actionType === 'price_reduction' && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: BRAND.muted }}>
              {`Precio reducido de ${formatPesos(action.detail?.previousPrice)} a ${formatPesos(action.detail?.newPrice)}`}
              {action.detail?.variantsUpdated > 0 &&
                ` (${plural(action.detail.variantsUpdated, 'variante ajustada', 'variantes ajustadas')})`}
              {executedAt}.
            </Typography>
          )}

          {insight.status === 'dismissed' && insight.dismissReason && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block', color: BRAND.muted }}>
              Descartado: {insight.dismissReason}
            </Typography>
          )}
        </Box>

        {(isPending || canReactivate || canReinforce || canReducePrice || canArchive) && (
          <Stack
            direction={{ xs: 'row', md: 'column' }}
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', minWidth: { md: 170 }, alignSelf: { md: 'flex-start' } }}
          >
            {canReactivate && (
              <Button
                size="small"
                variant="contained"
                startIcon={<ReactivationIcon />}
                disabled={busy}
                onClick={() => onReactivate(insight)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Reactivar cliente
              </Button>
            )}
            {canReinforce && (
              <Button
                size="small"
                variant="contained"
                startIcon={<ReinforcementIcon />}
                disabled={busy}
                onClick={() => onReinforce(insight)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Reforzar recuperación
              </Button>
            )}
            {canReducePrice && (
              <Button
                size="small"
                variant="contained"
                startIcon={<PriceReductionIcon />}
                disabled={busy}
                onClick={() => onReducePrice(insight)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Reducir precio
              </Button>
            )}
            {isPending && (
              <>
                <Button
                  size="small"
                  variant={
                    canReactivate || canReinforce || canReducePrice ? 'outlined' : 'contained'
                  }
                  startIcon={<AcknowledgeIcon />}
                  disabled={busy}
                  onClick={() => onAcknowledge(insight)}
                  title="Lo vas a resolver vos: se vuelve a medir más adelante"
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Marcar en curso
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  startIcon={<DismissIcon />}
                  disabled={busy}
                  onClick={() => onDismiss(insight)}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Descartar
                </Button>
              </>
            )}
            {canArchive && (
              <Button
                size="small"
                variant="text"
                startIcon={<ArchiveIcon />}
                disabled={busy}
                onClick={() => onArchive(insight)}
                sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted }}
              >
                Archivar
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

const AiInsightsPage = () => {
  const isMobile = useMediaQuery('(max-width:600px)')

  const [items, setItems] = useState([])
  const [counters, setCounters] = useState({})
  const [pagination, setPagination] = useState({})
  const [status, setStatus] = useState(DEFAULT_STATUS)
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })
  const [dismissDialog, setDismissDialog] = useState(null)
  const [reactivationDialog, setReactivationDialog] = useState(null)
  const [reinforcementDialog, setReinforcementDialog] = useState(null)
  const [priceReductionDialog, setPriceReductionDialog] = useState(null)

  // Una respuesta lenta de una consulta anterior no tiene que pisar a la más reciente.
  const requestRef = useRef(0)

  const params = useMemo(
    () => ({
      status,
      type: type === 'all' ? undefined : type,
      page,
      limit: PAGE_SIZE,
    }),
    [status, type, page],
  )

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const data = await listInsights(params)
      if (request !== requestRef.current) return

      const list = Array.isArray(data?.items) ? data.items : []
      const resultPagination = data?.pagination || {}

      // Se resolvió lo último de la página y esa página quedó vacía: volver a la última.
      if (list.length === 0 && params.page > 1 && resultPagination.total > 0) {
        setPage(Math.max(1, resultPagination.pages || 1))
        return
      }

      setItems(list)
      setCounters(data?.counters || {})
      setPagination(resultPagination)
      setLoaded(true)
    } catch (err) {
      if (request !== requestRef.current) return
      console.error('[AI_INSIGHTS_LIST_ERROR]', err)
      setItems([])
      setError(
        err?.response?.data?.message || err?.message || 'No se pudieron cargar los diagnósticos.',
      )
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [params])

  useEffect(() => {
    load()
  }, [load])

  const notify = (severity, message) => setSnackbar({ open: true, severity, message })

  const changeStatus = value => {
    setStatus(value)
    setPage(1)
  }

  const changeType = value => {
    setType(value)
    setPage(1)
  }

  const runAction = useCallback(
    async (id, action, successMessage) => {
      setBusyId(id)
      setError('')
      try {
        await action()
        notify('success', successMessage)
        await load()
        return true
      } catch (err) {
        console.error('[AI_INSIGHTS_ACTION_ERROR]', err)
        setError(err?.response?.data?.message || err?.message || 'No se pudo completar la acción.')
        return false
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const handleAcknowledge = useCallback(
    insight => {
      const id = getId(insight)
      runAction(id, () => acknowledgeInsight(id), 'Diagnóstico marcado en curso.')
    },
    [runAction],
  )

  const openDismiss = useCallback(insight => {
    setDismissDialog({ id: getId(insight), reason: '', submitting: false, error: '' })
  }, [])

  // El diálogo se cierra recién cuando el servidor contestó: antes se cerraba primero y, si
  // fallaba, el motivo escrito se perdía y el error aparecía arriba, lejos.
  const confirmDismiss = useCallback(async () => {
    const dialog = dismissDialog
    if (!dialog || dialog.submitting) return
    setDismissDialog(prev => ({ ...prev, submitting: true, error: '' }))
    setBusyId(dialog.id)
    try {
      await dismissInsight(dialog.id, clean(dialog.reason))
      setDismissDialog(null)
      notify('success', 'Diagnóstico descartado.')
      await load()
    } catch (err) {
      console.error('[AI_INSIGHTS_ACTION_ERROR]', err)
      setDismissDialog(prev =>
        prev
          ? {
              ...prev,
              submitting: false,
              error: err?.response?.data?.message || err?.message || 'No se pudo descartar.',
            }
          : prev,
      )
    } finally {
      setBusyId(null)
    }
  }, [dismissDialog, load])

  const handleArchive = useCallback(
    insight => {
      const id = getId(insight)
      runAction(id, () => archiveInsight(id), 'Diagnóstico archivado.')
    },
    [runAction],
  )

  const openReactivation = useCallback(async insight => {
    const id = getId(insight)
    setReactivationDialog({
      id,
      message: '',
      loading: true,
      error: '',
      sending: false,
    })
    try {
      const result = await previewReactivationMessage(id)
      setReactivationDialog(prev =>
        prev && prev.id === id ? { ...prev, message: result?.message || '', loading: false } : prev,
      )
    } catch (err) {
      console.error('[AI_INSIGHTS_PREVIEW_ERROR]', err)
      setReactivationDialog(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              loading: false,
              error:
                err?.response?.data?.message || err?.message || 'No se pudo generar el mensaje.',
            }
          : prev,
      )
    }
  }, [])

  const confirmReactivation = useCallback(async () => {
    const dialog = reactivationDialog
    if (!dialog || dialog.sending || !clean(dialog.message)) return

    setReactivationDialog(prev => (prev ? { ...prev, sending: true, error: '' } : prev))

    try {
      await sendReactivationMessage(dialog.id, clean(dialog.message))
      setReactivationDialog(null)
      notify('success', 'Mensaje de reactivación enviado.')
      await load()
    } catch (err) {
      console.error('[AI_INSIGHTS_SEND_ERROR]', err)
      setReactivationDialog(prev =>
        prev
          ? {
              ...prev,
              sending: false,
              error:
                err?.response?.data?.message || err?.message || 'No se pudo enviar el mensaje.',
            }
          : prev,
      )
    }
  }, [reactivationDialog, load])

  const openReinforcement = useCallback(async insight => {
    const id = getId(insight)
    setReinforcementDialog({
      id,
      plans: [],
      hasChanges: false,
      loading: true,
      error: '',
      applying: false,
    })
    try {
      const result = await previewCartRecoveryReinforcement(id)
      setReinforcementDialog(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              plans: result?.plans || [],
              hasChanges: Boolean(result?.hasChanges),
              loading: false,
            }
          : prev,
      )
    } catch (err) {
      console.error('[AI_INSIGHTS_REINFORCEMENT_PREVIEW_ERROR]', err)
      setReinforcementDialog(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              loading: false,
              error:
                err?.response?.data?.message ||
                err?.message ||
                'No se pudo armar el plan de refuerzo.',
            }
          : prev,
      )
    }
  }, [])

  const confirmReinforcement = useCallback(async () => {
    const dialog = reinforcementDialog
    if (!dialog || dialog.applying || !dialog.hasChanges) return

    setReinforcementDialog(prev => (prev ? { ...prev, applying: true, error: '' } : prev))

    try {
      await applyCartRecoveryReinforcement(dialog.id)
      setReinforcementDialog(null)
      notify('success', 'Recuperación de carritos reforzada.')
      await load()
    } catch (err) {
      console.error('[AI_INSIGHTS_REINFORCEMENT_APPLY_ERROR]', err)
      setReinforcementDialog(prev =>
        prev
          ? {
              ...prev,
              applying: false,
              error:
                err?.response?.data?.message || err?.message || 'No se pudo aplicar el refuerzo.',
            }
          : prev,
      )
    }
  }, [reinforcementDialog, load])

  const openPriceReduction = useCallback(async insight => {
    const id = getId(insight)
    setPriceReductionDialog({
      id,
      newPrice: '',
      plan: null,
      loading: true,
      error: '',
      applying: false,
    })
    try {
      const result = await previewPriceReduction(id)
      setPriceReductionDialog(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              plan: result || null,
              newPrice: result?.suggestedPrice ?? '',
              loading: false,
            }
          : prev,
      )
    } catch (err) {
      console.error('[AI_INSIGHTS_PRICE_PREVIEW_ERROR]', err)
      setPriceReductionDialog(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              loading: false,
              error:
                err?.response?.data?.message ||
                err?.message ||
                'No se pudo armar la propuesta de precio.',
            }
          : prev,
      )
    }
  }, [])

  const confirmPriceReduction = useCallback(async () => {
    const dialog = priceReductionDialog
    const newPriceNumber = Number(dialog?.newPrice)
    if (!dialog || dialog.applying || !Number.isFinite(newPriceNumber) || newPriceNumber <= 0)
      return

    setPriceReductionDialog(prev => (prev ? { ...prev, applying: true, error: '' } : prev))

    try {
      await applyPriceReduction(dialog.id, newPriceNumber)
      setPriceReductionDialog(null)
      notify('success', 'Precio actualizado.')
      await load()
    } catch (err) {
      console.error('[AI_INSIGHTS_PRICE_APPLY_ERROR]', err)
      setPriceReductionDialog(prev =>
        prev
          ? {
              ...prev,
              applying: false,
              error:
                err?.response?.data?.message ||
                err?.message ||
                'No se pudo aplicar el nuevo precio.',
            }
          : prev,
      )
    }
  }, [priceReductionDialog, load])

  const pendingCount = counters.pending_review || 0
  const totalCount = SUMMARY_STATUSES.reduce((sum, key) => sum + (Number(counters[key]) || 0), 0)

  // Por qué no se puede aplicar el precio, dicho al lado del campo en vez de solo apagar el botón.
  const priceProblem = (() => {
    const dialog = priceReductionDialog
    if (!dialog?.plan) return ''
    const value = Number(dialog.newPrice)
    if (dialog.newPrice === '' || !(value > 0)) return 'Ingresá un precio mayor a cero.'
    if (value >= Number(dialog.plan.currentPrice)) {
      return `Tiene que ser menor al precio actual (${formatPesos(dialog.plan.currentPrice)}).`
    }
    // El servidor rechaza cualquier precio por debajo del costo cargado (applyPriceReduction):
    // dejar confirmarlo era apretar un botón que siempre falla.
    const costFloor = dialog.plan.costFloor
    if (costFloor !== null && costFloor !== undefined && value < Number(costFloor)) {
      return `No puede quedar por debajo del costo cargado (${formatPesos(costFloor)}).`
    }
    return ''
  })()
  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1180, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          TU TIENDA
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
              Diagnóstico
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Problemas que HENKO detectó con datos reales de tu tienda, con una recomendación de
              qué hacer.
              {pendingCount > 0 &&
                ` ${pendingCount === 1 ? '1 pendiente' : `${pendingCount} pendientes`} de revisión.`}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={load}
            disabled={loading}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
          >
            Actualizar
          </Button>
        </Stack>
      </Box>

      <Paper
        component="section"
        aria-label="Resumen del diagnóstico"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              lg: 'repeat(6, 1fr)',
            },
          }}
        >
          {SUMMARY_STATUSES.map(key => (
            <SummaryTile
              key={key}
              title={STATUS_META[key].label}
              value={loaded ? formatNumber(counters[key]) : '–'}
              color={STATUS_META[key].color}
              onClick={() => changeStatus(key)}
              active={status === key}
            />
          ))}
          <SummaryTile
            title="Todos"
            value={loaded ? formatNumber(totalCount) : '–'}
            color={BRAND.blue}
            onClick={() => changeStatus('all')}
            active={status === 'all'}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
        <TextField
          select
          size="small"
          label="Tipo"
          value={type}
          onChange={e => changeType(e.target.value)}
          sx={{ minWidth: 240 }}
        >
          {TYPE_OPTIONS.map(option => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      </Paper>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          onClose={() => setError('')}
          action={
            <Button color="inherit" size="small" onClick={load}>
              Reintentar
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {loading && loaded && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {loading && !loaded ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        !error && (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: 6, textAlign: 'center' }}>
            <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 18, mb: 0.5 }}>
              No hay diagnósticos para este filtro.
            </Typography>
            <Typography sx={{ color: BRAND.muted }}>
              HENKO revisa tu tienda cada pocas horas y avisa acá cuando encuentra algo.
            </Typography>
          </Paper>
        )
      ) : (
        <Stack spacing={2} sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          {items.map(insight => (
            <InsightCard
              key={getId(insight)}
              insight={insight}
              busy={busyId === getId(insight)}
              onAcknowledge={handleAcknowledge}
              onDismiss={openDismiss}
              onArchive={handleArchive}
              onReactivate={openReactivation}
              onReinforce={openReinforcement}
              onReducePrice={openPriceReduction}
            />
          ))}
          {pagination.pages > 1 && (
            <Stack spacing={1.5} sx={{ alignItems: 'center', pt: 1 }}>
              <Pagination
                count={pagination.pages}
                page={page}
                onChange={(_, value) => setPage(value)}
                color="primary"
                getItemAriaLabel={(itemType, itemPage, selected) => {
                  if (itemType === 'page') {
                    return selected ? `Página ${itemPage}, actual` : `Ir a la página ${itemPage}`
                  }
                  const labels = {
                    first: 'Primera página',
                    last: 'Última página',
                    next: 'Página siguiente',
                    previous: 'Página anterior',
                  }
                  return labels[itemType] || itemType
                }}
              />
              <Typography variant="caption" sx={{ color: BRAND.muted }}>
                {`Mostrando ${items.length} de ${formatNumber(pagination.total)} (página ${pagination.page} de ${pagination.pages})`}
              </Typography>
            </Stack>
          )}
        </Stack>
      )}

      <Dialog
        open={Boolean(dismissDialog)}
        onClose={() => !dismissDialog?.submitting && setDismissDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Descartar diagnóstico
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {dismissDialog?.error && <Alert severity="error">{dismissDialog.error}</Alert>}
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Motivo (opcional)"
              value={dismissDialog?.reason || ''}
              onChange={e =>
                setDismissDialog(prev => ({ ...prev, reason: e.target.value, error: '' }))
              }
              slotProps={{ htmlInput: { maxLength: 500 } }}
              disabled={dismissDialog?.submitting}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDismissDialog(null)}
            disabled={dismissDialog?.submitting}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDismiss}
            disabled={dismissDialog?.submitting}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {dismissDialog?.submitting ? 'Descartando…' : 'Descartar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reactivationDialog)}
        onClose={() => !reactivationDialog?.sending && setReactivationDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Mensaje de reactivación
        </DialogTitle>
        <DialogContent>
          {reactivationDialog?.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ color: BRAND.muted }}>
                Revisá y editá el mensaje antes de enviarlo — nada sale sin confirmar acá. Le llega
                al cliente de verdad.
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={4}
                label="Mensaje"
                value={reactivationDialog?.message || ''}
                onChange={e =>
                  setReactivationDialog(prev =>
                    prev ? { ...prev, message: e.target.value, error: '' } : prev,
                  )
                }
                helperText={`${(reactivationDialog?.message || '').length}/2000`}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
                disabled={reactivationDialog?.sending}
              />
              {reactivationDialog?.error && (
                <Alert severity="error">{reactivationDialog.error}</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setReactivationDialog(null)}
            disabled={reactivationDialog?.sending}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={confirmReactivation}
            disabled={
              reactivationDialog?.loading ||
              reactivationDialog?.sending ||
              !clean(reactivationDialog?.message)
            }
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {reactivationDialog?.sending ? 'Enviando…' : 'Enviar mensaje'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reinforcementDialog)}
        onClose={() => !reinforcementDialog?.applying && setReinforcementDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Reforzar recuperación de carritos
        </DialogTitle>
        <DialogContent>
          {reinforcementDialog?.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ color: BRAND.muted }}>
                Esto ajusta las reglas de recuperación de carrito que ya tenés activas — nada se
                aplica hasta que confirmes.
              </Typography>

              {reinforcementDialog?.plans?.length > 0 && (
                <TableContainer sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Canal</TableCell>
                        <TableCell>Intentos máx.</TableCell>
                        <TableCell>Piso de carrito</TableCell>
                        <TableCell>Personalización IA</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reinforcementDialog.plans.map(plan => {
                        const floor = cents => formatPesos(Number(cents || 0) / 100)
                        return (
                          <TableRow key={plan.ruleId}>
                            <TableCell>{CHANNEL_LABEL[plan.channel] || plan.channel}</TableCell>
                            <TableCell>
                              {plan.changed && plan.before.maxAttempts !== plan.after.maxAttempts
                                ? `${plan.before.maxAttempts} → ${plan.after.maxAttempts}`
                                : plan.before.maxAttempts}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {plan.changed &&
                              plan.before.minCartAmountCents !== plan.after.minCartAmountCents
                                ? `${floor(plan.before.minCartAmountCents)} → ${floor(plan.after.minCartAmountCents)}`
                                : floor(plan.before.minCartAmountCents)}
                            </TableCell>
                            <TableCell>
                              {plan.changed &&
                              plan.before.useAiPersonalization !== plan.after.useAiPersonalization
                                ? 'Desactivada → Activada'
                                : plan.before.useAiPersonalization
                                  ? 'Activada'
                                  : 'Desactivada'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {!reinforcementDialog?.error && !reinforcementDialog?.hasChanges && (
                <Alert severity="info">
                  La configuración de recuperación ya está al máximo — no hay nada para reforzar.
                </Alert>
              )}

              {reinforcementDialog?.error && (
                <Alert severity="error">{reinforcementDialog.error}</Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setReinforcementDialog(null)}
            disabled={reinforcementDialog?.applying}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={confirmReinforcement}
            disabled={
              reinforcementDialog?.loading ||
              reinforcementDialog?.applying ||
              !reinforcementDialog?.hasChanges
            }
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {reinforcementDialog?.applying ? 'Aplicando…' : 'Aplicar refuerzo'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(priceReductionDialog)}
        onClose={() => !priceReductionDialog?.applying && setPriceReductionDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>Reducir precio</DialogTitle>
        <DialogContent>
          {priceReductionDialog?.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : priceReductionDialog?.plan ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ color: BRAND.muted }}>
                {`Precio actual: ${formatPesos(priceReductionDialog.plan.currentPrice)} · sugerencia: −${priceReductionDialog.plan.reductionPct}%. `}
                Podés editar el precio final antes de confirmar — nada se aplica hasta que lo hagas,
                y se ve en la tienda apenas lo confirmás.
              </Typography>

              {priceReductionDialog.plan.cappedByCost && (
                <Alert severity="warning">
                  {`La sugerencia se limitó para no vender por debajo del costo cargado (${formatPesos(priceReductionDialog.plan.costFloor)}).`}
                </Alert>
              )}

              {priceReductionDialog.plan.hasVariants && (
                <Alert severity="info">
                  {`Este producto tiene ${plural(priceReductionDialog.plan.variantCount, 'variante', 'variantes')}: el nuevo precio se aplica proporcionalmente a todas las que estén activas.`}
                </Alert>
              )}

              <TextField
                fullWidth
                type="number"
                label="Precio nuevo"
                value={priceReductionDialog.newPrice}
                onChange={e =>
                  setPriceReductionDialog(prev =>
                    prev ? { ...prev, newPrice: e.target.value, error: '' } : prev,
                  )
                }
                error={Boolean(priceProblem)}
                helperText={priceProblem || ' '}
                slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                disabled={priceReductionDialog.applying}
              />

              {priceReductionDialog?.error && (
                <Alert severity="error">{priceReductionDialog.error}</Alert>
              )}
            </Stack>
          ) : (
            priceReductionDialog?.error && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {priceReductionDialog.error}
              </Alert>
            )
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setPriceReductionDialog(null)}
            disabled={priceReductionDialog?.applying}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={confirmPriceReduction}
            disabled={
              priceReductionDialog?.loading ||
              priceReductionDialog?.applying ||
              !priceReductionDialog?.plan ||
              Boolean(priceProblem)
            }
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {priceReductionDialog?.applying ? 'Aplicando…' : 'Aplicar precio'}
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
          variant="filled"
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default AiInsightsPage
