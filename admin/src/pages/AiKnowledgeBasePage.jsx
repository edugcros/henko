// 📁 admin/src/pages/AiKnowledgeBasePage.jsx
//
// CRUD de la base de conocimiento del Agente IA. El admin crea, edita,
// aprueba y archiva entradas de conocimiento (FAQs, políticas, hints de
// producto, scripts de venta, etc.). Endpoints: /ai-agent/knowledge/*.
//
// El agente solo lee las entradas APROBADAS (searchRelevantKnowledgeForAgent). Todo lo demás
// (pendientes, borradores, rechazadas, archivadas) existe pero el agente no lo usa.
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
  Add as AddIcon,
  Archive as ArchiveIcon,
  CheckCircle as CheckCircleIcon,
  Edit as EditIcon,
  FilterAltOff as FilterAltOffIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import {
  approveKnowledgeItem,
  createKnowledgeItem,
  deleteKnowledgeItem,
  listKnowledge,
  updateKnowledgeItem,
} from '../services/aiKnowledgeService.js'

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
const DEFAULT_STATUS = 'approved'

// `color` es el del texto y de la barra del resumen; `bg` el fondo de la etiqueta.
export const STATUS_META = {
  approved: { label: 'Aprobada', plural: 'Aprobadas', color: '#047857', bg: '#e6f6ef' },
  pending_approval: { label: 'Pendiente', plural: 'Pendientes', color: '#9a5b00', bg: '#fff3dd' },
  draft: { label: 'Borrador', plural: 'Borradores', color: '#55618a', bg: '#eef1fb' },
  rejected: { label: 'Rechazada', plural: 'Rechazadas', color: '#b42318', bg: '#fdebea' },
  archived: { label: 'Archivada', plural: 'Archivadas', color: '#55618a', bg: '#eef1fb' },
}

const STATUS_ORDER = ['approved', 'pending_approval', 'draft', 'rejected', 'archived']

const TYPE_META = {
  faq: { label: 'FAQ' },
  policy: { label: 'Política' },
  product_hint: { label: 'Producto' },
  objection: { label: 'Objeción' },
  sales_script: { label: 'Script venta' },
  custom: { label: 'Personalizado' },
  learning_suggestion: { label: 'Aprendizaje' },
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos los tipos' },
  ...Object.entries(TYPE_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''

const EMPTY_FORM = {
  title: '',
  content: '',
  type: 'custom',
  tags: '',
  confidence: 1,
}

export const parseTags = value =>
  String(value ?? '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)

// La confianza no se edita acá: se reenvía la que ya tiene la entrada. Una entrada con confianza 0
// (algo que el servidor acepta) tenía que seguir en 0 y no pasar a 1 al editarla.
export const toPayload = form => {
  const confidence = Number(form.confidence)

  return {
    title: clean(form.title),
    content: clean(form.content),
    type: form.type,
    tags: parseTags(form.tags),
    confidence: Number.isFinite(confidence) && form.confidence !== '' ? confidence : 1,
  }
}

const formatDate = value => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-AR')
}

const Pill = ({ label, color = BRAND.ink, bg = BRAND.paper, outlined = false }) => (
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

const KnowledgeCard = ({ item, busy, onEdit, onApprove, onArchive }) => {
  const typeMeta = TYPE_META[item.type] || TYPE_META.custom
  const statusMeta = STATUS_META[item.status] || STATUS_META.draft
  const updated = formatDate(item.updatedAt)

  return (
    <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2, sm: 2.5 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
            <Pill label={typeMeta.label} color={BRAND.blue} bg="#e7f0ff" />
            <Pill label={statusMeta.label} color={statusMeta.color} bg={statusMeta.bg} />
            <Pill
              outlined
              color={BRAND.muted}
              label={`Confianza ${Math.round(Number(item.confidence || 0) * 100)}%`}
            />
          </Stack>

          <Typography
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: 17,
              overflowWrap: 'anywhere',
            }}
          >
            {item.title || 'Sin título'}
          </Typography>

          <Typography
            variant="body2"
            sx={{
              mt: 0.5,
              color: BRAND.muted,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.content}
          </Typography>

          {Array.isArray(item.tags) && item.tags.length > 0 && (
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 1.5 }}>
              {item.tags.map(tag => (
                <Pill key={tag} outlined color={BRAND.muted} label={tag} />
              ))}
            </Stack>
          )}

          {updated && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: BRAND.muted }}>
              Actualizada el {updated}
            </Typography>
          )}
        </Box>

        <Stack
          direction={{ xs: 'row', md: 'column' }}
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', minWidth: { md: 140 }, alignSelf: { md: 'flex-start' } }}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon />}
            disabled={busy}
            onClick={() => onEdit(item)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Editar
          </Button>
          {item.status !== 'approved' && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              disabled={busy}
              onClick={() => onApprove(item)}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {item.status === 'archived' ? 'Reactivar' : 'Aprobar'}
            </Button>
          )}
          {item.status !== 'archived' && (
            <Button
              size="small"
              variant="text"
              startIcon={<ArchiveIcon />}
              disabled={busy}
              onClick={() => onArchive(item)}
              sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted }}
            >
              Archivar
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  )
}

const AiKnowledgeBasePage = () => {
  const isMobile = useMediaQuery('(max-width:600px)')

  const [items, setItems] = useState([])
  const [counters, setCounters] = useState({})
  const [meta, setMeta] = useState({})
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

  const [formDialog, setFormDialog] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState(null)

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
      const result = await listKnowledge(params)
      if (request !== requestRef.current) return

      const list = Array.isArray(result.items) ? result.items : []
      const resultMeta = result.meta || {}

      // Se archivó o aprobó lo último de la página y esa página quedó vacía: volver a la última.
      if (list.length === 0 && params.page > 1 && resultMeta.total > 0) {
        setPage(Math.max(1, resultMeta.totalPages || 1))
        return
      }

      setItems(list)
      setMeta(resultMeta)
      setCounters(resultMeta.counters || {})
      setLoaded(true)
    } catch (err) {
      if (request !== requestRef.current) return

      console.error('[AI_KNOWLEDGE_ERROR]', err)
      setItems([])
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar la base de conocimiento.',
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

  const flash = (message, severity = 'success') => setSnackbar({ open: true, severity, message })

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

  const openCreateDialog = () => {
    setFormData(EMPTY_FORM)
    setFormError('')
    setFormDialog('create')
  }

  const openEditDialog = item => {
    setFormData({
      title: item.title || '',
      content: item.content || '',
      type: item.type || 'custom',
      tags: Array.isArray(item.tags) ? item.tags.join(', ') : '',
      confidence: item.confidence ?? 1,
      _id: getId(item),
    })
    setFormError('')
    setFormDialog('edit')
  }

  const closeForm = () => {
    if (!saving) setFormDialog(null)
  }

  const updateField = field => event => {
    const { value } = event.target
    setFormData(prev => ({ ...prev, [field]: value }))
    setFormError('')
  }

  const handleSave = useCallback(async () => {
    const payload = toPayload(formData)
    if (!payload.title || !payload.content) {
      setFormError('Título y contenido son obligatorios.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      if (formDialog === 'edit' && formData._id) {
        await updateKnowledgeItem(formData._id, payload)
        flash('Conocimiento actualizado.')
      } else {
        await createKnowledgeItem(payload)
        flash('Conocimiento creado.')
      }

      setFormDialog(null)
      load()
    } catch (err) {
      setFormError(err?.response?.data?.message || err?.message || 'Error al guardar.')
    } finally {
      setSaving(false)
    }
  }, [formData, formDialog, load])

  // Aprobar sirve para cualquier estado: así también se reactiva lo archivado.
  const handleApprove = useCallback(
    async item => {
      const id = getId(item)
      const reactivating = item.status === 'archived'
      setBusyId(id)
      try {
        await approveKnowledgeItem(id)
        flash(reactivating ? 'Conocimiento reactivado.' : 'Conocimiento aprobado.')
        load()
      } catch (err) {
        flash(
          err?.response?.data?.message ||
            err?.message ||
            (reactivating ? 'Error al reactivar.' : 'Error al aprobar.'),
          'error',
        )
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const handleArchive = useCallback(async () => {
    const item = archiveTarget
    if (!item) return

    const id = getId(item)
    setBusyId(id)
    try {
      await deleteKnowledgeItem(id)
      setArchiveTarget(null)
      flash('Conocimiento archivado.')
      load()
    } catch (err) {
      setArchiveTarget(null)
      flash(err?.response?.data?.message || err?.message || 'Error al archivar.', 'error')
    } finally {
      setBusyId(null)
    }
  }, [archiveTarget, load])

  const totalEntries = STATUS_ORDER.reduce((sum, key) => sum + (Number(counters[key]) || 0), 0)
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
              Base de conocimiento
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Las respuestas, políticas y guías que el agente usa para atender a tus clientes. Solo
              usa las entradas aprobadas.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreateDialog}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              Nuevo
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={load}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
            >
              Actualizar
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Paper
        component="section"
        aria-label="Resumen de la base de conocimiento"
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
          {STATUS_ORDER.map(key => (
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
            sx={{ minWidth: 190 }}
          >
            {TYPE_OPTIONS.map(o => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            placeholder="Título, contenido o tag..."
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
              htmlInput: { 'aria-label': 'Buscar conocimiento' },
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

      {loading && loaded && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {loading && !loaded ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
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
                  Todavía no cargaste conocimiento
                </Typography>
                <Typography sx={{ color: BRAND.muted, mb: 2.5 }}>
                  Cargá las preguntas frecuentes y las políticas de tu tienda para que el agente
                  responda con tu información.
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={openCreateDialog}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Crear la primera entrada
                </Button>
              </>
            ) : (
              <Typography sx={{ color: BRAND.muted }}>
                No se encontró conocimiento con estos filtros.
              </Typography>
            )}
          </Paper>
        )
      ) : (
        <Stack spacing={2} sx={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          {items.map(item => (
            <KnowledgeCard
              key={getId(item)}
              item={item}
              busy={busyId === getId(item)}
              onEdit={openEditDialog}
              onApprove={handleApprove}
              onArchive={setArchiveTarget}
            />
          ))}
          <Stack spacing={1.5} sx={{ alignItems: 'center', pt: 1 }}>
            {meta.totalPages > 1 && (
              <Pagination
                count={meta.totalPages}
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
              {meta.totalPages > 1
                ? `Mostrando ${items.length} de ${meta.total} (página ${meta.page} de ${meta.totalPages})`
                : `${items.length} ${items.length === 1 ? 'entrada' : 'entradas'}`}
            </Typography>
          </Stack>
        </Stack>
      )}

      <Dialog
        open={formDialog !== null}
        onClose={closeForm}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          {formDialog === 'edit' ? 'Editar conocimiento' : 'Nuevo conocimiento'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Título"
              fullWidth
              value={formData.title}
              onChange={updateField('title')}
              helperText={`${formData.title.length}/200`}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              label="Contenido"
              fullWidth
              multiline
              minRows={3}
              maxRows={10}
              value={formData.content}
              onChange={updateField('content')}
              helperText={`${formData.content.length}/10000`}
              slotProps={{ htmlInput: { maxLength: 10000 } }}
            />
            <TextField select label="Tipo" value={formData.type} onChange={updateField('type')}>
              {Object.entries(TYPE_META).map(([value, typeMeta]) => (
                <MenuItem key={value} value={value}>
                  {typeMeta.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Tags (separados por coma)"
              fullWidth
              value={formData.tags}
              onChange={updateField('tags')}
              placeholder="envío, devolución, talle"
              helperText="También se usan para buscar la entrada."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeForm} disabled={saving} sx={{ textTransform: 'none' }}>
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
        open={archiveTarget !== null}
        onClose={() => busyId === null && setArchiveTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          ¿Archivar esta entrada?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ overflowWrap: 'anywhere' }}>
            «{archiveTarget?.title || 'Sin título'}» deja de estar disponible para el agente. No se
            borra: la encontrás en Archivadas y podés reactivarla.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setArchiveTarget(null)}
            disabled={busyId !== null}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleArchive}
            disabled={busyId !== null}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {busyId !== null ? 'Archivando...' : 'Archivar'}
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

export default AiKnowledgeBasePage
