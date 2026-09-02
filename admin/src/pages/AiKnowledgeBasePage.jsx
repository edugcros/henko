// 📁 admin/src/pages/AiKnowledgeBasePage.jsx
//
// CRUD de la base de conocimiento del Agente IA. El admin crea, edita,
// aprueba y archiva entradas de conocimiento (FAQs, políticas, hints de
// producto, scripts de venta, etc.). Endpoints: /ai-agent/knowledge/*.
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
  Add as AddIcon,
  Archive as ArchiveIcon,
  CheckCircle as CheckCircleIcon,
  Edit as EditIcon,
  MenuBook as MenuBookIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import {
  approveKnowledgeItem,
  createKnowledgeItem,
  deleteKnowledgeItem,
  listKnowledge,
  updateKnowledgeItem,
} from '../services/aiKnowledgeService.js'

const STATUS_OPTIONS = [
  { value: 'approved', label: 'Aprobadas' },
  { value: 'pending_approval', label: 'Pendientes' },
  { value: 'draft', label: 'Borradores' },
  { value: 'rejected', label: 'Rechazadas' },
  { value: 'archived', label: 'Archivadas' },
  { value: 'all', label: 'Todas' },
]

const TYPE_META = {
  faq: { label: 'FAQ', color: 'info' },
  policy: { label: 'Política', color: 'primary' },
  product_hint: { label: 'Producto', color: 'success' },
  objection: { label: 'Objeción', color: 'warning' },
  sales_script: { label: 'Script venta', color: 'secondary' },
  custom: { label: 'Custom', color: 'default' },
  learning_suggestion: { label: 'Aprendizaje', color: 'info' },
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos los tipos' },
  ...Object.entries(TYPE_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

const STATUS_CHIP = {
  approved: { label: 'Aprobada', color: 'success' },
  pending_approval: { label: 'Pendiente', color: 'warning' },
  draft: { label: 'Borrador', color: 'default' },
  rejected: { label: 'Rechazada', color: 'error' },
  archived: { label: 'Archivada', color: 'default' },
}

const clean = value => String(value ?? '').trim()
const getId = item => item?._id || item?.id || ''

const EMPTY_FORM = {
  title: '',
  content: '',
  type: 'custom',
  tags: '',
  confidence: 1,
}

const KnowledgeCard = ({ item, busy, onEdit, onApprove, onArchive }) => {
  const typeMeta = TYPE_META[item.type] || TYPE_META.custom
  const statusMeta = STATUS_CHIP[item.status] || STATUS_CHIP.draft

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
            <Chip size="small" label={typeMeta.label} color={typeMeta.color} />
            <Chip
              size="small"
              variant="outlined"
              label={statusMeta.label}
              color={statusMeta.color}
            />
            <Chip
              size="small"
              variant="outlined"
              label={`Confianza ${Math.round(Number(item.confidence || 0) * 100)}%`}
            />
          </Stack>

          <Typography variant="subtitle1" fontWeight={700}>
            {item.title || 'Sin título'}
          </Typography>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 0.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.content}
          </Typography>

          {Array.isArray(item.tags) && item.tags.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1.5 }}>
              {item.tags.map(tag => (
                <Chip key={tag} size="small" variant="outlined" label={tag} />
              ))}
            </Stack>
          )}
        </Box>

        <Stack spacing={1} sx={{ minWidth: 120 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon />}
            disabled={busy}
            onClick={() => onEdit(item)}
          >
            Editar
          </Button>
          {item.status === 'pending_approval' && (
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              disabled={busy}
              onClick={() => onApprove(item)}
            >
              Aprobar
            </Button>
          )}
          {item.status !== 'archived' && (
            <Tooltip title="Archivar (soft-delete)">
              <span>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<ArchiveIcon />}
                  disabled={busy}
                  onClick={() => onArchive(item)}
                  fullWidth
                >
                  Archivar
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Paper>
  )
}

const AiKnowledgeBasePage = () => {
  const [items, setItems] = useState([])
  const [counters, setCounters] = useState({})
  const [meta, setMeta] = useState({})
  const [status, setStatus] = useState('approved')
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

  const [formDialog, setFormDialog] = useState(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

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
      const result = await listKnowledge(params)
      setItems(Array.isArray(result.items) ? result.items : [])
      setMeta(result.meta || {})
      setCounters(result.meta?.counters || {})
    } catch (err) {
      console.error('[AI_KNOWLEDGE_ERROR]', err)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'No se pudo cargar la base de conocimiento.',
      )
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => {
    load()
  }, [load])

  const flash = (message, severity = 'success') => setSnackbar({ open: true, severity, message })

  const openCreateDialog = () => {
    setFormData(EMPTY_FORM)
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
    setFormDialog('edit')
  }

  const handleSave = useCallback(async () => {
    const title = clean(formData.title)
    const content = clean(formData.content)
    if (!title || !content) {
      flash('Título y contenido son obligatorios.', 'error')
      return
    }

    setSaving(true)
    try {
      const tags = formData.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
      const payload = {
        title,
        content,
        type: formData.type,
        tags,
        confidence: Number(formData.confidence) || 1,
      }

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
      flash(err?.response?.data?.message || err?.message || 'Error al guardar.', 'error')
    } finally {
      setSaving(false)
    }
  }, [formData, formDialog, load])

  const handleApprove = useCallback(
    async item => {
      const id = getId(item)
      setBusyId(id)
      try {
        await approveKnowledgeItem(id)
        flash('Conocimiento aprobado.')
        load()
      } catch (err) {
        flash(err?.response?.data?.message || err?.message || 'Error al aprobar.', 'error')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const handleArchive = useCallback(
    async item => {
      const id = getId(item)
      setBusyId(id)
      try {
        await deleteKnowledgeItem(id)
        flash('Conocimiento archivado.')
        load()
      } catch (err) {
        flash(err?.response?.data?.message || err?.message || 'Error al archivar.', 'error')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const statusLabel = key => {
    const opt = STATUS_OPTIONS.find(o => o.value === key)
    const count = counters[key]
    return opt ? `${opt.label}${count !== undefined ? ` (${count})` : ''}` : key
  }

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
            <MenuBookIcon color="primary" />
            <Typography variant="h4" fontWeight={800}>
              Base de conocimiento
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            FAQs, políticas, hints de producto y scripts que el agente usa para responder.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreateDialog}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            Nuevo
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} mb={3}>
        <TextField
          select
          size="small"
          label="Estado"
          value={status}
          onChange={e => setStatus(e.target.value)}
          sx={{ minWidth: 170 }}
        >
          {STATUS_OPTIONS.map(o => (
            <MenuItem key={o.value} value={o.value}>
              {statusLabel(o.value)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Tipo"
          value={type}
          onChange={e => setType(e.target.value)}
          sx={{ minWidth: 170 }}
        >
          {TYPE_OPTIONS.map(o => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Buscar"
          placeholder="Título, contenido o tag..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 200 }}
        />
      </Stack>

      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
          <Typography color="text.secondary">
            No se encontró conocimiento con estos filtros.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {items.map(item => (
            <KnowledgeCard
              key={getId(item)}
              item={item}
              busy={busyId === getId(item)}
              onEdit={openEditDialog}
              onApprove={handleApprove}
              onArchive={handleArchive}
            />
          ))}
          {meta.totalPages > 1 && (
            <Typography variant="caption" color="text.secondary" textAlign="center">
              Mostrando {items.length} de {meta.total} (página {meta.page} de {meta.totalPages})
            </Typography>
          )}
        </Stack>
      )}

      <Dialog
        open={formDialog !== null}
        onClose={() => !saving && setFormDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {formDialog === 'edit' ? 'Editar conocimiento' : 'Nuevo conocimiento'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Título"
              fullWidth
              value={formData.title}
              onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
              inputProps={{ maxLength: 200 }}
            />
            <TextField
              label="Contenido"
              fullWidth
              multiline
              minRows={3}
              maxRows={10}
              value={formData.content}
              onChange={e => setFormData(prev => ({ ...prev, content: e.target.value }))}
              inputProps={{ maxLength: 10000 }}
            />
            <TextField
              select
              label="Tipo"
              value={formData.type}
              onChange={e => setFormData(prev => ({ ...prev, type: e.target.value }))}
            >
              {Object.entries(TYPE_META).map(([value, meta]) => (
                <MenuItem key={value} value={value}>
                  {meta.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Tags (separados por coma)"
              fullWidth
              value={formData.tags}
              onChange={e => setFormData(prev => ({ ...prev, tags: e.target.value }))}
              placeholder="envío, devolución, talle"
            />
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
