import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormControl,
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

const getJobId = job => job?._id || job?.id

const getAnalysisTitle = job => {
  return job?.analysis?.titulo || job?.analysis?.title || job?.originalFilename || 'Sin título'
}

const formatDate = value => {
  if (!value) return '-'
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

const ProductAnalysisPage = () => {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [sendToAddProduct, setSendToAddProduct] = useState(true)
  const [autoSaveInAddProduct, setAutoSaveInAddProduct] = useState(false)
  const [autoPublishProduct, setAutoPublishProduct] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveForm, setApproveForm] = useState({})

  const queryParams = useMemo(() => {
    const params = { limit: 50, sort: '-createdAt' }
    if (status) params.status = status
    if (search.trim()) params.search = search.trim()
    return params
  }, [search, status])

  const counters = useMemo(() => {
    return jobs.reduce(
      (acc, job) => ({
        ...acc,
        total: acc.total + 1,
        [job.status]: (acc[job.status] || 0) + 1,
      }),
      { total: 0 },
    )
  }, [jobs])

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/product-analysis', { params: queryParams })
      setJobs(Array.isArray(data?.items) ? data.items : [])
      setLastUpdatedAt(new Date())
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo cargar la cola de análisis')
    } finally {
      setLoading(false)
    }
  }, [queryParams])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    const interval = setInterval(fetchJobs, 15000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await api.post('/product-analysis/process-due')
      await fetchJobs()
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

    const form = new FormData()
    form.append('image', file)
    form.append('source', 'manual-upload')
    form.append('originalFilename', file.name)
    form.append('autoAnalyze', String(!sendToAddProduct))
    form.append('autoCreateProduct', 'false')
    form.append('autoSaveProduct', String(sendToAddProduct && autoSaveInAddProduct))
    form.append('autoPublishProduct', String(sendToAddProduct && autoSaveInAddProduct && autoPublishProduct))
    if (scheduledAt) {
      form.append('scheduledAt', new Date(scheduledAt).toISOString())
    }

    setUploading(true)
    try {
      await api.post('/product-analysis/import', form, { isMultipart: true })
      toast.success(
        sendToAddProduct
          ? scheduledAt
            ? 'Imagen programada para AddProduct'
            : 'Imagen enviada a la bandeja de AddProduct'
          : scheduledAt
            ? 'Imagen programada para análisis'
            : 'Imagen importada para análisis',
      )
      fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo importar la imagen')
    } finally {
      setUploading(false)
    }
  }

  const retryJob = async job => {
    try {
      await api.post(`/product-analysis/${getJobId(job)}/retry`)
      toast.success('Reintento iniciado')
      fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo reintentar el análisis')
    }
  }

  const rejectJob = async job => {
    try {
      await api.post(`/product-analysis/${getJobId(job)}/reject`, {
        reason: 'Rechazado desde panel admin',
      })
      toast.success('Análisis rechazado')
      fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo rechazar el análisis')
    }
  }

  const deleteJob = async job => {
    const jobId = getJobId(job)
    const previousJobs = jobs
    setJobs(current => current.filter(item => getJobId(item) !== jobId))

    try {
      await api.delete(`/product-analysis/${jobId}`)
      toast.success('Imagen eliminada de la cola')
      fetchJobs()
    } catch (error) {
      setJobs(previousJobs)
      toast.error(error?.response?.data?.message || 'No se pudo eliminar la imagen')
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
      price: analysis.suggestedPrice || analysis.precio_sugerido || '',
      stock: 0,
      publish: false,
    })
    setApproveOpen(true)
  }

  const approveJob = async () => {
    try {
      await api.post(`/product-analysis/${getJobId(selectedJob)}/approve`, approveForm)
      toast.success('Producto creado como borrador')
      setApproveOpen(false)
      setSelectedJob(null)
      fetchJobs()
    } catch (error) {
      toast.error(error?.response?.data?.message || 'No se pudo aprobar el análisis')
    }
  }

  return (
    <Box>
      <Paper
        sx={{
          p: { xs: 2, md: 3 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" gap={3}>
          <Box>
            <Typography variant="h5" fontWeight={800}>
              Cola de imágenes del agente
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              El agente deja imágenes acá. AddProduct toma la imagen y recién ahí ejecuta la IA.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            <Button
              component="label"
              variant="contained"
              startIcon={<CloudUploadIcon />}
              disabled={uploading}
            >
              {scheduledAt ? 'Programar imagen' : 'Subir imagen'}
              <input hidden accept="image/*" type="file" onChange={handleUpload} />
            </Button>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
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
            gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' },
            gap: 1.5,
            mt: 3,
          }}
        >
          {[
            ['Total', counters.total || 0, 'default'],
            ['Programados', counters.scheduled || 0, 'secondary'],
            ['Pendientes', counters.pending || 0, 'default'],
            ['En AddProduct', counters.imported || 0, 'primary'],
            ['Fallidos', counters.failed || 0, 'error'],
          ].map(([label, value, color]) => (
            <Paper key={label} variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="h5" fontWeight={800} color={`${color}.main`}>
                {value}
              </Typography>
            </Paper>
          ))}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(240px, 420px) 220px 260px' },
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

        <Stack direction={{ xs: 'column', md: 'row' }} gap={2} mt={2} alignItems={{ md: 'center' }}>
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
          {lastUpdatedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: { md: 'auto' } }}>
              Última actualización: {formatDate(lastUpdatedAt)}
            </Typography>
          )}
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Imagen</TableCell>
              <TableCell>Análisis</TableCell>
              <TableCell>Origen</TableCell>
              <TableCell>Estado</TableCell>
              <TableCell>Programación</TableCell>
              <TableCell>Fecha</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {jobs.map(job => (
              <TableRow key={getJobId(job)} hover>
                <TableCell>
                  <Avatar
                    src={job.imageUrl}
                    variant="rounded"
                    sx={{ width: 64, height: 64, bgcolor: 'grey.100' }}
                  />
                </TableCell>
                <TableCell>
                  <Typography fontWeight={700}>{getAnalysisTitle(job)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[job.analysis?.categoria, job.analysis?.subcategoria, job.analysis?.marca]
                      .filter(Boolean)
                      .join(' / ') || job.originalFilename}
                  </Typography>
                  {job.error?.message && (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {job.error.message}
                    </Alert>
                  )}
                </TableCell>
                <TableCell>{job.source}</TableCell>
                <TableCell>
                  <Chip
                    label={job.status}
                    color={STATUS_COLOR[job.status] || 'default'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  {job.scheduledAt ? (
                    <Stack spacing={0.5}>
                      <Typography variant="body2">{formatDate(job.scheduledAt)}</Typography>
                      {job.metadata?.autoAnalyze === false && <Chip label="AddProduct" size="small" />}
                      {job.metadata?.autoSaveProduct && <Chip label="AutoSave" size="small" color="primary" />}
                    </Stack>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{formatDate(job.createdAt)}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Reintentar análisis">
                    <span>
                      <IconButton
                        onClick={() => retryJob(job)}
                        disabled={
                          ['approved', 'rejected', 'processing', 'scheduled', 'imported'].includes(job.status) ||
                          job.metadata?.autoAnalyze === false
                        }
                      >
                        <RefreshIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Aprobar y crear producto">
                    <span>
                      <IconButton
                        color="success"
                        onClick={() => openApprove(job)}
                        disabled={job.status !== 'completed' || Boolean(job.createdProductId)}
                      >
                        <CheckCircleIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Rechazar">
                    <span>
                      <IconButton
                        color="warning"
                        onClick={() => rejectJob(job)}
                        disabled={job.status === 'approved' || job.status === 'rejected' || job.status === 'imported'}
                      >
                        <CancelIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Eliminar de la cola">
                    <span>
                      <IconButton
                        color="error"
                        onClick={() => deleteJob(job)}
                        disabled={Boolean(job.createdProductId)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}

            {!loading && jobs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Box textAlign="center" py={6}>
                    <Typography color="text.secondary">No hay imágenes en la cola.</Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={approveOpen} onClose={() => setApproveOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Aprobar análisis</DialogTitle>
        <DialogContent>
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
                onChange={event => setApproveForm(prev => ({ ...prev, [field]: event.target.value }))}
              />
            ))}
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="descripcion"
              value={approveForm.descripcion || ''}
              onChange={event => setApproveForm(prev => ({ ...prev, descripcion: event.target.value }))}
              sx={{ gridColumn: { md: '1 / -1' } }}
            />
            <TextField
              fullWidth
              type="number"
              label="Precio"
              value={approveForm.price}
              onChange={event => setApproveForm(prev => ({ ...prev, price: Number(event.target.value) }))}
            />
            <TextField
              fullWidth
              type="number"
              label="Stock"
              value={approveForm.stock}
              onChange={event => setApproveForm(prev => ({ ...prev, stock: Number(event.target.value) }))}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={approveJob}>
            Crear borrador
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ProductAnalysisPage
