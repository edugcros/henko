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
} from '@mui/icons-material'
import {
  getOrdersThunk,
  updateOrderStatusThunk,
  updateOrderPaymentStatusThunk,
  updateOrderFulfillmentStatusThunk,
  cancelOrderThunk,
  refundOrderThunk,
  deleteOrderThunk,
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
  COLORS: {
    AMAZON_ORANGE: '#FF9900',
    AMAZON_DARK: '#131921',
    AMAZON_RED: '#B12704',
    AMAZON_GREEN: '#067D62',
    AMAZON_BLUE: '#007185',
    AMAZON_TEXT: '#0F1111',
    AMAZON_SECONDARY: '#565959',
  },
}

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

const STATUS_BADGE_CONFIGS = {
  open: {
    color: '#FF9900',
    bgColor: '#FFFAF0',
    borderColor: '#FFC107',
    label: 'Abierta',
  },
  processing: {
    color: '#007185',
    bgColor: '#F0F9FB',
    borderColor: '#007185',
    label: 'Procesando',
  },
  shipped: {
    color: '#007185',
    bgColor: '#F0F9FB',
    borderColor: '#007185',
    label: 'Enviada',
  },
  delivered: {
    color: '#067D62',
    bgColor: '#F0F9F4',
    borderColor: '#067D62',
    label: 'Entregada',
  },
  cancelled: {
    color: '#B12704',
    bgColor: '#FEF2F2',
    borderColor: '#B12704',
    label: 'Cancelada',
  },
  refunded: {
    color: '#6B21A8',
    bgColor: '#FAF5FF',
    borderColor: '#6B21A8',
    label: 'Reembolsada',
  },
}

const PAYMENT_BADGE_CONFIGS = {
  pending: { label: 'Pendiente', color: '#FF9900', bgColor: '#FFFAF0' },
  approved: { label: 'Aprobado', color: '#067D62', bgColor: '#F0F9F4' },
  rejected: { label: 'Rechazado', color: '#B12704', bgColor: '#FEF2F2' },
  cancelled: { label: 'Cancelado', color: '#B12704', bgColor: '#FEF2F2' },
  refunded: { label: 'Reembolsado', color: '#6B21A8', bgColor: '#FAF5FF' },
}

const FULFILLMENT_BADGE_CONFIGS = {
  unfulfilled: { label: 'Sin preparar', color: '#565959', bgColor: '#F7F7F7' },
  preparing: { label: 'Preparando', color: '#007185', bgColor: '#F0F9FB' },
  ready_to_ship: {
    label: 'Lista para envío',
    color: '#007185',
    bgColor: '#F0F9FB',
  },
  shipped: { label: 'En tránsito', color: '#007185', bgColor: '#F0F9FB' },
  delivered: { label: 'Entregada', color: '#067D62', bgColor: '#F0F9F4' },
  returned: { label: 'Devuelta', color: '#6B21A8', bgColor: '#FAF5FF' },
}

// ==========================================
// HELPERS
// ==========================================

const normalizeValue = value => {
  if (value === null || value === undefined) return 0
  if (typeof value === 'object' && value.$numberDecimal)
    return Number(value.$numberDecimal) || 0
  if (typeof value === 'object' && value.$numberInt)
    return Number(value.$numberInt) || 0
  if (typeof value === 'object' && value.$numberLong)
    return Number(value.$numberLong) || 0

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const resolveMoneyAmount = (decimalValue, centsValue) => {
  const decimal = normalizeValue(decimalValue)

  if (decimal > 0) return decimal

  const cents = normalizeValue(centsValue)
  if (cents > 0) return cents / 100

  return 0
}

const formatCurrency = amount => {
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

const formatDateShort = date => {
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

const normalizeOrderStatusForUI = status => {
  const normalized = normalizeString(status).toLowerCase()
  return LEGACY_TO_UI_ORDER_STATUS[normalized] || ORDER_STATUSES.OPEN
}

const normalizeOrderStatusForLegacyApi = status => {
  const normalized = normalizeString(status).toLowerCase()
  return UI_TO_LEGACY_ORDER_STATUS[normalized] || ORDER_STATUSES.OPEN
}

const buildApiFilters = filters => {
  const normalizedStatus = normalizeString(filters.status).toLowerCase()

  return {
    ...filters,
    status: normalizedStatus,
    q: normalizeString(filters.q).slice(0, CONFIG.MAX_SEARCH_LENGTH),
  }
}

const getOrderDisplayId = order =>
  order?.orderNumber || order?._id?.slice(-8)?.toUpperCase() || 'SIN-ID'

const getOrderCustomerName = order => {
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

const getOrderCustomerEmail = order =>
  order?.orderby?.email ||
  order?.customerSnapshot?.email ||
  order?.shippingAddress?.email ||
  'Sin email'

const getOrderCustomerPhone = order =>
  order?.orderby?.phone ||
  order?.orderby?.mobile ||
  order?.customerSnapshot?.mobile ||
  order?.shippingAddress?.phone ||
  ''

const getProductImageUrl = product => {
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

const getLineImageUrl = item => {
  return (
    item?.imageSnapshot ||
    item?.image ||
    getProductImageUrl(item?.product) ||
    null
  )
}

const getLineTitle = item => {
  return (
    item?.product?.title ||
    item?.title ||
    item?.titleSnapshot ||
    'Producto sin título'
  )
}

const getLineSku = item => {
  return (
    item?.product?.sku ||
    item?.sku ||
    item?.skuSnapshot ||
    item?.variantSku ||
    item?.variantSKU ||
    null
  )
}

const getLineQuantity = item => {
  const quantity = normalizeValue(item?.count ?? item?.quantity)
  return quantity > 0 ? quantity : 0
}

const isOrderProtectedFromDelete = order => {
  const paymentStatus = normalizeString(order?.paymentStatus).toLowerCase()
  const orderStatus = normalizeOrderStatusForUI(order?.orderStatus)
  const fulfillmentStatus = normalizeString(
    order?.fulfillmentStatus,
  ).toLowerCase()

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

const downloadTextFile = ({
  filename,
  content,
  mimeType = 'text/csv;charset=utf-8;',
}) => {
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

const escapeCsv = value => {
  const raw = value === null || value === undefined ? '' : String(value)
  const escaped = raw.replace(/"/g, '""')
  return `"${escaped}"`
}

const buildOrdersCsv = orders => {
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

const StatusBadge = memo(({ status, size = 'small' }) => {
  const normalizedStatus = normalizeOrderStatusForUI(status)
  const config =
    STATUS_BADGE_CONFIGS[normalizedStatus] || STATUS_BADGE_CONFIGS.open

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.5,
        py: 0.5,
        borderRadius: 1,
        fontSize: size === 'small' ? '0.75rem' : '0.875rem',
        fontWeight: 600,
        color: config.color,
        bgcolor: config.bgColor,
        border: `1px solid ${config.borderColor}`,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </Box>
  )
})

StatusBadge.displayName = 'StatusBadge'

const PaymentBadge = memo(({ paymentStatus }) => {
  const normalizedStatus = normalizeString(paymentStatus).toLowerCase()
  const config = PAYMENT_BADGE_CONFIGS[normalizedStatus] || {
    label: paymentStatus || 'Desconocido',
    color: '#565959',
    bgColor: '#F7F7F7',
  }

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.5,
        py: 0.5,
        borderRadius: 1,
        fontSize: '0.75rem',
        fontWeight: 600,
        color: config.color,
        bgcolor: config.bgColor,
        border: `1px solid ${config.color}20`,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </Box>
  )
})

PaymentBadge.displayName = 'PaymentBadge'

const FulfillmentBadge = memo(({ fulfillmentStatus }) => {
  const normalizedStatus = normalizeString(fulfillmentStatus).toLowerCase()
  const config = FULFILLMENT_BADGE_CONFIGS[normalizedStatus] || {
    label: fulfillmentStatus || 'Desconocido',
    color: '#565959',
    bgColor: '#F7F7F7',
  }

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 1.5,
        py: 0.5,
        borderRadius: 1,
        fontSize: '0.75rem',
        fontWeight: 600,
        color: config.color,
        bgcolor: config.bgColor,
        border: `1px solid ${config.color}20`,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </Box>
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
        gap: 2,
        p: 2,
        mb: 1.5,
        borderRadius: 1,
        border: '1px solid #D5D9D9',
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
            bgcolor: '#F7F7F7',
            border: '1px solid #D5D9D9',
          }}
        >
          {!imageUrl && <ShoppingBag />}
        </Avatar>
      </Badge>

      <Box flex={1} minWidth={0}>
        <Typography
          variant="body1"
          fontWeight={500}
          sx={{
            color: CONFIG.COLORS.AMAZON_TEXT,
            mb: 0.5,
            lineHeight: 1.4,
          }}
        >
          {title}
        </Typography>

        {sku && (
          <Typography
            variant="caption"
            sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY, display: 'block' }}
          >
            SKU: {sku}
          </Typography>
        )}
      </Box>

      <Box textAlign="right" minWidth={110}>
        <Typography
          variant="body1"
          fontWeight={700}
          sx={{ color: CONFIG.COLORS.AMAZON_RED, fontSize: '1.1rem' }}
        >
          {formatCurrency(subtotal)}
        </Typography>

        <Typography
          variant="caption"
          sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
        >
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
        borderRadius: 1,
        border: '1px solid #D5D9D9',
        bgcolor: 'white',
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: CONFIG.COLORS.AMAZON_TEXT,
          fontWeight: 700,
          fontSize: '0.9rem',
          mb: 2,
          textTransform: 'uppercase',
        }}
      >
        <LocationOn
          fontSize="small"
          sx={{ color: CONFIG.COLORS.AMAZON_BLUE }}
        />
        Dirección de envío
      </Typography>

      <Typography variant="body1" fontWeight={600}>
        {address.firstName || '-'} {address.lastName || ''}
      </Typography>

      <Typography
        variant="body2"
        sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY, mt: 0.5 }}
      >
        {address.address || 'Sin dirección'}
      </Typography>

      <Typography
        variant="body2"
        sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
      >
        {address.city || 'Sin ciudad'}
        {address.zipCode && `, CP: ${address.zipCode}`}
        {address.country && `, ${address.country}`}
      </Typography>

      <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
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

const OrderSummary = memo(({ totals, paymentStatus, fulfillmentStatus }) => {
  return (
    <Box
      sx={{
        mt: 2,
        p: 3,
        borderRadius: 1,
        border: '1px solid #D5D9D9',
        bgcolor: '#F7F7F7',
      }}
    >
      <Typography
        variant="h6"
        sx={{
          color: CONFIG.COLORS.AMAZON_TEXT,
          fontWeight: 700,
          fontSize: '1rem',
          mb: 2,
          pb: 1,
          borderBottom: '1px solid #D5D9D9',
        }}
      >
        Resumen del pedido
      </Typography>

      <Box display="flex" justifyContent="space-between" mb={1.5}>
        <Typography
          variant="body2"
          sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
        >
          Subtotal
        </Typography>
        <Typography variant="body2" fontWeight={500}>
          {formatCurrency(totals?.subtotal)}
        </Typography>
      </Box>

      <Box display="flex" justifyContent="space-between" mb={1.5}>
        <Typography
          variant="body2"
          sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
        >
          Descuento
        </Typography>
        <Typography variant="body2" fontWeight={500}>
          -{formatCurrency(totals?.discount)}
        </Typography>
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography
          variant="h6"
          sx={{
            color: CONFIG.COLORS.AMAZON_RED,
            fontWeight: 700,
            fontSize: '1.1rem',
          }}
        >
          Total
        </Typography>

        <Typography
          variant="h5"
          sx={{
            color: CONFIG.COLORS.AMAZON_RED,
            fontWeight: 700,
            fontSize: '1.5rem',
          }}
        >
          {formatCurrency(totals?.total)}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
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
    const allowedPaymentStatuses = PAYMENT_TRANSITIONS[order.paymentStatus] || [
      order.paymentStatus,
    ]
    const allowedFulfillmentStatuses = FULFILLMENT_TRANSITIONS[
      order.fulfillmentStatus
    ] || [order.fulfillmentStatus]
    const orderTotal = normalizeValue(order.totals?.total)

    return (
      <Box
        sx={{
          mt: 2,
          p: 3,
          borderRadius: 1,
          border: `2px solid ${CONFIG.COLORS.AMAZON_DARK}`,
          bgcolor: 'white',
        }}
      >
        <Typography
          variant="subtitle1"
          sx={{
            color: CONFIG.COLORS.AMAZON_TEXT,
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
          <Typography variant="caption" color="text.secondary" display="block">
            Estado comercial
          </Typography>
          <StatusBadge status={normalizedOrderStatus} size="medium" />
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            sx={{ mt: 0.75 }}
          >
            Se calcula automáticamente según el pago y la logística.
          </Typography>
        </Box>

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Estado del Pago</InputLabel>
          <Select
            value={order.paymentStatus || PAYMENT_STATUSES.PENDING}
            label="Estado del Pago"
            onChange={e =>
              onPaymentStatusChange(order._id, e.target.value, orderTotal)
            }
            disabled={
              isFinalState || disabled || allowedPaymentStatuses.length === 1
            }
          >
            {allowedPaymentStatuses.includes('pending') && (
              <MenuItem value="pending">Pendiente</MenuItem>
            )}
            {allowedPaymentStatuses.includes('approved') && (
              <MenuItem value="approved" sx={{ color: '#067D62' }}>
                Aprobado
              </MenuItem>
            )}
            {allowedPaymentStatuses.includes('rejected') && (
              <MenuItem value="rejected" sx={{ color: '#B12704' }}>
                Rechazado
              </MenuItem>
            )}
            {allowedPaymentStatuses.includes('cancelled') && (
              <MenuItem value="cancelled" sx={{ color: '#B12704' }}>
                Cancelado
              </MenuItem>
            )}
            {allowedPaymentStatuses.includes('refunded') && (
              <MenuItem value="refunded" sx={{ color: '#6B21A8' }}>
                Reembolsado
              </MenuItem>
            )}
          </Select>
        </FormControl>

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Estado Logístico</InputLabel>
          <Select
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

        <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            color="error"
            onClick={() => onCancel(order._id, orderTotal)}
            disabled={isFinalState || disabled}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Cancelar
          </Button>

          <Button
            variant="outlined"
            color="secondary"
            onClick={() => onRefund(order._id, orderTotal)}
            disabled={
              order.paymentStatus !== PAYMENT_STATUSES.APPROVED ||
              isRefunded ||
              disabled
            }
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
            bgcolor: expanded ? '#F0F9FB' : 'inherit',
            '& > td': { borderBottom: expanded ? 'none' : undefined },
          }}
        >
          <TableCell padding="checkbox">
            <IconButton size="small" onClick={handleToggle} disabled={disabled}>
              {expanded ? (
                <ExpandLess fontSize="small" />
              ) : (
                <ExpandMore fontSize="small" />
              )}
            </IconButton>
          </TableCell>

          <TableCell>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ color: CONFIG.COLORS.AMAZON_BLUE }}
            >
              #{getOrderDisplayId(order)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
            >
              {formatDateShort(order.createdAt)}
            </Typography>
          </TableCell>

          <TableCell>
            <Typography variant="body2" noWrap sx={{ maxWidth: 180 }}>
              {customerEmail}
            </Typography>

            {customerName && (
              <Typography
                variant="caption"
                sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
              >
                {customerName}
              </Typography>
            )}
          </TableCell>

          <TableCell align="right">
            <Typography
              variant="body2"
              fontWeight={700}
              sx={{ color: CONFIG.COLORS.AMAZON_RED }}
            >
              {formatCurrency(order.totals?.total)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: CONFIG.COLORS.AMAZON_SECONDARY }}
            >
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
            <TableCell colSpan={8} sx={{ p: 0, bgcolor: '#FAFAFA' }}>
              <Box sx={{ p: 3 }}>
                <Grid container spacing={3}>
                  <Grid item xs={12} lg={8}>
                    <Typography
                      variant="h6"
                      sx={{
                        color: CONFIG.COLORS.AMAZON_TEXT,
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

                  <Grid item xs={12} lg={4}>
                    <ShippingCard address={order.shippingAddress} />

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
            bgcolor: CONFIG.COLORS.AMAZON_DARK,
            color: 'white',
            fontSize: '1.1rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {isHighValue && <Warning sx={{ mr: 1, color: '#FF9900' }} />}
          {title}
        </DialogTitle>

        <DialogContent sx={{ pt: 3 }}>
          {isHighValue && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Orden de alto valor: <strong>{formatCurrency(orderTotal)}</strong>
            </Alert>
          )}

          <Typography id="admin-order-confirm-description">
            {message}
          </Typography>
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
            startIcon={
              loading ? <CircularProgress size={16} color="inherit" /> : null
            }
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
    onCancel,
    onRefund,
    onDelete,
    disabled = false,
  }) => {
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
        scroll="paper"
        disableRestoreFocus
        aria-labelledby="admin-order-detail-title"
      >
        <DialogTitle
          sx={{
            bgcolor: CONFIG.COLORS.AMAZON_DARK,
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography
            id="admin-order-detail-title"
            variant="h6"
            sx={{ fontWeight: 700 }}
          >
            Pedido #{getOrderDisplayId(order)}
          </Typography>

          <IconButton
            onClick={onClose}
            sx={{ color: 'white' }}
            disabled={disabled}
          >
            <Close />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ bgcolor: '#F7F7F7', p: 0 }}>
          <Box sx={{ p: 3 }}>
            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
                <Paper
                  sx={{ p: 3, borderRadius: 1, border: '1px solid #D5D9D9' }}
                >
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 700, fontSize: '1rem', mb: 2 }}
                  >
                    Productos ({order.products?.length || 0})
                  </Typography>

                  {order.products?.map((item, idx) => (
                    <ProductItem
                      key={`detail-${order._id}-${idx}`}
                      item={item}
                    />
                  ))}
                </Paper>
              </Grid>

              <Grid item xs={12} md={4}>
                <Paper
                  sx={{
                    p: 3,
                    borderRadius: 1,
                    border: '1px solid #D5D9D9',
                    mb: 2,
                  }}
                >
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 700, fontSize: '1rem', mb: 2 }}
                  >
                    Cliente
                  </Typography>

                  <Box mb={2}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Email
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {customerEmail}
                    </Typography>
                  </Box>

                  <Box mb={2}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                    >
                      Nombre
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {customerName || '-'}
                    </Typography>
                  </Box>

                  {customerPhone && (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                      >
                        Teléfono
                      </Typography>
                      <Typography variant="body2" fontWeight={500}>
                        {customerPhone}
                      </Typography>
                    </Box>
                  )}
                </Paper>

                <ShippingCard address={order.shippingAddress} />

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

      if (
        legacyStatus === ORDER_STATUSES.CANCELLED ||
        legacyStatus === ORDER_STATUSES.REFUNDED
      ) {
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

      dispatch(
        updateOrderStatusThunk({ id: orderId, orderStatus: legacyStatus }),
      )
        .unwrap()
        .then(() => {
          showSnackbar('Estado comercial actualizado correctamente', 'success')
          loadOrders()
        })
        .catch(error => {
          showSnackbar(
            getErrorMessage(error, 'Error actualizando estado'),
            'error',
          )
        })
    },
    [dispatch, isUpdating, loadOrders, orders, showSnackbar],
  )

  const handlePaymentStatusChange = useCallback(
    (orderId, paymentStatus, orderTotal = 0) => {
      if (isUpdating) return

      if (
        paymentStatus === PAYMENT_STATUSES.APPROVED &&
        orderTotal > CONFIG.HIGH_VALUE_THRESHOLD
      ) {
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
          showSnackbar(
            getErrorMessage(error, 'Error actualizando pago'),
            'error',
          )
        })
    },
    [dispatch, isUpdating, loadOrders, showSnackbar],
  )

  const handleFulfillmentStatusChange = useCallback(
    (orderId, fulfillmentStatus) => {
      if (isUpdating) return

      dispatch(
        updateOrderFulfillmentStatusThunk({ id: orderId, fulfillmentStatus }),
      )
        .unwrap()
        .then(() => {
          showSnackbar('Estado logístico actualizado correctamente', 'success')
          loadOrders()
        })
        .catch(error => {
          showSnackbar(
            getErrorMessage(error, 'Error actualizando logística'),
            'error',
          )
        })
    },
    [dispatch, isUpdating, loadOrders, showSnackbar],
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
    } else if (
      action === CONFIRM_ACTIONS.REFUND_ORDER ||
      action === CONFIRM_ACTIONS.REFUNDED
    ) {
      promise = dispatch(
        refundOrderThunk({ id: payload?.id || confirmDialog.orderId }),
      )
      successMessage = 'Orden reembolsada correctamente'
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

    const open = orders.filter(
      order =>
        normalizeOrderStatusForUI(order.orderStatus) === ORDER_STATUSES.OPEN,
    ).length

    const processing = orders.filter(
      order =>
        normalizeOrderStatusForUI(order.orderStatus) ===
        ORDER_STATUSES.PROCESSING,
    ).length

    const delivered = orders.filter(
      order =>
        normalizeOrderStatusForUI(order.orderStatus) ===
        ORDER_STATUSES.DELIVERED,
    ).length

    const totalRevenue = orders.reduce(
      (sum, order) => sum + normalizeValue(order.totals?.total),
      0,
    )

    return { total, open, processing, delivered, totalRevenue }
  }, [orders, pagination.total])

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
      return '¿Deseas cancelar esta orden? Esta acción puede restaurar stock según la lógica del backend.'
    }

    if (
      confirmDialog.action === CONFIRM_ACTIONS.REFUND_ORDER ||
      confirmDialog.action === CONFIRM_ACTIONS.REFUNDED
    ) {
      return '¿Deseas reembolsar esta orden? Esta acción debe estar alineada con el proveedor de pago.'
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

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F3F3F3' }}>
      <Box
        sx={{
          bgcolor: CONFIG.COLORS.AMAZON_DARK,
          color: 'white',
          py: 2.5,
          px: 3,
          borderBottom: `3px solid ${CONFIG.COLORS.AMAZON_ORANGE}`,
        }}
      >
        <Container maxWidth="xl">
          <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
            Gestión de Pedidos
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Typography variant="body2">
              {stats.total} pedidos • {formatCurrency(stats.totalRevenue)} en
              ventas
            </Typography>

            <Box display="flex" gap={1} flexWrap="wrap">
              <Chip label={`${stats.open} abiertas`} size="small" />
              <Chip label={`${stats.processing} procesando`} size="small" />
              <Chip label={`${stats.delivered} entregadas`} size="small" />
            </Box>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 3 }}>
        {isError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {message || 'Error al cargar órdenes'}
          </Alert>
        )}

        <Paper sx={{ p: 2, mb: 3 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                size="small"
                placeholder="Buscar por ID, email, nombre..."
                value={searchTerm}
                onChange={handleSearchChange}
                disabled={isUpdating}
                inputProps={{
                  maxLength: CONFIG.MAX_SEARCH_LENGTH,
                }}
                InputProps={{
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
                      >
                        <Close fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>

            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Estado orden</InputLabel>
                <Select
                  value={filters.status}
                  label="Estado orden"
                  disabled={isUpdating}
                  onChange={event =>
                    handleFilterChange('status', event.target.value)
                  }
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
            </Grid>

            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Pago</InputLabel>
                <Select
                  value={filters.paymentStatus}
                  label="Pago"
                  disabled={isUpdating}
                  onChange={event =>
                    handleFilterChange('paymentStatus', event.target.value)
                  }
                >
                  <MenuItem value="">Todos</MenuItem>
                  <MenuItem value="pending">Pendiente</MenuItem>
                  <MenuItem value="approved">Aprobado</MenuItem>
                  <MenuItem value="rejected">Rechazado</MenuItem>
                  <MenuItem value="cancelled">Cancelado</MenuItem>
                  <MenuItem value="refunded">Reembolsado</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} md={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Logística</InputLabel>
                <Select
                  value={filters.fulfillmentStatus}
                  label="Logística"
                  disabled={isUpdating}
                  onChange={event =>
                    handleFilterChange('fulfillmentStatus', event.target.value)
                  }
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
            </Grid>

            <Grid item xs={12} md={2}>
              <Box display="flex" justifyContent="flex-end" gap={1}>
                <Button
                  variant="outlined"
                  startIcon={<Download />}
                  onClick={handleExport}
                  disabled={isLoading || isUpdating || orders.length === 0}
                  sx={{ textTransform: 'none' }}
                >
                  Exportar
                </Button>

                <Button
                  variant="contained"
                  startIcon={
                    isLoading ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <Refresh />
                    )
                  }
                  onClick={loadOrders}
                  disabled={isLoading || isUpdating}
                  sx={{ textTransform: 'none' }}
                >
                  {isLoading ? 'Cargando...' : 'Actualizar'}
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {isLoading && orders.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={48} />
            <Typography sx={{ mt: 2 }}>Cargando pedidos...</Typography>
          </Paper>
        ) : orders.length === 0 ? (
          <Paper sx={{ p: 6, textAlign: 'center' }}>
            <Inventory sx={{ fontSize: 64, color: '#D5D9D9', mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              No se encontraron pedidos
            </Typography>
          </Paper>
        ) : (
          <>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Pedido</TableCell>
                    <TableCell>Cliente</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="center">Orden</TableCell>
                    <TableCell align="center">Pago</TableCell>
                    <TableCell align="center">Logística</TableCell>
                    <TableCell align="right" />
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

            {pagination.pages > 1 && (
              <Box display="flex" justifyContent="center" mt={3}>
                <Pagination
                  count={pagination.pages}
                  page={pagination.page}
                  onChange={(event, value) => {
                    setFilters(prev => ({ ...prev, page: value }))
                  }}
                  size="large"
                  showFirstButton
                  showLastButton
                  disabled={isUpdating}
                />
              </Box>
            )}
          </>
        )}
      </Container>

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
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {isUpdating && (
        <Box
          sx={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            bgcolor: 'white',
            border: '1px solid #D5D9D9',
            borderRadius: 2,
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
