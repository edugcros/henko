// 📁 src/pages/AdminOrdersPage.jsx
// VERSIÓN PRODUCCIÓN - ADMIN ORDERS / MULTI-TENANT / FORCE DELETE SAFE

import React, { useEffect, useState, useMemo, useCallback, memo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Box,
  Typography,
  Paper,
  Grid,
  Pagination,
  TextField,
  CircularProgress,
  InputAdornment,
  Button,
  Chip,
  Avatar,
  Divider,
  IconButton,
  Tooltip,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Alert,
  Stack,
  FormControl,
  InputLabel,
  Select,
  Snackbar,
  Fade,
  Container,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  ButtonBase,
  useMediaQuery,
} from '@mui/material'
import {
  Search,
  Refresh,
  LocationOn,
  Email,
  Phone,
  ExpandMore,
  ExpandLess,
  Info,
  Inventory,
  ShoppingBag,
  Warning,
  Download,
  Visibility,
  Close,
  DeleteForever,
  LocalShipping,
  Save,
  FilterAltOff,
} from '@mui/icons-material'
import {
  getOrdersThunk,
  updateOrderStatusThunk,
  updateOrderPaymentStatusThunk,
  updateOrderFulfillmentStatusThunk,
  cancelOrderThunk,
  refundOrderThunk,
  deleteOrderThunk,
  updateOrderShipmentThunk,
} from '@features/order/orderSlice'
import dayjs from 'dayjs'
import debounce from 'lodash.debounce'

// ==========================================
// CONSTANTES
// ==========================================

const ORDER_STATUSES = {
  OPEN: 'open',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  PAYMENT_PENDING: 'payment_pending',
  NOT_PROCESSED: 'not_processed',
  DISPATCHED: 'dispatched',
}

const PAYMENT_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
}

const FULFILLMENT_STATUSES = {
  UNFULFILLED: 'unfulfilled',
  PREPARING: 'preparing',
  READY_TO_SHIP: 'ready_to_ship',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
}

const PAYMENT_TRANSITIONS = {
  pending: ['pending', 'approved', 'rejected', 'cancelled'],
  approved: ['approved'],
  rejected: ['rejected'],
  cancelled: ['cancelled'],
  refunded: ['refunded'],
}

const FULFILLMENT_TRANSITIONS = {
  unfulfilled: ['unfulfilled', 'preparing', 'ready_to_ship', 'shipped'],
  preparing: ['preparing', 'ready_to_ship', 'shipped'],
  ready_to_ship: ['ready_to_ship', 'shipped'],
  shipped: ['shipped', 'delivered', 'returned'],
  delivered: ['delivered'],
  returned: ['returned'],
}

const CONFIRM_ACTIONS = {
  APPROVE_PAYMENT: 'approve_payment',
  CANCEL_ORDER: 'cancel_order',
  REFUND_ORDER: 'refund_order',
  DELETE_ORDER: 'delete_order',
  FORCE_DELETE_ORDER: 'force_delete_order',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
}

const API_ERROR_CODES = {
  FORCE_DELETE_REQUIRED: 'ORDER_DELETE_REQUIRES_FORCE',
}

const CONFIG = {
  DEBOUNCE_MS: 300,
  MAX_SEARCH_LENGTH: 100,
  DEFAULT_PAGE_SIZE: 10,
  HIGH_VALUE_THRESHOLD: 100000,
  EXPORT_FILENAME_PREFIX: 'ordenes-admin',
}

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  violet: '#7a2cff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const EMPTY_CONFIRM_DIALOG = {
  open: false,
  orderId: null,
  action: null,
  payload: null,
  orderTotal: 0,
  orderNumber: null,
  protectedOrder: false,
}

const LEGACY_TO_UI_ORDER_STATUS = {
  payment_pending: ORDER_STATUSES.OPEN,
  not_processed: ORDER_STATUSES.OPEN,
  processing: ORDER_STATUSES.PROCESSING,
  dispatched: ORDER_STATUSES.SHIPPED,
  delivered: ORDER_STATUSES.DELIVERED,
  cancelled: ORDER_STATUSES.CANCELLED,
  refunded: ORDER_STATUSES.REFUNDED,
  open: ORDER_STATUSES.OPEN,
  shipped: ORDER_STATUSES.SHIPPED,
}

const UI_TO_LEGACY_ORDER_STATUS = {
  open: ORDER_STATUSES.OPEN,
  processing: ORDER_STATUSES.PROCESSING,
  shipped: ORDER_STATUSES.SHIPPED,
  delivered: ORDER_STATUSES.DELIVERED,
  cancelled: ORDER_STATUSES.CANCELLED,
  refunded: ORDER_STATUSES.REFUNDED,
}

// Cada estado tiene su color (ámbar: falta algo, azul: en marcha, verde: terminó bien, rojo: se cortó,
// violeta: se devolvió). El texto va siempre escrito: el color solo no alcanza para distinguirlos.
const TONES = {
  neutral: { color: '#55618a', bgColor: '#f1f4fb' },
  warning: { color: '#9a5b00', bgColor: '#fff6e0' },
  info: { color: '#0b55cc', bgColor: '#eaf2ff' },
  success: { color: '#047857', bgColor: '#e8f8f0' },
  danger: { color: '#b42318', bgColor: '#fdeceb' },
  returned: { color: '#6d28d9', bgColor: '#f3ecff' },
}

const STATUS_BADGE_CONFIGS = {
  open: { ...TONES.warning, label: 'Abierta' },
  processing: { ...TONES.info, label: 'Procesando' },
  shipped: { ...TONES.info, label: 'Enviada' },
  delivered: { ...TONES.success, label: 'Entregada' },
  cancelled: { ...TONES.danger, label: 'Cancelada' },
  refunded: { ...TONES.returned, label: 'Reembolsada' },
}

const PAYMENT_BADGE_CONFIGS = {
  pending: { ...TONES.warning, label: 'Pendiente' },
  approved: { ...TONES.success, label: 'Aprobado' },
  rejected: { ...TONES.danger, label: 'Rechazado' },
  cancelled: { ...TONES.danger, label: 'Cancelado' },
  refunded: { ...TONES.returned, label: 'Reembolsado' },
}

const FULFILLMENT_BADGE_CONFIGS = {
  unfulfilled: { ...TONES.neutral, label: 'Sin preparar' },
  preparing: { ...TONES.info, label: 'Preparando' },
  ready_to_ship: { ...TONES.info, label: 'Lista para envío' },
  shipped: { ...TONES.info, label: 'En tránsito' },
  delivered: { ...TONES.success, label: 'Entregada' },
  returned: { ...TONES.returned, label: 'Devuelta' },
}

// ==========================================
// HELPERS
// ==========================================

export const normalizeValue = value => {
  if (value === null || value === undefined) return 0
  if (typeof value === 'object' && value.$numberDecimal) return Number(value.$numberDecimal) || 0
  if (typeof value === 'object' && value.$numberInt) return Number(value.$numberInt) || 0
  if (typeof value === 'object' && value.$numberLong) return Number(value.$numberLong) || 0

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const resolveMoneyAmount = (decimalValue, centsValue) => {
  const decimal = normalizeValue(decimalValue)

  if (decimal > 0) return decimal

  const cents = normalizeValue(centsValue)
  if (cents > 0) return cents / 100

  return 0
}

export const formatCurrency = amount => {
  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(normalizeValue(amount))
  } catch {
    return `$${normalizeValue(amount).toFixed(2)}`
  }
}

export const formatDateShort = date => {
  if (!date) return '-'

  try {
    const parsed = dayjs(date)
    return parsed.isValid() ? parsed.format('DD/MM/YY') : '-'
  } catch {
    return '-'
  }
}

const formatDateFile = () => dayjs().format('YYYY-MM-DD-HHmm')

const normalizeString = value => String(value || '').trim()

export const normalizeOrderStatusForUI = status => {
  const normalized = normalizeString(status).toLowerCase()
  return LEGACY_TO_UI_ORDER_STATUS[normalized] || ORDER_STATUSES.OPEN
}

export const normalizeOrderStatusForLegacyApi = status => {
  const normalized = normalizeString(status).toLowerCase()
  return UI_TO_LEGACY_ORDER_STATUS[normalized] || ORDER_STATUSES.OPEN
}

export const buildApiFilters = filters => {
  const normalizedStatus = normalizeString(filters.status).toLowerCase()

  return {
    ...filters,
    status: normalizedStatus,
    q: normalizeString(filters.q).slice(0, CONFIG.MAX_SEARCH_LENGTH),
  }
}

export const getOrderDisplayId = order =>
  order?.orderNumber || order?._id?.slice(-8)?.toUpperCase() || 'SIN-ID'

export const getOrderCustomerName = order => {
  const firstName =
    order?.orderby?.firstName ||
    order?.orderby?.firstname ||
    order?.customerSnapshot?.firstname ||
    order?.shippingAddress?.firstName ||
    ''

  const lastName =
    order?.orderby?.lastName ||
    order?.orderby?.lastname ||
    order?.customerSnapshot?.lastname ||
    order?.shippingAddress?.lastName ||
    ''

  return `${firstName} ${lastName}`.trim()
}

// Mismo orden que getBuyerEmail en backend/src/services/orderEmailService.js
// — es la fuente real que usa el backend para decidir a qué dirección le
// llegan los emails transaccionales de esta orden. Si el orden difiere acá,
// el admin le puede mostrar al operador un email distinto del que el
// cliente realmente recibió (ej. compró logueado pero puso otro email en el
// checkout).
export const getOrderCustomerEmail = order =>
  order?.shippingAddress?.email ||
  order?.customerSnapshot?.email ||
  order?.paymentIntent?.payerEmail ||
  order?.orderby?.email ||
  'Sin email'

export const getOrderCustomerPhone = order =>
  order?.orderby?.phone ||
  order?.orderby?.mobile ||
  order?.customerSnapshot?.mobile ||
  order?.shippingAddress?.phone ||
  ''

export const getProductImageUrl = product => {
  if (!product) return null

  if (product.image && typeof product.image === 'object' && product.image.url) {
    return product.image.url
  }

  if (typeof product.image === 'string') return product.image
  if (typeof product.images === 'string') return product.images

  if (Array.isArray(product.images) && product.images[0]) {
    const mainImage = product.images.find(image => image?.isMain)
    const image = mainImage || product.images[0]

    return typeof image === 'string' ? image : image?.url
  }

  return null
}

export const getLineImageUrl = item => {
  return item?.imageSnapshot || item?.image || getProductImageUrl(item?.product) || null
}

export const getLineTitle = item => {
  return item?.product?.title || item?.title || item?.titleSnapshot || 'Producto sin título'
}

export const getLineSku = item => {
  return (
    item?.product?.sku ||
    item?.sku ||
    item?.skuSnapshot ||
    item?.variantSku ||
    item?.variantSKU ||
    null
  )
}

export const getLineQuantity = item => {
  const quantity = normalizeValue(item?.count ?? item?.quantity)
  return quantity > 0 ? quantity : 0
}

export const isOrderProtectedFromDelete = order => {
  const paymentStatus = normalizeString(order?.paymentStatus).toLowerCase()
  const orderStatus = normalizeOrderStatusForUI(order?.orderStatus)
  const fulfillmentStatus = normalizeString(order?.fulfillmentStatus).toLowerCase()

  return (
    paymentStatus === PAYMENT_STATUSES.APPROVED ||
    orderStatus === ORDER_STATUSES.DELIVERED ||
    orderStatus === ORDER_STATUSES.REFUNDED ||
    fulfillmentStatus === FULFILLMENT_STATUSES.DELIVERED
  )
}

const getErrorMessage = (error, fallback = 'Error en la operación') => {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error?.message === 'string') return error.message
  return fallback
}

const getErrorCode = error => {
  if (!error || typeof error === 'string') return null
  return error.code || error.data?.code || null
}

const getErrorStatus = error => {
  if (!error || typeof error === 'string') return null
  return error.status || error.data?.status || null
}

const downloadTextFile = ({ filename, content, mimeType = 'text/csv;charset=utf-8;' }) => {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}

export const escapeCsv = value => {
  const raw = value === null || value === undefined ? '' : String(value)
  const escaped = raw.replace(/"/g, '""')
  return `"${escaped}"`
}

export const buildOrdersCsv = orders => {
  const headers = [
    'Pedido',
    'Fecha',
    'Cliente',
    'Email',
    'Total',
    'Estado orden',
    'Estado pago',
    'Estado logística',
    'Items',
  ]

  const rows = orders.map(order => [
    getOrderDisplayId(order),
    formatDateShort(order.createdAt),
    getOrderCustomerName(order),
    getOrderCustomerEmail(order),
    normalizeValue(order?.totals?.total).toFixed(2),
    normalizeOrderStatusForUI(order?.orderStatus),
    order?.paymentStatus || '',
    order?.fulfillmentStatus || '',
    order?.products?.length || 0,
  ])

  return [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n')
}

// ==========================================
// BADGES
// ==========================================

const Pill = ({ config, size = 'small' }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      px: 1.25,
      py: 0.25,
      borderRadius: 999,
      fontSize: size === 'small' ? '0.75rem' : '0.875rem',
      fontWeight: 700,
      color: config.color,
      bgcolor: config.bgColor,
      whiteSpace: 'nowrap',
    }}
  >
    {config.label}
  </Box>
)

const StatusBadge = memo(({ status, size = 'small' }) => {
  const normalizedStatus = normalizeOrderStatusForUI(status)

  return (
    <Pill
      config={STATUS_BADGE_CONFIGS[normalizedStatus] || STATUS_BADGE_CONFIGS.open}
      size={size}
    />
  )
})

StatusBadge.displayName = 'StatusBadge'

const PaymentBadge = memo(({ paymentStatus }) => {
  const normalizedStatus = normalizeString(paymentStatus).toLowerCase()

  return (
    <Pill
      config={
        PAYMENT_BADGE_CONFIGS[normalizedStatus] || {
          ...TONES.neutral,
          label: paymentStatus || 'Desconocido',
        }
      }
    />
  )
})

PaymentBadge.displayName = 'PaymentBadge'

const FulfillmentBadge = memo(({ fulfillmentStatus }) => {
  const normalizedStatus = normalizeString(fulfillmentStatus).toLowerCase()

  return (
    <Pill
      config={
        FULFILLMENT_BADGE_CONFIGS[normalizedStatus] || {
          ...TONES.neutral,
          label: fulfillmentStatus || 'Desconocido',
        }
      }
    />
  )
})

FulfillmentBadge.displayName = 'FulfillmentBadge'

// ==========================================
// PRESENTATION COMPONENTS
// ==========================================

const ProductItem = memo(({ item }) => {
  const imageUrl = getLineImageUrl(item)
  const title = getLineTitle(item)
  const sku = getLineSku(item)
  const quantity = getLineQuantity(item)
  const subtotal = resolveMoneyAmount(item?.subtotal, item?.subtotalCents)
  const price = resolveMoneyAmount(item?.price, item?.priceCents)

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
        gap: 2,
        p: 2,
        mb: 1.5,
        borderRadius: 3,
        border: `1px solid ${BRAND.line}`,
        bgcolor: 'white',
      }}
    >
      <Badge badgeContent={quantity} color="primary">
        <Avatar
          src={imageUrl || undefined}
          variant="rounded"
          sx={{
            width: 80,
            height: 80,
            bgcolor: BRAND.paper,
            border: `1px solid ${BRAND.line}`,
          }}
        >
          {!imageUrl && <ShoppingBag />}
        </Avatar>
      </Badge>

      <Box sx={{ flex: '1 1 140px', minWidth: 0 }}>
        <Typography
          variant="body1"

          sx={{ fontWeight: 500, color: BRAND.ink, mb: 0.5, lineHeight: 1.4 }}
        >
          {title}
        </Typography>

        {sku && (
          <Typography variant="caption" sx={{ color: BRAND.muted, display: 'block' }}>
            SKU: {sku}
          </Typography>
        )}
      </Box>

      <Box sx={{ textAlign: 'right', minWidth: 110, ml: 'auto' }}>
        <Typography
          variant="body1"

          sx={{ fontWeight: 700, color: BRAND.ink, fontSize: '1.1rem' }}
        >
          {formatCurrency(subtotal)}
        </Typography>

        <Typography variant="caption" sx={{ color: BRAND.muted }}>
          {quantity} × {formatCurrency(price)}
        </Typography>
      </Box>
    </Box>
  )
})

ProductItem.displayName = 'ProductItem'

const ShippingCard = memo(({ address }) => {
  if (!address) return null

  return (
    <Box
      sx={{
        mt: 2,
        p: 3,
        borderRadius: 3,
        border: `1px solid ${BRAND.line}`,
        bgcolor: 'white',
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: BRAND.ink,
          fontWeight: 700,
          fontSize: '0.9rem',
          mb: 2,
          textTransform: 'uppercase',
        }}
      >
        <LocationOn fontSize="small" sx={{ color: BRAND.blue }} />
        Dirección de envío
      </Typography>

      <Typography variant="body1" sx={{ fontWeight: 600 }}>
        {address.firstName || '-'} {address.lastName || ''}
      </Typography>

      <Typography variant="body2" sx={{ color: BRAND.muted, mt: 0.5 }}>
        {address.address || 'Sin dirección'}
      </Typography>

      <Typography variant="body2" sx={{ color: BRAND.muted }}>
        {address.city || 'Sin ciudad'}
        {address.zipCode && `, CP: ${address.zipCode}`}
        {address.country && `, ${address.country}`}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }} useFlexGap>
        {address.email && (
          <Chip
            icon={<Email fontSize="small" />}
            label={address.email}
            size="small"
            variant="outlined"
          />
        )}

        {/*{address.phone && (
          <Chip
            icon={<Phone fontSize="small" />}
            label={address.phone}
            size="small"
            variant="outlined"
          />
        )}*/}
      </Stack>
    </Box>
  )
})

ShippingCard.displayName = 'ShippingCard'

const ShipmentCard = memo(({ order, onSaveShipment, disabled = false }) => {
  const shipment = order?.shipment || {}
  const [trackingNumber, setTrackingNumber] = useState(shipment.trackingNumber || '')
  const [carrier, setCarrier] = useState(shipment.carrier || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTrackingNumber(shipment.trackingNumber || '')
    setCarrier(shipment.carrier || '')
  }, [shipment.trackingNumber, shipment.carrier])

  const hasChanges =
    trackingNumber.trim() !== (shipment.trackingNumber || '') ||
    carrier.trim() !== (shipment.carrier || '')

  const canSave = hasChanges && (trackingNumber.trim() || carrier.trim())

  const handleSave = useCallback(async () => {
    if (!canSave || saving) return

    setSaving(true)

    try {
      await onSaveShipment(order._id, {
        trackingNumber: trackingNumber.trim(),
        carrier: carrier.trim(),
      })
    } finally {
      setSaving(false)
    }
  }, [canSave, saving, onSaveShipment, order._id, trackingNumber, carrier])

  return (
    <Box
      sx={{
        mt: 2,
        p: 3,
        borderRadius: 3,
        border: `1px solid ${BRAND.line}`,
        bgcolor: 'white',
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: BRAND.ink,
          fontWeight: 700,
          fontSize: '0.9rem',
          mb: 2,
          textTransform: 'uppercase',
        }}
      >
        <LocalShipping fontSize="small" sx={{ color: BRAND.blue }} />
        Datos de envío
      </Typography>

      <TextField
        label="Código de seguimiento"
        value={trackingNumber}
        onChange={e => setTrackingNumber(e.target.value)}
        size="small"
        fullWidth
        disabled={disabled || saving}
        sx={{ mb: 1.5 }}
        inputProps={{ maxLength: 200 }}
      />

      <TextField
        label="Transportista"
        value={carrier}
        onChange={e => setCarrier(e.target.value)}
        size="small"
        fullWidth
        disabled={disabled || saving}
        sx={{ mb: 1.5 }}
        inputProps={{ maxLength: 100 }}
      />

      {shipment.shippedAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Despachado: {dayjs(shipment.shippedAt).format('DD/MM/YYYY HH:mm')}
        </Typography>
      )}

      {shipment.deliveredAt && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Entregado: {dayjs(shipment.deliveredAt).format('DD/MM/YYYY HH:mm')}
        </Typography>
      )}

      <Button
        variant="contained"
        size="small"
        startIcon={saving ? <CircularProgress size={16} /> : <Save />}
        onClick={handleSave}
        disabled={!canSave || disabled || saving}
        sx={{
          mt: 1.5,
          textTransform: 'none',
          fontWeight: 600,
        }}
      >
        {saving ? 'Guardando...' : 'Guardar envío'}
      </Button>
    </Box>
  )
})

ShipmentCard.displayName = 'ShipmentCard'

const OrderSummary = memo(({ totals, paymentStatus, fulfillmentStatus }) => {
  return (
    <Box
      sx={{
        mt: 2,
        p: 3,
        borderRadius: 3,
        border: `1px solid ${BRAND.line}`,
        bgcolor: BRAND.paper,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          color: BRAND.ink,
          fontWeight: 700,
          fontSize: '1rem',
          mb: 2,
          pb: 1,
          borderBottom: `1px solid ${BRAND.line}`,
        }}
      >
        Resumen del pedido
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="body2" sx={{ color: BRAND.muted }}>
          Subtotal
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {formatCurrency(totals?.subtotal)}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="body2" sx={{ color: BRAND.muted }}>
          Descuento
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          -{formatCurrency(totals?.discount)}
        </Typography>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography
          variant="h6"
          sx={{
            color: BRAND.ink,
            fontWeight: 700,
            fontSize: '1.1rem',
          }}
        >
          Total
        </Typography>

        <Typography
          variant="h5"
          sx={{
            color: BRAND.ink,
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: '1.5rem',
          }}
        >
          {formatCurrency(totals?.total)}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }} useFlexGap>
        <PaymentBadge paymentStatus={paymentStatus} />
        <FulfillmentBadge fulfillmentStatus={fulfillmentStatus} />
      </Stack>
    </Box>
  )
})

OrderSummary.displayName = 'OrderSummary'

// ==========================================
// CONTROL PANEL
// ==========================================

const OrderControlPanel = memo(
  ({
    order,
    onLegacyStatusChange,
    onPaymentStatusChange,
    onFulfillmentStatusChange,
    onCancel,
    onRefund,
    onDelete,
    disabled = false,
  }) => {
    const normalizedOrderStatus = normalizeOrderStatusForUI(order.orderStatus)
    const isCancelled = normalizedOrderStatus === ORDER_STATUSES.CANCELLED
    const isRefunded = normalizedOrderStatus === ORDER_STATUSES.REFUNDED
    const isFinalState = isCancelled || isRefunded
    const isPaymentApproved = order.paymentStatus === PAYMENT_STATUSES.APPROVED
    const allowedPaymentStatuses = PAYMENT_TRANSITIONS[order.paymentStatus] || [order.paymentStatus]
    const allowedFulfillmentStatuses = FULFILLMENT_TRANSITIONS[order.fulfillmentStatus] || [
      order.fulfillmentStatus,
    ]
    const orderTotal = normalizeValue(order.totals?.total)

    return (
      <Box
        sx={{
          mt: 2,
          p: 3,
          borderRadius: 3,
          border: `1px solid ${BRAND.line}`,
          bgcolor: 'white',
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{
            color: BRAND.ink,
            fontWeight: 700,
            fontSize: '0.9rem',
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            textTransform: 'uppercase',
          }}
        >
          <Info fontSize="small" />
          Panel de Control
        </Typography>

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Estado comercial
          </Typography>
          <StatusBadge status={normalizedOrderStatus} size="medium" />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            Se calcula automáticamente según el pago y la logística.
          </Typography>
        </Box>

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id={`pago-label-${order._id}`}>Estado del Pago</InputLabel>
          <Select
            labelId={`pago-label-${order._id}`}
            value={order.paymentStatus || PAYMENT_STATUSES.PENDING}
            label="Estado del Pago"
            onChange={e => onPaymentStatusChange(order._id, e.target.value, orderTotal)}
            disabled={isFinalState || disabled || allowedPaymentStatuses.length === 1}
          >
            {allowedPaymentStatuses.includes('pending') && (
              <MenuItem value="pending">Pendiente</MenuItem>
            )}
            {allowedPaymentStatuses.includes('approved') && (
              <MenuItem value="approved" sx={{ color: '#047857' }}>
                Aprobado
              </MenuItem>
            )}
            {allowedPaymentStatuses.includes('rejected') && (
              <MenuItem value="rejected" sx={{ color: '#b42318' }}>
                Rechazado
              </MenuItem>
            )}
            {allowedPaymentStatuses.includes('cancelled') && (
              <MenuItem value="cancelled" sx={{ color: '#b42318' }}>
                Cancelado
              </MenuItem>
            )}
            {allowedPaymentStatuses.includes('refunded') && (
              <MenuItem value="refunded" sx={{ color: '#7a2cff' }}>
                Reembolsado
              </MenuItem>
            )}
          </Select>
        </FormControl>

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id={`logistica-label-${order._id}`}>Estado Logístico</InputLabel>
          <Select
            labelId={`logistica-label-${order._id}`}
            value={order.fulfillmentStatus || FULFILLMENT_STATUSES.UNFULFILLED}
            label="Estado Logístico"
            onChange={e => onFulfillmentStatusChange(order._id, e.target.value)}
            disabled={isFinalState || disabled || !isPaymentApproved}
          >
            {allowedFulfillmentStatuses.includes('unfulfilled') && (
              <MenuItem value="unfulfilled">Sin preparar</MenuItem>
            )}
            {allowedFulfillmentStatuses.includes('preparing') && (
              <MenuItem value="preparing">Preparando</MenuItem>
            )}
            {allowedFulfillmentStatuses.includes('ready_to_ship') && (
              <MenuItem value="ready_to_ship">Lista para envío</MenuItem>
            )}
            {allowedFulfillmentStatuses.includes('shipped') && (
              <MenuItem value="shipped">En tránsito</MenuItem>
            )}
            {allowedFulfillmentStatuses.includes('delivered') && (
              <MenuItem value="delivered">Entregada</MenuItem>
            )}
            {allowedFulfillmentStatuses.includes('returned') && (
              <MenuItem value="returned">Devuelta</MenuItem>
            )}
          </Select>
        </FormControl>

        {!isPaymentApproved && !isFinalState && (
          <Alert severity="info" sx={{ mb: 2 }}>
            La logística se habilita cuando el pago está aprobado.
          </Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }} useFlexGap>
          <Button
            variant="outlined"
            color="error"
            onClick={() => onCancel(order._id, orderTotal)}
            disabled={isFinalState || disabled || order.paymentStatus === PAYMENT_STATUSES.APPROVED}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Cancelar
          </Button>

          <Button
            variant="outlined"
            color="secondary"
            onClick={() => onRefund(order._id, orderTotal)}
            disabled={order.paymentStatus !== PAYMENT_STATUSES.APPROVED || isRefunded || disabled}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Reembolsar
          </Button>

          <Button
            variant="contained"
            color="error"
            startIcon={<DeleteForever />}
            onClick={() => onDelete(order)}
            disabled={disabled}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Eliminar
          </Button>
        </Stack>
      </Box>
    )
  },
)

OrderControlPanel.displayName = 'OrderControlPanel'

// ==========================================
// ROW
// ==========================================

const OrderRow = memo(
  ({
    order,
    expanded,
    onToggle,
    onLegacyStatusChange,
    onPaymentStatusChange,
    onFulfillmentStatusChange,
    onSaveShipment,
    onCancel,
    onRefund,
    onDelete,
    onViewDetail,
    disabled = false,
  }) => {
    const handleToggle = useCallback(
      e => {
        e.stopPropagation()
        onToggle(order._id)
      },
      [onToggle, order._id],
    )

    const customerName = getOrderCustomerName(order)
    const customerEmail = getOrderCustomerEmail(order)

    return (
      <>
        <TableRow
          hover
          onClick={handleToggle}
          sx={{
            cursor: 'pointer',
            bgcolor: expanded ? '#f4f8ff' : 'inherit',
            '& > td': { borderBottom: expanded ? 'none' : undefined },
          }}
        >
          <TableCell padding="checkbox">
            <IconButton
              size="small"
              onClick={handleToggle}
              disabled={disabled}
              aria-expanded={expanded}
              aria-label={expanded ? 'Ocultar el detalle del pedido' : 'Ver el detalle del pedido'}
            >
              {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </IconButton>
          </TableCell>

          <TableCell>
            <Typography variant="body2" sx={{ fontWeight: 600, color: BRAND.blue }}>
              #{getOrderDisplayId(order)}
            </Typography>
            <Typography variant="caption" sx={{ color: BRAND.muted }}>
              {formatDateShort(order.createdAt)}
            </Typography>
          </TableCell>

          <TableCell>
            <Typography variant="body2" noWrap sx={{ maxWidth: 260 }}>
              {customerEmail}
            </Typography>

            {customerName && (
              <Typography variant="caption" sx={{ color: BRAND.muted }}>
                {customerName}
              </Typography>
            )}
          </TableCell>

          <TableCell align="right">
            <Typography variant="body2" sx={{ fontWeight: 700, color: BRAND.ink }}>
              {formatCurrency(order.totals?.total)}
            </Typography>
            <Typography variant="caption" sx={{ color: BRAND.muted }}>
              {order.products?.length || 0} items
            </Typography>
          </TableCell>

          <TableCell align="center">
            <StatusBadge status={order.orderStatus} />
          </TableCell>

          <TableCell align="center">
            <PaymentBadge paymentStatus={order.paymentStatus} />
          </TableCell>

          <TableCell align="center">
            <FulfillmentBadge fulfillmentStatus={order.fulfillmentStatus} />
          </TableCell>

          <TableCell align="right">
            <Tooltip title="Ver detalle">
              <span>
                <IconButton
                  size="small"
                  disabled={disabled}
                  aria-label="Ver detalle"
                  onClick={e => {
                    e.stopPropagation()
                    onViewDetail(order)
                  }}
                >
                  <Visibility fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Eliminar orden">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  disabled={disabled}
                  aria-label="Eliminar orden"
                  onClick={e => {
                    e.stopPropagation()
                    onDelete(order)
                  }}
                >
                  <DeleteForever fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </TableCell>
        </TableRow>

        {expanded && (
          <TableRow>
            <TableCell colSpan={8} sx={{ p: 0, bgcolor: '#fbfcff' }}>
              <Box sx={{ p: 3 }}>
                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, lg: 8 }}>
                    <Typography
                      variant="h6"
                      sx={{
                        color: BRAND.ink,
                        fontWeight: 700,
                        fontSize: '1rem',
                        mb: 2,
                      }}
                    >
                      Productos ({order.products?.length || 0})
                    </Typography>

                    {order.products?.map((item, idx) => (
                      <ProductItem key={`${order._id}-${idx}`} item={item} />
                    ))}
                  </Grid>

                  <Grid size={{ xs: 12, lg: 4 }}>
                    <ShippingCard address={order.shippingAddress} />

                    <ShipmentCard
                      order={order}
                      onSaveShipment={onSaveShipment}
                      disabled={disabled}
                    />

                    <OrderSummary
                      totals={order.totals}
                      paymentStatus={order.paymentStatus}
                      fulfillmentStatus={order.fulfillmentStatus}
                    />

                    <OrderControlPanel
                      order={order}
                      onLegacyStatusChange={onLegacyStatusChange}
                      onPaymentStatusChange={onPaymentStatusChange}
                      onFulfillmentStatusChange={onFulfillmentStatusChange}
                      onCancel={onCancel}
                      onRefund={onRefund}
                      onDelete={onDelete}
                      disabled={disabled}
                    />
                  </Grid>
                </Grid>
              </Box>
            </TableCell>
          </TableRow>
        )}
      </>
    )
  },
)

OrderRow.displayName = 'OrderRow'

// ==========================================
// DIALOGS
// ==========================================

const ConfirmDialog = memo(
  ({
    open,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    confirmColor = 'primary',
    orderTotal = 0,
    loading = false,
  }) => {
    const isHighValue = orderTotal > CONFIG.HIGH_VALUE_THRESHOLD

    return (
      <Dialog
        open={open}
        onClose={loading ? undefined : onClose}
        maxWidth="sm"
        fullWidth
        TransitionComponent={Fade}
        disableRestoreFocus
        aria-labelledby="admin-order-confirm-title"
        aria-describedby="admin-order-confirm-description"
      >
        <DialogTitle
          id="admin-order-confirm-title"
          sx={{
            fontFamily: DISPLAY_FONT,
            color: BRAND.ink,
            fontSize: '1.15rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {isHighValue && <Warning sx={{ mr: 1, color: '#f59e0b' }} />}
          {title}
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          {isHighValue && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Orden de alto valor: <strong>{formatCurrency(orderTotal)}</strong>
            </Alert>
          )}

          <Typography id="admin-order-confirm-description">{message}</Typography>
        </DialogContent>

        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button
            onClick={onClose}
            variant="outlined"
            disabled={loading}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>

          <Button
            variant="contained"
            onClick={onConfirm}
            color={confirmColor}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {loading ? 'Procesando...' : confirmText}
          </Button>
        </DialogActions>
      </Dialog>
    )
  },
)

ConfirmDialog.displayName = 'ConfirmDialog'

const OrderDetailDialog = memo(
  ({
    open,
    onClose,
    order,
    onLegacyStatusChange,
    onPaymentStatusChange,
    onFulfillmentStatusChange,
    onSaveShipment,
    onCancel,
    onRefund,
    onDelete,
    disabled = false,
  }) => {
    // En un celular la ventana ocupa toda la pantalla: en una chica los tres paneles no entraban.
    const isNarrow = useMediaQuery('(max-width:600px)')

    if (!order) return null

    const customerName = getOrderCustomerName(order)
    const customerEmail = getOrderCustomerEmail(order)
    const customerPhone = getOrderCustomerPhone(order)

    return (
      <Dialog
        open={open}
        onClose={disabled ? undefined : onClose}
        maxWidth="lg"
        fullWidth
        fullScreen={isNarrow}
        scroll="paper"
        disableRestoreFocus
        aria-labelledby="admin-order-detail-title"
      >
        <DialogTitle
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em', lineHeight: 1.4 }}
            >
              PEDIDO
            </Typography>
            <Typography
              id="admin-order-detail-title"
              component="h2"
              sx={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 800,
                fontSize: '1.35rem',
                letterSpacing: '-0.01em',
                color: BRAND.ink,
              }}
            >
              Pedido #{getOrderDisplayId(order)}
            </Typography>
          </Box>

          <IconButton onClick={onClose} disabled={disabled} aria-label="Cerrar el detalle">
            <Close />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ bgcolor: BRAND.paper, p: 0, borderColor: BRAND.line }}>
          <Box sx={{ p: 3 }}>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 8 }}>
                <Paper variant="outlined" sx={{ ...PANEL_SX, p: 3 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem', mb: 2 }}>
                    Productos ({order.products?.length || 0})
                  </Typography>

                  {order.products?.map((item, idx) => (
                    <ProductItem key={`detail-${order._id}-${idx}`} item={item} />
                  ))}
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" sx={{ ...PANEL_SX, p: 3, mb: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem', mb: 2 }}>
                    Cliente
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Email
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {customerEmail}
                    </Typography>
                  </Box>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      Nombre
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {customerName || '-'}
                    </Typography>
                  </Box>

                  {customerPhone && (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        Teléfono
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {customerPhone}
                      </Typography>
                    </Box>
                  )}
                </Paper>

                <ShippingCard address={order.shippingAddress} />

                <ShipmentCard order={order} onSaveShipment={onSaveShipment} disabled={disabled} />

                <OrderSummary
                  totals={order.totals}
                  paymentStatus={order.paymentStatus}
                  fulfillmentStatus={order.fulfillmentStatus}
                />

                <OrderControlPanel
                  order={order}
                  onLegacyStatusChange={onLegacyStatusChange}
                  onPaymentStatusChange={onPaymentStatusChange}
                  onFulfillmentStatusChange={onFulfillmentStatusChange}
                  onCancel={onCancel}
                  onRefund={onRefund}
                  onDelete={onDelete}
                  disabled={disabled}
                />
              </Grid>
            </Grid>
          </Box>
        </DialogContent>
      </Dialog>
    )
  },
)

OrderDetailDialog.displayName = 'OrderDetailDialog'

const HEAD_CELL_SX = {
  fontWeight: 700,
  color: BRAND.muted,
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  bgcolor: BRAND.paper,
  borderColor: BRAND.line,
}

// Cada cifra del resumen es también un filtro rápido: se toca para ver solo esos pedidos.
const SummaryTile = ({
  title,
  value,
  color,
  onClick,
  active = false,
  compact = false,
  span = { xs: 'span 2', md: 'span 1' },
}) => {
  const content = (
    <>
      <Typography
        variant="caption"
        sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.04em' }}
      >
        {title}
      </Typography>
      <Typography
        component="div"
        sx={{
          fontFamily: DISPLAY_FONT,
          fontWeight: 800,
          fontSize: compact ? { xs: 16, md: 24 } : 28,
          lineHeight: 1.2,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
    </>
  )

  const sx = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 0.25,
    width: '100%',
    height: '100%',
    p: 2,
    textAlign: 'left',
    gridColumn: span,
    borderBottom: active ? `3px solid ${color}` : '3px solid transparent',
    bgcolor: active ? BRAND.paper : 'transparent',
  }

  if (!onClick) {
    return <Box sx={sx}>{content}</Box>
  }

  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={active}
      sx={{ ...sx, '&:hover': { bgcolor: BRAND.paper } }}
    >
      {content}
    </ButtonBase>
  )
}

const OrderCard = memo(({ order, onViewDetail, onDelete, disabled = false }) => {
  const customerName = getOrderCustomerName(order)

  return (
    <Paper component="article" variant="outlined" sx={{ ...PANEL_SX, p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, color: BRAND.blue }}>
            #{getOrderDisplayId(order)}
          </Typography>
          <Typography variant="caption" sx={{ color: BRAND.muted }}>
            {formatDateShort(order.createdAt)} · {order.products?.length || 0} items
          </Typography>
        </Box>

        <Typography
          sx={{
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            color: BRAND.ink,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}
        >
          {formatCurrency(order.totals?.total)}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ mt: 1.5, overflowWrap: 'anywhere' }}>
        {getOrderCustomerEmail(order)}
      </Typography>
      {customerName && (
        <Typography variant="caption" sx={{ color: BRAND.muted }}>
          {customerName}
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
        <StatusBadge status={order.orderStatus} />
        <PaymentBadge paymentStatus={order.paymentStatus} />
        <FulfillmentBadge fulfillmentStatus={order.fulfillmentStatus} />
      </Stack>

      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Button
          variant="outlined"
          startIcon={<Visibility />}
          disabled={disabled}
          onClick={() => onViewDetail(order)}
          sx={{ flex: 1, textTransform: 'none', fontWeight: 700, borderRadius: 3 }}
        >
          Ver detalle
        </Button>

        <IconButton
          color="error"
          disabled={disabled}
          aria-label="Eliminar orden"
          onClick={() => onDelete(order)}
        >
          <DeleteForever />
        </IconButton>
      </Box>
    </Paper>
  )
})

OrderCard.displayName = 'OrderCard'

// ==========================================
// MAIN
// ==========================================

const AdminOrdersPage = () => {
  const dispatch = useDispatch()

  const orderState = useSelector(state => state?.order) || {}
  const { list, isLoading, isError, message, isUpdating } = orderState

  const responseData = list?.data || {}
  const orders = Array.isArray(responseData?.data) ? responseData.data : []

  const pagination = responseData?.pagination || {
    total: 0,
    page: 1,
    pages: 1,
    limit: CONFIG.DEFAULT_PAGE_SIZE,
  }

  // El resumen lo calcula el backend sobre TODO lo filtrado. Acá se sumaban las
  // órdenes cargadas —diez— y el resultado se mostraba al lado del total real:
  // "250 pedidos • $12.340 en ventas", con los $12.340 correspondiendo solo a
  // la página que estabas mirando. Y cambiaban al pasar de página.
  const summary = responseData?.summary || null

  // En un celular la tabla obligaba a deslizar de costado: ahí cada pedido es una tarjeta.
  const isNarrow = useMediaQuery('(max-width:600px)')

  const [expandedOrder, setExpandedOrder] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  const [filters, setFilters] = useState({
    page: 1,
    limit: CONFIG.DEFAULT_PAGE_SIZE,
    status: '',
    paymentStatus: '',
    fulfillmentStatus: '',
    q: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
  })

  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(EMPTY_CONFIRM_DIALOG)

  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success',
  })

  const currentApiFilters = useMemo(() => buildApiFilters(filters), [filters])

  const loadOrders = useCallback(() => {
    dispatch(getOrdersThunk(currentApiFilters))
  }, [dispatch, currentApiFilters])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  useEffect(() => {
    if (!selectedOrder?._id) return

    const freshOrder = orders.find(order => order._id === selectedOrder._id)

    if (freshOrder) {
      setSelectedOrder(freshOrder)
    }
  }, [orders, selectedOrder?._id])

  const debouncedSearch = useMemo(
    () =>
      debounce(value => {
        setFilters(prev => ({
          ...prev,
          q: normalizeString(value).slice(0, CONFIG.MAX_SEARCH_LENGTH),
          page: 1,
        }))
      }, CONFIG.DEBOUNCE_MS),
    [],
  )

  useEffect(() => {
    return () => debouncedSearch.cancel()
  }, [debouncedSearch])

  const showSnackbar = useCallback((nextMessage, severity = 'success') => {
    setSnackbar({
      open: true,
      message: nextMessage,
      severity,
    })
  }, [])

  const handleSearchChange = useCallback(
    event => {
      const value = event.target.value
      setSearchTerm(value)
      debouncedSearch(value)
    },
    [debouncedSearch],
  )

  const handleResetSearch = useCallback(() => {
    debouncedSearch.cancel()
    setSearchTerm('')
    setFilters(prev => ({ ...prev, q: '', page: 1 }))
  }, [debouncedSearch])

  const handleClearFilters = useCallback(() => {
    debouncedSearch.cancel()
    setSearchTerm('')
    setFilters(prev => ({
      ...prev,
      status: '',
      paymentStatus: '',
      fulfillmentStatus: '',
      q: '',
      page: 1,
    }))
  }, [debouncedSearch])

  const handleFilterChange = useCallback((field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
      page: 1,
    }))
  }, [])

  const handleLegacyStatusChange = useCallback(
    (orderId, newStatus) => {
      if (isUpdating) return

      const legacyStatus = normalizeOrderStatusForLegacyApi(newStatus)

      if (legacyStatus === ORDER_STATUSES.CANCELLED || legacyStatus === ORDER_STATUSES.REFUNDED) {
        const order = orders.find(item => item._id === orderId)

        setConfirmDialog({
          ...EMPTY_CONFIRM_DIALOG,
          open: true,
          orderId,
          action: legacyStatus,
          payload: { id: orderId, orderStatus: legacyStatus },
          orderTotal: normalizeValue(order?.totals?.total),
          orderNumber: getOrderDisplayId(order),
        })

        return
      }

      dispatch(updateOrderStatusThunk({ id: orderId, orderStatus: legacyStatus }))
        .unwrap()
        .then(() => {
          showSnackbar('Estado comercial actualizado correctamente', 'success')
          loadOrders()
        })
        .catch(error => {
          showSnackbar(getErrorMessage(error, 'Error actualizando estado'), 'error')
        })
    },
    [dispatch, isUpdating, loadOrders, orders, showSnackbar],
  )

  const handlePaymentStatusChange = useCallback(
    (orderId, paymentStatus, orderTotal = 0) => {
      if (isUpdating) return

      if (paymentStatus === PAYMENT_STATUSES.APPROVED && orderTotal > CONFIG.HIGH_VALUE_THRESHOLD) {
        setConfirmDialog({
          ...EMPTY_CONFIRM_DIALOG,
          open: true,
          orderId,
          action: CONFIRM_ACTIONS.APPROVE_PAYMENT,
          payload: { id: orderId, paymentStatus },
          orderTotal,
        })

        return
      }

      dispatch(updateOrderPaymentStatusThunk({ id: orderId, paymentStatus }))
        .unwrap()
        .then(() => {
          showSnackbar('Estado de pago actualizado correctamente', 'success')
          loadOrders()
        })
        .catch(error => {
          showSnackbar(getErrorMessage(error, 'Error actualizando pago'), 'error')
        })
    },
    [dispatch, isUpdating, loadOrders, showSnackbar],
  )

  const handleFulfillmentStatusChange = useCallback(
    (orderId, fulfillmentStatus) => {
      if (isUpdating) return

      dispatch(updateOrderFulfillmentStatusThunk({ id: orderId, fulfillmentStatus }))
        .unwrap()
        .then(() => {
          showSnackbar('Estado logístico actualizado correctamente', 'success')
          loadOrders()
        })
        .catch(error => {
          showSnackbar(getErrorMessage(error, 'Error actualizando logística'), 'error')
        })
    },
    [dispatch, isUpdating, loadOrders, showSnackbar],
  )

  const handleSaveShipment = useCallback(
    (orderId, { trackingNumber, carrier }) => {
      return dispatch(updateOrderShipmentThunk({ id: orderId, trackingNumber, carrier }))
        .unwrap()
        .then(() => {
          showSnackbar('Datos de envío actualizados correctamente', 'success')
          loadOrders()
        })
        .catch(error => {
          showSnackbar(getErrorMessage(error, 'Error actualizando datos de envío'), 'error')
        })
    },
    [dispatch, loadOrders, showSnackbar],
  )

  const handleCancel = useCallback(
    (orderId, orderTotal = 0) => {
      if (isUpdating) return

      setConfirmDialog({
        ...EMPTY_CONFIRM_DIALOG,
        open: true,
        orderId,
        action: CONFIRM_ACTIONS.CANCEL_ORDER,
        payload: {
          id: orderId,
          reason: 'Cancelación manual desde admin',
        },
        orderTotal,
      })
    },
    [isUpdating],
  )

  const handleRefund = useCallback(
    (orderId, orderTotal = 0) => {
      if (isUpdating) return

      setConfirmDialog({
        ...EMPTY_CONFIRM_DIALOG,
        open: true,
        orderId,
        action: CONFIRM_ACTIONS.REFUND_ORDER,
        payload: { id: orderId },
        orderTotal,
      })
    },
    [isUpdating],
  )

  const handleDelete = useCallback(
    order => {
      if (isUpdating) return

      if (!order?._id) {
        showSnackbar('No se pudo identificar la orden a eliminar', 'error')
        return
      }

      setConfirmDialog({
        ...EMPTY_CONFIRM_DIALOG,
        open: true,
        orderId: order._id,
        action: CONFIRM_ACTIONS.DELETE_ORDER,
        payload: {
          id: order._id,
          force: false,
          reason: 'Eliminación manual desde panel admin',
        },
        orderTotal: normalizeValue(order?.totals?.total),
        orderNumber: getOrderDisplayId(order),
        protectedOrder: isOrderProtectedFromDelete(order),
      })
    },
    [isUpdating, showSnackbar],
  )

  const closeConfirmDialog = useCallback(() => {
    if (isUpdating) return
    setConfirmDialog(EMPTY_CONFIRM_DIALOG)
  }, [isUpdating])

  const handleAfterDeleteSuccess = useCallback(() => {
    setExpandedOrder(null)

    if (selectedOrder?._id === confirmDialog.orderId) {
      setDetailDialogOpen(false)
      setSelectedOrder(null)
    }
  }, [confirmDialog.orderId, selectedOrder?._id])

  const handleForceDeleteRequired = useCallback(() => {
    setConfirmDialog(prev => ({
      ...prev,
      open: true,
      action: CONFIRM_ACTIONS.FORCE_DELETE_ORDER,
      payload: {
        id: prev.orderId,
        force: true,
        reason: 'Eliminación forzada confirmada desde panel admin',
      },
      protectedOrder: true,
    }))

    showSnackbar(
      'La orden está protegida. Confirmá nuevamente para eliminarla de forma forzada.',
      'warning',
    )
  }, [showSnackbar])

  const confirmAction = useCallback(() => {
    const { action, payload } = confirmDialog

    if (!action || isUpdating) return

    let promise = null
    let successMessage = 'Operación realizada correctamente'

    if (action === CONFIRM_ACTIONS.APPROVE_PAYMENT) {
      promise = dispatch(updateOrderPaymentStatusThunk(payload))
      successMessage = 'Pago aprobado correctamente'
    } else if (action === CONFIRM_ACTIONS.CANCEL_ORDER) {
      promise = dispatch(cancelOrderThunk(payload))
      successMessage = 'Orden cancelada correctamente'
    } else if (action === CONFIRM_ACTIONS.REFUND_ORDER || action === CONFIRM_ACTIONS.REFUNDED) {
      promise = dispatch(refundOrderThunk({ id: payload?.id || confirmDialog.orderId }))
      successMessage =
        'Orden marcada como reembolsada — verificá que el reembolso se haya procesado en Mercado Pago'
    } else if (action === CONFIRM_ACTIONS.CANCELLED) {
      promise = dispatch(
        cancelOrderThunk({
          id: confirmDialog.orderId,
          reason: 'Cancelación manual desde admin',
        }),
      )
      successMessage = 'Orden cancelada correctamente'
    } else if (action === CONFIRM_ACTIONS.DELETE_ORDER) {
      promise = dispatch(deleteOrderThunk(payload))
      successMessage = 'Orden eliminada correctamente'
    } else if (action === CONFIRM_ACTIONS.FORCE_DELETE_ORDER) {
      promise = dispatch(deleteOrderThunk(payload))
      successMessage = 'Orden eliminada forzadamente'
    }

    if (!promise) return

    promise
      .unwrap()
      .then(() => {
        showSnackbar(successMessage, 'success')

        if (
          action === CONFIRM_ACTIONS.DELETE_ORDER ||
          action === CONFIRM_ACTIONS.FORCE_DELETE_ORDER
        ) {
          handleAfterDeleteSuccess()
        }

        setConfirmDialog(EMPTY_CONFIRM_DIALOG)
        loadOrders()
      })
      .catch(error => {
        const isForceDeleteRequired =
          action === CONFIRM_ACTIONS.DELETE_ORDER &&
          getErrorStatus(error) === 409 &&
          getErrorCode(error) === API_ERROR_CODES.FORCE_DELETE_REQUIRED

        if (isForceDeleteRequired) {
          handleForceDeleteRequired()
          return
        }

        showSnackbar(getErrorMessage(error, 'Error en la operación'), 'error')
      })
  }, [
    confirmDialog,
    dispatch,
    handleAfterDeleteSuccess,
    handleForceDeleteRequired,
    isUpdating,
    loadOrders,
    showSnackbar,
  ])

  const handleExpandOrder = useCallback(
    orderId => {
      if (isUpdating) return
      setExpandedOrder(prev => (prev === orderId ? null : orderId))
    },
    [isUpdating],
  )

  const handleViewDetail = useCallback(
    order => {
      if (isUpdating) return
      setSelectedOrder(order)
      setDetailDialogOpen(true)
    },
    [isUpdating],
  )

  const handleCloseDetailDialog = useCallback(() => {
    if (isUpdating) return
    setDetailDialogOpen(false)
    setSelectedOrder(null)
  }, [isUpdating])

  const handleCloseSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }))
  }, [])

  const handleExport = useCallback(() => {
    if (!orders.length) {
      showSnackbar('No hay órdenes para exportar', 'info')
      return
    }

    const csv = buildOrdersCsv(orders)

    downloadTextFile({
      filename: `${CONFIG.EXPORT_FILENAME_PREFIX}-${formatDateFile()}.csv`,
      content: csv,
    })

    showSnackbar('Exportación generada correctamente', 'success')
  }, [orders, showSnackbar])

  const stats = useMemo(() => {
    const total = pagination.total

    // El backend agrupa por estado CRUDO y la traducción a los tres estados que
    // muestra esta pantalla vive acá, que es donde está definida.
    const countByUiStatus = uiStatus => {
      if (summary?.byStatus) {
        return Object.entries(summary.byStatus).reduce(
          (sum, [rawStatus, count]) =>
            normalizeOrderStatusForUI(rawStatus) === uiStatus ? sum + count : sum,
          0,
        )
      }

      return orders.filter(order => normalizeOrderStatusForUI(order.orderStatus) === uiStatus)
        .length
    }

    const totalRevenue = summary
      ? normalizeValue(summary.total)
      : orders.reduce((sum, order) => sum + normalizeValue(order.totals?.total), 0)

    return {
      total,
      open: countByUiStatus(ORDER_STATUSES.OPEN),
      processing: countByUiStatus(ORDER_STATUSES.PROCESSING),
      delivered: countByUiStatus(ORDER_STATUSES.DELIVERED),
      totalRevenue,
    }
  }, [orders, pagination.total, summary])

  const confirmDialogTitle = useMemo(() => {
    if (
      confirmDialog.action === CONFIRM_ACTIONS.CANCEL_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.CANCELLED
    ) {
      return 'Confirmar Cancelación'
    }

    if (
      confirmDialog.action === CONFIRM_ACTIONS.REFUND_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.REFUNDED
    ) {
      return 'Confirmar Reembolso'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.APPROVE_PAYMENT) {
      return 'Confirmar Aprobación de Pago'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.DELETE_ORDER) {
      return 'Confirmar Eliminación'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.FORCE_DELETE_ORDER) {
      return 'Confirmar Eliminación Forzada'
    }

    return 'Confirmar Acción'
  }, [confirmDialog.action])

  const confirmDialogMessage = useMemo(() => {
    if (
      confirmDialog.action === CONFIRM_ACTIONS.CANCEL_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.CANCELLED
    ) {
      return '¿Deseas cancelar esta orden? Restaura el stock reservado. Si el pago ya estaba aprobado, esta acción NO devuelve el dinero — para eso usá "Reembolsar".'
    }

    if (
      confirmDialog.action === CONFIRM_ACTIONS.REFUND_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.REFUNDED
    ) {
      return '¿Deseas marcar esta orden como reembolsada? Esto solo actualiza el registro interno — el reembolso real en Mercado Pago hay que hacerlo aparte, desde su panel.'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.APPROVE_PAYMENT) {
      return `¿Confirmas que recibiste el pago de ${formatCurrency(confirmDialog.orderTotal)}?`
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.DELETE_ORDER) {
      if (confirmDialog.protectedOrder) {
        return `La orden #${confirmDialog.orderNumber} tiene estado sensible: pago aprobado, entrega o reembolso. En producción se recomienda conservarla por auditoría fiscal y trazabilidad. Si continuás, el backend puede solicitar una segunda confirmación forzada.`
      }

      return `¿Deseas eliminar la orden #${confirmDialog.orderNumber}? En producción esto debe ejecutarse como eliminación lógica para preservar auditoría.`
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.FORCE_DELETE_ORDER) {
      return `Última confirmación: la orden #${confirmDialog.orderNumber} está protegida por tener pago aprobado, entrega o reembolso. Si continuás, será eliminada lógicamente del panel admin y quedará registrada en auditoría.`
    }

    return '¿Confirmas esta acción?'
  }, [confirmDialog])

  const confirmDialogText = useMemo(() => {
    if (
      confirmDialog.action === CONFIRM_ACTIONS.CANCEL_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.CANCELLED
    ) {
      return 'Sí, cancelar'
    }

    if (
      confirmDialog.action === CONFIRM_ACTIONS.REFUND_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.REFUNDED
    ) {
      return 'Sí, reembolsar'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.APPROVE_PAYMENT) {
      return 'Sí, aprobar'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.DELETE_ORDER) {
      return 'Sí, eliminar'
    }

    if (confirmDialog.action === CONFIRM_ACTIONS.FORCE_DELETE_ORDER) {
      return 'Sí, eliminar forzadamente'
    }

    return 'Confirmar'
  }, [confirmDialog.action])

  const confirmDialogColor = useMemo(() => {
    if (
      confirmDialog.action === CONFIRM_ACTIONS.CANCEL_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.CANCELLED ||
      confirmDialog.action === CONFIRM_ACTIONS.DELETE_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.FORCE_DELETE_ORDER
    ) {
      return 'error'
    }

    if (
      confirmDialog.action === CONFIRM_ACTIONS.REFUND_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.REFUNDED
    ) {
      return 'secondary'
    }

    return 'primary'
  }, [confirmDialog.action])

  const hayFiltros = Boolean(
    filters.status || filters.paymentStatus || filters.fulfillmentStatus || filters.q || searchTerm,
  )

  const toggleStatusFilter = status =>
    handleFilterChange('status', filters.status === status ? '' : status)

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BRAND.paper }}>
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
              VENTAS
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
              Pedidos
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {stats.total} {stats.total === 1 ? 'pedido' : 'pedidos'}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5}>
            <Button
              variant="outlined"
              startIcon={<Download />}
              onClick={handleExport}
              disabled={isLoading || isUpdating || orders.length === 0}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 3,
                flex: { xs: 1, sm: 'none' },
              }}
            >
              Exportar
            </Button>

            <Button
              variant="contained"
              startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Refresh />}
              onClick={loadOrders}
              disabled={isLoading || isUpdating}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 3,
                px: 3,
                background: GRADIENT,
                flex: { xs: 1, sm: 'none' },
              }}
            >
              {isLoading ? 'Cargando...' : 'Actualizar'}
            </Button>
          </Stack>
        </Box>

        <Paper
          component="section"
          aria-label="Resumen de pedidos"
          variant="outlined"
          sx={{ ...PANEL_SX, mb: 3, overflow: 'hidden' }}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(6, 1fr)', md: 'repeat(5, 1fr)' },
            }}
          >
            <SummaryTile
              title="Pedidos"
              value={stats.total}
              color={BRAND.blue}
              onClick={handleClearFilters}
              active={!hayFiltros}
              span={{ xs: 'span 3', md: 'span 1' }}
            />
            <SummaryTile
              title="Ventas"
              value={formatCurrency(stats.totalRevenue)}
              color={BRAND.ink}
              compact
              span={{ xs: 'span 3', md: 'span 1' }}
            />
            <SummaryTile
              title="Abiertas"
              value={stats.open}
              color={STATUS_BADGE_CONFIGS.open.color}
              onClick={() => toggleStatusFilter('open')}
              active={filters.status === 'open'}
            />
            <SummaryTile
              title="Procesando"
              value={stats.processing}
              color={STATUS_BADGE_CONFIGS.processing.color}
              onClick={() => toggleStatusFilter('processing')}
              active={filters.status === 'processing'}
            />
            <SummaryTile
              title="Entregadas"
              value={stats.delivered}
              color={STATUS_BADGE_CONFIGS.delivered.color}
              onClick={() => toggleStatusFilter('delivered')}
              active={filters.status === 'delivered'}
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
              placeholder="Buscar por ID, email, nombre..."
              value={searchTerm}
              onChange={handleSearchChange}
              disabled={isUpdating}
              sx={{ maxWidth: { md: 420 } }}
              slotProps={{
                htmlInput: { maxLength: CONFIG.MAX_SEARCH_LENGTH, 'aria-label': 'Buscar pedidos' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: searchTerm && (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={handleResetSearch}
                        disabled={isUpdating}
                        aria-label="Borrar la búsqueda"
                      >
                        <Close fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="filtro-estado-orden-label">Estado orden</InputLabel>
              <Select
                labelId="filtro-estado-orden-label"
                value={filters.status}
                label="Estado orden"
                disabled={isUpdating}
                onChange={event => handleFilterChange('status', event.target.value)}
              >
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="open">Abierta</MenuItem>
                <MenuItem value="processing">Procesando</MenuItem>
                <MenuItem value="shipped">Enviada</MenuItem>
                <MenuItem value="delivered">Entregada</MenuItem>
                <MenuItem value="cancelled">Cancelada</MenuItem>
                <MenuItem value="refunded">Reembolsada</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="filtro-pago-label">Pago</InputLabel>
              <Select
                labelId="filtro-pago-label"
                value={filters.paymentStatus}
                label="Pago"
                disabled={isUpdating}
                onChange={event => handleFilterChange('paymentStatus', event.target.value)}
              >
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="pending">Pendiente</MenuItem>
                <MenuItem value="approved">Aprobado</MenuItem>
                <MenuItem value="rejected">Rechazado</MenuItem>
                <MenuItem value="cancelled">Cancelado</MenuItem>
                <MenuItem value="refunded">Reembolsado</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="filtro-logistica-label">Logística</InputLabel>
              <Select
                labelId="filtro-logistica-label"
                value={filters.fulfillmentStatus}
                label="Logística"
                disabled={isUpdating}
                onChange={event => handleFilterChange('fulfillmentStatus', event.target.value)}
              >
                <MenuItem value="">Todos</MenuItem>
                <MenuItem value="unfulfilled">Sin preparar</MenuItem>
                <MenuItem value="preparing">Preparando</MenuItem>
                <MenuItem value="ready_to_ship">Lista para envío</MenuItem>
                <MenuItem value="shipped">En tránsito</MenuItem>
                <MenuItem value="delivered">Entregada</MenuItem>
                <MenuItem value="returned">Devuelta</MenuItem>
              </Select>
            </FormControl>

            {hayFiltros && (
              <Button
                onClick={handleClearFilters}
                startIcon={<FilterAltOff />}
                disabled={isUpdating}
                sx={{ textTransform: 'none', fontWeight: 700, flexShrink: 0 }}
              >
                Limpiar filtros
              </Button>
            )}
          </Stack>
        </Paper>

        {isLoading && orders.length > 0 && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} />}

        {isError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {message || 'Error al cargar órdenes'}
          </Alert>
        )}

        {isLoading && orders.length === 0 ? (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: 4, textAlign: 'center' }}>
            <CircularProgress size={48} />
            <Typography sx={{ mt: 2 }}>Cargando pedidos...</Typography>
          </Paper>
        ) : orders.length === 0 ? (
          <Paper variant="outlined" sx={{ ...PANEL_SX, p: 6, textAlign: 'center' }}>
            <Inventory sx={{ fontSize: 56, color: BRAND.blue, opacity: 0.35, mb: 2 }} />
            <Typography
              component="h2"
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20, mb: 0.5 }}
            >
              No se encontraron pedidos
            </Typography>
            <Typography color="text.secondary">
              {hayFiltros
                ? 'Probá con otra búsqueda o limpiá los filtros.'
                : 'Cuando entre una compra en tu tienda, la vas a ver acá.'}
            </Typography>
          </Paper>
        ) : (
          <>
            {isNarrow ? (
              <Stack spacing={1.5}>
                {orders.map(order => (
                  <OrderCard
                    key={order._id}
                    order={order}
                    onViewDetail={handleViewDetail}
                    onDelete={handleDelete}
                    disabled={isUpdating}
                  />
                ))}
              </Stack>
            ) : (
              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ ...PANEL_SX, overflow: 'hidden' }}
              >
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" sx={HEAD_CELL_SX} />
                      <TableCell sx={HEAD_CELL_SX}>Pedido</TableCell>
                      <TableCell sx={HEAD_CELL_SX}>Cliente</TableCell>
                      <TableCell align="right" sx={HEAD_CELL_SX}>
                        Total
                      </TableCell>
                      <TableCell align="center" sx={HEAD_CELL_SX}>
                        Orden
                      </TableCell>
                      <TableCell align="center" sx={HEAD_CELL_SX}>
                        Pago
                      </TableCell>
                      <TableCell align="center" sx={HEAD_CELL_SX}>
                        Logística
                      </TableCell>
                      <TableCell align="right" sx={HEAD_CELL_SX} />
                    </TableRow>
                  </TableHead>

                  <TableBody>
                    {orders.map(order => (
                      <OrderRow
                        key={order._id}
                        order={order}
                        expanded={expandedOrder === order._id}
                        onToggle={handleExpandOrder}
                        onLegacyStatusChange={handleLegacyStatusChange}
                        onPaymentStatusChange={handlePaymentStatusChange}
                        onFulfillmentStatusChange={handleFulfillmentStatusChange}
                        onSaveShipment={handleSaveShipment}
                        onCancel={handleCancel}
                        onRefund={handleRefund}
                        onDelete={handleDelete}
                        onViewDetail={handleViewDetail}
                        disabled={isUpdating}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {pagination.pages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Pagination
                  count={pagination.pages}
                  page={pagination.page}
                  onChange={(event, value) => {
                    setFilters(prev => ({ ...prev, page: value }))
                  }}
                  size={isNarrow ? 'medium' : 'large'}
                  showFirstButton
                  showLastButton
                  disabled={isUpdating}
                  siblingCount={isNarrow ? 0 : 1}
                  getItemAriaLabel={(type, page, selected) => {
                    if (type === 'page') {
                      return selected ? `Página ${page}, actual` : `Ir a la página ${page}`
                    }

                    return {
                      first: 'Ir a la primera página',
                      last: 'Ir a la última página',
                      next: 'Ir a la página siguiente',
                      previous: 'Ir a la página anterior',
                    }[type]
                  }}
                />
              </Box>
            )}
          </>
        )}
      </Box>

      <ConfirmDialog
        open={confirmDialog.open}
        onClose={closeConfirmDialog}
        onConfirm={confirmAction}
        title={confirmDialogTitle}
        message={confirmDialogMessage}
        confirmText={confirmDialogText}
        confirmColor={confirmDialogColor}
        orderTotal={confirmDialog.orderTotal}
        loading={isUpdating}
      />

      <OrderDetailDialog
        open={detailDialogOpen}
        onClose={handleCloseDetailDialog}
        order={selectedOrder}
        onLegacyStatusChange={handleLegacyStatusChange}
        onPaymentStatusChange={handlePaymentStatusChange}
        onFulfillmentStatusChange={handleFulfillmentStatusChange}
        onSaveShipment={handleSaveShipment}
        onCancel={handleCancel}
        onRefund={handleRefund}
        onDelete={handleDelete}
        disabled={isUpdating}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} variant="filled">
          {snackbar.message}
        </Alert>
      </Snackbar>

      {isUpdating && (
        <Box
          role="status"
          sx={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            bgcolor: 'white',
            border: `1px solid ${BRAND.line}`,
            borderRadius: 3,
            px: 2,
            py: 1,
            boxShadow: 3,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            zIndex: 1400,
          }}
        >
          <CircularProgress size={16} />
          <Typography variant="body2">Actualizando orden...</Typography>
        </Box>
      )}
    </Box>
  )
}

export default AdminOrdersPage
