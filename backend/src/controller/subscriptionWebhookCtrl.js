// 📁 src/controller/subscriptionWebhookCtrl.js
// Webhook controller para eventos de Mercado Pago (suscripciones)

import Tenant from '../models/tenantModel.js'
import { sendTemplateEmail } from '../services/emailService.js'
import logger from '../../config/logger.js'

const sendResponse = (res, statusCode, success, message, data = null) => {
  res.status(statusCode).json({
    success,
    message,
    ...(data && { data }),
  })
}

/**
 * POST /api/webhooks/mercadopago/subscription
 * Webhook para eventos de suscripción recurrente en Mercado Pago
 *
 * Tipos de eventos:
 * - subscription_update: cambio en la suscripción
 * - subscription_preapproval_create: suscripción creada
 * - subscription_authorized: pago aprobado
 * - subscription_failed: pago rechazado
 * - subscription_canceled: suscripción cancelada
 */
export const handleSubscriptionWebhook = async (req, res) => {
  try {
    const { type, data } = req.body

    if (!type || !data) {
      return sendResponse(res, 400, false, 'Webhook inválido')
    }

    logger.info('Webhook de suscripción recibido', { type, dataId: data.id })

    // Obtener la suscripción por ID de Mercado Pago
    const tenant = await Tenant.findOne({
      'integrations.subscriptionMercadoPago.subscriptionId': data.id,
    })

    if (!tenant) {
      logger.warn('Tenant no encontrado para suscripción de MP', {
        mpSubscriptionId: data.id,
      })
      // Devolvemos 200 para que MP no reintente
      return sendResponse(res, 200, true, 'Webhook procesado')
    }

    // Procesar según el tipo de evento
    switch (type) {
      case 'subscription_update':
        await handleSubscriptionUpdate(tenant, data)
        break

      case 'subscription_authorized':
        await handlePaymentAuthorized(tenant, data)
        break

      case 'subscription_failed':
        await handlePaymentFailed(tenant, data)
        break

      case 'subscription_canceled':
        await handleSubscriptionCanceled(tenant, data)
        break

      default:
        logger.info('Tipo de evento no procesado', { type })
    }

    sendResponse(res, 200, true, 'Webhook procesado exitosamente')
  } catch (error) {
    logger.error('Error procesando webhook de suscripción:', {
      error: error.message,
      stack: error.stack,
    })
    // Devolvemos 200 igual para que MP no reintente indefinidamente
    sendResponse(res, 200, true, 'Webhook recibido')
  }
}

/**
 * Manejar actualización de suscripción (cambio de plan, etc)
 */
const handleSubscriptionUpdate = async (tenant, data) => {
  logger.info('Procesando subscription_update', {
    tenantId: tenant._id,
    mpSubscriptionId: data.id,
  })

  // Actualizar estado y fecha de último cambio
  await Tenant.findByIdAndUpdate(
    tenant._id,
    {
      'integrations.subscriptionMercadoPago.status': data.status,
      'integrations.subscriptionMercadoPago.updatedAt': new Date(),
    },
    { new: true },
  )
}

/**
 * Manejar pago autorizado (aprobado)
 */
const handlePaymentAuthorized = async (tenant, data) => {
  logger.info('Procesando pago autorizado', {
    tenantId: tenant._id,
    mpSubscriptionId: data.id,
  })

  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    {
      subscriptionStatus: 'active',
      subscriptionPastDueAt: null,
      'integrations.subscriptionMercadoPago.status': data.status,
      'integrations.subscriptionMercadoPago.lastPaymentAt': new Date(),
    },
    { new: true },
  )

  // Enviar email de confirmación de pago
  try {
    const payerEmail = updated.integrations?.subscriptionMercadoPago?.payerEmail
    const plan = updated.plan
    if (payerEmail) {
      await sendTemplateEmail({
        to: payerEmail,
        template: 'subscription-payment-confirmed',
        data: {
          tenantName: updated.name,
          plan,
          paymentDate: new Date(),
          nextPaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    }
  } catch (emailError) {
    logger.warn('Error enviando email de pago confirmado:', emailError)
  }
}

/**
 * Manejar pago rechazado
 */
const handlePaymentFailed = async (tenant, data) => {
  logger.info('Procesando pago rechazado', {
    tenantId: tenant._id,
    mpSubscriptionId: data.id,
    reason: data.reason,
  })

  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    {
      subscriptionStatus: 'past_due',
      subscriptionPastDueAt: new Date(),
      'integrations.subscriptionMercadoPago.status': data.status,
      'integrations.subscriptionMercadoPago.failureReason': data.reason,
      'integrations.subscriptionMercadoPago.lastFailureAt': new Date(),
    },
    { new: true },
  )

  // Enviar email de pago fallido
  try {
    const payerEmail = updated.integrations?.subscriptionMercadoPago?.payerEmail
    if (payerEmail) {
      await sendTemplateEmail({
        to: payerEmail,
        template: 'subscription-payment-failed',
        data: {
          tenantName: updated.name,
          failureReason: data.reason || 'Razón desconocida',
          actionUrl: `${process.env.ADMIN_BASE_URL}/admin/mi-suscripcion`,
        },
      })
    }
  } catch (emailError) {
    logger.warn('Error enviando email de pago fallido:', emailError)
  }
}

/**
 * Manejar cancelación de suscripción
 */
const handleSubscriptionCanceled = async (tenant, data) => {
  logger.info('Procesando cancelación de suscripción', {
    tenantId: tenant._id,
    mpSubscriptionId: data.id,
  })

  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    {
      subscriptionStatus: 'cancelled',
      plan: 'free',
      'integrations.subscriptionMercadoPago.status': 'cancelled',
      'integrations.subscriptionMercadoPago.cancelledAt': new Date(),
    },
    { new: true },
  )

  // Enviar email de cancelación confirmada
  try {
    const payerEmail = updated.integrations?.subscriptionMercadoPago?.payerEmail
    if (payerEmail) {
      await sendTemplateEmail({
        to: payerEmail,
        template: 'subscription-cancelled-webhook',
        data: {
          tenantName: updated.name,
          cancelDate: new Date(),
        },
      })
    }
  } catch (emailError) {
    logger.warn('Error enviando email de cancelación:', emailError)
  }
}

export default {
  handleSubscriptionWebhook,
}
