import Order, { PAYMENT_STATUS } from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import {
  sendAdminNotificationEmail,
  sendOrderConfirmationEmail,
} from './emailService.js'
import { getTenantConfig } from './paymentTenantConfigService.js'
import logger from '../../config/logger.js'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeEmail = value => String(value || '').trim().toLowerCase()
const isValidEmail = value => EMAIL_REGEX.test(normalizeEmail(value))

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const getBuyerEmail = ({ order, buyerEmail, context = {} }) => {
  const candidates = [
    order?.shippingAddress?.email,
    order?.customerSnapshot?.email,
    order?.paymentIntent?.payerEmail,
    buyerEmail,
    context?.user?.email,
    order?.orderby?.email,
  ]

  return candidates
    .map(normalizeEmail)
    .find(candidate => candidate && isValidEmail(candidate)) || null
}

export const buildOrderForEmail = order => {
  const enriched = typeof order?.toObject === 'function'
    ? order.toObject({ virtuals: true })
    : order
  const products = enriched?.products || []
  const subtotalCents = products.reduce(
    (sum, line) => sum + Number(line.subtotalCents || 0),
    0,
  )
  const discountCents = Number(
    enriched?.coupon?.discountAmountCents ||
      enriched?.paymentIntent?.discountAmountCents ||
      0,
  )

  return {
    _id: enriched?._id,
    id: enriched?._id,
    orderNumber:
      enriched?.idempotencyKey?.slice(-8).toUpperCase() ||
      enriched?.paymentIntent?.id?.slice(-8).toUpperCase() ||
      enriched?._id?.toString?.().slice(-8).toUpperCase(),
    items: products.map(line => ({
      title: line.titleSnapshot || 'Producto',
      price: Money.toDecimal(line.priceCents),
      originalPrice: Money.toDecimal(
        line.originalPriceCents ?? line.priceCents,
      ),
      quantity: line.count,
      image: line.imageSnapshot || null,
      subtotal: Money.toDecimal(line.subtotalCents),
      variantSku: line.variantSku || line.skuSnapshot || null,
      selectedAttributes: selectedAttributesToObject(line.selectedAttributes),
    })),
    subtotal: Money.toDecimal(subtotalCents),
    discount: Money.toDecimal(discountCents),
    total: Money.toDecimal(enriched?.paymentIntent?.amountCents || 0),
    currency: enriched?.paymentIntent?.currency || 'ARS',
    shippingAddress: enriched?.shippingAddress || {},
    customerSnapshot: enriched?.customerSnapshot || {},
    paymentStatus: enriched?.paymentStatus,
    paymentIntent: enriched?.paymentIntent,
    createdAt: enriched?.createdAt,
  }
}

export const dispatchApprovedOrderEmails = async ({
  order,
  buyerEmail = null,
  tenantConfig = null,
  context = {},
}) => {
  if (!order?._id || !order?.tenantId) {
    throw new Error('Orden inválida para enviar emails')
  }

  if (order.paymentStatus !== PAYMENT_STATUS.APPROVED) {
    return {
      customerEmailSent: false,
      adminEmailSent: false,
      skipped: true,
      reason: 'PAYMENT_NOT_APPROVED',
    }
  }

  const resolvedTenantConfig =
    tenantConfig || await getTenantConfig(order.tenantId)
  const resolvedBuyerEmail = getBuyerEmail({
    order,
    buyerEmail,
    context,
  })
  const orderForEmail = buildOrderForEmail(order)
  const results = []
  const resolvedAdminEmail = normalizeEmail(resolvedTenantConfig?.adminEmail)
  const recipientsAreDistinct =
    Boolean(resolvedBuyerEmail && resolvedAdminEmail) &&
    resolvedBuyerEmail !== resolvedAdminEmail

  if (order.emailSent && order.adminEmailSent) {
    return {
      customerEmailSent: true,
      adminEmailSent: true,
      results,
      skipped: true,
      reason: 'ALREADY_SENT',
    }
  }

  if (!order.emailSent && resolvedBuyerEmail) {
    const result = await sendOrderConfirmationEmail(
      orderForEmail,
      resolvedBuyerEmail,
      resolvedTenantConfig,
      context,
    )

    results.push({ type: 'customer', ...result })

    if (result?.success) {
      order.emailSent = true
      order.emailSentAt = new Date()
    }
  }

  if (!order.adminEmailSent && resolvedAdminEmail) {
    const result = await sendAdminNotificationEmail(
      orderForEmail,
      resolvedAdminEmail,
      resolvedTenantConfig,
    )

    results.push({ type: 'admin', ...result })

    if (result?.success) {
      order.adminEmailSent = true
      order.adminEmailSentAt = new Date()
    }
  }

  const customerEmailSent = Boolean(order.emailSent)
  const adminEmailSent = Boolean(order.adminEmailSent)
  const failed = results.filter(result => result.success !== true)
  const noRecipientAvailable =
    !resolvedBuyerEmail && !resolvedAdminEmail

  order.addAuditEntry?.({
    action:
      failed.length || noRecipientAvailable
        ? 'email_failed'
        : 'email_sent',
    performedByRole: 'system',
    metadata: {
      customerEmailSent,
      adminEmailSent,
      buyerEmailAvailable: Boolean(resolvedBuyerEmail),
      adminEmailAvailable: Boolean(resolvedAdminEmail),
      recipientsAreDistinct,
      resultTypes: results.map(result => ({
        type: result.type,
        success: Boolean(result.success),
        code: result.code || result.error || null,
        messageId: result.messageId || null,
        acceptedCount: Array.isArray(result.accepted)
          ? result.accepted.length
          : 0,
        rejectedCount: Array.isArray(result.rejected)
          ? result.rejected.length
          : 0,
      })),
    },
  })

  await order.save({ tenantId: order.tenantId })

  logger.info('📧 Emails de orden procesados', {
    orderId: order._id.toString(),
    tenantId: order.tenantId.toString(),
    customerEmailSent,
    adminEmailSent,
    recipientsAreDistinct,
    failed: failed.length,
  })

  return {
    customerEmailSent,
    adminEmailSent,
    results,
  }
}

export const dispatchOrderCreationEmails = async ({
  order,
  buyerEmail = null,
  tenantConfig = null,
}) => {
  return dispatchApprovedOrderEmails({
    order,
    buyerEmail,
    tenantConfig,
  })
}

export const resendOrderConfirmationEmail = async ({
  order,
  tenantId,
  buyerEmail = null,
  tenantConfig = null,
}) => {
  const resolvedTenantConfig =
    tenantConfig || await getTenantConfig(tenantId)
  const resolvedBuyerEmail = getBuyerEmail({
    order,
    buyerEmail,
  })

  if (!resolvedBuyerEmail) {
    return {
      success: false,
      error: 'INVALID_CLIENT_EMAIL',
    }
  }

  const result = await sendOrderConfirmationEmail(
    buildOrderForEmail(order),
    resolvedBuyerEmail,
    resolvedTenantConfig,
  )

  if (result?.success) {
    await Order.updateOne(
      { _id: order._id, tenantId },
      { $set: { emailResentAt: new Date() } },
    ).setOptions({ tenantId })
  }

  return result
}
