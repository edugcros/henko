// 📁 admin/src/pages/AiLearningReviewPage.jsx
//
// Bandeja de revisión de aprendizaje del Agente IA (human-in-the-loop).
// El agente genera sugerencias (huecos de política, FAQs, patrones); acá el
// admin las aprueba (se convierten en conocimiento), rechaza o archiva.
// Se conecta a /ai-agent/learning-suggestions/*.
//
// Aprobar es publicar: la sugerencia pasa a ser conocimiento que el agente usa con clientes reales.
// Por eso las acciones que publican en lote piden confirmación, y los diálogos no se cierran hasta
// que el servidor respondió (si falla, lo escrito sigue ahí).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  Archive as ArchiveIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  FilterAltOff as FilterAltOffIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import {
  approveLearningSuggestion,
  archiveLearningSuggestion,
  listLearningSuggestions,
  rejectLearningSuggestion,
} from '../services/aiLearningSuggestionService.js'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const PAGE_SIZE = 50
const SEARCH_DELAY_MS = 300
const DEFAULT_STATUS = 'pending_review'

// `color` es el del texto y de la barra del resumen; `bg` el fondo de la etiqueta.
export const STATUS_META = {
  pending_review: { label: 'Pendiente', plural: 'Pendientes', color: '#9a5b00', bg: '#fff3dd' },
  approving: { label: 'Aprobando', plural: 'Aprobando', color: '#0b55cc', bg: '#e7f0ff' },
  approved: { label: 'Aprobada', plural: 'Aprobadas', color: '#047857', bg: '#e6f6ef' },
  rejected: { label: 'Rechazada', plural: 'Rechazadas', color: '#b42318', bg: '#fdebea' },
  archived: { label: 'Archivada', plural: 'Archivadas', color: '#55618a', bg: '#eef1fb' },
}

const SUMMARY_STATUSES = ['pending_review', 'approved', 'rejected', 'archived']

const TONE = {
  blue: { color: BRAND.blue, bg: '#e7f0ff' },
  amber: { color: '#9a5b00', bg: '#fff3dd' },
  red: { color: '#b42318', bg: '#fdebea' },
  green: { color: '#047857', bg: '#e6f6ef' },
  gray: { color: '#55618a', bg: '#eef1fb' },
}

const TYPE_META = {
  faq_suggestion: { label: 'FAQ', tone: 'blue' },
  product_gap: { label: 'Hueco de producto', tone: 'amber' },
  policy_gap: { label: 'Hueco de política', tone: 'amber' },
  handoff_pattern: { label: 'Derivación', tone: 'blue' },
  conversion_pattern: { label: 'Conversión', tone: 'green' },
  negative_signal: { label: 'Señal negativa', tone: 'red' },
  general: { label: 'General', tone: 'gray' },
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos los tipos' },
  ...Object.entries(TYPE_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

// El servidor ordena por prioridad (crítica primero) y guarda el texto en inglés.
export const PRIORITY_META = {
  critical: { label: 'Prioridad crítica', tone: 'red' },
  high: { label: 'Prioridad alta', tone: 'amber' },
  medium: { label: 'Prioridad media', tone: 'blue' },
  low: { label: 'Prioridad baja', tone: 'gray' },
}

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''

export const parseTags = value =>
  clean(value)
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// Cómo se dice cada acción en lote, en singular y plural, para armar el aviso.
const BULK_VERBS = {
  approve: {
    one: 'aprobada y convertida en conocimiento',
    many: 'aprobadas y convertidas en conocimiento',
    short: ['aprobada', 'aprobadas'],
  },
  reject: { one: 'rechazada', many: 'rechazadas', short: ['rechazada', 'rechazadas'] },
  archive: { one: 'archivada', many: 'archivadas', short: ['archivada', 'archivadas'] },
}

export const bulkMessage = (action, succeeded, failed) => {
  const verbs = BULK_VERBS[action]

  if (failed === 0) {
    return {
      severity: 'success',
      message: `${plural(succeeded, 'sugerencia', 'sugerencias')} ${succeeded === 1 ? verbs.one : verbs.many}.`,
    }
  }

  if (succeeded === 0) {
    return {
      severity: 'error',
      message: `No se pudo completar la acción en ${failed === 1 ? 'la sugerencia' : `ninguna de las ${failed} sugerencias`}.`,
    }
  }

  return {
    severity: 'warning',
    message: `${plural(succeeded, verbs.short[0], verbs.short[1])}, ${failed} ${failed === 1 ? 'falló' : 'fallaron'}. Quedaron seleccionadas para reintentar.`,
  }
}

const Pill = ({ label, tone = 'blue', color, bg, outlined = false }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      px: 1.25,
      py: 0.25,
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.6,
      color: outlined ? BRAND.muted : color || TONE[tone].color,
      bgcolor: outlined ? 'transparent' : bg || TONE[tone].bg,
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
  const statusMeta = STATUS_META[suggestion.status]
  const priorityMeta = PRIORITY_META[suggestion.priority]
  const isPending = suggestion.status === 'pending_review'
  // El servidor también deja aprobar una archivada: es la forma de rescatarla.
  const canApprove = isPending || suggestion.status === 'archived'
  const confidencePct = Math.round(Number(suggestion.confidence || 0) * 100)
  const title = suggestion.title || suggestion.question || 'Sugerencia sin título'

  return (
    <Paper
      variant="outlined"
      sx={{
        ...PANEL_SX,
        p: { xs: 2, sm: 2.5 },
        borderColor: selected ? BRAND.blue : BRAND.line,
        bgcolor: selected ? BRAND.paper : '#fff',
      }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          {isPending && (
            <Checkbox
              checked={selected}
              onChange={() => onToggleSelect(suggestion)}
              disabled={busy}
              sx={{ mt: -1, ml: -1.5, alignSelf: 'flex-start' }}
              slotProps={{ input: { 'aria-label': `Seleccionar «${title}»` } }}
            />
          )}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
              <Pill label={typeMeta.label} tone={typeMeta.tone} />
              {statusMeta && (
                <Pill label={statusMeta.label} color={statusMeta.color} bg={statusMeta.bg} />
              )}
              {suggestion.priority && (
                <Pill
                  label={priorityMeta?.label || `Prioridad: ${suggestion.priority}`}
                  tone={priorityMeta?.tone || 'gray'}
                />
              )}
              <Pill outlined label={`Confianza ${confidencePct}%`} />
              {suggestion.metadata?.intent && <Pill outlined label={suggestion.metadata.intent} />}
            </Stack>

            <Typography
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                fontSize: 17,
                overflowWrap: 'anywhere',
              }}
            >
              {title}
            </Typography>

            {suggestion.question && suggestion.question !== suggestion.title && (
              <Typography
                variant="body2"
                sx={{ mt: 0.5, color: BRAND.muted, overflowWrap: 'anywhere' }}
              >
                <strong>Pregunta:</strong> {suggestion.question}
              </Typography>
            )}

            {suggestion.suggestedAnswer && (
              <Typography
                variant="body2"
                sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: BRAND.ink }}
              >
                {suggestion.suggestedAnswer}
              </Typography>
            )}

            {suggestion.metadata?.sampleUserText && (
              <Typography
                variant="caption"
                sx={{
                  mt: 1,
                  display: 'block',
                  fontStyle: 'italic',
                  color: BRAND.muted,
                  overflowWrap: 'anywhere',
                }}
              >
                Ejemplo real del cliente: “{suggestion.metadata.sampleUserText}”
              </Typography>
            )}

            {Array.isArray(suggestion.tags) && suggestion.tags.length > 0 && (
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
                {suggestion.tags.map(tag => (
                  <Pill key={tag} outlined label={tag} />
                ))}
              </Stack>
            )}

            {suggestion.status === 'rejected' && suggestion.reason && (
              <Typography
                variant="caption"
                sx={{ mt: 1, display: 'block', color: '#b42318', overflowWrap: 'anywhere' }}
              >
                Rechazada: {suggestion.reason}
              </Typography>
            )}
          </Box>
        </Stack>

        {canApprove && (
          <Stack
            direction={{ xs: 'row', md: 'column' }}
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', minWidth: { md: 140 }, alignSelf: { md: 'flex-start' } }}
          >
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              disabled={busy}
              onClick={() => onApprove(suggestion)}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Aprobar
            </Button>
            {isPending && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  startIcon={<CancelIcon />}
                  disabled={busy}
                  onClick={() => onReject(suggestion)}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Rechazar
                </Button>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<ArchiveIcon />}
                  disabled={busy}
                  onClick={() => onArchive(suggestion)}
                  title="Archivar sin convertir en conocimiento"
                  sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted }}
                >
                  Archivar
                </Button>
              </>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  )
}

const AiLearningReviewPage = () => {
  const isMobile = useMediaQuery('(max-width:600px)')

  const [items, setItems] = useState([])
  const [counters, setCounters] = useState({})
  const [pagination, setPagination] = useState({})
  const [status, setStatus] = useState(DEFAULT_STATUS)
  const [type, setType] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
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

  // Cada diálogo guarda su propio `error` y su `submitting`: no se cierran hasta que el servidor
  // contestó, así que si falla lo escrito no se pierde.
  const [approveDialog, setApproveDialog] = useState(null)
  const [rejectDialog, setRejectDialog] = useState(null)

  // Selección múltiple: solo tiene sentido sobre pendientes — aprobar/
  // rechazar/archivar ya aprobadas o rechazadas no es una acción válida (ver
  // isPending en SuggestionCard, que solo muestra las acciones ahí).
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkRejectDialog, setBulkRejectDialog] = useState(null)
  const [bulkConfirm, setBulkConfirm] = useState(null)

  // Una respuesta lenta de una consulta anterior no tiene que pisar a la más reciente.
  const requestRef = useRef(0)

  const params = useMemo(
    () => ({
      status,
      type: type === 'all' ? undefined : type,
      search: search || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [status, type, search, page],
  )

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const data = await listLearningSuggestions(params)
      if (request !== requestRef.current) return

      const list = Array.isArray(data?.items) ? data.items : []
      const resultPagination = data?.pagination || {}

      // Se resolvió lo último de la página y esa página quedó vacía: volver a la última.
      if (list.length === 0 && params.page > 1 && resultPagination.total > 0) {
        setPage(Math.max(1, resultPagination.pages || 1))
        return
      }

      setItems(list)
      setPagination(resultPagination)
      setCounters(data?.counters || {})
      setLoaded(true)
    } catch (err) {
      if (request !== requestRef.current) return

      console.error('[AI_LEARNING_LIST_ERROR]', err)
      setItems([])
      setError(
        err?.response?.data?.message || err?.message || 'No se pudieron cargar las sugerencias.',
      )
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }, [params])

  useEffect(() => {
    load()
  }, [load])

  // La búsqueda espera a que se deje de escribir: antes salía una consulta por cada tecla.
  useEffect(() => {
    const next = searchInput.trim()
    if (next === search) return undefined

    const timer = setTimeout(() => {
      setSearch(next)
      setPage(1)
    }, SEARCH_DELAY_MS)

    return () => clearTimeout(timer)
  }, [searchInput, search])

  // Cambiar de filtro o de página cambia qué items están en pantalla — una selección
  // hecha antes ya no tiene sentido acá.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [params])

  const notify = (severity, message) => setSnackbar({ open: true, severity, message })

  const changeStatus = value => {
    setStatus(value)
    setPage(1)
  }

  const changeType = value => {
    setType(value)
    setPage(1)
  }

  const clearFilters = () => {
    setStatus(DEFAULT_STATUS)
    setType('all')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const hayFiltros = status !== DEFAULT_STATUS || type !== 'all' || searchInput !== ''

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
  // por una sola falla. Las que fallaron quedan seleccionadas para reintentar.
  const runBulkAction = useCallback(
    async (ids, actionFn, action) => {
      if (!ids.length) return
      setBulkBusy(true)
      setError('')
      try {
        const results = await Promise.allSettled(ids.map(id => actionFn(id)))
        const failedIds = ids.filter((_, index) => results[index].status === 'rejected')
        const { severity, message } = bulkMessage(
          action,
          ids.length - failedIds.length,
          failedIds.length,
        )

        notify(severity, message)
        await load()
        // Después de `load`, porque recargar suelta la selección: se vuelve a marcar solo lo que falló.
        setSelectedIds(new Set(failedIds))
      } finally {
        setBulkBusy(false)
      }
    },
    [load],
  )

  const confirmBulkApprove = useCallback(async () => {
    setBulkConfirm(null)
    // Sin overrides de title/content/tags: el backend usa lo que ya trae
    // cada sugerencia (mismo comportamiento que "Aprobar" individual sin
    // editar nada en el diálogo).
    await runBulkAction([...selectedIds], id => approveLearningSuggestion(id), 'approve')
  }, [selectedIds, runBulkAction])

  const confirmBulkArchive = useCallback(async () => {
    setBulkConfirm(null)
    await runBulkAction([...selectedIds], id => archiveLearningSuggestion(id), 'archive')
  }, [selectedIds, runBulkAction])

  const confirmBulkReject = useCallback(async () => {
    const dialog = bulkRejectDialog
    if (!dialog) return
    setBulkRejectDialog(null)
    await runBulkAction(
      [...selectedIds],
      id => rejectLearningSuggestion(id, clean(dialog.reason)),
      'reject',
    )
  }, [bulkRejectDialog, selectedIds, runBulkAction])

  const handleArchive = useCallback(
    async suggestion => {
      const id = getId(suggestion)
      setBusyId(id)
      setError('')
      try {
        await archiveLearningSuggestion(id)
        notify('success', 'Sugerencia archivada.')
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

  // Corre la acción de un diálogo: si sale bien lo cierra y recarga; si falla, lo deja abierto con
  // el motivo adentro y con lo que el usuario había escrito.
  const submitDialog = useCallback(
    async (setDialog, action, successMessage) => {
      setDialog(prev => ({ ...prev, submitting: true, error: '' }))
      try {
        await action()
        setDialog(null)
        notify('success', successMessage)
        await load()
      } catch (err) {
        console.error('[AI_LEARNING_ACTION_ERROR]', err)
        setDialog(prev =>
          prev
            ? {
                ...prev,
                submitting: false,
                error:
                  err?.response?.data?.message || err?.message || 'No se pudo completar la acción.',
              }
            : prev,
        )
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
      error: '',
      submitting: false,
    })
  }, [])

  const confirmApprove = useCallback(() => {
    const dialog = approveDialog
    if (!dialog) return
    submitDialog(
      setApproveDialog,
      () =>
        approveLearningSuggestion(dialog.id, {
          title: clean(dialog.title),
          content: clean(dialog.content),
          tags: parseTags(dialog.tags),
        }),
      'Sugerencia aprobada y convertida en conocimiento.',
    )
  }, [approveDialog, submitDialog])

  const openReject = useCallback(suggestion => {
    setRejectDialog({ id: getId(suggestion), reason: '', error: '', submitting: false })
  }, [])

  const confirmReject = useCallback(() => {
    const dialog = rejectDialog
    if (!dialog) return
    submitDialog(
      setRejectDialog,
      () => rejectLearningSuggestion(dialog.id, clean(dialog.reason)),
      'Sugerencia rechazada.',
    )
  }, [rejectDialog, submitDialog])

  const pendingCount = counters.pending_review || 0
  const totalEntries = Object.values(counters).reduce((sum, value) => sum + (Number(value) || 0), 0)
  const countOf = key => (loaded ? Number(counters[key]) || 0 : '–')

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
              Aprendizaje del agente
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Revisá lo que el agente aprendió antes de que lo use con clientes reales.
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
        aria-label="Resumen del aprendizaje del agente"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' },
          }}
        >
          {SUMMARY_STATUSES.map(key => (
            <SummaryTile
              key={key}
              title={STATUS_META[key].plural}
              value={countOf(key)}
              color={STATUS_META[key].color}
              onClick={() => changeStatus(key)}
              active={status === key}
            />
          ))}
          <SummaryTile
            title="Todas"
            value={loaded ? totalEntries : '–'}
            color={BRAND.blue}
            onClick={() => changeStatus('all')}
            active={status === 'all'}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <TextField
            select
            size="small"
            label="Tipo"
            value={type}
            onChange={e => changeType(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            {TYPE_OPTIONS.map(option => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            placeholder="Título, pregunta o tag..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            sx={{ flex: 1, minWidth: { sm: 220 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Buscar sugerencias' },
            }}
          />
          {hayFiltros && (
            <Button
              onClick={clearFilters}
              startIcon={<FilterAltOffIcon />}
              sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
            >
              Limpiar filtros
            </Button>
          )}
        </Stack>
      </Paper>

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

      {pendingItems.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            ...PANEL_SX,
            p: 1.5,
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flex: 1 }}>
            <Checkbox
              checked={allPendingSelected}
              indeterminate={selectedIds.size > 0 && !allPendingSelected}
              onChange={toggleSelectAllPending}
              disabled={bulkBusy}
              slotProps={{ input: { 'aria-label': 'Seleccionar todas las pendientes visibles' } }}
            />
            <Typography variant="body2" sx={{ color: BRAND.muted }}>
              {selectedIds.size > 0
                ? `${plural(selectedIds.size, 'seleccionada', 'seleccionadas')}`
                : `Seleccionar ${pendingItems.length === 1 ? 'la pendiente visible' : `las ${pendingItems.length} pendientes visibles`}`}
            </Typography>
          </Stack>

          {selectedIds.size > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<CheckCircleIcon />}
                disabled={bulkBusy}
                onClick={() => setBulkConfirm('approve')}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Aprobar
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<CancelIcon />}
                disabled={bulkBusy}
                onClick={() => setBulkRejectDialog({ reason: '' })}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Rechazar
              </Button>
              <Button
                size="small"
                variant="text"
                startIcon={<ArchiveIcon />}
                disabled={bulkBusy}
                onClick={() => setBulkConfirm('archive')}
                sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted }}
              >
                Archivar
              </Button>
              <Button
                size="small"
                onClick={clearSelection}
                disabled={bulkBusy}
                sx={{ textTransform: 'none' }}
              >
                Cancelar
              </Button>
            </Stack>
          )}
        </Paper>
      )}

      {loading && loaded && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {loading && !loaded ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        !error && (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: 6, textAlign: 'center' }}>
            {totalEntries === 0 && !hayFiltros ? (
              <>
                <Typography
                  sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 0.5 }}
                >
                  Todavía no hay nada para revisar
                </Typography>
                <Typography sx={{ color: BRAND.muted }}>
                  El agente propone sugerencias cuando detecta preguntas que no sabe responder bien.
                  Van a aparecer acá.
                </Typography>
              </>
            ) : (
              <Typography sx={{ color: BRAND.muted }}>
                No hay sugerencias para este filtro.
              </Typography>
            )}
          </Paper>
        )
      ) : (
        <Stack spacing={2} sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
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
          <Stack spacing={1.5} sx={{ alignItems: 'center', pt: 1 }}>
            {pagination.pages > 1 && (
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
            )}
            <Typography variant="caption" sx={{ color: BRAND.muted }}>
              {pagination.pages > 1
                ? `Mostrando ${items.length} de ${pagination.total} (página ${pagination.page} de ${pagination.pages})`
                : plural(items.length, 'sugerencia', 'sugerencias')}
            </Typography>
          </Stack>
        </Stack>
      )}

      {/* Aprobar: el admin puede editar el conocimiento antes de convertirlo */}
      <Dialog
        open={Boolean(approveDialog)}
        onClose={() => !approveDialog?.submitting && setApproveDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Aprobar y convertir en conocimiento
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, color: BRAND.muted }}>
            Se agregará a la base de conocimiento aprobada del agente. Podés editar el texto antes
            de confirmar.
          </Typography>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {approveDialog?.error && <Alert severity="error">{approveDialog.error}</Alert>}
            <TextField
              fullWidth
              label="Título"
              value={approveDialog?.title || ''}
              onChange={e =>
                setApproveDialog(prev => ({ ...prev, title: e.target.value, error: '' }))
              }
              helperText={`${(approveDialog?.title || '').length}/200`}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              fullWidth
              multiline
              minRows={4}
              label="Contenido"
              value={approveDialog?.content || ''}
              onChange={e =>
                setApproveDialog(prev => ({ ...prev, content: e.target.value, error: '' }))
              }
              helperText={`${(approveDialog?.content || '').length}/10000`}
              slotProps={{ htmlInput: { maxLength: 10000 } }}
            />
            <TextField
              fullWidth
              label="Tags (separados por coma)"
              value={approveDialog?.tags || ''}
              onChange={e =>
                setApproveDialog(prev => ({ ...prev, tags: e.target.value, error: '' }))
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setApproveDialog(null)}
            disabled={approveDialog?.submitting}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={confirmApprove}
            disabled={!clean(approveDialog?.content) || approveDialog?.submitting}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {approveDialog?.submitting ? 'Aprobando...' : 'Aprobar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rechazar: motivo opcional */}
      <Dialog
        open={Boolean(rejectDialog)}
        onClose={() => !rejectDialog?.submitting && setRejectDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Rechazar sugerencia
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {rejectDialog?.error && <Alert severity="error">{rejectDialog.error}</Alert>}
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Motivo (opcional)"
              value={rejectDialog?.reason || ''}
              onChange={e =>
                setRejectDialog(prev => ({ ...prev, reason: e.target.value, error: '' }))
              }
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setRejectDialog(null)}
            disabled={rejectDialog?.submitting}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmReject}
            disabled={rejectDialog?.submitting}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {rejectDialog?.submitting ? 'Rechazando...' : 'Rechazar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rechazar en lote: un motivo compartido para todas las seleccionadas */}
      <Dialog
        open={Boolean(bulkRejectDialog)}
        onClose={() => setBulkRejectDialog(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Rechazar {plural(selectedIds.size, 'sugerencia', 'sugerencias')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, color: BRAND.muted }}>
            El motivo se aplica a todas las sugerencias seleccionadas.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Motivo (opcional)"
            value={bulkRejectDialog?.reason || ''}
            onChange={e => setBulkRejectDialog(prev => ({ ...prev, reason: e.target.value }))}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkRejectDialog(null)} sx={{ textTransform: 'none' }}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmBulkReject}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Rechazar {selectedIds.size}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Aprobar o archivar en lote: una confirmación, porque aprobar publica sin pasar por el
          diálogo de edición. */}
      <Dialog
        open={bulkConfirm !== null}
        onClose={() => setBulkConfirm(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          {bulkConfirm === 'approve'
            ? `¿Aprobar ${plural(selectedIds.size, 'sugerencia', 'sugerencias')}?`
            : `¿Archivar ${plural(selectedIds.size, 'sugerencia', 'sugerencias')}?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {bulkConfirm === 'approve'
              ? 'Pasan a la base de conocimiento tal como están, sin que las edites, y el agente las usa con clientes reales desde ahora.'
              : 'Se descartan sin convertirse en conocimiento. Después se pueden aprobar desde Archivadas.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setBulkConfirm(null)} sx={{ textTransform: 'none' }}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={bulkConfirm === 'approve' ? confirmBulkApprove : confirmBulkArchive}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {bulkConfirm === 'approve' ? 'Aprobar' : 'Archivar'}
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

export default AiLearningReviewPage
