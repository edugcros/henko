// 📁 src/controller/paymentController.js
// VERSIÓN GO PRODUCCIÓN - HARDENED MULTI-TENANT / MERCADO PAGO / WEBHOOK / EMAILS / STOCK / CARRITO

import crypto from 'node:crypto'

import Order, {
  PAYMENT_STATUS,
} from '../models/orderModel.js'

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
  processPendingEmails,
  queuePaymentEmails,
} from '../services/paymentEmailService.js'
import {
  buildMercadoPagoPaymentData,
  getStatusMessage,
  mapMercadoPagoError,
  NEGATIVE_PAYMENT_STATUSES,
} from '../services/paymentMercadoPagoService.js'
import {
  createMercadoPagoPaymentClient,
  getTenantPaymentPublicConfig,
  getTenantConfig,
  getTenantToken,
  getTenantMercadoPagoContext,
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
const isPaymentDebugEnabled =
  !isProd && process.env.PAYMENT_DEBUG_RESPONSE === 'true'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_PAYMENT_LOCK_TTL_SECONDS = 30
const DEFAULT_RECONCILIATION_LOCK_TTL_SECONDS = 20
const DEFAULT_WEBHOOK_LOCK_TTL_SECONDS = 30

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

const isMercadoPagoOrder = order => {
  return (
    sanitizeString(order?.paymentIntent?.provider).toLowerCase() ===
    'mercadopago'
  )
}

const buildStableHash = value => {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 24)
}

const buildPaymentIdempotencyKey = ({ tenantId, order, token }) => {
  const existingPaymentIntentId =
    order?.paymentIntent?.id ||
    order?.paymentIntent?._id ||
    order?.paymentIntent?.attemptId ||
    order?.paymentIntent?.providerPaymentId

  const attemptFingerprint = existingPaymentIntentId || buildStableHash(token)

  return `mp:${tenantId}:${order._id}:${attemptFingerprint}`
}

const getErrorLogPayload = ({ error, tenantId, orderId }) => {
  const basePayload = {
    message: getSafeErrorMessage(error),
    name: error?.name,
    status: error?.status,
    statusCode: error?.statusCode,
    code: error?.code,
    tenantId: tenantId ? String(tenantId) : null,
    orderId: orderId ? String(orderId) : null,
  }

  if (!isPaymentDebugEnabled) return basePayload

  return {
    ...basePayload,
    cause: error?.cause,
    api_response: error?.api_response,
    response: error?.response,
    stack: error?.stack,
  }
}

const buildDebugResponse = error => {
  if (!isPaymentDebugEnabled) return undefined

  return {
    originalMessage: error?.message,
    status: error?.status || error?.statusCode,
    cause: error?.cause,
    apiResponse: error?.api_response,
    response: error?.response,
  }
}

const safelyReleaseReservedStock = async ({ order, tenantId, reason }) => {
  if (!order || !tenantId) return

  try {
    await releaseReservedStock(order.products, tenantId)
    order.stockReservedAt = null
  } catch (releaseError) {
    logger.error('❌ Error liberando stock reservado', {
      reason,
      orderId: order?._id?.toString?.(),
      tenantId: String(tenantId),
      message: getSafeErrorMessage(releaseError),
    })
  }
}

const queueApprovedPaymentSideEffects = async ({
  order,
  tenantId,
  userId,
  payer,
  req,
}) => {
  await clearUserCartAfterApprovedPayment({
    userId: userId || order.orderby,
    tenantId,
  })

  const tenantConfig = await getTenantConfig(tenantId)

  return queuePaymentEmails({
    order,
    payer: payer || { email: order.paymentIntent?.payerEmail },
    req: req || {},
    tenantConfig,
  })
}

const commitApprovedPaymentIfNeeded = async ({
  order,
  tenantId,
  userId,
  payer,
  req,
}) => {
  if (order.paymentStatus !== PAYMENT_STATUS.APPROVED) return null

  if (!order.stockCommittedAt) {
    await confirmSoldStock(order.products, tenantId)
    order.stockCommittedAt = new Date()
  }

  order.stockReservedAt = null
  await order.save({ tenantId })

  return queueApprovedPaymentSideEffects({
    order,
    tenantId,
    userId,
    payer,
    req,
  })
}

const releaseRejectedPaymentReservationIfNeeded = async ({
  order,
  tenantId,
  previousStatus,
}) => {
  if (
    previousStatus === PAYMENT_STATUS.PENDING &&
    NEGATIVE_PAYMENT_STATUSES.has(order.paymentStatus) &&
    order.stockReservedAt &&
    !order.stockCommittedAt
  ) {
    await releaseReservedStock(order.products, tenantId)
    order.stockReservedAt = null
  }
}

// =====================================================
// TENANT CONTEXT
// =====================================================

const resolveTenantContext = (
  req,
  { allowPrivilegedRoleBypass = false } = {},
) => {
  return resolveAuthorizedTenantFromRequest(req, {
    allowPrivilegedRoleBypass,
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

// =====================================================
// CONTROLLER: GET PUBLIC PAYMENT CONFIG
// =====================================================

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

    if (!userId || !isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_AUTHENTICATED',
        message: 'Usuario no autenticado',
      })
    }

    const tenantContext = resolveTenantContext(req, {
      allowPrivilegedRoleBypass: false,
    })
    tenantId = tenantContext.tenantId

    await checkPaymentRateLimit(lockResourceId, userId, tenantId)

    lockAcquired = await acquirePaymentLock(
      lockResourceId,
      tenantId,
      DEFAULT_PAYMENT_LOCK_TTL_SECONDS,
    )

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

    const mercadoPagoContext = await getTenantMercadoPagoContext(tenantId)
    const mpToken = mercadoPagoContext.accessToken

    if (!mpToken) {
      return res.status(503).json({
        success: false,
        code: 'MP_CREDENTIALS_NOT_FOUND',
        message: 'Mercado Pago no está configurado correctamente para este comercio.',
      })
    }

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

    if (order.paymentStatus === PAYMENT_STATUS.APPROVED) {
      return res.status(409).json({
        success: false,
        code: 'ORDER_ALREADY_PAID',
        message: 'La orden ya fue pagada',
      })
    }

    if (!order.stockReservedAt && !order.stockCommittedAt) {
      await reserveStockAtomic(order.products, tenantId)
      stockReserved = true
      order.stockReservedAt = new Date()
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
      mercadoPagoMode: mercadoPagoContext.mode,
      payer,
    })

    logger.info('🚀 Enviando pago a Mercado Pago', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      transactionAmount,
      paymentMethodId: paymentData.payment_method_id,
      installments: paymentData.installments,
      binaryMode: Boolean(paymentData.binary_mode),
      payerEmail: paymentData.payer?.email,
      hasNotificationUrl: Boolean(paymentData.notification_url),
    })

    const payment = createMercadoPagoPaymentClient(mpToken)
    const idempotencyKey = buildPaymentIdempotencyKey({
      tenantId,
      order,
      token,
    })

    const mpPayment = await payment.create({
      body: paymentData,
      requestOptions: {
        idempotencyKey,
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
      stockReserved = false
    } else if (NEGATIVE_PAYMENT_STATUSES.has(normalizedPaymentStatus)) {
      await releaseReservedStock(order.products, tenantId)
      order.stockReservedAt = null
      stockReserved = false
    } else {
      // pending / in_process: mantenemos reserva para resolver vía webhook/job.
      stockReserved = false
    }

    if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED) {
      const emailResult = await commitApprovedPaymentIfNeeded({
        order,
        tenantId,
        userId,
        payer,
        req,
      })

      logger.info('📧 Resultado emails post-pago', {
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
        customerEmailSent: emailResult?.customerEmailSent,
        adminEmailSent: emailResult?.adminEmailSent,
      })
    } else {
      await order.save({ tenantId })
    }

    return res.status(200).json({
      success: true,
      id: mpPayment.id,
      message: getStatusMessage(mpPayment.status),
      amount: transactionAmount,
      installments: validatedInstallments,
      orderId: order._id,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      provider: order.paymentIntent?.provider,
      providerStatus: mpPayment.status,
      providerStatusDetail: mpPayment.status_detail,
      providerPaymentId: mpPayment.id,
      emailQueued: normalizedPaymentStatus === PAYMENT_STATUS.APPROVED,
    })
  } catch (error) {
    if (stockReserved && order) {
      await safelyReleaseReservedStock({
        order,
        tenantId,
        reason: 'processPayment.catch',
      })
      stockReserved = false
    }

    logger.error(
      '❌ PAYMENT ERROR DETALLADO',
      getErrorLogPayload({
        error,
        tenantId,
        orderId: order?._id || bodyOrderId,
      }),
    )

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
      debug: buildDebugResponse(error),
    })
  } finally {
    if (lockAcquired && tenantId) {
      await releasePaymentLock(lockResourceId, tenantId)
    }
  }
}

// =====================================================
// CONTROLLER: WEBHOOK
// =====================================================

export const mpWebhook = async (req, res) => {
  res.status(200).end()

  let webhookLockAcquired = false
  let webhookLockResourceId = null
  let webhookTenantId = null

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
    webhookTenantId = tenantId
    webhookLockResourceId = `webhook:${tenantId}:${rawIdentity._id}:${paymentId}`

    webhookLockAcquired = await acquirePaymentLock(
      webhookLockResourceId,
      tenantId,
      DEFAULT_WEBHOOK_LOCK_TTL_SECONDS,
    )

    if (!webhookLockAcquired) {
      logger.info('Webhook en proceso por otro worker, ignorando temporalmente', {
        webhookId,
        paymentId: String(paymentId),
        tenantId,
      })
      return
    }

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
      await commitApprovedPaymentIfNeeded({
        order,
        tenantId,
        userId: order.orderby,
        payer: { email: order.paymentIntent?.payerEmail },
      })
    } else {
      await releaseRejectedPaymentReservationIfNeeded({
        order,
        tenantId,
        previousStatus,
      })
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
    logger.error(
      '❌ Webhook Error Mercado Pago',
      getErrorLogPayload({
        error,
        tenantId: webhookTenantId,
        orderId: webhookLockResourceId,
      }),
    )
  } finally {
    if (webhookLockAcquired && webhookTenantId && webhookLockResourceId) {
      await releasePaymentLock(webhookLockResourceId, webhookTenantId)
    }
  }
}

// =====================================================
// CONTROLLER: GET PAYMENT STATUS
// =====================================================

export const getPaymentStatus = async (req, res) => {
  let reconciliationLockAcquired = false
  let reconciliationResourceId = null
  let tenantId = null

  try {
    const userId = getUserId(req)

    if (!userId || !isValidObjectId(userId)) {
      return res.status(401).json({
        success: false,
        code: 'USER_NOT_AUTHENTICATED',
        message: 'No autorizado',
      })
    }

    const tenantContext = resolveTenantContext(req, {
      allowPrivilegedRoleBypass: false,
    })
    tenantId = tenantContext.tenantId
    const { tenantObjectId } = tenantContext
    const { orderId } = req.params

    if (!isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        code: 'ORDER_ID_INVALID',
        message: 'ID inválido',
      })
    }

    let order = await Order.findOne({
      _id: toObjectId(orderId),
      tenantId: tenantObjectId,
      orderby: toObjectId(userId),
      isDeleted: false,
    }).setOptions({ tenantId })

    if (!order) {
      return res.status(404).json({
        success: false,
        code: 'ORDER_NOT_FOUND',
        message: 'Orden no encontrada',
      })
    }

    let providerRawStatus =
      sanitizeString(order.paymentIntent?.providerRawStatus).toLowerCase() ||
      null
    let statusDetail =
      sanitizeString(order.paymentIntent?.statusDetail) || null
    const providerPaymentId =
      sanitizeString(order.paymentIntent?.providerPaymentId) || null

    if (isMercadoPagoOrder(order) && providerPaymentId) {
      reconciliationResourceId = `reconcile:${tenantId}:${orderId}`

      reconciliationLockAcquired = await acquirePaymentLock(
        reconciliationResourceId,
        tenantId,
        DEFAULT_RECONCILIATION_LOCK_TTL_SECONDS,
      )

      if (reconciliationLockAcquired) {
        const mpToken = await getTenantToken(tenantId)

        if (!mpToken) {
          return res.status(503).json({
            success: false,
            code: 'MP_CREDENTIALS_NOT_FOUND',
            message:
              'Mercado Pago no está configurado correctamente para este comercio.',
          })
        }

        const paymentClient = createMercadoPagoPaymentClient(mpToken)
        const mpInfo = await paymentClient.get({ id: providerPaymentId })

        if (mpInfo?.status) {
          order = await Order.findOne({
            _id: toObjectId(orderId),
            tenantId: tenantObjectId,
            orderby: toObjectId(userId),
            isDeleted: false,
          }).setOptions({ tenantId })

          if (!order) {
            return res.status(404).json({
              success: false,
              code: 'ORDER_NOT_FOUND',
              message: 'Orden no encontrada',
            })
          }

          const previousStatus = order.paymentStatus
          providerRawStatus = sanitizeString(mpInfo.status).toLowerCase()
          statusDetail = sanitizeString(mpInfo.status_detail) || null

          applyMercadoPagoStatusToOrder({
            order,
            mpStatus: providerRawStatus,
            providerPaymentId,
            paymentMethodId:
              mpInfo.payment_method_id || order.paymentIntent?.method,
            installments:
              mpInfo.installments ?? order.paymentIntent?.installments,
            payerEmail:
              mpInfo.payer?.email || order.paymentIntent?.payerEmail,
            statusDetail,
            providerRawStatus,
          })

          order.paymentIntent.providerRawStatus = providerRawStatus
          order.paymentIntent.statusDetail = statusDetail

          await releaseRejectedPaymentReservationIfNeeded({
            order,
            tenantId,
            previousStatus,
          })

          if (order.paymentStatus === PAYMENT_STATUS.APPROVED) {
            await commitApprovedPaymentIfNeeded({
              order,
              tenantId,
              userId: order.orderby,
              payer: { email: order.paymentIntent?.payerEmail },
              req,
            })
          } else {
            await order.save({ tenantId })
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        orderId: order._id,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        provider: order.paymentIntent?.provider || null,
        providerPaymentId,
        providerStatus: providerRawStatus,
        providerStatusDetail: statusDetail,
        amount: Money.toDecimal(order.paymentIntent?.amountCents || 0),
        paidAt: order.paidAt || null,
        paymentError: order.paymentError || null,
        paymentErrorCode: order.paymentErrorCode || null,
        emailSent: Boolean(order.emailSent),
        emailSentAt: order.emailSentAt || null,

        // Compatibilidad hacia atrás para frontends que todavía lean `status`.
        status: order.paymentStatus,
      },
    })
  } catch (error) {
    logger.error(
      'Error getPaymentStatus',
      getErrorLogPayload({
        error,
        tenantId,
        orderId: req.params?.orderId,
      }),
    )

    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code || 'PAYMENT_STATUS_ERROR',
      message: getSafeErrorMessage(error),
      debug: buildDebugResponse(error),
    })
  } finally {
    if (
      reconciliationLockAcquired &&
      reconciliationResourceId &&
      tenantId
    ) {
      await releasePaymentLock(reconciliationResourceId, tenantId)
    }
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
  processPendingEmails,
}
