// 📁 src/controller/orderCtrl.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / MERCADO PAGO SAFE / VARIANTES / CUPONES / SNAPSHOTS

import mongoose from 'mongoose'
import expressAsyncHandler from 'express-async-handler'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'

import {
  sendOrderConfirmationEmail,
  sendAdminNotificationEmail,
} from '../services/emailService.js'
import { resolveCartPricing } from '../services/cartPricingService.js'

import Order, {
  PAYMENT_STATUS,
  FULFILLMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import Coupon from '../models/couponModel.js'
import CouponUsage from '../models/CouponUsageModel.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'

import logger from '../../config/logger.js'

// =====================================================
// CONSTANTES
// =====================================================

export const LEGACY_ORDER_STATUS = {
  PAYMENT_PENDING: 'payment_pending',
  NOT_PROCESSED: 'not_processed',
  PROCESSING: 'processing',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
}

const ALLOWED_CURRENCIES = ['ARS', 'USD', 'EUR']
const MAX_ORDER_LINES = 100
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// =====================================================
// MONEY
// =====================================================

const Money = {
  fromDecimal: amount => {
    const num = Number(amount)

    if (!Number.isFinite(num) || num < 0) {
      throw new Error(`Monto inválido: ${amount}`)
    }

    return Math.round(num * 100)
  },

  toDecimal: cents => {
    const num = Number(cents)
    if (!Number.isFinite(num)) return 0
    return Number((num / 100).toFixed(2))
  },

  multiply: (cents, quantity) => Math.round(Number(cents) * Number(quantity)),
}

// =====================================================
// HELPERS BÁSICOS
// =====================================================

const isProd = process.env.NODE_ENV === 'production'
const isValidId = id => mongoose.Types.ObjectId.isValid(String(id || ''))

const normalizeObjectId = value => {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  if (!isValidId(value)) return null
  return new mongoose.Types.ObjectId(String(value))
}

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => String(value || '').trim().toLowerCase()

const validateEmailOrThrow = email => {
  const normalized = normalizeEmail(email)

  if (!EMAIL_REGEX.test(normalized)) {
    throw new Error('Email inválido')
  }

  return normalized
}

const safeDate = value => {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getUserIdFromRequest = req => {
  const userId = req.user?.id || req.user?._id || null
  return userId && isValidId(userId) ? String(userId) : null
}

const toSafePage = value => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const toSafeLimit = (value, fallback = 20) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, 100)
}

const escapeRegex = value => {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const mapToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const findVariant = ({ product, cartItem }) => {
  if (!product?.hasVariants) return null

  const variantIdentifier =
    cartItem.variantId ||
    cartItem.selectedVariant?.id ||
    cartItem.variantSku ||
    cartItem.variantSKU ||
    null

  if (!variantIdentifier) return null

  return (
    product.variants?.find(variant => {
      return (
        String(variant._id) === String(variantIdentifier) ||
        String(variant.id) === String(variantIdentifier) ||
        String(variant.key) === String(variantIdentifier) ||
        String(variant.sku) === String(variantIdentifier)
      )
    }) || null
  )
}

const getProductImageUrl = product => {
  return (
    product?.images?.find?.(image => image?.isMain)?.url ||
    product?.images?.[0]?.url ||
    null
  )
}

const getVariantImageUrl = variant => variant?.image?.url || null

const serializeLineForCouponUsage = line => ({
  product: line.product,
  titleSnapshot: line.titleSnapshot,
  variantId: line.variantId,
  variantKey: line.variantKey,
  selectedAttributes: mapToObject(line.selectedAttributes),
  originalPriceCents: line.originalPriceCents,
  discountedPriceCents: line.priceCents,
  quantity: line.count,
})

// =====================================================
// RATE LIMITER POR TENANT
// =====================================================

export const orderWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: req => (['admin', 'manager'].includes(req.user?.role) ? 100 : 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const userId = req.user?.id || req.user?._id || 'anonymous'
    const tenantId = req.user?.tenantId || req.tenantId || 'no-tenant'
    return `${userId}:${tenantId}`
  },
  message: {
    success: false,
    message: 'Demasiadas solicitudes. Intentá en 1 minuto.',
  },
})

// =====================================================
// HELPERS MULTI-TENANT
// =====================================================

const resolveTenantContext = req => {
  const userTenantId = req.user?.tenantId ? String(req.user.tenantId) : null
  const domainTenantId = req.tenantId ? String(req.tenantId) : null

  if (!userTenantId || !isValidId(userTenantId)) {
    const error = new Error('El usuario autenticado no tiene tenantId válido')
    error.statusCode = 401
    throw error
  }

  if (!domainTenantId || !isValidId(domainTenantId)) {
    const error = new Error('Tenant no resuelto por dominio')
    error.statusCode = 400
    throw error
  }

  if (userTenantId !== domainTenantId) {
    logger.warn(
      `🚨 Tenant mismatch | user=${req.user?.id || req.user?._id} | userTenant=${userTenantId} | domainTenant=${domainTenantId} | ip=${req.ip} | endpoint=${req.method} ${req.originalUrl}`,
    )

    const error = new Error('Tenant inconsistente entre usuario autenticado y dominio')
    error.statusCode = 403
    throw error
  }

  return {
    tenantId: userTenantId,
    tenantObjectId: new mongoose.Types.ObjectId(userTenantId),
  }
}

const validateUserTenantMembership = async ({
  userId,
  tenantId,
  session = null,
}) => {
  const [user, tenant] = await Promise.all([
    User.findOne({
      _id: normalizeObjectId(userId),
      tenantId: normalizeObjectId(tenantId),
      isBlocked: { $ne: true },
    })
      .session(session)
      .lean(),

    Tenant.findOne({
      _id: normalizeObjectId(tenantId),
      status: 'active',
    })
      .session(session)
      .lean(),
  ])

  if (!user) {
    const error = new Error('Usuario no autorizado en este comercio')
    error.statusCode = 403
    throw error
  }

  if (!tenant) {
    const error = new Error('Comercio no disponible temporalmente')
    error.statusCode = 403
    throw error
  }

  return { user, tenant }
}

const ensureAdminOrManager = req => {
  const role = req.user?.role

  if (!['admin', 'manager'].includes(role)) {
    const error = new Error('Permisos insuficientes')
    error.statusCode = 403
    throw error
  }
}

// =====================================================
// TRANSACCIONES
// =====================================================

const isTransactionUnsupportedError = error => {
  const message = String(error?.message || '')

  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('replica set') ||
    message.includes('mongos')
  )
}

const runOrderTransaction = async work => {
  const session = await mongoose.startSession()

  try {
    let result

    await session.withTransaction(async () => {
      result = await work(session)
    })

    return result
  } catch (error) {
    if (!isProd && isTransactionUnsupportedError(error)) {
      logger.warn(
        '⚠️ Mongo sin transacciones en desarrollo; usando fallback no transaccional',
      )
      return work(null)
    }

    throw error
  } finally {
    await session.endSession()
  }
}

// =====================================================
// HELPERS RESPUESTA / EMAIL
// =====================================================

const enrichOrderForResponse = order => {
  if (!order) return null

  const raw = typeof order.toObject === 'function' ? order.toObject() : order

  const subtotalCents = Array.isArray(raw.products)
    ? raw.products.reduce((sum, product) => {
      return sum + Number(product.subtotalCents || 0)
    }, 0)
    : 0

  const discountCents = raw.paymentIntent?.discountAmountCents || 0
  const totalCents =
    raw.paymentIntent?.amountCents || Math.max(0, subtotalCents - discountCents)

  return {
    ...raw,

    totals: {
      subtotalCents,
      discountCents,
      totalCents,
      subtotal: Money.toDecimal(subtotalCents),
      discount: Money.toDecimal(discountCents),
      total: Money.toDecimal(totalCents),
    },

    products: Array.isArray(raw.products)
      ? raw.products.map(product => ({
        ...product,
        selectedAttributes: mapToObject(product.selectedAttributes),
        price: Money.toDecimal(product.priceCents),
        originalPrice: Money.toDecimal(product.originalPriceCents),
        subtotal: Money.toDecimal(product.subtotalCents),
        originalSubtotal: Money.toDecimal(product.originalSubtotalCents),
      }))
      : [],

    paymentIntent: raw.paymentIntent
      ? {
        ...raw.paymentIntent,
        amount: Money.toDecimal(raw.paymentIntent.amountCents),
        originalAmount: Money.toDecimal(raw.paymentIntent.originalAmountCents),
        discountAmount: Money.toDecimal(raw.paymentIntent.discountAmountCents),
      }
      : null,
  }
}

const buildOrderForEmail = order => {
  const enriched = enrichOrderForResponse(order)

  return {
    _id: enriched._id,
    orderNumber: enriched.idempotencyKey?.slice(-8).toUpperCase(),
    items: (enriched.products || []).map(line => ({
      title: line.titleSnapshot,
      price: line.price,
      quantity: line.count,
      image: line.imageSnapshot || '',
      subtotal: line.subtotal,
      variantSku: line.variantSku,
      selectedAttributes: line.selectedAttributes,
    })),
    subtotal: enriched.totals?.subtotal || 0,
    discount: enriched.totals?.discount || 0,
    total: enriched.totals?.total || 0,
    shippingAddress: enriched.shippingAddress,
    currency: enriched.paymentIntent?.currency || 'ARS',
    status: enriched.orderStatus,
    createdAt: enriched.createdAt,
  }
}

// =====================================================
// HELPERS CARRITO / LÍNEAS
// =====================================================

const validateCartOwnership = ({ cart, userId, tenantId }) => {
  if (!cart) {
    throw new Error('El carrito no existe')
  }

  if (String(cart.userId) !== String(userId)) {
    throw new Error('El carrito no pertenece al usuario actual')
  }

  if (String(cart.tenantId) !== String(tenantId)) {
    throw new Error('El carrito no pertenece al comercio actual')
  }

  if (!Array.isArray(cart.products) || cart.products.length === 0) {
    throw new Error('El carrito está vacío')
  }

  if (cart.products.length > MAX_ORDER_LINES) {
    throw new Error(`La orden supera el máximo de ${MAX_ORDER_LINES} líneas`)
  }
}

const calculateCartLines = async ({ cart, tenantId, session = null }) => {
  const tenantObjectId = normalizeObjectId(tenantId)

  if (!tenantObjectId) {
    throw new Error('tenantId inválido para cálculo de carrito')
  }

  const productIds = cart.products
    .map(item => item.productId)
    .filter(Boolean)
    .map(id => String(id))

  if (!productIds.length) {
    throw new Error('El carrito no contiene productos válidos')
  }

  const dbProducts = await Product.find({
    _id: { $in: productIds },
    tenantId: tenantObjectId,
    isDeleted: { $ne: true },
  })
    .setOptions({ tenantId })
    .session(session)
    .lean()

  const productMap = new Map(
    dbProducts.map(product => [String(product._id), product]),
  )

  let currency = null
  let subtotalCents = 0

  const lines = []
  const lineContexts = []

  for (let index = 0; index < cart.products.length; index += 1) {
    const cartItem = cart.products[index]
    const product = productMap.get(String(cartItem.productId))

    if (!product) {
      throw new Error(`Producto no disponible en ítem ${index + 1}`)
    }

    const count = Number(cartItem.quantity)

    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`Cantidad inválida en ítem ${index + 1}`)
    }

    const variant = findVariant({ product, cartItem })

    if (product.hasVariants && !variant) {
      throw new Error(`La variante seleccionada ya no existe para "${product.title}"`)
    }

    if (variant && variant.isActive === false) {
      throw new Error(`La variante seleccionada está inactiva para "${product.title}"`)
    }

    const availableStock = variant
      ? Number(variant.stock ?? variant.quantity ?? 0)
      : Number(product.stock ?? product.quantity ?? 0)

    if (availableStock < count) {
      throw new Error(
        `Stock insuficiente para "${product.title}" (solicitado: ${count}, disponible: ${availableStock})`,
      )
    }

    const pricing = await resolveCartPricing({
      tenantId,
      product,
      variant,
    })

    const lineCurrency = String(
      cartItem.currency || product.currency || 'ARS',
    ).toUpperCase()

    if (!ALLOWED_CURRENCIES.includes(lineCurrency)) {
      throw new Error(`Moneda inválida: ${lineCurrency}`)
    }

    if (!currency) currency = lineCurrency

    if (currency !== lineCurrency) {
      throw new Error('Todas las líneas deben usar la misma moneda')
    }

    const priceCents = Money.fromDecimal(pricing.price)
    const originalPriceCents = Money.fromDecimal(
      pricing.originalPrice ?? pricing.price,
    )
    const lineSubtotalCents = Money.multiply(priceCents, count)
    const originalSubtotalCents = Money.multiply(originalPriceCents, count)

    subtotalCents += lineSubtotalCents

    const persistedLine = {
      tenantId: tenantObjectId,
      product: normalizeObjectId(product._id),
      count,
      color:
        cartItem.colorId && isValidId(cartItem.colorId)
          ? normalizeObjectId(cartItem.colorId)
          : null,

      titleSnapshot: product.title,
      slugSnapshot: product.slug || null,
      imageSnapshot: getVariantImageUrl(variant) || getProductImageUrl(product),
      skuSnapshot: variant?.sku || product.sku || null,

      variantId: variant?._id || null,
      variantKey: variant?.key || null,
      variantSku: variant?.sku || null,
      selectedAttributes: selectedAttributesToObject(
        cartItem.selectedAttributes ||
          cartItem.variantAttributes ||
          cartItem.selectedVariant?.attributes,
      ),

      priceCents,
      originalPriceCents,
      discountPercentage: Number(pricing.discountPercentage || 0),
      promotionId: pricing.promotionId || null,
      promotionTitle: pricing.promotionTitle || null,
      promotionType: pricing.promotionType || null,
      subtotalCents: lineSubtotalCents,
      originalSubtotalCents,
      currency: lineCurrency,
    }

    lines.push(persistedLine)
    lineContexts.push({
      line: persistedLine,
      product,
      variant,
    })
  }

  return {
    lines,
    lineContexts,
    subtotalCents,
    currency: currency || 'ARS',
  }
}

// =====================================================
// HELPERS CUPÓN
// =====================================================

const findUsableCouponById = async ({ couponId, tenantId, session = null }) => {
  const now = new Date()

  return Coupon.findOne({
    _id: couponId,
    tenantId,
    isDeleted: false,
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
    $or: [
      { usageLimit: null },
      { usageLimit: { $exists: false } },
      { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
    ],
  })
    .setOptions({ tenantId })
    .session(session)
}

const findUsableCouponByCode = async ({ code, tenantId, session = null }) => {
  const cleanCode = sanitizeString(code).toUpperCase()
  if (!cleanCode) return null

  const now = new Date()

  return Coupon.findOne({
    code: cleanCode,
    tenantId,
    isDeleted: false,
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
    $or: [
      { usageLimit: null },
      { usageLimit: { $exists: false } },
      { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
    ],
  })
    .setOptions({ tenantId })
    .session(session)
}

const ensureCouponUsageAllowedForUser = async ({
  coupon,
  userId,
  tenantId,
  session = null,
}) => {
  if (!coupon) return

  const userUsageCount = await CouponUsage.countDocuments({
    tenantId,
    coupon: coupon._id,
    user: userId,
  })
    .setOptions({ tenantId })
    .session(session)

  if (
    coupon.usageLimitPerUser !== null &&
    coupon.usageLimitPerUser !== undefined &&
    userUsageCount >= coupon.usageLimitPerUser
  ) {
    throw new Error('Ya alcanzaste el límite de uso de este cupón')
  }
}

const evaluateCouponDiscount = ({ coupon, lineContexts, subtotalCents }) => {
  if (!coupon) {
    return {
      applicableLines: [],
      applicableSubtotalCents: 0,
      discountCents: 0,
    }
  }

  const applicableLines = lineContexts.filter(({ product }) => {
    if (typeof coupon.appliesToProduct === 'function') {
      return coupon.appliesToProduct(product)
    }

    const applicableProducts = coupon.applicableProducts || []

    if (!Array.isArray(applicableProducts) || applicableProducts.length === 0) {
      return true
    }

    return applicableProducts.some(productId => {
      return String(productId) === String(product._id)
    })
  })

  if (!applicableLines.length) {
    throw new Error('El cupón ya no aplica a ningún producto del carrito')
  }

  const applicableSubtotalCents = applicableLines.reduce((total, { line }) => {
    return total + Number(line.subtotalCents || 0)
  }, 0)

  let discountCents = 0

  if (typeof coupon.calculateDiscountCents === 'function') {
    discountCents = coupon.calculateDiscountCents(applicableSubtotalCents)
  } else if (coupon.discountType === 'percentage') {
    discountCents = Math.round(
      applicableSubtotalCents * (Number(coupon.discountValue || 0) / 100),
    )
  } else {
    discountCents = Money.fromDecimal(coupon.discountValue || 0)
  }

  if (coupon.maxDiscountAmount) {
    discountCents = Math.min(
      discountCents,
      Money.fromDecimal(coupon.maxDiscountAmount),
    )
  }

  if (discountCents <= 0) {
    throw new Error('El cupón ya no genera descuento para esta compra')
  }

  return {
    applicableLines,
    applicableSubtotalCents,
    discountCents: Math.min(discountCents, subtotalCents),
  }
}

const consumeCouponAtomic = async ({ coupon, tenantId, session = null }) => {
  const now = new Date()

  const consumed = await Coupon.findOneAndUpdate(
    {
      _id: coupon._id,
      tenantId,
      isDeleted: false,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $or: [
        { usageLimit: null },
        { usageLimit: { $exists: false } },
        { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
      ],
    },
    {
      $inc: { usageCount: 1 },
    },
    {
      new: true,
      runValidators: true,
      session,
    },
  ).setOptions({ tenantId })

  if (!consumed) {
    throw new Error('Cupón inválido, vencido o límite de uso alcanzado')
  }

  return consumed
}

const createCouponUsageRecord = async ({
  coupon,
  order,
  lines,
  userId,
  tenantId,
  subtotalCents,
  discountCents,
  finalCents,
  currency,
  req,
  session = null,
}) => {
  if (!coupon) return null

  const [usage] = await CouponUsage.create(
    [
      {
        tenantId,
        coupon: coupon._id,
        couponCodeSnapshot: coupon.code,
        discountTypeSnapshot: coupon.discountType,
        discountValueSnapshot: coupon.discountValue,
        user: userId,
        order: order._id,
        products: lines.map(serializeLineForCouponUsage),
        originalAmountCents: subtotalCents,
        discountAmountCents: discountCents,
        finalAmountCents: finalCents,
        currency,
        ipAddress: req.clientContext?.ip || req.ip || null,
        userAgent:
          req.clientContext?.userAgent || req.headers['user-agent'] || null,
      },
    ],
    { session },
  )

  return usage
}

// =====================================================
// HELPERS STOCK
// =====================================================

const buildStockFieldMode = product => {
  if (Object.prototype.hasOwnProperty.call(product, 'quantity')) {
    return 'quantity'
  }

  return 'stock'
}

const decrementLineStock = async ({ line, tenantId, session = null }) => {
  const baseFilter = {
    _id: line.product,
    tenantId,
    isDeleted: { $ne: true },
  }

  let product

  if (line.variantId) {
    product = await Product.findOneAndUpdate(
      {
        ...baseFilter,
        variants: {
          $elemMatch: {
            _id: line.variantId,
            isActive: true,
            stock: { $gte: line.count },
          },
        },
        $or: [
          { stock: { $gte: line.count } },
          { quantity: { $gte: line.count } },
        ],
      },
      {
        $inc: {
          'variants.$.stock': -line.count,
          stock: -line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  } else {
    const existingProduct = await Product.findOne(baseFilter)
      .setOptions({ tenantId })
      .session(session)
      .lean()

    if (!existingProduct) {
      throw new Error(`Producto no disponible: ${line.titleSnapshot}`)
    }

    const stockField = buildStockFieldMode(existingProduct)

    product = await Product.findOneAndUpdate(
      {
        ...baseFilter,
        [stockField]: { $gte: line.count },
      },
      {
        $inc: {
          [stockField]: -line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  }

  if (!product) {
    throw new Error(`Stock insuficiente o producto no disponible: ${line.titleSnapshot}`)
  }

  const remainingStock = Number(product.stock ?? product.quantity ?? 0)

  if (remainingStock <= 0 && product.status === 'active') {
    product.status = 'out-of-stock'
    await product.save({ session, tenantId })
  }

  return product
}

const incrementLineStock = async ({ line, tenantId, session = null }) => {
  const baseFilter = {
    _id: line.product,
    tenantId,
    isDeleted: { $ne: true },
  }

  let product

  if (line.variantId) {
    product = await Product.findOneAndUpdate(
      {
        ...baseFilter,
        'variants._id': line.variantId,
      },
      {
        $inc: {
          'variants.$.stock': line.count,
          stock: line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  } else {
    const existingProduct = await Product.findOne(baseFilter)
      .setOptions({ tenantId })
      .session(session)
      .lean()

    if (!existingProduct) return null

    const stockField = buildStockFieldMode(existingProduct)

    product = await Product.findOneAndUpdate(
      baseFilter,
      {
        $inc: {
          [stockField]: line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  }

  const currentStock = Number(product?.stock ?? product?.quantity ?? 0)

  if (product && currentStock > 0 && product.status === 'out-of-stock') {
    product.status = 'active'
    await product.save({ session, tenantId })
  }

  return product
}

const decrementStockForLines = async ({ lines, tenantId, session = null }) => {
  for (const line of lines) {
    await decrementLineStock({ line, tenantId, session })
  }
}

const restoreStockForLines = async ({ lines, tenantId, session = null }) => {
  for (const line of lines) {
    await incrementLineStock({ line, tenantId, session })
  }
}

// =====================================================
// HELPERS SHIPPING / CREACIÓN
// =====================================================

const buildShippingAddress = ({ req, body }) => {
  const shippingAddress = body?.shippingAddress || {}

  const result = {
    firstName: sanitizeString(shippingAddress.firstName || req.user?.firstname),
    lastName: sanitizeString(shippingAddress.lastName || req.user?.lastname),
    email: validateEmailOrThrow(shippingAddress.email || req.user?.email),
    phone: sanitizeString(shippingAddress.phone || req.user?.mobile)
      .slice(0, 2)
      .toUpperCase(),
  }

  const requiredFields = [
    'firstName',
    'lastName',
    'email',
    'phone',
  ]

  const missing = requiredFields.filter(field => !result[field])

  if (missing.length) {
    throw new Error(`Datos de envío incompletos: ${missing.join(', ')}`)
  }

  return result
}

const buildCustomerSnapshot = user => ({
  userId: user._id,
  firstname: user.firstname || user.firstName || '',
  lastname: user.lastname || user.lastName || '',
  email: normalizeEmail(user.email || ''),
  mobile: user.mobile || user.phone || '',
  validatedAt: new Date(),
})

const clearCart = async ({ cartId, tenantId, session = null }) => {
  await Cart.deleteOne({
    _id: cartId,
    tenantId,
  })
    .setOptions({ tenantId })
    .session(session)
}

// =====================================================
// CREATE ORDER
// =====================================================

export const createOrder = expressAsyncHandler(async (req, res) => {
  const userId = getUserIdFromRequest(req)

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Usuario no autenticado',
    })
  }

  let tenantId
  let tenantObjectId

  try {
    ;({ tenantId, tenantObjectId } = resolveTenantContext(req))
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }

  const isCOD = Boolean(req.body?.COD)
  const bodyCouponCode = sanitizeString(
    req.body?.coupon || req.body?.couponDetails?.code,
  )

  const idempotencyKey =
    sanitizeString(req.body?.idempotencyKey) || crypto.randomUUID()

  const existingOrder = await Order.findOne({
    tenantId: tenantObjectId,
    idempotencyKey,
    orderby: normalizeObjectId(userId),
    isDeleted: false,
  }).setOptions({ tenantId })

  if (existingOrder) {
    return res.status(200).json({
      success: true,
      data: enrichOrderForResponse(existingOrder),
      message: 'Orden ya existente',
    })
  }

  let createdOrder

  try {
    createdOrder = await runOrderTransaction(async session => {
      const { user } = await validateUserTenantMembership({
        userId,
        tenantId,
        session,
      })

      const cart = await Cart.findOne({
        userId: normalizeObjectId(userId),
        tenantId: tenantObjectId,
      })
        .populate('appliedCoupon')
        .setOptions({ tenantId })
        .session(session)

      validateCartOwnership({ cart, userId, tenantId })

      const {
        lines,
        lineContexts,
        subtotalCents,
        currency,
      } = await calculateCartLines({
        cart,
        tenantId,
        session,
      })

      let couponDoc = null
      let discountCents = 0

      if (cart.appliedCoupon?._id || cart.appliedCoupon) {
        const couponId = cart.appliedCoupon?._id || cart.appliedCoupon

        couponDoc = await findUsableCouponById({
          couponId,
          tenantId,
          session,
        })
      }

      if (!couponDoc && bodyCouponCode) {
        couponDoc = await findUsableCouponByCode({
          code: bodyCouponCode,
          tenantId,
          session,
        })
      }

      if (couponDoc) {
        if (
          typeof couponDoc.isCurrentlyUsable === 'function' &&
          !couponDoc.isCurrentlyUsable()
        ) {
          throw new Error('Cupón inválido, vencido o agotado')
        }

        await ensureCouponUsageAllowedForUser({
          coupon: couponDoc,
          userId: normalizeObjectId(userId),
          tenantId,
          session,
        })

        const couponEvaluation = evaluateCouponDiscount({
          coupon: couponDoc,
          lineContexts,
          subtotalCents,
        })

        discountCents = couponEvaluation.discountCents
      }

      const finalCents = Math.max(0, subtotalCents - discountCents)
      const paymentStatus = isCOD
        ? PAYMENT_STATUS.APPROVED
        : PAYMENT_STATUS.PENDING

      const shippingAddress = buildShippingAddress({ req, body: req.body })

      /**
       * CRÍTICO:
       * Para Mercado Pago NO descontamos stock ni borramos carrito acá.
       * Eso lo debe hacer paymentController cuando el pago esté aprobado.
       */
      if (isCOD) {
        await decrementStockForLines({
          lines,
          tenantId,
          session,
        })
      }

      if (couponDoc) {
        couponDoc = await consumeCouponAtomic({
          coupon: couponDoc,
          tenantId,
          session,
        })
      }

      const order = new Order({
        tenantId: tenantObjectId,
        idempotencyKey,
        products: lines,

        paymentIntent: {
          id: idempotencyKey,
          provider: isCOD ? 'cod' : 'mercadopago',
          status: paymentStatus,
          method: isCOD ? 'cash_on_delivery' : 'credit_card',
          currency,
          amountCents: finalCents,
          originalAmountCents: subtotalCents,
          discountAmountCents: discountCents,
        },

        paymentStatus,
        fulfillmentStatus: FULFILLMENT_STATUS.UNFULFILLED,
        refundStatus: REFUND_STATUS.NONE,
        orderby: normalizeObjectId(userId),
        customerSnapshot: buildCustomerSnapshot(user),
        shippingAddress,
        paidAt: isCOD ? new Date() : null,

        coupon: couponDoc
          ? {
            code: couponDoc.code,
            discountPercent:
                couponDoc.discountType === 'percentage'
                  ? couponDoc.discountValue
                  : 0,
            discountAmountCents: discountCents,
            applicableProducts:
                couponDoc.applicableProducts?.map(productId =>
                  normalizeObjectId(productId),
                ) || [],
          }
          : undefined,
      })

      order.addAuditEntry({
        action: 'created',
        performedBy: normalizeObjectId(userId),
        performedByRole: 'customer',
        metadata: {
          provider: order.paymentIntent.provider,
          paymentStatus,
          isCOD,
          hasCoupon: Boolean(couponDoc),
          discountCents,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      })

      await order.save({ session, tenantId })

      if (couponDoc) {
        await createCouponUsageRecord({
          coupon: couponDoc,
          order,
          lines,
          userId: normalizeObjectId(userId),
          tenantId,
          subtotalCents,
          discountCents,
          finalCents,
          currency,
          req,
          session,
        })
      }

      if (isCOD) {
        await clearCart({
          cartId: cart._id,
          tenantId,
          session,
        })
      }

      return order
    })
  } catch (error) {
    logger.error(`❌ Error creando orden: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Error procesando la orden',
    })
  }

  if (isCOD) {
    const orderForEmail = buildOrderForEmail(createdOrder)

    sendOrderConfirmationEmail(orderForEmail, createdOrder.shippingAddress.email)
      .then(result => {
        if (result?.success) {
          return Order.updateOne(
            { _id: createdOrder._id, tenantId: tenantObjectId },
            {
              $set: {
                emailSent: true,
                emailSentAt: new Date(),
              },
            },
          ).setOptions({ tenantId })
        }

        return null
      })
      .catch(error => logger.error(`❌ Error email orden: ${error.message}`))

    sendAdminNotificationEmail(orderForEmail).catch(error =>
      logger.error(`❌ Error email admin: ${error.message}`),
    )
  }

  return res.status(201).json({
    success: true,
    data: enrichOrderForResponse(createdOrder),
    message: isCOD
      ? 'Orden creada exitosamente. Recibirás un email de confirmación.'
      : 'Orden creada. Procedé al pago para completar la compra.',
  })
})

// =====================================================
// RESEND EMAIL
// =====================================================

export const resendConfirmationEmail = expressAsyncHandler(async (req, res) => {
  const { orderId } = req.params
  const userId = getUserIdFromRequest(req)

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Usuario no autenticado',
    })
  }

  let tenantId
  let tenantObjectId

  try {
    ;({ tenantId, tenantObjectId } = resolveTenantContext(req))
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }

  if (!isValidId(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'ID de orden inválido',
    })
  }

  const order = await Order.findOne({
    _id: normalizeObjectId(orderId),
    orderby: normalizeObjectId(userId),
    tenantId: tenantObjectId,
    isDeleted: false,
  }).setOptions({ tenantId })

  if (!order) {
    return res.status(404).json({
      success: false,
      message: 'Orden no encontrada',
    })
  }

  if (order.paymentStatus !== PAYMENT_STATUS.APPROVED) {
    return res.status(400).json({
      success: false,
      message: 'Solo se pueden reenviar emails de órdenes pagadas',
    })
  }

  const result = await sendOrderConfirmationEmail(
    buildOrderForEmail(order),
    order.shippingAddress.email,
  )

  if (result?.success) {
    await Order.updateOne(
      { _id: order._id, tenantId: tenantObjectId },
      { $set: { emailResentAt: new Date() } },
    ).setOptions({ tenantId })

    return res.json({
      success: true,
      message: 'Email reenviado exitosamente',
    })
  }

  return res.status(500).json({
    success: false,
    message: 'Error reenviando email',
  })
})

// =====================================================
// GET USER ORDERS
// =====================================================

export const getOrders = expressAsyncHandler(async (req, res) => {
  const userId = getUserIdFromRequest(req)

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'No autorizado',
    })
  }

  let tenantId
  let tenantObjectId

  try {
    ;({ tenantId, tenantObjectId } = resolveTenantContext(req))
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }

  const page = toSafePage(req.query.page)
  const limit = toSafeLimit(req.query.limit)
  const skip = (page - 1) * limit

  const [orders, total] = await Promise.all([
    Order.find({
      tenantId: tenantObjectId,
      orderby: normalizeObjectId(userId),
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .setOptions({ tenantId }),

    Order.countDocuments({
      tenantId: tenantObjectId,
      orderby: normalizeObjectId(userId),
      isDeleted: false,
    }).setOptions({ tenantId }),
  ])

  return res.status(200).json({
    success: true,
    data: orders.map(enrichOrderForResponse),
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  })
})

// =====================================================
// STATUS UPDATES
// =====================================================

const getOrderForAdminMutation = async ({
  orderId,
  tenantObjectId,
  tenantId,
}) => {
  if (!isValidId(orderId)) {
    const error = new Error('ID de orden inválido')
    error.statusCode = 400
    throw error
  }

  const order = await Order.findOne({
    _id: normalizeObjectId(orderId),
    tenantId: tenantObjectId,
    isDeleted: false,
  }).setOptions({ tenantId })

  if (!order) {
    const error = new Error('Orden no encontrada')
    error.statusCode = 404
    throw error
  }

  return order
}

const addAdminAuditEntry = ({ order, action, req, performedBy, reason, metadata = {} }) => {
  if (typeof order.addAuditEntry !== 'function') return

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

export const updateOrderStatus = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const performedBy = normalizeObjectId(getUserIdFromRequest(req))

    const order = await getOrderForAdminMutation({
      orderId: req.params.id,
      tenantObjectId,
      tenantId,
    })

    const currentStatus = String(order.orderStatus || '').toLowerCase()

    const nextStatus = sanitizeString(
      req.body?.orderStatus ?? req.body?.status ?? req.body?.nextStatus,
    ).toLowerCase()

    if (!Object.values(LEGACY_ORDER_STATUS).includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Permitidos: ${Object.values(
          LEGACY_ORDER_STATUS,
        ).join(', ')}`,
      })
    }

    if (currentStatus === nextStatus) {
      return res.status(200).json({
        success: true,
        data: enrichOrderForResponse(order),
        message: 'La orden ya tenía ese estado',
      })
    }

    if (nextStatus === LEGACY_ORDER_STATUS.CANCELLED) {
      return cancelOrder(req, res)
    }

    if (nextStatus === LEGACY_ORDER_STATUS.REFUNDED) {
      return refundOrder(req, res)
    }

    const finalStatuses = [
      LEGACY_ORDER_STATUS.CANCELLED,
      LEGACY_ORDER_STATUS.REFUNDED,
    ]

    if (finalStatuses.includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'No se puede modificar una orden cancelada o reembolsada',
      })
    }

    if (nextStatus === LEGACY_ORDER_STATUS.NOT_PROCESSED) {
      if (order.fulfillmentStatus !== FULFILLMENT_STATUS.UNFULFILLED) {
        return res.status(400).json({
          success: false,
          message: 'No se puede volver una orden procesada a no procesada',
        })
      }
    }

    if (nextStatus === LEGACY_ORDER_STATUS.PAYMENT_PENDING) {
      if (order.paymentStatus !== PAYMENT_STATUS.PENDING) {
        return res.status(400).json({
          success: false,
          message: 'La orden ya no está pendiente de pago',
        })
      }
    }

    if (nextStatus === LEGACY_ORDER_STATUS.PROCESSING) {
      if (order.fulfillmentStatus === FULFILLMENT_STATUS.UNFULFILLED) {
        await order.updateFulfillmentStatus(FULFILLMENT_STATUS.PREPARING, {
          tenantId,
          performedBy,
          req,
          reason: 'Cambio manual a processing',
        })
      }
    }

    if (nextStatus === LEGACY_ORDER_STATUS.DISPATCHED) {
      await order.updateFulfillmentStatus(FULFILLMENT_STATUS.SHIPPED, {
        tenantId,
        performedBy,
        req,
        reason: 'Cambio manual a dispatched',
      })
    }

    if (nextStatus === LEGACY_ORDER_STATUS.DELIVERED) {
      await order.updateFulfillmentStatus(FULFILLMENT_STATUS.DELIVERED, {
        tenantId,
        performedBy,
        req,
        reason: 'Cambio manual a delivered',
      })
    }

    order.orderStatus = nextStatus

    addAdminAuditEntry({
      order,
      action: 'order_status_updated',
      req,
      performedBy,
      reason: sanitizeString(
        req.body?.reason,
        'Actualización manual de estado comercial',
      ),
      metadata: {
        previousStatus: currentStatus,
        nextStatus,
      },
    })

    await order.save({ tenantId })

    return res.status(200).json({
      success: true,
      data: enrichOrderForResponse(order),
      message: 'Estado de la orden actualizado correctamente',
    })
  } catch (error) {
    logger.error(`❌ Error actualizando estado legacy: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
})

export const updateOrderPaymentStatus = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const performedBy = normalizeObjectId(getUserIdFromRequest(req))

    const order = await getOrderForAdminMutation({
      orderId: req.params.id,
      tenantObjectId,
      tenantId,
    })

    const nextPaymentStatus = sanitizeString(req.body?.paymentStatus).toLowerCase()

    if (!Object.values(PAYMENT_STATUS).includes(nextPaymentStatus)) {
      return res.status(400).json({
        success: false,
        message: `paymentStatus inválido. Permitidos: ${Object.values(
          PAYMENT_STATUS,
        ).join(', ')}`,
      })
    }

    await order.updatePaymentStatus(nextPaymentStatus, {
      tenantId,
      performedBy,
      req,
      reason: sanitizeString(req.body?.reason, 'Actualización manual de pago'),
    })

    return res.status(200).json({
      success: true,
      data: enrichOrderForResponse(order),
      message: 'Estado de pago actualizado correctamente',
    })
  } catch (error) {
    logger.error(`❌ Error actualizando paymentStatus: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
})

export const updateOrderFulfillmentStatus = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const performedBy = normalizeObjectId(getUserIdFromRequest(req))

    const order = await getOrderForAdminMutation({
      orderId: req.params.id,
      tenantObjectId,
      tenantId,
    })

    const nextFulfillmentStatus = sanitizeString(
      req.body?.fulfillmentStatus,
    ).toLowerCase()

    if (!Object.values(FULFILLMENT_STATUS).includes(nextFulfillmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `fulfillmentStatus inválido. Permitidos: ${Object.values(
          FULFILLMENT_STATUS,
        ).join(', ')}`,
      })
    }

    await order.updateFulfillmentStatus(nextFulfillmentStatus, {
      tenantId,
      performedBy,
      req,
      reason: sanitizeString(
        req.body?.reason,
        'Actualización manual de logística',
      ),
    })

    return res.status(200).json({
      success: true,
      data: enrichOrderForResponse(order),
      message: 'Estado logístico actualizado correctamente',
    })
  } catch (error) {
    logger.error(
      `❌ Error actualizando fulfillmentStatus: ${error.stack || error.message}`,
    )

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
})


// =====================================================
// DELETE ORDER - SOFT DELETE PRODUCCIÓN
// =====================================================

export const deleteOrder = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const performedBy = normalizeObjectId(getUserIdFromRequest(req))

    const orderId = req.params.id
    const force = Boolean(req.body?.force)
    const reason = sanitizeString(
      req.body?.reason,
      'Eliminación definitiva desde panel admin',
    )

    if (!isValidId(orderId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de orden inválido',
      })
    }

    const order = await Order.findOne({
      _id: normalizeObjectId(orderId),
      tenantId: tenantObjectId,
    }).setOptions({ tenantId })

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Orden no encontrada',
      })
    }

    const paymentStatus = String(order.paymentStatus || '').toLowerCase()
    const orderStatus = String(order.orderStatus || '').toLowerCase()
    const fulfillmentStatus = String(order.fulfillmentStatus || '').toLowerCase()

    const protectedOrder =
      paymentStatus === PAYMENT_STATUS.APPROVED ||
      orderStatus === LEGACY_ORDER_STATUS.DELIVERED ||
      orderStatus === LEGACY_ORDER_STATUS.REFUNDED ||
      fulfillmentStatus === FULFILLMENT_STATUS.DELIVERED

    if (protectedOrder && !force) {
      return res.status(409).json({
        success: false,
        code: 'ORDER_DELETE_REQUIRES_FORCE',
        message:
          'Esta orden tiene pago aprobado, fue entregada o está reembolsada. Requiere confirmación forzada para eliminarla.',
        data: {
          id: String(order._id),
          paymentStatus,
          orderStatus,
          fulfillmentStatus,
        },
      })
    }

    /**
     * IMPORTANTE:
     * No restauramos stock acá.
     * Restaurar stock corresponde a cancelOrder/refundOrder.
     * Eliminar una orden no debe tocar inventario automáticamente.
     */

    logger.warn('🗑️ Orden eliminada definitivamente desde admin', {
      orderId: String(order._id),
      tenantId,
      performedBy: String(performedBy || ''),
      force,
      reason,
      paymentStatus,
      orderStatus,
      fulfillmentStatus,
      protectedOrder,
    })

    await Order.deleteOne({
      _id: normalizeObjectId(orderId),
      tenantId: tenantObjectId,
    }).setOptions({ tenantId })

    return res.status(200).json({
      success: true,
      message: 'Orden eliminada definitivamente de la base de datos',
      data: {
        id: String(order._id),
        hardDeleted: true,
      },
    })
  } catch (error) {
    logger.error(`❌ Error eliminando orden: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || 'Error eliminando orden',
    })
  }
})

// =====================================================
// CANCEL / REFUND
// =====================================================

export const cancelOrder = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const cancelledBy = getUserIdFromRequest(req)
    const reason = sanitizeString(req.body?.reason, 'Cancelación manual')

    const order = await runOrderTransaction(async session => {
      const orderToCancel = await Order.findOne({
        _id: normalizeObjectId(req.params.id),
        tenantId: tenantObjectId,
        isDeleted: false,
      })
        .setOptions({ tenantId })
        .session(session)

      if (!orderToCancel) {
        const error = new Error('Orden no encontrada')
        error.statusCode = 404
        throw error
      }

      if (!orderToCancel.stockRestoredAt) {
        await restoreStockForLines({
          lines: orderToCancel.products,
          tenantId,
          session,
        })

        orderToCancel.stockRestoredAt = new Date()
      }

      await orderToCancel.markCancelled({
        tenantId,
        cancelledBy: cancelledBy ? normalizeObjectId(cancelledBy) : null,
        reason,
        session,
        req,
      })

      return orderToCancel
    })

    return res.status(200).json({
      success: true,
      data: enrichOrderForResponse(order),
      message: 'Orden cancelada correctamente',
    })
  } catch (error) {
    logger.error(`❌ Error cancelando orden: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
})

export const refundOrder = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const performedBy = normalizeObjectId(getUserIdFromRequest(req))

    const order = await runOrderTransaction(async session => {
      const orderToRefund = await Order.findOne({
        _id: normalizeObjectId(req.params.id),
        tenantId: tenantObjectId,
        isDeleted: false,
      })
        .setOptions({ tenantId })
        .session(session)

      if (!orderToRefund) {
        const error = new Error('Orden no encontrada')
        error.statusCode = 404
        throw error
      }

      if (!orderToRefund.stockRestoredAt) {
        await restoreStockForLines({
          lines: orderToRefund.products,
          tenantId,
          session,
        })

        orderToRefund.stockRestoredAt = new Date()
      }

      await orderToRefund.markRefunded({
        tenantId,
        performedBy,
        reason: sanitizeString(req.body?.reason, 'Reembolso manual'),
        session,
        req,
      })

      return orderToRefund
    })

    return res.status(200).json({
      success: true,
      data: enrichOrderForResponse(order),
      message: 'Orden reembolsada correctamente',
    })
  } catch (error) {
    logger.error(`❌ Error reembolsando orden: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
})

// =====================================================
// ADMIN: GET ALL ORDERS
// =====================================================

export const getAllOrders = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)

    const page = toSafePage(req.query.page)
    const limit = toSafeLimit(req.query.limit, 10)
    const skip = (page - 1) * limit

    const {
      status,
      paymentStatus,
      fulfillmentStatus,
      from,
      to,
      q,
      minTotal,
      maxTotal,
      sortBy = 'createdAt',
      sortDir = 'desc',
    } = req.query

    const query = {
      tenantId: tenantObjectId,
      isDeleted: false,
    }

    if (status) query.orderStatus = String(status).toLowerCase()
    if (paymentStatus) query.paymentStatus = String(paymentStatus).toLowerCase()
    if (fulfillmentStatus) {
      query.fulfillmentStatus = String(fulfillmentStatus).toLowerCase()
    }

    const fromDate = safeDate(from)
    const toDate = safeDate(to)

    if (fromDate || toDate) {
      query.createdAt = {}
      if (fromDate) query.createdAt.$gte = fromDate
      if (toDate) query.createdAt.$lte = toDate
    }

    if (minTotal || maxTotal) {
      query['paymentIntent.amountCents'] = {}

      if (minTotal) {
        query['paymentIntent.amountCents'].$gte = Money.fromDecimal(minTotal)
      }

      if (maxTotal) {
        query['paymentIntent.amountCents'].$lte = Money.fromDecimal(maxTotal)
      }
    }

    if (q?.trim()) {
      const safeRegex = new RegExp(escapeRegex(q.trim().slice(0, 50)), 'i')

      const users = await User.find({
        tenantId: tenantObjectId,
        $or: [
          { email: safeRegex },
          { firstname: safeRegex },
          { lastname: safeRegex },
        ],
      })
        .select('_id')
        .lean()

      const userIds = users.map(user => user._id)

      query.$or = [
        { idempotencyKey: safeRegex },
        { 'paymentIntent.id': safeRegex },
        { 'paymentIntent.providerPaymentId': safeRegex },
        ...(userIds.length ? [{ orderby: { $in: userIds } }] : []),
      ]
    }

    const sortFieldMap = {
      createdAt: 'createdAt',
      amount: 'paymentIntent.amountCents',
      status: 'orderStatus',
      paymentStatus: 'paymentStatus',
      fulfillmentStatus: 'fulfillmentStatus',
    }

    const sortField = sortFieldMap[sortBy] || 'createdAt'
    const sortOrder = sortDir === 'asc' ? 1 : -1

    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean()
        .setOptions({ tenantId }),

      Order.countDocuments(query).setOptions({ tenantId }),
    ])

    return res.status(200).json({
      success: true,
      data: orders.map(order => ({
        ...enrichOrderForResponse(order),
        orderNumber: order.idempotencyKey?.slice(-8).toUpperCase(),
      })),
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
      meta: {
        filters: {
          status: status || null,
          paymentStatus: paymentStatus || null,
          fulfillmentStatus: fulfillmentStatus || null,
          dateRange: from || to ? { from: from || null, to: to || null } : null,
          search: q || null,
        },
        sorting: {
          field: sortField,
          direction: sortDir,
        },
      },
    })
  } catch (error) {
    logger.error(`❌ Error obteniendo órdenes: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
})