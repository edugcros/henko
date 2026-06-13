// 📁 src/controller/orderCtrl.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / MERCADO PAGO SAFE / VARIANTES / CUPONES / SNAPSHOTS

import mongoose from 'mongoose'
import expressAsyncHandler from 'express-async-handler'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'

import {
  dispatchOrderCreationEmails,
  resendOrderConfirmationEmail,
} from '../services/orderEmailService.js'
import {
  consumeCouponAtomic,
  createCouponUsageRecord,
  ensureCouponUsageAllowedForUser,
  evaluateCouponDiscount,
  findUsableCouponByCode,
  findUsableCouponById,
} from '../services/orderCouponService.js'
import {
  calculateCartLines,
  clearCart,
  validateCartOwnership,
} from '../services/orderCartService.js'
import {
  decrementStockForLines,
} from '../services/orderInventoryService.js'
import { releaseReservedStock } from '../services/paymentOrderOpsService.js'

import Order, {
  ORDER_STATUS,
  PAYMENT_STATUS,
  FULFILLMENT_STATUS,
  REFUND_STATUS,
} from '../models/orderModel.js'
import Cart from '../models/cartModel.js'
import {
  getActorIdFromRequest,
  getUserIdFromRequest as getRequestUserId,
  isValidObjectId,
  resolveAuthorizedTenantFromRequest,
  toObjectId,
} from '../utils/requestContext.js'
import {
  ensureAdminOrManager,
  runOrderTransaction,
  validateUserTenantMembership,
} from '../services/orderExecutionService.js'
import { buildAdminOrdersQuery } from '../services/orderAdminQueryService.js'
import {
  appendOrderAdminAuditEntry,
  cancelOrderWithInventoryRestore,
  findOrderForAdminMutation,
  orderRequiresForceDeletion,
  refundOrderWithInventoryRestore,
} from '../services/orderAdminMutationService.js'

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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const LEGACY_TO_ORDER_STATUS = {
  [LEGACY_ORDER_STATUS.PAYMENT_PENDING]: ORDER_STATUS.OPEN,
  [LEGACY_ORDER_STATUS.NOT_PROCESSED]: ORDER_STATUS.OPEN,
  [LEGACY_ORDER_STATUS.PROCESSING]: ORDER_STATUS.PROCESSING,
  [LEGACY_ORDER_STATUS.DISPATCHED]: ORDER_STATUS.SHIPPED,
  [LEGACY_ORDER_STATUS.DELIVERED]: ORDER_STATUS.DELIVERED,
  [LEGACY_ORDER_STATUS.CANCELLED]: ORDER_STATUS.CANCELLED,
  [LEGACY_ORDER_STATUS.REFUNDED]: ORDER_STATUS.REFUNDED,
}

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

const isValidId = isValidObjectId

const normalizeObjectId = value => {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  if (!isValidId(value)) return null
  return toObjectId(value)
}

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const normalizeEmail = value => String(value || '').trim().toLowerCase()

const sanitizePhone = value => {
  return sanitizeString(value).slice(0, 50)
}

const sanitizeCountryCode = value => {
  return sanitizeString(value || 'AR').slice(0, 2).toUpperCase() || 'AR'
}

const validateEmailOrThrow = email => {
  const normalized = normalizeEmail(email)

  if (!EMAIL_REGEX.test(normalized)) {
    throw new Error('Email inválido')
  }

  return normalized
}

const getUserIdFromRequest = req => {
  const userId = getRequestUserId(req)
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

const mapToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const normalizeOrderStatusInput = value => {
  const normalized = sanitizeString(value).toLowerCase()
  return LEGACY_TO_ORDER_STATUS[normalized] || normalized
}

const assertPaymentApprovedForFulfillment = order => {
  if (order.paymentStatus !== PAYMENT_STATUS.APPROVED) {
    const error = new Error(
      'No se puede avanzar la preparación o envío de una orden sin pago aprobado',
    )
    error.statusCode = 400
    throw error
  }
}

// =====================================================
// RATE LIMITER POR TENANT
// =====================================================

export const orderWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: req => (['admin', 'manager'].includes(req.user?.role) ? 100 : 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => {
    const userId = getActorIdFromRequest(req, 'anonymous')
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
  return resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
    missingTenantMessage: 'Tenant no resuelto por dominio',
    missingUserTenantMessage: 'El usuario autenticado no tiene tenantId válido',
    mismatchMessage: 'Tenant inconsistente entre usuario autenticado y dominio',
    onMismatch: ({ domainTenantId, userTenantId }) => {
      logger.warn(
        `🚨 Tenant mismatch | user=${getActorIdFromRequest(req, 'anonymous')} | userTenant=${userTenantId} | domainTenant=${domainTenantId} | ip=${req.ip} | endpoint=${req.method} ${req.originalUrl}`,
      )
    },
  })
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

// =====================================================
// HELPERS SHIPPING / CREACIÓN
// =====================================================

const buildShippingAddress = ({ req, body }) => {
  const shippingAddress = body?.shippingAddress || {}

  const result = {
    firstName: sanitizeString(shippingAddress.firstName || req.user?.firstname),
    lastName: sanitizeString(shippingAddress.lastName || req.user?.lastname),
    email: validateEmailOrThrow(shippingAddress.email || req.user?.email),
    phone: sanitizePhone(shippingAddress.phone || req.user?.mobile),
    address: sanitizeString(shippingAddress.address).slice(0, 255),
    city: sanitizeString(shippingAddress.city).slice(0, 100),
    zipCode: sanitizeString(shippingAddress.zipCode).slice(0, 20),
    country: sanitizeCountryCode(shippingAddress.country),
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

const buildCustomerSnapshot = ({ user, shippingAddress }) => ({
  userId: user._id,
  firstname:
    shippingAddress.firstName ||
    user.firstname ||
    user.firstName ||
    '',
  lastname:
    shippingAddress.lastName ||
    user.lastname ||
    user.lastName ||
    '',
  email: normalizeEmail(shippingAddress.email),
  mobile:
    shippingAddress.phone ||
    user.mobile ||
    user.phone ||
    '',
  validatedAt: new Date(),
})

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
        money: Money,
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
          money: Money,
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
        customerSnapshot: buildCustomerSnapshot({
          user,
          shippingAddress,
        }),
        shippingAddress,
        paidAt: isCOD ? new Date() : null,
        stockCommittedAt: isCOD ? new Date() : null,

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
    await dispatchOrderCreationEmails({
      order: createdOrder,
      buyerEmail:
        createdOrder.shippingAddress?.email ||
        createdOrder.customerSnapshot?.email,
    })
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

  const result = await resendOrderConfirmationEmail({
    order,
    tenantId: tenantObjectId,
    buyerEmail:
      order.shippingAddress?.email ||
      order.customerSnapshot?.email,
  })

  if (result?.success) {
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
  const query = {
    tenantId: tenantObjectId,
    orderby: normalizeObjectId(userId),
    isDeleted: false,
  }

  const requestedOrderStatus = normalizeOrderStatusInput(req.query.status)
  const requestedPaymentStatus = sanitizeString(
    req.query.paymentStatus,
  ).toLowerCase()
  const requestedFulfillmentStatus = sanitizeString(
    req.query.fulfillmentStatus,
  ).toLowerCase()

  if (Object.values(ORDER_STATUS).includes(requestedOrderStatus)) {
    query.orderStatus = requestedOrderStatus
  }

  if (Object.values(PAYMENT_STATUS).includes(requestedPaymentStatus)) {
    query.paymentStatus = requestedPaymentStatus
  }

  if (
    Object.values(FULFILLMENT_STATUS).includes(requestedFulfillmentStatus)
  ) {
    query.fulfillmentStatus = requestedFulfillmentStatus
  }

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .setOptions({ tenantId }),

    Order.countDocuments(query).setOptions({ tenantId }),
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

export const getOrderById = expressAsyncHandler(async (req, res) => {
  const userId = getUserIdFromRequest(req)

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'No autorizado',
    })
  }

  const { tenantId, tenantObjectId } = resolveTenantContext(req)
  const { orderId } = req.params

  if (!isValidId(orderId)) {
    return res.status(400).json({
      success: false,
      message: 'ID de orden inválido',
    })
  }

  const order = await Order.findOne({
    _id: normalizeObjectId(orderId),
    tenantId: tenantObjectId,
    orderby: normalizeObjectId(userId),
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
    data: enrichOrderForResponse(order),
  })
})

// =====================================================
// STATUS UPDATES
// =====================================================

export const updateOrderStatus = expressAsyncHandler(async (req, res) => {
  try {
    ensureAdminOrManager(req)

    const { tenantId, tenantObjectId } = resolveTenantContext(req)
    const performedBy = normalizeObjectId(getUserIdFromRequest(req))

    const order = await findOrderForAdminMutation({
      orderModel: Order,
      orderId: req.params.id,
      tenantObjectId,
      tenantId,
      normalizeObjectId,
      isValidId,
    })

    const currentStatus = String(order.orderStatus || '').toLowerCase()

    const nextStatus = normalizeOrderStatusInput(
      req.body?.orderStatus ?? req.body?.status ?? req.body?.nextStatus,
    )

    if (!Object.values(ORDER_STATUS).includes(nextStatus)) {
      return res.status(400).json({
        success: false,
        message: `Estado inválido. Permitidos: ${Object.values(
          ORDER_STATUS,
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

    if (nextStatus === ORDER_STATUS.CANCELLED) {
      return cancelOrder(req, res)
    }

    if (nextStatus === ORDER_STATUS.REFUNDED) {
      return refundOrder(req, res)
    }

    const finalStatuses = [
      ORDER_STATUS.CANCELLED,
      ORDER_STATUS.REFUNDED,
    ]

    if (finalStatuses.includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'No se puede modificar una orden cancelada o reembolsada',
      })
    }

    if (nextStatus === ORDER_STATUS.OPEN) {
      if (order.fulfillmentStatus !== FULFILLMENT_STATUS.UNFULFILLED) {
        return res.status(400).json({
          success: false,
          message: 'No se puede volver una orden procesada a no procesada',
        })
      }
    }

    if (nextStatus === ORDER_STATUS.PROCESSING) {
      assertPaymentApprovedForFulfillment(order)

      if (order.fulfillmentStatus === FULFILLMENT_STATUS.UNFULFILLED) {
        await order.updateFulfillmentStatus(FULFILLMENT_STATUS.PREPARING, {
          tenantId,
          performedBy,
          req,
          reason: 'Cambio manual a processing',
        })
      }
    }

    if (nextStatus === ORDER_STATUS.SHIPPED) {
      assertPaymentApprovedForFulfillment(order)

      await order.updateFulfillmentStatus(FULFILLMENT_STATUS.SHIPPED, {
        tenantId,
        performedBy,
        req,
        reason: 'Cambio manual a dispatched',
      })
    }

    if (nextStatus === ORDER_STATUS.DELIVERED) {
      assertPaymentApprovedForFulfillment(order)

      await order.updateFulfillmentStatus(FULFILLMENT_STATUS.DELIVERED, {
        tenantId,
        performedBy,
        req,
        reason: 'Cambio manual a delivered',
      })
    }

    appendOrderAdminAuditEntry({
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

    order.syncDerivedState()
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

    const order = await findOrderForAdminMutation({
      orderModel: Order,
      orderId: req.params.id,
      tenantObjectId,
      tenantId,
      normalizeObjectId,
      isValidId,
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

    if (nextPaymentStatus === PAYMENT_STATUS.REFUNDED) {
      return res.status(400).json({
        success: false,
        code: 'USE_REFUND_FLOW',
        message:
          'El reembolso debe ejecutarse desde la acción de reembolso para preservar inventario y auditoría',
      })
    }

    if (
      nextPaymentStatus === PAYMENT_STATUS.APPROVED &&
      order.paymentStatus === PAYMENT_STATUS.PENDING &&
      !order.stockCommittedAt
    ) {
      await decrementStockForLines({
        lines: order.products,
        tenantId,
      })

      order.stockCommittedAt = new Date()
      order.stockReservedAt = null
    }

    if (
      [PAYMENT_STATUS.REJECTED, PAYMENT_STATUS.CANCELLED].includes(
        nextPaymentStatus,
      ) &&
      order.paymentStatus === PAYMENT_STATUS.PENDING &&
      order.stockReservedAt
    ) {
      await releaseReservedStock(order.products, tenantId)
      order.stockReservedAt = null
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

    const order = await findOrderForAdminMutation({
      orderModel: Order,
      orderId: req.params.id,
      tenantObjectId,
      tenantId,
      normalizeObjectId,
      isValidId,
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

    const order = await findOrderForAdminMutation({
      orderModel: Order,
      orderId,
      tenantObjectId,
      tenantId,
      normalizeObjectId,
      isValidId,
      includeDeleted: true,
    })

    const {
      protectedOrder,
      paymentStatus,
      orderStatus,
      fulfillmentStatus,
    } = orderRequiresForceDeletion({
      order,
      legacyOrderStatus: LEGACY_ORDER_STATUS,
    })

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

    order.isDeleted = true
    order.deletedAt = new Date()
    order.deletedBy = performedBy
    order.deleteReason = reason

    appendOrderAdminAuditEntry({
      order,
      action: 'soft_deleted',
      req,
      performedBy,
      reason,
      metadata: {
        force,
        paymentStatus,
        orderStatus,
        fulfillmentStatus,
        protectedOrder,
      },
    })

    await order.save({ tenantId })

    logger.warn('🗑️ Orden ocultada mediante eliminación lógica', {
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

    return res.status(200).json({
      success: true,
      message: 'Orden eliminada del panel y preservada para auditoría',
      data: {
        id: String(order._id),
        hardDeleted: false,
        softDeleted: true,
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
      return cancelOrderWithInventoryRestore({
        orderModel: Order,
        orderId: req.params.id,
        tenantObjectId,
        tenantId,
        session,
        cancelledBy,
        reason,
        req,
        normalizeObjectId,
        isValidId,
      })
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
      return refundOrderWithInventoryRestore({
        orderModel: Order,
        orderId: req.params.id,
        tenantObjectId,
        tenantId,
        session,
        performedBy,
        reason: sanitizeString(req.body?.reason, 'Reembolso manual'),
        req,
        normalizeObjectId,
        isValidId,
      })
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
      query,
      filters,
      sorting,
    } = await buildAdminOrdersQuery({
      tenantObjectId,
      queryParams: req.query,
      money: Money,
    })

    const [orders, total] = await Promise.all([
      Order.find(query)
        .sort({ [sorting.field]: sorting.direction === 'asc' ? 1 : -1 })
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
        filters,
        sorting,
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
