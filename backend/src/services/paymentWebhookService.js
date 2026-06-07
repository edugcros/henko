import crypto from 'node:crypto'
import mongoose from 'mongoose'

import Order from '../models/orderModel.js'
import { toObjectId } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const { Schema } = mongoose
const isProd = process.env.NODE_ENV === 'production'

const WebhookLogSchema = new Schema(
  {
    webhookId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    paymentId: {
      type: String,
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400,
    },
  },
  { timestamps: true },
)

const WebhookLog =
  mongoose.models.WebhookLog ||
  mongoose.model('WebhookLog', WebhookLogSchema)

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const parseSignatureHeader = value => {
  const result = {}

  for (const part of String(value || '').split(',')) {
    const [key, rawValue] = part.split('=', 2)
    if (!key || rawValue === undefined) continue
    result[key.trim()] = rawValue.trim()
  }

  return result
}

export const verifyMercadoPagoWebhookSignature = req => {
  const secret = sanitizeString(process.env.MP_WEBHOOK_SECRET)

  if (!secret) {
    if (isProd) {
      logger.error('❌ MP_WEBHOOK_SECRET no configurado en producción')
      return false
    }

    logger.warn('⚠️ MP_WEBHOOK_SECRET no configurado; omitiendo verificación en desarrollo')
    return true
  }

  const xSignature = req.headers['x-signature']
  const xRequestId = req.headers['x-request-id']

  const dataId =
    req.query['data.id'] ||
    req.body?.data?.id ||
    req.query.id ||
    ''

  if (!xSignature || !xRequestId || !dataId) return false

  const { ts, v1 } = parseSignatureHeader(xSignature)

  if (!ts || !v1) return false

  const normalizedDataId = String(dataId).toLowerCase()
  const manifest = `id:${normalizedDataId};request-id:${xRequestId};ts:${ts};`

  const digest = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex')

  const digestBuffer = Buffer.from(digest, 'utf8')
  const signatureBuffer = Buffer.from(String(v1), 'utf8')

  if (digestBuffer.length !== signatureBuffer.length) return false

  return crypto.timingSafeEqual(digestBuffer, signatureBuffer)
}

export const isWebhookProcessed = async webhookId => {
  const exists = await WebhookLog.exists({ webhookId })
  return Boolean(exists)
}

export const markWebhookProcessed = async (
  webhookId,
  paymentId,
  tenantId,
  orderId,
  status,
) => {
  try {
    await WebhookLog.create({
      webhookId,
      paymentId: String(paymentId),
      tenantId: toObjectId(tenantId),
      orderId: toObjectId(orderId),
      status,
    })
  } catch (error) {
    if (error.code === 11000) {
      logger.warn('Webhook ya estaba procesado', {
        webhookId,
        paymentId: String(paymentId),
      })

      return
    }

    throw error
  }
}

export const resolveWebhookOrderIdentity = async paymentId => {
  return Order.collection.findOne(
    {
      'paymentIntent.providerPaymentId': String(paymentId),
      isDeleted: false,
    },
    {
      projection: {
        _id: 1,
        tenantId: 1,
      },
    },
  )
}
