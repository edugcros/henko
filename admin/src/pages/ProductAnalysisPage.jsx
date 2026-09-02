// 📁 src/pages/ProductAnalysisPage.jsx
//
// PROGRAMACIÓN DE IMÁGENES PARA ADDPRODUCT
//
// Rol único de esta pantalla:
// 1. Poner imágenes en cola (ahora o a una hora determinada)
// 2. Administrar esa cola (editar programación, cancelar, ver status)
// 3. NUNCA analiza con IA ni crea productos — eso es SOLO AddProduct
//
// FLUJO DE VIDA:
//   [Upload] → pending/scheduled → [Admin abre AddProduct]
//   → imported → processing → completed → approved/rejected
//
// CICLO DE VIDA DETALLADO:
//   • pending: Imagen en cola, lista para análisis. Backend espera a que
//     un admin abra AddProduct para disparar /product/analyze-visual
//   • scheduled: Imagen encolada para una hora futura. A esa hora, backend
//     cambia a 'pending' automáticamente.
//   • imported: Admin acaba de abrir AddProduct con esta imagen. Preparando
//     análisis IA en el frontend.
//   • processing: IA está analizando. Resultados aún no disponibles.
//   • completed: Análisis terminó. Datos listos. Esperando que el admin
//     apruebe o rechace en AddProduct.
//   • approved: Admin aprobó, producto creado. Finalizado exitosamente.
//   • rejected: Admin rechazó. Puede reintentar o descartar.
//   • failed: Error en análisis IA. Puede reintentar desde pending.
//
// API PÚBLICA PARA ADDPRODUCT:
//   • GET /product/analysis/{jobId} → obtiene job + análisis guardado
//   • POST /product/analyze-visual → crea/actualiza job + ejecuta IA
//   • PATCH /product/analysis/{jobId} → actualiza status (imported→processing)

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
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
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Bolt as BoltIcon,
  CloudUpload as CloudUploadIcon,
  Delete as DeleteIcon,
  Drafts as DraftsIcon,
  Edit as EditIcon,
  Event as EventIcon,
  ExpandMore as ExpandMoreIcon,
  Image as ImageIcon,
  PendingActions as PendingActionsIcon,
  PlayArrow as PlayArrowIcon,
  Publish as PublishIcon,
  RateReview as RateReviewIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Storefront as StorefrontIcon,
  UploadFile as UploadFileIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material'
import api from '@utils/axiosConfig'
import { formatDate, formatRelativeTime } from '@utils/dateFormat'
import { STATUS_META, STATUS_FILTER_OPTIONS } from '@constants/jobStatus'

// =====================================================
// CONSTANTES
// =====================================================

// STATUS_META y STATUS_FILTER_OPTIONS importados desde jobStatus.js
// Única fuente de verdad compartida con AddProduct
// Ver: src/constants/jobStatus.js

const SOURCE_LABEL = {
  'local-folder-agent': 'Agente local',
  'manual-upload': 'Carga manual',
  'api-import': 'API',
}

const VISIBILITY_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Solo activas' },
  { value: 'archived', label: 'Solo archivadas' },
]

const DEFAULT_LIMIT = 50
const AUTO_REFRESH_MS = 15000
const WATCHER_ONLINE_THRESHOLD_MS = 3 * 60 * 1000

// =====================================================
// HELPERS
// =====================================================

const normalizeString = value => String(value || '').trim()
const getJobId = job => String(job?._id || job?.id || '')
const getDraftId = product => String(product?._id || product?.id || '')
const safeArray = value => (Array.isArray(value) ? value : [])
const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

const isValidDate = value => {
  if (!value) return false
  return !Number.isNaN(new Date(value).getTime())
}

const toIsoOrNull = value => {
  if (!isValidDate(value)) return null
  return new Date(value).toISOString()
}

const toDatetimeLocalValue = date => {
  const offsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const uniqueList = values =>
  [...new Set(values.map(normalizeString).filter(Boolean))].sort((a, b) => a.localeCompare(b))

const getAnalysisTitle = job =>
  normalizeString(job?.analysis?.titulo) ||
  normalizeString(job?.analysis?.title) ||
  normalizeString(job?.originalFilename) ||
  'Imagen sin analizar'

const getAnalysisSubtitle = job => {
  const parts = [
    job?.analysis?.categoria || job?.analysis?.category,
    job?.analysis?.subcategoria || job?.analysis?.subcategory,
    job?.analysis?.marca || job?.analysis?.brand,
  ]
    .map(normalizeString)
    .filter(Boolean)

  return parts.length ? parts.join(' · ') : 'Sin clasificar todavía'
}

const getImageUrl = job =>
  normalizeString(job?.imageUrl) ||
  normalizeString(job?.imageThumbUrl) ||
  normalizeString(job?.metadata?.originalUrl)

const getTenantDomain = job =>
  normalizeString(job?.tenantDomain) || normalizeString(job?.metadata?.tenantDomain)

const getSource = job => normalizeString(job?.source) || 'manual-upload'
const getSourceLabel = job => SOURCE_LABEL[getSource(job)] || getSource(job)
const getSourcePath = job => normalizeString(job?.metadata?.sourcePath)

const getHistoryTimestamp = job =>
  job?.approvedAt ||
  job?.rejectedAt ||
  job?.failedAt ||
  job?.processedAt ||
  job?.importedAt ||
  job?.updatedAt ||
  job?.createdAt

const getConfidenceColor = value => {
  const score = Number(value || 0)
  if (score >= 0.8) return 'success'
  if (score >= 0.6) return 'warning'
  return 'error'
}

const isDuplicateUploadError = error =>
  error?.response?.status === 409 &&
  error?.response?.data?.code === 'PRODUCT_ANALYSIS_DUPLICATE' &&
  Boolean(error?.response?.data?.job)

const formatCountdown = ms => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

// =====================================================
// COMPONENTES DE PRESENTACIÓN
// =====================================================

const StatCard = ({ label, value, color = 'text.primary', hint }) => (
  <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 3, minWidth: 0 }}>
    <Typography variant="h5" fontWeight={900} color={color} lineHeight={1.2}>
      {formatNumber(value)}
    </Typography>
    <Typography variant="caption" color="text.secondary" noWrap display="block">
      {label}
    </Typography>
    {hint && (
      <Typography variant="caption" color="text.disabled" noWrap display="block">
        {hint}
      </Typography>
    )}
  </Paper>
)

const JobImage = ({ job, size = 88 }) => {
  const url = getImageUrl(job)

  return (
    <Avatar
      src={url || undefined}
      alt={getAnalysisTitle(job)}
      variant="rounded"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        bgcolor: 'grey.100',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <ImageIcon color="disabled" />
    </Avatar>
  )
}

const ConfidenceMeter = ({ value }) => {
  const score = Number(value || 0)
  const percent = Math.round(Math.min(Math.max(score, 0), 1) * 100)

  return (
    <Box sx={{ minWidth: 140 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary">
          Confianza IA
        </Typography>
        <Typography variant="caption" fontWeight={800}>
          {percent}%
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={percent}
        color={getConfidenceColor(score)}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  )
}

const CountdownChip = ({ scheduledAt, now }) => {
  if (!isValidDate(scheduledAt)) return null

  const diff = new Date(scheduledAt).getTime() - now
  const overdue = diff <= 0

  return (
    <Chip
      size="small"
      color={overdue ? 'warning' : 'info'}
      variant="outlined"
      label={overdue ? 'Listo · esperando AddProduct' : `en ${formatCountdown(diff)}`}
    />
  )
}

const SectionHeader = ({ icon: Icon, title, count, hint }) => (
  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
    <Icon fontSize="small" color="action" />
    <Typography variant="subtitle1" fontWeight={800}>
      {title}
    </Typography>
    <Chip size="small" label={formatNumber(count)} />
    {hint && (
      <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
        {hint}
      </Typography>
    )}
  </Stack>
)

const DraftProductCard = ({
  product,
  onPublish,
  onEdit,
  onDiscard,
  publishing,
  discarding,
  selected,
  onToggleSelect,
}) => {
  const images = safeArray(product?.images)
  const mainImage = images.find(image => image?.isMain) || images[0]
  const variantCount = safeArray(product?.variants).length

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 3,
        borderColor: selected ? 'primary.main' : undefined,
        bgcolor: selected ? 'action.selected' : undefined,
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Checkbox
          checked={Boolean(selected)}
          onChange={() => onToggleSelect(product)}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, p: 0.5 }}
        />

        <Avatar
          src={normalizeString(mainImage?.url) || undefined}
          alt={product.title}
          variant="rounded"
          sx={{
            width: 80,
            height: 80,
            flexShrink: 0,
            bgcolor: 'grey.100',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <ImageIcon color="disabled" />
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="flex-start"
            flexWrap="wrap"
            gap={1}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={800} noWrap>
                {product.title || 'Sin título'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[product.categoria, product.subcategoria, product.marca]
                  .filter(Boolean)
                  .join(' · ') || 'Sin clasificar'}
              </Typography>
            </Box>

            <Typography variant="h6" fontWeight={900} color="primary.main">
              {new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: product.currency || 'ARS',
                maximumFractionDigits: 0,
              }).format(Number(product.price || 0))}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {variantCount > 0 && (
              <Chip
                size="small"
                color="secondary"
                variant="outlined"
                label={`${variantCount} variantes`}
              />
            )}
            {product.aiNeedsReview && (
              <Chip size="small" color="warning" variant="outlined" label="Requiere revisión" />
            )}
            <Chip
              size="small"
              variant="outlined"
              label={`Creado ${formatRelativeTime(product.createdAt)}`}
            />
          </Stack>

          {Number.isFinite(product.aiConfidence) && (
            <Box sx={{ mt: 1.5, maxWidth: 200 }}>
              <ConfidenceMeter value={product.aiConfidence} />
            </Box>
          )}
        </Box>

        <Stack
          direction={{ xs: 'row', sm: 'column' }}
          spacing={0.75}
          sx={{ flexShrink: 0, alignSelf: { xs: 'flex-end', sm: 'center' } }}
        >
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={
              publishing ? <CircularProgress size={14} color="inherit" /> : <PublishIcon />
            }
            onClick={() => onPublish(product)}
            disabled={publishing || discarding}
          >
            Publicar
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon />}
            onClick={() => onEdit(product)}
            disabled={publishing || discarding}
          >
            Editar
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={discarding ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />}
            onClick={() => onDiscard(product)}
            disabled={publishing || discarding}
          >
            Descartar
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

// =====================================================
// PÁGINA
// =====================================================

const ProductAnalysisPage = () => {
  const navigate = useNavigate()

  // Cola
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  // Filtros
  const [status, setStatus] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [visibility, setVisibility] = useState('all')

  // Programación / carga
  const [scheduledAt, setScheduledAt] = useState('')
  const [autoSaveInAddProduct, setAutoSaveInAddProduct] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFiles, setBulkFiles] = useState([])
  const [bulkUploading, setBulkUploading] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)

  // Acciones sobre un job
  const [runningJobId, setRunningJobId] = useState(null)
  const [rescheduleJob, setRescheduleJob] = useState(null)
  const [rescheduleValue, setRescheduleValue] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [deleteJob, setDeleteJob] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [sweeping, setSweeping] = useState(false)

  // Estado del sistema
  const [agentStatus, setAgentStatus] = useState(null)
  const [agentHeartbeat, setAgentHeartbeat] = useState(null)
  const [aiUsage, setAiUsage] = useState(null)

  // Borradores generados (salida del pipeline)
  const [drafts, setDrafts] = useState([])
  const [draftsTotal, setDraftsTotal] = useState(0)
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState(null)
  const [discardingDraftId, setDiscardingDraftId] = useState(null)
  const [publishingAll, setPublishingAll] = useState(false)
  const [selectedDraftIds, setSelectedDraftIds] = useState(() => new Set())
  const [draftCategoryFilter, setDraftCategoryFilter] = useState('')
  const [draftMinConfidence, setDraftMinConfidence] = useState(0)

  // ---------------------------------------------------
  // Datos derivados
  // ---------------------------------------------------

  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: DEFAULT_LIMIT,
      sort: '-createdAt',
      showHidden: String(visibility !== 'active'),
    }

    if (visibility === 'archived') params.onlyHidden = 'true'
    if (status) params.status = status
    if (search.trim()) params.search = search.trim()
    if (sourceFilter) params.source = sourceFilter

    return params
  }, [page, search, sourceFilter, status, visibility])

  const visibleJobs = useMemo(
    () => (sourceFilter ? jobs.filter(job => getSource(job) === sourceFilter) : jobs),
    [jobs, sourceFilter],
  )

  const currentTenantDomain = useMemo(() => {
    const [tenant] = uniqueList(jobs.map(getTenantDomain))
    return tenant || ''
  }, [jobs])

  const sourceOptions = useMemo(() => uniqueList(jobs.map(getSource)), [jobs])

  const queueJobs = useMemo(
    () =>
      visibleJobs
        .filter(job => ['pending', 'scheduled'].includes(job.status))
        .sort((a, b) => {
          const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Infinity
          const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Infinity
          if (aTime !== bTime) return aTime - bTime
          return new Date(a.createdAt) - new Date(b.createdAt)
        }),
    [visibleJobs],
  )

  const processingJobs = useMemo(
    () => visibleJobs.filter(job => ['processing', 'imported'].includes(job.status)),
    [visibleJobs],
  )

  const reviewJobs = useMemo(
    () =>
      visibleJobs
        .filter(job => job.status === 'completed' && !job.createdProductId)
        .sort((a, b) => (a.analysis?.confidence ?? 0) - (b.analysis?.confidence ?? 0)),
    [visibleJobs],
  )

  const historyJobs = useMemo(() => {
    const grouped = new Set([...queueJobs, ...processingJobs, ...reviewJobs].map(getJobId))
    return visibleJobs
      .filter(job => !grouped.has(getJobId(job)))
      .sort((a, b) => new Date(getHistoryTimestamp(b)) - new Date(getHistoryTimestamp(a)))
  }, [visibleJobs, queueJobs, processingJobs, reviewJobs])

  const failedCount = useMemo(
    () => visibleJobs.filter(job => job.status === 'failed').length,
    [visibleJobs],
  )

  const readyWaitingCount = useMemo(
    () => queueJobs.filter(job => job.status === 'pending').length,
    [queueJobs],
  )

  const hasCountdownTargets = useMemo(
    () => queueJobs.some(job => job.status === 'scheduled' && job.scheduledAt),
    [queueJobs],
  )

  const draftCategoryOptions = useMemo(
    () => uniqueList(drafts.map(product => product.categoria)),
    [drafts],
  )

  const filteredDrafts = useMemo(
    () =>
      drafts.filter(product => {
        if (draftCategoryFilter && product.categoria !== draftCategoryFilter) return false
        return (Number(product.aiConfidence) || 0) >= draftMinConfidence
      }),
    [drafts, draftCategoryFilter, draftMinConfidence],
  )

  const isWatcherOnline = useMemo(() => {
    if (!agentHeartbeat?.lastHeartbeatAt) return false
    const age = Date.now() - new Date(agentHeartbeat.lastHeartbeatAt).getTime()
    return age < WATCHER_ONLINE_THRESHOLD_MS
  }, [agentHeartbeat])

  // ---------------------------------------------------
  // Fetching
  // ---------------------------------------------------

  const fetchJobs = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)

      try {
        const { data } = await api.get('/product-analysis', {
          params: queryParams,
        })

        setJobs(Array.isArray(data?.items) ? data.items : [])
        setTotal(Number(data?.total) || 0)
        setTotalPages(Math.max(1, Number(data?.totalPages) || 1))
        setLastUpdatedAt(new Date())
      } catch (error) {
        if (!silent) {
          toast.error(error?.response?.data?.message || 'No se pudo cargar la cola')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [queryParams],
  )

  // Indicadores secundarios: fallan en silencio, no deben tapar la UI
  // principal con toasts si el endpoint se cae puntualmente.
  const fetchSystemStatus = useCallback(async () => {
    const [statusRes, heartbeatRes, usageRes] = await Promise.allSettled([
      api.get('/product-analysis/agent/status'),
      api.get('/product-analysis/agent-heartbeat'),
      api.get('/product-analysis/ai-usage'),
    ])

    if (statusRes.status === 'fulfilled') setAgentStatus(statusRes.value.data)
    if (heartbeatRes.status === 'fulfilled') {
      setAgentHeartbeat(heartbeatRes.value.data?.data || null)
    }
    if (usageRes.status === 'fulfilled') setAiUsage(usageRes.value.data?.data || null)
  }, [])

  const fetchDrafts = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setDraftsLoading(true)

    try {
      const { data } = await api.get('/product/admin/drafts', {
        params: { limit: 100 },
      })

      setDrafts(Array.isArray(data?.data) ? data.data : [])
      setDraftsTotal(Number(data?.meta?.total) || 0)
    } catch (error) {
      if (!silent) {
        toast.error(error?.response?.data?.message || 'No se pudieron cargar los borradores')
      }
    } finally {
      if (!silent) setDraftsLoading(false)
    }
  }, [])

  const refreshAll = useCallback(
    ({ silent = false } = {}) =>
      Promise.all([fetchJobs({ silent }), fetchSystemStatus(), fetchDrafts({ silent })]),
    [fetchJobs, fetchSystemStatus, fetchDrafts],
  )

  useEffect(() => {
    setPage(1)
  }, [status, search, sourceFilter, visibility])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    fetchSystemStatus()
    fetchDrafts()
  }, [fetchSystemStatus, fetchDrafts])

  useEffect(() => {
    const interval = setInterval(() => refreshAll({ silent: true }), AUTO_REFRESH_MS)
    return () => clearInterval(interval)
  }, [refreshAll])

  useEffect(() => {
    if (!hasCountdownTargets) return undefined
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [hasCountdownTargets])

  // ---------------------------------------------------
  // Acciones: encolar imágenes
  // ---------------------------------------------------

  const handleUpload = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (scheduledAt && !isValidDate(scheduledAt)) {
      toast.error('La fecha de programación no es válida')
      return
    }

    const scheduledIso = toIsoOrNull(scheduledAt)
    const form = new FormData()

    // Esta página solo encola. autoAnalyze siempre false: el análisis lo
    // dispara AddProduct, nunca el backend (el servidor además lo fuerza
    // para source=manual-upload, esto es la primera línea de defensa).
    form.append('image', file)
    form.append('source', 'manual-upload')
    form.append('originalFilename', file.name)
    form.append('autoAnalyze', 'false')
    form.append('autoCreateProduct', 'false')
    form.append('autoSaveProduct', String(autoSaveInAddProduct))
    form.append('autoPublishProduct', 'false')

    if (scheduledIso) form.append('scheduledAt', scheduledIso)

    setUploading(true)

    try {
      await api.post('/product-analysis/import', form, { isMultipart: true })

      toast.success(
        scheduledIso
          ? 'Imagen programada para AddProduct'
          : 'Imagen enviada a la bandeja de AddProduct',
      )

      await fetchJobs()
    } catch (error) {
      if (isDuplicateUploadError(error)) {
        toast.info('La imagen ya estaba en la cola.')
        setVisibility('all')
        await fetchJobs()
        return
      }

      toast.error(error?.response?.data?.message || 'No se pudo importar la imagen')
    } finally {
      setUploading(false)
    }
  }

  const handleBulkFilesSelected = event => {
    setBulkFiles(Array.from(event.target.files || []))
    setBulkResult(null)
    event.target.value = ''
  }

  const closeBulkDialog = () => {
    if (bulkUploading) return
    setBulkOpen(false)
    setBulkFiles([])
    setBulkResult(null)
  }

  const submitBulkUpload = async () => {
    if (!bulkFiles.length) return

    const form = new FormData()
    bulkFiles.forEach(file => form.append('images', file))

    setBulkUploading(true)

    try {
      const { data } = await api.post('/product-analysis/bulk-import', form, {
        isMultipart: true,
      })

      setBulkResult(data)
      setBulkFiles([])
      toast.success(data?.message || `${data?.imported || 0} imágenes en cola`)

      await refreshAll()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo completar la carga masiva')
    } finally {
      setBulkUploading(false)
    }
  }

  // ---------------------------------------------------
  // Acciones: administrar la cola
  // ---------------------------------------------------

  const handleSweep = async () => {
    setSweeping(true)

    try {
      await api.post('/product-analysis/process-due')
      await fetchJobs()
      toast.success('Barrido ejecutado: las imágenes vencidas quedaron listas')
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo ejecutar el barrido')
    } finally {
      setSweeping(false)
    }
  }

  const runJobNow = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    setRunningJobId(jobId)

    try {
      await api.post(`/product-analysis/${jobId}/run-now`)
      toast.success('Imagen liberada: ya está disponible en AddProduct')
      await fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo liberar la imagen')
    } finally {
      setRunningJobId(null)
    }
  }

  const retryJob = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    try {
      await api.post(`/product-analysis/${jobId}/retry`)
      toast.success('Imagen devuelta a la cola de AddProduct')
      await fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo reintentar')
    }
  }

  const openReschedule = job => {
    setRescheduleJob(job)
    setRescheduleValue(
      isValidDate(job?.scheduledAt)
        ? toDatetimeLocalValue(new Date(job.scheduledAt))
        : toDatetimeLocalValue(new Date(Date.now() + 3600000)),
    )
  }

  const submitReschedule = async () => {
    const jobId = getJobId(rescheduleJob)
    if (!jobId) return

    if (!isValidDate(rescheduleValue)) {
      toast.error('La fecha no es válida')
      return
    }

    setRescheduling(true)

    try {
      await api.patch(`/product-analysis/${jobId}/reschedule`, {
        scheduledAt: toIsoOrNull(rescheduleValue),
      })
      toast.success('Hora actualizada')
      setRescheduleJob(null)
      await fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo reprogramar')
    } finally {
      setRescheduling(false)
    }
  }

  const toggleHiddenJob = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    const action = job.isHidden ? 'unhide' : 'hide'

    try {
      await api.patch(`/product-analysis/${jobId}/${action}`)
      toast.success(job.isHidden ? 'Imagen restaurada' : 'Imagen archivada')
      await fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo actualizar')
    }
  }

  const confirmDeleteJob = async () => {
    const jobId = getJobId(deleteJob)
    if (!jobId) return

    setDeleting(true)

    try {
      await api.delete(`/product-analysis/${jobId}`)
      toast.success('Imagen eliminada de la cola')
      setDeleteJob(null)
      await fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo eliminar')
    } finally {
      setDeleting(false)
    }
  }

  // ---------------------------------------------------
  // Acciones: borradores generados
  // ---------------------------------------------------

  const forgetDraft = productId => {
    setDrafts(current => current.filter(item => getDraftId(item) !== productId))
    setDraftsTotal(current => Math.max(0, current - 1))
    setSelectedDraftIds(current => {
      if (!current.has(productId)) return current
      const next = new Set(current)
      next.delete(productId)
      return next
    })
  }

  const publishDraft = async product => {
    const productId = getDraftId(product)
    if (!productId) return

    setPublishingDraftId(productId)

    try {
      await api.put(`/product/${productId}`, {
        status: 'active',
        visibility: 'visible',
      })
      toast.success(`Publicado: ${product.title || 'producto'}`)
      forgetDraft(productId)
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo publicar')
    } finally {
      setPublishingDraftId(null)
    }
  }

  // Una sola consulta (updateMany en el backend) en vez de N requests
  // secuenciales — con cientos de borradores eso tardaba minutos.
  const publishSelectedDrafts = async () => {
    const productIds = [...selectedDraftIds]
    if (!productIds.length) return

    setPublishingAll(true)

    try {
      const { data } = await api.put('/product/admin/drafts/bulk-publish', {
        productIds,
      })

      toast.success(data?.message || `${data?.published || 0} productos publicados`)

      const publishedSet = new Set(productIds)
      setDrafts(current => current.filter(item => !publishedSet.has(getDraftId(item))))
      setDraftsTotal(current => Math.max(0, current - productIds.length))
      setSelectedDraftIds(new Set())
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo publicar la selección')
    } finally {
      setPublishingAll(false)
    }
  }

  const discardDraft = async product => {
    const productId = getDraftId(product)
    if (!productId) return

    setDiscardingDraftId(productId)

    try {
      await api.delete(`/product/${productId}`)
      toast.success('Borrador descartado')
      forgetDraft(productId)
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo descartar')
    } finally {
      setDiscardingDraftId(null)
    }
  }

  const toggleDraftSelection = useCallback(product => {
    const id = getDraftId(product)
    if (!id) return
    setSelectedDraftIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const clearFilters = () => {
    setStatus('')
    setSearch('')
    setSourceFilter('')
    setVisibility('all')
    setPage(1)
  }

  // ---------------------------------------------------
  // Render de un job
  // ---------------------------------------------------

  const renderJobCard = job => {
    const jobId = getJobId(job)
    const meta = STATUS_META[job.status] || {
      label: job.status,
      color: 'default',
    }
    const sourcePath = getSourcePath(job)
    const isRunningNow = runningJobId === jobId

    const canRunNow = ['scheduled', 'pending'].includes(job.status)
    const canReschedule = job.status === 'scheduled'
    const canRetry = ['failed', 'completed', 'pending'].includes(job.status)

    return (
      <Paper key={jobId} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <JobImage job={job} />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-start"
              flexWrap="wrap"
              gap={1}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={800} noWrap>
                  {getAnalysisTitle(job)}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {getAnalysisSubtitle(job)}
                </Typography>
              </Box>

              <Chip label={meta.label} color={meta.color} size="small" />
            </Stack>

            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip size="small" variant="outlined" label={getSourceLabel(job)} />

              {job.status === 'scheduled' && (
                <CountdownChip scheduledAt={job.scheduledAt} now={now} />
              )}

              {job.metadata?.autoSaveProduct && (
                <Tooltip title="Cuando AddProduct la analice, va a crear el producto automáticamente y dejarlo en su cola de revisión para que lo apruebes.">
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    icon={<BoltIcon />}
                    label="Autoguardado"
                  />
                </Tooltip>
              )}

              {job.createdProductId && (
                <Chip size="small" color="primary" variant="outlined" label="Producto creado" />
              )}

              {job.isHidden && (
                <Chip size="small" color="warning" variant="outlined" label="Archivado" />
              )}
            </Stack>

            {job.status === 'processing' && (
              <Box sx={{ mt: 1.5, maxWidth: 260 }}>
                <Typography variant="caption" color="text.secondary">
                  AddProduct está analizando la imagen...
                </Typography>
                <LinearProgress sx={{ height: 5, borderRadius: 3, mt: 0.5 }} />
              </Box>
            )}

            {job.status === 'completed' && Number.isFinite(job.analysis?.confidence) && (
              <Box sx={{ mt: 1.5, maxWidth: 200 }}>
                <ConfidenceMeter value={job.analysis?.confidence} />
              </Box>
            )}

            <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Creado {formatRelativeTime(job.createdAt)}
              </Typography>
              {job.scheduledAt && (
                <Typography variant="caption" color="text.secondary">
                  Programado: {formatDate(job.scheduledAt)}
                </Typography>
              )}
              {sourcePath && (
                <Tooltip title={sourcePath}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ maxWidth: 240 }}
                  >
                    {sourcePath}
                  </Typography>
                </Tooltip>
              )}
            </Stack>

            {job.error?.message && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {job.error.message}
              </Alert>
            )}
          </Box>

          <Stack
            direction={{ xs: 'row', sm: 'column' }}
            spacing={0.25}
            sx={{
              flexShrink: 0,
              alignSelf: { xs: 'flex-end', sm: 'flex-start' },
            }}
          >
            <Tooltip title="Liberar ahora (no esperar la hora)">
              <span>
                <IconButton
                  color="secondary"
                  onClick={() => runJobNow(job)}
                  disabled={!canRunNow || isRunningNow}
                >
                  {isRunningNow ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Reprogramar hora">
              <span>
                <IconButton onClick={() => openReschedule(job)} disabled={!canReschedule}>
                  <EventIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Devolver a la cola de AddProduct">
              <span>
                <IconButton onClick={() => retryJob(job)} disabled={!canRetry}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title={job.isHidden ? 'Restaurar' : 'Archivar'}>
              <span>
                <IconButton
                  color={job.isHidden ? 'primary' : 'default'}
                  onClick={() => toggleHiddenJob(job)}
                >
                  {job.isHidden ? <VisibilityIcon /> : <VisibilityOffIcon />}
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Eliminar de la cola">
              <span>
                <IconButton color="error" onClick={() => setDeleteJob(job)}>
                  <DeleteIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>
    )
  }

  const renderSection = ({ icon, title, hint, items, emptyText, extra }) => (
    <Box>
      <SectionHeader icon={icon} title={title} count={items.length} hint={hint} />
      {extra}
      {items.length > 0 ? (
        <Stack spacing={1.5}>{items.map(renderJobCard)}</Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      )}
    </Box>
  )

  const schedulerEnabled = agentStatus?.agent?.enabled !== false

  // ---------------------------------------------------

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* ENCABEZADO */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 3 },
          mb: 3,
          borderRadius: 4,
          background: theme =>
            `linear-gradient(135deg, ${theme.palette.primary.main}0A, transparent 60%)`,
        }}
      >
        <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" gap={2}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Typography variant="h5" fontWeight={900}>
                Programación de imágenes
              </Typography>
              {currentTenantDomain && (
                <Chip
                  size="small"
                  icon={<StorefrontIcon />}
                  label={currentTenantDomain}
                  color="primary"
                  variant="outlined"
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 640 }}>
              Poné imágenes en cola, ahora o a una hora determinada. Al cumplirse la hora quedan
              disponibles en <strong>AddProduct</strong>, que es quien las analiza con IA y arma el
              producto.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems="flex-start">
            <Button
              component="label"
              variant="contained"
              startIcon={uploading ? <CircularProgress size={18} /> : <CloudUploadIcon />}
              disabled={uploading}
            >
              {uploading ? 'Subiendo...' : scheduledAt ? 'Programar' : 'Subir imagen'}
              <input
                hidden
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                type="file"
                onChange={handleUpload}
              />
            </Button>

            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => setBulkOpen(true)}
            >
              Carga masiva
            </Button>

            <Tooltip title="Actualizar cola y estado">
              <span>
                <IconButton onClick={() => refreshAll()} disabled={loading}>
                  {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {/* OPCIONES DE ENCOLADO */}
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          gap={2}
          alignItems={{ md: 'center' }}
          sx={{ mt: 2.5 }}
        >
          <TextField
            size="small"
            type="datetime-local"
            label="Programar disponibilidad"
            value={scheduledAt}
            onChange={event => setScheduledAt(event.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 240 }}
            helperText={
              scheduledAt
                ? 'La próxima imagen que subas usará esta hora'
                : 'Vacío = disponible de inmediato'
            }
          />

          <Tooltip title="Cuando AddProduct la analice, crea el producto solo y lo deja en su cola de revisión, en vez de esperar a que completes el formulario a mano.">
            <Button
              size="small"
              variant={autoSaveInAddProduct ? 'contained' : 'outlined'}
              color={autoSaveInAddProduct ? 'primary' : 'inherit'}
              startIcon={<BoltIcon />}
              onClick={() => setAutoSaveInAddProduct(current => !current)}
            >
              Autoguardar en AddProduct
            </Button>
          </Tooltip>

          {lastUpdatedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: { md: 'auto' } }}>
              Actualizado {formatRelativeTime(lastUpdatedAt)}
            </Typography>
          )}
        </Stack>
      </Paper>

      {/* ESTADO DEL SISTEMA */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ md: 'center' }}
          gap={2}
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={schedulerEnabled ? 'success' : 'default'}
              variant={schedulerEnabled ? 'filled' : 'outlined'}
              label={schedulerEnabled ? 'Barrido automático activo' : 'Barrido pausado'}
            />

            <Tooltip
              title={
                agentHeartbeat
                  ? `${agentHeartbeat.hostname || 'PC del local'} · pendientes: ${agentHeartbeat.queue?.pending ?? 0}`
                  : 'El watcher local todavía no envió señal.'
              }
            >
              <Chip
                size="small"
                variant={isWatcherOnline ? 'filled' : 'outlined'}
                color={isWatcherOnline ? 'success' : 'default'}
                label={
                  isWatcherOnline
                    ? `Watcher conectado (${formatRelativeTime(agentHeartbeat.lastHeartbeatAt)})`
                    : 'Watcher sin conexión'
                }
              />
            </Tooltip>

            {aiUsage && (
              <Tooltip title={`Plan ${aiUsage.plan}. Se renueva el 1° de cada mes.`}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={
                    aiUsage.unlimited
                      ? 'default'
                      : aiUsage.used >= aiUsage.limit
                        ? 'error'
                        : aiUsage.used / aiUsage.limit >= 0.7
                          ? 'warning'
                          : 'default'
                  }
                  label={
                    aiUsage.unlimited
                      ? `Uso IA: ${formatNumber(aiUsage.used)}`
                      : `Uso IA: ${formatNumber(aiUsage.used)}/${formatNumber(aiUsage.limit)}`
                  }
                />
              </Tooltip>
            )}
          </Stack>

          <Button
            size="small"
            variant="outlined"
            startIcon={sweeping ? <CircularProgress size={16} /> : <PlayArrowIcon />}
            onClick={handleSweep}
            disabled={sweeping}
          >
            {sweeping ? 'Ejecutando...' : 'Liberar vencidas ahora'}
          </Button>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr 1fr',
              md: 'repeat(4, minmax(0, 1fr))',
            },
            gap: 1.5,
            mt: 2,
          }}
        >
          <StatCard label="En cola" value={queueJobs.length} />
          <StatCard
            label="Listas para AddProduct"
            value={readyWaitingCount}
            color={readyWaitingCount > 0 ? 'warning.main' : 'text.primary'}
          />
          <StatCard label="Para revisar" value={reviewJobs.length} color="info.main" />
          <StatCard
            label="Fallidas"
            value={failedCount}
            color={failedCount > 0 ? 'error.main' : 'text.primary'}
          />
        </Box>
      </Paper>

      {/* FILTROS */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'minmax(220px, 1fr) 180px 180px 160px auto',
            },
            gap: 1.5,
            alignItems: 'center',
          }}
        >
          <TextField
            fullWidth
            size="small"
            label="Buscar"
            value={search}
            onChange={event => setSearch(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />

          <FormControl fullWidth size="small">
            <InputLabel>Estado</InputLabel>
            <Select label="Estado" value={status} onChange={event => setStatus(event.target.value)}>
              {STATUS_FILTER_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Origen</InputLabel>
            <Select
              label="Origen"
              value={sourceFilter}
              onChange={event => setSourceFilter(event.target.value)}
            >
              <MenuItem value="">Todos</MenuItem>
              {sourceOptions.map(source => (
                <MenuItem key={source} value={source}>
                  {SOURCE_LABEL[source] || source}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Visibilidad</InputLabel>
            <Select
              label="Visibilidad"
              value={visibility}
              onChange={event => setVisibility(event.target.value)}
            >
              {VISIBILITY_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Button size="small" onClick={clearFilters}>
            Limpiar
          </Button>
        </Box>
      </Paper>

      {/* PIPELINE */}
      <Stack spacing={3}>
        {renderSection({
          icon: PendingActionsIcon,
          title: 'En cola',
          hint: 'esperando su hora, o ya listas para AddProduct',
          items: queueJobs,
          emptyText: 'No hay imágenes en cola.',
          extra: readyWaitingCount > 0 && (
            <Alert severity="info" sx={{ mb: 1.5, borderRadius: 2 }}>
              Hay {readyWaitingCount} imagen
              {readyWaitingCount === 1 ? '' : 'es'} lista
              {readyWaitingCount === 1 ? '' : 's'}. El análisis lo hace <strong>AddProduct</strong>:
              abrí esa pantalla (con "Auto activo" para que las cargue sola) o no van a avanzar
              desde acá.
            </Alert>
          ),
        })}

        {processingJobs.length > 0 &&
          renderSection({
            icon: RefreshIcon,
            title: 'En AddProduct',
            hint: 'cargadas o analizándose ahora mismo',
            items: processingJobs,
            emptyText: '',
          })}

        {renderSection({
          icon: RateReviewIcon,
          title: 'Para revisar',
          hint: 'analizadas, todavía sin producto creado',
          items: reviewJobs,
          emptyText: 'No hay imágenes esperando revisión.',
        })}

        <Accordion variant="outlined" sx={{ borderRadius: 3, '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <SectionHeader
              icon={EventIcon}
              title="Historial"
              count={historyJobs.length}
              hint="aprobadas, rechazadas y fallidas"
            />
          </AccordionSummary>
          <AccordionDetails>
            {historyJobs.length > 0 ? (
              <Stack spacing={1.5}>{historyJobs.map(renderJobCard)}</Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Todavía no hay historial.
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>
      </Stack>

      {totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_event, value) => setPage(value)}
            color="primary"
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {formatNumber(total)} imágenes en total
          </Typography>
        </Stack>
      )}

      {/* BORRADORES GENERADOS */}
      <Divider sx={{ my: 4 }} />

      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          borderRadius: 3,
          borderColor: drafts.length > 0 ? 'warning.main' : 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          gap={1.5}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <DraftsIcon fontSize="small" color={drafts.length > 0 ? 'warning' : 'action'} />
            <Typography variant="subtitle1" fontWeight={800}>
              Borradores listos para publicar
            </Typography>
            <Chip size="small" label={formatNumber(draftsTotal)} />
            {draftsLoading && <CircularProgress size={14} />}
          </Stack>

          {selectedDraftIds.size > 0 && (
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={
                publishingAll ? <CircularProgress size={16} color="inherit" /> : <PublishIcon />
              }
              onClick={publishSelectedDrafts}
              disabled={publishingAll || Boolean(publishingDraftId)}
            >
              Publicar seleccionados ({selectedDraftIds.size})
            </Button>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Productos que AddProduct ya creó y todavía no salieron a la tienda.
        </Typography>

        {drafts.length > 0 && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ sm: 'center' }}
            sx={{ mt: 2 }}
          >
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Categoría</InputLabel>
              <Select
                label="Categoría"
                value={draftCategoryFilter}
                onChange={event => setDraftCategoryFilter(event.target.value)}
              >
                <MenuItem value="">Todas</MenuItem>
                {draftCategoryOptions.map(category => (
                  <MenuItem key={category} value={category}>
                    {category}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Confianza mínima</InputLabel>
              <Select
                label="Confianza mínima"
                value={draftMinConfidence}
                onChange={event => setDraftMinConfidence(Number(event.target.value))}
              >
                <MenuItem value={0}>Cualquiera</MenuItem>
                <MenuItem value={0.5}>50% o más</MenuItem>
                <MenuItem value={0.7}>70% o más</MenuItem>
                <MenuItem value={0.9}>90% o más</MenuItem>
              </Select>
            </FormControl>

            <Button
              size="small"
              onClick={() =>
                setSelectedDraftIds(new Set(filteredDrafts.map(getDraftId).filter(Boolean)))
              }
            >
              Seleccionar {filteredDrafts.length}
            </Button>

            {selectedDraftIds.size > 0 && (
              <Button size="small" onClick={() => setSelectedDraftIds(new Set())}>
                Deseleccionar
              </Button>
            )}
          </Stack>
        )}

        <Box sx={{ mt: 2 }}>
          {filteredDrafts.length > 0 ? (
            <Stack spacing={1.5}>
              {filteredDrafts.map(product => (
                <DraftProductCard
                  key={getDraftId(product)}
                  product={product}
                  onPublish={publishDraft}
                  onEdit={item => navigate(`/admin/edit-product/${getDraftId(item)}`)}
                  onDiscard={discardDraft}
                  publishing={publishingDraftId === getDraftId(product) || publishingAll}
                  discarding={discardingDraftId === getDraftId(product)}
                  selected={selectedDraftIds.has(getDraftId(product))}
                  onToggleSelect={toggleDraftSelection}
                />
              ))}
            </Stack>
          ) : (
            !draftsLoading && (
              <Typography variant="body2" color="text.secondary">
                {drafts.length > 0
                  ? 'Ningún borrador coincide con los filtros.'
                  : 'No hay borradores pendientes.'}
              </Typography>
            )
          )}
        </Box>
      </Paper>

      {/* DIÁLOGO: CARGA MASIVA */}
      <Dialog open={bulkOpen} onClose={closeBulkDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Carga masiva de imágenes</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Esta página solo las pone en cola — el análisis siempre lo hace{' '}
            <strong>AddProduct</strong>. Con "Auto activo" prendido ahí, las procesa en bloque y las
            deja esperando tu aprobación; nunca se publican solas.
          </Alert>

          <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
            Elegir imágenes
            <input
              hidden
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              type="file"
              onChange={handleBulkFilesSelected}
            />
          </Button>

          {bulkFiles.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {bulkFiles.length} imágenes seleccionadas
              </Typography>
              <Stack spacing={0.5} sx={{ maxHeight: 220, overflowY: 'auto' }}>
                {bulkFiles.map((file, index) => (
                  <Stack
                    key={`${file.name}-${index}`}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{
                      px: 1,
                      py: 0.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                    }}
                  >
                    <Typography variant="caption" noWrap sx={{ maxWidth: '85%' }}>
                      {file.name}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() =>
                        setBulkFiles(current => current.filter((_f, i) => i !== index))
                      }
                      disabled={bulkUploading}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}

          {bulkResult && (
            <Alert severity={bulkResult.failed > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
              {bulkResult.imported} en cola · {bulkResult.duplicates} duplicadas
              {bulkResult.failed > 0 ? ` · ${bulkResult.failed} fallidas` : ''}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeBulkDialog} disabled={bulkUploading}>
            Cerrar
          </Button>
          <Button
            variant="contained"
            onClick={submitBulkUpload}
            disabled={!bulkFiles.length || bulkUploading}
            startIcon={bulkUploading ? <CircularProgress size={16} /> : null}
          >
            {bulkUploading ? 'Subiendo...' : `Subir ${bulkFiles.length || ''}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIÁLOGO: REPROGRAMAR */}
      <Dialog
        open={Boolean(rescheduleJob)}
        onClose={() => !rescheduling && setRescheduleJob(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Reprogramar imagen</DialogTitle>
        <DialogContent>
          {rescheduleJob && (
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <JobImage job={rescheduleJob} size={56} />
              <Typography variant="body2" fontWeight={700} noWrap>
                {getAnalysisTitle(rescheduleJob)}
              </Typography>
            </Stack>
          )}

          <TextField
            fullWidth
            size="small"
            type="datetime-local"
            label="Nueva hora"
            value={rescheduleValue}
            onChange={event => setRescheduleValue(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRescheduleJob(null)} disabled={rescheduling}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={submitReschedule} disabled={rescheduling}>
            {rescheduling ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* DIÁLOGO: ELIMINAR */}
      <Dialog
        open={Boolean(deleteJob)}
        onClose={() => !deleting && setDeleteJob(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Eliminar de la cola</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Se va a eliminar <strong>{getAnalysisTitle(deleteJob)}</strong> y su imagen. Esta acción
            no se puede deshacer.
          </Typography>
          {deleteJob?.createdProductId && (
            <Alert severity="info" sx={{ mt: 2 }}>
              El producto ya creado a partir de esta imagen no se elimina.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteJob(null)} disabled={deleting}>
            Cancelar
          </Button>
          <Button color="error" variant="contained" onClick={confirmDeleteJob} disabled={deleting}>
            {deleting ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ProductAnalysisPage
