// 📁 admin/src/pages/AiInsightsPage.jsx
//
// Motor de diagnóstico (Bloque 8.4-8.9) — HENKO detecta problemas de negocio
// (producto con baja conversión, caída de conversión general, campaña de
// bajo rendimiento, cliente inactivo), explica la causa con datos reales, y
// recomienda qué hacer. Para cliente inactivo hay un primer paso de acción
// (8.8, alcance acotado): HENKO arma un mensaje de reactivación, pero nunca
// lo manda sin que el admin lo revise/edite y confirme en el diálogo. Mismo
// esqueleto que AiLearningReviewPage.jsx.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Archive as ArchiveIcon,
  Insights as InsightsIcon,
  MarkEmailRead as ReactivationIcon,
  PlayCircleOutline as AcknowledgeIcon,
  Refresh as RefreshIcon,
  Cancel as DismissIcon,
  Bolt as ReinforcementIcon,
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
} from '../services/aiInsightService.js'

const STATUS_OPTIONS = [
  { value: 'pending_review', label: 'Pendientes' },
  { value: 'measuring', label: 'En curso' },
  { value: 'resolved', label: 'Medidos' },
  { value: 'dismissed', label: 'Descartados' },
  { value: 'archived', label: 'Archivados' },
  { value: 'all', label: 'Todos' },
]

const TYPE_META = {
  product_underperformance: { label: 'Producto', color: 'warning' },
  cart_conversion_drop: { label: 'Conversión', color: 'error' },
  campaign_underperformance: { label: 'Campaña', color: 'info' },
  customer_inactivity: { label: 'Cliente inactivo', color: 'secondary' },
  cart_recovery_underperformance: {
    label: 'Recuperación de carrito',
    color: 'error',
  },
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos los tipos' },
  ...Object.entries(TYPE_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

const PRIORITY_COLOR = { high: 'error', medium: 'warning', low: 'default' }

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''

const formatEvidence = evidence => {
  if (!evidence || typeof evidence !== 'object') return ''
  return Object.entries(evidence)
    .filter(([key]) => key !== 'days' && key !== 'windowDays')
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ')
}

const CHANNEL_LABEL = { email: 'email', whatsapp: 'WhatsApp' }

const InsightCard = ({
  insight,
  busy,
  onAcknowledge,
  onDismiss,
  onArchive,
  onReactivate,
  onReinforce,
}) => {
  const typeMeta = TYPE_META[insight.type] || {
    label: insight.type,
    color: 'default',
  }
  const isPending = insight.status === 'pending_review'
  const isMeasuring = insight.status === 'measuring'
  const canArchive = ['resolved', 'dismissed'].includes(insight.status)
  const canReactivate =
    insight.type === 'customer_inactivity' &&
    (isPending || isMeasuring) &&
    !insight.action?.actionType
  const canReinforce =
    insight.type === 'cart_recovery_underperformance' &&
    (isPending || isMeasuring) &&
    !insight.action?.actionType

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
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            mb={1}
          >
            <Chip size="small" label={typeMeta.label} color={typeMeta.color} />
            {insight.priority && (
              <Chip
                size="small"
                variant="outlined"
                label={`Prioridad: ${insight.priority}`}
                color={PRIORITY_COLOR[insight.priority] || 'default'}
              />
            )}
            {insight.entity?.label && (
              <Chip
                size="small"
                variant="outlined"
                label={insight.entity.label}
              />
            )}
          </Stack>

          <Typography variant="subtitle1" fontWeight={700}>
            {insight.title}
          </Typography>

          <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
            {insight.description}
          </Typography>

          {formatEvidence(insight.evidence) && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: 'block' }}
            >
              {formatEvidence(insight.evidence)}
            </Typography>
          )}

          {isMeasuring && insight.measurement?.measureAfterDate && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 0.5, display: 'block' }}
            >
              Se vuelve a medir el{' '}
              {new Date(
                insight.measurement.measureAfterDate,
              ).toLocaleDateString('es-AR')}
            </Typography>
          )}

          {insight.status === 'resolved' && insight.measurement && (
            <Typography
              variant="body2"
              color="success.main"
              sx={{ mt: 1, fontWeight: 600 }}
            >
              Antes: {insight.measurement.beforeValue} → Ahora:{' '}
              {insight.measurement.afterValue}
            </Typography>
          )}

          {insight.action?.actionType === 'reactivation_message' && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: 'block' }}
            >
              Mensaje de reactivación enviado por{' '}
              {CHANNEL_LABEL[insight.action.channel] || insight.action.channel}
              {insight.action.executedAt &&
                ` el ${new Date(insight.action.executedAt).toLocaleDateString('es-AR')}`}
              .
            </Typography>
          )}

          {insight.action?.actionType === 'cart_recovery_reinforcement' && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: 'block' }}
            >
              Recuperación reforzada
              {insight.action.executedAt &&
                ` el ${new Date(insight.action.executedAt).toLocaleDateString('es-AR')}`}{' '}
              ({insight.action.detail?.rulesUpdated?.length || 0} regla(s)
              ajustada(s)).
            </Typography>
          )}

          {insight.status === 'dismissed' && insight.dismissReason && (
            <Typography
              variant="caption"
              color="error"
              sx={{ mt: 1, display: 'block' }}
            >
              Descartado: {insight.dismissReason}
            </Typography>
          )}
        </Box>

        {(isPending || canReactivate || canReinforce || canArchive) && (
          <Stack spacing={1} sx={{ minWidth: 132 }}>
            {canReactivate && (
              <Button
                size="small"
                variant="contained"
                color="secondary"
                startIcon={<ReactivationIcon />}
                disabled={busy}
                onClick={() => onReactivate(insight)}
              >
                Reactivar cliente
              </Button>
            )}
            {canReinforce && (
              <Button
                size="small"
                variant="contained"
                color="secondary"
                startIcon={<ReinforcementIcon />}
                disabled={busy}
                onClick={() => onReinforce(insight)}
              >
                Reforzar recuperación
              </Button>
            )}
            {isPending && (
              <>
                <Button
                  size="small"
                  variant={
                    canReactivate || canReinforce ? 'outlined' : 'contained'
                  }
                  color="primary"
                  startIcon={<AcknowledgeIcon />}
                  disabled={busy}
                  onClick={() => onAcknowledge(insight)}
                >
                  Marcar en curso
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<DismissIcon />}
                  disabled={busy}
                  onClick={() => onDismiss(insight)}
                >
                  Descartar
                </Button>
              </>
            )}
            {canArchive && (
              <Tooltip title="Archivar">
                <span>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<ArchiveIcon />}
                    disabled={busy}
                    onClick={() => onArchive(insight)}
                    fullWidth
                  >
                    Archivar
                  </Button>
                </span>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

const AiInsightsPage = () => {
  const [items, setItems] = useState([])
  const [counters, setCounters] = useState({})
  const [status, setStatus] = useState('pending_review')
  const [type, setType] = useState('all')
  const [loading, setLoading] = useState(false)
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

  const params = useMemo(
    () => ({
      status,
      type: type === 'all' ? undefined : type,
      page: 1,
      limit: 50,
    }),
    [status, type],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listInsights(params)
      setItems(Array.isArray(data?.items) ? data.items : [])
      setCounters(data?.counters || {})
    } catch (err) {
      console.error('[AI_INSIGHTS_LIST_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudieron cargar los insights.',
      )
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => {
    load()
  }, [load])

  const notify = (severity, message) =>
    setSnackbar({ open: true, severity, message })

  const runAction = useCallback(
    async (id, action, successMessage) => {
      setBusyId(id)
      setError('')
      try {
        await action()
        notify('success', successMessage)
        await load()
      } catch (err) {
        console.error('[AI_INSIGHTS_ACTION_ERROR]', err)
        setError(
          err?.response?.data?.message ||
            err?.message ||
            'No se pudo completar la acción.',
        )
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const handleAcknowledge = useCallback(
    insight => {
      const id = getId(insight)
      runAction(id, () => acknowledgeInsight(id), 'Insight marcado en curso.')
    },
    [runAction],
  )

  const openDismiss = useCallback(insight => {
    setDismissDialog({ id: getId(insight), reason: '' })
  }, [])

  const confirmDismiss = useCallback(async () => {
    const dialog = dismissDialog
    if (!dialog) return
    setDismissDialog(null)
    await runAction(
      dialog.id,
      () => dismissInsight(dialog.id, clean(dialog.reason)),
      'Insight descartado.',
    )
  }, [dismissDialog, runAction])

  const handleArchive = useCallback(
    insight => {
      const id = getId(insight)
      runAction(id, () => archiveInsight(id), 'Insight archivado.')
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
        prev && prev.id === id
          ? { ...prev, message: result?.message || '', loading: false }
          : prev,
      )
    } catch (err) {
      console.error('[AI_INSIGHTS_PREVIEW_ERROR]', err)
      setReactivationDialog(prev =>
        prev && prev.id === id
          ? {
              ...prev,
              loading: false,
              error:
                err?.response?.data?.message ||
                err?.message ||
                'No se pudo generar el mensaje.',
            }
          : prev,
      )
    }
  }, [])

  const confirmReactivation = useCallback(async () => {
    const dialog = reactivationDialog
    if (!dialog || !clean(dialog.message)) return

    setReactivationDialog(prev =>
      prev ? { ...prev, sending: true, error: '' } : prev,
    )

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
                err?.response?.data?.message ||
                err?.message ||
                'No se pudo enviar el mensaje.',
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
    if (!dialog || !dialog.hasChanges) return

    setReinforcementDialog(prev =>
      prev ? { ...prev, applying: true, error: '' } : prev,
    )

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
                err?.response?.data?.message ||
                err?.message ||
                'No se pudo aplicar el refuerzo.',
            }
          : prev,
      )
    }
  }, [reinforcementDialog, load])

  const pendingCount = counters.pending_review || 0

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
          <Stack direction="row" spacing={1.5} alignItems="center">
            <InsightsIcon color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Diagnóstico
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Problemas que HENKO detectó con datos reales de tu tienda, con una
            recomendación de qué hacer.
            {pendingCount > 0 && ` ${pendingCount} pendiente(s) de revisión.`}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={load}
          disabled={loading}
          sx={{ borderRadius: 2, textTransform: 'none' }}
        >
          Actualizar
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="Estado"
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                  {counters[option.value] !== undefined &&
                    ` (${counters[option.value]})`}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              size="small"
              label="Tipo"
              value={type}
              onChange={e => setType(e.target.value)}
            >
              {TYPE_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{ p: 6, borderRadius: 3, textAlign: 'center' }}
        >
          <Typography color="text.secondary">
            No hay insights para este filtro.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
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
            />
          ))}
        </Stack>
      )}

      <Dialog
        open={Boolean(dismissDialog)}
        onClose={() => setDismissDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Descartar insight</DialogTitle>
        <DialogContent>
          <Divider sx={{ mb: 2 }} />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Motivo (opcional)"
            value={dismissDialog?.reason || ''}
            onChange={e =>
              setDismissDialog(prev => ({ ...prev, reason: e.target.value }))
            }
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDismissDialog(null)}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={confirmDismiss}>
            Descartar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reactivationDialog)}
        onClose={() => setReactivationDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Mensaje de reactivación</DialogTitle>
        <DialogContent>
          <Divider sx={{ mb: 2 }} />
          {reactivationDialog?.loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Revisá y editá el mensaje antes de enviarlo — nada sale sin
                confirmar acá.
              </Typography>
              <TextField
                fullWidth
                multiline
                minRows={4}
                label="Mensaje"
                value={reactivationDialog?.message || ''}
                onChange={e =>
                  setReactivationDialog(prev =>
                    prev ? { ...prev, message: e.target.value } : prev,
                  )
                }
                inputProps={{ maxLength: 2000 }}
                disabled={reactivationDialog?.sending}
              />
              {reactivationDialog?.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {reactivationDialog.error}
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setReactivationDialog(null)}
            disabled={reactivationDialog?.sending}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={confirmReactivation}
            disabled={
              reactivationDialog?.loading ||
              reactivationDialog?.sending ||
              !clean(reactivationDialog?.message)
            }
          >
            {reactivationDialog?.sending ? 'Enviando…' : 'Enviar mensaje'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(reinforcementDialog)}
        onClose={() => setReinforcementDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Reforzar recuperación de carritos</DialogTitle>
        <DialogContent>
          <Divider sx={{ mb: 2 }} />
          {reinforcementDialog?.loading ? (
            <Box display="flex" justifyContent="center" py={4}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Esto ajusta las reglas de recuperación de carrito que ya tenés
                activas — nada se aplica hasta que confirmes.
              </Typography>

              {reinforcementDialog?.plans?.length > 0 && (
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
                    {reinforcementDialog.plans.map(plan => (
                      <TableRow key={plan.ruleId}>
                        <TableCell>
                          {CHANNEL_LABEL[plan.channel] || plan.channel}
                        </TableCell>
                        <TableCell>
                          {plan.changed &&
                          plan.before.maxAttempts !== plan.after.maxAttempts
                            ? `${plan.before.maxAttempts} → ${plan.after.maxAttempts}`
                            : plan.before.maxAttempts}
                        </TableCell>
                        <TableCell>
                          {plan.changed &&
                          plan.before.minCartAmountCents !==
                            plan.after.minCartAmountCents
                            ? `$${(plan.before.minCartAmountCents / 100).toFixed(0)} → $${(plan.after.minCartAmountCents / 100).toFixed(0)}`
                            : `$${(plan.before.minCartAmountCents / 100).toFixed(0)}`}
                        </TableCell>
                        <TableCell>
                          {plan.changed &&
                          plan.before.useAiPersonalization !==
                            plan.after.useAiPersonalization
                            ? 'Desactivada → Activada'
                            : plan.before.useAiPersonalization
                              ? 'Activada'
                              : 'Desactivada'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {!reinforcementDialog?.loading &&
                !reinforcementDialog?.hasChanges && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    La configuración de recuperación ya está al máximo — no hay
                    nada para reforzar.
                  </Alert>
                )}

              {reinforcementDialog?.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {reinforcementDialog.error}
                </Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setReinforcementDialog(null)}
            disabled={reinforcementDialog?.applying}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={confirmReinforcement}
            disabled={
              reinforcementDialog?.loading ||
              reinforcementDialog?.applying ||
              !reinforcementDialog?.hasChanges
            }
          >
            {reinforcementDialog?.applying ? 'Aplicando…' : 'Aplicar refuerzo'}
          </Button>
        </DialogActions>
      </Dialog>

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

export default AiInsightsPage
