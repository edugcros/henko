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

const WebhookLog = mongoose.models.WebhookLog || mongoose.model('WebhookLog', WebhookLogSchema)

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

// QUIÉN FIRMA, Y CON QUÉ SECRETO
//
// Cada comercio cobra con SU cuenta de Mercado Pago, y la clave secreta de los
// webhooks es por aplicación: la que genera Mercado Pago en "Tus integraciones
// → Webhooks" de ESA cuenta. Validar todo contra un único MP_WEBHOOK_SECRET solo
// funciona para el comercio cuya aplicación comparte esa clave; para el resto la
// firma legítima no coincide y la notificación se descartaba.
//
// Se aceptan dos secretos, el del comercio (si lo cargó) y el global de la
// plataforma. Basta con que coincida uno. Sin ninguno configurado: en producción
// se rechaza; en desarrollo se omite la verificación.
export const verifyMercadoPagoWebhookSignature = (
  req,
  { tenantSecret = null, quiet = false } = {},
) => {
  // MERCADOPAGO_WEBHOOK_SECRET es el alias que config/env.js acepta para el
  // mismo dato. Leer solo MP_WEBHOOK_SECRET descartaba como falsas todas las
  // notificaciones de un entorno configurado con el otro nombre.
  const platformSecret = process.env.MP_WEBHOOK_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET
  const secrets = [sanitizeString(tenantSecret), sanitizeString(platformSecret)]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)

  if (!secrets.length) {
    if (isProd) {
      if (!quiet) logger.error('❌ Ningún secreto de webhook configurado en producción')
      return false
    }

    logger.warn('⚠️ MP_WEBHOOK_SECRET no configurado; omitiendo verificación en desarrollo')
    return true
  }

  const xSignature = req.headers['x-signature']
  const xRequestId = req.headers['x-request-id']

  const dataId = req.query['data.id'] || req.body?.data?.id || req.query.id || ''

  if (!xSignature || !xRequestId || !dataId) return false

  const { ts, v1 } = parseSignatureHeader(xSignature)

  if (!ts || !v1) return false

  const normalizedDataId = String(dataId).toLowerCase()
  const manifest = `id:${normalizedDataId};request-id:${xRequestId};ts:${ts};`
  const signatureBuffer = Buffer.from(String(v1), 'utf8')

  return secrets.some(secret => {
    const digest = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
    const digestBuffer = Buffer.from(digest, 'utf8')

    if (digestBuffer.length !== signatureBuffer.length) return false

    return crypto.timingSafeEqual(digestBuffer, signatureBuffer)
  })
}

/**
 * Orden y comercio que el propio backend dejó en la notification_url al crear
 * el pago (ver buildNotificationUrl).
 *
 * NO SON CONFIABLES POR SÍ SOLOS. Viajan en la query, fuera de la firma. Sirven
 * únicamente para saber DÓNDE mirar; el vínculo solo se acepta si Mercado Pago,
 * consultado con el token del comercio, confirma que ese pago lleva el
 * external_reference de esa orden y el mismo monto.
 */
export const getWebhookHints = req => {
  const orderId = sanitizeString(String(req.query?.order_id || ''))
  const tenantId = sanitizeString(String(req.query?.tenant_id || ''))

  return {
    orderId: mongoose.Types.ObjectId.isValid(orderId) ? orderId : null,
    tenantId: mongoose.Types.ObjectId.isValid(tenantId) ? tenantId : null,
  }
}

export const isWebhookProcessed = async webhookId => {
  const exists = await WebhookLog.exists({ webhookId })
  return Boolean(exists)
}

export const markWebhookProcessed = async (webhookId, paymentId, tenantId, orderId, status) => {
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

export const resolveWebhookOrderIdentity = async (
  paymentId,
  { orderId = null, tenantId = null } = {},
) => {
  const porPago = await Order.collection.findOne(
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

  if (porPago || !orderId || !tenantId) return porPago

  // SEGUNDA VÍA: LA ORDEN QUE NOMBRÓ EL PROPIO PAGO
  //
  // Si el proceso murió entre crear el pago en Mercado Pago y guardar su id, la
  // orden no tiene providerPaymentId y la búsqueda de arriba no la encuentra
  // nunca: un cobro real quedaba pendiente para siempre. La notification_url
  // lleva la orden y el comercio para poder encontrarla igual.
  return Order.collection.findOne(
    {
      _id: toObjectId(orderId),
      tenantId: toObjectId(tenantId),
      'paymentIntent.provider': 'mercadopago',
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
