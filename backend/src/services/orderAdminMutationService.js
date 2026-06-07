import {
  FULFILLMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_STATUS,
} from '../models/orderModel.js'
import { restoreStockForLines } from './orderInventoryService.js'
import { releaseReservedStock } from './paymentOrderOpsService.js'

export const findOrderForAdminMutation = async ({
  orderModel,
  orderId,
  tenantObjectId,
  tenantId,
  normalizeObjectId,
  isValidId,
  session = null,
  includeDeleted = false,
}) => {
  if (!isValidId(orderId)) {
    const error = new Error('ID de orden inválido')
    error.statusCode = 400
    throw error
  }

  const query = {
    _id: normalizeObjectId(orderId),
    tenantId: tenantObjectId,
  }

  if (!includeDeleted) {
    query.isDeleted = false
  }

  let cursor = orderModel.findOne(query).setOptions({ tenantId })
  if (session) {
    cursor = cursor.session(session)
  }

  const order = await cursor

  if (!order) {
    const error = new Error('Orden no encontrada')
    error.statusCode = 404
    throw error
  }

  return order
}

export const appendOrderAdminAuditEntry = ({
  order,
  action,
  req,
  performedBy,
  reason,
  metadata = {},
}) => {
  if (typeof order?.addAuditEntry !== 'function') return

  order.addAuditEntry({
    action,
    performedBy,
    performedByRole: req.user?.role || 'admin',
    reason,
    metadata,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
}

export const orderRequiresForceDeletion = ({
  order,
  legacyOrderStatus,
}) => {
  const paymentStatus = String(order?.paymentStatus || '').toLowerCase()
  const orderStatus = String(order?.orderStatus || '').toLowerCase()
  const fulfillmentStatus = String(order?.fulfillmentStatus || '').toLowerCase()

  const protectedOrder =
    paymentStatus === PAYMENT_STATUS.APPROVED ||
    orderStatus === legacyOrderStatus.DELIVERED ||
    orderStatus === legacyOrderStatus.REFUNDED ||
    fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED

  return {
    protectedOrder,
    paymentStatus,
    orderStatus,
    fulfillmentStatus,
  }
}

export const cancelOrderWithInventoryRestore = async ({
  orderModel,
  orderId,
  tenantObjectId,
  tenantId,
  session,
  cancelledBy,
  reason,
  req,
  normalizeObjectId,
  isValidId,
}) => {
  const order = await findOrderForAdminMutation({
    orderModel,
    orderId,
    tenantObjectId,
    tenantId,
    normalizeObjectId,
    isValidId,
    session,
  })

  if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.REFUNDED].includes(order.orderStatus)) {
    const error = new Error(`La orden ya está finalizada como ${order.orderStatus}`)
    error.statusCode = 409
    throw error
  }

  if (!order.stockRestoredAt && order.stockReservedAt) {
    await releaseReservedStock(order.products, tenantId)

    order.stockReservedAt = null
    order.stockRestoredAt = new Date()
  } else if (!order.stockRestoredAt && order.stockCommittedAt) {
    await restoreStockForLines({
      lines: order.products,
      tenantId,
      session,
    })

    order.stockCommittedAt = null
    order.stockRestoredAt = new Date()
  }

  await order.markCancelled({
    tenantId,
    cancelledBy: cancelledBy ? normalizeObjectId(cancelledBy) : null,
    reason,
    session,
    req,
  })

  return order
}

export const refundOrderWithInventoryRestore = async ({
  orderModel,
  orderId,
  tenantObjectId,
  tenantId,
  session,
  performedBy,
  reason,
  req,
  normalizeObjectId,
  isValidId,
}) => {
  const order = await findOrderForAdminMutation({
    orderModel,
    orderId,
    tenantObjectId,
    tenantId,
    normalizeObjectId,
    isValidId,
    session,
  })

  if (order.paymentStatus !== PAYMENT_STATUS.APPROVED) {
    const error = new Error('Solo se pueden reembolsar pagos aprobados')
    error.statusCode = 400
    throw error
  }

  if (!order.stockRestoredAt && order.stockReservedAt) {
    await releaseReservedStock(order.products, tenantId)

    order.stockReservedAt = null
    order.stockRestoredAt = new Date()
  } else if (!order.stockRestoredAt && order.stockCommittedAt) {
    await restoreStockForLines({
      lines: order.products,
      tenantId,
      session,
    })

    order.stockCommittedAt = null
    order.stockRestoredAt = new Date()
  }

  await order.markRefunded({
    tenantId,
    performedBy,
    reason,
    session,
    req,
  })

  return order
}
