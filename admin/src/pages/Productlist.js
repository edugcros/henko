import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { getAdminProducts, updateAProduct, deleteProduct } from '@features/product/productSlice'
import {
  Box,
  Typography,
  ButtonBase,
  IconButton,
  Tooltip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  Chip,
  Avatar,
  TextField,
  InputAdornment,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Pagination,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Menu,
  Divider,
  Stack,
  useTheme,
  useMediaQuery,
  alpha,
  Alert,
  Snackbar,
  LinearProgress,
} from '@mui/material'
import {
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Inventory as InventoryIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  MoreVert as MoreVertIcon,
  Archive as ArchiveIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Drafts as DraftsIcon,
  FilterAltOff as FilterOffIcon,
} from '@mui/icons-material'

// ============================================================================
// CONSTANTES
// ============================================================================

// Estados reales del modelo Product (backend/src/models/productModel.js).
// Única fuente de verdad para label/color en esta pantalla.
const PRODUCT_STATUS_META = {
  active: { label: 'Activo', color: 'success' },
  draft: { label: 'Borrador', color: 'default' },
  archived: { label: 'Archivado', color: 'default' },
  'out-of-stock': { label: 'Sin stock', color: 'error' },
}

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  ...Object.entries(PRODUCT_STATUS_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
]

const VISIBILITY_FILTER_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'visible', label: 'Visibles' },
  { value: 'hidden', label: 'Ocultos' },
]

const DEFAULT_LOW_STOCK_THRESHOLD = 5
const SEARCH_DEBOUNCE_MS = 400

// Identidad de Henkart (la misma de la pantalla de planes, las de acceso y el Dashboard).
const BRAND = {
  blue: '#0b6bff',
  violet: '#7a2cff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const HEAD_CELL_SX = {
  fontWeight: 700,
  color: BRAND.muted,
  fontSize: 13,
  letterSpacing: '0.04em',
  py: 1.5,
}

// Las etiquetas de la paginación vienen en inglés por defecto («Go to page 3»): un lector de pantalla
// las leía así en una interfaz en español.
const getPaginationLabel = (type, page, selected) => {
  if (type === 'page') return selected ? `Página ${page}, actual` : `Ir a la página ${page}`
  if (type === 'first') return 'Primera página'
  if (type === 'last') return 'Última página'
  if (type === 'next') return 'Página siguiente'

  return 'Página anterior'
}

// ============================================================================
// HELPERS
// ============================================================================

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getTenantId = user => {
  if (!user?.tenantId) return null
  if (typeof user.tenantId === 'string') return user.tenantId
  return user.tenantId?._id || null
}

const getProductMainImage = product => {
  if (Array.isArray(product?.images) && product.images.length > 0) {
    const main = product.images.find(img => img?.isMain)
    return main?.url || product.images[0]?.url || ''
  }
  return ''
}

const getProductBrand = product => {
  return product?.marca || product?.brand || 'Sin marca'
}

const getProductSku = product => {
  if (product?.sku) return product.sku

  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    const firstWithSku = product.variants.find(variant => variant?.sku)
    return firstWithSku?.sku || '-'
  }

  return '-'
}

const getLowStockThreshold = product =>
  toNumber(product?.lowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD)

const formatPrice = price =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(toNumber(price, 0))

const buildBackendSort = (field, order) => {
  const key = field === 'createdAt' ? 'created' : field
  return `${key}-${order}`
}

// ============================================================================
// SUB-COMPONENTE: SummaryTile
// ============================================================================

const SummaryTile = ({ title, value, icon, color, onClick, active }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={Boolean(active)}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 1,
      p: 2.5,
      textAlign: 'left',
      borderBottom: '3px solid',
      borderBottomColor: active ? color : 'transparent',
      borderRight: '1px solid',
      borderRightColor: BRAND.line,
      backgroundColor: active ? alpha(color, 0.06) : 'transparent',
      transition: 'background-color 0.15s ease',
      '&:hover': { backgroundColor: alpha(color, 0.06) },
      '&.Mui-focusVisible': { outline: `2px solid ${color}`, outlineOffset: -2 },
    }}
  >
    <Box
      aria-hidden="true"
      sx={{
        p: 0.75,
        borderRadius: 2,
        backgroundColor: alpha(color, 0.1),
        color,
        display: 'flex',
      }}
    >
      {React.cloneElement(icon, { sx: { fontSize: 20 } })}
    </Box>
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Typography
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 800,
          fontSize: 26,
          lineHeight: 1.15,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
    </Box>
  </ButtonBase>
)

// ============================================================================
// COMPONENTE: Productlist
// ============================================================================

const Productlist = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const theme = useTheme()
  // En un celular la tabla obligaba a deslizar de costado y los botones de cada fila quedaban fuera
  // de pantalla. Ahí cada producto se muestra como una tarjeta con todo a la vista.
  const isNarrow = useMediaQuery('(max-width:600px)')

  const {
    adminProducts = [],
    adminMeta,
    adminStats,
    isAdminLoading,
    isAdminError,
    adminMessage,
  } = useSelector(state => state.product)
  const user = useSelector(state => state.user.user)

  const tenantId = useMemo(() => getTenantId(user), [user])
  const hasLoadedOnce = useRef(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [statusFilter, setStatusFilter] = useState('')
  const [visibilityFilter, setVisibilityFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [mutatingId, setMutatingId] = useState(null)
  const [menuAnchorEl, setMenuAnchorEl] = useState(null)
  const [menuProduct, setMenuProduct] = useState(null)
  const [stockDialog, setStockDialog] = useState({
    open: false,
    product: null,
    stockValue: '',
    thresholdValue: '',
  })
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  // ============================================================================
  // DEBOUNCE DE BÚSQUEDA
  // ============================================================================

  useEffect(() => {
    const next = searchInput.trim()

    // Solo si la búsqueda CAMBIÓ. Antes el temporizador arrancaba igual al abrir la lista y, al
    // cumplirse (400 ms), volvía a la página 1 aunque nadie hubiera buscado nada: quien pasaba de
    // página en esos primeros instantes rebotaba, y escribir un espacio al final de una búsqueda
    // vigente también lo mandaba a la 1.
    if (next === searchTerm) return undefined

    const handle = setTimeout(() => {
      setSearchTerm(next)
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [searchInput, searchTerm])

  // ============================================================================
  // FETCH (server-side: búsqueda, filtros, orden y paginación)
  // ============================================================================

  useEffect(() => {
    if (!tenantId) return

    dispatch(
      getAdminProducts({
        tenantId,
        page,
        limit: rowsPerPage,
        q: searchTerm || undefined,
        status: statusFilter || undefined,
        visibility: visibilityFilter || undefined,
        stockFilter: stockFilter || undefined,
        sort: buildBackendSort(sortBy, sortOrder),
      }),
    )
      .unwrap()
      .then(() => {
        hasLoadedOnce.current = true
      })
      .catch(err => {
        console.error('Error fetching products:', err?.message || err)
      })
  }, [
    tenantId,
    dispatch,
    page,
    rowsPerPage,
    searchTerm,
    statusFilter,
    visibilityFilter,
    stockFilter,
    sortBy,
    sortOrder,
  ])

  // ============================================================================
  // HANDLERS: FILTROS (page se resetea junto con el filtro, en el mismo
  // batch de estado, para no disparar un fetch extra con la página vieja)
  // ============================================================================

  const handleStatusFilterChange = useCallback(value => {
    setStatusFilter(value)
    setPage(1)
  }, [])

  const handleVisibilityFilterChange = useCallback(value => {
    setVisibilityFilter(value)
    setPage(1)
  }, [])

  const toggleStockFilter = useCallback(value => {
    setStockFilter(prev => (prev === value ? '' : value))
    setPage(1)
  }, [])

  const toggleStatusFilter = useCallback(value => {
    setStatusFilter(prev => (prev === value ? '' : value))
    setPage(1)
  }, [])

  const handleRowsPerPageChange = useCallback(value => {
    setRowsPerPage(value)
    setPage(1)
  }, [])

  const handleSort = useCallback(field => {
    setPage(1)
    setSortBy(prevField => {
      if (prevField === field) {
        setSortOrder(prevOrder => (prevOrder === 'asc' ? 'desc' : 'asc'))
        return prevField
      }

      setSortOrder('asc')
      return field
    })
  }, [])

  // ============================================================================
  // HANDLERS: ACCIONES RÁPIDAS
  // ============================================================================

  const closeMenu = useCallback(() => {
    setMenuAnchorEl(null)
    setMenuProduct(null)
  }, [])

  const openMenu = useCallback((event, product) => {
    setMenuAnchorEl(event.currentTarget)
    setMenuProduct(product)
  }, [])

  const runQuickUpdate = useCallback(
    async (productId, data) => {
      setMutatingId(productId)

      try {
        await dispatch(updateAProduct({ productId, data })).unwrap()
      } catch {
        // El thunk ya muestra el toast de error.
      } finally {
        setMutatingId(null)
      }
    },
    [dispatch],
  )

  const handleChangeStatus = useCallback(
    (product, newStatus) => {
      closeMenu()
      runQuickUpdate(product._id, {
        status: newStatus,
        ...(newStatus === 'archived' ? { visibility: 'hidden' } : {}),
      })
    },
    [closeMenu, runQuickUpdate],
  )

  const handleToggleVisibility = useCallback(
    product => {
      closeMenu()
      const nextVisibility = product.visibility === 'hidden' ? 'visible' : 'hidden'
      runQuickUpdate(product._id, { visibility: nextVisibility })
    },
    [closeMenu, runQuickUpdate],
  )

  const openStockDialog = useCallback(product => {
    setStockDialog({
      open: true,
      product,
      stockValue: String(toNumber(product?.stock, 0)),
      thresholdValue: String(getLowStockThreshold(product)),
    })
  }, [])

  const closeStockDialog = useCallback(() => {
    setStockDialog({
      open: false,
      product: null,
      stockValue: '',
      thresholdValue: '',
    })
  }, [])

  const handleSaveStock = useCallback(async () => {
    const { product, stockValue, thresholdValue } = stockDialog
    if (!product?._id) return

    const nextStock = Math.max(0, Math.trunc(toNumber(stockValue, 0)))
    const nextThreshold = Math.max(
      0,
      Math.trunc(toNumber(thresholdValue, DEFAULT_LOW_STOCK_THRESHOLD)),
    )

    setMutatingId(product._id)

    try {
      await dispatch(
        updateAProduct({
          productId: product._id,
          data: { stock: nextStock, lowStockThreshold: nextThreshold },
        }),
      ).unwrap()
      closeStockDialog()
    } catch {
      // El thunk ya muestra el toast de error.
    } finally {
      setMutatingId(null)
    }
  }, [dispatch, stockDialog, closeStockDialog])

  const handleDeleteClick = useCallback(
    product => {
      closeMenu()
      setSelectedProduct(product)
      setConfirmOpen(true)
    },
    [closeMenu],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!selectedProduct?._id) {
      setConfirmOpen(false)
      setSelectedProduct(null)
      return
    }

    try {
      await dispatch(deleteProduct(selectedProduct._id)).unwrap()

      setSnackbar({
        open: true,
        severity: 'success',
        message: 'Producto eliminado permanentemente',
      })
    } catch (error) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: error?.message || 'No se pudo eliminar el producto',
      })
    } finally {
      setConfirmOpen(false)
      setSelectedProduct(null)
    }
  }, [dispatch, selectedProduct])

  const handleCloseSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }))
  }, [])

  const getStockStatus = useCallback(
    (stock, minAlert) => {
      if (stock <= 0) {
        return {
          label: 'Sin stock',
          bgColor: theme.palette.error.main,
          icon: <TrendingDownIcon fontSize="small" />,
        }
      }

      if (stock < minAlert) {
        return {
          label: 'Stock bajo',
          bgColor: theme.palette.warning.main,
          icon: <TrendingDownIcon fontSize="small" />,
        }
      }

      return {
        label: 'Disponible',
        bgColor: theme.palette.success.main,
        icon: <TrendingUpIcon fontSize="small" />,
      }
    },
    [theme.palette.error.main, theme.palette.success.main, theme.palette.warning.main],
  )

  // ============================================================================
  // RENDER STATES
  // ============================================================================

  const stats = adminStats || {
    total: 0,
    byStatus: {},
    lowStock: 0,
    outOfStock: 0,
  }
  const totalPages = adminMeta?.totalPages || 1

  // Spinner de página completa solo en la carga inicial. Las recargas
  // posteriores (filtros, acciones rápidas) muestran una barra fina
  // arriba para no perder el scroll ni el contexto visual de la tabla.
  if (isAdminLoading && !hasLoadedOnce.current) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
      >
        <CircularProgress size={60} />
      </Box>
    )
  }

  const hayFiltros = Boolean(searchInput.trim() || statusFilter || visibilityFilter || stockFilter)

  const clearFilters = () => {
    setSearchInput('')
    setSearchTerm('')
    setStatusFilter('')
    setVisibilityFilter('')
    setStockFilter('')
    setPage(1)
  }

  const clearStatusAndStock = () => {
    setStatusFilter('')
    setStockFilter('')
    setPage(1)
  }

  const sortCell = field => ({
    sortDirection: sortBy === field ? sortOrder : false,
  })

  const catalogoVacio = !hayFiltros && stats.total === 0

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
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
            CATÁLOGO
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
            Productos
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {stats.total} {stats.total === 1 ? 'producto' : 'productos'} en catálogo
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="large"
          startIcon={<AddIcon />}
          onClick={() => navigate('/admin/AddProduct')}
          sx={{
            borderRadius: 3,
            textTransform: 'none',
            fontWeight: 700,
            px: 3,
            background: GRADIENT,
            flexShrink: 0,
          }}
        >
          Nuevo producto
        </Button>
      </Box>

      {/* El resumen es también el filtro rápido: cada cifra se toca para ver esos productos. */}
      <Paper
        component="section"
        aria-label="Resumen del catálogo"
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
          <SummaryTile
            title="Total"
            value={stats.total}
            icon={<InventoryIcon />}
            color={BRAND.blue}
            onClick={clearStatusAndStock}
            active={!statusFilter && !stockFilter}
          />
          <SummaryTile
            title="Activos"
            value={stats.byStatus?.active || 0}
            icon={<TrendingUpIcon />}
            color={theme.palette.success.main}
            onClick={() => toggleStatusFilter('active')}
            active={statusFilter === 'active'}
          />
          <SummaryTile
            title="Borradores"
            value={stats.byStatus?.draft || 0}
            icon={<DraftsIcon />}
            color={BRAND.violet}
            onClick={() => toggleStatusFilter('draft')}
            active={statusFilter === 'draft'}
          />
          <SummaryTile
            title="Archivados"
            value={stats.byStatus?.archived || 0}
            icon={<ArchiveIcon />}
            color={theme.palette.text.secondary}
            onClick={() => toggleStatusFilter('archived')}
            active={statusFilter === 'archived'}
          />
          <SummaryTile
            title="Stock Bajo"
            value={stats.lowStock || 0}
            icon={<TrendingDownIcon />}
            color={theme.palette.warning.main}
            onClick={() => toggleStockFilter('low')}
            active={stockFilter === 'low'}
          />
          <SummaryTile
            title="Sin Stock"
            value={stats.outOfStock || 0}
            icon={<TrendingDownIcon />}
            color={theme.palette.error.main}
            onClick={() => toggleStockFilter('out')}
            active={stockFilter === 'out'}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' } }}
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Buscar por nombre, marca, categoría, subcategoría o SKU..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Buscar productos' },
            }}
            sx={{ maxWidth: { md: 540 } }}
          />

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="filtro-estado-label">Estado</InputLabel>
            <Select
              labelId="filtro-estado-label"
              label="Estado"
              value={statusFilter}
              onChange={e => handleStatusFilterChange(e.target.value)}
            >
              {STATUS_FILTER_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="filtro-visibilidad-label">Visibilidad</InputLabel>
            <Select
              labelId="filtro-visibilidad-label"
              label="Visibilidad"
              value={visibilityFilter}
              onChange={e => handleVisibilityFilterChange(e.target.value)}
            >
              {VISIBILITY_FILTER_OPTIONS.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {hayFiltros && (
            <Button
              onClick={clearFilters}
              startIcon={<FilterOffIcon />}
              sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
            >
              Limpiar filtros
            </Button>
          )}

          <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <Select
              value={rowsPerPage}
              onChange={e => handleRowsPerPageChange(Number(e.target.value))}
              SelectDisplayProps={{ 'aria-label': 'Productos por página' }}
            >
              <MenuItem value={10}>10 por página</MenuItem>
              <MenuItem value={25}>25 por página</MenuItem>
              <MenuItem value={50}>50 por página</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Paper>

      {isAdminLoading && hasLoadedOnce.current && (
        <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />
      )}

      {isAdminError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {adminMessage || 'Error al cargar productos'}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ ...PANEL_SX, overflow: 'hidden' }}>
        {isNarrow ? (
          <Stack spacing={1.5} sx={{ p: 1.5 }}>
            {adminProducts.map(product => {
              const stock = toNumber(product.stock, 0)
              const minAlert = getLowStockThreshold(product)
              const stockStatus = getStockStatus(stock, minAlert)
              const isMutating = mutatingId === product._id
              const statusMeta = PRODUCT_STATUS_META[product.status] || {
                label: product.status || 'Sin estado',
                color: 'default',
              }

              return (
                <Paper
                  key={product._id}
                  component="article"
                  variant="outlined"
                  sx={{
                    p: 2,
                    borderRadius: 3,
                    borderColor: BRAND.line,
                    opacity: isMutating ? 0.6 : 1,
                    backgroundColor: stock === 0 ? alpha(theme.palette.error.main, 0.04) : '#fff',
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                    <Avatar
                      src={getProductMainImage(product)}
                      alt={product.title}
                      variant="rounded"
                      sx={{ width: 56, height: 56, borderRadius: 3, bgcolor: BRAND.paper }}
                    >
                      {product.title?.charAt(0) || '?'}
                    </Avatar>

                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {product.title || 'Sin título'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {getProductBrand(product)}
                        {product.visibility === 'hidden' && ' · Oculto'}
                      </Typography>
                      <Typography
                        sx={{
                          mt: 0.5,
                          fontFamily: DISPLAY_FONT,
                          fontWeight: 800,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatPrice(product.price)}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', flexShrink: 0 }}>
                      <Tooltip title="Editar">
                        <IconButton
                          size="small"
                          disabled={isMutating}
                          onClick={() => navigate(`/admin/edit-product/${product._id}`)}
                          sx={{ color: BRAND.blue }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      <Tooltip title="Más acciones">
                        <IconButton
                          size="small"
                          disabled={isMutating}
                          onClick={e => openMenu(e, product)}
                        >
                          {isMutating ? (
                            <CircularProgress size={18} />
                          ) : (
                            <MoreVertIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      flexWrap: 'wrap',
                      mt: 1.5,
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: DISPLAY_FONT,
                        fontWeight: 800,
                        minWidth: 24,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                      color={
                        stock === 0
                          ? 'error.main'
                          : stock < minAlert
                            ? 'warning.main'
                            : 'success.main'
                      }
                    >
                      {stock}
                    </Typography>

                    <Chip
                      icon={stockStatus.icon}
                      label={stockStatus.label}
                      size="small"
                      sx={{
                        backgroundColor: alpha(stockStatus.bgColor, 0.1),
                        color: stockStatus.bgColor,
                        fontWeight: 600,
                        border: `1px solid ${alpha(stockStatus.bgColor, 0.3)}`,
                        '& .MuiChip-icon': { color: stockStatus.bgColor },
                      }}
                    />

                    {product.hasVariants && (
                      <Chip label="Variantes" size="small" variant="outlined" />
                    )}

                    <Chip
                      label={statusMeta.label}
                      size="small"
                      color={statusMeta.color}
                      variant={product.status === 'active' ? 'filled' : 'outlined'}
                    />
                  </Box>
                </Paper>
              )
            })}
          </Stack>
        ) : (
          <TableContainer>
            <Table size="medium" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow sx={{ backgroundColor: BRAND.paper }}>
                  <TableCell {...sortCell('title')} sx={HEAD_CELL_SX}>
                    <TableSortLabel
                      active={sortBy === 'title'}
                      direction={sortBy === 'title' ? sortOrder : 'asc'}
                      onClick={() => handleSort('title')}
                    >
                      Producto
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...HEAD_CELL_SX, display: { xs: 'none', md: 'table-cell' } }}>
                    SKU
                  </TableCell>
                  <TableCell sx={{ ...HEAD_CELL_SX, display: { xs: 'none', lg: 'table-cell' } }}>
                    Categoría
                  </TableCell>
                  <TableCell {...sortCell('price')} sx={HEAD_CELL_SX}>
                    <TableSortLabel
                      active={sortBy === 'price'}
                      direction={sortBy === 'price' ? sortOrder : 'asc'}
                      onClick={() => handleSort('price')}
                    >
                      Precio
                    </TableSortLabel>
                  </TableCell>
                  <TableCell {...sortCell('stock')} sx={HEAD_CELL_SX}>
                    <TableSortLabel
                      active={sortBy === 'stock'}
                      direction={sortBy === 'stock' ? sortOrder : 'asc'}
                      onClick={() => handleSort('stock')}
                    >
                      Stock
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={HEAD_CELL_SX}>Estado</TableCell>
                  <TableCell align="right" sx={HEAD_CELL_SX}>
                    Acciones
                  </TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {adminProducts.map(product => {
                  const stock = toNumber(product.stock, 0)
                  const minAlert = getLowStockThreshold(product)
                  const stockStatus = getStockStatus(stock, minAlert)
                  const isMutating = mutatingId === product._id
                  const statusMeta = PRODUCT_STATUS_META[product.status] || {
                    label: product.status || 'Sin estado',
                    color: 'default',
                  }

                  return (
                    <TableRow
                      key={product._id}
                      hover
                      sx={{
                        '&:last-child td, &:last-child th': { border: 0 },
                        opacity: isMutating ? 0.6 : 1,
                        backgroundColor:
                          stock === 0 ? alpha(theme.palette.error.main, 0.04) : 'inherit',
                      }}
                    >
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Avatar
                            src={getProductMainImage(product)}
                            alt={product.title}
                            variant="rounded"
                            sx={{ width: 52, height: 52, borderRadius: 3, bgcolor: BRAND.paper }}
                          >
                            {product.title?.charAt(0) || '?'}
                          </Avatar>

                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              {product.title || 'Sin título'}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {getProductBrand(product)}
                              {product.visibility === 'hidden' && ' · Oculto'}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>

                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace' }}
                          color="text.secondary"
                        >
                          {getProductSku(product)}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
                        <Stack direction="column" spacing={0.5}>
                          <Chip
                            label={product.categoria || 'Sin categoría'}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: '0.75rem', width: 'fit-content' }}
                          />
                          {product.subcategoria && (
                            <Typography variant="caption" color="text.secondary">
                              {product.subcategoria}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>

                      <TableCell>
                        <Typography
                          sx={{
                            fontFamily: DISPLAY_FONT,
                            fontWeight: 800,
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatPrice(product.price)}
                        </Typography>
                      </TableCell>

                      <TableCell>
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
                        >
                          <Typography
                            sx={{
                              fontFamily: DISPLAY_FONT,
                              fontWeight: 800,
                              fontSize: '1.05rem',
                              minWidth: 28,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                            color={
                              stock === 0
                                ? 'error.main'
                                : stock < minAlert
                                  ? 'warning.main'
                                  : 'success.main'
                            }
                          >
                            {stock}
                          </Typography>

                          <Chip
                            icon={stockStatus.icon}
                            label={stockStatus.label}
                            size="small"
                            sx={{
                              backgroundColor: alpha(stockStatus.bgColor, 0.1),
                              color: stockStatus.bgColor,
                              fontWeight: 600,
                              border: `1px solid ${alpha(stockStatus.bgColor, 0.3)}`,
                              '& .MuiChip-icon': {
                                color: stockStatus.bgColor,
                              },
                            }}
                          />

                          {product.hasVariants && (
                            <Tooltip title="Stock agregado de todas las variantes">
                              <Chip label="Variantes" size="small" variant="outlined" />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>

                      <TableCell>
                        <Chip
                          label={statusMeta.label}
                          size="small"
                          color={statusMeta.color}
                          variant={product.status === 'active' ? 'filled' : 'outlined'}
                        />
                      </TableCell>

                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Editar">
                          <IconButton
                            size="small"
                            disabled={isMutating}
                            onClick={() => navigate(`/admin/edit-product/${product._id}`)}
                            sx={{ color: BRAND.blue }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>

                        <Tooltip title="Más acciones">
                          <IconButton
                            size="small"
                            disabled={isMutating}
                            onClick={e => openMenu(e, product)}
                          >
                            {isMutating ? (
                              <CircularProgress size={18} />
                            ) : (
                              <MoreVertIcon fontSize="small" />
                            )}
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {adminProducts.length === 0 && (
          <Box sx={{ py: 8, px: 3, textAlign: 'center' }}>
            <Box
              aria-hidden="true"
              sx={{
                width: 56,
                height: 56,
                mx: 'auto',
                mb: 2,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 3,
                bgcolor: `${BRAND.blue}14`,
                color: BRAND.blue,
              }}
            >
              <InventoryIcon />
            </Box>

            {catalogoVacio ? (
              <>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
                  Todavía no cargaste ningún producto
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
                  Subí una foto y la IA completa la ficha por vos.
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={() => navigate('/admin/AddProduct')}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: 3,
                    background: GRADIENT,
                  }}
                >
                  Crear tu primer producto
                </Button>
              </>
            ) : (
              <>
                <Typography sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}>
                  {hayFiltros
                    ? 'No se encontraron productos con esos filtros'
                    : 'No se encontraron productos'}
                </Typography>
                {hayFiltros && (
                  <Button
                    onClick={clearFilters}
                    startIcon={<FilterOffIcon />}
                    sx={{ mt: 2, textTransform: 'none', fontWeight: 700 }}
                  >
                    Limpiar filtros
                  </Button>
                )}
              </>
            )}
          </Box>
        )}
      </Paper>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(e, value) => setPage(value)}
            color="primary"
            showFirstButton
            showLastButton
            getItemAriaLabel={getPaginationLabel}
          />
        </Box>
      )}

      {/* Menú de acciones rápidas por fila */}
      <Menu anchorEl={menuAnchorEl} open={Boolean(menuAnchorEl)} onClose={closeMenu}>
        {menuProduct?.hasVariants ? (
          <MenuItem
            onClick={() => {
              closeMenu()
              navigate(`/admin/edit-product/${menuProduct._id}`)
            }}
          >
            Gestionar stock por variante
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              openStockDialog(menuProduct)
              closeMenu()
            }}
          >
            Editar stock
          </MenuItem>
        )}

        <Divider />

        {menuProduct?.status !== 'active' && (
          <MenuItem onClick={() => handleChangeStatus(menuProduct, 'active')}>
            Marcar como activo
          </MenuItem>
        )}
        {menuProduct?.status !== 'draft' && (
          <MenuItem onClick={() => handleChangeStatus(menuProduct, 'draft')}>
            Volver a borrador
          </MenuItem>
        )}
        {menuProduct?.status !== 'out-of-stock' && (
          <MenuItem onClick={() => handleChangeStatus(menuProduct, 'out-of-stock')}>
            Marcar sin stock
          </MenuItem>
        )}
        {menuProduct?.status !== 'archived' && (
          <MenuItem onClick={() => handleChangeStatus(menuProduct, 'archived')}>
            <ArchiveIcon fontSize="small" sx={{ mr: 1 }} />
            Archivar
          </MenuItem>
        )}

        <MenuItem onClick={() => handleToggleVisibility(menuProduct)}>
          {menuProduct?.visibility === 'hidden' ? (
            <>
              <VisibilityIcon fontSize="small" sx={{ mr: 1 }} />
              Mostrar en tienda
            </>
          ) : (
            <>
              <VisibilityOffIcon fontSize="small" sx={{ mr: 1 }} />
              Ocultar de la tienda
            </>
          )}
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => handleDeleteClick(menuProduct)}
          sx={{ color: theme.palette.error.main }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Eliminar permanentemente
        </MenuItem>
      </Menu>

      {/* Editar stock rápido */}
      <Dialog open={stockDialog.open} onClose={closeStockDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>Editar stock</DialogTitle>

        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {stockDialog.product?.title}
          </Typography>

          <Stack spacing={2}>
            <TextField
              label="Stock actual"
              type="number"
              fullWidth
              size="small"
              value={stockDialog.stockValue}
              onChange={e =>
                setStockDialog(prev => ({
                  ...prev,
                  stockValue: e.target.value,
                }))
              }
              inputProps={{ min: 0 }}
            />

            <TextField
              label="Alerta de stock bajo"
              type="number"
              fullWidth
              size="small"
              helperText="Se muestra como 'Stock bajo' cuando el stock cae debajo de este número"
              value={stockDialog.thresholdValue}
              onChange={e =>
                setStockDialog(prev => ({
                  ...prev,
                  thresholdValue: e.target.value,
                }))
              }
              inputProps={{ min: 0 }}
            />
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeStockDialog} variant="outlined">
            Cancelar
          </Button>
          <Button onClick={handleSaveStock} variant="contained">
            Guardar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmar eliminación permanente */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>¿Eliminar producto?</DialogTitle>

        <DialogContent>
          <Typography>
            Estás por eliminar <strong>{selectedProduct?.title}</strong> de forma permanente. Esta
            acción no se puede deshacer y borra también sus imágenes. Si solo querés dejar de
            venderlo, usá &quot;Archivar&quot; en vez de eliminar.
          </Typography>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} variant="outlined">
            Cancelar
          </Button>

          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            startIcon={<DeleteIcon />}
          >
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          severity={snackbar.severity}
          variant="filled"
          onClose={handleCloseSnackbar}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default Productlist
