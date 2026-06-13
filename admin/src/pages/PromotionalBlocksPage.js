// 📁 src/pages/PromotionalBlocks/PromotionalBlocksPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'

// MUI
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Pagination,
  Paper,
  Select,
  Skeleton,
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

// Icons
import {
  BsArrowLeft,
  BsCalendar,
  BsCheckCircleFill,
  BsClock,
  BsEye,
  BsEyeSlash,
  BsPencil,
  BsPlus,
  BsSearch,
  BsTrash,
  BsXCircleFill,
} from 'react-icons/bs'

// Redux
import { getProducts } from '@features/product/productSlice'

import {
  createPromotionalBlock,
  deletePromotionalBlock,
  fetchPromotionalBlocks,
  togglePromotionalBlockStatus,
  updatePromotionalBlock,
  clearPromotionalBlocksError,
  clearPromotionalBlocksSuccess,
} from '@features/promotionalBlocks/promotionalBlocksSlice'

import {
  selectPromotionalBlocks,
  selectPromotionalBlocksError,
  selectPromotionalBlocksMeta,
  selectPromotionalBlocksSuccess,
  selectPromotionalBlocksIsFetching,
  selectPromotionalBlocksIsSaving,
  selectPromotionalBlocksIsDeleting,
  selectPromotionalBlocksIsToggling,
} from '@features/promotionalBlocks/promotionalBlocksSelectors'
import { Newprimary } from '../../../website/src/theme/colors'

// =====================================================
// Configuración
// =====================================================

const CONFIG = {
  DEFAULT_LIMIT: 10,
  DEFAULT_MAX_ITEMS: 5,
  DEFAULT_DURATION_DAYS: 7,
  DEBOUNCE_MS: 300,
  MAX_PRODUCTS_PER_BLOCK: 20,
}

const BLOCK_TYPES = [
  {
    value: 'weekly_offers',
    label: 'Ofertas de la semana',
  },
  {
    value: 'featured_products',
    label: 'Productos destacados',
  },
  {
    value: 'new_arrivals',
    label: 'Novedades',
  },
  {
    value: 'clearance',
    label: 'Liquidación',
  },
  {
    value: 'seasonal_campaign',
    label: 'Campaña temporal',
  },
  {
    value: 'custom',
    label: 'Personalizado',
  },
]

const PLACEMENTS = [
  {
    value: 'home',
    label: 'Home',
  },
  {
    value: 'category',
    label: 'Categoría',
  },
  {
    value: 'product_detail',
    label: 'Detalle producto',
  },
  {
    value: 'cart',
    label: 'Carrito',
  },
  {
    value: 'checkout',
    label: 'Checkout',
  },
]

const VISIBILITIES = [
  {
    value: 'public',
    label: 'Público',
  },
  {
    value: 'hidden',
    label: 'Oculto',
  },
]

const EMPTY_FORM = {
  title: '',
  slug: '',
  type: 'weekly_offers',
  placement: 'home',
  description: '',
  products: [],
  maxItems: CONFIG.DEFAULT_MAX_ITEMS,
  priority: 1,
  startDate: '',
  endDate: '',
  isActive: true,
  visibility: 'public',
}

// =====================================================
// Helpers
// =====================================================

const getEntityId = value => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value._id) return value._id
  return String(value)
}

const getProductFromItem = item => {
  return item?.productId && typeof item.productId === 'object'
    ? item.productId
    : null
}

const getProductImageUrl = product => {
  const image = product?.images?.[0] || product?.image || null

  if (!image) return '/assets/images/placeholder.png'

  if (typeof image === 'string') return image

  return (
    image.url ||
    image.secure_url ||
    image.imageUrl ||
    '/assets/images/placeholder.png'
  )
}

const getPromotionalBlockProducts = block => {
  return normalizeProductsArray(block?.products)
    .map(item => getProductFromItem(item))
    .filter(Boolean)
}

const normalizeProductsArray = products => {
  return Array.isArray(products) ? products : []
}

const formatForInput = value => {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''

  const pad = number => String(number).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDate = value => {
  if (!value) return '-'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const getDefaultDates = () => {
  const now = new Date()
  const endDate = new Date()
  endDate.setDate(now.getDate() + CONFIG.DEFAULT_DURATION_DAYS)

  return {
    startDate: formatForInput(now),
    endDate: formatForInput(endDate),
  }
}

const getBlockStatus = block => {
  const now = Date.now()
  const start = new Date(block?.startDate).getTime()
  const end = new Date(block?.endDate).getTime()

  if (!block?.isActive) {
    return {
      value: 'inactive',
      label: 'Inactivo',
      color: 'default',
      icon: <BsEyeSlash />,
    }
  }

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return {
      value: 'invalid',
      label: 'Fecha inválida',
      color: 'error',
      icon: <BsXCircleFill />,
    }
  }

  if (now < start) {
    return {
      value: 'scheduled',
      label: 'Programado',
      color: 'warning',
      icon: <BsClock />,
    }
  }

  if (now > end) {
    return {
      value: 'expired',
      label: 'Expirado',
      color: 'error',
      icon: <BsXCircleFill />,
    }
  }

  return {
    value: 'active',
    label: 'Activo',
    color: 'success',
    icon: <BsCheckCircleFill />,
  }
}

const getTypeLabel = value => {
  return BLOCK_TYPES.find(item => item.value === value)?.label || value
}

const getPlacementLabel = value => {
  return PLACEMENTS.find(item => item.value === value)?.label || value
}

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value)

  if (Number.isNaN(parsed)) return fallback

  return parsed
}

const buildPayload = form => {
  return {
    title: form.title.trim(),
    slug: form.slug.trim(),
    type: form.type,
    placement: form.placement,
    description: form.description.trim(),
    maxItems: safeNumber(form.maxItems, CONFIG.DEFAULT_MAX_ITEMS),
    priority: safeNumber(form.priority, 1),
    startDate: new Date(form.startDate).toISOString(),
    endDate: new Date(form.endDate).toISOString(),
    isActive: Boolean(form.isActive),
    visibility: form.visibility,
    products: form.products.map((item, index) => ({
      productId: getEntityId(item.productId),
      customTitle: String(item.customTitle || '').trim(),
      customLabel: String(item.customLabel || '').trim(),
      discountPercentage: Math.min(
        100,
        Math.max(0, safeNumber(item.discountPercentage, 0)),
      ),
      priority: safeNumber(item.priority, index + 1),
      isActive: item.isActive !== false,
    })),
  }
}

// =====================================================
// Componentes internos
// =====================================================

const ConfirmDialog = ({
  open,
  title,
  message,
  confirmText = 'Confirmar',
  confirmColor = Newprimary.darkBlueGray,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        <Typography color="text.secondary">{message}</Typography>
      </DialogContent>

      <DialogActions>
        <Button onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>

        <Button
          variant="contained"
          color={confirmColor}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? <CircularProgress size={20} /> : confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const ProductPickerCard = ({ product, selected, disabled, onToggle }) => {
  return (
    <Card
      onClick={() => {
        if (!disabled) onToggle(product)
      }}
      sx={{
        height: '100%',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        border: '2px solid',
        borderColor: selected ? 'primary.main' : 'transparent',
        transition: 'all 0.2s ease',
        '&:hover': disabled
          ? {}
          : {
              transform: 'translateY(-2px)',
              boxShadow: 4,
            },
      }}
    >
      <CardMedia
        component="img"
        height="140"
        image={product.images?.[0]?.url || '/assets/images/placeholder.png'}
        alt={product.title || 'Producto'}
        sx={{
          objectFit: 'cover',
          bgcolor: 'grey.100',
        }}
      />

      <CardContent sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} noWrap>
          {product.title || 'Producto sin título'}
        </Typography>

        <Typography variant="body2" color="primary" fontWeight={800}>
          ${product.price || 0}
        </Typography>

        <Typography
          variant="caption"
          color="text.secondary"
          display="block"
          noWrap
        >
          {product.categoria || product.category || 'Sin categoría'}
        </Typography>

        {selected && (
          <Chip
            size="small"
            color="primary"
            label="Seleccionado"
            sx={{ mt: 1 }}
          />
        )}
      </CardContent>
    </Card>
  )
}

const PromotionalBlockRow = ({
  block,
  onEdit,
  onToggleStatus,
  onDelete,
  toggling,
  deleting,
}) => {
  const status = getBlockStatus(block)
  const previewProducts = getPromotionalBlockProducts(block)

  return (
    <TableRow hover>
      <TableCell>
        <Box>
          <Typography fontWeight={800}>{block.title}</Typography>

          <Typography variant="caption" color="text.secondary">
            /{block.slug}
          </Typography>
        </Box>
      </TableCell>

      <TableCell>
        <Chip
          size="small"
          label={getTypeLabel(block.type)}
          variant="outlined"
        />
      </TableCell>

      <TableCell sx={{ minWidth: 280 }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
            {previewProducts.slice(0, 3).map(product => (
              <Box
                key={getEntityId(product)}
                component="img"
                src={getProductImageUrl(product)}
                alt={product.title || 'Producto promocionado'}
                onError={event => {
                  event.currentTarget.onerror = null
                  event.currentTarget.src = '/assets/images/placeholder.png'
                }}
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: 1,
                  objectFit: 'cover',
                  bgcolor: 'grey.100',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              />
            ))}
          </Stack>

          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {block.description || 'Sin descripción'}
            </Typography>

            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              display="block"
            >
              {previewProducts.length > 0
                ? previewProducts
                    .slice(0, 2)
                    .map(product => product.title || 'Producto')
                    .join(', ')
                : 'Sin productos asociados'}
              {previewProducts.length > 2
                ? ` +${previewProducts.length - 2} más`
                : ''}
            </Typography>
          </Box>
        </Stack>
      </TableCell>

      <TableCell>{getPlacementLabel(block.placement)}</TableCell>

      <TableCell>
        <Typography variant="body2">
          {block.products?.length || 0} / {block.maxItems}
        </Typography>
      </TableCell>

      <TableCell>
        <Chip
          size="small"
          icon={status.icon}
          label={status.label}
          color={status.color}
          variant="outlined"
        />
      </TableCell>

      <TableCell>
        <Typography variant="body2">{formatDate(block.startDate)}</Typography>

        <Typography variant="caption" color="text.secondary">
          hasta {formatDate(block.endDate)}
        </Typography>
      </TableCell>

      <TableCell>
        <Switch
          checked={block.isActive}
          onChange={() => onToggleStatus(block)}
          disabled={toggling}
        />
      </TableCell>

      <TableCell align="right">
        <Tooltip title="Editar">
          <IconButton color="primary" onClick={() => onEdit(block)}>
            <BsPencil />
          </IconButton>
        </Tooltip>

        <Tooltip title="Eliminar">
          <IconButton
            color="error"
            onClick={() => onDelete(block)}
            disabled={deleting}
          >
            <BsTrash />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  )
}

// =====================================================
// Página principal
// =====================================================

const PromotionalBlocksPage = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()

  const blocks = useSelector(selectPromotionalBlocks)
  const meta = useSelector(selectPromotionalBlocksMeta)
  const error = useSelector(selectPromotionalBlocksError)
  const successMessage = useSelector(selectPromotionalBlocksSuccess)

  const isFetching = useSelector(selectPromotionalBlocksIsFetching)
  const isSaving = useSelector(selectPromotionalBlocksIsSaving)
  const isDeleting = useSelector(selectPromotionalBlocksIsDeleting)
  const isToggling = useSelector(selectPromotionalBlocksIsToggling)

  const { products = [], isLoading: productsLoading = false } = useSelector(
    state => state.product || {},
  )

  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [placementFilter, setPlacementFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingBlock, setEditingBlock] = useState(null)
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    ...getDefaultDates(),
  })

  const [productSearch, setProductSearch] = useState('')
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    action: null,
    block: null,
  })

  // =====================================================
  // Effects
  // =====================================================

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
      setPage(1)
    }, CONFIG.DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadBlocks = useCallback(() => {
    dispatch(
      fetchPromotionalBlocks({
        page,
        limit: CONFIG.DEFAULT_LIMIT,
        type: typeFilter || undefined,
        placement: placementFilter || undefined,
        q: debouncedSearch || undefined,
      }),
    )
  }, [dispatch, page, typeFilter, placementFilter, debouncedSearch])

  useEffect(() => {
    dispatch(getProducts())
  }, [dispatch])

  useEffect(() => {
    loadBlocks()
  }, [loadBlocks])

  useEffect(() => {
    if (error) {
      toast.error(error)
      dispatch(clearPromotionalBlocksError())
    }
  }, [error, dispatch])

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage)
      dispatch(clearPromotionalBlocksSuccess())
    }
  }, [successMessage, dispatch])

  // =====================================================
  // Derived state
  // =====================================================

  const activeBlocksCount = useMemo(() => {
    return blocks.filter(block => getBlockStatus(block).value === 'active')
      .length
  }, [blocks])

  const scheduledBlocksCount = useMemo(() => {
    return blocks.filter(block => getBlockStatus(block).value === 'scheduled')
      .length
  }, [blocks])

  const expiredBlocksCount = useMemo(() => {
    return blocks.filter(block => getBlockStatus(block).value === 'expired')
      .length
  }, [blocks])

  const normalizedProducts = useMemo(() => {
    return normalizeProductsArray(products)
  }, [products])

  const selectedProductIds = useMemo(() => {
    return new Set(form.products.map(item => getEntityId(item.productId)))
  }, [form.products])

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase()

    return normalizedProducts.filter(product => {
      const title = String(product.title || '').toLowerCase()
      const category = String(
        product.categoria || product.category || '',
      ).toLowerCase()
      const brand = String(product.marca || product.brand || '').toLowerCase()

      return (
        !q || title.includes(q) || category.includes(q) || brand.includes(q)
      )
    })
  }, [normalizedProducts, productSearch])

  // =====================================================
  // Handlers
  // =====================================================

  const setField = (field, value) => {
    setForm(prev => ({
      ...prev,
      [field]: value,
    }))
  }

  const openCreateModal = () => {
    setEditingBlock(null)
    setProductSearch('')
    setForm({
      ...EMPTY_FORM,
      ...getDefaultDates(),
    })
    setModalOpen(true)
  }

  const openEditModal = block => {
    setEditingBlock(block)
    setProductSearch('')

    setForm({
      title: block.title || '',
      slug: block.slug || '',
      type: block.type || 'weekly_offers',
      placement: block.placement || 'home',
      description: block.description || '',
      maxItems: block.maxItems || CONFIG.DEFAULT_MAX_ITEMS,
      priority: block.priority || 1,
      startDate: formatForInput(block.startDate),
      endDate: formatForInput(block.endDate),
      isActive: block.isActive !== false,
      visibility: block.visibility || 'public',
      products: normalizeProductsArray(block.products).map((item, index) => ({
        productId: getEntityId(item.productId),
        customTitle: item.customTitle || getProductFromItem(item)?.title || '',
        customLabel: item.customLabel || '',
        discountPercentage: item.discountPercentage || 0,
        priority: item.priority || index + 1,
        isActive: item.isActive !== false,
      })),
    })

    setModalOpen(true)
  }

  const closeModal = () => {
    if (isSaving) return

    setModalOpen(false)
    setEditingBlock(null)
    setProductSearch('')
    setForm({
      ...EMPTY_FORM,
      ...getDefaultDates(),
    })
  }

  const toggleProductSelection = product => {
    const productId = getEntityId(product)

    setForm(prev => {
      const exists = prev.products.some(
        item => getEntityId(item.productId) === productId,
      )

      if (exists) {
        return {
          ...prev,
          products: prev.products.filter(
            item => getEntityId(item.productId) !== productId,
          ),
        }
      }

      if (prev.products.length >= Number(prev.maxItems)) {
        toast.warning(
          `Máximo ${prev.maxItems} productos permitidos en este bloque`,
        )
        return prev
      }

      if (prev.products.length >= CONFIG.MAX_PRODUCTS_PER_BLOCK) {
        toast.warning(
          `Máximo técnico permitido: ${CONFIG.MAX_PRODUCTS_PER_BLOCK} productos`,
        )
        return prev
      }

      return {
        ...prev,
        products: [
          ...prev.products,
          {
            productId,
            customTitle: '',
            customLabel: '',
            discountPercentage: 0,
            priority: prev.products.length + 1,
            isActive: true,
          },
        ],
      }
    })
  }

  const updateSelectedProductField = (productId, field, value) => {
    setForm(prev => ({
      ...prev,
      products: prev.products.map(item => {
        if (getEntityId(item.productId) !== productId) return item

        return {
          ...item,
          [field]: value,
        }
      }),
    }))
  }

  const removeSelectedProduct = productId => {
    setForm(prev => ({
      ...prev,
      products: prev.products
        .filter(item => getEntityId(item.productId) !== productId)
        .map((item, index) => ({
          ...item,
          priority: index + 1,
        })),
    }))
  }

  const validateForm = () => {
    if (!form.title.trim()) {
      toast.error('El título del bloque es obligatorio')
      return false
    }

    if (!form.type) {
      toast.error('El tipo de bloque es obligatorio')
      return false
    }

    if (!form.placement) {
      toast.error('La ubicación del bloque es obligatoria')
      return false
    }

    if (!form.startDate || !form.endDate) {
      toast.error('Las fechas de inicio y fin son obligatorias')
      return false
    }

    const start = new Date(form.startDate).getTime()
    const end = new Date(form.endDate).getTime()

    if (Number.isNaN(start) || Number.isNaN(end)) {
      toast.error('Las fechas ingresadas no son válidas')
      return false
    }

    if (end <= start) {
      toast.error('La fecha de fin debe ser posterior a la fecha de inicio')
      return false
    }

    const maxItems = safeNumber(form.maxItems, CONFIG.DEFAULT_MAX_ITEMS)

    if (maxItems < 1 || maxItems > CONFIG.MAX_PRODUCTS_PER_BLOCK) {
      toast.error(
        `El máximo de productos debe estar entre 1 y ${CONFIG.MAX_PRODUCTS_PER_BLOCK}`,
      )
      return false
    }

    if (form.products.length > maxItems) {
      toast.error(
        `Seleccionaste ${form.products.length} productos, pero el máximo configurado es ${maxItems}`,
      )
      return false
    }

    return true
  }

  const handleSubmit = async () => {
    if (!validateForm()) return

    const payload = buildPayload(form)

    try {
      if (editingBlock?._id) {
        await dispatch(
          updatePromotionalBlock({
            id: editingBlock._id,
            data: payload,
          }),
        ).unwrap()
      } else {
        await dispatch(createPromotionalBlock(payload)).unwrap()
      }

      closeModal()
      loadBlocks()
    } catch (err) {
      toast.error(
        typeof err === 'string'
          ? err
          : err?.message || 'Error al guardar el bloque',
      )
    }
  }

  const handleToggleStatus = block => {
    setConfirmDialog({
      open: true,
      action: 'toggle',
      block,
    })
  }

  const handleDelete = block => {
    setConfirmDialog({
      open: true,
      action: 'delete',
      block,
    })
  }

  const closeConfirmDialog = () => {
    if (isDeleting || isToggling) return

    setConfirmDialog({
      open: false,
      action: null,
      block: null,
    })
  }

  const confirmAction = async () => {
    const { action, block } = confirmDialog

    if (!block?._id || !action) return

    try {
      if (action === 'toggle') {
        await dispatch(
          togglePromotionalBlockStatus({
            id: block._id,
            isActive: !block.isActive,
          }),
        ).unwrap()
      }

      if (action === 'delete') {
        await dispatch(
          deletePromotionalBlock({
            id: block._id,
            hard: true,
          }),
        ).unwrap()
      }

      closeConfirmDialog()
      loadBlocks()
    } catch (err) {
      toast.error(
        typeof err === 'string'
          ? err
          : err?.message || 'Error al procesar la acción',
      )
    }
  }

  // =====================================================
  // Render
  // =====================================================

  return (
    <Box sx={{ bgcolor: '#F5F5F7', minHeight: '100vh', pb: 8 }}>
      <Box sx={{ bgcolor: '#fff', borderBottom: '1px solid #e0e0e0', py: 3 }}>
        <Container maxWidth="xl">
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            spacing={2}
          >
            <Box>
              <Stack direction="row" alignItems="center" spacing={2} mb={1}>
                <Button
                  startIcon={<BsArrowLeft />}
                  variant="outlined"
                  onClick={() => navigate('/admin')}
                >
                  Volver
                </Button>

                <Typography variant="h4" fontWeight={900}>
                  Bloques promocionales
                </Typography>
              </Stack>

              <Typography color="text.secondary">
                Gestioná ofertas, destacados, novedades, liquidaciones y
                campañas visibles por tenant.
              </Typography>
            </Box>

            <Box display="flex" alignItems="center">
              <Button
                variant="contained"
                size="large"
                startIcon={<BsPlus />}
                onClick={openCreateModal}
              >
                Nuevo bloque
              </Button>
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Paper sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="h3" fontWeight={900} color="primary">
                {activeBlocksCount}
              </Typography>
              <Typography color="text.secondary">Bloques activos</Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Paper sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="h3" fontWeight={900} color="warning.main">
                {scheduledBlocksCount}
              </Typography>
              <Typography color="text.secondary">Programados</Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Paper sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="h3" fontWeight={900} color="error">
                {expiredBlocksCount}
              </Typography>
              <Typography color="text.secondary">Expirados</Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Paper sx={{ p: 3, borderRadius: 3 }}>
              <Typography variant="h3" fontWeight={900}>
                {meta?.total || 0}
              </Typography>
              <Typography color="text.secondary">Total configurados</Typography>
            </Paper>
          </Grid>
        </Grid>

        <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} md={5}>
              <TextField
                fullWidth
                label="Buscar bloque"
                placeholder="Título, slug o descripción..."
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <BsSearch />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Tipo</InputLabel>
                <Select
                  label="Tipo"
                  value={typeFilter}
                  onChange={event => {
                    setTypeFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <MenuItem value="">Todos</MenuItem>
                  {BLOCK_TYPES.map(item => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={3}>
              <FormControl fullWidth>
                <InputLabel>Ubicación</InputLabel>
                <Select
                  label="Ubicación"
                  value={placementFilter}
                  onChange={event => {
                    setPlacementFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <MenuItem value="">Todas</MenuItem>
                  {PLACEMENTS.map(item => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={1}>
              <Button
                fullWidth
                variant="outlined"
                sx={{ height: '100%' }}
                onClick={() => {
                  setSearchQuery('')
                  setTypeFilter('')
                  setPlacementFilter('')
                  setPage(1)
                }}
              >
                Limpiar
              </Button>
            </Grid>
          </Grid>
        </Paper>

        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ p: 3, borderBottom: '1px solid #e0e0e0' }}>
            <Typography variant="h6" fontWeight={800}>
              Bloques configurados
            </Typography>
          </Box>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Bloque</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Descripción / productos</TableCell>
                  <TableCell>Ubicación</TableCell>
                  <TableCell>Productos</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Vigencia</TableCell>
                  <TableCell>Activo</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {isFetching ? (
                  [...Array(4)].map((_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Skeleton width={220} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={140} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={240} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={100} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={80} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={110} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={180} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={60} />
                      </TableCell>
                      <TableCell>
                        <Skeleton width={100} />
                      </TableCell>
                    </TableRow>
                  ))
                ) : blocks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 8 }}>
                      <BsCalendar size={48} color="#bbb" />

                      <Typography color="text.secondary" mt={2}>
                        No hay bloques promocionales configurados.
                      </Typography>

                      <Button
                        variant="outlined"
                        startIcon={<BsPlus />}
                        sx={{ mt: 2 }}
                        onClick={openCreateModal}
                      >
                        Crear primer bloque
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : (
                  blocks.map(block => (
                    <PromotionalBlockRow
                      key={block._id}
                      block={block}
                      toggling={isToggling}
                      deleting={isDeleting}
                      onEdit={openEditModal}
                      onToggleStatus={handleToggleStatus}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {meta?.pages > 1 && (
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
              <Pagination
                count={meta.pages}
                page={page}
                color="primary"
                onChange={(_, nextPage) => setPage(nextPage)}
              />
            </Box>
          )}
        </Paper>

        <Alert severity="info" sx={{ mt: 3 }}>
          <Typography variant="body2">
            Los bloques públicos se muestran en el website solo si están
            activos, visibles, dentro del rango de fechas y pertenecen al tenant
            actual.
          </Typography>
        </Alert>
      </Container>

      <Dialog open={modalOpen} onClose={closeModal} maxWidth="lg" fullWidth>
        <DialogTitle>
          {editingBlock
            ? 'Editar bloque promocional'
            : 'Nuevo bloque promocional'}
        </DialogTitle>

        <DialogContent dividers>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" fontWeight={800}>
                Datos generales
              </Typography>
            </Grid>

            <Grid item xs={12} md={8}>
              <TextField
                fullWidth
                required
                label="Título"
                value={form.title}
                onChange={event => setField('title', event.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Slug opcional"
                helperText="Si lo dejás vacío, el backend lo genera desde el título."
                value={form.slug}
                onChange={event => setField('slug', event.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <FormControl fullWidth required>
                <InputLabel>Tipo</InputLabel>
                <Select
                  label="Tipo"
                  value={form.type}
                  onChange={event => setField('type', event.target.value)}
                >
                  {BLOCK_TYPES.map(item => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={4}>
              <FormControl fullWidth required>
                <InputLabel>Ubicación</InputLabel>
                <Select
                  label="Ubicación"
                  value={form.placement}
                  onChange={event => setField('placement', event.target.value)}
                >
                  {PLACEMENTS.map(item => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={4}>
              <FormControl fullWidth>
                <InputLabel>Visibilidad</InputLabel>
                <Select
                  label="Visibilidad"
                  value={form.visibility}
                  onChange={event => setField('visibility', event.target.value)}
                >
                  {VISIBILITIES.map(item => (
                    <MenuItem key={item.value} value={item.value}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Descripción"
                value={form.description}
                onChange={event => setField('description', event.target.value)}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <Grid item xs={12}>
              <Typography variant="h6" fontWeight={800}>
                Programación
              </Typography>
            </Grid>

            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                required
                type="datetime-local"
                label="Fecha inicio"
                InputLabelProps={{ shrink: true }}
                value={form.startDate}
                onChange={event => setField('startDate', event.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={3}>
              <TextField
                fullWidth
                required
                type="datetime-local"
                label="Fecha fin"
                InputLabelProps={{ shrink: true }}
                value={form.endDate}
                onChange={event => setField('endDate', event.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="number"
                label="Máx. productos"
                value={form.maxItems}
                inputProps={{
                  min: 1,
                  max: CONFIG.MAX_PRODUCTS_PER_BLOCK,
                }}
                onChange={event => setField('maxItems', event.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={2}>
              <TextField
                fullWidth
                type="number"
                label="Prioridad"
                value={form.priority}
                inputProps={{
                  min: 1,
                  max: 100,
                }}
                onChange={event => setField('priority', event.target.value)}
              />
            </Grid>

            <Grid item xs={12} md={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isActive}
                    onChange={event =>
                      setField('isActive', event.target.checked)
                    }
                  />
                }
                label="Activo"
              />
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <Grid item xs={12}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h6" fontWeight={800}>
                    Productos del bloque
                  </Typography>

                  <Typography variant="body2" color="text.secondary">
                    Seleccionados: {form.products.length} / {form.maxItems}
                  </Typography>
                </Box>

                <TextField
                  size="small"
                  placeholder="Buscar producto..."
                  value={productSearch}
                  onChange={event => setProductSearch(event.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <BsSearch />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ minWidth: { xs: '100%', md: 320 } }}
                />
              </Stack>
            </Grid>

            <Grid item xs={12}>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                  gap: 2,
                  maxHeight: 330,
                  overflowY: 'auto',
                  p: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                }}
              >
                {productsLoading ? (
                  [...Array(6)].map((_, index) => (
                    <Skeleton key={index} variant="rounded" height={230} />
                  ))
                ) : filteredProducts.length === 0 ? (
                  <Typography
                    color="text.secondary"
                    sx={{ gridColumn: '1 / -1', textAlign: 'center', py: 4 }}
                  >
                    No se encontraron productos.
                  </Typography>
                ) : (
                  filteredProducts.map(product => {
                    const productId = getEntityId(product)
                    const selected = selectedProductIds.has(productId)
                    const disabled =
                      !selected && form.products.length >= Number(form.maxItems)

                    return (
                      <ProductPickerCard
                        key={productId}
                        product={product}
                        selected={selected}
                        disabled={disabled}
                        onToggle={() => toggleProductSelection(product)}
                      />
                    )
                  })
                )}
              </Box>
            </Grid>

            {form.products.length > 0 && (
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight={800} mb={2}>
                  Configuración de productos seleccionados
                </Typography>

                <Stack spacing={2}>
                  {form.products.map((item, index) => {
                    const productId = getEntityId(item.productId)
                    const product = normalizedProducts.find(
                      p => getEntityId(p) === productId,
                    )

                    return (
                      <Paper key={productId} sx={{ p: 2, borderRadius: 2 }}>
                        <Grid container spacing={2} alignItems="center">
                          <Grid item xs={12} md={3}>
                            <Typography fontWeight={800} noWrap>
                              {product?.title || `Producto ${index + 1}`}
                            </Typography>

                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {productId}
                            </Typography>
                          </Grid>

                          <Grid item xs={12} md={2}>
                            <TextField
                              fullWidth
                              size="small"
                              label="Etiqueta"
                              value={item.customLabel}
                              onChange={event =>
                                updateSelectedProductField(
                                  productId,
                                  'customLabel',
                                  event.target.value,
                                )
                              }
                            />
                          </Grid>

                          <Grid item xs={12} md={3}>
                            <TextField
                              fullWidth
                              size="small"
                              label="Título personalizado"
                              value={item.customTitle}
                              onChange={event =>
                                updateSelectedProductField(
                                  productId,
                                  'customTitle',
                                  event.target.value,
                                )
                              }
                            />
                          </Grid>

                          <Grid item xs={6} md={1.5}>
                            <TextField
                              fullWidth
                              size="small"
                              type="number"
                              label="% OFF"
                              value={item.discountPercentage}
                              inputProps={{
                                min: 0,
                                max: 100,
                              }}
                              onChange={event =>
                                updateSelectedProductField(
                                  productId,
                                  'discountPercentage',
                                  event.target.value,
                                )
                              }
                            />
                          </Grid>

                          <Grid item xs={6} md={1}>
                            <TextField
                              fullWidth
                              size="small"
                              type="number"
                              label="Orden"
                              value={item.priority}
                              inputProps={{
                                min: 1,
                                max: 100,
                              }}
                              onChange={event =>
                                updateSelectedProductField(
                                  productId,
                                  'priority',
                                  event.target.value,
                                )
                              }
                            />
                          </Grid>

                          <Grid item xs={6} md={0.8}>
                            <Switch
                              checked={item.isActive !== false}
                              onChange={event =>
                                updateSelectedProductField(
                                  productId,
                                  'isActive',
                                  event.target.checked,
                                )
                              }
                            />
                          </Grid>

                          <Grid item xs={6} md={0.7}>
                            <IconButton
                              color="error"
                              onClick={() => removeSelectedProduct(productId)}
                            >
                              <BsTrash />
                            </IconButton>
                          </Grid>
                        </Grid>
                      </Paper>
                    )
                  })}
                </Stack>
              </Grid>
            )}
          </Grid>
        </DialogContent>

        <DialogActions>
          <Button onClick={closeModal} disabled={isSaving}>
            Cancelar
          </Button>

          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? (
              <CircularProgress size={22} />
            ) : editingBlock ? (
              'Guardar cambios'
            ) : (
              'Crear bloque'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialog.open}
        title={
          confirmDialog.action === 'delete'
            ? 'Eliminar definitivamente'
            : confirmDialog.block?.isActive
              ? 'Desactivar bloque promocional'
              : 'Activar bloque promocional'
        }
        message={
          confirmDialog.action === 'delete'
            ? `¿Estás seguro de eliminar definitivamente "${confirmDialog.block?.title}" de la base de datos? Esta acción no se puede deshacer.`
            : `¿Querés ${confirmDialog.block?.isActive ? 'desactivar' : 'activar'} "${confirmDialog.block?.title}"?`
        }
        confirmText={
          confirmDialog.action === 'delete'
            ? 'Eliminar definitivamente'
            : 'Confirmar'
        }
        confirmColor={confirmDialog.action === 'delete' ? 'error' : 'primary'}
        loading={isDeleting || isToggling}
        onConfirm={confirmAction}
        onCancel={closeConfirmDialog}
      />
    </Box>
  )
}

export default PromotionalBlocksPage
