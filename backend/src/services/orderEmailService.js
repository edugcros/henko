import Order from '../models/orderModel.js'
import {
  sendAdminNotificationEmail,
  sendOrderConfirmationEmail,
} from './emailService.js'

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

export const buildOrderForEmail = (order, { money } = {}) => {
  const Money = money || {
    toDecimal: cents => {
      const num = Number(cents)
      if (!Number.isFinite(num)) return 0
      return Number((num / 100).toFixed(2))
    },
  }

  const enriched = typeof order.toObject === 'function' ? order.toObject() : order

  return {
    _id: enriched._id,
    id: enriched._id,
    orderNumber:
      enriched.idempotencyKey?.slice(-8).toUpperCase() ||
      enriched.paymentIntent?.id?.slice(-8).toUpperCase() ||
      enriched._id?.toString?.().slice(-8).toUpperCase(),
    items: (enriched.products || []).map(line => ({
      title: line.titleSnapshot || 'Producto',
      price: Money.toDecimal(line.priceCents),
      quantity: line.count,
      image: line.imageSnapshot || null,
      subtotal: Money.toDecimal(line.subtotalCents),
      variantSku: line.variantSku,
      selectedAttributes: selectedAttributesToObject(line.selectedAttributes),
    })),
    subtotal: enriched.totals?.subtotal || 0,
    discount: enriched.totals?.discount || 0,
    total: enriched.totals?.total || 0,
    shippingAddress: enriched.shippingAddress,
    currency: enriched.paymentIntent?.currency || 'ARS',
    status: enriched.orderStatus,
    createdAt: enriched.createdAt,
    paymentStatus: enriched.paymentStatus,
    paymentIntent: enriched.paymentIntent,
    customerSnapshot: enriched.customerSnapshot,
  }
}

export const dispatchOrderCreationEmails = ({
  order,
  money,
  logger,
}) => {
  const orderForEmail = buildOrderForEmail(order, { money })

  sendOrderConfirmationEmail(orderForEmail, order.shippingAddress.email)
    .then(result => {
      if (result?.success) {
        return Order.updateOne(
          { _id: order._id, tenantId: order.tenantId },
          { $set: { emailSent: true, emailSentAt: new Date() } },
        ).setOptions({ tenantId: order.tenantId })
      }

      return null
    })
    .catch(error =>
      logger.error(`❌ Error enviando email confirmación orden: ${error.message}`),
    )

  sendAdminNotificationEmail(orderForEmail).catch(error =>
    logger.error(`❌ Error enviando email admin orden: ${error.message}`),
  )
}

export const resendOrderConfirmationEmail = async ({
  order,
  tenantId,
  money,
}) => {
  const result = await sendOrderConfirmationEmail(
    buildOrderForEmail(order, { money }),
    order.shippingAddress.email,
  )

  if (result?.success) {
    await Order.updateOne(
      { _id: order._id, tenantId },
      { $set: { emailResentAt: new Date() } },
    ).setOptions({ tenantId })
  }

  return result
}
