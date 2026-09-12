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
  readProviderBillingDates,
  createSubscriptionClient,
} from '../services/subscriptionPaymentService.js'
import {
  getTenantMercadoPagoContext,
} from '../services/paymentTenantConfigService.js'
import {
  AI_PLANS,
  normalizePlan,
  getPlanMonthlyPriceArs,
  getPlanCatalog,
} from '../services/ai/aiPlanPolicy.js'
import { sendTemplateEmail } from '../services/emailService.js'
import { env } from '../../config/env.js'
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
 * El comercio, cargado de la base.
 *
 * `resolveAuthorizedTenantFromRequest` NO devuelve un documento: devuelve
 * `{ tenantId, tenantObjectId, userTenantId, source }`. Cinco handlers de este
 * archivo guardaban ese objeto en una variable llamada `tenant` y después leían
 * `tenant._id`, `tenant.plan`, `tenant.name`, `tenant.subscriptionStatus` y
 * `tenant.integrations` — todos undefined.
 *
 * El síntoma era un 400 con "Cannot read properties of undefined (reading
 * 'toString')": el alta arma el metadata de Mercado Pago con
 * `tenantId.toString()`, y ese tenantId era `tenant._id`. Los otros cuatro
 * fallaban más callados: `getCurrentSubscription` devolvía plan y estado en
 * undefined, y `changePlan` y `cancelSubscription` cortaban con "Suscripción de
 * Mercado Pago no encontrada" porque leían el id de una propiedad que no existe.
 *
 * getSubscriptionConfig ya lo hacía bien —resuelve el id y después busca el
 * documento— y es el patrón que se replica acá.
 *
 * Devuelve null en vez de propagar el error a propósito: los handlers ya tienen
 * su `if (!tenant) return 403`, y la resolución se llamaba FUERA del try, así
 * que una excepción suya terminaba en un rechazo sin capturar.
 */
const loadTenantFromRequest = async req => {
  try {
    const { tenantObjectId } = await resolveAuthorizedTenantFromRequest(req)

    if (!tenantObjectId) return null

    return await Tenant.findById(tenantObjectId)
  } catch (error) {
    logger.warn('No se pudo resolver el comercio de la request de suscripción', {
      error: error.message,
    })

    return null
  }
}

/**
 * GET /api/subscriptions/plans
 *
 * El catálogo de precios, que es LA fuente para el panel.
 *
 * Existe para que las pantallas dejen de tener los precios escritos a mano.
 * Estaban en tres archivos del panel, cada uno con su propia copia del tipo de
 * cambio, y uno de ellos mostraba 26,14 USD —el resultado congelado de una
 * división vieja— mientras el cobro salía de otro número.
 *
 * Es pública: la ve un visitante que todavía no tiene comercio. Lo que devuelve
 * son los precios de venta, o sea información de vidriera.
 *
 * `source` (panel/env/default) se saca acá: a quien mira precios no le dice
 * nada, y de dónde salió cada número es asunto del dueño de la plataforma. Eso
 * viaja en /platform/plan-prices, que sí está protegido.
 */
export const getSubscriptionPlans = async (req, res) => {
  return sendResponse(res, 200, true, 'Planes obtenidos', {
    currency: 'ARS',
    // Se saca `source` (panel/env/default): a quien mira precios no le dice
    // nada, y de dónde salió cada número es asunto del dueño. Las cuotas sí
    // viajan: son parte de lo que se está comprando.
    plans: getPlanCatalog().map(({ plan, monthlyPriceArs, currency, limits }) => ({
      plan,
      monthlyPriceArs,
      currency,
      limits,
    })),
  })
}

/**
 * GET /api/subscriptions/config
 * Retornar información de configuración de pago para un tenant
 */
export const getSubscriptionConfig = async (req, res) => {
  try {
    // resolveAuthorizedTenantFromRequest lanza si hay error; el tenantId debe
    // estar resuelto por resolveTenantByDomain + requireTenant en la ruta.
    const { tenantId, tenantObjectId } = await resolveAuthorizedTenantFromRequest(req)

    if (!tenantId || !tenantObjectId) {
      return sendResponse(res, 403, false, 'Tenant no resuelto')
    }

    // Obtener credenciales MP del tenant
    let mpContext
    try {
      mpContext = await getTenantMercadoPagoContext(tenantObjectId)
    } catch (err) {
      // getTenantMercadoPagoContext lanza si el tenant no existe o MP no está
      // configurado. Pasarlo al catch genérico de abajo.
      throw err
    }

    if (!mpContext || !mpContext.publicKey) {
      return sendResponse(res, 503, false, 'Mercado Pago no está configurado')
    }

    // La clave pública que se devuelve es la de HENKO, no la del comercio.
    //
    // El token de tarjeta lo tiene que crear la MISMA cuenta que después lo
    // consume, y esta suscripción la cobra la plataforma con su propio access
    // token (ver subscriptionPaymentService::createSubscriptionClient). Devolver
    // la del comercio produce un token que la cuenta de HENKO no puede usar, y
    // el rechazo de Mercado Pago no dice eso: dice que el token está mal.
    //
    // mpContext se sigue consultando arriba a propósito: si el comercio no tiene
    // Mercado Pago configurado, tampoco puede operar, y conviene decirlo acá.
    const platformPublicKey = String(env.mercadoPago?.publicKey || '').trim()

    if (!platformPublicKey) {
      logger.error('MP_PUBLIC_KEY de plataforma ausente: no se puede tokenizar la tarjeta')
      return sendResponse(res, 503, false, 'Mercado Pago no está configurado')
    }

    // Obtener plan actual del tenant desde la BD
    const tenant = await Tenant.findById(tenantObjectId).select('plan subscriptionStatus trialEndsAt')
    if (!tenant) {
      return sendResponse(res, 404, false, 'Comercio no encontrado')
    }

    return sendResponse(res, 200, true, 'Configuración obtenida', {
      mpPublicKey: platformPublicKey,
      currentPlan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus || 'trialing',
      trialEndsAt: tenant.trialEndsAt,
    })
  } catch (error) {
    const statusCode = error?.statusCode || 500
    const message = error?.message || 'Error al obtener configuración'
    logger.error('Error en getSubscriptionConfig:', { error: message, statusCode, stack: error?.stack })
    return sendResponse(res, statusCode, false, message)
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
  const tenant = await loadTenantFromRequest(req)

  if (!tenant || !userId) {
    return sendResponse(res, 403, false, 'No autorizado')
  }

  try {
    // paymentMethodId e issuerId los manda el Brick y NO se usan: /preapproval
    // no los acepta (ver PreApprovalRequest), la tarjeta ya los lleva dentro del
    // token. Se dejan fuera del destructuring para que no parezca que se usan.
    const { plan, token, payer } = req.body

    // Se valida el valor CRUDO contra la lista, no el normalizado.
    //
    // normalizePlan convierte cualquier cosa desconocida en el plan más chico,
    // así que validar después de normalizar aceptaría "gratis", "free" o un
    // typo y cobraría un starter que el comercio no pidió. Antes se rechazaban
    // 'free' y 'enterprise' por nombre; ahora esos no existen y la lista es la
    // que manda.
    if (!AI_PLANS.includes(String(plan || '').trim().toLowerCase())) {
      return sendResponse(res, 400, false, 'Plan no válido para suscripción')
    }

    const normalizedPlan = normalizePlan(plan)

    // El email del pagador es lo único que Mercado Pago necesita del comprador:
    // es el campo con el que identifica a quién le cobra.
    //
    // Acá se exigía además `payer.name`, y eso rechazaba todo pago desde que el
    // formulario propio pasó a ser el Brick de Mercado Pago: el Brick manda
    // email e identificación, no un nombre suelto — el del titular viaja dentro
    // del token de la tarjeta. La validación quedó pidiendo un campo de una
    // pantalla que ya no existe.
    if (!payer?.email) {
      return sendResponse(res, 400, false, 'Falta el email del pagador')
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
        token,
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
      mpClient = createSubscriptionClient()
    } catch (mpError) {
      logger.error('Error obteniendo cliente MP:', mpError)
      return sendResponse(res, 503, false, 'Mercado Pago no está disponible')
    }

    // Crear suscripción en Mercado Pago
    let mpSubscription
    try {
      mpSubscription = await mpClient.create({
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
          // trialEndsAt ya no se mueve acá. Es la fecha de fin de PRUEBA y esto
          // es un alta paga: escribirle hoy+30 la convertía en "próximo cobro",
          // que es otro concepto y vive en nextBillingAt. Con el corte por
          // suscripción encendido, ese valor decidiría cuándo se le apaga la IA
          // a un comercio que está pagando.
          'integrations.subscriptionMercadoPago': {
            subscriptionId: mpSubscription.id,
            status: mpSubscription.status,
            payerEmail: payer.email,
            planSelected: normalizedPlan,
            subscribedAt: new Date(),
            ...readProviderBillingDates(mpSubscription),
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
            // La que informó Mercado Pago, o ninguna. Un email que promete un
            // cobro para una fecha inventada es peor que uno que no la menciona.
            nextPaymentDate: readProviderBillingDates(mpSubscription).nextBillingAt,
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
            // `createdAt` no está en el schema y se descartaba; el campo que
            // corresponde es subscribedAt. Guardar el id es lo que importa acá:
            // es lo único que le permite al webhook encontrar a este comercio
            // cuando Mercado Pago resuelva el pago pendiente.
            subscribedAt: new Date(),
            ...readProviderBillingDates(mpSubscription),
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
    const tenant = await loadTenantFromRequest(req)
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

/**
 * POST /api/subscriptions/change-plan
 * Cambiar el plan de suscripción actual
 */
export const changeSubscriptionPlan = async (req, res) => {
  const tenant = await loadTenantFromRequest(req)

  if (!tenant) {
    return sendResponse(res, 403, false, 'No autorizado')
  }

  try {
    const { newPlan } = req.body

    if (!newPlan) {
      return sendResponse(res, 400, false, 'Nuevo plan requerido')
    }

    const normalizedNewPlan = normalizePlan(newPlan)
    if (!AI_PLANS.includes(String(newPlan || '').trim().toLowerCase())) {
      return sendResponse(res, 400, false, 'Plan no válido para cambio')
    }

    if (normalizedNewPlan === tenant.plan) {
      return sendResponse(res, 400, false, 'Ya estás suscrito a este plan')
    }

    if (tenant.subscriptionStatus !== 'active' && tenant.subscriptionStatus !== 'past_due') {
      return sendResponse(res, 400, false, 'No puedes cambiar de plan en este momento')
    }

    // Obtener cliente de MP
    let mpClient
    try {
      mpClient = createSubscriptionClient()
    } catch (mpError) {
      logger.error('Error obteniendo cliente MP:', mpError)
      return sendResponse(res, 503, false, 'Mercado Pago no está disponible')
    }

    const mpSubId = tenant.integrations?.subscriptionMercadoPago?.subscriptionId
    if (!mpSubId) {
      return sendResponse(res, 400, false, 'Suscripción de Mercado Pago no encontrada')
    }

    // Actualizar el precio en MP
    const newPriceArs = getPlanMonthlyPriceArs(normalizedNewPlan)
    try {
      await mpClient.update({
        id: mpSubId,
        body: {
          auto_recurring: {
            transaction_amount: newPriceArs,
            currency_id: 'ARS',
          },
        },
      })
    } catch (mpError) {
      logger.error('Error actualizando suscripción en MP:', mpError)
      return sendResponse(res, 503, false, 'Error actualizando en Mercado Pago')
    }

    // Actualizar tenant
    await Tenant.findByIdAndUpdate(
      tenant._id,
      {
        plan: normalizedNewPlan,
        'integrations.subscriptionMercadoPago.planSelected': normalizedNewPlan,
        'integrations.subscriptionMercadoPago.updatedAt': new Date(),
      },
      { new: true },
    )

    logger.info('Plan de suscripción actualizado', {
      tenantId: tenant._id,
      oldPlan: tenant.plan,
      newPlan: normalizedNewPlan,
    })

    return sendResponse(res, 200, true, 'Plan actualizado exitosamente', {
      plan: normalizedNewPlan,
      status: 'active',
    })
  } catch (error) {
    logger.error('Error cambiando plan:', error)
    sendResponse(res, 500, false, 'Error al cambiar plan')
  }
}

/**
 * POST /api/subscriptions/cancel
 * Cancelar suscripción actual
 */
export const cancelSubscription = async (req, res) => {
  const tenant = await loadTenantFromRequest(req)

  if (!tenant) {
    return sendResponse(res, 403, false, 'No autorizado')
  }

  try {
    if (tenant.subscriptionStatus === 'cancelled') {
      return sendResponse(res, 400, false, 'La suscripción ya fue cancelada')
    }

    if (tenant.subscriptionStatus === 'expired') {
      return sendResponse(res, 400, false, 'La suscripción ya expiró')
    }

    const mpSubId = tenant.integrations?.subscriptionMercadoPago?.subscriptionId
    if (!mpSubId) {
      return sendResponse(res, 400, false, 'No hay suscripción activa')
    }

    // Obtener cliente de MP
    let mpClient
    try {
      mpClient = createSubscriptionClient()
    } catch (mpError) {
      logger.error('Error obteniendo cliente MP:', mpError)
      return sendResponse(res, 503, false, 'Mercado Pago no está disponible')
    }

    // Cancelar en MP
    try {
      await mpClient.update({
        id: mpSubId,
        body: {
          status: 'cancelled',
        },
      })
    } catch (mpError) {
      logger.error('Error cancelando suscripción en MP:', mpError)
      return sendResponse(res, 503, false, 'Error cancelando en Mercado Pago')
    }

    // Actualizar tenant
    await Tenant.findByIdAndUpdate(
      tenant._id,
      {
        subscriptionStatus: 'cancelled',
        // El plan NO se toca al cancelar. Antes se bajaba a 'free', que ya no
        // existe: quien deja de pagar conserva el plan que tenía y lo pierde
        // por el estado, que es lo que getSubscriptionState mira. Guardar cuál
        // era además permite reactivarlo sin volver a elegirlo.
        'integrations.subscriptionMercadoPago.status': 'cancelled',
        'integrations.subscriptionMercadoPago.cancelledAt': new Date(),
      },
      { new: true },
    )

    logger.info('Suscripción cancelada', {
      tenantId: tenant._id,
      plan: tenant.plan,
    })

    // Enviar email de cancelación
    try {
      const payerEmail = tenant.integrations?.subscriptionMercadoPago?.payerEmail
      if (payerEmail) {
        await sendTemplateEmail({
          to: payerEmail,
          template: 'subscription-cancelled',
          data: {
            tenantName: tenant.name,
          },
        })
      }
    } catch (emailError) {
      logger.warn('Error enviando email de cancelación:', emailError)
    }

    return sendResponse(res, 200, true, 'Suscripción cancelada exitosamente', {
      status: 'cancelled',
      // Se devuelve el plan que el comercio conserva, no uno inventado: cancelar
      // ya no cambia de plan, cambia el estado.
      plan: tenant.plan,
    })
  } catch (error) {
    logger.error('Error cancelando suscripción:', error)
    sendResponse(res, 500, false, 'Error al cancelar suscripción')
  }
}

/**
 * GET /api/subscriptions/invoices
 * Obtener historial de pagos/facturas
 */
export const getSubscriptionInvoices = async (req, res) => {
  const tenant = await loadTenantFromRequest(req)

  if (!tenant) {
    return sendResponse(res, 403, false, 'No autorizado')
  }

  try {
    const mpSubId = tenant.integrations?.subscriptionMercadoPago?.subscriptionId
    if (!mpSubId) {
      return sendResponse(res, 200, true, 'Sin facturas', {
        invoices: [],
      })
    }

    // Obtener cliente de MP
    let mpClient
    try {
      mpClient = createSubscriptionClient()
    } catch (mpError) {
      logger.error('Error obteniendo cliente MP:', mpError)
      return sendResponse(res, 503, false, 'Mercado Pago no está disponible')
    }

    // Obtener detalles de suscripción (incluye pagos)
    let mpSubscription
    try {
      mpSubscription = await mpClient.get({
        id: mpSubId,
      })
    } catch (mpError) {
      logger.error('Error obteniendo suscripción de MP:', mpError)
      return sendResponse(res, 503, false, 'Error obteniendo facturación')
    }

    const invoices = (mpSubscription.invoice_list || []).map(invoice => ({
      id: invoice.id,
      status: invoice.status,
      amount: invoice.amount,
      currency: invoice.currency_id,
      date: invoice.date_created,
      paidDate: invoice.date_approved,
      reason: invoice.reason,
    }))

    return sendResponse(res, 200, true, 'Facturas obtenidas', {
      invoices: invoices.sort((a, b) => new Date(b.date) - new Date(a.date)),
      subscriptionId: mpSubId,
    })
  } catch (error) {
    logger.error('Error obteniendo facturas:', error)
    sendResponse(res, 500, false, 'Error al obtener facturas')
  }
}

export default {
  getSubscriptionConfig,
  processSubscriptionPayment,
  getCurrentSubscription,
  changeSubscriptionPlan,
  cancelSubscription,
  getSubscriptionInvoices,
}
