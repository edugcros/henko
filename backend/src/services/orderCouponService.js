import Coupon from '../models/couponModel.js'
import CouponUsage from '../models/CouponUsageModel.js'
import logger from '../../config/logger.js'

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const mapToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

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

export const findUsableCouponById = async ({
  couponId,
  tenantId,
  session = null,
}) => {
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

export const findUsableCouponByCode = async ({
  code,
  tenantId,
  session = null,
}) => {
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

export const ensureCouponUsageAllowedForUser = async ({
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

export const evaluateCouponDiscount = ({
  coupon,
  lineContexts,
  subtotalCents,
  money,
}) => {
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
    discountCents = money.fromDecimal(coupon.discountValue || 0)
  }

  if (coupon.maxDiscountAmount) {
    discountCents = Math.min(
      discountCents,
      money.fromDecimal(coupon.maxDiscountAmount),
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

export const consumeCouponAtomic = async ({
  coupon,
  tenantId,
  session = null,
}) => {
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

export const createCouponUsageRecord = async ({
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
        ipAddress: req?.clientContext?.ip || req?.ip || null,
        userAgent:
          req?.clientContext?.userAgent || req?.headers?.['user-agent'] || null,
      },
    ],
    { session },
  )

  return usage
}

/**
 * Consume el cupón de una orden pagada con Mercado Pago recién al momento en
 * que el pago queda aprobado (no al crear la orden, a diferencia de COD),
 * para no agotar cupones con pagos rechazados/abandonados.
 *
 * Idempotente ante reintentos/webhooks duplicados: primero intenta crear el
 * `CouponUsage` (protegido por el índice único `{tenantId, order}`) y solo si
 * eso tiene éxito incrementa `usageCount` — así una segunda ejecución para la
 * misma orden nunca incrementa el contador dos veces, aunque corra en
 * paralelo bajo un lock distinto (processPayment/webhook/reconciliación usan
 * llaves de lock independientes entre sí).
 *
 * Si el cupón ya no es válido al momento de la aprobación (por ejemplo, se
 * agotó/expiró mientras el pago estaba pending), no revierte ni rechaza el
 * pago: el cobro ya fue aprobado por Mercado Pago y el monto cobrado ya
 * refleja el descuento acordado al crear la orden. Solo se loguea como error
 * para seguimiento manual — el peor caso es un cupón sub-contado, no una
 * reutilización indebida.
 */
export const consumeOrderCouponIfNeeded = async ({
  order,
  tenantId,
  userId,
  req,
}) => {
  const couponId = order.coupon?.couponId

  if (!couponId || order.couponConsumedAt) return null

  const couponDoc = await Coupon.findOne({ _id: couponId, tenantId }).setOptions({
    tenantId,
  })

  if (!couponDoc) {
    logger.warn('⚠️ Cupón de la orden ya no existe al confirmar el pago de Mercado Pago', {
      orderId: order._id?.toString?.(),
      couponId: String(couponId),
      tenantId: String(tenantId),
    })

    order.couponConsumedAt = new Date()
    return null
  }

  try {
    await createCouponUsageRecord({
      coupon: couponDoc,
      order,
      lines: order.products,
      userId,
      tenantId,
      subtotalCents: order.paymentIntent?.originalAmountCents || 0,
      discountCents: order.paymentIntent?.discountAmountCents || 0,
      finalCents: order.paymentIntent?.amountCents || 0,
      currency: order.paymentIntent?.currency,
      req,
    })
  } catch (usageError) {
    if (usageError?.code === 11000) {
      logger.info(
        'Cupón ya registrado como usado para esta orden, se omite doble consumo',
        {
          orderId: order._id?.toString?.(),
          couponId: String(couponId),
        },
      )

      order.couponConsumedAt = new Date()
      return null
    }

    throw usageError
  }

  try {
    await consumeCouponAtomic({ coupon: couponDoc, tenantId })
  } catch (limitError) {
    logger.error(
      '❌ No se pudo incrementar el contador de uso del cupón al aprobar el pago (el pago ya fue cobrado, no se revierte)',
      {
        orderId: order._id?.toString?.(),
        couponId: String(couponId),
        message: limitError?.message,
      },
    )
  }

  order.couponConsumedAt = new Date()
  return couponDoc
}
