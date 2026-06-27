import mongoose from 'mongoose'

import Order from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import {
  sendAdminNotificationEmail,
  sendOrderConfirmationEmail,
} from './emailService.js'
import logger from '../../config/logger.js'

const { Schema } = mongoose

const EmailJobSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['payment_confirmation', 'admin_notification'],
    },
    orderId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    buyerEmail: {
      type: String,
      default: null,
    },
    tenantConfig: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    error: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

EmailJobSchema.index({ status: 1, createdAt: 1 })
EmailJobSchema.index({ orderId: 1, type: 1 }, { unique: true })

const EmailJob =
  mongoose.models.EmailJob ||
  mongoose.model('EmailJob', EmailJobSchema)

const normalizeEmail = value => String(value || '').trim().toLowerCase()
const isValidEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value))
const getSafeErrorMessage = error => error?.message || 'Error inesperado'

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const extractBuyerEmail = ({ order, payer, req }) => {
  const sources = [
    order?.shippingAddress?.email,
    order?.customerSnapshot?.email,
    order?.paymentIntent?.payerEmail,
    payer?.email,
    order?.orderby?.email,
    req?.user?.email,
  ]

  for (const email of sources) {
    const normalized = normalizeEmail(email)

    if (normalized && isValidEmail(normalized)) {
      return normalized
    }
  }

  logger.error('❌ No se encontró email válido del comprador', {
    orderId: order?._id?.toString?.() || null,
  })

  return null
}

const buildOrderForEmail = order => {
  const items = (order.products || []).map(item => ({
    title: item.titleSnapshot || 'Producto',
    price: Money.toDecimal(item.priceCents),
    quantity: item.count,
    image: item.imageSnapshot || null,
    subtotal: Money.toDecimal(item.subtotalCents),
    variantSku: item.variantSku || null,
    selectedAttributes: selectedAttributesToObject(item.selectedAttributes),
  }))

  const subtotalCents = (order.products || []).reduce((sum, item) => {
    return sum + Number(item.subtotalCents || 0)
  }, 0)

  const discountCents = Number(
    order.coupon?.discountAmountCents ||
    order.paymentIntent?.discountAmountCents ||
    0,
  )

  return {
    _id: order._id,
    id: order._id,
    orderNumber:
      order.idempotencyKey?.slice(-8).toUpperCase() ||
      order.paymentIntent?.id?.slice(-8).toUpperCase() ||
      order._id.toString().slice(-8).toUpperCase(),
    items,
    subtotal: Money.toDecimal(subtotalCents),
    discount: Money.toDecimal(discountCents),
    total: Money.toDecimal(order.paymentIntent?.amountCents || 0),
    shippingAddress: {
      ...order.shippingAddress,
      email:
        order.shippingAddress?.email ||
        order.customerSnapshot?.email ||
        order.paymentIntent?.payerEmail ||
        order.orderby?.email ||
        null,
    },
    customer: {
      firstName:
        order.customerSnapshot?.firstname ||
        order.customerSnapshot?.firstName ||
        order.shippingAddress?.firstName ||
        '',
      lastName:
        order.customerSnapshot?.lastname ||
        order.customerSnapshot?.lastName ||
        order.shippingAddress?.lastName ||
        '',
      email:
        order.customerSnapshot?.email ||
        order.shippingAddress?.email ||
        order.paymentIntent?.payerEmail ||
        null,
    },
    paymentMethod: order.paymentIntent?.method || null,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
  }
}

export const queuePaymentEmails = async ({
  order,
  payer,
  req,
  tenantConfig = {},
}) => {
  const buyerEmail = extractBuyerEmail({ order, payer, req })

  const adminEmail =
    normalizeEmail(tenantConfig?.adminEmail) ||
    normalizeEmail(tenantConfig?.email) ||
    normalizeEmail(tenantConfig?.settings?.store?.contactEmail) ||
    normalizeEmail(process.env.ADMIN_EMAIL) ||
    null

  const orderForEmail = buildOrderForEmail(order)

  logger.info('📧 Preparando emails de orden', {
    orderId: order?._id?.toString?.(),
    tenantId: order?.tenantId?.toString?.(),
    buyerEmail,
    adminEmail,
    hasBuyerEmail: Boolean(buyerEmail),
    hasAdminEmail: Boolean(adminEmail),
  })

  const jobs = []

  if (buyerEmail) {
    jobs.push(
      sendOrderConfirmationEmail(
        orderForEmail,
        buyerEmail,
        tenantConfig,
        {
          payer,
          user: req?.user,
        },
      )
        .then(result => ({
          type: 'customer',
          success: Boolean(result?.success),
          result,
        }))
        .catch(error => ({
          type: 'customer',
          success: false,
          error,
        })),
    )
  } else {
    logger.warn('⚠️ Email comprador no disponible', {
      orderId: order?._id?.toString?.(),
    })
  }

  if (adminEmail) {
    jobs.push(
      sendAdminNotificationEmail(
        orderForEmail,
        adminEmail,
        tenantConfig,
        {
          payer,
          user: req?.user,
        },
      )
        .then(result => ({
          type: 'admin',
          success: Boolean(result?.success),
          result,
        }))
        .catch(error => ({
          type: 'admin',
          success: false,
          error,
        })),
    )
  } else {
    logger.warn('⚠️ Email admin no disponible', {
      orderId: order?._id?.toString?.(),
    })
  }

  if (jobs.length === 0) {
    return {
      customerEmailSent: false,
      adminEmailSent: false,
      results: [],
    }
  }

  const results = await Promise.allSettled(jobs)

  const normalizedResults = results.map(result => {
    if (result.status === 'fulfilled') return result.value

    return {
      type: 'unknown',
      success: false,
      error: result.reason,
    }
  })

  normalizedResults.forEach(result => {
    if (result.success) {
      logger.info(`✅ Email enviado: ${result.type}`, {
        orderId: order?._id?.toString?.(),
        tenantId: order?.tenantId?.toString?.(),
        messageId:
          result.result?.messageId ||
          result.result?.info?.messageId ||
          null,
      })
    } else {
      logger.error(`❌ Error enviando email: ${result.type}`, {
        orderId: order?._id?.toString?.(),
        tenantId: order?.tenantId?.toString?.(),
        message:
          result.error?.message ||
          result.result?.details ||
          result.result?.error ||
          result.result?.message ||
          null,
        code: result.error?.code || result.result?.code || null,
        response: result.error?.response || result.result?.response || null,
      })
    }
  })

  const customerEmailSent = normalizedResults.some(result => {
    return result.type === 'customer' && result.success
  })

  const adminEmailSent = normalizedResults.some(result => {
    return result.type === 'admin' && result.success
  })

  order.emailSent = customerEmailSent
  order.emailSentAt = customerEmailSent ? new Date() : order.emailSentAt

  order.addAuditEntry?.({
    action: customerEmailSent || adminEmailSent ? 'email_sent' : 'email_failed',
    performedByRole: 'system',
    metadata: {
      customerEmailSent,
      adminEmailSent,
      buyerEmail,
      adminEmail,
      results: normalizedResults.map(result => ({
        type: result.type,
        success: result.success,
        message:
          result.error?.message ||
          result.result?.details ||
          result.result?.error ||
          result.result?.message ||
          null,
      })),
    },
  })

  await order.save({ tenantId: order.tenantId })

  return {
    customerEmailSent,
    adminEmailSent,
    results: normalizedResults,
  }
}

export const processPendingEmails = async () => {
  try {
    const jobs = await EmailJob.find({
      status: { $in: ['pending', 'failed'] },
      attempts: { $lt: 3 },
    })
      .sort({ createdAt: 1 })
      .limit(10)

    for (const job of jobs) {
      try {
        job.status = 'processing'
        job.attempts += 1
        await job.save()

        const order = await Order.findById(job.orderId)
          .populate('orderby', 'email firstName lastName firstname lastname')

        if (!order) {
          job.status = 'failed'
          job.error = 'Orden no encontrada'
          await job.save()
          continue
        }

        const orderForEmail = buildOrderForEmail(order)

        if (job.type === 'payment_confirmation') {
          const result = await sendOrderConfirmationEmail(
            orderForEmail,
            job.buyerEmail,
            job.tenantConfig,
          )

          if (!result?.success) {
            throw new Error(result?.error || result?.details || 'Error enviando email comprador')
          }

          job.status = 'completed'
          job.processedAt = new Date()

          await Order.updateOne(
            { _id: order._id },
            {
              $set: {
                emailSent: true,
                emailSentAt: new Date(),
              },
            },
          )
        }

        if (job.type === 'admin_notification') {
          const result = await sendAdminNotificationEmail(
            orderForEmail,
            job.tenantConfig?.adminEmail || null,
            job.tenantConfig,
          )

          if (!result?.success) {
            throw new Error(result?.error || result?.details || 'Error enviando email admin')
          }

          job.status = 'completed'
          job.processedAt = new Date()
        }

        await job.save()
      } catch (error) {
        logger.error('❌ Error procesando email job', {
          jobId: job._id?.toString?.(),
          message: getSafeErrorMessage(error),
        })

        job.status = 'failed'
        job.error = getSafeErrorMessage(error)
        await job.save()
      }
    }
  } catch (error) {
    logger.error('❌ Error en processPendingEmails', {
      message: getSafeErrorMessage(error),
    })
  }
}
