import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { getProducts, deleteProduct } from '@features/product/productSlice'
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
  Select,
  MenuItem,
  Stack,
  useTheme,
  alpha,
  Alert,
  Snackbar,
} from '@mui/material'
import {
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Inventory as InventoryIcon,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
} from '@mui/icons-material'

// ============================================================================
// HELPERS
// ============================================================================

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeText = value =>
  String(value || '')
    .trim()
    .toLowerCase()

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

const getVariantStock = variant => {
  return toNumber(variant?.stock, 0)
}

const getProductStock = product => {
  const hasVariants =
    Boolean(product?.hasVariants) ||
    (Array.isArray(product?.variants) && product.variants.length > 0)

  if (hasVariants && Array.isArray(product?.variants)) {
    return product.variants
      .filter(variant => variant?.isActive !== false)
      .reduce((sum, variant) => sum + getVariantStock(variant), 0)
  }

  return toNumber(product?.stock, 0)
}

const getMinStockAlert = product => {
  return (
    toNumber(product?.minStockAlert, 0) ||
    toNumber(product?.minStock, 0) ||
    toNumber(product?.lowStockThreshold, 0) ||
    10
  )
}

const formatPrice = price =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(toNumber(price, 0))

// ============================================================================
// SUB-COMPONENTE: StatCard
// ============================================================================

const StatCard = ({ title, value, icon, color }) => (
  <Card sx={{ p: 2, borderRadius: 2, flex: 1, minWidth: 120 }}>
    <Box display="flex" alignItems="center" justifyContent="space-between">
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
    products = [],
    isLoading,
    isError,
    message,
  } = useSelector(state => state.product)
  const user = useSelector(state => state.user.user)

  const tenantId = useMemo(() => getTenantId(user), [user])

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [sortBy, setSortBy] = useState('createdAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [snackbar, setSnackbar] = useState({
    open: false,
    severity: 'success',
    message: '',
  })

  // ============================================================================
  // FETCH
  // ============================================================================

  useEffect(() => {
    if (!tenantId) return

    dispatch(getProducts({ tenantId, limit: 1000 }))
      .unwrap()
      .catch(err => {
        console.error('Error fetching products:', err?.message || err)
      })
  }, [tenantId, dispatch])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [searchTerm, rowsPerPage, sortBy, sortOrder])

  // ============================================================================
  // MEMOIZED DATA
  // ============================================================================

  const processedProducts = useMemo(() => {
    const source = Array.isArray(products) ? products : []

    let rows = source.map(product => ({
      ...product,
      _mainImage: getProductMainImage(product),
      _brand: getProductBrand(product),
      _sku: getProductSku(product),
      _calculatedStock: getProductStock(product),
      _minStockAlert: getMinStockAlert(product),
    }))

    if (searchTerm.trim()) {
      const query = normalizeText(searchTerm)

      rows = rows.filter(product => {
        return [
          product?.title,
          product?._brand,
          product?.categoria,
          product?.subcategoria,
          product?._sku,
        ].some(field => normalizeText(field).includes(query))
      })
    }

    rows.sort((a, b) => {
      let aVal
      let bVal

      switch (sortBy) {
        case 'price':
          aVal = toNumber(a.price, 0)
          bVal = toNumber(b.price, 0)
          break
        case 'stock':
          aVal = a._calculatedStock
          bVal = b._calculatedStock
          break
        case 'title':
          aVal = normalizeText(a.title)
          bVal = normalizeText(b.title)
          break
        case 'categoria':
          aVal = normalizeText(a.categoria)
          bVal = normalizeText(b.categoria)
          break
        case 'createdAt':
        default:
          aVal = new Date(a.createdAt || 0).getTime()
          bVal = new Date(b.createdAt || 0).getTime()
          break
      }

      if (aVal === bVal) return 0

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1
      }

      return aVal < bVal ? 1 : -1
    })

    return rows
  }, [products, searchTerm, sortBy, sortOrder])

  const totalPages = Math.max(
    1,
    Math.ceil(processedProducts.length / rowsPerPage),
  )

  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * rowsPerPage
    return processedProducts.slice(start, start + rowsPerPage)
  }, [processedProducts, page, rowsPerPage])

  const stats = useMemo(() => {
    const total = processedProducts.length
    const active = processedProducts.filter(
      product => product.status === 'active',
    ).length
    const lowStock = processedProducts.filter(product => {
      const stock = product._calculatedStock
      const minAlert = product._minStockAlert
      return stock > 0 && stock < minAlert
    }).length
    const outOfStock = processedProducts.filter(
      product => product._calculatedStock === 0,
    ).length

    return { total, active, lowStock, outOfStock }
  }, [processedProducts])

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleDeleteClick = useCallback(product => {
    setSelectedProduct(product)
    setConfirmOpen(true)
  }, [])

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

  const handleSort = useCallback(field => {
    setSortBy(prevField => {
      if (prevField === field) {
        setSortOrder(prevOrder => (prevOrder === 'asc' ? 'desc' : 'asc'))
        return prevField
      }

      setSortOrder('asc')
      return field
    })
  }, [])

  const handleCloseSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }))
  }, [])

  const getStockStatus = useCallback(
    (stock, minAlert) => {
      if (stock === 0) {
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
    [
      theme.palette.error.main,
      theme.palette.success.main,
      theme.palette.warning.main,
    ],
  )

  // ============================================================================
  // RENDER STATES
  // ============================================================================

  if (isLoading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="60vh"
      >
        <CircularProgress size={60} />
      </Box>
    )
  }

  return (
    <Box p={3}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        mb={3}
      >
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Productos
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stats.total} productos • {stats.active} activos • {stats.lowStock}{' '}
            stock bajo • {stats.outOfStock} sin stock
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
        <StatCard
          title="Total"
          value={stats.total}
          icon={<InventoryIcon />}
          color={theme.palette.primary.main}
        />
        <StatCard
          title="Activos"
          value={stats.active}
          icon={<TrendingUpIcon />}
          color={theme.palette.success.main}
        />
        <StatCard
          title="Stock Bajo"
          value={stats.lowStock}
          icon={<TrendingDownIcon />}
          color={theme.palette.warning.main}
        />
        <StatCard
          title="Sin Stock"
          value={stats.outOfStock}
          icon={<TrendingDownIcon />}
          color={theme.palette.error.main}
        />
      </Stack>

      <Card sx={{ mb: 3, p: 2, borderRadius: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems="center"
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Buscar por nombre, marca, categoría, subcategoría o SKU..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ maxWidth: { sm: 450 } }}
          />

          <Box flex={1} />

          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={rowsPerPage}
              onChange={e => setRowsPerPage(Number(e.target.value))}
            >
              <MenuItem value={10}>10 por página</MenuItem>
              <MenuItem value={25}>25 por página</MenuItem>
              <MenuItem value={50}>50 por página</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Card>

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {message || 'Error al cargar productos'}
        </Alert>
      )}

      <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow
              sx={{ backgroundColor: alpha(theme.palette.primary.main, 0.05) }}
            >
              <TableCell
                onClick={() => handleSort('title')}
                sx={{ cursor: 'pointer', fontWeight: 700 }}
              >
                Producto{' '}
                {sortBy === 'title' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableCell>
              <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
              <TableCell
                onClick={() => handleSort('categoria')}
                sx={{ cursor: 'pointer', fontWeight: 700 }}
              >
                Categoría{' '}
                {sortBy === 'categoria' && (sortOrder === 'asc' ? '↑' : '↓')}
              </TableCell>
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
            {paginatedProducts.map(product => {
              const stock = product._calculatedStock
              const minAlert = product._minStockAlert
              const stockStatus = getStockStatus(stock, minAlert)

              return (
                <TableRow
                  key={product._id}
                  hover
                  sx={{
                    '&:last-child td, &:last-child th': { border: 0 },
                    backgroundColor:
                      stock === 0
                        ? alpha(theme.palette.error.main, 0.05)
                        : 'inherit',
                  }}
                >
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={2}>
                      <Avatar
                        src={product._mainImage}
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
                          {product._brand}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>

                  <TableCell>
                    <Typography
                      variant="body2"
                      fontFamily="monospace"
                      color="text.secondary"
                    >
                      {product._sku}
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
                    <Box display="flex" alignItems="center" gap={1.5}>
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
                    </Box>
                  </TableCell>

                  <TableCell>
                    <Chip
                      label={
                        product.status === 'active'
                          ? 'Activo'
                          : product.status || 'Sin estado'
                      }
                      size="small"
                      color={
                        product.status === 'active' ? 'success' : 'default'
                      }
                      variant={
                        product.status === 'active' ? 'filled' : 'outlined'
                      }
                    />
                  </TableCell>

                  <TableCell align="right">
                    <Tooltip title="Editar">
                      <IconButton
                        size="small"
                        onClick={() =>
                          navigate(`/admin/edit-product/${product._id}`)
                        }
                        sx={{ color: theme.palette.primary.main }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>

                    <Tooltip title="Eliminar">
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteClick(product)}
                        sx={{ color: theme.palette.error.main }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}

            {paginatedProducts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">
                    No se encontraron productos
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totalPages > 1 && (
        <Box display="flex" justifyContent="center" mt={3}>
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

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ pb: 1 }}>¿Eliminar producto?</DialogTitle>

        <DialogContent>
          <Typography>
            Estás por eliminar <strong>{selectedProduct?.title}</strong>. Esta
            acción no se puede deshacer.
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
