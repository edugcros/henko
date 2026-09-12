// 📁 src/controller/subscriptionWebhookCtrl.js
// Webhook controller para eventos de Mercado Pago (suscripciones)

import Tenant from '../models/tenantModel.js'
import SubscriptionWebhookEvent, {
  WEBHOOK_EVENT_STATUS,
} from '../models/subscriptionWebhookEventModel.js'
import { sendTemplateEmail } from '../services/emailService.js'
import { verifyMercadoPagoWebhookSignature } from '../services/paymentWebhookService.js'
import { readProviderBillingDates } from '../services/subscriptionPaymentService.js'
import { env } from '../../config/env.js'
import logger from '../../config/logger.js'

const sendResponse = (res, statusCode, success, message, data = null) => {
  res.status(statusCode).json({
    success,
    message,
    ...(data && { data }),
  })
}

/**
 * Clave de deduplicación del evento.
 *
 * Mercado Pago no manda un id de evento propio en el body de suscripciones, así
 * que se compone con lo que sí identifica al hecho: el tipo y el recurso. Dos
 * entregas del mismo evento producen la misma clave; un cobro aprobado y una
 * cancelación de la misma suscripción producen claves distintas.
 *
 * `x-request-id` NO sirve: cambia en cada reintento, que es precisamente el
 * caso que hay que deduplicar.
 */
const buildEventId = ({ type, data }) =>
  `${String(type || '').trim()}:${String(data?.id || '').trim()}`

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
  // 1. FIRMA. El webhook de pagos ya la verificaba; este procesaba req.body
  // directo, o sea que cualquiera con la URL podía cancelar la suscripción de
  // un comercio o marcarla como pagada. Se usa la misma función, para que haya
  // un solo lugar donde esté escrito cómo se valida a Mercado Pago.
  if (!verifyMercadoPagoWebhookSignature(req)) {
    logger.error('🔴 Webhook de suscripción con firma inválida', {
      path: req.originalUrl,
      hasSignature: Boolean(req.headers['x-signature']),
    })
    return sendResponse(res, 401, false, 'Firma inválida')
  }

  const { type, data } = req.body || {}

  if (!type || !data?.id) {
    return sendResponse(res, 400, false, 'Webhook inválido')
  }

  const eventId = buildEventId({ type, data })

  // 2. IDEMPOTENCIA. La unicidad la impone el índice, no un `if`: dos entregas
  // simultáneas del mismo evento pasarían las dos por una comprobación previa
  // antes de que ninguna escriba.
  let event

  try {
    event = await SubscriptionWebhookEvent.create({
      provider: 'mercadopago',
      eventId,
      eventType: type,
      subscriptionId: String(data.id),
    })
  } catch (error) {
    if (error?.code !== 11000) {
      // No se pudo ni registrar el evento: es un fallo de infraestructura, y
      // decirle 200 a Mercado Pago sería perderlo. Que reintente.
      logger.error('Error registrando evento de suscripción', {
        eventId,
        error: error.message,
      })
      return sendResponse(res, 500, false, 'Error temporal')
    }

    const previo = await SubscriptionWebhookEvent.findOne({
      provider: 'mercadopago',
      eventId,
    })

    if (previo?.status === WEBHOOK_EVENT_STATUS.PROCESSED) {
      logger.info('Evento de suscripción duplicado, ya procesado', { eventId })
      return sendResponse(res, 200, true, 'Evento ya procesado')
    }

    if (previo?.status === WEBHOOK_EVENT_STATUS.PROCESSING) {
      // Otra instancia lo tiene en la mano. No se reprocesa —el objetivo es no
      // aplicar dos veces la misma transición— y se contesta 200 para no
      // provocar una tormenta de reintentos sobre algo que ya está en curso.
      logger.warn('Evento de suscripción en curso en otra instancia', { eventId })
      return sendResponse(res, 200, true, 'Evento en proceso')
    }

    // Quedó en 'failed': este ES el reintento que se pidió devolviendo 500.
    event = previo
    await SubscriptionWebhookEvent.updateOne(
      { _id: previo._id },
      { $set: { status: WEBHOOK_EVENT_STATUS.PROCESSING, error: null } },
    )
  }

  try {
    logger.info('Webhook de suscripción recibido', { type, dataId: data.id, eventId })

    const tenant = await Tenant.findOne({
      'integrations.subscriptionMercadoPago.subscriptionId': data.id,
    })

    if (!tenant) {
      // Sin tenant no hay nada que aplicar, y reintentar no lo va a encontrar.
      // Se cierra el evento como procesado para que un reintento no repita la
      // búsqueda, pero se registra en warn: si esto aparece seguido, la
      // suscripción se creó sin guardar su id y eso sí es un problema.
      logger.warn('Tenant no encontrado para suscripción de MP', {
        mpSubscriptionId: data.id,
        eventId,
      })

      await marcarProcesado(event._id)
      return sendResponse(res, 200, true, 'Sin tenant asociado')
    }

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

    await marcarProcesado(event._id, tenant._id)

    return sendResponse(res, 200, true, 'Webhook procesado exitosamente')
  } catch (error) {
    // 3. CÓDIGO HTTP. Antes esto devolvía 200 con el comentario "para que MP no
    // reintente indefinidamente". El efecto real era decirle al proveedor que
    // un cobro se aplicó cuando no se había aplicado: la suscripción quedaba
    // sin actualizar y nadie se enteraba. Un 500 pide el reintento que hace
    // falta, y la idempotencia de arriba es lo que vuelve seguro pedirlo.
    logger.error('Error procesando webhook de suscripción', {
      eventId,
      error: error.message,
      stack: error.stack,
    })

    await SubscriptionWebhookEvent.updateOne(
      { _id: event._id },
      { $set: { status: WEBHOOK_EVENT_STATUS.FAILED, error: error.message } },
    ).catch(() => undefined)

    return sendResponse(res, 500, false, 'Error procesando el evento')
  }
}

const marcarProcesado = (id, tenantId = null) =>
  SubscriptionWebhookEvent.updateOne(
    { _id: id },
    {
      $set: {
        status: WEBHOOK_EVENT_STATUS.PROCESSED,
        processedAt: new Date(),
        ...(tenantId ? { tenantId } : {}),
      },
    },
  )

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

  // Las fechas salen de lo que informó el proveedor. Si el evento no las trae,
  // quedan nulas: es preferible no saber la fecha del próximo cobro a mostrar
  // una inventada, que se lee igual de segura y no lo es.
  const ciclo = readProviderBillingDates(data)

  const updated = await Tenant.findByIdAndUpdate(
    tenant._id,
    {
      subscriptionStatus: 'active',
      subscriptionPastDueAt: null,
      'integrations.subscriptionMercadoPago.status': data.status,
      'integrations.subscriptionMercadoPago.lastPaymentAt': new Date(),
      'integrations.subscriptionMercadoPago.updatedAt': new Date(),
      ...(ciclo.nextBillingAt
        ? {
          'integrations.subscriptionMercadoPago.nextBillingAt': ciclo.nextBillingAt,
          'integrations.subscriptionMercadoPago.currentPeriodEnd': ciclo.currentPeriodEnd,
        }
        : {}),
      ...(ciclo.currentPeriodStart
        ? {
          'integrations.subscriptionMercadoPago.currentPeriodStart':
              ciclo.currentPeriodStart,
        }
        : {}),
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
          nextPaymentDate: ciclo.nextBillingAt,
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
          // Misma razón que en subscriptionPaymentService: ADMIN_BASE_URL no
          // existe en la config, el link del email salía "undefined/...".
          actionUrl: `${env.adminUrl}/admin/mi-suscripcion`,
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
      // El plan no se toca: ver el comentario del mismo caso en
      // subscriptionCtrl::cancelSubscription.
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
