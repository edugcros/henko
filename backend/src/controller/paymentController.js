// 📁 src/controller/paymentController.js
// VERSIÓN GO PRODUCCIÓN - MULTI-TENANT / MERCADO PAGO / WEBHOOK / EMAILS / STOCK / CARRITO

import crypto from 'node:crypto'
import { MercadoPagoConfig, Payment } from 'mercadopago'
import mongoose from 'mongoose'

import Order, {
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import Tenant from '../models/tenantModel.js'

import { Money } from '../utils/money.js'
import {
  sendOrderConfirmationEmail,
  sendAdminNotificationEmail,
} from '../services/emailService.js'
import logger from '../../config/logger.js'

const { Schema } = mongoose

// =====================================================
// CONSTANTES
// =====================================================

const isProd = process.env.NODE_ENV === 'production'

const CASH_METHODS = [
  'rapipago',
  'pagofacil',
  'cobroexpress',
  'redlink',
  'bapropagos',
  'cargavirtual',
  'account_money',
]

const MP_TO_DOMAIN_PAYMENT_STATUS = {
  approved: PAYMENT_STATUS.APPROVED,
  pending: PAYMENT_STATUS.PENDING,
  in_process: PAYMENT_STATUS.PENDING,
  rejected: PAYMENT_STATUS.REJECTED,
  cancelled: PAYMENT_STATUS.CANCELLED,
  refunded: PAYMENT_STATUS.REFUNDED,
}

const FINAL_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUS.APPROVED,
  PAYMENT_STATUS.REJECTED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
])

const NEGATIVE_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUS.REJECTED,
  PAYMENT_STATUS.CANCELLED,
  PAYMENT_STATUS.REFUNDED,
])

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MP_TOKEN_PLACEHOLDERS = [
  'APP_USR_TU_ACCESS_TOKEN_REAL',
  'APP_USR_ACCESS_TOKEN_REAL',
  'APP_USR_ACCESS_TOKEN_REAL_COPIADO_DESDE_MERCADO_PAGO',
  'APP URS_ACCESS_TOKEN_REAL_DEL_PANEL',
  'APP URS_PUBLIC_KEY_REAL_DEL_PANEL',
  'TU_ACCESS_TOKEN',
  'YOUR_ACCESS_TOKEN',
  'ACCESS_TOKEN_REAL',
  'REEMPLAZAR',
  'REPLACE_ME',
  'PEGAR_ACA',
]

// =====================================================
// MODELOS AUXILIARES
// =====================================================

const PaymentAttemptSchema = new Schema(
  {
    resourceKey: {
      type: String,
      required: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    attempts: {
      type: Number,
      default: 1,
    },

    lastAttemptAt: {
      type: Date,
      default: Date.now,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300,
    },
  },
  { timestamps: true },
)

PaymentAttemptSchema.index(
  { tenantId: 1, userId: 1, resourceKey: 1 },
  { unique: true },
)

const PaymentAttempt =
  mongoose.models.PaymentAttempt ||
  mongoose.model('PaymentAttempt', PaymentAttemptSchema)

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

const DistributedLockSchema = new Schema(
  {
    resource: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    tenantId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    acquiredAt: {
      type: Date,
      default: Date.now,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      expires: 120,
    },
  },
  { timestamps: true },
)

const DistributedLock =
  mongoose.models.DistributedLock ||
  mongoose.model('DistributedLock', DistributedLockSchema)

// =====================================================
// HELPERS GENERALES
// =====================================================

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const isValidEmail = value => EMAIL_REGEX.test(normalizeEmail(value))

const isValidObjectId = value => {
  return mongoose.Types.ObjectId.isValid(String(value || ''))
}

const toObjectId = value => {
  return isValidObjectId(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null
}

const getUserId = req => {
  return req.user?._id || req.user?.id || null
}

const getSafeErrorMessage = error => {
  return error?.message || 'Error inesperado'
}

const getMpTokenPrefix = token => {
  const clean = sanitizeString(token)
  if (!clean) return null
  return clean.slice(0, 14)
}

const hasPlaceholder = value => {
  const clean = sanitizeString(value).toUpperCase()

  return MP_TOKEN_PLACEHOLDERS.some(placeholder => {
    return clean.includes(placeholder.toUpperCase())
  })
}

const isValidMpAccessToken = token => {
  const clean = sanitizeString(token)

  if (!clean) return false
  if (hasPlaceholder(clean)) return false

  return clean.startsWith('APP_USR-') || clean.startsWith('APP URS-')
}

const inferMpTokenMode = token => {
  const clean = sanitizeString(token)

  if (clean.startsWith('APP_USR-')) return 'production'
  if (clean.startsWith('APP URS-')) return 'test'

  return null
}

const assertCompatibleMpMode = ({ token, tenantMode }) => {
  const tokenMode = inferMpTokenMode(token)

  if (!tokenMode) {
    const error = new Error('MP_ACCESS_TOKEN_INVALID_FORMAT')
    error.statusCode = 500
    throw error
  }

  if (tenantMode && ['test', 'production'].includes(tenantMode)) {
    if (tenantMode !== tokenMode) {
      const error = new Error(
        `MP_MODE_MISMATCH: tenant=${tenantMode}, token=${tokenMode}`,
      )
      error.statusCode = 500
      throw error
    }
  }

  return true
}

const normalizeMpStatus = status => {
  return MP_TO_DOMAIN_PAYMENT_STATUS[sanitizeString(status).toLowerCase()] || null
}

const isCashPaymentMethod = paymentMethodId => {
  const method = sanitizeString(paymentMethodId).toLowerCase()

  return CASH_METHODS.some(candidate => {
    return method.includes(candidate)
  })
}

const extractImageUrl = image => {
  if (!image) return null
  if (typeof image === 'string') return image
  if (typeof image === 'object') return image.url || image.secure_url || null
  return null
}

// =====================================================
// TENANT CONTEXT
// =====================================================

const resolveTenantContext = req => {
  const domainTenantId = req.tenantId || req.tenant?._id || null
  const userTenantId = req.user?.tenantId || req.user?.tenant?._id || null

  if (!domainTenantId || !isValidObjectId(domainTenantId)) {
    const error = new Error('TENANT_INVALIDO: No se pudo identificar el comercio')
    error.statusCode = 400
    throw error
  }

  if (userTenantId && String(userTenantId) !== String(domainTenantId)) {
    const isAdmin = ['admin', 'manager', 'superadmin'].includes(req.user?.role)
    const allowedTenants = Array.isArray(req.user?.allowedTenants)
      ? req.user.allowedTenants
      : []

    const hasAccess = allowedTenants.some(id => {
      return String(id) === String(domainTenantId)
    })

    if (!isAdmin && !hasAccess) {
      logger.warn('🚨 ACCESO CRUZADO DETECTADO', {
        userId: req.user?._id?.toString?.(),
        userEmail: req.user?.email,
        userTenantId: String(userTenantId),
        requestTenantId: String(domainTenantId),
        ip: req.ip,
      })

      const error = new Error('TENANT_MISMATCH: No tienes acceso a este comercio')
      error.statusCode = 403
      throw error
    }
  }

  return {
    tenantId: String(domainTenantId),
    tenantObjectId: toObjectId(domainTenantId),
  }
}

const getTenantConfig = async tenantId => {
  try {
    const tenant = await Tenant.findById(tenantId).lean()

    if (!tenant) {
      return {
        storeName:
          sanitizeString(process.env.STORE_NAME) ||
          sanitizeString(process.env.APP_NAME) ||
          'Tienda',
        storeLogo: sanitizeString(process.env.EMAIL_LOGO_URL) || null,
        adminEmail: normalizeEmail(process.env.ADMIN_EMAIL) || null,
        primaryColor:
          sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
          '#111827',
        currency:
          sanitizeString(process.env.DEFAULT_CURRENCY) ||
          'ARS',
      }
    }

    return {
      storeName:
        sanitizeString(tenant.name) ||
        sanitizeString(tenant.general?.storeName) ||
        sanitizeString(process.env.STORE_NAME) ||
        sanitizeString(process.env.APP_NAME) ||
        'Tienda',

      storeLogo:
        sanitizeString(tenant.settings?.branding?.logoUrl) ||
        sanitizeString(tenant.general?.logo) ||
        sanitizeString(process.env.EMAIL_LOGO_URL) ||
        null,

      adminEmail:
        normalizeEmail(tenant.adminEmail) ||
        normalizeEmail(tenant.settings?.store?.contactEmail) ||
        normalizeEmail(tenant.footer?.email) ||
        normalizeEmail(process.env.ADMIN_EMAIL) ||
        null,

      primaryColor:
        sanitizeString(tenant.settings?.branding?.primaryColor) ||
        sanitizeString(tenant.colors?.primary) ||
        sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
        '#111827',

      currency:
        sanitizeString(tenant.currency) ||
        sanitizeString(tenant.settings?.checkout?.defaultCurrency) ||
        sanitizeString(process.env.DEFAULT_CURRENCY) ||
        'ARS',

      supportEmail:
        normalizeEmail(tenant.settings?.store?.contactEmail) ||
        normalizeEmail(tenant.footer?.email) ||
        normalizeEmail(process.env.SUPPORT_EMAIL) ||
        normalizeEmail(process.env.EMAIL_FROM) ||
        normalizeEmail(process.env.EMAIL_USER) ||
        null,

      storeUrl:
        sanitizeString(tenant.primaryDomain) ||
        sanitizeString(process.env.CLIENT_URL) ||
        sanitizeString(process.env.SHOP_FRONTEND_URL) ||
        '',
    }
  } catch (error) {
    logger.error('❌ Error obteniendo config de tenant', {
      message: getSafeErrorMessage(error),
      tenantId: String(tenantId),
    })

    return {
      storeName:
        sanitizeString(process.env.STORE_NAME) ||
        sanitizeString(process.env.APP_NAME) ||
        'Tienda',
      storeLogo: sanitizeString(process.env.EMAIL_LOGO_URL) || null,
      adminEmail: normalizeEmail(process.env.ADMIN_EMAIL) || null,
      primaryColor:
        sanitizeString(process.env.EMAIL_PRIMARY_COLOR) ||
        '#111827',
      currency:
        sanitizeString(process.env.DEFAULT_CURRENCY) ||
        'ARS',
    }
  }
}

const getTenantToken = async tenantId => {
  try {
    const tenant = await Tenant.findById(tenantId)
      .select(
        '+integrations.mercadopago.accessToken integrations.mercadopago.publicKey integrations.mercadopago.isEnabled integrations.mercadopago.mode',
      )
      .lean()

    const mercadoPago = tenant?.integrations?.mercadopago || {}

    const tenantToken = sanitizeString(mercadoPago.accessToken)
    const envToken = sanitizeString(process.env.MP_ACCESS_TOKEN)

    const tenantTokenIsValid = isValidMpAccessToken(tenantToken)
    const envTokenIsValid = isValidMpAccessToken(envToken)

    logger.info('🔐 Resolviendo token Mercado Pago', {
      tenantId: tenant?._id?.toString?.() || null,
      mpEnabled: Boolean(mercadoPago.isEnabled),
      mpMode: mercadoPago.mode || null,
      hasTenantToken: tenantTokenIsValid,
      tenantTokenPrefix: tenantTokenIsValid ? getMpTokenPrefix(tenantToken) : null,
      hasEnvToken: envTokenIsValid,
      envTokenPrefix: envTokenIsValid ? getMpTokenPrefix(envToken) : null,
      nodeEnv: process.env.NODE_ENV,
    })

    if (mercadoPago.isEnabled && tenantToken) {
      if (!tenantTokenIsValid) {
        const error = new Error(
          'Mercado Pago del tenant tiene un Access Token inválido o placeholder',
        )
        error.statusCode = 500
        throw error
      }

      assertCompatibleMpMode({
        token: tenantToken,
        tenantMode: mercadoPago.mode,
      })

      return tenantToken
    }

    if (!isProd && envTokenIsValid) {
      logger.warn('⚠️ Usando MP_ACCESS_TOKEN global por fallback en desarrollo', {
        tenantId: tenant?._id?.toString?.() || null,
        envTokenPrefix: getMpTokenPrefix(envToken),
      })

      return envToken
    }

    const error = new Error('Mercado Pago no está configurado para este comercio')
    error.statusCode = 400
    throw error
  } catch (error) {
    logger.error('❌ Error obteniendo token Mercado Pago', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
      statusCode: error.statusCode,
    })

    return null
  }
}

// =====================================================
// CLIENTE MERCADO PAGO
// =====================================================

const createMercadoPagoPaymentClient = accessToken => {
  if (!isValidMpAccessToken(accessToken)) {
    const error = new Error('MP_ACCESS_TOKEN_INVALID')
    error.statusCode = 500
    throw error
  }

  const client = new MercadoPagoConfig({
    accessToken,
    options: {
      timeout: 15000,
    },
  })

  return new Payment(client)
}

// =====================================================
// CARRITO / STOCK
// =====================================================

const validateCartBelongsToTenant = async (cartId, userId, tenantId) => {
  const cart = await Cart.findOne({
    _id: toObjectId(cartId),
    userId: toObjectId(userId),
    tenantId: toObjectId(tenantId),
    isDeleted: false,
  }).populate('products.productId', 'tenantId title price images currency quantity stock')

  if (!cart) {
    throw new Error('CARRITO_NO_ENCONTRADO')
  }

  if (!cart.products?.length) {
    throw new Error('CARRITO_VACIO')
  }

  for (const item of cart.products) {
    const product = item.productId

    if (!product) {
      throw new Error(`PRODUCTO_NO_ENCONTRADO: ${item.productId}`)
    }

    const productTenantId = product.tenantId || item.tenantId

    if (productTenantId && String(productTenantId) !== String(tenantId)) {
      logger.error('🚨 PRODUCTO_CROSS_TENANT', {
        productId: product._id?.toString?.(),
        productTenantId: String(productTenantId),
        cartTenantId: String(tenantId),
      })

      throw new Error('PRODUCTO_INVALIDO: Producto no pertenece a este comercio')
    }
  }

  return cart
}

const reserveStockAtomic = async (products, tenantId) => {
  const reservedProducts = []

  try {
    for (const item of products || []) {
      const result = await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: toObjectId(tenantId),
          isDeleted: false,
          quantity: { $gte: item.count },
        },
        {
          $inc: {
            quantity: -item.count,
            reserved: item.count,
          },
        },
        { new: true },
      )

      if (!result) {
        for (const reserved of reservedProducts) {
          await Product.findOneAndUpdate(
            {
              _id: reserved.productId,
              tenantId: toObjectId(tenantId),
              reserved: { $gte: reserved.count },
            },
            {
              $inc: {
                quantity: reserved.count,
                reserved: -reserved.count,
              },
            },
          )
        }

        throw new Error(`STOCK_INSUFFICIENT: ${item.titleSnapshot || item.product}`)
      }

      reservedProducts.push({
        productId: item.product,
        count: item.count,
      })
    }

    return true
  } catch (error) {
    logger.error('❌ Error reservando stock', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    throw error
  }
}

const releaseReservedStock = async (products, tenantId) => {
  try {
    for (const item of products || []) {
      const result = await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: toObjectId(tenantId),
          reserved: { $gte: item.count },
        },
        {
          $inc: {
            quantity: item.count,
            reserved: -item.count,
          },
        },
        { new: true },
      )

      if (!result) {
        logger.warn('⚠️ No se pudo liberar stock reservado', {
          tenantId: String(tenantId),
          productId: item.product?.toString?.() || String(item.product),
          count: item.count,
        })
      }
    }

    logger.info('✅ Stock liberado', {
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error liberando stock', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })
  }
}

const confirmSoldStock = async (products, tenantId) => {
  try {
    for (const item of products || []) {
      const result = await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: toObjectId(tenantId),
          reserved: { $gte: item.count },
        },
        {
          $inc: {
            reserved: -item.count,
            sold: item.count,
          },
        },
        { new: true },
      )

      if (!result) {
        logger.warn('⚠️ No se pudo confirmar stock vendido', {
          tenantId: String(tenantId),
          productId: item.product?.toString?.() || String(item.product),
          count: item.count,
        })
      }
    }

    logger.info('✅ Stock confirmado como vendido', {
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error confirmando venta', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    throw error
  }
}

const clearUserCartAfterApprovedPayment = async ({ userId, tenantId }) => {
  try {
    await Cart.deleteOne({
      userId: toObjectId(userId),
      tenantId: toObjectId(tenantId),
    })

    logger.info('🧹 Carrito limpiado tras pago aprobado', {
      userId: String(userId),
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error limpiando carrito post-pago', {
      userId: String(userId),
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })
  }
}

// =====================================================
// RATE LIMIT / LOCK
// =====================================================

const checkPaymentRateLimit = async (resourceKey, userId, tenantId) => {
  try {
    const attempt = await PaymentAttempt.findOneAndUpdate(
      {
        tenantId: toObjectId(tenantId),
        userId: toObjectId(userId),
        resourceKey: sanitizeString(resourceKey, 'unknown'),
      },
      {
        $inc: { attempts: 1 },
        $set: {
          lastAttemptAt: new Date(),
          tenantId: toObjectId(tenantId),
          userId: toObjectId(userId),
          resourceKey: sanitizeString(resourceKey, 'unknown'),
        },
      },
      {
        upsert: true,
        new: true,
      },
    )

    if (attempt.attempts > 5) {
      const timeSinceLastAttempt = Date.now() - attempt.lastAttemptAt.getTime()
      const waitTime = Math.max(0, 300000 - timeSinceLastAttempt)

      if (waitTime > 0) {
        const error = new Error(
          `RATE_LIMIT_EXCEEDED: Espera ${Math.ceil(waitTime / 1000)} segundos`,
        )
        error.statusCode = 429
        throw error
      }

      await PaymentAttempt.updateOne(
        { _id: attempt._id },
        {
          $set: {
            attempts: 1,
            lastAttemptAt: new Date(),
          },
        },
      )
    }

    return attempt.attempts
  } catch (error) {
    if (error.message?.includes('RATE_LIMIT_EXCEEDED')) {
      throw error
    }

    logger.error('❌ Error en rate limiting', {
      message: getSafeErrorMessage(error),
      tenantId: String(tenantId),
      resourceKey: String(resourceKey),
    })

    return 1
  }
}

const acquirePaymentLock = async (resourceId, tenantId, ttlSeconds = 60) => {
  const resource = `payment:${String(resourceId)}`
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  try {
    await DistributedLock.create({
      resource,
      tenantId: toObjectId(tenantId),
      expiresAt,
    })

    return true
  } catch (error) {
    if (error.code === 11000) {
      logger.warn('🔒 Lock ya existe para pago', {
        resource,
        tenantId: String(tenantId),
      })

      return false
    }

    throw error
  }
}

const releasePaymentLock = async resourceId => {
  const resource = `payment:${String(resourceId)}`

  try {
    await DistributedLock.deleteOne({ resource })
  } catch (error) {
    logger.error('❌ Error liberando lock de pago', {
      resource,
      message: getSafeErrorMessage(error),
    })
  }
}

// =====================================================
// EMAILS
// =====================================================

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

    customerSnapshot: order.customerSnapshot,
    paymentIntent: order.paymentIntent,
    currency: order.paymentIntent?.currency || 'ARS',
    status: order.orderStatus,
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
  }
}

const queuePaymentEmails = async ({
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

// =====================================================
// ORDEN DESDE CARRITO
// =====================================================

const createOrderFromCart = async (cartId, userId, tenantId, shippingAddress = {}) => {
  const cart = await validateCartBelongsToTenant(cartId, userId, tenantId)

  let subtotalCents = 0

  const orderProducts = []

  for (const item of cart.products) {
    const product = item.productId
    const priceCents = Money.fromDecimal(product.price)
    const itemSubtotal = Money.multiply(priceCents, item.quantity)

    subtotalCents += itemSubtotal

    orderProducts.push({
      product: product._id,
      count: item.quantity,
      priceCents,
      subtotalCents: itemSubtotal,
      titleSnapshot: product.title,
      imageSnapshot: extractImageUrl(product.images?.[0]),
      tenantId: toObjectId(tenantId),
      originalPriceCents: priceCents,
      originalSubtotalCents: itemSubtotal,
      discountPercentage: 0,
      currency: cart.currency || product.currency || 'ARS',
    })
  }

  const order = new Order({
    tenantId: toObjectId(tenantId),
    idempotencyKey: crypto.randomUUID(),
    orderby: toObjectId(userId),

    products: orderProducts,

    paymentIntent: {
      id: crypto.randomUUID(),
      provider: 'mercadopago',
      status: PAYMENT_STATUS.PENDING,
      currency: cart.currency || 'ARS',
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

  // Importante:
  // No borrar carrito acá. El carrito se limpia SOLO cuando Mercado Pago aprueba.
  return order
}

const applyMercadoPagoStatusToOrder = ({
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

  order.paymentStatus = normalizedPaymentStatus
  order.paymentIntent.status = normalizedPaymentStatus

  if (providerPaymentId) {
    order.paymentIntent.providerPaymentId = String(providerPaymentId)
  }

  if (providerRawStatus || mpStatus) {
    order.paymentIntent.providerRawStatus = sanitizeString(providerRawStatus || mpStatus)
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

// =====================================================
// MERCADO PAGO HELPERS
// =====================================================

const validateInstallments = (installments, paymentMethodId) => {
  if (isCashPaymentMethod(paymentMethodId)) return 1

  let parsed = Number.parseInt(installments, 10)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    parsed = 1
  }

  if (parsed > 12) {
    logger.warn('Installments mayor a 12, limitando', {
      installments: parsed,
    })

    parsed = 12
  }

  return parsed
}

const isPublicNotificationUrl = value => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()

    const isLocalDomain =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.test')

    return url.protocol === 'https:' && !isLocalDomain
  } catch {
    return false
  }
}

const buildNotificationUrl = () => {
  const publicBackendUrl = sanitizeString(
    process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL,
  ).replace(/\/+$/, '')

  if (!isPublicNotificationUrl(publicBackendUrl)) {
    logger.warn(
      '⚠️ notification_url omitida: falta PUBLIC_BACKEND_URL HTTPS pública para Mercado Pago',
    )

    return null
  }

  const apiPrefix = `/${sanitizeString(process.env.API_PREFIX, '/api').replace(
    /^\/+|\/+$/g,
    '',
  )}`

  return `${publicBackendUrl}${apiPrefix}/payments/webhook/mercadopago?source_news=webhooks`
}

const getStatusMessage = status => {
  const messages = {
    approved: 'Pago aprobado exitosamente',
    pending: 'Pago pendiente de confirmación',
    in_process: 'Pago en proceso',
    rejected: 'Pago rechazado',
    cancelled: 'Pago cancelado',
    refunded: 'Pago reembolsado',
  }

  return messages[status] || 'Estado desconocido'
}

const buildMercadoPagoPaymentData = ({
  order,
  userId,
  tenantId,
  token,
  paymentMethodId,
  installments,
  issuerId,
  payer,
}) => {
  const amountCents = Number(order.paymentIntent?.amountCents || 0)

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    const error = new Error('INVALID_ORDER_AMOUNT')
    error.statusCode = 400
    throw error
  }

  const transactionAmount = Money.toDecimal(amountCents)
  const validatedInstallments = validateInstallments(installments, paymentMethodId)

  const payerEmail = normalizeEmail(payer.email)

  if (!payerEmail || !isValidEmail(payerEmail)) {
    const error = new Error('PAYER_EMAIL_INVALID')
    error.statusCode = 400
    throw error
  }

  const paymentData = {
    transaction_amount: Number(transactionAmount),
    token: sanitizeString(token),
    description: `Orden #${order._id}`,
    installments: Number(validatedInstallments),
    payment_method_id: sanitizeString(paymentMethodId).toLowerCase(),

    payer: {
      email: payerEmail,
      identification: {
        type: sanitizeString(payer.identification?.type, 'DNI'),
        number: String(payer.identification?.number || '')
          .replace(/\D/g, '')
          .slice(0, 20),
      },
    },

    external_reference: order._id.toString(),

    metadata: {
      order_id: order._id.toString(),
      user_id: userId.toString(),
      tenant_id: tenantId.toString(),
    },
  }

  const issuerNum = Number(issuerId)

  if (
    issuerId &&
    issuerId !== 'undefined' &&
    issuerId !== 'null' &&
    Number.isFinite(issuerNum) &&
    issuerNum > 0
  ) {
    paymentData.issuer_id = issuerNum
  }

  const notificationUrl = buildNotificationUrl()

  if (notificationUrl) {
    paymentData.notification_url = notificationUrl
  }

  return {
    paymentData,
    transactionAmount,
    validatedInstallments,
  }
}

// =====================================================
// ERROR HANDLING
// =====================================================

const mapMercadoPagoError = error => {
  const rawMessage = String(error?.message || '').toLowerCase()
  const cause = Array.isArray(error?.cause) ? error.cause : []

  const causeText = cause
    .map(item => String(item?.description || '').toLowerCase())
    .join(' | ')

  const combined = `${rawMessage} ${causeText}`
  const status = Number(error?.status || error?.statusCode || 400)

  if (
    combined.includes('invalid access token') ||
    combined.includes('access_token') ||
    combined.includes('must provide your access_token') ||
    combined.includes('unauthorized use of live credentials') ||
    status === 401
  ) {
    return {
      status: 503,
      code: 'MP_ACCESS_TOKEN_INVALID',
      message: 'Mercado Pago no está configurado correctamente para este comercio.',
      details: 'El Access Token del backend es inválido, vencido o no pertenece a esta integración.',
    }
  }

  if (
    combined.includes('invalid card token') ||
    combined.includes('card token') ||
    combined.includes('card_token') ||
    combined.includes('token not found') ||
    combined.includes('token already used')
  ) {
    return {
      status: 400,
      code: 'CARD_TOKEN_INVALID',
      message: 'TOKEN_INVALIDO',
      details: 'Error con el token de tarjeta. Genera un nuevo intento de pago.',
    }
  }

  if (combined.includes('security_code') || combined.includes('cvv')) {
    return {
      status: 400,
      code: 'CARD_CVV_INVALID',
      message: 'Código de seguridad inválido.',
      details: 'Verifica el CVV de la tarjeta.',
    }
  }

  if (combined.includes('insufficient_amount') || combined.includes('amount')) {
    return {
      status: 400,
      code: 'PAYMENT_AMOUNT_INVALID',
      message: 'Monto de pago inválido.',
      details: error?.message || 'Mercado Pago rechazó el monto enviado.',
    }
  }

  return {
    status: 400,
    code: 'PAYMENT_ERROR',
    message: 'No se pudo procesar el pago.',
    details: error?.message || 'Error desconocido del proveedor de pagos.',
  }
}

// =====================================================
// WEBHOOK SECURITY
// =====================================================

const parseSignatureHeader = value => {
  const result = {}

  for (const part of String(value || '').split(',')) {
    const [key, rawValue] = part.split('=', 2)
    if (!key || rawValue === undefined) continue
    result[key.trim()] = rawValue.trim()
  }

  return result
}

const verifyMercadoPagoWebhookSignature = req => {
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

const isWebhookProcessed = async webhookId => {
  const exists = await WebhookLog.exists({ webhookId })
  return Boolean(exists)
}

const markWebhookProcessed = async (webhookId, paymentId, tenantId, orderId, status) => {
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

const resolveWebhookOrderIdentity = async paymentId => {
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

// =====================================================
// CONTROLLER: PROCESS PAYMENT
// =====================================================

export const processPayment = async (req, res) => {
  const {
    orderId: bodyOrderId,
    cartId: bodyCartId,
    token,
    payment_method_id: paymentMethodId,
    installments,
    payer,
    issuer_id: issuerId,
    shippingAddress,
  } = req.body || {}

  const orderId = bodyOrderId || null
  const cartId = bodyCartId || null
  const lockResourceId = orderId || cartId || crypto.randomUUID()

  let order = null
  let tenantId = null
  let stockReserved = false
  let lockAcquired = false

  try {
    const userId = getUserId(req)
    const tenantContext = resolveTenantContext(req)
    tenantId = tenantContext.tenantId

    if (!userId || !isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_AUTHENTICATED',
        message: 'Usuario no autenticado',
      })
    }

    await checkPaymentRateLimit(lockResourceId, userId, tenantId)

    lockAcquired = await acquirePaymentLock(lockResourceId, tenantId)

    if (!lockAcquired) {
      return res.status(409).json({
        success: false,
        code: 'PAYMENT_IN_PROGRESS',
        message: 'Ya hay un pago en proceso para esta orden.',
      })
    }

    if (!token || !paymentMethodId) {
      return res.status(400).json({
        success: false,
        code: 'PAYMENT_DATA_INCOMPLETE',
        message: 'Datos de pago incompletos',
      })
    }

    if (!payer?.email || !isValidEmail(payer.email)) {
      return res.status(400).json({
        success: false,
        code: 'PAYER_EMAIL_INVALID',
        message: 'Email del pagador inválido',
      })
    }

    if (String(token).trim().length < 10) {
      return res.status(400).json({
        success: false,
        code: 'CARD_TOKEN_INVALID',
        message: 'Token de tarjeta inválido',
      })
    }

    const tenantConfig = await getTenantConfig(tenantId)
    const mpToken = await getTenantToken(tenantId)

    if (!mpToken) {
      return res.status(503).json({
        success: false,
        code: 'MP_CREDENTIALS_NOT_FOUND',
        message: 'Mercado Pago no está configurado correctamente para este comercio.',
      })
    }

    if (cartId && !orderId) {
      order = await createOrderFromCart(cartId, userId, tenantId, shippingAddress)

      logger.info('🛒 Orden creada desde carrito', {
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
      })
    } else if (orderId && isValidObjectId(orderId)) {
      order = await Order.findOne({
        _id: toObjectId(orderId),
        orderby: toObjectId(userId),
        tenantId: toObjectId(tenantId),
        isDeleted: false,
      })
        .setOptions({ tenantId })
        .populate('orderby', 'email firstname lastname firstName lastName')

      if (!order) {
        return res.status(404).json({
          success: false,
          code: 'ORDER_NOT_FOUND',
          message: 'Orden no encontrada',
        })
      }
    } else {
      return res.status(400).json({
        success: false,
        code: 'ORDER_ID_OR_CART_ID_REQUIRED',
        message: 'Debe enviarse orderId o cartId',
      })
    }

    if (order.paymentStatus === PAYMENT_STATUS.APPROVED) {
      return res.status(409).json({
        success: false,
        code: 'ORDER_ALREADY_PAID',
        message: 'La orden ya fue pagada',
      })
    }

    await reserveStockAtomic(order.products, tenantId)
    stockReserved = true

    const {
      paymentData,
      transactionAmount,
      validatedInstallments,
    } = buildMercadoPagoPaymentData({
      order,
      userId,
      tenantId,
      token,
      paymentMethodId,
      installments,
      issuerId,
      payer,
    })

    logger.info('🚀 Enviando pago a Mercado Pago', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      transactionAmount,
      paymentMethodId: paymentData.payment_method_id,
      installments: paymentData.installments,
      payerEmail: paymentData.payer?.email,
      hasNotificationUrl: Boolean(paymentData.notification_url),
    })

    const payment = createMercadoPagoPaymentClient(mpToken)

    const mpPayment = await payment.create({
      body: paymentData,
      requestOptions: {
        idempotencyKey: `${tenantId}_${order._id}_${order.paymentIntent?.id}`,
      },
    })

    logger.info('✅ Mercado Pago respondió', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      mpPaymentId: mpPayment.id,
      mpStatus: mpPayment.status,
      statusDetail: mpPayment.status_detail,
    })

    applyMercadoPagoStatusToOrder({
      order,
      mpStatus: mpPayment.status,
      providerPaymentId: mpPayment.id,
      paymentMethodId,
      installments: validatedInstallments,
      payerEmail: payer.email,
      statusDetail: mpPayment.status_detail,
      providerRawStatus: mpPayment.status,
    })

    const normalizedPaymentStatus = order.paymentStatus

    if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED) {
      await confirmSoldStock(order.products, tenantId)
      stockReserved = false
    } else if (NEGATIVE_PAYMENT_STATUSES.has(normalizedPaymentStatus)) {
      await releaseReservedStock(order.products, tenantId)
      stockReserved = false
    } else {
      // pending / in_process: mantenemos reserva para resolver vía webhook/job.
      stockReserved = false
    }

    await order.save({ tenantId })

    if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED) {
      await clearUserCartAfterApprovedPayment({
        userId,
        tenantId,
      })

      const emailResult = await queuePaymentEmails({
        order,
        payer,
        req,
        tenantConfig,
      })

      logger.info('📧 Resultado emails post-pago', {
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
        customerEmailSent: emailResult.customerEmailSent,
        adminEmailSent: emailResult.adminEmailSent,
      })
    }

    return res.status(200).json({
      success: true,
      status: mpPayment.status,
      id: mpPayment.id,
      status_detail: mpPayment.status_detail,
      message: getStatusMessage(mpPayment.status),
      amount: transactionAmount,
      installments: validatedInstallments,
      orderId: order._id,
      paymentStatus: order.paymentStatus,
      emailQueued: normalizedPaymentStatus === PAYMENT_STATUS.APPROVED,
    })
  } catch (error) {
    if (stockReserved && order) {
      await releaseReservedStock(order.products, tenantId)
      stockReserved = false
    }

    logger.error('❌ PAYMENT ERROR DETALLADO', {
      message: error.message,
      name: error.name,
      status: error.status,
      statusCode: error.statusCode,
      cause: error.cause,
      code: error.code,
      api_response: error.api_response,
      response: error.response,
      tenantId: tenantId ? String(tenantId) : null,
      orderId: order?._id?.toString?.() || bodyOrderId || null,
    })

    if (order && order.paymentStatus !== PAYMENT_STATUS.APPROVED) {
      try {
        const mappedError = mapMercadoPagoError(error)

        order.paymentError = getSafeErrorMessage(error)
        order.paymentErrorCode = mappedError.code
        order.lastPaymentAttemptAt = new Date()

        await order.save({ tenantId: order.tenantId })
      } catch (saveError) {
        logger.error('❌ Error guardando estado de error', {
          message: getSafeErrorMessage(saveError),
          orderId: order?._id?.toString?.(),
        })
      }
    }

    const mappedError = mapMercadoPagoError(error)

    return res.status(mappedError.status).json({
      success: false,
      code: mappedError.code,
      message: mappedError.message,
      details: mappedError.details,
      debug: isProd
        ? undefined
        : {
          originalMessage: error.message,
          status: error.status || error.statusCode,
          cause: error.cause,
          apiResponse: error.api_response,
          response: error.response,
        },
    })
  } finally {
    if (lockAcquired) {
      await releasePaymentLock(lockResourceId)
    }
  }
}

// =====================================================
// CONTROLLER: WEBHOOK
// =====================================================

export const mpWebhook = async (req, res) => {
  res.status(200).end()

  try {
    if (!verifyMercadoPagoWebhookSignature(req)) {
      logger.warn('⚠️ Webhook Mercado Pago con firma inválida')
      return
    }

    const paymentId =
      req.body?.data?.id ||
      req.query['data.id'] ||
      req.query.id

    if (!paymentId) {
      logger.warn('⚠️ Webhook sin paymentId')
      return
    }

    const webhookId = `mp_${paymentId}`

    if (await isWebhookProcessed(webhookId)) {
      logger.info('Webhook ya procesado, ignorando', {
        webhookId,
        paymentId: String(paymentId),
      })
      return
    }

    const rawIdentity = await resolveWebhookOrderIdentity(paymentId)

    if (!rawIdentity?._id || !rawIdentity?.tenantId) {
      logger.warn('⚠️ Webhook: orden no encontrada para pago', {
        paymentId: String(paymentId),
      })
      return
    }

    const tenantId = String(rawIdentity.tenantId)

    const order = await Order.findOne({
      _id: rawIdentity._id,
      tenantId: toObjectId(tenantId),
      isDeleted: false,
    }).setOptions({ tenantId })

    if (!order) {
      logger.warn('⚠️ Webhook: orden tenant-scoped no encontrada', {
        paymentId: String(paymentId),
        tenantId,
      })

      return
    }

    if (String(order.paymentIntent?.providerPaymentId || '') !== String(paymentId)) {
      logger.warn('🚨 Webhook providerPaymentId mismatch', {
        paymentId: String(paymentId),
        orderId: order._id?.toString?.(),
      })

      return
    }

    if (
      FINAL_PAYMENT_STATUSES.has(order.paymentStatus) &&
      String(order.paymentIntent?.providerPaymentId || '') === String(paymentId)
    ) {
      await markWebhookProcessed(
        webhookId,
        paymentId,
        tenantId,
        order._id,
        order.paymentStatus,
      )

      logger.info('Webhook: pago ya finalizado', {
        paymentId: String(paymentId),
        orderId: order._id?.toString?.(),
        status: order.paymentStatus,
      })

      return
    }

    const mpToken = await getTenantToken(tenantId)

    if (!mpToken) {
      logger.error('❌ Webhook: token de Mercado Pago no encontrado', {
        tenantId,
        paymentId: String(paymentId),
      })

      return
    }

    const payment = createMercadoPagoPaymentClient(mpToken)
    const mpInfo = await payment.get({ id: paymentId })

    if (!mpInfo?.status) {
      logger.warn('⚠️ Webhook: pago sin estado', {
        paymentId: String(paymentId),
      })

      return
    }

    const previousStatus = order.paymentStatus

    applyMercadoPagoStatusToOrder({
      order,
      mpStatus: mpInfo.status,
      providerPaymentId: paymentId,
      paymentMethodId: mpInfo.payment_method_id || order.paymentIntent?.method,
      installments: mpInfo.installments ?? order.paymentIntent?.installments,
      payerEmail: mpInfo.payer?.email || order.paymentIntent?.payerEmail,
      statusDetail: mpInfo.status_detail,
      providerRawStatus: mpInfo.status,
    })

    if (
      previousStatus !== PAYMENT_STATUS.APPROVED &&
      order.paymentStatus === PAYMENT_STATUS.APPROVED
    ) {
      await confirmSoldStock(order.products, tenantId)

      await order.save({ tenantId })

      await clearUserCartAfterApprovedPayment({
        userId: order.orderby,
        tenantId,
      })

      const tenantConfig = await getTenantConfig(tenantId)

      await queuePaymentEmails({
        order,
        payer: { email: order.paymentIntent?.payerEmail },
        req: {},
        tenantConfig,
      })
    } else if (
      previousStatus === PAYMENT_STATUS.PENDING &&
      NEGATIVE_PAYMENT_STATUSES.has(order.paymentStatus)
    ) {
      await releaseReservedStock(order.products, tenantId)
      await order.save({ tenantId })
    } else {
      await order.save({ tenantId })
    }

    await markWebhookProcessed(
      webhookId,
      paymentId,
      tenantId,
      order._id,
      mpInfo.status,
    )

    logger.info('Webhook: orden actualizada', {
      orderId: order._id?.toString?.(),
      paymentId: String(paymentId),
      previousStatus,
      newStatus: order.paymentStatus,
    })
  } catch (error) {
    logger.error('❌ Webhook Error Mercado Pago', {
      message: getSafeErrorMessage(error),
      stack: error.stack,
    })
  }
}

// =====================================================
// CONTROLLER: GET PAYMENT STATUS
// =====================================================

export const getPaymentStatus = async (req, res) => {
  try {
    const userId = getUserId(req)

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'No autorizado',
      })
    }

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const { orderId } = req.params

    if (!isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'ID inválido',
      })
    }

    const order = await Order.findOne({
      _id: toObjectId(orderId),
      tenantId: tenantObjectId,
      orderby: toObjectId(userId),
      isDeleted: false,
    }).setOptions({ tenantId })

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Orden no encontrada',
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        status: order.paymentStatus,
        orderStatus: order.orderStatus,
        provider: order.paymentIntent?.provider,
        providerPaymentId: order.paymentIntent?.providerPaymentId,
        amount: Money.toDecimal(order.paymentIntent?.amountCents || 0),
        paidAt: order.paidAt,
        paymentError: order.paymentError || null,
        paymentErrorCode: order.paymentErrorCode || null,
        emailSent: Boolean(order.emailSent),
        emailSentAt: order.emailSentAt || null,
      },
    })
  } catch (error) {
    logger.error('Error getPaymentStatus', {
      message: getSafeErrorMessage(error),
    })

    return res.status(error.statusCode || 500).json({
      success: false,
      message: getSafeErrorMessage(error),
    })
  }
}

// =====================================================
// EXPORT DEFAULT
// =====================================================

export default {
  processPayment,
  mpWebhook,
  getPaymentStatus,
  processPendingEmails,
}