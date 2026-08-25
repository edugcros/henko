// 📁 src/services/insights/aiInsightDetectionService.js
//
// Cuatro detectores, uno por tipo de problema (8.5) — cada uno lee datos que
// YA existen (ver aiInsightModel.js y el contexto del plan), nunca escribe
// nada. aiInsightService.js es quien persiste los candidatos que devuelven.
//
// Ninguno usa IA generativa: el diagnóstico (8.6) y la recomendación (8.7)
// salen de una plantilla en español rellenada con los números reales de la
// detección — no hay nada que redactar con creatividad, y una plantilla no
// puede inventar una causa que los datos no muestran.

import mongoose from 'mongoose'
import Order, { ORDER_STATUS, PAYMENT_STATUS } from '../../models/orderModel.js'
import Product from '../../models/productModel.js'
import UserMetricEvent, { USER_METRIC_EVENTS } from '../../models/userMetricEventModel.js'
import { getCartRecoveryRevenue } from '../aiAgent/aiAgentRevenueInsightsService.js'

const PAID_PAYMENT_STATUSES = [PAYMENT_STATUS.APPROVED]
const ACTIVE_ORDER_STATUSES = [
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
]

const readEnvNumber = (name, fallback) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

const round2 = value => Math.round(value * 100) / 100

const daysAgo = days => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

/**
 * Productos con mucho tráfico y poca conversión — cruza vistas (UserMetricEvent
 * PRODUCT_VIEW) contra compras reales (UserMetricEvent PURCHASE, items[],
 * mismo dato que ya carga commerceEventService.js::buildItems desde el
 * Bloque 1) — no hace falta ninguna fuente nueva, solo cruzar dos que ya
 * existen por producto.
 */
export const detectProductUnderperformance = async (tenantId, { days = 30 } = {}) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const since = daysAgo(days)
  const minViews = readEnvNumber('AI_INSIGHT_MIN_VIEWS', 30)
  const conversionThreshold = readEnvNumber('AI_INSIGHT_PRODUCT_CONVERSION_THRESHOLD', 1) / 100

  const [viewRows, purchaseRows] = await Promise.all([
    UserMetricEvent.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          occurredAt: { $gte: since },
          eventType: USER_METRIC_EVENTS.PRODUCT_VIEW,
          productId: { $ne: null },
        },
      },
      { $group: { _id: '$productId', views: { $sum: 1 } } },
    ]),
    UserMetricEvent.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          occurredAt: { $gte: since },
          eventType: USER_METRIC_EVENTS.PURCHASE,
          source: 'system',
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.productObjectId': { $ne: null } } },
      { $group: { _id: '$items.productObjectId', purchases: { $sum: '$items.quantity' } } },
    ]),
  ])

  const purchasesByProduct = new Map(purchaseRows.map(row => [String(row._id), row.purchases || 0]))

  const candidates = viewRows
    .filter(row => (row.views || 0) >= minViews)
    .map(row => {
      const productKey = String(row._id)
      const purchases = purchasesByProduct.get(productKey) || 0
      const conversionRate = row.views > 0 ? purchases / row.views : 0
      return { productId: productKey, views: row.views, purchases, conversionRate }
    })
    .filter(row => row.conversionRate < conversionThreshold)

  if (!candidates.length) return []

  const products = await Product.find({ _id: { $in: candidates.map(c => c.productId) }, tenantId })
    .select('title')
    .setOptions({ tenantId })
    .lean()
  const titleByProduct = new Map(products.map(p => [String(p._id), p.title]))

  return candidates
    .filter(c => titleByProduct.has(c.productId))
    .map(c => {
      const title = titleByProduct.get(c.productId)
      const conversionPct = round2(c.conversionRate * 100)
      return {
        type: 'product_underperformance',
        entity: { kind: 'product', id: c.productId, label: title },
        evidence: { views: c.views, purchases: c.purchases, conversionRate: conversionPct, days },
        priority: conversionPct === 0 ? 'high' : 'medium',
        title: `Bajo rendimiento: ${title}`,
        description: `"${title}" tuvo ${c.views} visitas y solo ${c.purchases} compras (${conversionPct}% de conversión) en los últimos ${days} días. Se recomienda revisar precio, imágenes o descripción — comparar contra productos similares con mejor conversión. Se vuelve a medir la conversión de este producto más adelante para confirmar si el cambio funcionó.`,
        measurement: { metricName: 'conversionRate', beforeValue: conversionPct },
      }
    })
}

/**
 * Caída de conversión (ventas pagadas / sesiones) esta semana vs. la
 * anterior — mismo patrón de ventana actual + ventana espejo anterior que ya
 * usa getSalesStats/getOrderStats en statsService.js, aplicado acá a la tasa
 * de conversión en vez de al revenue.
 */
export const detectCartConversionDrop = async (tenantId, { windowDays = 7 } = {}) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const dropThreshold = readEnvNumber('AI_INSIGHT_CONVERSION_DROP_PCT', 15) / 100

  const now = new Date()
  const currentStart = daysAgo(windowDays)
  const previousStart = daysAgo(windowDays * 2)

  const computeConversion = async (start, end) => {
    const [orders, sessionRows] = await Promise.all([
      Order.countDocuments({
        tenantId,
        isDeleted: { $ne: true },
        paymentStatus: { $in: PAID_PAYMENT_STATUSES },
        orderStatus: { $in: ACTIVE_ORDER_STATUSES },
        createdAt: { $gte: start, $lt: end },
      }).setOptions({ tenantId }),
      UserMetricEvent.aggregate([
        { $match: { tenantId: tenantObjectId, occurredAt: { $gte: start, $lt: end } } },
        { $group: { _id: '$sessionId' } },
        { $count: 'sessions' },
      ]),
    ])

    const sessions = sessionRows[0]?.sessions || 0
    const conversionRate = sessions > 0 ? orders / sessions : 0
    return { orders, sessions, conversionRate }
  }

  const [current, previous] = await Promise.all([
    computeConversion(currentStart, now),
    computeConversion(previousStart, currentStart),
  ])

  // Sin datos suficientes en la ventana anterior, no hay base real para
  // comparar — no se inventa una caída contra cero.
  if (previous.sessions < 10 || previous.conversionRate <= 0) return []

  const dropRatio = (previous.conversionRate - current.conversionRate) / previous.conversionRate
  if (dropRatio < dropThreshold) return []

  const currentPct = round2(current.conversionRate * 100)
  const previousPct = round2(previous.conversionRate * 100)
  const dropPct = round2(dropRatio * 100)

  return [
    {
      type: 'cart_conversion_drop',
      entity: { kind: null, id: '', label: '' },
      evidence: {
        currentConversionRate: currentPct,
        previousConversionRate: previousPct,
        dropPct,
        currentOrders: current.orders,
        currentSessions: current.sessions,
        windowDays,
      },
      priority: dropRatio >= 0.35 ? 'high' : 'medium',
      title: `Caída de conversión: ${dropPct}%`,
      description: `La conversión bajó de ${previousPct}% a ${currentPct}% en los últimos ${windowDays} días (antes: ${previous.orders} órdenes / ${previous.sessions} sesiones; ahora: ${current.orders} / ${current.sessions}). Se recomienda revisar el proceso de checkout, tiempos de carga, o si algún método de pago dejó de funcionar. Se vuelve a medir la conversión más adelante para confirmar si el cambio funcionó.`,
      measurement: { metricName: 'conversionRate', beforeValue: currentPct },
    },
  ]
}

/**
 * Recuperación de carritos (WhatsApp/email, Bloque 3) con conversión en
 * baja — DISTINTO de detectCartConversionDrop de arriba, que mide conversión
 * general del sitio (órdenes/sesiones) y puede caer por motivos que no
 * tienen nada que ver con la recuperación de carritos (checkout roto, medio
 * de pago caído). Este detector mide específicamente qué porción de los
 * mensajes de recuperación ENVIADOS terminó en compra — la métrica correcta
 * para respaldar una acción que refuerza esa estrategia puntual (Bloque 8.8,
 * ver aiInsightActionService.js::applyCartRecoveryReinforcement). Reusa
 * getCartRecoveryRevenue (Bloque 3/5), no duplica la agregación.
 */
export const detectCartRecoveryUnderperformance = async (tenantId, { windowDays = 7 } = {}) => {
  const dropThreshold = readEnvNumber('AI_INSIGHT_RECOVERY_DROP_PCT', 15) / 100
  const minRecoveriesForBaseline = readEnvNumber('AI_INSIGHT_MIN_RECOVERIES_FOR_BASELINE', 5)

  const now = new Date()
  const currentStart = daysAgo(windowDays)
  const previousStart = daysAgo(windowDays * 2)

  const [current, previous] = await Promise.all([
    getCartRecoveryRevenue(tenantId, currentStart, now),
    getCartRecoveryRevenue(tenantId, previousStart, currentStart),
  ])

  // Sin volumen suficiente de recuperaciones enviadas en el período anterior,
  // no hay base real para comparar — mismo criterio que detectCartConversionDrop.
  if (previous.total < minRecoveriesForBaseline || previous.conversionRate <= 0) return []

  const previousRate = previous.conversionRate / 100
  const currentRate = current.conversionRate / 100
  const dropRatio = (previousRate - currentRate) / previousRate
  if (dropRatio < dropThreshold) return []

  const dropPct = round2(dropRatio * 100)

  return [
    {
      type: 'cart_recovery_underperformance',
      entity: { kind: null, id: '', label: '' },
      evidence: {
        currentConversionRate: current.conversionRate,
        previousConversionRate: previous.conversionRate,
        dropPct,
        currentSent: current.total,
        currentConverted: current.converted,
        previousSent: previous.total,
        previousConverted: previous.converted,
        windowDays,
      },
      priority: dropRatio >= 0.35 ? 'high' : 'medium',
      title: `Recuperación de carritos con baja conversión: -${dropPct}%`,
      description: `De los mensajes de recuperación de carrito enviados en los últimos ${windowDays} días, ${current.converted} de ${current.total} terminaron en compra (${current.conversionRate}%) — antes convertía ${previous.conversionRate}% (${previous.converted}/${previous.total}). Se puede reforzar la estrategia (más intentos por carrito, personalización con IA) para intentar revertirlo. Se vuelve a medir para confirmar si ayudó.`,
      measurement: { metricName: 'recoveryConversionRate', beforeValue: current.conversionRate },
    },
  ]
}

/**
 * Campañas con mucho tráfico y pocas ventas — variante propia de la
 * agregación de traffic.sources que ya existe en statsService.js: mismo
 * $match/$group, pero ordenada por sesiones y sin el $limit de top-10-por-
 * revenue de la original (una campaña de tráfico alto y venta baja es
 * justo la que ese corte dejaría afuera).
 */
export const detectCampaignUnderperformance = async (tenantId, { days = 30 } = {}) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const since = daysAgo(days)
  const minSessions = readEnvNumber('AI_INSIGHT_MIN_SESSIONS', 50)
  const conversionThreshold = readEnvNumber('AI_INSIGHT_CAMPAIGN_CONVERSION_THRESHOLD', 1) / 100

  const rows = await UserMetricEvent.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        occurredAt: { $gte: since },
        'attribution.utmCampaign': { $ne: '' },
      },
    },
    {
      $group: {
        _id: '$attribution.utmCampaign',
        sessions: { $addToSet: '$sessionId' },
        conversions: {
          $sum: {
            $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PURCHASE] }, 1, 0],
          },
        },
      },
    },
    {
      $project: {
        campaign: '$_id',
        sessions: { $size: '$sessions' },
        conversions: 1,
        _id: 0,
      },
    },
    { $sort: { sessions: -1 } },
  ])

  return rows
    .filter(row => row.sessions >= minSessions)
    .map(row => ({ ...row, conversionRate: row.sessions > 0 ? row.conversions / row.sessions : 0 }))
    .filter(row => row.conversionRate < conversionThreshold)
    .map(row => {
      const conversionPct = round2(row.conversionRate * 100)
      return {
        type: 'campaign_underperformance',
        entity: { kind: 'campaign', id: row.campaign, label: row.campaign },
        evidence: { sessions: row.sessions, conversions: row.conversions, conversionRate: conversionPct, days },
        priority: conversionPct === 0 ? 'high' : 'medium',
        title: `Campaña de bajo rendimiento: ${row.campaign}`,
        description: `La campaña "${row.campaign}" trajo ${row.sessions} sesiones pero solo ${row.conversions} compras (${conversionPct}% de conversión) en los últimos ${days} días. Se recomienda revisar la segmentación, la página de destino, o pausarla si el costo por sesión es alto. Se vuelve a medir la conversión de esta campaña más adelante para confirmar si el cambio funcionó.`,
        measurement: { metricName: 'conversionRate', beforeValue: conversionPct },
      }
    })
}

/**
 * Clientes antes activos, ahora inactivos — agregación nueva de verdad: no
 * existía ningún cálculo de última compra / cantidad de compras por cliente
 * en ningún lado del código (confirmado antes de diseñar esto).
 */
export const detectCustomerInactivity = async tenantId => {
  const minOrdersForActive = readEnvNumber('AI_INSIGHT_MIN_ORDERS_FOR_ACTIVE', 2)
  const inactivityDays = readEnvNumber('AI_INSIGHT_INACTIVITY_DAYS', 45)
  const inactiveSince = daysAgo(inactivityDays)

  const rows = await Order.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(String(tenantId)),
        isDeleted: { $ne: true },
        paymentStatus: { $in: PAID_PAYMENT_STATUSES },
        orderStatus: { $in: ACTIVE_ORDER_STATUSES },
        orderby: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$orderby',
        lastOrderAt: { $max: '$createdAt' },
        orderCount: { $sum: 1 },
        lastCustomerName: { $last: '$customerSnapshot.firstname' },
      },
    },
    {
      $match: {
        orderCount: { $gte: minOrdersForActive },
        lastOrderAt: { $lt: inactiveSince },
      },
    },
  ])

  return rows.map(row => {
    const daysSinceLastOrder = Math.floor((Date.now() - new Date(row.lastOrderAt).getTime()) / 86400000)
    const label = row.lastCustomerName || 'Cliente'
    return {
      type: 'customer_inactivity',
      entity: { kind: 'customer', id: String(row._id), label },
      evidence: {
        orderCount: row.orderCount,
        lastOrderAt: row.lastOrderAt,
        daysSinceLastOrder,
      },
      priority: daysSinceLastOrder >= inactivityDays * 2 ? 'high' : 'medium',
      title: `Cliente inactivo: ${label}`,
      description: `${label} hizo ${row.orderCount} compras antes, pero no compra hace ${daysSinceLastOrder} días. Se recomienda un contacto directo (email, WhatsApp, o un cupón de reactivación). Se vuelve a revisar si volvió a comprar más adelante.`,
      measurement: { metricName: 'daysSinceLastOrder', beforeValue: daysSinceLastOrder },
    }
  })
}

// ─── Remedición puntual (8.9) ──────────────────────────────
//
// Los detectores de arriba escanean TODOS los candidatos de un tenant y
// filtran por umbral — para remedir un insight puntual (¿mejoró esta métrica
// específica?) hace falta el valor real de ESE producto/campaña/cliente, sin
// el filtro de umbral (si ya mejoró y no calificaría más como candidato,
// igual queremos saber el número real, no perderlo).

export const measureProductConversion = async (tenantId, productId, { days = 30 } = {}) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const productObjectId = new mongoose.Types.ObjectId(String(productId))
  const since = daysAgo(days)

  const [views, purchaseRows] = await Promise.all([
    UserMetricEvent.countDocuments({
      tenantId: tenantObjectId,
      occurredAt: { $gte: since },
      eventType: USER_METRIC_EVENTS.PRODUCT_VIEW,
      productId: productObjectId,
    }).setOptions({ tenantId }),
    UserMetricEvent.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          occurredAt: { $gte: since },
          eventType: USER_METRIC_EVENTS.PURCHASE,
          source: 'system',
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.productObjectId': productObjectId } },
      { $group: { _id: null, purchases: { $sum: '$items.quantity' } } },
    ]),
  ])

  const purchases = purchaseRows[0]?.purchases || 0
  const conversionRate = views > 0 ? round2((purchases / views) * 100) : 0
  return { views, purchases, conversionRate }
}

export const measureOverallConversion = async (tenantId, { windowDays = 7 } = {}) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const start = daysAgo(windowDays)
  const now = new Date()

  const [orders, sessionRows] = await Promise.all([
    Order.countDocuments({
      tenantId,
      isDeleted: { $ne: true },
      paymentStatus: { $in: PAID_PAYMENT_STATUSES },
      orderStatus: { $in: ACTIVE_ORDER_STATUSES },
      createdAt: { $gte: start, $lt: now },
    }).setOptions({ tenantId }),
    UserMetricEvent.aggregate([
      { $match: { tenantId: tenantObjectId, occurredAt: { $gte: start, $lt: now } } },
      { $group: { _id: '$sessionId' } },
      { $count: 'sessions' },
    ]),
  ])

  const sessions = sessionRows[0]?.sessions || 0
  const conversionRate = sessions > 0 ? round2((orders / sessions) * 100) : 0
  return { orders, sessions, conversionRate }
}

export const measureCartRecoveryConversion = async (tenantId, { windowDays = 7 } = {}) => {
  const start = daysAgo(windowDays)
  const now = new Date()
  const { conversionRate, total, converted } = await getCartRecoveryRevenue(tenantId, start, now)
  return { conversionRate, total, converted }
}

export const measureCampaignConversion = async (tenantId, campaign, { days = 30 } = {}) => {
  const tenantObjectId = new mongoose.Types.ObjectId(String(tenantId))
  const since = daysAgo(days)

  const rows = await UserMetricEvent.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        occurredAt: { $gte: since },
        'attribution.utmCampaign': campaign,
      },
    },
    {
      $group: {
        _id: null,
        sessions: { $addToSet: '$sessionId' },
        conversions: {
          $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PURCHASE] }, 1, 0] },
        },
      },
    },
  ])

  const sessions = rows[0]?.sessions?.length || 0
  const conversions = rows[0]?.conversions || 0
  const conversionRate = sessions > 0 ? round2((conversions / sessions) * 100) : 0
  return { sessions, conversions, conversionRate }
}

export const measureCustomerDaysSinceLastOrder = async (tenantId, customerId) => {
  const lastOrder = await Order.findOne({
    tenantId,
    orderby: customerId,
    isDeleted: { $ne: true },
    paymentStatus: { $in: PAID_PAYMENT_STATUSES },
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
  })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .setOptions({ tenantId })
    .lean()

  if (!lastOrder) return { daysSinceLastOrder: null }

  const daysSinceLastOrder = Math.floor((Date.now() - new Date(lastOrder.createdAt).getTime()) / 86400000)
  return { daysSinceLastOrder }
}
