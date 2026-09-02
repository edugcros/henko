// 📁 admin/src/pages/AiLearningReviewPage.jsx
//
// Bandeja de revisión de aprendizaje del Agente IA (human-in-the-loop).
// El agente genera sugerencias (huecos de política, FAQs, patrones); acá el
// admin las aprueba (se convierten en conocimiento), rechaza o archiva.
// Se conecta a /ai-agent/learning-suggestions/*.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
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
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  Refresh as RefreshIcon,
  School as SchoolIcon,
} from '@mui/icons-material'
import {
  approveLearningSuggestion,
  archiveLearningSuggestion,
  listLearningSuggestions,
  rejectLearningSuggestion,
} from '../services/aiLearningSuggestionService.js'

const STATUS_OPTIONS = [
  { value: 'pending_review', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobadas' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'archived', label: 'Archivadas' },
  { value: 'all', label: 'Todas' },
]

const TYPE_META = {
  faq_suggestion: { label: 'FAQ', color: 'info' },
  product_gap: { label: 'Hueco de producto', color: 'warning' },
  policy_gap: { label: 'Hueco de política', color: 'warning' },
  handoff_pattern: { label: 'Derivación', color: 'secondary' },
  conversion_pattern: { label: 'Conversión', color: 'success' },
  negative_signal: { label: 'Señal negativa', color: 'error' },
  general: { label: 'General', color: 'default' },
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

const SuggestionCard = ({
  suggestion,
  busy,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
  onArchive,
}) => {
  const typeMeta = TYPE_META[suggestion.type] || TYPE_META.general
  const isPending = suggestion.status === 'pending_review'
  const confidencePct = Math.round(Number(suggestion.confidence || 0) * 100)

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        borderRadius: 3,
        borderColor: selected ? 'primary.main' : undefined,
        bgcolor: selected ? 'action.selected' : undefined,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={2}
        flexWrap="wrap"
      >
        {isPending && (
          <Checkbox
            checked={selected}
            onChange={() => onToggleSelect(suggestion)}
            disabled={busy}
            sx={{ mt: -1, ml: -1.5 }}
          />
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" mb={1}>
            <Chip size="small" label={typeMeta.label} color={typeMeta.color} />
            {suggestion.priority && (
              <Chip
                size="small"
                variant="outlined"
                label={`Prioridad: ${suggestion.priority}`}
                color={PRIORITY_COLOR[suggestion.priority] || 'default'}
              />
            )}
            <Chip size="small" variant="outlined" label={`Confianza ${confidencePct}%`} />
            {suggestion.metadata?.intent && (
              <Chip size="small" variant="outlined" label={suggestion.metadata.intent} />
            )}
          </Stack>

          <Typography variant="subtitle1" fontWeight={700}>
            {suggestion.title || suggestion.question || 'Sugerencia sin título'}
          </Typography>

          {suggestion.question && suggestion.question !== suggestion.title && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              <strong>Pregunta:</strong> {suggestion.question}
            </Typography>
          )}

          {suggestion.suggestedAnswer && (
            <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
              {suggestion.suggestedAnswer}
            </Typography>
          )}

          {suggestion.metadata?.sampleUserText && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: 'block', fontStyle: 'italic' }}
            >
              Ejemplo real del cliente: “{suggestion.metadata.sampleUserText}”
            </Typography>
          )}

          {Array.isArray(suggestion.tags) && suggestion.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1.5 }}>
              {suggestion.tags.map(tag => (
                <Chip key={tag} size="small" variant="outlined" label={tag} />
              ))}
            </Stack>
          )}

          {suggestion.status === 'rejected' && suggestion.reason && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              Rechazada: {suggestion.reason}
            </Typography>
          )}
        </Box>

        {isPending && (
          <Stack spacing={1} sx={{ minWidth: 132 }}>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              disabled={busy}
              onClick={() => onApprove(suggestion)}
            >
              Aprobar
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              disabled={busy}
              onClick={() => onReject(suggestion)}
            >
              Rechazar
            </Button>
            <Tooltip title="Archivar sin convertir en conocimiento">
              <span>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<ArchiveIcon />}
                  disabled={busy}
                  onClick={() => onArchive(suggestion)}
                  fullWidth
                >
                  Archivar
                </Button>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

const AiLearningReviewPage = () => {
  const [items, setItems] = useState([])
  const [counters, setCounters] = useState({})
  const [status, setStatus] = useState('pending_review')
  const [type, setType] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  const [approveDialog, setApproveDialog] = useState(null)
  const [rejectDialog, setRejectDialog] = useState(null)

  // Selección múltiple: solo tiene sentido sobre pendientes — aprobar/
  // rechazar/archivar ya aprobadas o rechazadas no es una acción válida (ver
  // isPending en SuggestionCard, que solo muestra las acciones ahí).
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkRejectDialog, setBulkRejectDialog] = useState(null)

  const params = useMemo(
    () => ({
      status,
      type: type === 'all' ? undefined : type,
      search: search || undefined,
      page: 1,
      limit: 50,
    }),
    [status, type, search],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listLearningSuggestions(params)
      setItems(Array.isArray(data?.items) ? data.items : [])
      setCounters(data?.counters || {})
    } catch (err) {
      console.error('[AI_LEARNING_LIST_ERROR]', err)
      setError(
        err?.response?.data?.message || err?.message || 'No se pudieron cargar las sugerencias.',
      )
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => {
    load()
  }, [load])

  // Cambiar de filtro cambia qué items están en pantalla — una selección
  // hecha con otro filtro ya no tiene sentido acá.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [params])

  const notify = (severity, message) => setSnackbar({ open: true, severity, message })

  const pendingItems = useMemo(
    () => items.filter(item => item.status === 'pending_review'),
    [items],
  )

  const allPendingSelected =
    pendingItems.length > 0 && pendingItems.every(item => selectedIds.has(getId(item)))

  const toggleSelect = useCallback(suggestion => {
    const id = getId(suggestion)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAllPending = useCallback(() => {
    setSelectedIds(prev => {
      const allSelected =
        pendingItems.length > 0 && pendingItems.every(item => prev.has(getId(item)))
      if (allSelected) return new Set()
      return new Set(pendingItems.map(getId))
    })
  }, [pendingItems])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  // Promise.allSettled, no Promise.all: si una sugerencia falla (ej. otro
  // admin la tocó mientras tanto), el resto de la tanda igual se aplica —
  // reporta cuántas salieron bien y cuántas no en vez de perder todo el lote
  // por una sola falla.
  const runBulkAction = useCallback(
    async (ids, actionFn, successVerb) => {
      if (!ids.length) return
      setBulkBusy(true)
      setError('')
      try {
        const results = await Promise.allSettled(ids.map(id => actionFn(id)))
        const succeeded = results.filter(r => r.status === 'fulfilled').length
        const failed = results.length - succeeded

        if (failed === 0) {
          notify('success', `${succeeded} sugerencia(s) ${successVerb}.`)
        } else if (succeeded === 0) {
          notify('error', `No se pudo completar la acción en ninguna (${failed}).`)
        } else {
          notify('warning', `${succeeded} ${successVerb}, ${failed} falló(aron) — revisá la lista.`)
        }

        clearSelection()
        await load()
      } finally {
        setBulkBusy(false)
      }
    },
    [clearSelection, load],
  )

  const handleBulkApprove = useCallback(() => {
    // Sin overrides de title/content/tags: el backend usa lo que ya trae
    // cada sugerencia (mismo comportamiento que "Aprobar" individual sin
    // editar nada en el diálogo).
    runBulkAction(
      [...selectedIds],
      id => approveLearningSuggestion(id),
      'aprobada(s) y convertida(s) en conocimiento',
    )
  }, [selectedIds, runBulkAction])

  const openBulkReject = useCallback(() => {
    setBulkRejectDialog({ reason: '' })
  }, [])

  const confirmBulkReject = useCallback(async () => {
    const dialog = bulkRejectDialog
    if (!dialog) return
    setBulkRejectDialog(null)
    await runBulkAction(
      [...selectedIds],
      id => rejectLearningSuggestion(id, clean(dialog.reason)),
      'rechazada(s)',
    )
  }, [bulkRejectDialog, selectedIds, runBulkAction])

  const handleBulkArchive = useCallback(() => {
    runBulkAction([...selectedIds], id => archiveLearningSuggestion(id), 'archivada(s)')
  }, [selectedIds, runBulkAction])

  const runAction = useCallback(
    async (id, action, successMessage) => {
      setBusyId(id)
      setError('')
      try {
        await action()
        notify('success', successMessage)
        await load()
      } catch (err) {
        console.error('[AI_LEARNING_ACTION_ERROR]', err)
        setError(err?.response?.data?.message || err?.message || 'No se pudo completar la acción.')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const openApprove = useCallback(suggestion => {
    setApproveDialog({
      id: getId(suggestion),
      title: suggestion.title || suggestion.question || '',
      content: suggestion.suggestedAnswer || '',
      tags: Array.isArray(suggestion.tags) ? suggestion.tags.join(', ') : '',
    })
  }, [])

  const confirmApprove = useCallback(async () => {
    const dialog = approveDialog
    if (!dialog) return
    setApproveDialog(null)
    await runAction(
      dialog.id,
      () =>
        approveLearningSuggestion(dialog.id, {
          title: clean(dialog.title),
          content: clean(dialog.content),
          tags: clean(dialog.tags)
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean),
        }),
      'Sugerencia aprobada y convertida en conocimiento.',
    )
  }, [approveDialog, runAction])

  const openReject = useCallback(suggestion => {
    setRejectDialog({ id: getId(suggestion), reason: '' })
  }, [])

  const confirmReject = useCallback(async () => {
    const dialog = rejectDialog
    if (!dialog) return
    setRejectDialog(null)
    await runAction(
      dialog.id,
      () => rejectLearningSuggestion(dialog.id, clean(dialog.reason)),
      'Sugerencia rechazada.',
    )
  }, [rejectDialog, runAction])

  const handleArchive = useCallback(
    suggestion => {
      const id = getId(suggestion)
      runAction(id, () => archiveLearningSuggestion(id), 'Sugerencia archivada.')
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
            <SchoolIcon color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Aprendizaje del agente
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Revisá lo que el agente aprendió antes de que lo use con clientes reales.
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
          <Grid xs={12} sm={4}>
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
                  {counters[option.value] !== undefined && ` (${counters[option.value]})`}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid xs={12} sm={4}>
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
          <Grid xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Buscar"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="título, pregunta, tag..."
            />
          </Grid>
        </Grid>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {pendingItems.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 3,
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flex: 1 }}>
            <Checkbox
              checked={allPendingSelected}
              indeterminate={selectedIds.size > 0 && !allPendingSelected}
              onChange={toggleSelectAllPending}
              disabled={bulkBusy}
            />
            <Typography variant="body2" color="text.secondary">
              {selectedIds.size > 0
                ? `${selectedIds.size} seleccionada(s)`
                : `Seleccionar las ${pendingItems.length} pendiente(s) visibles`}
            </Typography>
          </Stack>

          {selectedIds.size > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                disabled={bulkBusy}
                onClick={handleBulkApprove}
              >
                Aprobar
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                disabled={bulkBusy}
                onClick={openBulkReject}
              >
                Rechazar
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<ArchiveIcon />}
                disabled={bulkBusy}
                onClick={handleBulkArchive}
              >
                Archivar
              </Button>
              <Button size="small" onClick={clearSelection} disabled={bulkBusy}>
                Cancelar
              </Button>
            </Stack>
          )}
        </Paper>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, borderRadius: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">No hay sugerencias para este filtro.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {items.map(suggestion => (
            <SuggestionCard
              key={getId(suggestion)}
              suggestion={suggestion}
              busy={busyId === getId(suggestion) || bulkBusy}
              selected={selectedIds.has(getId(suggestion))}
              onToggleSelect={toggleSelect}
              onApprove={openApprove}
              onReject={openReject}
              onArchive={handleArchive}
            />
          ))}
        </Stack>
      )}

      {/* Aprobar: el admin puede editar el conocimiento antes de convertirlo */}
      <Dialog
        open={Boolean(approveDialog)}
        onClose={() => setApproveDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Aprobar y convertir en conocimiento</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Se agregará a la base de conocimiento aprobada del agente. Podés editar el texto antes
            de confirmar.
          </Typography>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <TextField
              fullWidth
              label="Título"
              value={approveDialog?.title || ''}
              onChange={e => setApproveDialog(prev => ({ ...prev, title: e.target.value }))}
              inputProps={{ maxLength: 200 }}
            />
            <TextField
              fullWidth
              multiline
              minRows={4}
              label="Contenido"
              value={approveDialog?.content || ''}
              onChange={e => setApproveDialog(prev => ({ ...prev, content: e.target.value }))}
              inputProps={{ maxLength: 10000 }}
            />
            <TextField
              fullWidth
              label="Tags (separados por coma)"
              value={approveDialog?.tags || ''}
              onChange={e => setApproveDialog(prev => ({ ...prev, tags: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setApproveDialog(null)}>Cancelar</Button>
          <Button
            variant="contained"
            color="success"
            onClick={confirmApprove}
            disabled={!clean(approveDialog?.content)}
          >
            Aprobar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rechazar: motivo opcional */}
      <Dialog
        open={Boolean(rejectDialog)}
        onClose={() => setRejectDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rechazar sugerencia</DialogTitle>
        <DialogContent>
          <Divider sx={{ mb: 2 }} />
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Motivo (opcional)"
            value={rejectDialog?.reason || ''}
            onChange={e => setRejectDialog(prev => ({ ...prev, reason: e.target.value }))}
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRejectDialog(null)}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={confirmReject}>
            Rechazar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rechazar en lote: un motivo compartido para todas las seleccionadas */}
      <Dialog
        open={Boolean(bulkRejectDialog)}
        onClose={() => setBulkRejectDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rechazar {selectedIds.size} sugerencia(s)</DialogTitle>
        <DialogContent>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            El motivo se aplica a todas las sugerencias seleccionadas.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Motivo (opcional)"
            value={bulkRejectDialog?.reason || ''}
            onChange={e => setBulkRejectDialog(prev => ({ ...prev, reason: e.target.value }))}
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkRejectDialog(null)}>Cancelar</Button>
          <Button variant="contained" color="error" onClick={confirmBulkReject}>
            Rechazar {selectedIds.size}
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

export default AiLearningReviewPage
