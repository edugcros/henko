import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'

// Material UI Components
import {
  Alert,
  Box,
  Typography,
  Button,
  Stack,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  InputAdornment,
  IconButton,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Tooltip,
} from '@mui/material'

// Material UI Icons
import {
  Add as AddIcon,
  Bolt as BoltIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Refresh as RefreshIcon,
  FilterAltOff as FilterAltOffIcon,
} from '@mui/icons-material'

// Components
import CouponList from '@components/coupons/CouponList'
import CouponForm from '@components/coupons/CouponForm'
import BulkGenerator from '@components/coupons/BulkGenerator'
import Modal from '@components/common/Modal'

// Redux actions
import {
  getAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  cloneCoupon,
  clearMessages,
  setFilters,
  selectCouponError,
  permanentDeleteCoupon,
  restoreCoupon,
} from '@features/coupons/couponSlice'

// ======================================================
// CONSTANTES
// ======================================================

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const DEFAULT_FILTERS = {
  status: 'all',
  page: 1,
  limit: 20,
  search: '',
  discountType: '',
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'active', label: 'Activos' },
  { value: 'scheduled', label: 'Programados' },
  { value: 'expired', label: 'Expirados' },
  { value: 'exhausted', label: 'Agotados' },
  { value: 'inactive', label: 'Inactivos' },
  { value: 'deleted', label: 'Eliminados' },
]

// ======================================================
// COMPONENTE PRINCIPAL
// ======================================================

const CouponsPage = () => {
  const dispatch = useDispatch()
  const isMounted = useRef(false)
  const searchMounted = useRef(false)

  // ======================================================
  // SELECTORES
  // ======================================================

  const { coupons, pagination, isLoading, isSuccess, isError, message, error, lastFilters } =
    useSelector(state => ({
      coupons: state.coupon.coupons || [],
      pagination: state.coupon.pagination || { total: 0, page: 1, pages: 1 },
      isLoading: state.coupon.isLoading,
      isSuccess: state.coupon.isSuccess,
      isError: state.coupon.isError,
      message: state.coupon.message,
      error: selectCouponError(state),
      lastFilters: state.coupon.lastFilters,
    }))

  // ======================================================
  // ESTADOS LOCALES
  // ======================================================

  const [showForm, setShowForm] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverErrors, setServerErrors] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  // Confirmación antes de eliminar: { coupon, permanent }
  const [confirming, setConfirming] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const [filters, setLocalFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...lastFilters,
  }))

  const searchTimeout = useRef(null)

  // Pide la lista y recuerda si falló: el estado del slice se limpia apenas se avisa el error, y
  // sin esto una lista que no se pudo cargar se veía igual que «no hay cupones».
  const loadCoupons = useCallback(
    currentFilters => {
      dispatch(setFilters(currentFilters))

      return dispatch(getAllCoupons(currentFilters))
        .unwrap()
        .then(() => setLoadFailed(false))
        .catch(() => setLoadFailed(true))
    },
    [dispatch],
  )

  // ======================================================
  // EFECTOS
  // ======================================================

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      if (searchTimeout.current) clearTimeout(searchTimeout.current)
    }
  }, [])

  // Carga inicial y por filtros (excepto búsqueda)
  useEffect(() => {
    loadCoupons(filters)
  }, [loadCoupons, filters.status, filters.page, filters.limit, filters.discountType])

  // Búsqueda con espera. No corre al abrir: la carga de arriba ya pidió la lista, y esta pedía la
  // misma una segunda vez 400 ms después.
  useEffect(() => {
    if (!searchMounted.current) {
      searchMounted.current = true
      return undefined
    }

    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      loadCoupons(filters)
    }, 400)
    return () => clearTimeout(searchTimeout.current)
  }, [loadCoupons, filters.search])

  // Notificaciones Success/Error
  useEffect(() => {
    if (!isMounted.current) return
    if (isSuccess && message) {
      toast.success(message)
      dispatch(clearMessages())
    }
    if (isError && message) {
      toast.error(message)
      dispatch(clearMessages())
    }
  }, [isSuccess, isError, message, dispatch])

  useEffect(() => {
    if (error?.isValidation) {
      setServerErrors({ [error.field]: error.message })
    }
  }, [error])

  // ======================================================
  // HANDLERS DE OPERACIONES (CRUD)
  // ======================================================

  const handleFilterChange = useCallback((key, value) => {
    setLocalFilters(prev => ({
      ...prev,
      [key]: value,
      page: key !== 'page' ? 1 : value,
    }))
    setServerErrors(null)
  }, [])

  const handleCreate = useCallback(
    async data => {
      setIsSubmitting(true)
      setServerErrors(null)

      try {
        const result = await dispatch(createCoupon(data)).unwrap()

        toast.success(`Cupón ${result.code} creado exitosamente`)
        setShowForm(false)

        // Refrescar lista
        loadCoupons(filters)

        return result
      } catch (err) {
        const errorMsg = err?.message || 'Error al crear cupón'

        if (err?.code === 'DUPLICATE_CODE') {
          setServerErrors({ code: 'Este código ya existe. Usa otro.' })
          toast.error('El código de cupón ya existe')
        } else if (err?.errors) {
          // Errores de validación múltiples
          const fieldErrors = {}
          err.errors.forEach(e => {
            if (e.field) fieldErrors[e.field] = e.message
          })
          setServerErrors(fieldErrors)
          toast.error('Corrige los errores del formulario')
        } else {
          toast.error(errorMsg)
        }
      } finally {
        setIsSubmitting(false)
      }
    },
    [dispatch, filters, loadCoupons],
  )

  const handleUpdate = useCallback(
    async data => {
      const id = editingCoupon?.id || editingCoupon?._id
      setIsSubmitting(true)
      try {
        await dispatch(updateCoupon({ id, data })).unwrap()
        setShowForm(false)
        setEditingCoupon(null)
        loadCoupons(filters)
      } catch {
        // El slice ya avisó el error (y marcó el campo si era de validación): el formulario sigue
        // abierto para corregirlo. Antes el rechazo llegaba sin atrapar hasta el formulario.
      } finally {
        setIsSubmitting(false)
      }
    },
    [dispatch, editingCoupon, filters, loadCoupons],
  )

  const handleDelete = useCallback(coupon => setConfirming({ coupon, permanent: false }), [])

  const handleHardDelete = useCallback(coupon => setConfirming({ coupon, permanent: true }), [])

  const handleConfirmDelete = useCallback(async () => {
    if (!confirming || confirmBusy) return

    const { coupon, permanent } = confirming
    const id = coupon?.id || coupon?._id

    setConfirmBusy(true)

    try {
      if (permanent) {
        await dispatch(permanentDeleteCoupon({ id })).unwrap()
      } else {
        await dispatch(deleteCoupon(id)).unwrap()
      }
      loadCoupons(filters)
    } catch (err) {
      toast.error(err?.message || (permanent ? 'Error en borrado permanente' : 'Error al eliminar'))
    } finally {
      setConfirmBusy(false)
      setConfirming(null)
    }
  }, [confirming, confirmBusy, dispatch, filters, loadCoupons])

  const handleRestore = useCallback(
    async coupon => {
      try {
        await dispatch(restoreCoupon(coupon?.id || coupon?._id)).unwrap()
        loadCoupons(filters)
      } catch (err) {
        toast.error(err?.message || 'Error al restaurar')
      }
    },
    [dispatch, filters, loadCoupons],
  )

  const handleClone = useCallback(
    async coupon => {
      try {
        const result = await dispatch(cloneCoupon(coupon?.id || coupon?._id)).unwrap()
        toast.success(`Clonado: ${result.code}`)
        loadCoupons(filters)
      } catch (err) {
        toast.error(err?.message || 'Error al clonar')
      }
    },
    [dispatch, filters, loadCoupons],
  )

  const openEditModal = coupon => {
    setEditingCoupon(coupon)
    setServerErrors(null)
    setShowForm(true)
  }

  const hayFiltros = Boolean(filters.search || filters.status !== 'all' || filters.discountType)

  // ======================================================
  // RENDER
  // ======================================================

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
      {/* Header */}
      <Box
        component="header"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'flex-end' },
          gap: 2,
          mb: 4,
        }}
      >
        <Box>
          <Typography
            variant="overline"
            sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
          >
            PROMOCIONES
          </Typography>
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
            Cupones
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {pagination.total} cupones encontrados {filters.search && `para "${filters.search}"`}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            startIcon={<BoltIcon />}
            onClick={() => setShowBulk(true)}
            sx={{
              borderRadius: 3,
              textTransform: 'none',
              fontWeight: 700,
              flex: { xs: 1, sm: 'none' },
            }}
          >
            Generar Masivo
          </Button>
          <Button
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={() => {
              setEditingCoupon(null)
              setShowForm(true)
            }}
            sx={{
              borderRadius: 3,
              textTransform: 'none',
              fontWeight: 700,
              px: 3,
              background: GRADIENT,
              flex: { xs: 1, sm: 'none' },
            }}
          >
            Nuevo Cupón
          </Button>
        </Stack>
      </Box>

      {/* Barra de Filtros */}
      <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' } }}
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Buscar por código..."
            value={filters.search}
            onChange={e => handleFilterChange('search', e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: filters.search && (
                  <IconButton
                    size="small"
                    aria-label="Borrar la búsqueda"
                    onClick={() => handleFilterChange('search', '')}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                ),
              },
              htmlInput: { 'aria-label': 'Buscar cupones' },
            }}
            sx={{ maxWidth: { md: 360 } }}
          />

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="cupones-estado-label">Estado</InputLabel>
            <Select
              labelId="cupones-estado-label"
              value={filters.status}
              label="Estado"
              onChange={e => handleFilterChange('status', e.target.value)}
            >
              {STATUS_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="cupones-tipo-label">Tipo</InputLabel>
            <Select
              labelId="cupones-tipo-label"
              value={filters.discountType}
              label="Tipo"
              onChange={e => handleFilterChange('discountType', e.target.value)}
            >
              <MenuItem value="">Todos los tipos</MenuItem>
              <MenuItem value="percentage">Porcentaje %</MenuItem>
              <MenuItem value="fixed_amount">Monto fijo $</MenuItem>
            </Select>
          </FormControl>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Tooltip title="Recargar">
              <IconButton aria-label="Recargar" onClick={() => loadCoupons(filters)}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {hayFiltros && (
              <Button
                size="small"
                startIcon={<FilterAltOffIcon />}
                onClick={() => setLocalFilters(DEFAULT_FILTERS)}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Limpiar filtros
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      {isLoading && coupons.length > 0 && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

      {loadFailed && coupons.length === 0 && (
        <Alert
          severity="error"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => loadCoupons(filters)}>
              Reintentar
            </Button>
          }
        >
          No se pudieron cargar los cupones.
        </Alert>
      )}

      {/* Lista */}
      <Box sx={{ minHeight: 300 }}>
        {isLoading && !coupons.length ? (
          <Stack sx={{ alignItems: 'center', py: 10 }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }} color="text.secondary">
              Cargando cupones...
            </Typography>
          </Stack>
        ) : (
          !(loadFailed && coupons.length === 0) && (
            <CouponList
              coupons={coupons}
              loading={isLoading}
              onEdit={openEditModal}
              onSoftDelete={handleDelete}
              onRestore={handleRestore}
              onHardDelete={handleHardDelete}
              onClone={handleClone}
              showDeleted={filters.status === 'deleted'}
              pagination={pagination}
              onPageChange={page => handleFilterChange('page', page)}
            />
          )
        )}
      </Box>

      {/* Modales */}
      <Modal
        isOpen={showForm}
        onClose={() => !isSubmitting && setShowForm(false)}
        title={editingCoupon ? `Editar Cupón: ${editingCoupon.code}` : 'Crear Nuevo Cupón'}
        size="large"
      >
        <CouponForm
          key={editingCoupon?.id || 'new'}
          initialData={editingCoupon}
          onSubmit={editingCoupon ? handleUpdate : handleCreate}
          onCancel={() => setShowForm(false)}
          isSubmitting={isSubmitting}
          serverErrors={serverErrors}
        />
      </Modal>

      <Modal
        isOpen={showBulk}
        onClose={() => setShowBulk(false)}
        title="Generador de Cupones"
        size="medium"
      >
        <BulkGenerator
          onSuccess={() => {
            setShowBulk(false)
            loadCoupons(filters)
          }}
          onCancel={() => setShowBulk(false)}
        />
      </Modal>

      {/* Confirmación de eliminación (antes era el cuadro nativo del navegador) */}
      <Dialog
        open={Boolean(confirming)}
        onClose={() => !confirmBusy && setConfirming(null)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="cupones-confirmar-titulo"
      >
        <DialogTitle
          id="cupones-confirmar-titulo"
          sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}
        >
          {confirming?.permanent ? 'Eliminación permanente' : 'Eliminar cupón'}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {confirming?.permanent
              ? `Vas a eliminar para siempre el cupón "${confirming?.coupon?.code}". Esta acción no se puede deshacer.`
              : `¿Eliminar el cupón "${confirming?.coupon?.code}"? Podrás restaurarlo desde el filtro "Eliminados".`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirming(null)} color="inherit" disabled={confirmBusy}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            disabled={confirmBusy}
            startIcon={confirmBusy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {confirming?.permanent ? 'Eliminar para siempre' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default React.memo(CouponsPage)
