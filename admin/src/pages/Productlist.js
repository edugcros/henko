import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { getAdminProducts, updateAProduct, deleteProduct } from '@features/product/productSlice'
import {
  Box,
  Typography,
  Card,
  IconButton,
  Tooltip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
// SUB-COMPONENTE: StatCard
// ============================================================================

const StatCard = ({ title, value, icon, color, onClick, active }) => (
  <Card
    onClick={onClick}
    sx={{
      p: 2,
      borderRadius: 2,
      flex: 1,
      minWidth: 110,
      cursor: onClick ? 'pointer' : 'default',
      border: active ? `2px solid ${color}` : '2px solid transparent',
      transition: 'border-color 0.15s ease',
    }}
  >
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Box>
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          {title}
        </Typography>
        <Typography variant="h5" fontWeight={700} color={color}>
          {value}
        </Typography>
      </Box>

      <Box
        sx={{
          p: 1,
          borderRadius: 2,
          backgroundColor: alpha(color, 0.1),
          color,
          display: 'flex',
        }}
      >
        {React.cloneElement(icon, { sx: { fontSize: 24 } })}
      </Box>
    </Box>
  </Card>
)

// ============================================================================
// COMPONENTE: Productlist
// ============================================================================

const Productlist = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const theme = useTheme()

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
    const handle = setTimeout(() => {
      setSearchTerm(searchInput.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [searchInput])

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
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress size={60} />
      </Box>
    )
  }

  return (
    <Box p={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Productos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stats.total} productos en catálogo
          </Typography>
        </Box>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/admin/AddProduct')}
          sx={{ borderRadius: 2, textTransform: 'none' }}
        >
          Nuevo Producto
        </Button>
      </Box>

      <Stack direction="row" spacing={2} mb={3} sx={{ flexWrap: 'wrap', gap: 2 }}>
        <StatCard
          title="Total"
          value={stats.total}
          icon={<InventoryIcon />}
          color={theme.palette.primary.main}
        />
        <StatCard
          title="Activos"
          value={stats.byStatus?.active || 0}
          icon={<TrendingUpIcon />}
          color={theme.palette.success.main}
          onClick={() => toggleStatusFilter('active')}
          active={statusFilter === 'active'}
        />
        <StatCard
          title="Borradores"
          value={stats.byStatus?.draft || 0}
          icon={<DraftsIcon />}
          color={theme.palette.info.main}
          onClick={() => toggleStatusFilter('draft')}
          active={statusFilter === 'draft'}
        />
        <StatCard
          title="Archivados"
          value={stats.byStatus?.archived || 0}
          icon={<ArchiveIcon />}
          color={theme.palette.text.secondary}
          onClick={() => toggleStatusFilter('archived')}
          active={statusFilter === 'archived'}
        />
        <StatCard
          title="Stock Bajo"
          value={stats.lowStock || 0}
          icon={<TrendingDownIcon />}
          color={theme.palette.warning.main}
          onClick={() => toggleStockFilter('low')}
          active={stockFilter === 'low'}
        />
        <StatCard
          title="Sin Stock"
          value={stats.outOfStock || 0}
          icon={<TrendingDownIcon />}
          color={theme.palette.error.main}
          onClick={() => toggleStockFilter('out')}
          active={stockFilter === 'out'}
        />
      </Stack>

      <Card sx={{ mb: 3, p: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
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
            }}
            sx={{ maxWidth: { sm: 380 } }}
          />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Estado</InputLabel>
            <Select
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

          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Visibilidad</InputLabel>
            <Select
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

          <Box flex={1} />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={rowsPerPage}
              onChange={e => handleRowsPerPageChange(Number(e.target.value))}
            >
              <MenuItem value={10}>10 por página</MenuItem>
              <MenuItem value={25}>25 por página</MenuItem>
              <MenuItem value={50}>50 por página</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Card>

      {isAdminLoading && hasLoadedOnce.current && (
        <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />
      )}

      {isAdminError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {adminMessage || 'Error al cargar productos'}
        </Alert>
      )}

      <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ backgroundColor: alpha(theme.palette.primary.main, 0.05) }}>
              <TableCell
                onClick={() => handleSort('title')}
                sx={{ cursor: 'pointer', fontWeight: 700 }}
              >
                Producto {sortBy === 'title' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Categoría</TableCell>
              <TableCell
                onClick={() => handleSort('price')}
                sx={{ cursor: 'pointer', fontWeight: 700 }}
              >
                Precio {sortBy === 'price' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableCell>
              <TableCell
                onClick={() => handleSort('stock')}
                sx={{ cursor: 'pointer', fontWeight: 700 }}
              >
                Stock {sortBy === 'stock' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>
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
                      stock === 0 ? alpha(theme.palette.error.main, 0.05) : 'inherit',
                  }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar
                        src={getProductMainImage(product)}
                        alt={product.title}
                        variant="rounded"
                        sx={{ width: 50, height: 50 }}
                      >
                        {product.title?.charAt(0) || '?'}
                      </Avatar>

                      <Box>
                        <Typography variant="subtitle2" fontWeight={600}>
                          {product.title || 'Sin título'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {getProductBrand(product)}
                          {product.visibility === 'hidden' && ' · Oculto'}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>

                  <TableCell>
                    <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                      {getProductSku(product)}
                    </Typography>
                  </TableCell>

                  <TableCell>
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
                    <Typography variant="subtitle2" fontWeight={600}>
                      {formatPrice(product.price)}
                    </Typography>
                  </TableCell>

                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        fontSize="1rem"
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

                  <TableCell align="right">
                    <Tooltip title="Editar">
                      <IconButton
                        size="small"
                        disabled={isMutating}
                        onClick={() => navigate(`/admin/edit-product/${product._id}`)}
                        sx={{ color: theme.palette.primary.main }}
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

            {adminProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No se encontraron productos</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(e, value) => setPage(value)}
            color="primary"
            showFirstButton
            showLastButton
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
          <Typography variant="body2" color="text.secondary" mb={2}>
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
