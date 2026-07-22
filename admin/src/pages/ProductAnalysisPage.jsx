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
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  AccessTime as AccessTimeIcon,
  Autorenew as AutorenewIcon,
  Bolt as BoltIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckCircleIcon,
  CloudUpload as CloudUploadIcon,
  Delete as DeleteIcon,
  Drafts as DraftsIcon,
  Edit as EditIcon,
  Event as EventIcon,
  ExpandMore as ExpandMoreIcon,
  Folder as FolderIcon,
  History as HistoryIcon,
  Hub as HubIcon,
  Image as ImageIcon,
  PendingActions as PendingActionsIcon,
  PlayArrow as PlayArrowIcon,
  Publish as PublishIcon,
  RateReview as RateReviewIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Storefront as StorefrontIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material'
import api from '@utils/axiosConfig'

// =====================================================
// CONSTANTES
// =====================================================

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'scheduled', label: 'Programado' },
  { value: 'imported', label: 'En AddProduct' },
  { value: 'processing', label: 'Procesando' },
  { value: 'completed', label: 'Completado' },
  { value: 'failed', label: 'Fallido' },
  { value: 'approved', label: 'Aprobado' },
  { value: 'rejected', label: 'Rechazado' },
]

const SOURCE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'local-folder-agent', label: 'Agente local' },
  { value: 'manual-upload', label: 'Carga manual' },
  { value: 'folder-domain', label: 'Folder domain' },
]

const STATUS_COLOR = {
  pending: 'default',
  scheduled: 'secondary',
  imported: 'primary',
  processing: 'info',
  completed: 'success',
  failed: 'error',
  approved: 'primary',
  rejected: 'warning',
}

const STATUS_LABEL = STATUS_OPTIONS.reduce((acc, item) => {
  if (item.value) acc[item.value] = item.label
  return acc
}, {})

const SOURCE_LABEL = SOURCE_OPTIONS.reduce((acc, item) => {
  if (item.value) acc[item.value] = item.label
  return acc
}, {})

const DEFAULT_LIMIT = 50
const AUTO_REFRESH_MS = 15000

// =====================================================
// HELPERS
// =====================================================

const normalizeString = value => String(value || '').trim()
const getJobId = job => String(job?._id || job?.id || '')
const safeArray = value => (Array.isArray(value) ? value : [])

const isValidDate = value => {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime())
}

const toIsoOrNull = value => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const toDatetimeLocalValue = date => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDate = value => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

const formatRelativeTime = value => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (diffSeconds < 45) return 'hace un momento'

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) return `hace ${diffMinutes} min`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `hace ${diffHours} h`

  const diffDays = Math.round(diffHours / 24)
  return `hace ${diffDays} d`
}

const formatDuration = ms => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

const formatNumber = value => Number(value || 0).toLocaleString('es-AR')

const normalizeNumberOrUndefined = value => {
  if (value === '' || value === null || value === undefined) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

const normalizeNumberOrZero = value => {
  if (value === '' || value === null || value === undefined) return 0
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

const uniqueList = values => {
  return [...new Set(values.map(normalizeString).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  )
}

const getAnalysisTitle = job => {
  return (
    normalizeString(job?.analysis?.titulo) ||
    normalizeString(job?.analysis?.title) ||
    normalizeString(job?.analysis?.name) ||
    normalizeString(job?.originalFilename) ||
    'Sin título'
  )
}

const getAnalysisCategoryLine = job => {
  return (
    [
      job?.analysis?.categoria || job?.analysis?.category,
      job?.analysis?.subcategoria || job?.analysis?.subcategory,
      job?.analysis?.marca || job?.analysis?.brand,
    ]
      .map(normalizeString)
      .filter(Boolean)
      .join(' / ') ||
    normalizeString(job?.originalFilename) ||
    '-'
  )
}

const getImageUrl = job => {
  return (
    normalizeString(job?.imageUrl) ||
    normalizeString(job?.image?.url) ||
    normalizeString(job?.image?.secure_url) ||
    normalizeString(job?.image?.src) ||
    normalizeString(job?.metadata?.imageUrl) ||
    normalizeString(job?.metadata?.secureUrl) ||
    normalizeString(job?.metadata?.thumbnail) ||
    ''
  )
}

const getTenantDomain = job => {
  return (
    normalizeString(job?.tenantDomain) ||
    normalizeString(job?.metadata?.tenantDomain) ||
    normalizeString(job?.metadata?.resolvedTenantDomain) ||
    normalizeString(job?.metadata?.folderTenantDomain) ||
    normalizeString(job?.tenant?.domain) ||
    normalizeString(job?.tenant?.shopDomain) ||
    normalizeString(job?.tenantId) ||
    'Tenant no informado'
  )
}

const getSource = job => {
  return (
    normalizeString(job?.source) ||
    normalizeString(job?.metadata?.source) ||
    normalizeString(job?.metadata?.agentSource) ||
    'unknown'
  )
}

const getSourceLabel = job => {
  const source = getSource(job)
  if (job?.metadata?.tenantResolutionMode === 'folder-domain')
    return 'Agente · folder-domain'
  return SOURCE_LABEL[source] || source || 'Origen no informado'
}

const getSourcePath = job => {
  return (
    normalizeString(job?.sourcePath) ||
    normalizeString(job?.metadata?.sourcePath) ||
    normalizeString(job?.metadata?.relativePath) ||
    normalizeString(job?.metadata?.watchFolder) ||
    ''
  )
}

const getAgentMode = job => {
  if (job?.metadata?.tenantResolutionMode)
    return job.metadata.tenantResolutionMode
  if (getSource(job) === 'local-folder-agent') return 'agent'
  if (getSource(job) === 'manual-upload') return 'manual'
  return 'unknown'
}

const getMetricColor = color => {
  return color && color !== 'default' ? `${color}.main` : 'text.primary'
}

const getConfidenceColor = value => {
  if (value >= 0.85) return 'success'
  if (value >= 0.6) return 'warning'
  return 'error'
}

const getHistoryTimestamp = job => {
  return (
    job.approvedAt ||
    job.rejectedAt ||
    job.failedAt ||
    job.importedAt ||
    job.processedAt ||
    job.updatedAt ||
    job.createdAt
  )
}

const isDuplicateUploadError = error => {
  return (
    error?.response?.status === 409 &&
    error?.response?.data?.code === 'PRODUCT_ANALYSIS_DUPLICATE' &&
    error?.response?.data?.job
  )
}

const matchesClientFilters = ({ job, sourceFilter }) => {
  const source = getSource(job)
  const mode = getAgentMode(job)

  if (sourceFilter && source !== sourceFilter && mode !== sourceFilter)
    return false

  return true
}

const getDraftId = product => String(product?._id || product?.id || '')

const getDraftImageUrl = product => {
  const images = safeArray(product?.images)
  const main = images.find(image => image?.isMain) || images[0]
  return normalizeString(main?.url)
}

const getDraftVariantCount = product => {
  if (!product?.hasVariants) return 0
  return safeArray(product?.variants).filter(
    variant => variant?.isActive !== false,
  ).length
}

// =====================================================
// SUBCOMPONENTES
// =====================================================

const AgentPulseStyles = () => (
  <style>{`
    @keyframes henkoAgentPulseRing {
      0% { transform: scale(1); opacity: 0.55; }
      100% { transform: scale(2.8); opacity: 0; }
    }
  `}</style>
)

const AgentPulse = ({ active }) => (
  <Box sx={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        bgcolor: active ? 'success.main' : 'grey.500',
      }}
    />
    {active && (
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          bgcolor: 'success.main',
          animation: 'henkoAgentPulseRing 1.8s ease-out infinite',
        }}
      />
    )}
  </Box>
)

const MetricCard = ({
  label,
  value,
  color = 'default',
  icon: Icon = HubIcon,
  description,
}) => (
  <Paper variant="outlined" sx={{ p: 1.75, height: '100%', borderRadius: 2.5 }}>
    <Stack
      direction="row"
      spacing={1.25}
      justifyContent="space-between"
      alignItems="flex-start"
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={800}>
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={900} color={getMetricColor(color)}>
          {formatNumber(value)}
        </Typography>
        {description && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            noWrap
          >
            {description}
          </Typography>
        )}
      </Box>
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: 2,
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon fontSize="small" />
      </Box>
    </Stack>
  </Paper>
)

const JobImage = ({ job, size = 72 }) => {
  const imageUrl = getImageUrl(job)
  const title = getAnalysisTitle(job)

  return (
    <Avatar
      src={imageUrl}
      alt={title}
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

const ConfidenceMeter = ({ value, dense = false }) => {
  const confidence = Number.isFinite(value) ? value : 0
  const pct = Math.round(Math.min(Math.max(confidence, 0), 1) * 100)

  return (
    <Box sx={{ minWidth: dense ? 90 : 140 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary">
          Confianza IA
        </Typography>
        <Typography variant="caption" fontWeight={800}>
          {pct}%
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={pct}
        color={getConfidenceColor(confidence)}
        sx={{ height: 6, borderRadius: 3 }}
      />
    </Box>
  )
}

const CountdownChip = ({ scheduledAt, now }) => {
  if (!scheduledAt) return null

  const target = new Date(scheduledAt).getTime()
  if (Number.isNaN(target)) return null

  const diff = target - now
  const overdue = diff <= 0

  return (
    <Chip
      size="small"
      icon={<AccessTimeIcon />}
      label={
        overdue ? 'Vencido · esperando al agente' : `en ${formatDuration(diff)}`
      }
      color={overdue ? 'warning' : 'secondary'}
      variant={overdue ? 'filled' : 'outlined'}
    />
  )
}

const DraftProductCard = ({
  product,
  onPublish,
  onEdit,
  onDiscard,
  publishing,
  discarding,
}) => {
  const variantCount = getDraftVariantCount(product)

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', sm: 'flex-start' }}
      >
        <Avatar
          src={getDraftImageUrl(product)}
          alt={product.title}
          variant="rounded"
          sx={{
            width: 96,
            height: 96,
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
                  .join(' / ')}
              </Typography>
            </Box>

            <Typography variant="h6" fontWeight={900} color="primary.main">
              {new Intl.NumberFormat('es-AR', {
                style: 'currency',
                currency: product.currency || 'ARS',
              }).format(Number(product.price || 0))}
            </Typography>
          </Stack>

          <Stack
            direction="row"
            spacing={0.75}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 1 }}
          >
            <Chip
              size="small"
              variant="outlined"
              label={
                product.aiAutomationMode === 'agent-autosave'
                  ? 'Analizado por AddProduct'
                  : 'Generado por IA'
              }
            />
            {variantCount > 0 && (
              <Chip
                size="small"
                color="secondary"
                variant="outlined"
                label={`${variantCount} variantes`}
              />
            )}
            {product.aiNeedsReview && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label="Requiere revisión"
              />
            )}
          </Stack>

          {Number.isFinite(product.aiConfidence) && (
            <Box sx={{ mt: 1.5, maxWidth: 220 }}>
              <ConfidenceMeter value={product.aiConfidence} dense />
            </Box>
          )}

          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 1 }}
          >
            Creado: {formatDate(product.createdAt)}
          </Typography>
        </Box>

        <Stack
          direction={{ xs: 'row', sm: 'column' }}
          spacing={0.75}
          sx={{
            flexShrink: 0,
            alignSelf: { xs: 'flex-end', sm: 'flex-start' },
          }}
        >
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={
              publishing ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <PublishIcon />
              )
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
            startIcon={
              discarding ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <DeleteIcon />
              )
            }
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

const SectionHeader = ({ icon: Icon, title, count, hint }) => (
  <Stack
    direction="row"
    spacing={1}
    alignItems="center"
    flexWrap="wrap"
    sx={{ mb: 1.5 }}
  >
    <Icon fontSize="small" color="action" />
    <Typography variant="subtitle1" fontWeight={800}>
      {title}
    </Typography>
    <Chip size="small" label={count} />
    {hint && (
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    )}
  </Stack>
)

const ACTIVITY_META = {
  approved: { label: 'Aprobado', color: 'success', icon: CheckCircleIcon },
  rejected: { label: 'Rechazado', color: 'warning', icon: CancelIcon },
  failed: { label: 'Falló el análisis', color: 'error', icon: AutorenewIcon },
  completed: {
    label: 'Análisis completado',
    color: 'info',
    icon: RateReviewIcon,
  },
}

const buildActivityFeed = jobs => {
  const events = []

  jobs.forEach(job => {
    if (job.approvedAt)
      events.push({ type: 'approved', job, at: job.approvedAt })
    if (job.rejectedAt)
      events.push({ type: 'rejected', job, at: job.rejectedAt })
    if (job.failedAt) events.push({ type: 'failed', job, at: job.failedAt })
    if (job.processedAt && job.status === 'completed') {
      events.push({ type: 'completed', job, at: job.processedAt })
    }
  })

  return events
    .filter(event => isValidDate(event.at))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 6)
}

const AgentStatusBar = ({
  agentStatus,
  agentStatusLoading,
  activity,
  onSweep,
  sweeping,
}) => {
  const enabled = agentStatus?.agent?.enabled !== false
  const pollSeconds = Math.round(
    (agentStatus?.agent?.pollIntervalMs || 0) / 1000,
  )
  const nextRun = agentStatus?.nextRun

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, md: 2.5 },
        mb: 3,
        borderRadius: 3,
        borderColor: enabled ? 'success.main' : 'divider',
        bgcolor: theme =>
          theme.palette.mode === 'dark'
            ? 'rgba(46,125,50,0.06)'
            : 'rgba(46,125,50,0.04)',
      }}
    >
      <AgentPulseStyles />
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        justifyContent="space-between"
        gap={2}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <AgentPulse active={enabled} />
          <Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
            >
              <BoltIcon
                fontSize="small"
                color={enabled ? 'success' : 'disabled'}
              />
              <Typography variant="subtitle1" fontWeight={900}>
                {enabled ? 'Agente IA activo' : 'Agente IA pausado'}
              </Typography>
              {agentStatusLoading && <CircularProgress size={14} />}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {enabled
                ? `Barre la cola cada ${pollSeconds || '?'}s y procesa cada imagen apenas se cumple su hora programada.`
                : 'El barrido automático está deshabilitado en el servidor. Usá "Ejecutar barrido" para procesar manualmente.'}
            </Typography>
          </Box>
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ sm: 'center' }}
        >
          {nextRun && (
            <Tooltip title={nextRun.originalFilename || ''}>
              <Chip
                size="small"
                variant="outlined"
                color="secondary"
                label={`Próxima ejecución: ${formatDate(nextRun.scheduledAt)}`}
              />
            </Tooltip>
          )}

          <Button
            size="small"
            variant="contained"
            startIcon={
              sweeping ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <PlayArrowIcon />
              )
            }
            onClick={onSweep}
            disabled={sweeping}
          >
            {sweeping ? 'Ejecutando barrido...' : 'Ejecutar barrido ahora'}
          </Button>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(5, minmax(0, 1fr))',
          },
          gap: 1,
          mt: 2,
        }}
      >
        {[
          { key: 'pending', label: 'Pendientes' },
          { key: 'scheduled', label: 'Programados' },
          { key: 'processing', label: 'Procesando' },
          { key: 'pendingReview', label: 'Para revisar' },
          { key: 'failed', label: 'Fallidos' },
        ].map(item => (
          <Paper
            key={item.key}
            variant="outlined"
            sx={{ px: 1.25, py: 0.75, borderRadius: 2, textAlign: 'center' }}
          >
            <Typography variant="h6" fontWeight={900} lineHeight={1.2}>
              {formatNumber(agentStatus?.queue?.[item.key] ?? 0)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {item.label}
            </Typography>
          </Paper>
        ))}
      </Box>

      {activity.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={800}>
            ACTIVIDAD RECIENTE
          </Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {activity.map((event, index) => {
              const meta = ACTIVITY_META[event.type]
              const Icon = meta?.icon || RateReviewIcon

              return (
                <Stack
                  key={`${getJobId(event.job)}-${event.type}-${index}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                >
                  <Icon
                    fontSize="inherit"
                    color={meta?.color || 'action'}
                    sx={{ fontSize: 16 }}
                  />
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{ maxWidth: { xs: 180, sm: 320 } }}
                  >
                    <strong>{meta?.label || event.type}</strong> ·{' '}
                    {getAnalysisTitle(event.job)}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ ml: 'auto' }}
                  >
                    {formatRelativeTime(event.at)}
                  </Typography>
                </Stack>
              )
            })}
          </Stack>
        </Box>
      )}
    </Paper>
  )
}

// =====================================================
// PÁGINA
// =====================================================

const ProductAnalysisPage = () => {
  const navigate = useNavigate()
  const [showHidden, setShowHidden] = useState(true)
  const [onlyHidden, setOnlyHidden] = useState(false)
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [search, setSearch] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [sendToAddProduct, setSendToAddProduct] = useState(true)
  const [autoSaveInAddProduct, setAutoSaveInAddProduct] = useState(false)
  const [autoPublishProduct, setAutoPublishProduct] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [approveOpen, setApproveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [approveForm, setApproveForm] = useState({})

  const [agentStatus, setAgentStatus] = useState(null)
  const [agentStatusLoading, setAgentStatusLoading] = useState(false)
  const [runningJobId, setRunningJobId] = useState(null)
  const [rescheduleJob, setRescheduleJob] = useState(null)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [rescheduleValue, setRescheduleValue] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const [drafts, setDrafts] = useState([])
  const [draftsTotal, setDraftsTotal] = useState(0)
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [publishingDraftId, setPublishingDraftId] = useState(null)
  const [discardingDraftId, setDiscardingDraftId] = useState(null)
  const [publishingAll, setPublishingAll] = useState(false)

  const queryParams = useMemo(() => {
    const params = {
      page,
      limit: DEFAULT_LIMIT,
      sort: '-createdAt',
      showHidden: String(showHidden || onlyHidden),
    }

    if (onlyHidden) params.onlyHidden = 'true'
    if (status) params.status = status
    if (search.trim()) params.search = search.trim()
    if (sourceFilter) params.source = sourceFilter

    return params
  }, [onlyHidden, page, search, showHidden, sourceFilter, status])

  const visibleJobs = useMemo(() => {
    return jobs.filter(job => matchesClientFilters({ job, sourceFilter }))
  }, [jobs, sourceFilter])

  const currentTenantDomain = useMemo(() => {
    const [tenant] = uniqueList(jobs.map(getTenantDomain))
    return tenant || ''
  }, [jobs])
  const sourceOptions = useMemo(() => uniqueList(jobs.map(getSource)), [jobs])

  const counters = useMemo(() => {
    return visibleJobs.reduce(
      (acc, job) => {
        const key = normalizeString(job.status) || 'unknown'
        const source = getSource(job)
        const mode = getAgentMode(job)

        return {
          ...acc,
          total: acc.total + 1,
          hidden: acc.hidden + (job.isHidden ? 1 : 0),
          agent: acc.agent + (source === 'local-folder-agent' ? 1 : 0),
          manual: acc.manual + (source === 'manual-upload' ? 1 : 0),
          folderDomain: acc.folderDomain + (mode === 'folder-domain' ? 1 : 0),
          [key]: (acc[key] || 0) + 1,
        }
      },
      { total: 0, hidden: 0, agent: 0, manual: 0, folderDomain: 0 },
    )
  }, [visibleJobs])

  const isGroupedView = !status

  const queueJobs = useMemo(() => {
    return visibleJobs
      .filter(job => ['pending', 'scheduled'].includes(job.status))
      .sort((a, b) => {
        const aTime = a.scheduledAt
          ? new Date(a.scheduledAt).getTime()
          : Infinity
        const bTime = b.scheduledAt
          ? new Date(b.scheduledAt).getTime()
          : Infinity
        if (aTime !== bTime) return aTime - bTime
        return new Date(a.createdAt) - new Date(b.createdAt)
      })
  }, [visibleJobs])

  const processingJobs = useMemo(
    () => visibleJobs.filter(job => job.status === 'processing'),
    [visibleJobs],
  )

  const reviewJobs = useMemo(() => {
    return visibleJobs
      .filter(job => job.status === 'completed' && !job.createdProductId)
      .sort(
        (a, b) => (a.analysis?.confidence ?? 0) - (b.analysis?.confidence ?? 0),
      )
  }, [visibleJobs])

  const historyJobs = useMemo(() => {
    const grouped = new Set(
      [...queueJobs, ...processingJobs, ...reviewJobs].map(getJobId),
    )
    return visibleJobs
      .filter(job => !grouped.has(getJobId(job)))
      .sort(
        (a, b) =>
          new Date(getHistoryTimestamp(b)) - new Date(getHistoryTimestamp(a)),
      )
  }, [visibleJobs, queueJobs, processingJobs, reviewJobs])

  const activityFeed = useMemo(
    () => buildActivityFeed(visibleJobs),
    [visibleJobs],
  )

  const hasCountdownTargets = useMemo(
    () => queueJobs.some(job => job.status === 'scheduled' && job.scheduledAt),
    [queueJobs],
  )

  useEffect(() => {
    if (!hasCountdownTargets) return undefined
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [hasCountdownTargets])

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
          toast.error(
            error?.response?.data?.message ||
              'No se pudo cargar la cola de análisis',
          )
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [queryParams],
  )

  const fetchAgentStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setAgentStatusLoading(true)

    try {
      const { data } = await api.get('/product-analysis/agent/status')
      setAgentStatus(data)
    } catch (error) {
      if (!silent) {
        toast.error(
          error?.response?.data?.message ||
            'No se pudo obtener el estado del agente',
        )
      }
    } finally {
      if (!silent) setAgentStatusLoading(false)
    }
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
        toast.error(
          error?.response?.data?.message ||
            'No se pudieron cargar los borradores del agente',
        )
      }
    } finally {
      if (!silent) setDraftsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (onlyHidden && !showHidden) {
      setShowHidden(true)
    }
  }, [onlyHidden, showHidden])

  useEffect(() => {
    setPage(1)
  }, [status, search, sourceFilter, showHidden, onlyHidden])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    fetchAgentStatus()
    fetchDrafts()
  }, [fetchAgentStatus, fetchDrafts])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs({ silent: true })
      fetchAgentStatus({ silent: true })
      fetchDrafts({ silent: true })
    }, AUTO_REFRESH_MS)

    return () => clearInterval(interval)
  }, [fetchJobs, fetchAgentStatus, fetchDrafts])

  const handleSweep = async () => {
    setSweeping(true)

    try {
      await api.post('/product-analysis/process-due')
      await Promise.all([fetchJobs(), fetchAgentStatus({ silent: true })])
      toast.success('Barrido ejecutado')
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo ejecutar el barrido',
      )
    } finally {
      setSweeping(false)
    }
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
      setDrafts(current =>
        current.filter(item => getDraftId(item) !== productId),
      )
      setDraftsTotal(current => Math.max(0, current - 1))
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo publicar el producto',
      )
    } finally {
      setPublishingDraftId(null)
    }
  }

  const publishAllDrafts = async () => {
    setPublishingAll(true)

    try {
      for (const product of drafts) {
        await publishDraft(product)
      }
    } finally {
      setPublishingAll(false)
    }
  }

  const editDraft = product => {
    const productId = getDraftId(product)
    if (!productId) return
    navigate(`/admin/edit-product/${productId}`)
  }

  const discardDraft = async product => {
    const productId = getDraftId(product)
    if (!productId) return

    setDiscardingDraftId(productId)

    try {
      await api.delete(`/product/${productId}`)
      toast.success('Borrador descartado')
      setDrafts(current =>
        current.filter(item => getDraftId(item) !== productId),
      )
      setDraftsTotal(current => Math.max(0, current - 1))
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo descartar el borrador',
      )
    } finally {
      setDiscardingDraftId(null)
    }
  }

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

    // El análisis con IA siempre arranca solo apenas se cumple la hora
    // programada (eso no depende de ningún checkbox). Lo que SÍ controla
    // este checkbox es si, además de analizar, AddProduct autoguarda el
    // producto (lo crea) o lo deja esperando tu aprobación manual.
    const effectiveAutoSave = sendToAddProduct && autoSaveInAddProduct

    form.append('image', file)
    form.append('source', 'manual-upload')
    form.append('originalFilename', file.name)
    form.append('autoAnalyze', String(!sendToAddProduct))
    form.append('autoCreateProduct', 'false')
    form.append('autoSaveProduct', String(effectiveAutoSave))
    form.append(
      'autoPublishProduct',
      String(effectiveAutoSave && autoPublishProduct),
    )

    if (scheduledIso) form.append('scheduledAt', scheduledIso)

    setUploading(true)

    try {
      await api.post('/product-analysis/import', form, { isMultipart: true })

      toast.success(
        sendToAddProduct
          ? scheduledIso
            ? 'Imagen programada para AddProduct'
            : 'Imagen enviada a la bandeja de AddProduct'
          : scheduledIso
            ? 'Imagen programada para análisis'
            : 'Imagen importada para análisis',
      )

      await Promise.all([fetchJobs(), fetchAgentStatus({ silent: true })])
    } catch (error) {
      const data = error?.response?.data

      if (isDuplicateUploadError(error)) {
        toast.info(
          'La imagen ya estaba importada. Se muestra el trabajo existente.',
        )
        setShowHidden(true)
        setJobs(current => {
          const existingId = getJobId(data.job)
          const alreadyExists = current.some(
            item => getJobId(item) === existingId,
          )

          if (alreadyExists) {
            return current.map(item =>
              getJobId(item) === existingId ? data.job : item,
            )
          }

          return [data.job, ...current]
        })
        setSelectedJob(data.job)
        await fetchJobs()
        return
      }

      toast.error(data?.message || 'No se pudo importar la imagen')
    } finally {
      setUploading(false)
    }
  }

  const retryJob = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    try {
      await api.post(`/product-analysis/${jobId}/retry`)
      toast.success('Reintento iniciado')
      await fetchJobs()
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo reintentar el análisis',
      )
    }
  }

  const runJobNow = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    setRunningJobId(jobId)

    try {
      await api.post(`/product-analysis/${jobId}/run-now`)
      toast.success('Trabajo enviado a AddProduct para analizarse ahora')
      await Promise.all([fetchJobs(), fetchAgentStatus({ silent: true })])
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          'No se pudo ejecutar el trabajo ahora',
      )
    } finally {
      setRunningJobId(null)
    }
  }

  const openReschedule = job => {
    const current = job.scheduledAt ? new Date(job.scheduledAt) : null
    setRescheduleJob(job)
    setRescheduleValue(
      current && !Number.isNaN(current.getTime())
        ? toDatetimeLocalValue(current)
        : '',
    )
    setRescheduleOpen(true)
  }

  const closeReschedule = () => {
    if (rescheduling) return
    setRescheduleOpen(false)
    setRescheduleJob(null)
  }

  const submitReschedule = async () => {
    const jobId = getJobId(rescheduleJob)
    if (!jobId) return

    if (!isValidDate(rescheduleValue)) {
      toast.error('Elegí una fecha y hora válidas')
      return
    }

    const iso = toIsoOrNull(rescheduleValue)

    if (!iso || new Date(iso).getTime() <= Date.now()) {
      toast.error('La nueva hora debe ser futura')
      return
    }

    setRescheduling(true)

    try {
      await api.patch(`/product-analysis/${jobId}/reschedule`, {
        scheduledAt: iso,
      })
      toast.success('Trabajo reprogramado')
      setRescheduleOpen(false)
      setRescheduleJob(null)
      await Promise.all([fetchJobs(), fetchAgentStatus({ silent: true })])
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo reprogramar el trabajo',
      )
    } finally {
      setRescheduling(false)
    }
  }

  const rejectJob = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    try {
      await api.post(`/product-analysis/${jobId}/reject`, {
        reason: 'Rechazado desde panel admin',
      })

      toast.success('Análisis rechazado')
      await fetchJobs()
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo rechazar el análisis',
      )
    }
  }

  const toggleHiddenJob = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    const shouldUnhide = Boolean(job.isHidden)
    const endpoint = shouldUnhide ? 'unhide' : 'hide'

    try {
      await api.patch(`/product-analysis/${jobId}/${endpoint}`, {
        reason: shouldUnhide
          ? 'Restaurado desde panel admin'
          : 'Ocultado desde panel admin',
      })

      toast.success(
        shouldUnhide
          ? 'Análisis restaurado en la bandeja'
          : 'Análisis ocultado de la bandeja principal',
      )

      await fetchJobs()
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          (shouldUnhide
            ? 'No se pudo restaurar el análisis'
            : 'No se pudo ocultar el análisis'),
      )
    }
  }

  const openDelete = job => {
    setSelectedJob(job)
    setDeleteOpen(true)
  }

  const closeDelete = () => {
    if (deleting) return
    setDeleteOpen(false)
    setSelectedJob(null)
  }

  const confirmDeleteJob = async () => {
    const jobId = getJobId(selectedJob)
    if (!jobId) return

    const previousJobs = jobs
    setDeleting(true)
    setJobs(current => current.filter(item => getJobId(item) !== jobId))

    try {
      await api.delete(`/product-analysis/${jobId}`)
      toast.success('Análisis e imagen eliminados permanentemente')
      setDeleteOpen(false)
      setSelectedJob(null)
      await fetchJobs()
    } catch (error) {
      setJobs(previousJobs)
      toast.error(
        error?.response?.data?.message || 'No se pudo eliminar la imagen',
      )
    } finally {
      setDeleting(false)
    }
  }

  const openApprove = job => {
    const analysis = job?.analysis || {}

    setSelectedJob(job)
    setApproveForm({
      titulo: analysis.titulo || analysis.title || '',
      descripcion: analysis.descripcion || analysis.description || '',
      categoria: analysis.categoria || analysis.category || '',
      subcategoria: analysis.subcategoria || analysis.subcategory || '',
      marca: analysis.marca || analysis.brand || '',
      price: analysis.suggestedPrice ?? analysis.precio_sugerido ?? '',
      currency: analysis.currency || analysis.moneda || 'ARS',
      stock: 0,
      seoTitle: analysis.seoTitle || '',
      seoDescription: analysis.seoDescription || '',
      publish: false,
    })
    setApproveOpen(true)
  }

  const closeApprove = () => {
    setApproveOpen(false)
    setSelectedJob(null)
  }

  const approveJob = async () => {
    const jobId = getJobId(selectedJob)

    if (!jobId) {
      toast.error('No hay análisis seleccionado')
      return
    }

    const payload = {
      ...approveForm,
      price: normalizeNumberOrUndefined(approveForm.price),
      stock: normalizeNumberOrZero(approveForm.stock),
      publish: Boolean(approveForm.publish),
    }

    try {
      await api.post(`/product-analysis/${jobId}/approve`, payload)

      toast.success(
        payload.publish
          ? 'Producto creado y publicado'
          : 'Producto creado como borrador',
      )
      setApproveOpen(false)
      setSelectedJob(null)
      await fetchJobs()
    } catch (error) {
      toast.error(
        error?.response?.data?.message || 'No se pudo aprobar el análisis',
      )
    }
  }

  const clearFilters = () => {
    setStatus('')
    setSearch('')
    setSourceFilter('')
    setOnlyHidden(false)
    setShowHidden(true)
    setPage(1)
  }

  const renderJobCard = job => {
    const jobId = getJobId(job)
    const sourcePath = getSourcePath(job)
    const isFinal = ['approved', 'rejected'].includes(job.status)
    const canRetry =
      !['approved', 'rejected', 'processing', 'scheduled', 'imported'].includes(
        job.status,
      ) && job.metadata?.autoAnalyze !== false
    const canApprove = job.status === 'completed' && !job.createdProductId
    const canReject = !['approved', 'rejected', 'imported'].includes(job.status)
    const isAutonomousAddProduct = job.metadata?.autoSaveProduct === true
    const canRunNow =
      job.status === 'scheduled' ||
      job.status === 'pending' ||
      (job.status === 'failed' && isAutonomousAddProduct)
    const canReschedule = job.status === 'scheduled'
    const isRunningNow = runningJobId === jobId

    return (
      <Paper
        key={jobId}
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 3,
          opacity: job.isHidden ? 0.65 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'flex-start' }}
        >
          <JobImage job={job} size={96} />

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
                <Typography variant="body2" color="text.secondary">
                  {getAnalysisCategoryLine(job)}
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={STATUS_LABEL[job.status] || job.status || '-'}
                  color={STATUS_COLOR[job.status] || 'default'}
                  size="small"
                />
                {isFinal && job.isHidden && (
                  <Chip size="small" color="warning" label="Archivado" />
                )}
              </Stack>
            </Stack>

            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              sx={{ mt: 1 }}
            >
              <Chip
                size="small"
                label={getSourceLabel(job)}
                variant="outlined"
              />
              {getAgentMode(job) === 'folder-domain' && (
                <Chip
                  size="small"
                  color="secondary"
                  label="Tenant por carpeta"
                />
              )}
              {job.createdProductId && (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label="Producto vinculado"
                />
              )}
              {job.isHidden && (
                <Chip
                  size="small"
                  color="warning"
                  variant="outlined"
                  label="Oculto"
                />
              )}
              {job.metadata?.autoAnalyze === false && (
                <Chip size="small" variant="outlined" label="AddProduct" />
              )}
              {job.metadata?.autoSaveProduct && (
                <Tooltip title="AddProduct analiza esta imagen sola y crea el producto automáticamente al terminar, sin depender de que alguien tenga ninguna pestaña abierta.">
                  <Chip
                    size="small"
                    color="primary"
                    icon={<BoltIcon />}
                    variant="outlined"
                    label={
                      job.autoPublishProduct
                        ? 'Autoguardado · autopublica'
                        : 'Autoguardado · borrador'
                    }
                  />
                </Tooltip>
              )}
              {job.status === 'scheduled' && (
                <CountdownChip scheduledAt={job.scheduledAt} now={now} />
              )}
            </Stack>

            {job.status === 'processing' && (
              <Box sx={{ mt: 1.5, maxWidth: 260 }}>
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  sx={{ mb: 0.5 }}
                >
                  <AutorenewIcon fontSize="inherit" sx={{ fontSize: 14 }} />
                  <Typography variant="caption" color="text.secondary">
                    La IA está analizando la imagen...
                  </Typography>
                </Stack>
                <LinearProgress sx={{ height: 5, borderRadius: 3 }} />
              </Box>
            )}

            {job.status === 'completed' &&
              Number.isFinite(job.analysis?.confidence) && (
                <Box sx={{ mt: 1.5 }}>
                  <ConfidenceMeter value={job.analysis?.confidence} dense />
                </Box>
              )}

            <Stack direction="row" spacing={2.5} flexWrap="wrap" sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Creado: {formatDate(job.createdAt)}
              </Typography>
              {job.scheduledAt && (
                <Typography variant="caption" color="text.secondary">
                  Programado: {formatDate(job.scheduledAt)}
                </Typography>
              )}
              {job.metadata?.AddProductAt && (
                <Typography variant="caption" color="text.secondary">
                  AddProduct: {formatDate(job.metadata.AddProductAt)}
                </Typography>
              )}
              {sourcePath && (
                <Tooltip title={sourcePath}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ maxWidth: 260 }}
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
            flexWrap="wrap"
            sx={{
              flexShrink: 0,
              alignSelf: { xs: 'flex-end', sm: 'flex-start' },
            }}
          >
            <Tooltip title="Ejecutar ahora (no esperar la hora programada)">
              <span>
                <IconButton
                  color="secondary"
                  onClick={() => runJobNow(job)}
                  disabled={!canRunNow || isRunningNow}
                >
                  {isRunningNow ? (
                    <CircularProgress size={20} />
                  ) : (
                    <PlayArrowIcon />
                  )}
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Reprogramar hora">
              <span>
                <IconButton
                  onClick={() => openReschedule(job)}
                  disabled={!canReschedule}
                >
                  <EventIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Reintentar análisis">
              <span>
                <IconButton onClick={() => retryJob(job)} disabled={!canRetry}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Aprobar y crear producto">
              <span>
                <IconButton
                  color="success"
                  onClick={() => openApprove(job)}
                  disabled={!canApprove}
                >
                  <CheckCircleIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title={job.isHidden ? 'Restaurar' : 'Ocultar'}>
              <span>
                <IconButton
                  color={job.isHidden ? 'primary' : 'default'}
                  onClick={() => toggleHiddenJob(job)}
                >
                  {job.isHidden ? <VisibilityIcon /> : <VisibilityOffIcon />}
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Rechazar">
              <span>
                <IconButton
                  color="warning"
                  onClick={() => rejectJob(job)}
                  disabled={!canReject}
                >
                  <CancelIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Eliminar análisis e imagen">
              <span>
                <IconButton color="error" onClick={() => openDelete(job)}>
                  <DeleteIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
      </Paper>
    )
  }

  return (
    <Box>
      <Paper
        sx={{
          p: { xs: 2, md: 3 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
        }}
      >
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          justifyContent="space-between"
          gap={3}
        >
          <Box>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
            >
              <Typography variant="h5" fontWeight={900}>
                Cola de imágenes IA
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
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Revisá, aprobá o descartá las imágenes que subió el agente local,
              folder-domain o una carga manual para tu comercio.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            <Button
              component="label"
              variant="contained"
              startIcon={
                uploading ? <CircularProgress size={18} /> : <CloudUploadIcon />
              }
              disabled={uploading}
            >
              {uploading
                ? 'Subiendo...'
                : scheduledAt
                  ? 'Programar imagen'
                  : 'Subir imagen'}
              <input
                hidden
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                type="file"
                onChange={handleUpload}
              />
            </Button>

            <Button
              variant="outlined"
              startIcon={
                loading ? <CircularProgress size={18} /> : <RefreshIcon />
              }
              onClick={() => fetchJobs()}
              disabled={loading}
            >
              {loading ? 'Actualizando...' : 'Actualizar'}
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr 1fr',
              md: 'repeat(4, minmax(0, 1fr))',
              xl: 'repeat(7, minmax(0, 1fr))',
            },
            gap: 1.5,
            mt: 3,
          }}
        >
          <MetricCard
            label="Total"
            value={counters.total || 0}
            icon={ImageIcon}
          />
          <MetricCard
            label="Agente"
            value={counters.agent || 0}
            icon={FolderIcon}
            color="primary"
            description="local-folder-agent"
          />
          <MetricCard
            label="Folder-domain"
            value={counters.folderDomain || 0}
            icon={HubIcon}
            color="secondary"
            description="tenant por carpeta"
          />
          <MetricCard
            label="Manual"
            value={counters.manual || 0}
            icon={CloudUploadIcon}
            color="info"
          />
          <MetricCard
            label="En AddProduct"
            value={counters.imported || 0}
            color="primary"
          />
          <MetricCard
            label="Fallidos"
            value={counters.failed || 0}
            color="error"
          />
          <MetricCard
            label="Ocultos"
            value={counters.hidden || 0}
            color="warning"
          />
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'minmax(240px, 1fr) 220px 220px 260px',
            },
            gap: 2,
            mt: 3,
          }}
        >
          <TextField
            fullWidth
            size="small"
            label="Buscar"
            value={search}
            onChange={event => setSearch(event.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <FormControl fullWidth size="small">
            <InputLabel>Estado</InputLabel>
            <Select
              label="Estado"
              value={status}
              onChange={event => setStatus(event.target.value)}
            >
              {STATUS_OPTIONS.map(option => (
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
              {SOURCE_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
              {sourceOptions
                .filter(source => !SOURCE_LABEL[source])
                .map(source => (
                  <MenuItem key={source} value={source}>
                    {source}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            size="small"
            type="datetime-local"
            label="Programar disponibilidad"
            value={scheduledAt}
            onChange={event => setScheduledAt(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          gap={2}
          mt={2}
          alignItems={{ md: 'center' }}
          flexWrap="wrap"
        >
          <FormControlLabel
            control={
              <Switch
                checked={sendToAddProduct}
                onChange={event => setSendToAddProduct(event.target.checked)}
              />
            }
            label="Enviar a AddProduct"
          />

          <Tooltip title="El análisis con IA siempre arranca solo al cumplirse la hora programada. Este switch decide si, además, AddProduct autoguarda el producto o lo deja esperando tu aprobación.">
            <FormControlLabel
              control={
                <Switch
                  checked={autoSaveInAddProduct}
                  onChange={event =>
                    setAutoSaveInAddProduct(event.target.checked)
                  }
                  disabled={!sendToAddProduct}
                />
              }
              label="Autoanalizar y guardar en AddProduct"
            />
          </Tooltip>

          <FormControlLabel
            control={
              <Switch
                checked={autoPublishProduct}
                onChange={event => setAutoPublishProduct(event.target.checked)}
                disabled={!sendToAddProduct || !autoSaveInAddProduct}
              />
            }
            label="Publicar al autosave"
          />

          <FormControlLabel
            control={
              <Switch
                checked={showHidden}
                onChange={event => setShowHidden(event.target.checked)}
                disabled={onlyHidden}
              />
            }
            label="Mostrar ocultos"
          />

          <FormControlLabel
            control={
              <Switch
                checked={onlyHidden}
                onChange={event => {
                  const checked = event.target.checked
                  setOnlyHidden(checked)
                  if (checked) setShowHidden(true)
                }}
              />
            }
            label="Solo ocultos"
          />

          <Button size="small" onClick={clearFilters}>
            Limpiar filtros
          </Button>

          {lastUpdatedAt && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ ml: { md: 'auto' } }}
            >
              Última actualización: {formatDate(lastUpdatedAt)}
            </Typography>
          )}
        </Stack>
      </Paper>

      <AgentStatusBar
        agentStatus={agentStatus}
        agentStatusLoading={agentStatusLoading}
        activity={activityFeed}
        onSweep={handleSweep}
        sweeping={sweeping}
      />

      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, md: 2.5 },
          mb: 3,
          borderRadius: 3,
          borderColor: drafts.length > 0 ? 'warning.main' : 'divider',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          gap={1.5}
          sx={{ mb: drafts.length > 0 ? 2 : 0 }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <DraftsIcon
              fontSize="small"
              color={drafts.length > 0 ? 'warning' : 'action'}
            />
            <Typography variant="subtitle1" fontWeight={800}>
              Borradores pendientes de publicar
            </Typography>
            <Chip size="small" label={draftsTotal} />
            {draftsLoading && <CircularProgress size={14} />}
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => fetchDrafts()}
              disabled={draftsLoading}
            >
              Actualizar
            </Button>
            {drafts.length > 1 && (
              <Button
                size="small"
                variant="contained"
                color="success"
                startIcon={
                  publishingAll ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <PublishIcon />
                  )
                }
                onClick={publishAllDrafts}
                disabled={publishingAll || Boolean(publishingDraftId)}
              >
                Publicar todos ({drafts.length})
              </Button>
            )}
          </Stack>
        </Stack>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: drafts.length > 0 ? 2 : 0 }}
        >
          Productos que aprobaste como borrador (o que se auto-publicaron porque
          la IA superó el umbral de confianza al aprobar) y todavía no salieron
          a la tienda. Revisalos y publicalos cuando quieras.
        </Typography>

        {drafts.length > 0 ? (
          <Stack spacing={1.5}>
            {drafts.map(product => (
              <DraftProductCard
                key={getDraftId(product)}
                product={product}
                onPublish={publishDraft}
                onEdit={editDraft}
                onDiscard={discardDraft}
                publishing={
                  publishingDraftId === getDraftId(product) || publishingAll
                }
                discarding={discardingDraftId === getDraftId(product)}
              />
            ))}
          </Stack>
        ) : (
          !draftsLoading && (
            <Typography variant="body2" color="text.secondary">
              No hay borradores esperando revisión.
            </Typography>
          )
        )}
      </Paper>

      {loading && visibleJobs.length === 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <Box textAlign="center" py={6}>
            <CircularProgress size={28} />
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              Cargando cola de imágenes...
            </Typography>
          </Box>
        </Paper>
      )}

      {!loading && visibleJobs.length === 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <Box textAlign="center" py={6}>
            <Typography color="text.secondary">
              No hay imágenes en la cola con los filtros actuales.
            </Typography>
          </Box>
        </Paper>
      )}

      {visibleJobs.length > 0 && !isGroupedView && (
        <Stack spacing={1.5}>{visibleJobs.map(renderJobCard)}</Stack>
      )}

      {visibleJobs.length > 0 && isGroupedView && (
        <Stack spacing={3}>
          <Box>
            <SectionHeader
              icon={PendingActionsIcon}
              title="En cola"
              count={queueJobs.length}
              hint="pendientes y programados, ordenados por hora de ejecución"
            />
            {queueJobs.length > 0 ? (
              <Stack spacing={1.5}>{queueJobs.map(renderJobCard)}</Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No hay imágenes esperando su turno.
              </Typography>
            )}
          </Box>

          <Box>
            <SectionHeader
              icon={AutorenewIcon}
              title="Procesando"
              count={processingJobs.length}
              hint="la IA está analizando la imagen ahora mismo"
            />
            {processingJobs.length > 0 ? (
              <Stack spacing={1.5}>{processingJobs.map(renderJobCard)}</Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No hay ninguna imagen analizándose en este momento.
              </Typography>
            )}
          </Box>

          <Box>
            <SectionHeader
              icon={RateReviewIcon}
              title="Para revisar"
              count={reviewJobs.length}
              hint="análisis completos sin producto creado, priorizados por menor confianza"
            />
            {reviewJobs.length > 0 ? (
              <Stack spacing={1.5}>{reviewJobs.map(renderJobCard)}</Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No hay análisis pendientes de revisión humana.
              </Typography>
            )}
          </Box>

          <Accordion
            expanded={historyExpanded}
            onChange={(_event, expanded) => setHistoryExpanded(expanded)}
            variant="outlined"
            sx={{ borderRadius: 3, '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <SectionHeader
                icon={HistoryIcon}
                title="Historial"
                count={historyJobs.length}
                hint="aprobados, rechazados, fallidos e importados a AddProduct"
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
      )}

      {totalPages > 1 && (
        <Stack direction="row" justifyContent="center" sx={{ mt: 3 }}>
          <Pagination
            count={totalPages}
            page={Math.min(page, totalPages)}
            onChange={(_event, value) => setPage(value)}
            color="primary"
            shape="rounded"
          />
        </Stack>
      )}

      {total > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', textAlign: 'center', mt: 1 }}
        >
          {formatNumber(total)} imágenes en total
        </Typography>
      )}

      <Dialog open={approveOpen} onClose={closeApprove} maxWidth="md" fullWidth>
        <DialogTitle>Aprobar análisis</DialogTitle>

        <DialogContent>
          {selectedJob && (
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <JobImage job={selectedJob} size={64} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2">
                  Comercio: <strong>{getTenantDomain(selectedJob)}</strong>
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                >
                  {selectedJob.originalFilename || 'Sin nombre de archivo'}
                </Typography>
              </Box>
              {Number.isFinite(selectedJob.analysis?.confidence) && (
                <ConfidenceMeter value={selectedJob.analysis?.confidence} />
              )}
            </Stack>
          )}

          {selectedJob?.analysis?.hasVariants &&
            (selectedJob?.metadata?.autoSaveProduct ? (
              <Alert severity="info" sx={{ mb: 2 }}>
                La IA detectó variantes (talles, colores, etc.) en esta imagen.
                Al aprobar, se van a crear como variantes del producto — no se
                pierden.
              </Alert>
            ) : (
              <Alert severity="warning" sx={{ mb: 2 }}>
                La IA detectó que este producto podría tener variantes (talles,
                colores, etc.). Esta cola solo crea un producto simple con una
                imagen — para conservar las variantes, subí la imagen con
                "Enviar a AddProduct" activado, o usá "Importar desde el agente
                IA" dentro de AddProduct.
              </Alert>
            ))}

          {safeArray(selectedJob?.analysis?.warnings).length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {selectedJob.analysis.warnings.join(' · ')}
            </Alert>
          )}

          {(safeArray(selectedJob?.analysis?.tags).length > 0 ||
            Object.keys(selectedJob?.analysis?.attributes || {}).length >
              0) && (
            <Box sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                Detectado por la IA (informativo, se aplica automáticamente)
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {safeArray(selectedJob?.analysis?.tags).map(tag => (
                  <Chip key={tag} size="small" label={tag} variant="outlined" />
                ))}
                {Object.entries(selectedJob?.analysis?.attributes || {}).map(
                  ([key, value]) =>
                    value ? (
                      <Chip
                        key={key}
                        size="small"
                        color="default"
                        label={`${key}: ${value}`}
                      />
                    ) : null,
                )}
              </Stack>
            </Box>
          )}

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
              gap: 2,
              mt: 0.5,
            }}
          >
            {['titulo', 'marca', 'categoria', 'subcategoria'].map(field => (
              <TextField
                key={field}
                fullWidth
                label={field}
                value={approveForm[field] || ''}
                onChange={event =>
                  setApproveForm(prev => ({
                    ...prev,
                    [field]: event.target.value,
                  }))
                }
              />
            ))}

            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Descripción"
              value={approveForm.descripcion || ''}
              onChange={event =>
                setApproveForm(prev => ({
                  ...prev,
                  descripcion: event.target.value,
                }))
              }
              sx={{ gridColumn: { md: '1 / -1' } }}
            />

            <TextField
              fullWidth
              type="number"
              label="Precio"
              value={approveForm.price}
              onChange={event =>
                setApproveForm(prev => ({
                  ...prev,
                  price: event.target.value,
                }))
              }
            />

            <TextField
              fullWidth
              type="number"
              label="Stock"
              value={approveForm.stock}
              onChange={event =>
                setApproveForm(prev => ({
                  ...prev,
                  stock: event.target.value,
                }))
              }
            />

            <TextField
              fullWidth
              label="Moneda"
              value={approveForm.currency || 'ARS'}
              onChange={event =>
                setApproveForm(prev => ({
                  ...prev,
                  currency: event.target.value,
                }))
              }
            />

            <TextField
              fullWidth
              label="Título SEO"
              value={approveForm.seoTitle || ''}
              helperText="Se usa en buscadores. Si se deja vacío, se genera del título."
              onChange={event =>
                setApproveForm(prev => ({
                  ...prev,
                  seoTitle: event.target.value,
                }))
              }
              sx={{ gridColumn: { md: '1 / -1' } }}
            />

            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Descripción SEO"
              value={approveForm.seoDescription || ''}
              helperText="Se usa en buscadores. Si se deja vacío, se genera de la descripción."
              onChange={event =>
                setApproveForm(prev => ({
                  ...prev,
                  seoDescription: event.target.value,
                }))
              }
              sx={{ gridColumn: { md: '1 / -1' } }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(approveForm.publish)}
                  onChange={event =>
                    setApproveForm(prev => ({
                      ...prev,
                      publish: event.target.checked,
                    }))
                  }
                />
              }
              label="Publicar inmediatamente"
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={closeApprove}>Cancelar</Button>
          <Button variant="contained" onClick={approveJob}>
            {approveForm.publish ? 'Crear y publicar' : 'Crear borrador'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={rescheduleOpen}
        onClose={closeReschedule}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Reprogramar trabajo</DialogTitle>

        <DialogContent>
          {rescheduleJob && (
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <JobImage job={rescheduleJob} size={56} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {getAnalysisTitle(rescheduleJob)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Hora actual: {formatDate(rescheduleJob.scheduledAt)}
                </Typography>
              </Box>
            </Stack>
          )}

          <TextField
            fullWidth
            type="datetime-local"
            label="Nueva hora de ejecución"
            value={rescheduleValue}
            onChange={event => setRescheduleValue(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={closeReschedule} disabled={rescheduling}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={submitReschedule}
            disabled={rescheduling}
            startIcon={rescheduling ? <CircularProgress size={16} /> : null}
          >
            {rescheduling ? 'Guardando...' : 'Reprogramar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={closeDelete} maxWidth="sm" fullWidth>
        <DialogTitle>Eliminar análisis</DialogTitle>

        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Esta acción elimina el análisis y libera el hash de la imagen para
            poder volver a cargarla. Si existe un producto vinculado, el backend
            debe desvincular el job sin eliminar el producto.
          </Alert>

          <Typography variant="body2">
            ¿Querés eliminar permanentemente el análisis{' '}
            <strong>{getAnalysisTitle(selectedJob)}</strong>?
          </Typography>

          {selectedJob && (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ mt: 1 }}
            >
              Comercio: {getTenantDomain(selectedJob)}
            </Typography>
          )}

          {selectedJob?.createdProductId && (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
              sx={{ mt: 1 }}
            >
              Producto vinculado: {String(selectedJob.createdProductId)}
            </Typography>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={closeDelete} disabled={deleting}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDeleteJob}
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : null}
          >
            {deleting ? 'Eliminando...' : 'Eliminar definitivamente'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ProductAnalysisPage
