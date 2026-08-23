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

export default { recordServerPurchaseEvent }
