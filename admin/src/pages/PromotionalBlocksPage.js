// 📁 src/pages/PromotionalBlocksPage.js
//
// Bloques promocionales: las secciones de ofertas, destacados y novedades que
// se ven en la tienda. Lo que esta pantalla afirma sale del producto:
//
// - La tienda pide SOLO los bloques con placement 'home' (Home.js, OurStore.js
//   y SingleProduct.js en website/src/Pages), y los muestra en las tres
//   páginas. Las otras ubicaciones las acepta el backend pero no se ven en
//   ningún lado, así que acá se dicen como tales en vez de ofrecerse.
// - Un bloque vigente con productos en descuento dispara avisos por email a
//   quienes tienen esos productos en favoritos
//   (backend/src/services/wishlistPromotionNotifierService.js).
// - Los límites de validación copian backend/src/validators/
//   promotionalBlockValidator.js y el modelo; el backend responde un
//   "Errores de validación." genérico que no dice qué campo falló.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Snackbar,
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
  useMediaQuery,
} from '@mui/material'
import {
  Add as AddIcon,
  ArrowBack as ArrowBackIcon,
  Close as CloseIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  Search as SearchIcon,
} from '@mui/icons-material'

import productService from '@features/product/productService'
import {
  clearPromotionalBlocksError,
  clearPromotionalBlocksSuccess,
  createPromotionalBlock,
  deletePromotionalBlock,
  fetchPromotionalBlocks,
  togglePromotionalBlockStatus,
  updatePromotionalBlock,
} from '@features/promotionalBlocks/promotionalBlocksSlice'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
  amber: '#b45309',
  red: '#b42318',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// El backend devuelve hasta 100 por pedido. Se traen todos los que cumplen los
// filtros para que el resumen cuente el total y no solo la página visible.
const FETCH_LIMIT = 100
const PAGE_SIZE = 10
const PICKER_LIMIT = 24
const DEBOUNCE_MS = 300
const DEFAULT_DURATION_DAYS = 7

export const LIMITS = {
  title: 120,
  slug: 140,
  description: 300,
  maxItems: 20,
  priority: 100,
  customTitle: 120,
  customLabel: 80,
}

const BLOCK_TYPES = [
  { value: 'weekly_offers', label: 'Ofertas de la semana' },
  { value: 'featured_products', label: 'Productos destacados' },
  { value: 'new_arrivals', label: 'Novedades' },
  { value: 'clearance', label: 'Liquidación' },
  { value: 'seasonal_campaign', label: 'Campaña de temporada' },
  { value: 'custom', label: 'Personalizado' },
]

export const PLACEMENTS = [
  { value: 'home', label: 'Inicio, tienda y ficha de producto', shown: true },
  { value: 'category', label: 'Categoría', shown: false },
  { value: 'product_detail', label: 'Solo ficha de producto', shown: false },
  { value: 'cart', label: 'Carrito', shown: false },
  { value: 'checkout', label: 'Checkout', shown: false },
]

const STATUS_META = {
  live: { label: 'En la tienda', color: BRAND.green, bg: '#e7f6ef' },
  scheduled: { label: 'Programado', color: BRAND.blue, bg: '#e8f0ff' },
  expired: { label: 'Vencido', color: BRAND.muted, bg: '#eef1fb' },
  paused: { label: 'Pausado', color: BRAND.muted, bg: '#eef1fb' },
  hidden: { label: 'Oculto', color: BRAND.amber, bg: '#fdf3e7' },
  nowhere: { label: 'No se muestra', color: BRAND.amber, bg: '#fdf3e7' },
  invalid: { label: 'Fechas inválidas', color: BRAND.red, bg: '#fdecea' },
}

// Resumen: lo que está en la tienda, lo que viene, lo que pasó y lo que no se ve.
const SUMMARY = [
  { key: 'live', label: 'En la tienda', statuses: ['live'], color: BRAND.green },
  { key: 'scheduled', label: 'Programados', statuses: ['scheduled'], color: BRAND.blue },
  { key: 'expired', label: 'Vencidos', statuses: ['expired'], color: BRAND.muted },
  {
    key: 'off',
    label: 'Sin mostrarse',
    statuses: ['paused', 'hidden', 'nowhere', 'invalid'],
    color: BRAND.amber,
  },
]

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

const formatPesos = value =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)

const formatDate = value => {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

const formatForInput = value => {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const getEntityId = value => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value._id) return String(value._id)
  return String(value)
}

const getProductImageUrl = product => {
  const image = product?.images?.[0] || product?.image || null
  if (!image) return ''
  if (typeof image === 'string') return image
  return image.url || image.secure_url || image.imageUrl || ''
}

const toList = payload => {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.blocks)) return payload.blocks
  if (Array.isArray(payload?.products)) return payload.products
  return []
}

const messageOf = (err, fallback) => (typeof err === 'string' ? err : err?.message) || fallback

const getTypeLabel = value => BLOCK_TYPES.find(item => item.value === value)?.label || value
const getPlacement = value => PLACEMENTS.find(item => item.value === value)

// Por qué un bloque se ve o no en la tienda, en una palabra.
export const getBlockStatus = (block, now = Date.now()) => {
  if (!block?.isActive) return 'paused'
  if (block.visibility === 'hidden') return 'hidden'
  if (!getPlacement(block.placement)?.shown) return 'nowhere'

  const start = new Date(block.startDate).getTime()
  const end = new Date(block.endDate).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 'invalid'
  if (now < start) return 'scheduled'
  if (now > end) return 'expired'
  return 'live'
}

const newForm = () => {
  const start = new Date()
  const end = new Date()
  end.setDate(start.getDate() + DEFAULT_DURATION_DAYS)
  return {
    title: '',
    slug: '',
    type: 'weekly_offers',
    placement: 'home',
    description: '',
    products: [],
    maxItems: 5,
    priority: 1,
    startDate: formatForInput(start),
    endDate: formatForInput(end),
    isActive: true,
    visibility: 'public',
  }
}

// El producto poblado queda en `product` solo para mostrarlo: antes se tiraba
// y un producto que no estaba entre los cargados aparecía como "Producto 1"
// con su id de base de datos.
const formFromBlock = block => ({
  title: block.title || '',
  slug: block.slug || '',
  type: block.type || 'weekly_offers',
  placement: block.placement || 'home',
  description: block.description || '',
  maxItems: block.maxItems || 5,
  priority: block.priority || 1,
  startDate: formatForInput(block.startDate),
  endDate: formatForInput(block.endDate),
  isActive: block.isActive !== false,
  visibility: block.visibility || 'public',
  products: (Array.isArray(block.products) ? block.products : []).map((item, index) => ({
    productId: getEntityId(item.productId),
    product: typeof item.productId === 'object' ? item.productId : null,
    customTitle: item.customTitle || '',
    customLabel: item.customLabel || '',
    discountPercentage: item.discountPercentage ?? 0,
    priority: item.priority || index + 1,
    isActive: item.isActive !== false,
  })),
})

const isWhole = (value, min, max) => {
  const number = Number(value)
  return String(value).trim() !== '' && Number.isInteger(number) && number >= min && number <= max
}

// { campo: mensaje }. Los de cada producto van como `producto:<id>:<campo>`.
export const validateBlock = form => {
  const errors = {}
  const title = form.title.trim()

  if (!title) errors.title = 'Poné un título: es lo que ven los clientes arriba del bloque.'
  else if (title.length > LIMITS.title) errors.title = `Hasta ${LIMITS.title} caracteres.`

  if (form.slug.trim().length > LIMITS.slug) errors.slug = `Hasta ${LIMITS.slug} caracteres.`
  if (form.description.trim().length > LIMITS.description) {
    errors.description = `Hasta ${LIMITS.description} caracteres.`
  }

  const start = new Date(form.startDate).getTime()
  const end = new Date(form.endDate).getTime()
  if (!form.startDate || Number.isNaN(start)) errors.startDate = 'Elegí desde cuándo.'
  if (!form.endDate || Number.isNaN(end)) errors.endDate = 'Elegí hasta cuándo.'
  else if (!Number.isNaN(start) && end <= start) {
    errors.endDate = 'Tiene que terminar después de empezar.'
  }

  if (!isWhole(form.maxItems, 1, LIMITS.maxItems)) {
    errors.maxItems = `Entre 1 y ${LIMITS.maxItems}.`
  } else if (form.products.length > Number(form.maxItems)) {
    errors.maxItems = `Elegiste ${form.products.length}: subí el máximo o sacá productos.`
  }

  if (!isWhole(form.priority, 1, LIMITS.priority)) {
    errors.priority = `Entre 1 y ${LIMITS.priority}, sin decimales.`
  }

  for (const item of form.products) {
    const key = `producto:${item.productId}`
    const discount = Number(item.discountPercentage)
    if (String(item.discountPercentage).trim() === '' || !(discount >= 0 && discount <= 100)) {
      errors[`${key}:discountPercentage`] = 'Entre 0 y 100.'
    }
    if (!isWhole(item.priority, 1, LIMITS.priority)) errors[`${key}:priority`] = '1 a 100.'
    if (String(item.customLabel || '').trim().length > LIMITS.customLabel) {
      errors[`${key}:customLabel`] = `Hasta ${LIMITS.customLabel}.`
    }
    if (String(item.customTitle || '').trim().length > LIMITS.customTitle) {
      errors[`${key}:customTitle`] = `Hasta ${LIMITS.customTitle}.`
    }
  }

  return errors
}

export const buildPayload = form => ({
  title: form.title.trim(),
  slug: form.slug.trim(),
  type: form.type,
  placement: form.placement,
  description: form.description.trim(),
  maxItems: Number(form.maxItems),
  priority: Number(form.priority),
  startDate: new Date(form.startDate).toISOString(),
  endDate: new Date(form.endDate).toISOString(),
  isActive: Boolean(form.isActive),
  visibility: form.visibility,
  products: form.products.map(item => ({
    productId: item.productId,
    customTitle: String(item.customTitle || '').trim(),
    customLabel: String(item.customLabel || '').trim(),
    discountPercentage: Number(item.discountPercentage),
    priority: Number(item.priority),
    isActive: item.isActive !== false,
  })),
})

const hasDiscounts = products =>
  products.some(item => item.isActive !== false && Number(item.discountPercentage) > 0)

const Pill = ({ status }) => {
  const meta = STATUS_META[status]
  return (
    <Typography
      component="span"
      sx={{
        display: 'inline-flex',
        flexShrink: 0,
        alignSelf: 'flex-start',
        px: 1.25,
        py: 0.25,
        borderRadius: 99,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
        color: meta.color,
        bgcolor: meta.bg,
      }}
    >
      {meta.label}
    </Typography>
  )
}

const SummaryTile = ({ title, value, color, onClick, active }) => (
  <ButtonBase
    onClick={onClick}
    aria-pressed={active}
    sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: 0.25,
      width: '100%',
      height: '100%',
      p: 2,
      textAlign: 'left',
      borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
      bgcolor: active ? BRAND.paper : 'transparent',
      '&:hover': { bgcolor: BRAND.paper },
    }}
  >
    <Typography
      component="span"
      variant="caption"
      sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
    >
      {title}
    </Typography>
    <Typography
      component="span"
      sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 26, color: BRAND.ink }}
    >
      {value}
    </Typography>
  </ButtonBase>
)

const Thumb = ({ product, size = 40 }) => {
  const url = getProductImageUrl(product)
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: 2,
        flexShrink: 0,
        overflow: 'hidden',
        bgcolor: BRAND.paper,
        border: `1px solid ${BRAND.line}`,
      }}
    >
      {url && (
        <Box
          component="img"
          src={url}
          alt=""
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
    </Box>
  )
}

const blockProducts = block =>
  (Array.isArray(block?.products) ? block.products : [])
    .map(item => (typeof item?.productId === 'object' ? item.productId : null))
    .filter(Boolean)

const ProductStrip = ({ block }) => {
  const products = blockProducts(block)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Stack direction="row" spacing={-1}>
        {products.slice(0, 3).map(product => (
          <Thumb key={getEntityId(product)} product={product} size={32} />
        ))}
      </Stack>
      <Typography variant="body2" sx={{ color: BRAND.muted, whiteSpace: 'nowrap' }}>
        {block.products?.length || 0} de {block.maxItems}
      </Typography>
    </Stack>
  )
}

const BlockActions = ({ block, onEdit, onToggle, onDelete, busy }) => (
  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
    <Tooltip title={block.isActive ? 'Pausar' : 'Activar'}>
      <Switch
        checked={Boolean(block.isActive)}
        onChange={() => onToggle(block)}
        disabled={busy}
        slotProps={{ input: { 'aria-label': `Activo: ${block.title}` } }}
      />
    </Tooltip>
    <Tooltip title="Editar">
      <IconButton aria-label={`Editar ${block.title}`} onClick={() => onEdit(block)}>
        <EditIcon fontSize="small" />
      </IconButton>
    </Tooltip>
    <Tooltip title="Eliminar">
      <IconButton
        aria-label={`Eliminar ${block.title}`}
        onClick={() => onDelete(block)}
        disabled={busy}
        sx={{ color: BRAND.red }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  </Stack>
)

const PromotionalBlocksPage = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width:600px)')

  const [blocks, setBlocks] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const requestSeq = useRef(0)

  const [summaryFilter, setSummaryFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  const [editor, setEditor] = useState(null) // { block|null }
  const [form, setForm] = useState(newForm)
  const [triedToSave, setTriedToSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerResults, setPickerResults] = useState([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const pickerSeq = useRef(0)

  const [confirming, setConfirming] = useState(null) // { action, block }
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search])

  // La pantalla maneja sus propios avisos: lo que el slice deja en error o
  // successMessage no se muestra en otro lado.
  const clearSliceMessages = useCallback(() => {
    dispatch(clearPromotionalBlocksError())
    dispatch(clearPromotionalBlocksSuccess())
  }, [dispatch])

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setLoadError('')
    try {
      const payload = await dispatch(
        fetchPromotionalBlocks({
          page: 1,
          limit: FETCH_LIMIT,
          type: typeFilter || undefined,
          q: debouncedSearch || undefined,
        }),
      ).unwrap()
      if (seq !== requestSeq.current) return
      const list = toList(payload)
      setBlocks(list)
      setTotal(Number(payload?.meta?.total ?? list.length))
      setLoaded(true)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setLoadError(messageOf(err, 'No se pudieron cargar los bloques.'))
    } finally {
      if (seq === requestSeq.current) setLoading(false)
      clearSliceMessages()
    }
  }, [clearSliceMessages, debouncedSearch, dispatch, typeFilter])

  useEffect(() => {
    load()
  }, [load])

  const statusOf = useMemo(() => {
    const now = Date.now()
    return new Map(blocks.map(block => [block._id, getBlockStatus(block, now)]))
  }, [blocks])

  const counts = useMemo(() => {
    const result = { all: blocks.length }
    for (const tile of SUMMARY) {
      result[tile.key] = blocks.filter(block =>
        tile.statuses.includes(statusOf.get(block._id)),
      ).length
    }
    return result
  }, [blocks, statusOf])

  const visible = useMemo(() => {
    if (summaryFilter === 'all') return blocks
    const tile = SUMMARY.find(item => item.key === summaryFilter)
    return blocks.filter(block => tile.statuses.includes(statusOf.get(block._id)))
  }, [blocks, statusOf, summaryFilter])

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))

  // Si la página actual se vacía (por ejemplo al eliminar el último), se vuelve
  // a la última que tenga algo.
  useEffect(() => {
    if (page > pages) setPage(pages)
  }, [page, pages])

  const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ---------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------

  const errors = useMemo(() => validateBlock(form), [form])
  const errorCount = Object.keys(errors).length
  const fieldError = key => (triedToSave ? errors[key] || '' : '')

  const openEditor = block => {
    setEditor({ block })
    setForm(block ? formFromBlock(block) : newForm())
    setTriedToSave(false)
    setSaveError('')
    setPickerSearch('')
  }

  const closeEditor = () => {
    if (saving) return
    setEditor(null)
  }

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  const setProductField = (productId, key, value) =>
    setForm(prev => ({
      ...prev,
      products: prev.products.map(item =>
        item.productId === productId ? { ...item, [key]: value } : item,
      ),
    }))

  const toggleProduct = product => {
    const productId = getEntityId(product)
    setForm(prev => {
      if (prev.products.some(item => item.productId === productId)) {
        return { ...prev, products: prev.products.filter(item => item.productId !== productId) }
      }
      return {
        ...prev,
        products: [
          ...prev.products,
          {
            productId,
            product,
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

  // Busca en todo el catálogo del comercio, en el servidor. Antes se pedía la
  // lista pública sin parámetros: el backend devuelve 12 por defecto y solo se
  // podía elegir entre esos.
  useEffect(() => {
    if (!editor) return undefined
    const seq = ++pickerSeq.current
    const timer = setTimeout(
      async () => {
        setPickerLoading(true)
        setPickerError('')
        try {
          const payload = await productService.getAdminProducts({
            q: pickerSearch.trim() || undefined,
            limit: PICKER_LIMIT,
            page: 1,
          })
          if (seq !== pickerSeq.current) return
          setPickerResults(toList(payload))
        } catch (err) {
          if (seq !== pickerSeq.current) return
          setPickerError(messageOf(err, 'No se pudieron cargar los productos.'))
        } finally {
          if (seq === pickerSeq.current) setPickerLoading(false)
        }
      },
      pickerSearch ? DEBOUNCE_MS : 0,
    )
    return () => clearTimeout(timer)
  }, [editor, pickerSearch])

  const handleSave = async () => {
    setTriedToSave(true)
    setSaveError('')
    if (errorCount > 0) return

    setSaving(true)
    try {
      const payload = buildPayload(form)
      if (editor.block?._id) {
        await dispatch(updatePromotionalBlock({ id: editor.block._id, data: payload })).unwrap()
      } else {
        await dispatch(createPromotionalBlock(payload)).unwrap()
      }
      setEditor(null)
      setNotice(editor.block ? 'Bloque guardado.' : 'Bloque creado.')
      load()
    } catch (err) {
      setSaveError(messageOf(err, 'No se pudo guardar el bloque.'))
    } finally {
      setSaving(false)
      clearSliceMessages()
    }
  }

  // ---------------------------------------------------------------------------
  // Activar / pausar / eliminar
  // ---------------------------------------------------------------------------

  const askConfirm = (action, block) => {
    setConfirmError('')
    setConfirming({ action, block })
  }

  const closeConfirm = () => {
    if (confirmBusy) return
    setConfirming(null)
  }

  const runConfirm = async () => {
    const { action, block } = confirming
    setConfirmBusy(true)
    setConfirmError('')
    try {
      if (action === 'delete') {
        await dispatch(deletePromotionalBlock({ id: block._id, hard: true })).unwrap()
        setNotice('Bloque eliminado.')
      } else {
        await dispatch(
          togglePromotionalBlockStatus({ id: block._id, isActive: !block.isActive }),
        ).unwrap()
        setNotice(block.isActive ? 'Bloque pausado.' : 'Bloque activado.')
      }
      setConfirming(null)
      load()
    } catch (err) {
      setConfirmError(messageOf(err, 'No se pudo completar la acción.'))
    } finally {
      setConfirmBusy(false)
      clearSliceMessages()
    }
  }

  const confirmCopy = (() => {
    if (!confirming) return null
    const { action, block } = confirming
    if (action === 'delete') {
      return {
        title: '¿Eliminar este bloque?',
        body: `«${block.title}» se borra para siempre y deja de verse en la tienda. No se puede deshacer.`,
        action: 'Eliminar definitivamente',
        color: 'error',
      }
    }
    if (block.isActive) {
      return {
        title: '¿Pausar este bloque?',
        body: `«${block.title}» deja de verse en la tienda hasta que lo vuelvas a activar.`,
        action: 'Pausar',
        color: 'primary',
      }
    }
    const notify =
      hasDiscounts(block.products || []) && getBlockStatus({ ...block, isActive: true }) === 'live'
    return {
      title: '¿Activar este bloque?',
      body: `«${block.title}» vuelve a verse en la tienda.${
        notify
          ? ' Tiene productos con descuento: HENKO avisa por email a los clientes que los tienen en favoritos.'
          : ''
      }`,
      action: 'Activar',
      color: 'primary',
    }
  })()

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const selectedIds = new Set(form.products.map(item => item.productId))
  const full = form.products.length >= Number(form.maxItems || 0)
  const placement = getPlacement(form.placement)

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 1180, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={() => navigate('/admin')}
          sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted, ml: -1, mb: 1 }}
        >
          Volver al panel
        </Button>
        <Typography
          variant="overline"
          sx={{ display: 'block', color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          TU TIENDA
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' } }}
        >
          <Box>
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
              Bloques promocionales
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 640 }}>
              Secciones de ofertas, destacados y novedades que se ven en el inicio, la tienda y la
              ficha de cada producto.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openEditor(null)}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
          >
            Nuevo bloque
          </Button>
        </Stack>
      </Box>

      <Paper
        component="section"
        aria-label="Resumen de bloques"
        variant="outlined"
        sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(5, 1fr)',
            },
          }}
        >
          {SUMMARY.map(tile => (
            <SummaryTile
              key={tile.key}
              title={tile.label}
              value={loaded ? counts[tile.key] : '–'}
              color={tile.color}
              active={summaryFilter === tile.key}
              onClick={() => {
                setSummaryFilter(tile.key)
                setPage(1)
              }}
            />
          ))}
          <SummaryTile
            title="Todos"
            value={loaded ? counts.all : '–'}
            color={BRAND.blue}
            active={summaryFilter === 'all'}
            onClick={() => {
              setSummaryFilter('all')
              setPage(1)
            }}
          />
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ ...PANEL_SX, mb: 3, p: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Buscar bloque"
            placeholder="Título, dirección o descripción"
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
          <TextField
            select
            size="small"
            label="Tipo"
            value={typeFilter}
            onChange={event => {
              setTypeFilter(event.target.value)
              setPage(1)
            }}
            sx={{ minWidth: { sm: 240 } }}
          >
            <MenuItem value="">Todos los tipos</MenuItem>
            {BLOCK_TYPES.map(item => (
              <MenuItem key={item.value} value={item.value}>
                {item.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      {loadError && (
        <Alert severity="error" sx={{ mb: 3 }} action={<Button onClick={load}>Reintentar</Button>}>
          {loadError}
        </Alert>
      )}

      {total > FETCH_LIMIT && (
        <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
          Hay {total} bloques: se muestran los primeros {FETCH_LIMIT}. Usá la búsqueda o el tipo
          para encontrar el resto.
        </Alert>
      )}

      {/* Si la carga falló y no hay nada para mostrar, el error ya lo dice todo:
          sin una tabla vacía debajo. */}
      {!(loadError && blocks.length === 0) && (
        <Paper variant="outlined" sx={{ ...PANEL_SX, overflow: 'hidden', position: 'relative' }}>
          {loading && loaded && (
            <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
          )}

          {!loaded && loading ? (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress />
            </Box>
          ) : !loadError && pageItems.length === 0 ? (
            <Box sx={{ p: 6, textAlign: 'center' }}>
              <Typography sx={{ fontWeight: 700 }}>
                {blocks.length === 0 && !debouncedSearch && !typeFilter
                  ? 'Todavía no hay bloques.'
                  : 'No hay bloques para este filtro.'}
              </Typography>
              {blocks.length === 0 && !debouncedSearch && !typeFilter && (
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => openEditor(null)}
                  sx={{ mt: 2, borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                >
                  Crear el primero
                </Button>
              )}
            </Box>
          ) : isMobile ? (
            <Stack sx={{ opacity: loading ? 0.6 : 1 }}>
              {pageItems.map((block, index) => (
                <Box
                  key={block._id}
                  component="article"
                  aria-label={block.title}
                  sx={{ p: 2, borderTop: index ? `1px solid ${BRAND.line}` : 'none' }}
                >
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>{block.title}</Typography>
                      <Typography variant="caption" sx={{ color: BRAND.muted }}>
                        {getTypeLabel(block.type)} · {formatDate(block.startDate)} al{' '}
                        {formatDate(block.endDate)}
                      </Typography>
                    </Box>
                    <Pill status={statusOf.get(block._id)} />
                  </Stack>
                  <Stack
                    direction="row"
                    sx={{ mt: 1.5, justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <ProductStrip block={block} />
                    <BlockActions
                      block={block}
                      busy={confirmBusy}
                      onEdit={openEditor}
                      onToggle={b => askConfirm('toggle', b)}
                      onDelete={b => askConfirm('delete', b)}
                    />
                  </Stack>
                </Box>
              ))}
            </Stack>
          ) : (
            <TableContainer sx={{ opacity: loading ? 0.6 : 1 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Bloque</TableCell>
                    <TableCell>Productos</TableCell>
                    <TableCell>Vigencia</TableCell>
                    <TableCell>Estado</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pageItems.map(block => (
                    <TableRow key={block._id} hover>
                      <TableCell sx={{ maxWidth: 380 }}>
                        <Typography sx={{ fontWeight: 700 }}>{block.title}</Typography>
                        <Typography variant="caption" sx={{ color: BRAND.muted, display: 'block' }}>
                          {getTypeLabel(block.type)}
                          {block.description ? ` · ${block.description}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <ProductStrip block={block} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="body2">{formatDate(block.startDate)}</Typography>
                        <Typography variant="caption" sx={{ color: BRAND.muted }}>
                          al {formatDate(block.endDate)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Pill status={statusOf.get(block._id)} />
                      </TableCell>
                      <TableCell align="right">
                        <BlockActions
                          block={block}
                          busy={confirmBusy}
                          onEdit={openEditor}
                          onToggle={b => askConfirm('toggle', b)}
                          onDelete={b => askConfirm('delete', b)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {pages > 1 && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{
                p: 2,
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: `1px solid ${BRAND.line}`,
              }}
            >
              <Typography variant="body2" sx={{ color: BRAND.muted }}>
                Mostrando {pageItems.length} de {visible.length} (página {page} de {pages})
              </Typography>
              <Pagination
                count={pages}
                page={page}
                onChange={(_, next) => setPage(next)}
                color="primary"
                getItemAriaLabel={(type, item) =>
                  type === 'page'
                    ? `Página ${item}`
                    : type === 'next'
                      ? 'Página siguiente'
                      : type === 'previous'
                        ? 'Página anterior'
                        : type
                }
              />
            </Stack>
          )}
        </Paper>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Editor                                                              */}
      {/* ------------------------------------------------------------------ */}

      <Dialog
        open={Boolean(editor)}
        onClose={closeEditor}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        {editor && (
          <>
            <DialogTitle
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              {editor.block ? 'Editar bloque' : 'Nuevo bloque'}
              <IconButton aria-label="Cerrar" onClick={closeEditor} disabled={saving}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={3}>
                <Box component="section" aria-label="Qué muestra">
                  <Typography sx={{ fontWeight: 800, mb: 1.5 }}>Qué muestra</Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 8 }}>
                      <TextField
                        fullWidth
                        required
                        label="Título"
                        value={form.title}
                        onChange={event => setField('title', event.target.value)}
                        error={Boolean(fieldError('title'))}
                        helperText={
                          fieldError('title') ||
                          `${form.title.trim().length} de ${LIMITS.title} caracteres`
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        select
                        fullWidth
                        label="Tipo"
                        value={form.type}
                        onChange={event => setField('type', event.target.value)}
                      >
                        {BLOCK_TYPES.map(item => (
                          <MenuItem key={item.value} value={item.value}>
                            {item.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        multiline
                        minRows={2}
                        label="Descripción"
                        value={form.description}
                        onChange={event => setField('description', event.target.value)}
                        error={Boolean(fieldError('description'))}
                        helperText={
                          fieldError('description') ||
                          `Opcional. ${form.description.trim().length} de ${LIMITS.description} caracteres`
                        }
                      />
                    </Grid>
                  </Grid>
                </Box>

                <Box component="section" aria-label="Dónde y cuándo">
                  <Typography sx={{ fontWeight: 800, mb: 1.5 }}>Dónde y cuándo</Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        select
                        fullWidth
                        label="Ubicación"
                        value={form.placement}
                        onChange={event => setField('placement', event.target.value)}
                        helperText={
                          placement?.shown
                            ? ''
                            : 'La tienda todavía no muestra bloques en esta ubicación: no se va a ver.'
                        }
                        error={!placement?.shown}
                      >
                        {PLACEMENTS.map(item => (
                          <MenuItem
                            key={item.value}
                            value={item.value}
                            disabled={!item.shown && item.value !== form.placement}
                          >
                            {item.label}
                            {item.shown ? '' : ' (todavía no se muestra)'}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="Dirección (opcional)"
                        value={form.slug}
                        onChange={event => setField('slug', event.target.value)}
                        error={Boolean(fieldError('slug'))}
                        helperText={
                          fieldError('slug') || 'Si la dejás vacía, se arma con el título.'
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Desde"
                        value={form.startDate}
                        onChange={event => setField('startDate', event.target.value)}
                        error={Boolean(fieldError('startDate'))}
                        helperText={fieldError('startDate')}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        type="datetime-local"
                        label="Hasta"
                        value={form.endDate}
                        onChange={event => setField('endDate', event.target.value)}
                        error={Boolean(fieldError('endDate'))}
                        helperText={fieldError('endDate')}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <TextField
                        fullWidth
                        type="number"
                        label="Orden"
                        value={form.priority}
                        onChange={event => setField('priority', event.target.value)}
                        error={Boolean(fieldError('priority'))}
                        helperText={fieldError('priority') || '1 sale primero'}
                        slotProps={{ htmlInput: { min: 1, max: LIMITS.priority, step: 1 } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 3 }}>
                      <TextField
                        select
                        fullWidth
                        label="Visibilidad"
                        value={form.visibility}
                        onChange={event => setField('visibility', event.target.value)}
                      >
                        <MenuItem value="public">Pública</MenuItem>
                        <MenuItem value="hidden">Oculta</MenuItem>
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }} sx={{ display: 'flex', alignItems: 'center' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={form.isActive}
                            onChange={event => setField('isActive', event.target.checked)}
                          />
                        }
                        label={form.isActive ? 'Activo' : 'Pausado'}
                      />
                    </Grid>
                  </Grid>
                </Box>

                <Box component="section" aria-label="Productos">
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 1.5 }}
                  >
                    <Box>
                      <Typography sx={{ fontWeight: 800 }}>Productos</Typography>
                      <Typography variant="body2" sx={{ color: BRAND.muted }}>
                        {plural(form.products.length, 'elegido', 'elegidos')} de un máximo de{' '}
                        {form.maxItems || '—'}
                      </Typography>
                    </Box>
                    <TextField
                      type="number"
                      size="small"
                      label="Máximo"
                      value={form.maxItems}
                      onChange={event => setField('maxItems', event.target.value)}
                      error={Boolean(fieldError('maxItems'))}
                      helperText={fieldError('maxItems')}
                      slotProps={{ htmlInput: { min: 1, max: LIMITS.maxItems, step: 1 } }}
                      sx={{ width: { sm: 140 } }}
                    />
                  </Stack>

                  {form.products.length > 0 && (
                    <Stack spacing={1.5} sx={{ mb: 2 }}>
                      {form.products.map(item => {
                        const key = `producto:${item.productId}`
                        const product =
                          item.product ||
                          pickerResults.find(p => getEntityId(p) === item.productId) ||
                          null
                        return (
                          <Paper
                            key={item.productId}
                            variant="outlined"
                            component="article"
                            aria-label={product?.title || 'Producto'}
                            sx={{ p: 1.5, borderRadius: 3, borderColor: BRAND.line }}
                          >
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                              <Thumb product={product} />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 700 }} noWrap>
                                  {product?.title || 'Producto que ya no está en el catálogo'}
                                </Typography>
                                {product?.price != null && (
                                  <Typography variant="caption" sx={{ color: BRAND.muted }}>
                                    {formatPesos(product.price)}
                                  </Typography>
                                )}
                              </Box>
                              <FormControlLabel
                                control={
                                  <Switch
                                    size="small"
                                    checked={item.isActive !== false}
                                    onChange={event =>
                                      setProductField(
                                        item.productId,
                                        'isActive',
                                        event.target.checked,
                                      )
                                    }
                                  />
                                }
                                label="Se ve"
                                sx={{ m: 0 }}
                              />
                              <IconButton
                                aria-label={`Quitar ${product?.title || 'producto'}`}
                                onClick={() => toggleProduct({ _id: item.productId })}
                                sx={{ color: BRAND.red }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Stack>
                            <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                              <Grid size={{ xs: 6, sm: 2 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  type="number"
                                  label="% de descuento"
                                  value={item.discountPercentage}
                                  onChange={event =>
                                    setProductField(
                                      item.productId,
                                      'discountPercentage',
                                      event.target.value,
                                    )
                                  }
                                  error={Boolean(fieldError(`${key}:discountPercentage`))}
                                  helperText={fieldError(`${key}:discountPercentage`)}
                                  slotProps={{ htmlInput: { min: 0, max: 100 } }}
                                />
                              </Grid>
                              <Grid size={{ xs: 6, sm: 2 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  type="number"
                                  label="Orden"
                                  value={item.priority}
                                  onChange={event =>
                                    setProductField(item.productId, 'priority', event.target.value)
                                  }
                                  error={Boolean(fieldError(`${key}:priority`))}
                                  helperText={fieldError(`${key}:priority`)}
                                  slotProps={{ htmlInput: { min: 1, max: LIMITS.priority } }}
                                />
                              </Grid>
                              <Grid size={{ xs: 12, sm: 3 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="Etiqueta"
                                  placeholder="Ej.: Últimas unidades"
                                  value={item.customLabel}
                                  onChange={event =>
                                    setProductField(
                                      item.productId,
                                      'customLabel',
                                      event.target.value,
                                    )
                                  }
                                  error={Boolean(fieldError(`${key}:customLabel`))}
                                  helperText={fieldError(`${key}:customLabel`)}
                                />
                              </Grid>
                              <Grid size={{ xs: 12, sm: 5 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="Título en el bloque"
                                  placeholder={product?.title || ''}
                                  value={item.customTitle}
                                  onChange={event =>
                                    setProductField(
                                      item.productId,
                                      'customTitle',
                                      event.target.value,
                                    )
                                  }
                                  error={Boolean(fieldError(`${key}:customTitle`))}
                                  helperText={fieldError(`${key}:customTitle`)}
                                />
                              </Grid>
                            </Grid>
                          </Paper>
                        )
                      })}
                    </Stack>
                  )}

                  {hasDiscounts(form.products) && (
                    <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
                      Mientras el bloque esté vigente, HENKO avisa por email a los clientes que
                      tienen estos productos en favoritos.
                    </Alert>
                  )}

                  <TextField
                    fullWidth
                    size="small"
                    label="Buscar productos para agregar"
                    value={pickerSearch}
                    onChange={event => setPickerSearch(event.target.value)}
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
                  {pickerError && (
                    <Alert severity="error" sx={{ mt: 1.5 }}>
                      {pickerError}
                    </Alert>
                  )}
                  <Box
                    role="list"
                    aria-label="Productos del catálogo"
                    sx={{
                      mt: 1.5,
                      border: `1px solid ${BRAND.line}`,
                      borderRadius: 3,
                      maxHeight: 280,
                      overflowY: 'auto',
                      opacity: pickerLoading ? 0.6 : 1,
                    }}
                  >
                    {pickerResults.length === 0 && !pickerLoading ? (
                      <Typography sx={{ p: 2, color: BRAND.muted, textAlign: 'center' }}>
                        {pickerSearch ? 'Ningún producto coincide.' : 'No hay productos.'}
                      </Typography>
                    ) : (
                      pickerResults.map((product, index) => {
                        const productId = getEntityId(product)
                        const selected = selectedIds.has(productId)
                        const disabled = !selected && full
                        return (
                          <ButtonBase
                            key={productId}
                            role="listitem"
                            aria-pressed={selected}
                            disabled={disabled}
                            onClick={() => toggleProduct(product)}
                            sx={{
                              width: '100%',
                              display: 'flex',
                              gap: 1.5,
                              px: 1.5,
                              py: 1,
                              justifyContent: 'flex-start',
                              textAlign: 'left',
                              borderTop: index ? `1px solid ${BRAND.line}` : 'none',
                              bgcolor: selected ? BRAND.paper : 'transparent',
                              opacity: disabled ? 0.5 : 1,
                              '&:hover': { bgcolor: BRAND.paper },
                            }}
                          >
                            <Thumb product={product} size={36} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                                {product.title || 'Producto sin título'}
                              </Typography>
                              <Typography variant="caption" sx={{ color: BRAND.muted }}>
                                {formatPesos(product.price)}
                                {product.status && product.status !== 'active'
                                  ? ' · no publicado'
                                  : ''}
                              </Typography>
                            </Box>
                            <Typography
                              variant="caption"
                              sx={{ fontWeight: 700, color: selected ? BRAND.blue : BRAND.muted }}
                            >
                              {selected ? 'Elegido' : disabled ? 'Llegaste al máximo' : 'Agregar'}
                            </Typography>
                          </ButtonBase>
                        )
                      })
                    )}
                  </Box>
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, py: 2 }}>
              {saveError && (
                <Alert severity="error" sx={{ width: '100%' }}>
                  {saveError}
                </Alert>
              )}
              {triedToSave && errorCount > 0 && (
                <Typography variant="body2" sx={{ color: BRAND.red, mr: 'auto', fontWeight: 700 }}>
                  Revisá {plural(errorCount, 'campo marcado', 'campos marcados')}.
                </Typography>
              )}
              <Button onClick={closeEditor} disabled={saving}>
                Cancelar
              </Button>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
              >
                {saving ? 'Guardando…' : editor.block ? 'Guardar cambios' : 'Crear bloque'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog open={Boolean(confirming)} onClose={closeConfirm} maxWidth="xs" fullWidth>
        {confirmCopy && (
          <>
            <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
              {confirmCopy.title}
            </DialogTitle>
            <DialogContent>
              <Typography color="text.secondary">{confirmCopy.body}</Typography>
              {confirmError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {confirmError}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={closeConfirm} disabled={confirmBusy}>
                Cancelar
              </Button>
              <Button
                variant="contained"
                color={confirmCopy.color}
                onClick={runConfirm}
                disabled={confirmBusy}
                startIcon={confirmBusy ? <CircularProgress size={16} color="inherit" /> : null}
              >
                {confirmCopy.action}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3500}
        onClose={() => setNotice('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice('')}>
          {notice}
        </Alert>
      </Snackbar>
    </Box>
  )
}

export default PromotionalBlocksPage
