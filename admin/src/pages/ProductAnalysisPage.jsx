import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
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
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  CloudUpload as CloudUploadIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Storefront as StorefrontIcon,
  Folder as FolderIcon,
  Hub as HubIcon,
  Image as ImageIcon,
} from '@mui/icons-material'
import api from '@utils/axiosConfig'

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

const normalizeString = value => String(value || '').trim()
const toLower = value => normalizeString(value).toLowerCase()
const getJobId = job => String(job?._id || job?.id || '')

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

const formatDate = value => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
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
  return [...new Set(values.map(normalizeString).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
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
      .join(' / ') || normalizeString(job?.originalFilename) || '-'
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
  if (job?.metadata?.tenantResolutionMode === 'folder-domain') return 'Agente · folder-domain'
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
  if (job?.metadata?.tenantResolutionMode) return job.metadata.tenantResolutionMode
  if (getSource(job) === 'local-folder-agent') return 'agent'
  if (getSource(job) === 'manual-upload') return 'manual'
  return 'unknown'
}

const getMetricColor = color => {
  return color && color !== 'default' ? `${color}.main` : 'text.primary'
}

const isDuplicateUploadError = error => {
  return (
    error?.response?.status === 409 &&
    error?.response?.data?.code === 'PRODUCT_ANALYSIS_DUPLICATE' &&
    error?.response?.data?.job
  )
}

const matchesClientFilters = ({ job, tenantFilter, sourceFilter }) => {
  const tenant = getTenantDomain(job)
  const source = getSource(job)
  const mode = getAgentMode(job)

  if (tenantFilter && tenant !== tenantFilter) return false
  if (sourceFilter && source !== sourceFilter && mode !== sourceFilter) return false

  return true
}

const MetricCard = ({ label, value, color = 'default', icon: Icon = HubIcon, description }) => (
  <Paper variant="outlined" sx={{ p: 1.75, height: '100%', borderRadius: 2.5 }}>
    <Stack direction="row" spacing={1.25} justifyContent="space-between" alignItems="flex-start">
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" fontWeight={800}>
          {label}
        </Typography>
        <Typography variant="h5" fontWeight={900} color={getMetricColor(color)}>
          {formatNumber(value)}
        </Typography>
        {description && (
          <Typography variant="caption" color="text.secondary" display="block" noWrap>
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

const TenantSummaryCard = ({ tenant, jobs }) => {
  const tenantJobs = jobs.filter(job => getTenantDomain(job) === tenant)
  const failed = tenantJobs.filter(job => job.status === 'failed').length
  const imported = tenantJobs.filter(job => job.status === 'imported').length
  const completed = tenantJobs.filter(job => job.status === 'completed').length
  const agentJobs = tenantJobs.filter(job => getSource(job) === 'local-folder-agent').length

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
      <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 34, height: 34 }}>
            <StorefrontIcon fontSize="small" />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={900} noWrap title={tenant}>
              {tenant}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatNumber(tenantJobs.length)} imágenes · {formatNumber(agentJobs)} por agente
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="flex-end">
          <Chip size="small" label={`AddProduct ${imported}`} color="primary" variant="outlined" />
          <Chip size="small" label={`IA ${completed}`} color="success" variant="outlined" />
          {failed > 0 && <Chip size="small" label={`Fallos ${failed}`} color="error" />}
        </Stack>
      </Stack>
    </Paper>
  )
}

const JobImage = ({ job }) => {
  const imageUrl = getImageUrl(job)
  const title = getAnalysisTitle(job)

  return (
    <Avatar
      src={imageUrl}
      alt={title}
      variant="rounded"
      sx={{
        width: 72,
        height: 72,
        bgcolor: 'grey.100',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <ImageIcon color="disabled" />
    </Avatar>
  )
}

const ProductAnalysisPage = () => {
  const [showHidden, setShowHidden] = useState(true)
  const [onlyHidden, setOnlyHidden] = useState(false)
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [search, setSearch] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [manualTenantDomain, setManualTenantDomain] = useState('')
  const [sendToAddProduct, setSendToAddProduct] = useState(true)
  const [autoSaveInAddProduct, setAutoSaveInAddProduct] = useState(false)
  const [autoPublishProduct, setAutoPublishProduct] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [approveOpen, setApproveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [approveForm, setApproveForm] = useState({})

  const queryParams = useMemo(() => {
    const params = {
      limit: DEFAULT_LIMIT,
      sort: '-createdAt',
      showHidden: String(showHidden || onlyHidden),
    }

    if (onlyHidden) params.onlyHidden = 'true'
    if (status) params.status = status
    if (search.trim()) params.search = search.trim()
    if (tenantFilter) params.tenantDomain = tenantFilter
    if (sourceFilter) params.source = sourceFilter

    return params
  }, [onlyHidden, search, showHidden, sourceFilter, status, tenantFilter])

  const visibleJobs = useMemo(() => {
    return jobs.filter(job => matchesClientFilters({ job, tenantFilter, sourceFilter }))
  }, [jobs, tenantFilter, sourceFilter])

  const tenantOptions = useMemo(() => uniqueList(jobs.map(getTenantDomain)), [jobs])
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

  const fetchJobs = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)

      try {
        const { data } = await api.get('/product-analysis', {
          params: queryParams,
        })

        setJobs(Array.isArray(data?.items) ? data.items : [])
        setLastUpdatedAt(new Date())
      } catch (error) {
        if (!silent) {
          toast.error(
            error?.response?.data?.message || 'No se pudo cargar la cola de análisis',
          )
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [queryParams],
  )

  useEffect(() => {
    if (onlyHidden && !showHidden) {
      setShowHidden(true)
    }
  }, [onlyHidden, showHidden])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchJobs({ silent: true })
    }, AUTO_REFRESH_MS)

    return () => clearInterval(interval)
  }, [fetchJobs])

  const handleRefresh = async () => {
    setRefreshing(true)

    try {
      await api.post('/product-analysis/process-due')
      await fetchJobs()
      toast.success('Cola actualizada')
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo actualizar la cola')
    } finally {
      setRefreshing(false)
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

    const tenantDomain = normalizeString(manualTenantDomain)
    const scheduledIso = toIsoOrNull(scheduledAt)
    const form = new FormData()

    form.append('image', file)
    form.append('source', 'manual-upload')
    form.append('originalFilename', file.name)
    form.append('autoAnalyze', String(!sendToAddProduct))
    form.append('autoCreateProduct', 'false')
    form.append('autoSaveProduct', String(sendToAddProduct && autoSaveInAddProduct))
    form.append(
      'autoPublishProduct',
      String(sendToAddProduct && autoSaveInAddProduct && autoPublishProduct),
    )

    if (scheduledIso) form.append('scheduledAt', scheduledIso)
    if (tenantDomain) form.append('tenantDomain', tenantDomain)

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

      await fetchJobs()
    } catch (error) {
      const data = error?.response?.data

      if (isDuplicateUploadError(error)) {
        toast.info('La imagen ya estaba importada. Se muestra el trabajo existente.')
        setShowHidden(true)
        setJobs(current => {
          const existingId = getJobId(data.job)
          const alreadyExists = current.some(item => getJobId(item) === existingId)

          if (alreadyExists) {
            return current.map(item => (getJobId(item) === existingId ? data.job : item))
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
      toast.error(error?.response?.data?.message || 'No se pudo reintentar el análisis')
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
      toast.error(error?.response?.data?.message || 'No se pudo rechazar el análisis')
    }
  }

  const toggleHiddenJob = async job => {
    const jobId = getJobId(job)
    if (!jobId) return

    const shouldUnhide = Boolean(job.isHidden)
    const endpoint = shouldUnhide ? 'unhide' : 'hide'

    try {
      await api.patch(`/product-analysis/${jobId}/${endpoint}`, {
        reason: shouldUnhide ? 'Restaurado desde panel admin' : 'Ocultado desde panel admin',
      })

      toast.success(
        shouldUnhide ? 'Análisis restaurado en la bandeja' : 'Análisis ocultado de la bandeja principal',
      )

      await fetchJobs()
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          (shouldUnhide ? 'No se pudo restaurar el análisis' : 'No se pudo ocultar el análisis'),
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
      toast.error(error?.response?.data?.message || 'No se pudo eliminar la imagen')
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

      toast.success(payload.publish ? 'Producto creado y publicado' : 'Producto creado como borrador')
      setApproveOpen(false)
      setSelectedJob(null)
      await fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo aprobar el análisis')
    }
  }

  const clearFilters = () => {
    setStatus('')
    setSearch('')
    setSourceFilter('')
    setTenantFilter('')
    setOnlyHidden(false)
    setShowHidden(true)
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
        <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" gap={3}>
          <Box>
            <Typography variant="h5" fontWeight={900}>
              Cola multitenant de imágenes IA
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Administrá imágenes importadas por agente local, folder-domain o carga manual. El tenant se muestra por job para validar a qué comercio pertenece cada imagen.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            <Button
              component="label"
              variant="contained"
              startIcon={uploading ? <CircularProgress size={18} /> : <CloudUploadIcon />}
              disabled={uploading}
            >
              {uploading ? 'Subiendo...' : scheduledAt ? 'Programar imagen' : 'Subir imagen'}
              <input
                hidden
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                type="file"
                onChange={handleUpload}
              />
            </Button>

            <Button
              variant="outlined"
              startIcon={refreshing ? <CircularProgress size={18} /> : <RefreshIcon />}
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? 'Actualizando...' : 'Actualizar'}
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr 1fr',
              md: 'repeat(4, minmax(0, 1fr))',
              xl: 'repeat(8, minmax(0, 1fr))',
            },
            gap: 1.5,
            mt: 3,
          }}
        >
          <MetricCard label="Total" value={counters.total || 0} icon={ImageIcon} />
          <MetricCard label="Tenants" value={tenantOptions.length || 0} icon={StorefrontIcon} color="primary" />
          <MetricCard label="Agente" value={counters.agent || 0} icon={FolderIcon} color="primary" description="local-folder-agent" />
          <MetricCard label="Folder-domain" value={counters.folderDomain || 0} icon={HubIcon} color="secondary" description="tenant por carpeta" />
          <MetricCard label="Manual" value={counters.manual || 0} icon={CloudUploadIcon} color="info" />
          <MetricCard label="En AddProduct" value={counters.imported || 0} color="primary" />
          <MetricCard label="Fallidos" value={counters.failed || 0} color="error" />
          <MetricCard label="Ocultos" value={counters.hidden || 0} color="warning" />
        </Box>

        {tenantOptions.length > 0 && (
          <Card variant="outlined" sx={{ mt: 3, borderRadius: 3 }}>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <StorefrontIcon color="primary" />
                <Box>
                  <Typography variant="subtitle1" fontWeight={900}>
                    Resumen por comercio
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    El dominio se toma del job generado por el backend o del agente folder-domain.
                  </Typography>
                </Box>
              </Stack>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 1.5,
                }}
              >
                {tenantOptions.slice(0, 6).map(tenant => (
                  <TenantSummaryCard key={tenant} tenant={tenant} jobs={jobs} />
                ))}
              </Box>
            </CardContent>
          </Card>
        )}

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
            <Select label="Estado" value={status} onChange={event => setStatus(event.target.value)}>
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

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 420px) minmax(260px, 1fr)' },
            gap: 2,
            mt: 2,
          }}
        >
          <FormControl fullWidth size="small">
            <InputLabel>Comercio / tenant</InputLabel>
            <Select
              label="Comercio / tenant"
              value={tenantFilter}
              onChange={event => setTenantFilter(event.target.value)}
            >
              <MenuItem value="">Todos</MenuItem>
              {tenantOptions.map(tenant => (
                <MenuItem key={tenant} value={tenant}>
                  {tenant}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            fullWidth
            size="small"
            label="Tenant para carga manual opcional"
            value={manualTenantDomain}
            onChange={event => setManualTenantDomain(event.target.value)}
            placeholder="tienda-a.henko.com"
            helperText="Si se deja vacío, el backend resuelve el tenant del admin actual."
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
            label="Enviar a AddProduct sin analizar IA"
          />

          <FormControlLabel
            control={
              <Switch
                checked={autoSaveInAddProduct}
                onChange={event => setAutoSaveInAddProduct(event.target.checked)}
                disabled={!sendToAddProduct}
              />
            }
            label="Autoanalizar y guardar en AddProduct"
          />

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
            <Typography variant="caption" color="text.secondary" sx={{ ml: { md: 'auto' } }}>
              Última actualización: {formatDate(lastUpdatedAt)}
            </Typography>
          )}
        </Stack>
      </Paper>

      <TableContainer component={Paper} sx={{ borderRadius: 3 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Imagen</TableCell>
              <TableCell>Comercio / origen</TableCell>
              <TableCell>Análisis</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Programación</TableCell>
              <TableCell>Fecha</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {visibleJobs.map(job => {
              const jobId = getJobId(job)
              const sourcePath = getSourcePath(job)
              const isFinal = ['approved', 'rejected'].includes(job.status)
              const canRetry =
                !['approved', 'rejected', 'processing', 'scheduled', 'imported'].includes(job.status) &&
                job.metadata?.autoAnalyze !== false
              const canApprove = job.status === 'completed' && !job.createdProductId
              const canReject = !['approved', 'rejected', 'imported'].includes(job.status)

              return (
                <TableRow key={jobId} hover>
                  <TableCell>
                    <JobImage job={job} />
                  </TableCell>

                  <TableCell sx={{ maxWidth: 290 }}>
                    <Stack spacing={0.75}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <StorefrontIcon fontSize="small" color="primary" />
                        <Typography variant="body2" fontWeight={900} noWrap title={getTenantDomain(job)}>
                          {getTenantDomain(job)}
                        </Typography>
                      </Stack>

                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        <Chip size="small" label={getSourceLabel(job)} variant="outlined" />
                        {getAgentMode(job) === 'folder-domain' && (
                          <Chip size="small" color="secondary" label="Tenant por carpeta" />
                        )}
                      </Stack>

                      {sourcePath && (
                        <Tooltip title={sourcePath}>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {sourcePath}
                          </Typography>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>

                  <TableCell>
                    <Stack spacing={0.75}>
                      <Typography fontWeight={800}>{getAnalysisTitle(job)}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {getAnalysisCategoryLine(job)}
                      </Typography>

                      <Stack direction="row" gap={0.5} flexWrap="wrap">
                        {job.createdProductId && (
                          <Chip size="small" color="primary" variant="outlined" label="Producto vinculado" />
                        )}
                        {job.isHidden && (
                          <Chip size="small" color="warning" variant="outlined" label="Oculto" />
                        )}
                        {job.metadata?.autoAnalyze === false && (
                          <Chip size="small" variant="outlined" label="AddProduct" />
                        )}
                        {job.metadata?.autoSaveProduct && (
                          <Chip size="small" color="primary" variant="outlined" label="AutoSave" />
                        )}
                      </Stack>

                      {job.error?.message && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {job.error.message}
                        </Alert>
                      )}
                    </Stack>
                  </TableCell>

                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Chip
                        label={STATUS_LABEL[job.status] || job.status || '-'}
                        color={STATUS_COLOR[job.status] || 'default'}
                        size="small"
                      />
                      {isFinal && job.isHidden && <Chip size="small" color="warning" label="Archivado" />}
                    </Stack>
                  </TableCell>

                  <TableCell>
                    {job.scheduledAt ? (
                      <Stack spacing={0.5}>
                        <Typography variant="body2">{formatDate(job.scheduledAt)}</Typography>
                        {job.metadata?.addProductAt && (
                          <Typography variant="caption" color="text.secondary">
                            AddProduct: {formatDate(job.metadata.addProductAt)}
                          </Typography>
                        )}
                      </Stack>
                    ) : (
                      '-'
                    )}
                  </TableCell>

                  <TableCell>{formatDate(job.createdAt)}</TableCell>

                  <TableCell align="right">
                    <Tooltip title="Reintentar análisis">
                      <span>
                        <IconButton onClick={() => retryJob(job)} disabled={!canRetry}>
                          <RefreshIcon />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip title="Aprobar y crear producto">
                      <span>
                        <IconButton color="success" onClick={() => openApprove(job)} disabled={!canApprove}>
                          <CheckCircleIcon />
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip title={job.isHidden ? 'Restaurar' : 'Ocultar'}>
                      <span>
                        <IconButton color={job.isHidden ? 'primary' : 'default'} onClick={() => toggleHiddenJob(job)}>
                          {job.isHidden ? <VisibilityIcon /> : <VisibilityOffIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>

                    <Tooltip title="Rechazar">
                      <span>
                        <IconButton color="warning" onClick={() => rejectJob(job)} disabled={!canReject}>
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
                  </TableCell>
                </TableRow>
              )
            })}

            {loading && visibleJobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Box textAlign="center" py={6}>
                    <CircularProgress size={28} />
                    <Typography color="text.secondary" sx={{ mt: 2 }}>
                      Cargando cola de imágenes...
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}

            {!loading && visibleJobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Box textAlign="center" py={6}>
                    <Typography color="text.secondary">
                      No hay imágenes en la cola con los filtros actuales.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={approveOpen} onClose={closeApprove} maxWidth="md" fullWidth>
        <DialogTitle>Aprobar análisis</DialogTitle>

        <DialogContent>
          {selectedJob && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Comercio: <strong>{getTenantDomain(selectedJob)}</strong>
            </Alert>
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

      <Dialog open={deleteOpen} onClose={closeDelete} maxWidth="sm" fullWidth>
        <DialogTitle>Eliminar análisis</DialogTitle>

        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Esta acción elimina el análisis y libera el hash de la imagen para poder volver a cargarla. Si existe un producto vinculado, el backend debe desvincular el job sin eliminar el producto.
          </Alert>

          <Typography variant="body2">
            ¿Querés eliminar permanentemente el análisis <strong>{getAnalysisTitle(selectedJob)}</strong>?
          </Typography>

          {selectedJob && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Comercio: {getTenantDomain(selectedJob)}
            </Typography>
          )}

          {selectedJob?.createdProductId && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
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
