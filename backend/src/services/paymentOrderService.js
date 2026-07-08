import crypto from 'node:crypto'

import Order, {
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import Cart from '../models/cartModel.js'
import { Money } from '../utils/money.js'
import { toObjectId } from '../utils/requestContext.js'
import { calculateCartLines, validateCartOwnership } from './orderCartService.js'
import { normalizeMpStatus } from './paymentMercadoPagoService.js'

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const canApplyPaymentTransition = (currentStatus, nextStatus) => {
  if (!currentStatus || currentStatus === nextStatus) return true

  const allowedTransitions = {
    [PAYMENT_STATUS.PENDING]: [
      PAYMENT_STATUS.APPROVED,
      PAYMENT_STATUS.REJECTED,
      PAYMENT_STATUS.CANCELLED,
      PAYMENT_STATUS.REFUNDED,
    ],
    [PAYMENT_STATUS.APPROVED]: [PAYMENT_STATUS.REFUNDED],
    [PAYMENT_STATUS.REJECTED]: [],
    [PAYMENT_STATUS.CANCELLED]: [],
    [PAYMENT_STATUS.REFUNDED]: [],
  }

  return allowedTransitions[currentStatus]?.includes(nextStatus) === true
}

export const createOrderFromCart = async ({
  cartId,
  userId,
  tenantId,
  shippingAddress = {},
}) => {
  const cart = await Cart.findOne({
    _id: toObjectId(cartId),
    userId: toObjectId(userId),
    tenantId: toObjectId(tenantId),
  })

  validateCartOwnership({ cart, userId, tenantId })

  const { lines, subtotalCents, currency } = await calculateCartLines({
    cart,
    tenantId,
    money: Money,
  })

  const order = new Order({
    tenantId: toObjectId(tenantId),
    idempotencyKey: crypto.randomUUID(),
    orderby: toObjectId(userId),

    products: lines,

    paymentIntent: {
      id: crypto.randomUUID(),
      provider: 'mercadopago',
      status: PAYMENT_STATUS.PENDING,
      currency,
      amountCents: subtotalCents,
      originalAmountCents: subtotalCents,
      discountAmountCents: 0,
    },

    paymentStatus: PAYMENT_STATUS.PENDING,
    fulfillmentStatus: 'unfulfilled',
    refundStatus: 'none',

    customerSnapshot: {
      userId: toObjectId(userId),
      email: shippingAddress?.email || cart.userEmail || '',
      firstname: shippingAddress?.firstName || '',
      lastname: shippingAddress?.lastName || '',
    },

    shippingAddress: {
      firstName: shippingAddress?.firstName || '',
      lastName: shippingAddress?.lastName || '',
      email: shippingAddress?.email || '',
      phone: shippingAddress?.phone || '',
      address: shippingAddress?.address || '',
      city: shippingAddress?.city || '',
      zipCode: shippingAddress?.zipCode || '',
      country: shippingAddress?.country || 'AR',
    },
  })

  await order.save({ tenantId })
  return order
}

export const applyMercadoPagoStatusToOrder = ({
  order,
  mpStatus,
  providerPaymentId,
  paymentMethodId = null,
  installments = null,
  payerEmail = null,
  statusDetail = null,
  providerRawStatus = null,
}) => {
  const normalizedPaymentStatus = normalizeMpStatus(mpStatus)

  if (!normalizedPaymentStatus) {
    throw new Error(`Estado de Mercado Pago no soportado: ${mpStatus}`)
  }

  if (
    !canApplyPaymentTransition(
      order.paymentStatus,
      normalizedPaymentStatus,
    )
  ) {
    return order
  }

  order.paymentStatus = normalizedPaymentStatus
  order.paymentIntent.status = normalizedPaymentStatus

  if (providerPaymentId) {
    order.paymentIntent.providerPaymentId = String(providerPaymentId)
  }

  if (providerRawStatus || mpStatus) {
    order.paymentIntent.providerRawStatus = sanitizeString(
      providerRawStatus || mpStatus,
    )
  }

  if (statusDetail) {
    order.paymentIntent.statusDetail = sanitizeString(statusDetail)
  }

  if (paymentMethodId) {
    order.paymentIntent.method = sanitizeString(paymentMethodId).toLowerCase()
  }

  if (installments !== null && installments !== undefined) {
    order.paymentIntent.installments = Number(installments)
  }

  if (payerEmail) {
    order.paymentIntent.payerEmail = normalizeEmail(payerEmail)
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED && !order.paidAt) {
    order.paidAt = new Date()
    order.paymentError = null
    order.paymentErrorCode = null
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.REFUNDED) {
    order.refundStatus = REFUND_STATUS.REFUNDED
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.CANCELLED) {
    order.cancellation.cancelled = true
    order.cancellation.cancelledAt =
      order.cancellation.cancelledAt || new Date()
    order.cancellation.reason =
      order.cancellation.reason || 'Cancelado por Mercado Pago'
  }

  order.syncDerivedState?.()
  return order
}
