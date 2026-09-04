// 📁 src/controller/subscriptionCtrl.js
// Controlador para flujo de suscripción

import Tenant from '../models/tenantModel.js'
import {
  getUserIdFromRequest,
  resolveAuthorizedTenantFromRequest,
  toObjectId,
  isValidObjectId,
} from '../utils/requestContext.js'
import {
  buildMercadoPagoSubscriptionData,
  mapMercadoPagoSubscriptionError,
  mapMercadoPagoSubscriptionStatus,
} from '../services/subscriptionPaymentService.js'
import {
  createMercadoPagoPaymentClient,
  getTenantMercadoPagoContext,
} from '../services/paymentTenantConfigService.js'
import { normalizePlan } from '../services/ai/aiPlanPolicy.js'
import { sendTemplateEmail } from '../services/emailService.js'
import logger from '../../config/logger.js'

const sendResponse = (res, statusCode, success, message, data = null) => {
  res.status(statusCode).json({
    success,
    message,
    ...(data && { data }),
  })
}

const sanitizeString = (value, fallback = '') => {
  const clean = String(value || '').trim()
  return clean || fallback
}

/**
 * GET /api/subscriptions/config
 * Retornar información de configuración de pago para un tenant
 */
export const getSubscriptionConfig = async (req, res) => {
  try {
    const tenant = await resolveAuthorizedTenantFromRequest(req)
    if (!tenant) {
      return sendResponse(res, 403, false, 'No autorizado')
    }

    const mpContext = await getTenantMercadoPagoContext(tenant._id)
    if (!mpContext || !mpContext.publicKey) {
      return sendResponse(res, 503, false, 'Mercado Pago no está configurado')
    }

    return sendResponse(res, 200, true, 'Configuración obtenida', {
      mpPublicKey: mpContext.publicKey,
      currentPlan: tenant.plan || 'free',
      subscriptionStatus: tenant.subscriptionStatus || 'trialing',
      trialEndsAt: tenant.trialEndsAt,
    })
  } catch (error) {
    logger.error('Error en getSubscriptionConfig:', { error: error.message })
    sendResponse(res, 500, false, 'Error al obtener configuración')
  }
}

/**
 * POST /api/subscriptions/process-payment
 *
 * Procesar pago de suscripción. Crea suscripción recurrente en Mercado Pago
 * y actualiza Tenant.subscriptionStatus a 'active' si se aprueba.
 */
export const processSubscriptionPayment = async (req, res) => {
  const userId = getUserIdFromRequest(req)
  const tenant = await resolveAuthorizedTenantFromRequest(req)

  if (!tenant || !userId) {
    return sendResponse(res, 403, false, 'No autorizado')
  }

  try {
    const {
      plan,
      token,
      paymentMethodId,
      issuerId,
      payer,
    } = req.body

    // Validar plan
    const normalizedPlan = normalizePlan(plan)
    if (normalizedPlan === 'free' || normalizedPlan === 'enterprise') {
      return sendResponse(res, 400, false, 'Plan no válido para suscripción')
    }

    // Validar datos del pagador
    if (!payer || !payer.email || !payer.name) {
      return sendResponse(res, 400, false, 'Datos del pagador incompletos')
    }

    if (!token) {
      return sendResponse(res, 400, false, 'Token de pago requerido')
    }

    logger.info('Iniciando pago de suscripción', {
      tenantId: tenant._id,
      userId,
      plan: normalizedPlan,
    })

    // Construir datos de pago
    let subscriptionPaymentData
    try {
      const { subscriptionData } = buildMercadoPagoSubscriptionData({
        plan: normalizedPlan,
        tenantId: tenant._id,
        userId,
        email: payer.email,
        paymentMethodId,
        token,
        issuerId,
        payer,
      })
      subscriptionPaymentData = subscriptionData
    } catch (buildError) {
      logger.error('Error construyendo datos de pago:', buildError)
      return sendResponse(
        res,
        buildError.statusCode || 400,
        false,
        buildError.details || buildError.message,
      )
    }

    // Obtener cliente de Mercado Pago
    let mpClient
    try {
      mpClient = await createMercadoPagoPaymentClient(tenant._id)
    } catch (mpError) {
      logger.error('Error obteniendo cliente MP:', mpError)
      return sendResponse(res, 503, false, 'Mercado Pago no está disponible')
    }

    // Crear suscripción en Mercado Pago
    let mpSubscription
    try {
      mpSubscription = await mpClient.subscription.create({
        body: subscriptionPaymentData,
      })
    } catch (mpError) {
      logger.error('Error en Mercado Pago:', {
        error: mpError.message,
        status: mpError.status,
        cause: mpError.cause,
      })

      const mapped = mapMercadoPagoSubscriptionError(mpError)
      return sendResponse(res, mapped.status, false, mapped.message, {
        details: mapped.details,
        code: mapped.code,
      })
    }

    // Validar respuesta de MP
    if (!mpSubscription || !mpSubscription.id) {
      logger.error('Respuesta inválida de Mercado Pago:', mpSubscription)
      return sendResponse(res, 503, false, 'Respuesta inválida de Mercado Pago')
    }

    logger.info('Suscripción creada en MP', {
      mpSubscriptionId: mpSubscription.id,
      mpStatus: mpSubscription.status,
    })

    // Mapear estado de MP a nuestro domain
    const subscriptionStatus = mapMercadoPagoSubscriptionStatus(
      mpSubscription.status,
      mpSubscription.reason || '',
    )

    // Actualizar Tenant solo si está autorizado (approved)
    if (subscriptionStatus === 'active' || mpSubscription.status === 'authorized') {
      await Tenant.findByIdAndUpdate(
        tenant._id,
        {
          plan: normalizedPlan,
          subscriptionStatus: 'active',
          subscriptionPastDueAt: null,
          // Próxima renovación: 30 días desde hoy
          trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          'integrations.subscriptionMercadoPago': {
            subscriptionId: mpSubscription.id,
            status: mpSubscription.status,
            payerEmail: payer.email,
            planSelected: normalizedPlan,
            subscribedAt: new Date(),
          },
        },
        { new: true },
      )

      logger.info('Tenant actualizado con suscripción activa', {
        tenantId: tenant._id,
        subscriptionId: mpSubscription.id,
      })

      // Enviar email de bienvenida
      try {
        await sendTemplateEmail({
          to: payer.email,
          template: 'subscription-welcome',
          data: {
            tenantName: tenant.name,
            plan: normalizedPlan,
            subscriptionId: mpSubscription.id,
            nextPaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        })
      } catch (emailError) {
        logger.warn('Error enviando email de bienvenida:', emailError)
        // No fallar la suscripción por error de email
      }

      return sendResponse(res, 200, true, 'Suscripción activada exitosamente', {
        subscriptionId: mpSubscription.id,
        plan: normalizedPlan,
        status: 'active',
      })
    }

    // Si el estado es pendiente, guardar pero no activar completamente
    if (subscriptionStatus === 'pending') {
      await Tenant.findByIdAndUpdate(
        tenant._id,
        {
          'integrations.subscriptionMercadoPago': {
            subscriptionId: mpSubscription.id,
            status: mpSubscription.status,
            payerEmail: payer.email,
            planSelected: normalizedPlan,
            createdAt: new Date(),
          },
        },
      )

      return sendResponse(res, 202, true, 'Pago en proceso', {
        subscriptionId: mpSubscription.id,
        status: 'pending',
        message: 'Estamos procesando tu pago. Recibirás confirmación por email.',
      })
    }

    // Estados rechazados
    logger.warn('Suscripción en estado rechazado', {
      mpStatus: mpSubscription.status,
      mpReason: mpSubscription.reason,
    })

    return sendResponse(res, 400, false, 'Pago rechazado', {
      reason: mpSubscription.reason || 'Razón desconocida',
      mpStatus: mpSubscription.status,
    })
  } catch (error) {
    logger.error('Error procesando pago de suscripción:', {
      error: error.message,
      stack: error.stack,
      tenantId: tenant?._id,
    })

    sendResponse(res, 500, false, 'Error procesando pago')
  }
}

/**
 * GET /api/subscriptions/current
 * Obtener información de suscripción actual del tenant
 */
export const getCurrentSubscription = async (req, res) => {
  try {
    const tenant = await resolveAuthorizedTenantFromRequest(req)
    if (!tenant) {
      return sendResponse(res, 403, false, 'No autorizado')
    }

    return sendResponse(res, 200, true, 'Suscripción obtenida', {
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      trialEndsAt: tenant.trialEndsAt,
      subscriptionPastDueAt: tenant.subscriptionPastDueAt,
      mercadoPago: tenant.integrations?.subscriptionMercadoPago || null,
    })
  } catch (error) {
    logger.error('Error obteniendo suscripción:', error)
    sendResponse(res, 500, false, 'Error al obtener suscripción')
  }
}

export default {
  getSubscriptionConfig,
  processSubscriptionPayment,
  getCurrentSubscription,
}
