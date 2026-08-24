// 📁 admin/src/pages/AiInsightsPage.jsx
//
// Motor de diagnóstico (Bloque 8.4-8.9) — HENKO detecta problemas de negocio
// (producto con baja conversión, caída de conversión general, campaña de
// bajo rendimiento, cliente inactivo), explica la causa con datos reales, y
// recomienda qué hacer. Solo recomienda — ninguna acción se ejecuta sola
// (8.8, acciones automáticas, queda para más adelante). Mismo esqueleto que
// AiLearningReviewPage.jsx.
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Archive as ArchiveIcon,
  Insights as InsightsIcon,
  PlayCircleOutline as AcknowledgeIcon,
  Refresh as RefreshIcon,
  Cancel as DismissIcon,
} from '@mui/icons-material'
import {
  acknowledgeInsight,
  archiveInsight,
  dismissInsight,
  listInsights,
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

const InsightCard = ({
  insight,
  busy,
  onAcknowledge,
  onDismiss,
  onArchive,
}) => {
  const typeMeta = TYPE_META[insight.type] || {
    label: insight.type,
    color: 'default',
  }
  const isPending = insight.status === 'pending_review'
  const isMeasuring = insight.status === 'measuring'
  const canArchive = ['resolved', 'dismissed'].includes(insight.status)

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

        {(isPending || canArchive) && (
          <Stack spacing={1} sx={{ minWidth: 132 }}>
            {isPending && (
              <>
                <Button
                  size="small"
                  variant="contained"
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
