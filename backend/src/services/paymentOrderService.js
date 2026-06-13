import crypto from 'node:crypto'

import Order, {
  FULFILLMENT_STATUS,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import { Money } from '../utils/money.js'
import { isValidObjectId, toObjectId } from '../utils/requestContext.js'
import { validateCartBelongsToTenant } from './paymentOrderOpsService.js'
import { normalizeMpStatus } from './paymentMercadoPagoService.js'

// =====================================================
// CONSTANTES
// =====================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_CURRENCY = 'ARS'
const DEFAULT_COUNTRY = 'AR'

// =====================================================
// HELPERS
// =====================================================

const buildHttpError = ({ message, statusCode = 400, code, details = null }) => {
  const error = new Error(message)
  error.statusCode = statusCode
  if (code) error.code = code
  if (details) error.details = details
  return error
}

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => sanitizeString(value).toLowerCase()

const isValidEmail = value => {
  const clean = normalizeEmail(value)
  return Boolean(clean && EMAIL_REGEX.test(clean))
}

const normalizeObjectIdOrThrow = ({ value, field }) => {
  if (!value || !isValidObjectId(value)) {
    throw buildHttpError({
      message: `${field} inválido`,
      statusCode: 400,
      code: `${String(field).toUpperCase()}_INVALID`,
    })
  }

  return toObjectId(value)
}

const normalizeCount = value => {
  const count = Number(value)

  if (!Number.isInteger(count) || count <= 0) {
    throw buildHttpError({
      message: 'Cantidad inválida en carrito',
      statusCode: 400,
      code: 'INVALID_CART_QUANTITY',
    })
  }

  return count
}

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const extractImageUrl = image => {
  if (!image) return null
  if (typeof image === 'string') return image
  if (typeof image === 'object') return image.url || image.secure_url || null
  return null
}

const getProductImageUrl = product => {
  return (
    product?.images?.find?.(image => image?.isMain)?.url ||
    extractImageUrl(product?.images?.[0]) ||
    extractImageUrl(product?.thumbnail) ||
    extractImageUrl(product?.image) ||
    null
  )
}

const getVariantImageUrl = variant => {
  return (
    extractImageUrl(variant?.image) ||
    variant?.images?.find?.(image => image?.isMain)?.url ||
    extractImageUrl(variant?.images?.[0]) ||
    null
  )
}

const getCartItemVariantIdentifier = item => {
  return (
    item?.variantId ||
    item?.selectedVariant?._id ||
    item?.selectedVariant?.id ||
    item?.selectedVariant?.key ||
    item?.selectedVariant?.sku ||
    item?.variantSku ||
    item?.variantSKU ||
    item?.variantKey ||
    null
  )
}

const findVariant = ({ product, item }) => {
  if (!product?.hasVariants) return null

  const variantIdentifier = getCartItemVariantIdentifier(item)

  if (!variantIdentifier) return null

  return (
    product.variants?.find(variant => {
      return (
        String(variant?._id) === String(variantIdentifier) ||
        String(variant?.id) === String(variantIdentifier) ||
        String(variant?.key) === String(variantIdentifier) ||
        String(variant?.sku) === String(variantIdentifier)
      )
    }) || null
  )
}

const getLinePrice = ({ product, variant }) => {
  return Number(
    variant?.price ??
      variant?.salePrice ??
      product?.price ??
      product?.salePrice ??
      0,
  )
}

const getLineOriginalPrice = ({ product, variant, price }) => {
  return Number(
    variant?.originalPrice ??
      product?.originalPrice ??
      product?.compareAtPrice ??
      price,
  )
}

const buildShippingAddress = ({ shippingAddress = {}, cart = {} }) => {
  const email = normalizeEmail(
    shippingAddress.email ||
      cart.userEmail ||
      cart.email ||
      '',
  )

  if (!isValidEmail(email)) {
    throw buildHttpError({
      message: 'Email de envío inválido',
      statusCode: 400,
      code: 'SHIPPING_EMAIL_INVALID',
    })
  }

  const firstName = sanitizeString(shippingAddress.firstName)
  const lastName = sanitizeString(shippingAddress.lastName)
  const phone = sanitizeString(shippingAddress.phone)

  if (!firstName) {
    throw buildHttpError({
      message: 'El nombre es obligatorio',
      statusCode: 400,
      code: 'SHIPPING_FIRST_NAME_REQUIRED',
    })
  }

  if (!lastName) {
    throw buildHttpError({
      message: 'El apellido es obligatorio',
      statusCode: 400,
      code: 'SHIPPING_LAST_NAME_REQUIRED',
    })
  }

  if (!phone) {
    throw buildHttpError({
      message: 'El teléfono es obligatorio',
      statusCode: 400,
      code: 'SHIPPING_PHONE_REQUIRED',
    })
  }

  return {
    firstName: firstName.slice(0, 100),
    lastName: lastName.slice(0, 100),
    email,
    phone: phone.slice(0, 50),
    address: sanitizeString(shippingAddress.address).slice(0, 255),
    city: sanitizeString(shippingAddress.city).slice(0, 100),
    zipCode: sanitizeString(shippingAddress.zipCode).slice(0, 20),
    country: sanitizeString(shippingAddress.country, DEFAULT_COUNTRY)
      .slice(0, 2)
      .toUpperCase(),
  }
}

const buildCustomerSnapshot = ({ userId, shipping }) => ({
  userId: toObjectId(userId),
  email: shipping.email || '',
  firstname: shipping.firstName || '',
  lastname: shipping.lastName || '',
  mobile: shipping.phone || '',
  validatedAt: new Date(),
})

const ensurePaymentIntentObject = order => {
  if (!order.paymentIntent) {
    order.paymentIntent = {}
  }
}

const getProviderRawStatus = value => {
  return sanitizeString(value).toLowerCase()
}

const canApplyPaymentTransition = (currentStatus, nextStatus) => {
  if (!currentStatus || currentStatus === nextStatus) return true

  const allowedTransitions = {
    [PAYMENT_STATUS.PENDING]: [
      PAYMENT_STATUS.APPROVED,
      PAYMENT_STATUS.REJECTED,
      PAYMENT_STATUS.CANCELLED,
      PAYMENT_STATUS.REFUNDED,
    ],
    [PAYMENT_STATUS.APPROVED]: [
      PAYMENT_STATUS.REFUNDED,
    ],
    [PAYMENT_STATUS.REJECTED]: [],
    [PAYMENT_STATUS.CANCELLED]: [],
    [PAYMENT_STATUS.REFUNDED]: [],
  }

  return allowedTransitions[currentStatus]?.includes(nextStatus) === true
}

const getOrderIdempotencyKey = () => {
  return crypto.randomUUID()
}

const getPaymentIntentId = () => {
  return crypto.randomUUID()
}

// =====================================================
// CREATE ORDER FROM CART
// =====================================================

export const createOrderFromCart = async ({
  cartId,
  userId,
  tenantId,
  shippingAddress = {},
}) => {
  const tenantObjectId = normalizeObjectIdOrThrow({
    value: tenantId,
    field: 'tenantId',
  })

  const userObjectId = normalizeObjectIdOrThrow({
    value: userId,
    field: 'userId',
  })

  const cart = await validateCartBelongsToTenant(cartId, userId, tenantId)

  let subtotalCents = 0
  let currency = null
  const orderProducts = []

  for (const item of cart.products || []) {
    const product = item.productId

    if (!product) {
      throw buildHttpError({
        message: 'Producto no disponible en carrito',
        statusCode: 404,
        code: 'PRODUCT_NOT_FOUND',
      })
    }

    const count = normalizeCount(item.quantity)
    const variant = findVariant({ product, item })

    if (product.hasVariants && !variant) {
      throw buildHttpError({
        message: `La variante seleccionada ya no existe para "${product.title}"`,
        statusCode: 409,
        code: 'VARIANT_NOT_FOUND',
      })
    }

    if (variant && variant.isActive === false) {
      throw buildHttpError({
        message: `La variante seleccionada está inactiva para "${product.title}"`,
        statusCode: 409,
        code: 'VARIANT_INACTIVE',
      })
    }

    const price = getLinePrice({ product, variant })

    if (!Number.isFinite(price) || price <= 0) {
      throw buildHttpError({
        message: `Precio inválido para "${product.title}"`,
        statusCode: 400,
        code: 'INVALID_PRODUCT_PRICE',
      })
    }

    const originalPrice = getLineOriginalPrice({
      product,
      variant,
      price,
    })

    const priceCents = Money.fromDecimal(price)
    const originalPriceCents = Money.fromDecimal(originalPrice)
    const itemSubtotal = Money.multiply(priceCents, count)
    const originalSubtotalCents = Money.multiply(originalPriceCents, count)

    const lineCurrency = String(
      item.currency ||
        product.currency ||
        cart.currency ||
        DEFAULT_CURRENCY,
    ).toUpperCase()

    if (!currency) {
      currency = lineCurrency
    }

    if (currency !== lineCurrency) {
      throw buildHttpError({
        message: 'Todas las líneas deben usar la misma moneda',
        statusCode: 400,
        code: 'MIXED_CURRENCIES_NOT_ALLOWED',
      })
    }

    subtotalCents += itemSubtotal

    orderProducts.push({
      tenantId: tenantObjectId,
      product: product._id,
      count,
      color:
        item.colorId && isValidObjectId(item.colorId)
          ? toObjectId(item.colorId)
          : null,

      titleSnapshot: product.title,
      slugSnapshot: product.slug || null,
      imageSnapshot: getVariantImageUrl(variant) || getProductImageUrl(product),
      skuSnapshot: variant?.sku || product.sku || null,

      variantId: variant?._id || null,
      variantKey: variant?.key || null,
      variantSku: variant?.sku || null,
      selectedAttributes: selectedAttributesToObject(
        item.selectedAttributes ||
          item.variantAttributes ||
          item.selectedVariant?.attributes,
      ),

      priceCents,
      originalPriceCents,
      discountPercentage: 0,
      promotionId: null,
      promotionTitle: null,
      promotionType: null,
      subtotalCents: itemSubtotal,
      originalSubtotalCents,
      currency: lineCurrency,
    })
  }

  if (!orderProducts.length) {
    throw buildHttpError({
      message: 'El carrito está vacío',
      statusCode: 400,
      code: 'CART_EMPTY',
    })
  }

  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) {
    throw buildHttpError({
      message: 'Monto inválido para crear orden',
      statusCode: 400,
      code: 'INVALID_ORDER_AMOUNT',
    })
  }

  const shipping = buildShippingAddress({
    shippingAddress,
    cart,
  })

  const order = new Order({
    tenantId: tenantObjectId,
    idempotencyKey: getOrderIdempotencyKey(),
    orderby: userObjectId,

    products: orderProducts,

    paymentIntent: {
      id: getPaymentIntentId(),
      provider: 'mercadopago',
      status: PAYMENT_STATUS.PENDING,
      method: null,
      currency: currency || cart.currency || DEFAULT_CURRENCY,
      amountCents: subtotalCents,
      originalAmountCents: subtotalCents,
      discountAmountCents: 0,
    },

    paymentStatus: PAYMENT_STATUS.PENDING,
    fulfillmentStatus: FULFILLMENT_STATUS.UNFULFILLED,
    refundStatus: REFUND_STATUS.NONE,

    customerSnapshot: buildCustomerSnapshot({
      userId,
      shipping,
    }),

    shippingAddress: shipping,
  })

  order.addAuditEntry?.({
    action: 'created',
    performedBy: userObjectId,
    performedByRole: 'customer',
    metadata: {
      source: 'checkout',
      provider: 'mercadopago',
      paymentStatus: PAYMENT_STATUS.PENDING,
      amountCents: subtotalCents,
      currency: currency || cart.currency || DEFAULT_CURRENCY,
      lines: orderProducts.length,
    },
  })

  await order.save({ tenantId })

  return order
}

// =====================================================
// APPLY MERCADO PAGO STATUS
// =====================================================

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
  if (!order) {
    throw buildHttpError({
      message: 'Orden inválida para aplicar estado de pago',
      statusCode: 400,
      code: 'ORDER_INVALID',
    })
  }

  const normalizedPaymentStatus = normalizeMpStatus(mpStatus)

  if (!normalizedPaymentStatus) {
    throw buildHttpError({
      message: `Estado de Mercado Pago no soportado: ${mpStatus}`,
      statusCode: 400,
      code: 'MP_STATUS_UNSUPPORTED',
    })
  }

  ensurePaymentIntentObject(order)

  const currentStatus = order.paymentStatus || PAYMENT_STATUS.PENDING
  const previousOrderStatus = order.orderStatus

  if (!canApplyPaymentTransition(currentStatus, normalizedPaymentStatus)) {
    order.addAuditEntry?.({
      action: 'modified',
      performedByRole: 'system',
      reason: 'Transición de pago ignorada por regla de estado final',
      metadata: {
        source: 'mercadopago',
        currentStatus,
        attemptedStatus: normalizedPaymentStatus,
        providerRawStatus: getProviderRawStatus(providerRawStatus || mpStatus),
        providerPaymentId: providerPaymentId ? String(providerPaymentId) : null,
      },
    })

    return order
  }

  order.paymentStatus = normalizedPaymentStatus
  order.paymentIntent.status = normalizedPaymentStatus

  if (providerPaymentId) {
    order.paymentIntent.providerPaymentId = String(providerPaymentId)
  }

  if (providerRawStatus || mpStatus) {
    order.paymentIntent.providerRawStatus = getProviderRawStatus(
      providerRawStatus || mpStatus,
    )
  }

  if (statusDetail) {
    order.paymentIntent.statusDetail = sanitizeString(statusDetail).slice(0, 100)
  }

  if (paymentMethodId) {
    order.paymentIntent.method = sanitizeString(paymentMethodId).toLowerCase().slice(0, 50)
  }

  if (installments !== null && installments !== undefined) {
    const parsedInstallments = Number(installments)

    if (Number.isFinite(parsedInstallments) && parsedInstallments > 0) {
      order.paymentIntent.installments = Math.min(parsedInstallments, 12)
    }
  }

  if (payerEmail) {
    const normalizedPayerEmail = normalizeEmail(payerEmail)

    if (isValidEmail(normalizedPayerEmail)) {
      order.paymentIntent.payerEmail = normalizedPayerEmail
    }
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED) {
    if (!order.paidAt) {
      order.paidAt = new Date()
    }

    order.paymentError = null
    order.paymentErrorCode = null
    order.lastPaymentAttemptAt = new Date()
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.REJECTED) {
    order.paymentError = order.paymentError || 'Pago rechazado por Mercado Pago'
    order.paymentErrorCode = order.paymentErrorCode || 'PAYMENT_REJECTED'
    order.lastPaymentAttemptAt = new Date()
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.CANCELLED) {
    if (!order.cancellation) {
      order.cancellation = {}
    }

    order.cancellation.cancelled = true
    order.cancellation.cancelledAt =
      order.cancellation.cancelledAt || new Date()
    order.cancellation.reason =
      order.cancellation.reason || 'Cancelado por Mercado Pago'

    order.lastPaymentAttemptAt = new Date()
  }

  if (normalizedPaymentStatus === PAYMENT_STATUS.REFUNDED) {
    order.refundStatus = REFUND_STATUS.REFUNDED
  }

  order.syncDerivedState?.()

  order.addAuditEntry?.({
    action: 'payment_updated',
    performedByRole: 'system',
    previousState: {
      paymentStatus: currentStatus,
      orderStatus: previousOrderStatus,
    },
    newState: {
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
    },
    metadata: {
      source: 'mercadopago',
      providerRawStatus: getProviderRawStatus(providerRawStatus || mpStatus),
      providerPaymentId: providerPaymentId ? String(providerPaymentId) : null,
      paymentMethodId: paymentMethodId || null,
      statusDetail: statusDetail || null,
      installments:
        installments !== null && installments !== undefined
          ? Number(installments)
          : null,
    },
  })

  return order
}