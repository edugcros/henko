// 📁 src/controller/paymentController.js
// VERSIÓN GO PRODUCCIÓN - MULTI-TENANT / MERCADO PAGO / WEBHOOK / EMAILS / STOCK / CARRITO

import crypto from 'node:crypto'

import Order, {
  PAYMENT_STATUS,
} from '../models/orderModel.js'
import User from '../models/userModel.js'

import { Money } from '../utils/money.js'
import {
  getUserIdFromRequest,
  isValidObjectId,
  resolveAuthorizedTenantFromRequest,
  toObjectId,
} from '../utils/requestContext.js'
import {
  acquirePaymentLock,
  checkPaymentRateLimit,
  releasePaymentLock,
} from '../services/paymentConcurrencyService.js'
import {
  clearUserCartAfterApprovedPayment,
  confirmSoldStock,
  releaseReservedStock,
  reserveStockAtomic,
} from '../services/paymentOrderOpsService.js'
import {
  dispatchApprovedPaymentEmails,
} from '../services/paymentEmailService.js'
import {
  buildMercadoPagoPaymentData,
  getStatusMessage,
  mapMercadoPagoError,
  NEGATIVE_PAYMENT_STATUSES,
} from '../services/paymentMercadoPagoService.js'
import {
  createMercadoPagoPaymentClient,
  getTenantMercadoPagoContext,
  getTenantPaymentPublicConfig,
  getTenantConfig,
} from '../services/paymentTenantConfigService.js'
import {
  applyMercadoPagoStatusToOrder,
  createOrderFromCart,
} from '../services/paymentOrderService.js'
import {
  isWebhookProcessed,
  markWebhookProcessed,
  resolveWebhookOrderIdentity,
  verifyMercadoPagoWebhookSignature,
} from '../services/paymentWebhookService.js'
import logger from '../../config/logger.js'

// =====================================================
// CONSTANTES
// =====================================================

const isProd = process.env.NODE_ENV === 'production'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

const getUserId = getUserIdFromRequest

const getSafeErrorMessage = error => {
  return error?.message || 'Error inesperado'
}

const resolveAuthenticatedBuyerEmail = async ({
  userId,
  tenantId,
  fallbackOrder = null,
}) => {
  const user = await User.findOne({
    _id: toObjectId(userId),
    tenantId: toObjectId(tenantId),
    isBlocked: { $ne: true },
  })
    .select('email')
    .lean()

  const email = [
    fallbackOrder?.shippingAddress?.email,
    fallbackOrder?.customerSnapshot?.email,
    fallbackOrder?.paymentIntent?.payerEmail,
    user?.email,
  ]
    .map(normalizeEmail)
    .find(candidate => candidate && isValidEmail(candidate))

  if (!email || !isValidEmail(email)) {
    const error = new Error('El usuario comprador no tiene un email válido')
    error.statusCode = 400
    error.code = 'BUYER_EMAIL_INVALID'
    throw error
  }

  return email
}

const buildPaymentIdempotencyKey = ({ order, tenantId, token }) => {
  const digest = crypto
    .createHash('sha256')
    .update(
      [
        String(tenantId),
        String(order?._id || ''),
        String(order?.paymentIntent?.id || ''),
        String(token || ''),
      ].join(':'),
    )
    .digest('hex')
    .slice(0, 32)

  return `pay_${digest}`
}

const applyProviderPaymentResult = async ({
  order,
  mpPayment,
  tenantId,
  userId,
  buyerEmail,
  tenantConfig = null,
}) => {
  const previousStatus = order.paymentStatus

  applyMercadoPagoStatusToOrder({
    order,
    mpStatus: mpPayment.status,
    providerPaymentId: mpPayment.id,
    paymentMethodId:
      mpPayment.payment_method_id || order.paymentIntent?.method,
    installments:
      mpPayment.installments ?? order.paymentIntent?.installments,
    payerEmail: buyerEmail,
    statusDetail: mpPayment.status_detail,
    providerRawStatus: mpPayment.status,
  })

  if (
    order.paymentStatus === PAYMENT_STATUS.APPROVED &&
    !order.stockCommittedAt
  ) {
    await confirmSoldStock(order.products, tenantId)
    order.stockCommittedAt = new Date()
    order.stockReservedAt = null
  } else if (
    NEGATIVE_PAYMENT_STATUSES.has(order.paymentStatus) &&
    order.stockReservedAt
  ) {
    await releaseReservedStock(order.products, tenantId)
    order.stockReservedAt = null
  }

  await order.save({ tenantId })

  let emailResult = null

  if (order.paymentStatus === PAYMENT_STATUS.APPROVED) {
    await clearUserCartAfterApprovedPayment({
      userId,
      tenantId,
    })

    try {
      emailResult = await dispatchApprovedPaymentEmails({
        order,
        buyerEmail,
        tenantConfig: tenantConfig || await getTenantConfig(tenantId),
        context: {
          user: {
            _id: userId,
            email: buyerEmail,
          },
          payer: {
            email: buyerEmail,
          },
        },
      })
    } catch (error) {
      logger.error('❌ Pago aprobado, pero falló la notificación por email', {
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
        message: getSafeErrorMessage(error),
      })

      emailResult = {
        customerEmailSent: false,
        adminEmailSent: false,
        error: getSafeErrorMessage(error),
      }
    }
  }

  return {
    previousStatus,
    paymentStatus: order.paymentStatus,
    emailResult,
  }
}

// =====================================================
// TENANT CONTEXT
// =====================================================

const resolveTenantContext = req => {
  return resolveAuthorizedTenantFromRequest(req, {
    allowPrivilegedRoleBypass: true,
    missingTenantMessage: 'TENANT_INVALIDO: No se pudo identificar el comercio',
    mismatchMessage: 'TENANT_MISMATCH: No tienes acceso a este comercio',
    onMismatch: ({ domainTenantId, userTenantId }) => {
      logger.warn('🚨 ACCESO CRUZADO DETECTADO', {
        userId: req.user?._id?.toString?.(),
        userEmail: req.user?.email,
        userTenantId,
        requestTenantId: domainTenantId,
        ip: req.ip,
      })
    },
  })
}

export const getPaymentPublicConfig = async (req, res) => {
  try {
    const tenantId = String(req.tenantId || req.tenant?._id || '')

    if (!isValidObjectId(tenantId)) {
      return res.status(400).json({
        success: false,
        code: 'TENANT_INVALID',
        message: 'No se pudo identificar el comercio',
      })
    }

    const config = await getTenantPaymentPublicConfig(tenantId)

    return res.status(200).json({
      success: true,
      data: config,
    })
  } catch (error) {
    logger.error('❌ Error obteniendo configuración pública de pago', {
      tenantId: String(req.tenantId || req.tenant?._id || ''),
      message: getSafeErrorMessage(error),
    })

    return res.status(error.statusCode || 500).json({
      success: false,
      code: 'PAYMENT_CONFIG_UNAVAILABLE',
      message: getSafeErrorMessage(error),
    })
  }
}

// CONTROLLER: PROCESS PAYMENT
// =====================================================

export const processPayment = async (req, res) => {
  const body = req.body || {}

  const bodyOrderId = body.orderId || body.order_id || null
  const bodyCartId = body.cartId || body.cart_id || null

  const token = sanitizeString(body.token)
  const paymentMethodId = sanitizeString(
    body.paymentMethodId || body.payment_method_id,
  )
  const issuerId = sanitizeString(body.issuerId || body.issuer_id)
  const installments = body.installments
  const payer = body.payer || {}
  const shippingAddress = body.shippingAddress || body.shipping_address || {}

  const orderId = bodyOrderId || null
  const cartId = bodyCartId || null
  const lockResourceId = orderId || cartId || crypto.randomUUID()

  let order = null
  let tenantId = null
  let stockReserved = false
  let lockAcquired = false
  let mappedError = null

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

    if (String(token).trim().length < 10) {
      return res.status(400).json({
        success: false,
        code: 'CARD_TOKEN_INVALID',
        message: 'Token de tarjeta inválido',
      })
    }

    const [tenantConfig, mercadoPagoContext] = await Promise.all([
      getTenantConfig(tenantId),
      getTenantMercadoPagoContext(tenantId),
    ])

    if (cartId && !orderId) {
      order = await createOrderFromCart({
        cartId,
        userId,
        tenantId,
        shippingAddress,
      })

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

    const buyerEmail = await resolveAuthenticatedBuyerEmail({
      userId,
      tenantId,
      fallbackOrder: order,
    })

    if (order.paymentStatus === PAYMENT_STATUS.APPROVED) {
      return res.status(409).json({
        success: false,
        code: 'ORDER_ALREADY_PAID',
        message: 'La orden ya fue pagada',
      })
    }

    if (!order.paymentIntent?.id) {
      order.paymentIntent = {
        ...(order.paymentIntent || {}),
        id: crypto.randomUUID(),
      }
    }

    if (!order.stockReservedAt && !order.stockCommittedAt) {
      await reserveStockAtomic(order.products, tenantId)
      stockReserved = true
      order.stockReservedAt = new Date()
      await order.save({ tenantId })
    }

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
      payer: {
        ...payer,
        email: buyerEmail,
      },
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

    const payment = createMercadoPagoPaymentClient(
      mercadoPagoContext.accessToken,
    )

    /**
     * Idempotency key corta.
     * Evita claves largas tipo tenantId_orderId_uuid que pueden generar
     * comportamiento inconsistente en proveedores externos.
     */
    const idempotencyKey = buildPaymentIdempotencyKey({
      order,
      tenantId,
      token,
    })

    let mpPayment

    try {
      mpPayment = await payment.create({
        body: paymentData,
        requestOptions: {
          idempotencyKey,
        },
      })
    } catch (mpError) {
      logger.error('❌ RAW MP SDK ERROR FULL', {
        name: mpError?.name,
        message: mpError?.message,
        status: mpError?.status,
        statusCode: mpError?.statusCode,
        code: mpError?.code,
        cause: mpError?.cause,
        api_response: mpError?.api_response,
        response: mpError?.response
          ? {
            status: mpError.response.status,
            data: mpError.response.data,
            headers: mpError.response.headers,
          }
          : null,
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
        idempotencyKey,
      })

      throw mpError
    }

    logger.info('✅ Mercado Pago respondió', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      mpPaymentId: mpPayment.id,
      mpStatus: mpPayment.status,
      statusDetail: mpPayment.status_detail,
    })

    const settlement = await applyProviderPaymentResult({
      order,
      mpPayment: {
        ...mpPayment,
        payment_method_id: paymentMethodId,
        installments: validatedInstallments,
      },
      tenantId,
      userId,
      buyerEmail,
      tenantConfig,
    })

    stockReserved = false

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
      emailSent: Boolean(settlement.emailResult?.customerEmailSent),
    })
  } catch (error) {
    if (stockReserved && order) {
      try {
        await releaseReservedStock(order.products, tenantId)
        order.stockReservedAt = null
        stockReserved = false
      } catch (releaseError) {
        logger.error('❌ Error liberando stock tras fallo de pago', {
          message: getSafeErrorMessage(releaseError),
          tenantId: tenantId ? String(tenantId) : null,
          orderId: order?._id?.toString?.() || bodyOrderId || null,
        })
      }
    }

    logger.error('❌ PAYMENT ERROR DETALLADO', {
      message: error?.message,
      name: error?.name,
      status: error?.status,
      statusCode: error?.statusCode,
      cause: error?.cause,
      code: error?.code,
      api_response: error?.api_response,
      response: error?.response,
      tenantId: tenantId ? String(tenantId) : null,
      orderId: order?._id?.toString?.() || bodyOrderId || null,
    })

    mappedError = mapMercadoPagoError(error)

    if (order && order.paymentStatus !== PAYMENT_STATUS.APPROVED) {
      try {
        order.paymentError = getSafeErrorMessage(error)
        order.paymentErrorCode = mappedError.code
        order.lastPaymentAttemptAt = new Date()

        order.addAuditEntry?.({
          action: 'payment_failed',
          performedByRole: 'system',
          reason: mappedError.message,
          metadata: {
            code: mappedError.code,
            details: mappedError.details,
            provider: 'mercadopago',
            originalMessage: error?.message || null,
            status: error?.status || error?.statusCode || null,
          },
        })

        await order.save({ tenantId: order.tenantId })
      } catch (saveError) {
        logger.error('❌ Error guardando estado de error', {
          message: getSafeErrorMessage(saveError),
          orderId: order?._id?.toString?.(),
        })
      }
    }

    return res.status(mappedError.status).json({
      success: false,
      code: mappedError.code,
      message: mappedError.message,
      details: mappedError.details,
      status: mappedError.status,
      debug: isProd
        ? undefined
        : {
          originalMessage: error?.message,
          name: error?.name,
          status: error?.status || error?.statusCode,
          code: error?.code,
          cause: error?.cause,
          apiResponse: error?.api_response,
          response: error?.response,
        },
    })
  } finally {
    if (lockAcquired) {
      await releasePaymentLock(lockResourceId, tenantId)
    }
  }
}

// =====================================================
// CONTROLLER: WEBHOOK
// =====================================================

export const mpWebhook = async (req, res) => {
  try {
    if (!verifyMercadoPagoWebhookSignature(req)) {
      logger.warn('⚠️ Webhook Mercado Pago con firma inválida')
      return res.status(401).json({ success: false })
    }

    const paymentId =
      req.body?.data?.id ||
      req.query['data.id'] ||
      req.query.id

    if (!paymentId) {
      logger.warn('⚠️ Webhook sin paymentId')
      return res.status(400).json({ success: false })
    }

    const webhookRequestId =
      sanitizeString(req.headers['x-request-id']) ||
      sanitizeString(req.body?.id) ||
      crypto
        .createHash('sha256')
        .update(JSON.stringify(req.body || req.query || {}))
        .digest('hex')
        .slice(0, 24)

    const webhookId = `mp_${paymentId}_${webhookRequestId}`

    if (await isWebhookProcessed(webhookId)) {
      logger.info('Webhook ya procesado, ignorando', {
        webhookId,
        paymentId: String(paymentId),
      })
      return res.status(200).json({ success: true, duplicate: true })
    }

    const rawIdentity = await resolveWebhookOrderIdentity(paymentId)

    if (!rawIdentity?._id || !rawIdentity?.tenantId) {
      logger.warn('⚠️ Webhook: orden no encontrada para pago', {
        paymentId: String(paymentId),
      })
      return res.status(404).json({ success: false })
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

      return res.status(404).json({ success: false })
    }

    if (String(order.paymentIntent?.providerPaymentId || '') !== String(paymentId)) {
      logger.warn('🚨 Webhook providerPaymentId mismatch', {
        paymentId: String(paymentId),
        orderId: order._id?.toString?.(),
      })

      return res.status(409).json({ success: false })
    }

    const mercadoPagoContext = await getTenantMercadoPagoContext(tenantId)
    const payment = createMercadoPagoPaymentClient(
      mercadoPagoContext.accessToken,
    )
    const mpInfo = await payment.get({ id: paymentId })

    if (!mpInfo?.status) {
      logger.warn('⚠️ Webhook: pago sin estado', {
        paymentId: String(paymentId),
      })

      return res.status(502).json({ success: false })
    }

    const buyerEmail = await resolveAuthenticatedBuyerEmail({
      userId: order.orderby,
      tenantId,
      fallbackOrder: order,
    })
    const settlement = await applyProviderPaymentResult({
      order,
      mpPayment: mpInfo,
      tenantId,
      userId: order.orderby,
      buyerEmail,
    })

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
      previousStatus: settlement.previousStatus,
      newStatus: order.paymentStatus,
    })

    return res.status(200).json({ success: true })
  } catch (error) {
    logger.error('❌ Webhook Error Mercado Pago', {
      message: getSafeErrorMessage(error),
      stack: error.stack,
    })

    return res.status(500).json({ success: false })
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

    if (
      order.paymentStatus === PAYMENT_STATUS.PENDING &&
      order.paymentIntent?.providerPaymentId
    ) {
      const mercadoPagoContext = await getTenantMercadoPagoContext(tenantId)
      const payment = createMercadoPagoPaymentClient(
        mercadoPagoContext.accessToken,
      )
      const mpInfo = await payment.get({
        id: order.paymentIntent.providerPaymentId,
      })
      const buyerEmail = await resolveAuthenticatedBuyerEmail({
        userId,
        tenantId,
        fallbackOrder: order,
      })

      await applyProviderPaymentResult({
        order,
        mpPayment: mpInfo,
        tenantId,
        userId,
        buyerEmail,
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
  getPaymentPublicConfig,
  processPayment,
  mpWebhook,
  getPaymentStatus,
}
