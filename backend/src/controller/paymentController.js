// 📁 src/controller/paymentController.js
// VERSIÓN GO PRODUCCIÓN - HARDENED MULTI-TENANT / MERCADO PAGO / WEBHOOK / EMAILS / STOCK / CARRITO

import crypto from 'node:crypto'

import Order, { PAYMENT_STATUS } from '../models/orderModel.js'

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
  persistProviderPaymentId,
  releaseReservedStock,
  reserveStockAtomic,
  restoreCommittedStockOnRefundIfNeeded,
} from '../services/paymentOrderOpsService.js'
import { processPendingEmails, queuePaymentEmails } from '../services/paymentEmailService.js'
import { sendMetaPurchaseEvent } from '../services/meta/metaCapiService.js'
import {
  recordServerPurchaseEvent,
  markOrderAiInfluenced,
} from '../services/commerceEvents/commerceEventService.js'
import { markCartRecoveryConverted } from '../services/aiAgent/aiCartRecoveryService.js'
import { consumeOrderCouponIfNeeded } from '../services/orderCouponService.js'
import {
  buildMercadoPagoPaymentData,
  getStatusMessage,
  mapMercadoPagoError,
  NEGATIVE_PAYMENT_STATUSES,
  normalizeMpStatus,
} from '../services/paymentMercadoPagoService.js'
import {
  createMercadoPagoPaymentClient,
  getTenantPaymentPublicConfig,
  getTenantConfig,
  getTenantToken,
  getTenantMercadoPagoContext,
  getTenantWebhookSecret,
} from '../services/paymentTenantConfigService.js'
import {
  applyMercadoPagoStatusToOrder,
  extractMercadoPagoFees,
} from '../services/paymentOrderService.js'
import {
  getWebhookHints,
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
const isPaymentDebugEnabled = !isProd && process.env.PAYMENT_DEBUG_RESPONSE === 'true'

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
  return sanitizeString(order?.paymentIntent?.provider).toLowerCase() === 'mercadopago'
}

const buildStableHash = value => {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 24)
}

// Una clave por INTENTO, y el intento lo define el token de la tarjeta, que es
// de un solo uso.
//
// Usaba paymentIntent.id, que toda orden tiene y no cambia, así que la clave era
// la misma en todos los intentos de una orden. Mercado Pago devuelve la
// respuesta guardada cuando se repite una clave: quien reintentaba con otra
// tarjeta recibía el rechazo de la primera.
//
// Esa clave fija era también, sin que nadie lo hubiera pedido, lo que impedía un
// segundo cobro. Esa protección ahora es explícita: ver preparePaymentAttempt.
const buildPaymentIdempotencyKey = ({ tenantId, order, token }) =>
  `mp:${tenantId}:${order._id}:${buildStableHash(token)}`

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

// Libera la reserva de una orden y limpia la marca SOLO si se liberó de verdad.
// releaseReservedStock ya no lanza: devuelve false, y en ese caso la marca
// `stockReservedAt` se conserva —en la base y en memoria— para que la reserva
// siga siendo visible y recuperable en vez de darse por devuelta.
const releaseOrderReservation = async ({ order, tenantId }) => {
  const released = await releaseReservedStock(order.products, tenantId, {
    orderId: order._id,
  })

  if (released) order.stockReservedAt = null

  return released
}

const safelyReleaseReservedStock = async ({ order, tenantId, reason }) => {
  if (!order || !tenantId) return

  try {
    const released = await releaseOrderReservation({ order, tenantId })

    if (!released) {
      logger.error('❌ Reserva de stock sin liberar (se conserva la marca)', {
        reason,
        orderId: order?._id?.toString?.(),
        tenantId: String(tenantId),
      })
    }
  } catch (releaseError) {
    logger.error('❌ Error liberando stock reservado', {
      reason,
      orderId: order?._id?.toString?.(),
      tenantId: String(tenantId),
      message: getSafeErrorMessage(releaseError),
    })
  }
}

const queueApprovedPaymentSideEffects = async ({ order, tenantId, userId, payer, req }) => {
  await clearUserCartAfterApprovedPayment({
    userId: userId || order.orderby,
    tenantId,
  })

  const tenantConfig = await getTenantConfig(tenantId)

  // Ambos se mandan antes del save de queuePaymentEmails (no tiene uno
  // propio) para que sus flags viajen en el mismo write que emailSent, en
  // vez de arriesgar una segunda escritura corriendo en paralelo. Ninguno
  // tira — ver commerceEventService.js y metaCapiService.js. El registro
  // interno va primero porque es la base de la que depende todo lo demás,
  // no un tercero — aunque el orden entre los dos no cambia el resultado.
  await recordServerPurchaseEvent({ order, tenantId, req })
  await sendMetaPurchaseEvent({ order, tenantId, req })
  await markCartRecoveryConverted({ order, tenantId })
  // Corre después de recordServerPurchaseEvent a propósito: actualiza el
  // mismo documento de PURCHASE que esa función ya escribió (mismo eventId
  // determinístico), no crea uno nuevo.
  await markOrderAiInfluenced({ order, tenantId })

  return queuePaymentEmails({
    order,
    payer: payer || { email: order.paymentIntent?.payerEmail },
    req: req || {},
    tenantConfig,
  })
}

// Deja escrito que el pago se aprobó, antes de cualquier efecto.
//
// El estado se guardaba recién con el order.save del final de
// commitApprovedPaymentIfNeeded. Si algo fallaba antes de ese save, el reclamo de
// efectos ya estaba tomado y nadie volvía a guardar: el comprador pagó, se le dijo
// que estaba aprobado, y la orden quedaba pendiente para siempre.
//
// Va con updateOne y no con save para no depender de la versión del documento:
// otra escritura concurrente no puede hacer perder este dato.
//
// El filtro no admite pisar una orden cancelada o devuelta en el medio. Ahí no
// hay efectos que correr: un pago aprobado sobre esa orden lo tiene que mirar una
// persona, y la reconciliación lo muestra.
const persistApprovedPayment = async ({ order, tenantId }) => {
  const result = await Order.updateOne(
    {
      _id: order._id,
      tenantId,
      paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.APPROVED] },
    },
    {
      $set: {
        paymentStatus: PAYMENT_STATUS.APPROVED,
        orderStatus: order.orderStatus,
        paidAt: order.paidAt,
        paymentError: null,
        paymentErrorCode: null,
        'paymentIntent.status': PAYMENT_STATUS.APPROVED,
        'paymentIntent.providerPaymentId': order.paymentIntent?.providerPaymentId,
        'paymentIntent.providerRawStatus': order.paymentIntent?.providerRawStatus,
      },
    },
  ).setOptions({ tenantId })

  return Boolean(result?.matchedCount ?? result?.n)
}

const commitApprovedPaymentIfNeeded = async ({ order, tenantId, userId, payer, req }) => {
  if (order.paymentStatus !== PAYMENT_STATUS.APPROVED) return null

  if (!(await persistApprovedPayment({ order, tenantId }))) {
    logger.error('🚨 Pago aprobado sobre una orden que ya no admite aprobarse', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      providerPaymentId: order.paymentIntent?.providerPaymentId || null,
    })

    return null
  }

  // Reclamo atómico: processPayment, el webhook y el polling de
  // getPaymentStatus pueden llegar acá para la MISMA orden casi al mismo
  // tiempo (usan namespaces de lock distintos entre sí, nunca colisionan).
  // Este findOneAndUpdate condicionado es lo único que realmente garantiza
  // que el resto de esta función — stock, cupón, el save con
  // optimisticConcurrency, y todos los efectos de queueApprovedPaymentSideEffects
  // (evento de compra, Meta CAPI, conversión de recuperación de carrito,
  // influencia de IA, emails) — corra una sola vez. El que pierde la carrera
  // nunca toca order.save(): evita tanto el doble conteo como el
  // VersionError que antes se filtraba al comprador como un pago fallido.
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, tenantId, paymentEffectsCommittedAt: null },
    { $set: { paymentEffectsCommittedAt: new Date() } },
    { new: true },
  ).setOptions({ tenantId })

  if (!claimed) return null

  order.paymentEffectsCommittedAt = claimed.paymentEffectsCommittedAt

  // Si esto falla se suelta el reclamo: el pago ya quedó guardado como aprobado y
  // el próximo webhook o consulta de estado termina lo que falta. Sin soltarlo,
  // esos efectos no corrían nunca. Repetir no duplica nada: confirmar el stock no
  // mueve unidades y el cupón es idempotente por orden.
  try {
    if (!order.stockCommittedAt) {
      await confirmSoldStock(order.products, tenantId)
      order.stockCommittedAt = new Date()
    }

    await consumeOrderCouponIfNeeded({
      order,
      tenantId,
      userId: userId || order.orderby,
      req,
    })

    order.stockReservedAt = null
    await order.save({ tenantId })
  } catch (error) {
    await Order.updateOne(
      { _id: order._id, tenantId },
      { $set: { paymentEffectsCommittedAt: null } },
    )
      .setOptions({ tenantId })
      .catch(releaseError => {
        logger.error('❌ No se pudo soltar el reclamo de efectos de un pago aprobado', {
          orderId: order._id?.toString?.(),
          message: getSafeErrorMessage(releaseError),
        })
      })

    order.paymentEffectsCommittedAt = null
    throw error
  }

  return queueApprovedPaymentSideEffects({
    order,
    tenantId,
    userId,
    payer,
    req,
  })
}

// Una orden rechazada vuelve a pendiente para aceptar otro intento.
//
// El estado 'rejected' es final para los avisos de Mercado Pago (ver
// canApplyPaymentTransition), así que sin esto un reintento aprobado no podía
// cambiarlo: el comprador pagaba y la orden seguía rechazada. El camino es
// explícito y solo lo abre el comprador intentando pagar.
const reopenRejectedOrder = async ({ order, tenantId }) => {
  const rejectedPaymentId = order.paymentIntent.providerPaymentId

  if (rejectedPaymentId) {
    order.paymentIntent.rejectedPaymentIds.push(String(rejectedPaymentId))
  }

  order.paymentStatus = PAYMENT_STATUS.PENDING
  order.paymentIntent.providerPaymentId = null
  order.paymentIntent.providerRawStatus = null
  order.paymentIntent.statusDetail = null
  order.paymentError = null
  order.paymentErrorCode = null
  order.syncDerivedState()

  order.addAuditEntry({
    action: 'payment_updated',
    performedByRole: 'customer',
    reason: 'Reintento de pago después de un rechazo',
    metadata: { rejectedPaymentId: rejectedPaymentId || null },
  })

  await order.save({ tenantId })
}

/**
 * Lo que hay que resolver antes de cobrar. Devuelve el rechazo a responder, o
 * null si se puede cobrar.
 *
 * ACÁ VIVE LA GARANTÍA DE NO COBRAR DOS VECES.
 *
 * La clave de idempotencia es por intento: con otra tarjeta, Mercado Pago crea
 * otro pago. Por eso no se puede llamarlo hasta saber que no hay uno en curso.
 */
const preparePaymentAttempt = async ({ order, tenantId, payment }) => {
  const status = order.paymentStatus

  if (
    status === PAYMENT_STATUS.CANCELLED ||
    status === PAYMENT_STATUS.REFUNDED ||
    order.cancellation?.cancelled
  ) {
    return {
      status: 409,
      code: 'ORDER_NOT_PAYABLE',
      message: 'Esta orden ya no se puede pagar.',
    }
  }

  if (status === PAYMENT_STATUS.REJECTED) {
    await reopenRejectedOrder({ order, tenantId })
    return null
  }

  const pagoEnCurso = {
    status: 409,
    code: 'PAYMENT_PENDING',
    message: 'Ya hay un pago en proceso para esta orden. Te avisamos cuando se confirme.',
  }

  if (order.paymentIntent?.providerPaymentId) return pagoEnCurso

  // Un intento anterior sin id guardado: pudo fallar sin cobrar, o el proceso
  // pudo morir después de cobrar. Solo Mercado Pago lo sabe. Se pregunta recién
  // acá para no sumarle una llamada al primer intento, que es casi todos.
  if (!order.lastPaymentAttemptAt) return null

  let pagos

  try {
    const respuesta = await payment.search({
      options: { external_reference: String(order._id) },
    })
    pagos = respuesta?.results || []
  } catch (error) {
    // Sin poder preguntar no se cobra: reintentar en un rato es mejor que cobrar
    // dos veces.
    logger.warn('⚠️ No se pudo verificar el intento anterior de pago', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    return {
      status: 503,
      code: 'PAYMENT_ATTEMPT_UNVERIFIED',
      message: 'No pudimos verificar tu pago anterior. Probá de nuevo en unos minutos.',
    }
  }

  const huerfano = pagos.find(pago => {
    const estado = normalizeMpStatus(pago?.status)
    return estado && !NEGATIVE_PAYMENT_STATUSES.has(estado)
  })

  if (!huerfano) return null

  // Queda vinculado y lo termina el webhook o la consulta de estado.
  await persistProviderPaymentId({
    orderId: order._id,
    tenantId,
    providerPaymentId: huerfano.id,
  })

  return pagoEnCurso
}

const releaseRejectedPaymentReservationIfNeeded = async ({ order, tenantId, previousStatus }) => {
  if (
    previousStatus === PAYMENT_STATUS.PENDING &&
    NEGATIVE_PAYMENT_STATUSES.has(order.paymentStatus) &&
    order.stockReservedAt &&
    !order.stockCommittedAt
  ) {
    await releaseOrderReservation({ order, tenantId })
  }
}

// =====================================================
// TENANT CONTEXT
// =====================================================

const resolveTenantContext = (req, { allowPrivilegedRoleBypass = false } = {}) => {
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
    token,
    payment_method_id: paymentMethodId,
    installments,
    payer,
    issuer_id: issuerId,
  } = req.body || {}

  const orderId = bodyOrderId || null
  const lockResourceId = orderId || crypto.randomUUID()

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

    // Pagar exige una orden ya creada. Este endpoint NO crea órdenes.
    //
    // Antes aceptaba también un cartId y en ese caso armaba la orden acá
    // mismo, con createOrderFromCart. Ese camino estaba muerto —ningún
    // frontend manda cartId— y arrastraba dos defectos que solo no lastimaron
    // porque nadie lo pisaba: le ponía a la orden un idempotencyKey generado
    // al azar en cada llamada, o sea un campo que promete deduplicación y no
    // deduplica nada, y escribía discountAmountCents: 0 fijo, o sea perdía el
    // cupón sin avisar. Crear la orden en createOrder (orderCtrl) es el único
    // camino que aplica el cupón, acepta la clave de idempotencia del cliente
    // y choca contra el índice único parcial si se repite.
    if (!orderId || !isValidObjectId(orderId)) {
      return res.status(400).json({
        success: false,
        code: 'ORDER_ID_REQUIRED',
        message: 'Debe enviarse orderId',
      })
    }

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

    if (order.paymentStatus === PAYMENT_STATUS.APPROVED) {
      return res.status(409).json({
        success: false,
        code: 'ORDER_ALREADY_PAID',
        message: 'La orden ya fue pagada',
      })
    }

    const payment = createMercadoPagoPaymentClient(mpToken)

    const attemptBlocked = await preparePaymentAttempt({ order, tenantId, payment })

    if (attemptBlocked) {
      const { status, ...body } = attemptBlocked
      return res.status(status).json({ success: false, ...body })
    }

    if (!order.stockReservedAt && !order.stockCommittedAt) {
      order.stockReservedAt = await reserveStockAtomic(order.products, tenantId, {
        orderId: order._id,
      })
      stockReserved = true
    }

    const { paymentData, transactionAmount, validatedInstallments } = buildMercadoPagoPaymentData({
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

    const idempotencyKey = buildPaymentIdempotencyKey({
      tenantId,
      order,
      token,
    })

    // Antes de cobrar: si el proceso muere en la llamada, el próximo intento
    // tiene que saber que hubo uno y preguntar antes de cobrar de nuevo.
    const attemptAt = new Date()

    await Order.updateOne(
      { _id: order._id, tenantId: toObjectId(tenantId) },
      { $set: { lastPaymentAttemptAt: attemptAt } },
    ).setOptions({ tenantId })

    order.lastPaymentAttemptAt = attemptAt

    const mpPayment = await payment.create({
      body: paymentData,
      requestOptions: {
        idempotencyKey,
      },
    })

    // Lo primero después de cobrar: dejar escrito qué pago es de esta orden.
    // Todo lo que sigue (estado, stock, cupón, correos) puede fallar o el proceso
    // puede caerse; con el id guardado el webhook y la auditoría encuentran la
    // orden y lo terminan. Sin él, un cobro real quedaba huérfano.
    await persistProviderPaymentId({
      orderId: order._id,
      tenantId,
      providerPaymentId: mpPayment.id,
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
      ...extractMercadoPagoFees(mpPayment),
    })

    const normalizedPaymentStatus = order.paymentStatus

    if (normalizedPaymentStatus === PAYMENT_STATUS.APPROVED) {
      stockReserved = false
    } else if (NEGATIVE_PAYMENT_STATUSES.has(normalizedPaymentStatus)) {
      await releaseOrderReservation({ order, tenantId })
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
    // Sin `stockReserved = false` después de liberar: es el último uso de la
    // variable en la función y el linter lo marcaba como error.
    if (stockReserved && order) {
      await safelyReleaseReservedStock({
        order,
        tenantId,
        reason: 'processPayment.catch',
      })
    }

    // El pago YA se aprobó (Mercado Pago respondió approved y quedó escrito
    // en el documento en memoria) y el error ocurrió confirmándolo — stock,
    // cupón o efectos post-pago. Lo más probable es que el webhook o el
    // polling de reconciliación ganaron la carrera de confirmar esta misma
    // orden primero (ver paymentEffectsCommittedAt en
    // commitApprovedPaymentIfNeeded) y este intento perdió un save por
    // optimisticConcurrency. Reportarle un error al comprador acá sería
    // mentirle sobre un pago que sí se hizo — se le devuelve éxito con el
    // estado real de la orden.
    if (order && order.paymentStatus === PAYMENT_STATUS.APPROVED) {
      logger.warn('⚠️ Error confirmando pago ya aprobado — devolviendo éxito al cliente', {
        orderId: order._id?.toString?.(),
        tenantId: String(tenantId),
        message: getSafeErrorMessage(error),
      })

      return res.status(200).json({
        success: true,
        id: order.paymentIntent?.providerPaymentId || null,
        message: getStatusMessage(order.paymentIntent?.providerRawStatus || 'approved'),
        orderId: order._id,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        provider: order.paymentIntent?.provider || null,
        providerStatus: order.paymentIntent?.providerRawStatus || null,
        providerStatusDetail: order.paymentIntent?.statusDetail || null,
        providerPaymentId: order.paymentIntent?.providerPaymentId || null,
        emailQueued: true,
      })
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
    const paymentId = req.body?.data?.id || req.query['data.id'] || req.query.id
    const hints = getWebhookHints(req)

    // Primero el secreto global: es lo más barato y no toca la base. Solo si no
    // coincide se busca el secreto del comercio al que pertenece el pago, que
    // es el que firma cuando el comercio cobra con su propia aplicación de
    // Mercado Pago. Ese comercio sale de la pista de la URL o, para pagos
    // anteriores a que existieran las pistas, del id de pago ya guardado.
    let signatureValid = verifyMercadoPagoWebhookSignature(req, { quiet: true })
    let identityByPayment = null

    if (!signatureValid && paymentId) {
      identityByPayment = await resolveWebhookOrderIdentity(paymentId, hints)

      const tenantForSecret = hints.tenantId || identityByPayment?.tenantId

      if (tenantForSecret) {
        const tenantSecret = await getTenantWebhookSecret(String(tenantForSecret))

        signatureValid = tenantSecret
          ? verifyMercadoPagoWebhookSignature(req, { tenantSecret })
          : false
      }
    }

    if (!signatureValid) {
      // error, no warn: si el secreto no coincide con el de la aplicación de
      // Mercado Pago del comercio (ni con el global), ESTO se dispara para cada
      // notificación real y el pedido asociado queda colgado en "pending"
      // sin ninguna otra señal — necesita ser imposible de no ver.
      logger.error('🔴 Webhook Mercado Pago con firma inválida — revisar el secreto de webhook', {
        code: 'MP_WEBHOOK_SIGNATURE_INVALID',
        ip: req.ip,
        paymentId: paymentId || null,
        tenantId: hints.tenantId || null,
      })
      return
    }

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

    const rawIdentity = identityByPayment || (await resolveWebhookOrderIdentity(paymentId, hints))

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

    // Un aviso atrasado de un intento que ya se rechazó y se reintentó. La orden
    // no tiene id de pago en este momento, así que sin esto se tomaría por el
    // pago actual y la volvería a rechazar.
    if ((order.paymentIntent?.rejectedPaymentIds || []).includes(String(paymentId))) {
      logger.info('Webhook de un intento rechazado anterior, ignorando', {
        paymentId: String(paymentId),
        orderId: order._id?.toString?.(),
      })

      return
    }

    const knownPaymentId = String(order.paymentIntent?.providerPaymentId || '')

    if (knownPaymentId && knownPaymentId !== String(paymentId)) {
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

    // UN PAGO SIN VÍNCULO SOLO SE ADOPTA SI MERCADO PAGO LO RECONOCE
    //
    // La orden se encontró por la pista de la URL, que no está firmada. El
    // vínculo se acepta únicamente si el pago, leído con el token del comercio,
    // nombra a esta orden en external_reference y cobró exactamente su monto.
    if (!knownPaymentId) {
      const mpAmount = Number(mpInfo?.transaction_amount)
      const montoCoincide =
        Number.isFinite(mpAmount) &&
        Money.fromDecimal(mpAmount) === Number(order.paymentIntent?.amountCents)
      const referenciaCoincide = String(mpInfo?.external_reference || '') === String(order._id)

      if (!montoCoincide || !referenciaCoincide) {
        logger.warn('🚨 Webhook: el pago no corresponde a la orden indicada, se descarta', {
          paymentId: String(paymentId),
          orderId: order._id?.toString?.(),
          referenciaCoincide,
          montoCoincide,
        })

        return
      }

      logger.warn('🔗 Webhook: pago vinculado a la orden por external_reference', {
        paymentId: String(paymentId),
        orderId: order._id?.toString?.(),
        tenantId,
      })
    }

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
      ...extractMercadoPagoFees(mpInfo),
    })

    // Una orden que ya estaba aprobada pero sin stock confirmado es un intento
    // anterior que falló a mitad de camino: el aviso repetido lo termina. Las
    // órdenes viejas no pasan por acá: tienen el stock confirmado pero no la
    // marca de efectos, y repetirlos les mandaría los correos de nuevo.
    if (
      order.paymentStatus === PAYMENT_STATUS.APPROVED &&
      (previousStatus !== PAYMENT_STATUS.APPROVED || !order.stockCommittedAt)
    ) {
      await commitApprovedPaymentIfNeeded({
        order,
        tenantId,
        userId: order.orderby,
        payer: { email: order.paymentIntent?.payerEmail },
        req,
      })
    } else {
      await releaseRejectedPaymentReservationIfNeeded({
        order,
        tenantId,
        previousStatus,
      })
      // Devolución o contracargo informado por el proveedor: la reserva ya no
      // existe, lo que hay que devolver es el stock de la venta.
      await restoreCommittedStockOnRefundIfNeeded({ order, tenantId })
      await order.save({ tenantId })
    }

    await markWebhookProcessed(webhookId, paymentId, tenantId, order._id, mpInfo.status)

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
      sanitizeString(order.paymentIntent?.providerRawStatus).toLowerCase() || null
    let statusDetail = sanitizeString(order.paymentIntent?.statusDetail) || null
    const providerPaymentId = sanitizeString(order.paymentIntent?.providerPaymentId) || null

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
            message: 'Mercado Pago no está configurado correctamente para este comercio.',
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
            paymentMethodId: mpInfo.payment_method_id || order.paymentIntent?.method,
            installments: mpInfo.installments ?? order.paymentIntent?.installments,
            payerEmail: mpInfo.payer?.email || order.paymentIntent?.payerEmail,
            statusDetail,
            providerRawStatus,
            ...extractMercadoPagoFees(mpInfo),
          })

          order.paymentIntent.providerRawStatus = providerRawStatus
          order.paymentIntent.statusDetail = statusDetail

          await releaseRejectedPaymentReservationIfNeeded({
            order,
            tenantId,
            previousStatus,
          })

          await restoreCommittedStockOnRefundIfNeeded({ order, tenantId })

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
    if (reconciliationLockAcquired && reconciliationResourceId && tenantId) {
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
