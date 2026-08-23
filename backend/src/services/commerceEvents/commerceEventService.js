// 📁 src/services/commerceEvents/commerceEventService.js
//
// Registro server-side de PURCHASE — la fuente de verdad de "qué comercio
// vendió qué, a quién, por cuánto". Complementa (no reemplaza) el PURCHASE
// que ya dispara el navegador (source: storefront, ver
// website/src/services/userMetricsService.js): ese sigue sirviendo a
// GA4/Meta en tiempo real, pero puede perderse (pestaña cerrada, request
// fallido, bloqueador). Este es el que HENKO usa como verdad interna.
//
// No crea una colección nueva — escribe sobre UserMetricEvent, que ya cubre
// el vocabulario de eventos, el aislamiento multi-tenant (tenantPlugin) y la
// deduplicación (índice único parcial {tenantId, eventId}) que este registro
// necesita. Construir un sistema paralelo hubiera duplicado algo que ya
// funciona.

import UserMetricEvent, { USER_METRIC_EVENTS } from '../../models/userMetricEventModel.js'
import { Money } from '../../utils/money.js'
import logger from '../../../config/logger.js'

const sanitizeString = (value, max = 500) => String(value || '').trim().slice(0, max)

// Determinístico y distinto del `purchase-<uuid>` aleatorio que usa el
// cliente (ver userMetricsService.js) — así nunca colisionan en el índice
// único, y un mismo intento de escritura del servidor, repetido por webhook
// o poll, siempre pisa el mismo documento en vez de crear uno nuevo.
const getOrderEventId = order => `commerce_purchase:${order._id}`

const buildItems = order => (order.products || []).map(item => ({
  productId: String(item.product || ''),
  productObjectId: item.product || null,
  title: sanitizeString(item.titleSnapshot, 180),
  sku: sanitizeString(item.skuSnapshot, 120),
  quantity: Number(item.count || 0),
  price: Money.toDecimal(item.priceCents || 0),
  subtotal: Money.toDecimal((item.priceCents || 0) * (item.count || 0)),
}))

/**
 * Nunca tira — un fallo acá no debe romper la confirmación del pago.
 * Idempotente en dos capas: order.commercePurchaseEventSent (guarda rápida
 * en memoria) + índice único parcial {tenantId, eventId} (red de seguridad
 * si webhook y poll corren en paralelo bajo locks distintos).
 */
export const recordServerPurchaseEvent = async ({ order, tenantId, req }) => {
  if (!order || order.commercePurchaseEventSent) {
    return { recorded: false, reason: 'already_sent' }
  }

  // Nunca leer req acá para el sessionId — solo order.sessionId, capturado
  // una vez al crear la orden. Si se leyera de req en el camino de webhook o
  // poll, la sesión registrada sería la de quien está mirando el estado del
  // pedido en ESE momento, no la del visitante que compró — rompiendo la
  // trazabilidad que este registro existe para garantizar.
  const sessionId = sanitizeString(order.sessionId, 180) || `server:${order._id}`

  try {
    await UserMetricEvent.create({
      tenantId,
      userId: order.orderby,
      eventId: getOrderEventId(order),
      sessionId,
      tenantDomain: sanitizeString(req?.headers?.host || '', 180),
      eventType: USER_METRIC_EVENTS.PURCHASE,
      source: 'system',
      attribution: {
        utmSource: sanitizeString(order.attribution?.utmSource, 120),
        utmMedium: sanitizeString(order.attribution?.utmMedium, 120),
        utmCampaign: sanitizeString(order.attribution?.utmCampaign, 160),
        utmContent: sanitizeString(order.attribution?.utmContent, 160),
        utmTerm: sanitizeString(order.attribution?.utmTerm, 160),
      },
      orderObjectId: order._id,
      orderId: String(order._id),
      paymentId: sanitizeString(order.paymentIntent?.providerPaymentId, 180),
      value: Money.toDecimal(order.paymentIntent?.amountCents || 0),
      currency: sanitizeString(order.paymentIntent?.currency, 12),
      quantity: (order.products || []).reduce((sum, item) => sum + Number(item.count || 0), 0),
      items: buildItems(order),
      commerce: {
        orderValue: Money.toDecimal(order.paymentIntent?.amountCents || 0),
        discountValue: Money.toDecimal(order.paymentIntent?.discountAmountCents || 0),
        itemsCount: (order.products || []).length,
      },
      occurredAt: order.paidAt || new Date(),
    })

    order.commercePurchaseEventSent = true
    order.commercePurchaseEventSentAt = new Date()

    return { recorded: true }
  } catch (error) {
    if (error?.code === 11000) {
      // Ya existe (carrera webhook/poll bajo locks distintos) — no es un
      // error. Igual se marca el flag en memoria: si no, y este mismo save
      // no llega a persistirlo, cada reconciliación futura repetiría el
      // intento de escritura (y el choque contra el índice) para siempre.
      order.commercePurchaseEventSent = true
      order.commercePurchaseEventSentAt = order.commercePurchaseEventSentAt || new Date()
      return { recorded: false, reason: 'duplicate' }
    }

    logger.error('❌ Error registrando PURCHASE server-side', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      message: error?.message,
    })
    return { recorded: false, reason: 'error', error: error?.message }
  }
}

const AI_INFLUENCE_WINDOW_DAYS = Number(process.env.AI_INFLUENCE_WINDOW_DAYS || 30)

/**
 * Si alguno de los productos de esta orden llegó al carrito por una acción
 * explícita del agente de IA (no "el cliente charló con la IA", sino "la IA
 * generó el agregado al carrito de este producto puntual" — ver
 * AiCartActionBridge.js), lo marca en el mismo registro de PURCHASE que ya
 * escribió recordServerPurchaseEvent. Nunca tira.
 */
export const markOrderAiInfluenced = async ({ order, tenantId }) => {
  if (!order?.orderby) return { influenced: false, reason: 'no_user' }

  try {
    const productIds = (order.products || []).map(item => item.product).filter(Boolean)
    if (!productIds.length) return { influenced: false, reason: 'no_products' }

    const since = new Date(Date.now() - AI_INFLUENCE_WINDOW_DAYS * 86400000)

    const aiAddEvents = await UserMetricEvent.find({
      tenantId,
      userId: order.orderby,
      eventType: USER_METRIC_EVENTS.ADD_TO_CART,
      source: 'agent',
      productId: { $in: productIds },
      occurredAt: { $gte: since, $lte: order.paidAt || new Date() },
    })
      .select('productId')
      .setOptions({ tenantId })

    if (!aiAddEvents.length) return { influenced: false, reason: 'no_match' }

    const influencedProductIds = [...new Set(aiAddEvents.map(event => String(event.productId)))]

    await UserMetricEvent.updateOne(
      { tenantId, eventId: getOrderEventId(order) },
      {
        $set: {
          'metadata.aiInfluenced': true,
          'metadata.aiInfluencedProductIds': influencedProductIds,
        },
      },
    ).setOptions({ tenantId })

    return { influenced: true, productIds: influencedProductIds }
  } catch (error) {
    logger.error('❌ Error marcando orden como influenciada por IA', {
      orderId: order?._id?.toString?.(),
      tenantId: String(tenantId),
      message: error?.message,
    })
    return { influenced: false, reason: 'error', error: error?.message }
  }
}

export default { recordServerPurchaseEvent, markOrderAiInfluenced }
