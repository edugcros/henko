import React, { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  Pagination,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import {
  ExpandLess,
  ExpandMore,
  Inventory2Outlined,
  LocalShippingOutlined,
  PaymentsOutlined,
  ReceiptLongOutlined,
} from '@mui/icons-material'
import { getOrdersThunk } from '@features/orders/orderSlice'

const ORDER_LABELS = {
  open: 'Orden recibida',
  processing: 'En preparación',
  shipped: 'En camino',
  delivered: 'Entregada',
  cancelled: 'Cancelada',
  refunded: 'Reembolsada',
}

const PAYMENT_LABELS = {
  pending: 'Pago pendiente',
  approved: 'Pago aprobado',
  rejected: 'Pago rechazado',
  cancelled: 'Pago cancelado',
  refunded: 'Pago reembolsado',
}

const FULFILLMENT_LABELS = {
  unfulfilled: 'Pendiente de preparación',
  preparing: 'Preparando pedido',
  ready_to_ship: 'Listo para enviar',
  shipped: 'En tránsito',
  delivered: 'Entregado',
  returned: 'Devuelto',
}

const CHIP_COLORS = {
  open: 'warning',
  processing: 'info',
  shipped: 'info',
  delivered: 'success',
  cancelled: 'error',
  refunded: 'secondary',
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  returned: 'secondary',
}

const formatMoney = (amount, currency = 'ARS') =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
  }).format(Number(amount || 0))

const formatDate = value => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible'

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const getOrderNumber = order =>
  order?.orderNumber ||
  order?.idempotencyKey?.slice(-8)?.toUpperCase() ||
  order?._id?.slice(-8)?.toUpperCase() ||
  'SIN-ID'

const OrderStatusChip = ({ value, labels }) => (
  <Chip
    size="small"
    color={CHIP_COLORS[value] || 'default'}
    label={labels[value] || value || 'Sin estado'}
    variant="outlined"
  />
)

const ProductLine = ({ item }) => {
  const currency = item?.currency || 'ARS'
  const subtotal = item?.subtotal ?? Number(item?.subtotalCents || 0) / 100
  const attributes = item?.selectedAttributes || {}
  const attributeEntries = Object.entries(attributes)

  return (
    <Stack direction="row" spacing={2} sx={{ py: 1.5 }}>
      <Avatar
        src={item?.imageSnapshot || undefined}
        variant="rounded"
        sx={{ width: 64, height: 64, bgcolor: 'action.hover' }}
      >
        <Inventory2Outlined />
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={700}>
          {item?.titleSnapshot || 'Producto'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Cantidad: {item?.count || 0}
          {item?.variantSku ? ` · SKU ${item.variantSku}` : ''}
        </Typography>

        {attributeEntries.length > 0 && (
          <Typography variant="caption" color="text.secondary" display="block">
            {attributeEntries.map(([key, value]) => `${key}: ${value}`).join(' · ')}
          </Typography>
        )}
      </Box>

      <Typography variant="body2" fontWeight={700}>
        {formatMoney(subtotal, currency)}
      </Typography>
    </Stack>
  )
}

const OrderCard = ({ order, expanded, onToggle }) => {
  const total = order?.totals?.total ?? Number(order?.paymentIntent?.amountCents || 0) / 100
  const currency = order?.paymentIntent?.currency || order?.products?.[0]?.currency || 'ARS'

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2 }}>
      <Box sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <ReceiptLongOutlined color="action" />
              <Typography variant="subtitle1" fontWeight={800}>
                Pedido #{getOrderNumber(order)}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {formatDate(order?.createdAt)}
            </Typography>
          </Box>

          <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
            <Typography variant="caption" color="text.secondary">
              Total
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              {formatMoney(total, currency)}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2 }}>
          <OrderStatusChip value={order?.orderStatus} labels={ORDER_LABELS} />
          <OrderStatusChip value={order?.paymentStatus} labels={PAYMENT_LABELS} />
          <OrderStatusChip
            value={order?.fulfillmentStatus}
            labels={FULFILLMENT_LABELS}
          />
        </Stack>

        <Button
          size="small"
          onClick={onToggle}
          endIcon={expanded ? <ExpandLess /> : <ExpandMore />}
          sx={{ mt: 1.5, px: 0 }}
        >
          {expanded ? 'Ocultar detalle' : 'Ver detalle'}
        </Button>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Divider />
        <Box sx={{ p: { xs: 2, md: 2.5 }, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" fontWeight={800}>
            Productos
          </Typography>

          <Stack divider={<Divider flexItem />}>
            {(order?.products || []).map((item, index) => (
              <ProductLine key={`${order?._id}-${index}`} item={item} />
            ))}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={3}
            justifyContent="space-between"
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <LocalShippingOutlined fontSize="small" />
                <Typography variant="subtitle2" fontWeight={800}>
                  Entrega
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {order?.shippingAddress?.address || 'Dirección no informada'}
                {order?.shippingAddress?.city
                  ? `, ${order.shippingAddress.city}`
                  : ''}
              </Typography>
              {order?.shipment?.trackingNumber && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Seguimiento: {order.shipment.trackingNumber}
                </Typography>
              )}
            </Box>

            <Box sx={{ minWidth: 220 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <PaymentsOutlined fontSize="small" />
                <Typography variant="subtitle2" fontWeight={800}>
                  Resumen
                </Typography>
              </Stack>
              <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  Subtotal: {formatMoney(order?.totals?.subtotal, currency)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Descuento: {formatMoney(order?.totals?.discount, currency)}
                </Typography>
                <Typography variant="body2" fontWeight={800}>
                  Total: {formatMoney(total, currency)}
                </Typography>
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  )
}

const OrderHistory = () => {
  const dispatch = useDispatch()
  const list = useSelector(state => state.order?.list)
  const orders = Array.isArray(list?.data?.data) ? list.data.data : []
  const pagination = list?.data?.pagination || {}
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    dispatch(getOrdersThunk({ page, limit: 10 }))
  }, [dispatch, page])

  const pages = useMemo(
    () => Math.max(Number(pagination?.pages || 1), 1),
    [pagination?.pages],
  )

  return (
    <Box sx={{ minHeight: '70vh', bgcolor: 'background.default', py: { xs: 3, md: 5 } }}>
      <Container maxWidth="lg">
        <Typography variant="h4" fontWeight={800}>
          Mis pedidos
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
          Consultá el pago, la preparación y el seguimiento de cada compra.
        </Typography>

        {list?.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {list?.message || 'No se pudieron cargar tus pedidos'}
          </Alert>
        )}

        {list?.isLoading && orders.length === 0 ? (
          <Stack alignItems="center" sx={{ py: 8 }}>
            <CircularProgress />
          </Stack>
        ) : orders.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2 }}>
            <ReceiptLongOutlined sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>
              Todavía no tenés pedidos
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {orders.map(order => (
              <OrderCard
                key={order._id}
                order={order}
                expanded={expandedId === order._id}
                onToggle={() =>
                  setExpandedId(current => (current === order._id ? null : order._id))
                }
              />
            ))}
          </Stack>
        )}

        {pages > 1 && (
          <Stack alignItems="center" sx={{ mt: 3 }}>
            <Pagination
              page={page}
              count={pages}
              onChange={(_, value) => setPage(value)}
              disabled={list?.isLoading}
            />
          </Stack>
        )}
      </Container>
    </Box>
  )
}

export default OrderHistory
