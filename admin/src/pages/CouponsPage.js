import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'

// Material UI Components
import {
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
  Container,
  Paper,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material'

// Material UI Icons
import {
  Add as AddIcon,
  Bolt as BoltIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Refresh as RefreshIcon,
  FilterList as FilterListIcon,
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
  clearError,
  setFilters,
  selectCouponError,
  permanentDeleteCoupon,
  restoreCoupon,
} from '@features/coupons/couponSlice'

// ======================================================
// CONSTANTES
// ======================================================

const DEFAULT_FILTERS = {
  status: 'all',
  page: 1,
  limit: 20,
  search: '',
  discountType: '',
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'active', label: '✓ Activos' },
  { value: 'scheduled', label: '⏰ Programados' },
  { value: 'expired', label: '⌛ Expirados' },
  { value: 'exhausted', label: '∅ Agotados' },
  { value: 'inactive', label: '⊘ Inactivos' },
  { value: 'deleted', label: '🗑 Eliminados' },
]

// ======================================================
// COMPONENTE PRINCIPAL
// ======================================================

const CouponsPage = () => {
  const dispatch = useDispatch()
  const theme = useTheme()
  const isMounted = useRef(false)

  // ======================================================
  // SELECTORES
  // ======================================================

  const {
    coupons,
    pagination,
    isLoading,
    isSuccess,
    isError,
    message,
    error,
    lastFilters,
  } = useSelector(state => ({
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

  const [filters, setLocalFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    ...lastFilters,
  }))

  const searchTimeout = useRef(null)

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
    dispatch(getAllCoupons(filters))
    dispatch(setFilters(filters))
  }, [
    dispatch,
    filters.status,
    filters.page,
    filters.limit,
    filters.discountType,
  ])

  // Búsqueda con debounce
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      dispatch(getAllCoupons(filters))
      dispatch(setFilters(filters))
    }, 400)
    return () => clearTimeout(searchTimeout.current)
  }, [dispatch, filters.search])

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
        dispatch(getAllCoupons(filters))

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
    [dispatch, filters],
  )

  const handleUpdate = useCallback(
    async data => {
      const id = editingCoupon?.id || editingCoupon?._id
      setIsSubmitting(true)
      try {
        await dispatch(updateCoupon({ id, data })).unwrap()
        setShowForm(false)
        setEditingCoupon(null)
        dispatch(getAllCoupons(filters))
      } finally {
        setIsSubmitting(false)
      }
    },
    [dispatch, editingCoupon, filters],
  )

  const handleDelete = useCallback(
    async coupon => {
      const id = coupon?.id || coupon?._id
      if (
        !window.confirm(
          `¿Eliminar el cupón "${coupon.code}"?\nPodrás restaurarlo desde el filtro "Eliminados".`,
        )
      )
        return
      try {
        await dispatch(deleteCoupon(id)).unwrap()
        dispatch(getAllCoupons(filters))
      } catch (err) {
        toast.error(err?.message || 'Error al eliminar')
      }
    },
    [dispatch, filters],
  )

  const handleRestore = useCallback(
    async coupon => {
      try {
        await dispatch(restoreCoupon(coupon?.id || coupon?._id)).unwrap()
        dispatch(getAllCoupons(filters))
      } catch (err) {
        toast.error(err?.message || 'Error al restaurar')
      }
    },
    [dispatch, filters],
  )

  const handleHardDelete = useCallback(
    async coupon => {
      const id = coupon?.id || coupon?._id
      if (
        !window.confirm(
          `⚠ ELIMINACIÓN PERMANENTE: "${coupon.code}"\nEsta acción no se puede deshacer.`,
        )
      )
        return
      try {
        await dispatch(permanentDeleteCoupon({ id })).unwrap()
        dispatch(getAllCoupons(filters))
      } catch (err) {
        toast.error(err?.message || 'Error en borrado permanente')
      }
    },
    [dispatch, filters],
  )

  const handleClone = useCallback(
    async coupon => {
      try {
        const result = await dispatch(
          cloneCoupon(coupon?.id || coupon?._id),
        ).unwrap()
        toast.success(`Clonado: ${result.code}`)
        dispatch(getAllCoupons(filters))
      } catch (err) {
        toast.error(err?.message || 'Error al clonar')
      }
    },
    [dispatch, filters],
  )

  const openEditModal = coupon => {
    setEditingCoupon(coupon)
    setServerErrors(null)
    setShowForm(true)
  }

  // ======================================================
  // RENDER
  // ======================================================

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={2}
        sx={{ mb: 4 }}
      >
        <Box>
          <Typography
            variant="h4"
            fontWeight="800"
            color="primary.main"
            gutterBottom
          >
            Gestión de Cupones
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {pagination.total} cupones encontrados{' '}
            {filters.search && `para "${filters.search}"`}
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<BoltIcon />}
            onClick={() => setShowBulk(true)}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
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
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 600,
              px: 3,
            }}
          >
            Nuevo Cupón
          </Button>
        </Stack>
      </Stack>

      {/* Barra de Filtros */}
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 4,
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.background.paper, 0.8),
          backdropFilter: 'blur(8px)',
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={3}
          alignItems="center"
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Buscar por código..."
            value={filters.search}
            onChange={e => handleFilterChange('search', e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: filters.search && (
                <IconButton
                  size="small"
                  onClick={() => handleFilterChange('search', '')}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              ),
            }}
            sx={{ flex: 2 }}
          />

          <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
            <InputLabel>Estado</InputLabel>
            <Select
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

          <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
            <InputLabel>Tipo</InputLabel>
            <Select
              value={filters.discountType}
              label="Tipo"
              onChange={e => handleFilterChange('discountType', e.target.value)}
            >
              <MenuItem value="">Todos los tipos</MenuItem>
              <MenuItem value="percentage">Porcentaje %</MenuItem>
              <MenuItem value="fixed_amount">Monto fijo $</MenuItem>
            </Select>
          </FormControl>

          <Stack direction="row" spacing={1}>
            <Tooltip title="Recargar">
              <IconButton onClick={() => dispatch(getAllCoupons(filters))}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {(filters.search ||
              filters.status !== 'all' ||
              filters.discountType) && (
              <Button
                size="small"
                onClick={() => setLocalFilters(DEFAULT_FILTERS)}
                sx={{ textTransform: 'none' }}
              >
                Limpiar
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      {/* Lista */}
      <Box sx={{ minHeight: 400 }}>
        {isLoading && !coupons.length ? (
          <Stack alignItems="center" sx={{ py: 10 }}>
            <CircularProgress />
            <Typography sx={{ mt: 2 }} color="text.secondary">
              Cargando cupones...
            </Typography>
          </Stack>
        ) : (
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
        )}
      </Box>

      {/* Modales */}
      <Modal
        isOpen={showForm}
        onClose={() => !isSubmitting && setShowForm(false)}
        title={
          editingCoupon
            ? `Editar Cupón: ${editingCoupon.code}`
            : 'Crear Nuevo Cupón'
        }
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
          onSuccess={res => {
            setShowBulk(false)
            dispatch(getAllCoupons(filters))
          }}
          onCancel={() => setShowBulk(false)}
        />
      </Modal>
    </Container>
  )
}

export default React.memo(CouponsPage)
