// 📁 src/services/statsService.js

import Order, {
  ORDER_STATUS,
  PAYMENT_STATUS,
} from '../models/orderModel.js'
import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import Cart from '../models/cartModel.js'
import UserMetricEvent, { USER_METRIC_EVENTS } from '../models/userMetricEventModel.js'
import { Money } from '../utils/money.js'
import mongoose from 'mongoose'
import { env } from '../../config/env.js'
import logger from '../../config/logger.js'

const PAID_PAYMENT_STATUSES = [PAYMENT_STATUS.APPROVED]
const ACTIVE_ORDER_STATUSES = [
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
]

const metricsConfig = {
  topProductsLimit: 10,
  topPagesLimit: 10,
  topSearchesLimit: 10,
  trafficSourcesLimit: 10,
  lowStockThreshold: 5,
  internalPeriodDays: 30,
  abandonedCartMinutes: 60,
  latestAbandonedCartsLimit: 10,
  abandonedCartProductPreviewLimit: 3,
  realtimeWindowMinutes: 5,
  ga4ProductPerformanceLimit: 10,
  ...(env?.metrics || {}),
}

const loadGA4ReportingService = async () => {
  try {
    const module = await import('./analytics/ga4Reporting.service.js')
    return module.GA4ReportingService || module.default || null
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
      throw error
    }

    return null
  }
}

// ============================================================================
// 1. MÉTRICAS PRINCIPALES DEL DASHBOARD (KPIs)
// ============================================================================

/**
 * Obtiene estadísticas agregadas para el dashboard admin
 * Incluye: ventas, órdenes, usuarios, productos, stock bajo
 */
export const getDashboardStats = async (tenantId, timeframe = '30d') => {
  const dateRange = getDateRange(timeframe)

  // Ejecutar consultas en paralelo para optimizar performance
  const [
    salesStats,
    orderStats,
    userStats,
    productStats,
    lowStockProducts,
    abandonedCartStats,
    activeCartStats,
    cartDailyStats,
    topProducts,
    topVisitedProducts,
    topClickedProducts,
    userBehaviorStats,
    realtimeStats,
    paymentStats,
  ] = await Promise.all([
    getSalesStats(tenantId, dateRange),
    getOrderStats(tenantId, dateRange),
    getUserStats(tenantId, dateRange),
    getProductStats(tenantId),
    getLowStockProducts(tenantId),
    getAbandonedCartStats(tenantId, dateRange),
    getActiveCartStats(tenantId, dateRange),
    getCartDailyStats(tenantId, dateRange),
    getTopSellingProducts(tenantId, dateRange, metricsConfig.topProductsLimit),
    getTopVisitedProducts(tenantId, dateRange, metricsConfig.topProductsLimit),
    getTopClickedProducts(tenantId, dateRange, metricsConfig.topProductsLimit),
    getUserBehaviorStats(tenantId, dateRange),
    getRealtimeStats(tenantId),
    getPaymentStats(tenantId, dateRange),
  ])

  const conversionRate = calculateRate(orderStats.paidOrders, userBehaviorStats.sessions)
  const dailyWithCarts = mergeDailyMetrics(
    salesStats.dailyBreakdown,
    orderStats.dailyBreakdown,
    userBehaviorStats.dailyActivity,
    cartDailyStats,
  )
  const funnel = buildInternalFunnel({
    userBehaviorStats,
    paidOrders: orderStats.paidOrders,
    abandonedCarts: abandonedCartStats.count,
  })

  return {
    summary: {
      revenue: salesStats.totalRevenue,
      revenueGrowth: salesStats.growth,
      orders: orderStats.totalOrders,
      ordersGrowth: orderStats.growth,
      averageOrderValue: orderStats.averageOrderValue,
      paidOrders: orderStats.paidOrders,
      pendingOrders: orderStats.pendingOrders,
      customers: userStats.totalCustomers,
      newCustomers: userStats.newCustomers,
      users: userStats.totalCustomers,
      sessions: userBehaviorStats.sessions,
      pageViews: userBehaviorStats.pageViews,
      productViews: userBehaviorStats.productViews,
      searches: userBehaviorStats.searches,
      logins: userBehaviorStats.logins,
      productImpressions: userBehaviorStats.productImpressions,
      productClicks: userBehaviorStats.productClicks,
      addToCart: userBehaviorStats.addToCart,
      removeFromCart: userBehaviorStats.removeFromCart,
      checkoutStarts: userBehaviorStats.checkoutStarts,
      paymentAttempts: paymentStats.attempts,
      paymentApproved: paymentStats.approved,
      paymentRejected: paymentStats.rejected,
      purchaseEvents: userBehaviorStats.purchases,
      authenticatedSessions: userBehaviorStats.authenticatedSessions,
      anonymousSessions: userBehaviorStats.anonymousSessions,
      conversions: orderStats.paidOrders,
      products: productStats.totalProducts,
      activeProducts: productStats.activeProducts,
      activeCarts: activeCartStats.count,
      activeCartValue: activeCartStats.value,
      activeCartItems: activeCartStats.items,
      abandonedCarts: abandonedCartStats.count,
      abandonedCartValue: abandonedCartStats.value,
      abandonedCartItems: abandonedCartStats.items,
      conversionRate,
      productClickThroughRate: calculateRate(userBehaviorStats.productClicks, userBehaviorStats.productImpressions),
      productViewRate: calculateRate(userBehaviorStats.productViewSessions, userBehaviorStats.sessions),
      addToCartRate: calculateRate(userBehaviorStats.addToCartSessions, userBehaviorStats.sessions),
      checkoutStartRate: calculateRate(userBehaviorStats.checkoutStartSessions, userBehaviorStats.sessions),
      paymentApprovalRate: paymentStats.approvalRate,
    },
    lowStock: lowStockProducts,
    activeCarts: activeCartStats,
    abandonedCarts: abandonedCartStats,
    topProducts,
    topVisitedProducts,
    topClickedProducts,
    userBehavior: userBehaviorStats,
    orderStatusBreakdown: orderStats.statusBreakdown,
    paymentStatusBreakdown: orderStats.paymentStatusBreakdown,
    trends: {
      daily: dailyWithCarts,
      dailyRevenue: salesStats.dailyBreakdown,
      dailyOrders: orderStats.dailyBreakdown,
      cartDaily: cartDailyStats,
    },
    traffic: {
      sources: userBehaviorStats.sources,
    },
    ecommerce: {
      funnel,
      payment: paymentStats,
      carts: {
        active: activeCartStats,
        abandoned: abandonedCartStats,
      },
      topVisitedProducts,
      topClickedProducts,
      topSellingProducts: topProducts,
    },
    definitions: {
      activeCart: activeCartStats.definition,
      abandonedCart: abandonedCartStats.definition,
      conversionRate: {
        source: 'orders + storefront sessions',
        formula: 'paidOrders / sessions * 100',
        paidOrderPaymentStatuses: PAID_PAYMENT_STATUSES,
        paidOrderStatuses: ACTIVE_ORDER_STATUSES,
      },
      realtime: realtimeStats.definition,
    },
    realtime: realtimeStats,
  }
}

// ============================================================================
// 2. ANÁLISIS DE VENTAS
// ============================================================================

const getSalesStats = async (tenantId, dateRange) => {
  const matchStage = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
    paymentStatus: { $in: PAID_PAYMENT_STATUSES },
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
    isDeleted: false,
    createdAt: { $gte: dateRange.start, $lte: dateRange.end },
  }

  const [currentPeriod, previousPeriod] = await Promise.all([
    // Período actual
    Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$paymentIntent.amountCents' },
          count: { $sum: 1 },
          daily: {
            $push: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              amount: '$paymentIntent.amountCents',
            },
          },
        },
      },
    ]),

    // Período anterior (para calcular growth)
    Order.aggregate([
      {
        $match: {
          ...matchStage,
          createdAt: {
            $gte: new Date(dateRange.start.getTime() - (dateRange.end - dateRange.start)),
            $lte: dateRange.start,
          },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$paymentIntent.amountCents' },
        },
      },
    ]),
  ])

  const current = currentPeriod[0] || { totalRevenue: 0, count: 0, daily: [] }
  const previous = previousPeriod[0] || { totalRevenue: 0 }

  // Calcular crecimiento porcentual
  const growth = previous.totalRevenue > 0
    ? ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue * 100).toFixed(2)
    : 0

  // Agregar días sin ventas para gráfico completo
  const dailyBreakdown = fillMissingDays(
    aggregateByDate(current.daily || []),
    dateRange.start,
    dateRange.end,
  ).map(day => ({
    ...day,
    revenue: Money.toDecimal(day.revenue),
  }))

  return {
    totalRevenue: Money.toDecimal(current.totalRevenue),
    count: current.count,
    growth: parseFloat(growth),
    dailyBreakdown,
  }
}

// ============================================================================
// 3. ANÁLISIS DE ÓRDENES
// ============================================================================

const getOrderStats = async (tenantId, dateRange) => {
  const matchStage = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
    isDeleted: false,
    createdAt: { $gte: dateRange.start, $lte: dateRange.end },
  }

  const previousRangeMs = dateRange.end.getTime() - dateRange.start.getTime()

  const [stats, previousStats] = await Promise.all([
    Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          paidOrders: {
            $sum: {
              $cond: [{ $in: ['$paymentStatus', PAID_PAYMENT_STATUSES] }, 1, 0],
            },
          },
          pendingOrders: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', PAYMENT_STATUS.PENDING] }, 1, 0],
            },
          },
          paidAmount: {
            $sum: {
              $cond: [
                { $in: ['$paymentStatus', PAID_PAYMENT_STATUSES] },
                { $ifNull: ['$paymentIntent.amountCents', 0] },
                0,
              ],
            },
          },
          totalAmount: { $sum: { $ifNull: ['$paymentIntent.amountCents', 0] } },
          daily: {
            $push: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: 1,
            },
          },
          statusBreakdown: { $push: '$orderStatus' },
          paymentStatusBreakdown: { $push: '$paymentStatus' },
        },
      },
    ]),

    Order.aggregate([
      {
        $match: {
          ...matchStage,
          createdAt: {
            $gte: new Date(dateRange.start.getTime() - previousRangeMs),
            $lt: dateRange.start,
          },
        },
      },
      { $group: { _id: null, totalOrders: { $sum: 1 } } },
    ]),
  ])

  const current = stats[0] || {
    totalOrders: 0,
    paidOrders: 0,
    pendingOrders: 0,
    paidAmount: 0,
    totalAmount: 0,
    daily: [],
    statusBreakdown: [],
    paymentStatusBreakdown: [],
  }
  const previous = previousStats[0] || { totalOrders: 0 }

  const growth = previous.totalOrders > 0
    ? ((current.totalOrders - previous.totalOrders) / previous.totalOrders * 100).toFixed(2)
    : 0

  // AOV real: revenue pagado / órdenes pagadas.
  const paidOrders = current.paidOrders || 0
  const aov = paidOrders > 0
    ? Money.toDecimal(current.paidAmount || 0) / paidOrders
    : 0

  const statusCounts = (current.statusBreakdown || []).reduce((acc, status) => {
    acc[status || 'unknown'] = (acc[status || 'unknown'] || 0) + 1
    return acc
  }, {})

  const paymentStatusCounts = (current.paymentStatusBreakdown || []).reduce((acc, status) => {
    acc[status || 'unknown'] = (acc[status || 'unknown'] || 0) + 1
    return acc
  }, {})

  return {
    totalOrders: current.totalOrders || 0,
    paidOrders,
    pendingOrders: current.pendingOrders || 0,
    averageOrderValue: parseFloat(aov.toFixed(2)),
    growth: parseFloat(growth),
    statusBreakdown: statusCounts,
    paymentStatusBreakdown: paymentStatusCounts,
    dailyBreakdown: fillMissingDays(
      aggregateByDate(current.daily || [], 'count'),
      dateRange.start,
      dateRange.end,
    ),
  }
}

// ============================================================================
// 4. ANÁLISIS DE USUARIOS/CLIENTES
// ============================================================================

const getUserStats = async (tenantId, dateRange) => {
  const [totalCustomers, newCustomers] = await Promise.all([
    // Total de clientes del tenant
    User.countDocuments({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      role: 'user',
    }),

    // Nuevos clientes en el período
    User.countDocuments({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      role: 'user',
      createdAt: { $gte: dateRange.start, $lte: dateRange.end },
    }),
  ])

  return {
    totalCustomers,
    newCustomers,
  }
}

// ============================================================================
// 5. ANÁLISIS DE PRODUCTOS
// ============================================================================

const buildEffectiveStockExpression = () => ({
  $cond: [
    { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
    {
      $sum: {
        $map: {
          input: {
            $filter: {
              input: { $ifNull: ['$variants', []] },
              as: 'variant',
              cond: { $ne: ['$$variant.isActive', false] },
            },
          },
          as: 'variant',
          in: { $ifNull: ['$$variant.stock', 0] },
        },
      },
    },
    { $ifNull: ['$stock', 0] },
  ],
})

const buildInventoryValueExpression = () => ({
  $cond: [
    { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
    {
      $sum: {
        $map: {
          input: {
            $filter: {
              input: { $ifNull: ['$variants', []] },
              as: 'variant',
              cond: { $ne: ['$$variant.isActive', false] },
            },
          },
          as: 'variant',
          in: {
            $multiply: [
              { $ifNull: ['$$variant.price', { $ifNull: ['$price', 0] }] },
              { $ifNull: ['$$variant.stock', 0] },
            ],
          },
        },
      },
    },
    {
      $multiply: [
        { $ifNull: ['$price', 0] },
        { $ifNull: ['$stock', 0] },
      ],
    },
  ],
})

const getProductStats = async tenantId => {
  const threshold = Number(metricsConfig.lowStockThreshold || 5)

  const stats = await Product.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        isDeleted: false,
      },
    },
    {
      $addFields: {
        effectiveStock: buildEffectiveStockExpression(),
        inventoryValue: buildInventoryValueExpression(),
      },
    },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        activeProducts: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
        },
        outOfStock: {
          $sum: { $cond: [{ $lte: ['$effectiveStock', 0] }, 1, 0] },
        },
        lowStock: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gt: ['$effectiveStock', 0] },
                  { $lte: ['$effectiveStock', { $ifNull: ['$minStockAlert', threshold] }] },
                ],
              },
              1,
              0,
            ],
          },
        },
        totalInventoryValue: { $sum: '$inventoryValue' },
      },
    },
  ])

  const result = stats[0] || {
    totalProducts: 0,
    activeProducts: 0,
    outOfStock: 0,
    lowStock: 0,
    totalInventoryValue: 0,
  }

  return {
    totalProducts: result.totalProducts,
    activeProducts: result.activeProducts,
    outOfStock: result.outOfStock,
    lowStockCount: result.lowStock,
    inventoryValue: Money.toDecimal(result.totalInventoryValue),
  }
}

const getLowStockProducts = async (tenantId, limit = metricsConfig.topProductsLimit) => {
  const threshold = Number(metricsConfig.lowStockThreshold || 5)

  const products = await Product.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        isDeleted: false,
      },
    },
    {
      $addFields: {
        effectiveStock: buildEffectiveStockExpression(),
        effectiveMinStock: { $ifNull: ['$minStockAlert', threshold] },
      },
    },
    {
      $match: {
        effectiveStock: { $gt: 0 },
        $expr: { $lte: ['$effectiveStock', '$effectiveMinStock'] },
      },
    },
    { $sort: { effectiveStock: 1 } },
    { $limit: Number(limit || 10) },
    {
      $project: {
        title: 1,
        name: 1,
        sku: 1,
        stock: '$effectiveStock',
        minStockAlert: '$effectiveMinStock',
        price: 1,
        images: 1,
      },
    },
  ])

  return products.map(p => ({
    id: p._id,
    name: p.title || p.name,
    sku: p.sku,
    currentStock: p.stock,
    minStock: p.minStockAlert || threshold,
    stockStatus: p.stock === 0 ? 'out_of_stock' : 'low_stock',
    price: Money.toDecimal(p.price),
    image: p.images?.[0]?.url || null,
  }))
}

// ============================================================================
// 6. DATOS PARA GRÁFICOS (CHARTS)
// ============================================================================

/**
 * Datos para gráfico de ventas (usado en adminController.getSalesChartData)
 * y también internamente para el dashboard
 */
export const getSalesChartDataInternal = async (tenantId, days = metricsConfig.internalPeriodDays) => {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - parseInt(days))
  startDate.setHours(0, 0, 0, 0)

  const chartData = await Order.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        isDeleted: false,
        paymentStatus: { $in: PAID_PAYMENT_STATUSES },
        orderStatus: { $in: ACTIVE_ORDER_STATUSES },
        createdAt: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        revenue: { $sum: '$paymentIntent.amountCents' },
        orders: { $sum: 1 },
        items: { $sum: { $size: '$products' } },
      },
    },
    { $sort: { _id: 1 } },
  ])

  // Rellenar días faltantes con ceros
  const filledData = fillMissingDays(
    chartData.map(day => ({
      date: day._id,
      revenue: Money.toDecimal(day.revenue),
      orders: day.orders,
      items: day.items,
    })),
    startDate,
    new Date(),
  )

  return filledData
}

// ============================================================================
// 7. GOOGLE ANALYTICS 4 - INTEGRACIÓN
// ============================================================================

/**
 * Obtiene estadísticas unificadas de marketing (GA4 + datos propios)
 * Usado en adminController.getDashboardData
 */
export const getUnifiedMarketingStats = async tenant => {
  const ga4 = tenant.integrations?.ga4

  // Si no está configurado GA4, retornar solo datos internos
  if (!ga4?.isEnabled || !ga4?.measurementId) {
    return {
      analytics: null,
      status: 'not_configured',
      message: 'Google Analytics no configurado para este tenant',
      internal: await getInternalMarketingStats(tenant._id),
    }
  }

  try {
    // Si tiene Service Account, obtener datos de Reporting API
    if (ga4.serviceAccountKey) {
      return await getGA4ReportingStats(tenant, ga4)
    }

    // Si solo tiene Measurement ID, retornar configuración básica
    return {
      analytics: {
        configured: true,
        measurementId: ga4.measurementId,
        hasReportingAccess: false,
        message: 'Configurado para tracking. Agrega Service Account para métricas detalladas.',
      },
      status: 'partially_configured',
      internal: await getInternalMarketingStats(tenant._id),
    }

  } catch (error) {
    logger.error('[GA4 Unified Stats Error]', {
      message: error?.message || 'Error desconocido',
    })
    return {
      analytics: {
        configured: true,
        error: error.message,
        hasReportingAccess: false,
      },
      status: 'error',
      internal: await getInternalMarketingStats(tenant._id),
    }
  }
}

/**
 * Obtiene estadísticas completas de GA4 Reporting API
 */
const getGA4ReportingStats = async (tenant, ga4) => {
  try {
    const GA4ReportingService = await loadGA4ReportingService()

    if (!GA4ReportingService) {
      const internalStats = await getInternalMarketingStats(tenant._id)

      return {
        analytics: {
          configured: true,
          measurementId: ga4.measurementId,
          hasReportingAccess: false,
          message: 'GA4 Reporting no está instalado. Se muestran métricas internas.',
        },
        status: 'partially_configured',
        internal: internalStats,
      }
    }

    const service = new GA4ReportingService(
      ga4.serviceAccountKey,
      ga4.propertyId,
    )
    
    // Período configurado para métricas internas.
    const endDate = new Date().toISOString().split('T')[0]
    const ga4PeriodMs = metricsConfig.internalPeriodDays * 24 * 60 * 60 * 1000
    const startDate = new Date(Date.now() - ga4PeriodMs)
      .toISOString().split('T')[0]

    // Obtener datos en paralelo
    const [metrics, funnel, products, sources, realtime] = await Promise.all([
      service.getDashboardMetrics(startDate, endDate).catch(() => null),
      service.getEcommerceFunnel(startDate, endDate).catch(() => null),
      service.getProductPerformance(
        startDate,
        endDate,
        metricsConfig.ga4ProductPerformanceLimit,
      ).catch(() => null),
      service.getTrafficSources(startDate, endDate).catch(() => null),
      service.getRealtimeMetrics().catch(() => null),
    ])

    // Calcular métricas de conversión internas vs GA4
    const internalStats = await getInternalMarketingStats(tenant._id)

    return {
      analytics: {
        configured: true,
        measurementId: ga4.measurementId,
        hasReportingAccess: true,
        period: { startDate, endDate },
        summary: metrics ? {
          sessions: parseInt(metrics.totals?.sessions || 0),
          users: parseInt(metrics.totals?.totalUsers || 0),
          newUsers: parseInt(metrics.totals?.newUsers || 0),
          pageViews: parseInt(metrics.totals?.screenPageViews || 0),
          avgSessionDuration: parseFloat(metrics.totals?.averageSessionDuration || 0),
          bounceRate: parseFloat(metrics.totals?.bounceRate || 0),
          conversions: parseInt(metrics.totals?.conversions || 0),
          ga4Revenue: parseFloat(metrics.totals?.eventValue || 0),
        } : null,
        dailyTrend: metrics?.data || [],
        ecommerceFunnel: funnel,
        products: products || { topSelling: [], topViewed: [] },
        trafficSources: sources?.data?.map(s => ({
          channel: s.sessionDefaultChannelGroup,
          sessions: parseInt(s.sessions || 0),
          users: parseInt(s.totalUsers || 0),
          conversions: parseInt(s.conversions || 0),
          revenue: parseFloat(s.eventValue || 0),
        })) || [],
        realtime: realtime || null,
      },
      status: 'connected',
      internal: internalStats,
      comparison: metrics ? {
        // Comparar revenue interno vs GA4 (diferencia por refunds, etc.)
        internalRevenue: internalStats.revenue,
        ga4Revenue: parseFloat(metrics.totals?.eventValue || 0),
        discrepancy: internalStats.revenue - parseFloat(metrics.totals?.eventValue || 0),
      } : null,
    }

  } catch (error) {
    logger.error('[GA4 Reporting Stats Error]', {
      message: error?.message || 'Error desconocido',
    })
    throw error
  }
}

/**
 * Estadísticas de marketing internas (sin GA4)
 */
const getInternalMarketingStats = async tenantId => {
  const internalPeriodMs = metricsConfig.internalPeriodDays * 24 * 60 * 60 * 1000
  const periodStart = new Date(Date.now() - internalPeriodMs)

  const dateRange = {
    start: periodStart,
    end: new Date(),
  }

  const [orders, activeCarts, abandonedCarts, topProducts, topVisitedProducts] = await Promise.all([
    // Órdenes completadas
    Order.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          paymentStatus: { $in: PAID_PAYMENT_STATUSES },
          orderStatus: { $in: ACTIVE_ORDER_STATUSES },
          createdAt: { $gte: periodStart },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: '$paymentIntent.amountCents' },
          avgOrderValue: { $avg: '$paymentIntent.amountCents' },
        },
      },
    ]),

    getActiveCartStats(tenantId, dateRange),
    getAbandonedCartStats(tenantId, dateRange),

    // Top productos vendidos
    Order.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          paymentStatus: { $in: PAID_PAYMENT_STATUSES },
          orderStatus: { $in: ACTIVE_ORDER_STATUSES },
          createdAt: { $gte: periodStart },
        },
      },
      { $unwind: '$products' },
      {
        $group: {
          _id: '$products.product',
          name: { $first: '$products.titleSnapshot' },
          quantity: { $sum: '$products.count' },
          revenue: { $sum: '$products.subtotalCents' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: metricsConfig.topProductsLimit },
    ]),

    getTopVisitedProducts(tenantId, dateRange, metricsConfig.topProductsLimit),
  ])

  const orderStats = orders[0] || { count: 0, revenue: 0, avgOrderValue: 0 }

  return {
    orders: orderStats.count,
    revenue: Money.toDecimal(orderStats.revenue),
    averageOrderValue: Money.toDecimal(orderStats.avgOrderValue || 0),
    activeCarts: activeCarts.count,
    activeCartValue: activeCarts.value,
    abandonedCarts: abandonedCarts.count,
    conversionRate: calculateRate(orderStats.count, abandonedCarts.count + orderStats.count),
    topVisitedProducts,
    topProducts: topProducts.map(p => ({
      productId: p._id,
      name: p.name,
      quantity: p.quantity,
      revenue: Money.toDecimal(p.revenue),
    })),
  }
}

// ============================================================================
// 8. HELPERS Y UTILIDADES
// ============================================================================

/**
 * Calcula rango de fechas según timeframe
 */
const getDateRange = timeframe => {
  const now = new Date()
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  let start = new Date(now)
  const normalized = String(timeframe || '30d').trim().toLowerCase()
  const dynamicDaysMatch = normalized.match(/^(\d+)d$/)

  if (dynamicDaysMatch) {
    const days = Math.min(Math.max(Number(dynamicDaysMatch[1]), 1), 730)
    start.setDate(start.getDate() - days)
  } else {
    switch (normalized) {
    case 'mtd':
      start.setDate(1)
      break
    case 'ytd':
      start.setMonth(0, 1)
      break
    case '1y':
      start.setFullYear(start.getFullYear() - 1)
      break
    case '90d':
      start.setDate(start.getDate() - 90)
      break
    case '7d':
      start.setDate(start.getDate() - 7)
      break
    case '30d':
    default:
      start.setDate(start.getDate() - 30)
    }
  }

  start.setHours(0, 0, 0, 0)
  return { start, end }
}

/**
 * Agrega datos por fecha
 */
const aggregateByDate = (data, valueField = 'amount') => {
  const grouped = data.reduce((acc, item) => {
    if (!acc[item.date]) {
      acc[item.date] = { date: item.date, value: 0, count: 0 }
    }
    acc[item.date].value += item[valueField] || item.amount || 0
    acc[item.date].count += 1
    return acc
  }, {})

  return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Rellena días faltantes en un rango de fechas
 */
const fillMissingDays = (data, startDate, endDate) => {
  const filled = []
  const current = new Date(startDate)
  const end = new Date(endDate)
  const dataMap = new Map(data.map(d => [d.date, d]))

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0]
    const existing = dataMap.get(dateStr)

    filled.push({
      date: dateStr,
      revenue: existing?.revenue || existing?.value || 0,
      orders: existing?.orders || existing?.count || 0,
      items: existing?.items || 0,
      events: existing?.events || 0,
      sessions: existing?.sessions || 0,
      pageViews: existing?.pageViews || 0,
      productViews: existing?.productViews || 0,
      addToCart: existing?.addToCart || 0,
      checkoutStarts: existing?.checkoutStarts || 0,
    })

    current.setDate(current.getDate() + 1)
  }

  return filled
}

// ============================================================================
// 9. EXPORTACIONES ADICIONALES (para uso en otros controller)
// ============================================================================

/**
 * Obtiene métricas específicas para el dashboard de admin
 * Versión simplificada usada por adminController
 */
export const getAdminDashboardMetrics = async (tenantId, options = {}) => {
  const { days = metricsConfig.internalPeriodDays } = options

  const [basicStats, chartData] = await Promise.all([
    getDashboardStats(tenantId, `${days}d`),
    getSalesChartDataInternal(tenantId, days),
  ])

  return {
    ...basicStats,
    chart: chartData,
  }
}

/**
 * Estadísticas para exportar (CSV, PDF, etc.)
 */
export const getExportableStats = async (tenantId, startDate, endDate) => {
  const matchStage = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
    isDeleted: false,
    paymentStatus: { $in: PAID_PAYMENT_STATUSES },
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
    createdAt: {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    },
  }

  const orders = await Order.find(matchStage)
    .select('orderId createdAt paymentIntent products orderStatus customer')
    .sort({ createdAt: -1 })
    .lean()

  return orders.map(o => ({
    orderId: o.orderId,
    date: o.createdAt,
    customer: o.customer?.email || 'N/A',
    status: o.orderStatus,
    items: o.products?.length || 0,
    subtotal: Money.toDecimal(o.paymentIntent?.amountCents || 0),
    total: Money.toDecimal(o.paymentIntent?.amountCents || 0),
  }))
}


const getCartValueExpression = () => ({
  $cond: [
    { $gt: [{ $ifNull: ['$totalAfterDiscount', 0] }, 0] },
    { $ifNull: ['$totalAfterDiscount', 0] },
    { $ifNull: ['$cartTotal', 0] },
  ],
})

const buildCartProductPreviewExpression = productPreviewLimit => ({
  $slice: [
    {
      $map: {
        input: '$products',
        as: 'product',
        in: {
          productId: '$$product.productId',
          title: {
            $ifNull: [
              '$$product.title',
              { $ifNull: ['$$product.name', 'Producto'] },
            ],
          },
          quantity: { $ifNull: ['$$product.quantity', 1] },
          subtotal: {
            $ifNull: [
              '$$product.subtotal',
              {
                $multiply: [
                  { $ifNull: ['$$product.price', 0] },
                  { $ifNull: ['$$product.quantity', 1] },
                ],
              },
            ],
          },
        },
      },
    },
    productPreviewLimit,
  ],
})

const getActiveCartStats = async (tenantId, dateRange) => {
  const thresholdMinutes = Number(metricsConfig.abandonedCartMinutes || 60)
  const thresholdMs = thresholdMinutes * 60 * 1000
  const activeSince = new Date(Date.now() - thresholdMs)
  const latestLimit = Number(metricsConfig.latestAbandonedCartsLimit || 10)
  const productPreviewLimit = Number(metricsConfig.abandonedCartProductPreviewLimit || 3)
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)

  const carts = await Cart.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        updatedAt: {
          $gte: activeSince,
          $lte: dateRange.end,
        },
        products: { $exists: true, $ne: [] },
      },
    },
    {
      $project: {
        userId: 1,
        updatedAt: 1,
        itemCount: { $sum: '$products.quantity' },
        value: getCartValueExpression(),
        products: buildCartProductPreviewExpression(productPreviewLimit),
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        value: { $sum: '$value' },
        items: { $sum: '$itemCount' },
        latest: {
          $push: {
            cartId: '$_id',
            userId: '$userId',
            updatedAt: '$updatedAt',
            itemCount: '$itemCount',
            value: '$value',
            products: '$products',
          },
        },
      },
    },
  ])

  const result = carts[0] || { count: 0, value: 0, items: 0, latest: [] }

  return {
    count: result.count || 0,
    value: Number(result.value || 0),
    items: result.items || 0,
    definition: {
      source: 'Cart',
      countedWhen:
        'El carrito pertenece al tenant, tiene productos y fue actualizado dentro del umbral configurado.',
      dateField: 'updatedAt',
      activeSince,
      periodEnd: dateRange.end,
      thresholdMinutes,
      valueField: 'totalAfterDiscount si es mayor a 0; si no, cartTotal',
      productPreviewLimit,
      latestLimit,
    },
    latest: (result.latest || [])
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, latestLimit),
  }
}

const getTopVisitedProducts = async (tenantId, dateRange, limit = metricsConfig.topProductsLimit) => {
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 10)))

  const rows = await UserMetricEvent.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        occurredAt: { $gte: dateRange.start, $lte: dateRange.end },
        eventType: {
          $in: [
            USER_METRIC_EVENTS.PRODUCT_VIEW,
            USER_METRIC_EVENTS.PRODUCT_CLICK,
            USER_METRIC_EVENTS.ADD_TO_CART,
          ],
        },
      },
    },
    {
      $addFields: {
        productKey: {
          $cond: [
            { $ne: ['$productId', null] },
            { $toString: '$productId' },
            {
              $ifNull: [
                '$productRef',
                {
                  $ifNull: [
                    '$metadata.productId',
                    { $ifNull: ['$metadata.productPath', 'unknown'] },
                  ],
                },
              ],
            },
          ],
        },
        productObjectId: {
          $cond: [
            { $eq: [{ $type: '$productId' }, 'objectId'] },
            '$productId',
            null,
          ],
        },
      },
    },
    {
      $match: {
        productKey: { $nin: ['', null, 'unknown'] },
      },
    },
    {
      $group: {
        _id: '$productKey',
        productObjectId: { $first: '$productObjectId' },
        titleFromEvent: {
          $first: {
            $ifNull: [
              '$metadata.title',
              { $ifNull: ['$metadata.productTitle', 'Producto'] },
            ],
          },
        },
        views: {
          $sum: {
            $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PRODUCT_VIEW] }, 1, 0],
          },
        },
        clicks: {
          $sum: {
            $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PRODUCT_CLICK] }, 1, 0],
          },
        },
        addToCart: {
          $sum: {
            $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.ADD_TO_CART] }, 1, 0],
          },
        },
        sessions: { $addToSet: '$sessionId' },
        value: { $sum: '$value' },
      },
    },
    {
      $lookup: {
        from: Product.collection.name,
        localField: 'productObjectId',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $addFields: {
        product: { $arrayElemAt: ['$product', 0] },
      },
    },
    { $sort: { views: -1, addToCart: -1, clicks: -1 } },
    { $limit: safeLimit },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        title: {
          $ifNull: [
            '$product.title',
            { $ifNull: ['$titleFromEvent', 'Producto'] },
          ],
        },
        sku: '$product.sku',
        slug: '$product.slug',
        image: { $arrayElemAt: ['$product.images.url', 0] },
        views: 1,
        clicks: 1,
        addToCart: 1,
        sessions: { $size: '$sessions' },
        value: 1,
      },
    },
  ])

  return rows.map(row => ({
    ...row,
    conversionRate: calculateRate(row.addToCart, row.views),
    clickThroughRate: calculateRate(row.clicks, row.views),
  }))
}

const getCartDailyStats = async (tenantId, dateRange) => {
  const thresholdMinutes = Number(metricsConfig.abandonedCartMinutes || 60)
  const thresholdMs = thresholdMinutes * 60 * 1000
  const abandonedBefore = new Date(Date.now() - thresholdMs)
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)

  const rows = await Cart.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        updatedAt: { $gte: dateRange.start, $lte: dateRange.end },
        products: { $exists: true, $ne: [] },
      },
    },
    {
      $project: {
        date: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$updatedAt',
          },
        },
        itemCount: { $sum: '$products.quantity' },
        value: {
          $cond: [
            { $gt: ['$totalAfterDiscount', 0] },
            '$totalAfterDiscount',
            '$cartTotal',
          ],
        },
        isAbandoned: { $lte: ['$updatedAt', abandonedBefore] },
      },
    },
    {
      $group: {
        _id: '$date',
        carts: { $sum: 1 },
        activeCarts: {
          $sum: {
            $cond: ['$isAbandoned', 0, 1],
          },
        },
        abandonedCarts: {
          $sum: {
            $cond: ['$isAbandoned', 1, 0],
          },
        },
        cartItems: { $sum: '$itemCount' },
        cartValue: { $sum: '$value' },
        activeCartValue: {
          $sum: {
            $cond: ['$isAbandoned', 0, '$value'],
          },
        },
        abandonedCartValue: {
          $sum: {
            $cond: ['$isAbandoned', '$value', 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        carts: 1,
        activeCarts: 1,
        abandonedCarts: 1,
        cartItems: 1,
        cartValue: 1,
        activeCartValue: 1,
        abandonedCartValue: 1,
      },
    },
    { $sort: { date: 1 } },
  ])

  return fillMissingDays(rows, dateRange.start, dateRange.end)
}

const getAbandonedCartStats = async (tenantId, dateRange) => {
  const thresholdMinutes = metricsConfig.abandonedCartMinutes
  const thresholdMs = thresholdMinutes * 60 * 1000
  const abandonedBefore = new Date(Date.now() - thresholdMs)
  const latestLimit = metricsConfig.latestAbandonedCartsLimit
  const productPreviewLimit = metricsConfig.abandonedCartProductPreviewLimit

  const carts = await Cart.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        updatedAt: {
          $gte: dateRange.start,
          $lte: abandonedBefore,
        },
        products: { $exists: true, $ne: [] },
      },
    },
    {
      $project: {
        userId: 1,
        updatedAt: 1,
        itemCount: { $sum: '$products.quantity' },
        value: getCartValueExpression(),
        products: buildCartProductPreviewExpression(productPreviewLimit),
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        value: { $sum: '$value' },
        items: { $sum: '$itemCount' },
        latest: {
          $push: {
            cartId: '$_id',
            userId: '$userId',
            updatedAt: '$updatedAt',
            itemCount: '$itemCount',
            value: '$value',
            products: '$products',
          },
        },
      },
    },
  ])

  const result = carts[0] || { count: 0, value: 0, items: 0, latest: [] }

  return {
    count: result.count,
    value: Number(result.value || 0),
    items: result.items,
    definition: {
      source: 'Cart',
      countedWhen: 'El carrito pertenece al tenant, tiene productos y no fue actualizado dentro del umbral configurado.',
      dateField: 'updatedAt',
      periodStart: dateRange.start,
      periodEnd: dateRange.end,
      abandonedBefore,
      thresholdMinutes,
      valueField: 'totalAfterDiscount si es mayor a 0; si no, cartTotal',
      productPreviewLimit,
      latestLimit,
    },
    latest: (result.latest || [])
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, latestLimit),
  }
}

const getTopSellingProducts = async (tenantId, dateRange, limit = metricsConfig.topProductsLimit) => {
  const rows = await Order.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        isDeleted: false,
        paymentStatus: { $in: PAID_PAYMENT_STATUSES },
        orderStatus: { $in: ACTIVE_ORDER_STATUSES },
        createdAt: { $gte: dateRange.start, $lte: dateRange.end },
      },
    },
    { $unwind: '$products' },
    {
      $addFields: {
        normalizedProductId: {
          $ifNull: ['$products.product', '$products.productId'],
        },
        normalizedTitle: {
          $ifNull: [
            '$products.titleSnapshot',
            { $ifNull: ['$products.title', { $ifNull: ['$products.name', 'Producto'] }] },
          ],
        },
        normalizedSku: {
          $ifNull: [
            '$products.skuSnapshot',
            { $ifNull: ['$products.sku', { $ifNull: ['$products.variantSku', null] }] },
          ],
        },
        normalizedQuantity: {
          $ifNull: ['$products.count', { $ifNull: ['$products.quantity', 1] }],
        },
        normalizedRevenueCents: {
          $ifNull: [
            '$products.subtotalCents',
            {
              $round: [
                {
                  $multiply: [
                    {
                      $ifNull: [
                        '$products.subtotal',
                        {
                          $multiply: [
                            { $ifNull: ['$products.price', 0] },
                            { $ifNull: ['$products.quantity', 1] },
                          ],
                        },
                      ],
                    },
                    100,
                  ],
                },
                0,
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$normalizedProductId',
        title: { $first: '$normalizedTitle' },
        sku: { $first: '$normalizedSku' },
        quantity: { $sum: '$normalizedQuantity' },
        revenueCents: { $sum: '$normalizedRevenueCents' },
      },
    },
    { $sort: { revenueCents: -1 } },
    { $limit: Number(limit || 10) },
  ])

  return rows.map(row => ({
    productId: row._id,
    title: row.title || 'Producto',
    sku: row.sku || null,
    quantity: row.quantity || 0,
    revenue: Money.toDecimal(row.revenueCents || 0),
  }))
}

const getTopClickedProducts = async (
  tenantId,
  dateRange,
  limit = metricsConfig.topProductsLimit,
) => {
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)

  const rows = await UserMetricEvent.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        occurredAt: { $gte: dateRange.start, $lte: dateRange.end },
        eventType: USER_METRIC_EVENTS.PRODUCT_CLICK,
      },
    },
    {
      $addFields: {
        normalizedProductId: {
          $ifNull: [
            '$productId',
            {
              $ifNull: ['$productRef', '$metadata.productId'],
            },
          ],
        },
      },
    },
    {
      $match: {
        normalizedProductId: { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: '$normalizedProductId',
        clicks: { $sum: 1 },
        sessions: { $addToSet: '$sessionId' },
        users: { $addToSet: '$userId' },
        lastClickedAt: { $max: '$occurredAt' },
        value: { $sum: '$value' },
      },
    },
    {
      $sort: { clicks: -1 },
    },
    {
      $limit: Number(limit || 10),
    },
  ])

  const validProductObjectIds = rows
    .map(row => String(row._id || ''))
    .filter(id => mongoose.Types.ObjectId.isValid(id))
    .map(id => new mongoose.Types.ObjectId(id))

  const products = validProductObjectIds.length
    ? await Product.find({
      _id: { $in: validProductObjectIds },
      tenantId: tenantObjectId,
    })
      .select('title name slug sku images price categoria category marca brand')
      .lean()
    : []

  const productMap = new Map(
    products.map(product => [String(product._id), product]),
  )

  return rows.map(row => {
    const productId = String(row._id || '')
    const product = productMap.get(productId)

    const users = (row.users || []).filter(Boolean)

    return {
      productId,
      title: product?.title || product?.name || 'Producto',
      slug: product?.slug || null,
      sku: product?.sku || null,
      category: product?.categoria || product?.category || null,
      brand: product?.marca || product?.brand || null,
      image: product?.images?.[0]?.url || null,
      price: Money.toDecimal(product?.price || 0),
      clicks: row.clicks || 0,
      sessions: row.sessions?.length || 0,
      users: users.length,
      value: Number(row.value || 0),
      lastClickedAt: row.lastClickedAt || null,
    }
  })
}

const getRealtimeStats = async tenantId => {
  const windowMinutes = metricsConfig.realtimeWindowMinutes
  const since = new Date(Date.now() - windowMinutes * 60 * 1000)
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)

  const [summary] = await UserMetricEvent.aggregate([
    {
      $match: {
        tenantId: tenantObjectId,
        occurredAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        activeUsers: { $addToSet: '$sessionId' },
        authenticatedUsers: { $addToSet: '$userId' },
        pageViews: {
          $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PAGE_VIEW] }, 1, 0] },
        },
        productViews: {
          $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PRODUCT_VIEW] }, 1, 0] },
        },
        addToCart: {
          $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.ADD_TO_CART] }, 1, 0] },
        },
        checkoutStarts: {
          $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.CHECKOUT_START] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        activeUsers: { $size: '$activeUsers' },
        authenticatedUsers: {
          $size: {
            $filter: {
              input: '$authenticatedUsers',
              as: 'user',
              cond: { $ne: ['$$user', null] },
            },
          },
        },
        pageViews: 1,
        productViews: 1,
        addToCart: 1,
        checkoutStarts: 1,
      },
    },
  ])

  return {
    activeUsers: summary?.activeUsers || 0,
    authenticatedUsers: summary?.authenticatedUsers || 0,
    pageViews: summary?.pageViews || 0,
    productViews: summary?.productViews || 0,
    addToCart: summary?.addToCart || 0,
    checkoutStarts: summary?.checkoutStarts || 0,
    definition: {
      source: 'UserMetricEvent',
      windowMinutes,
      since,
      formula: 'Sesiones únicas con eventos ocurridos dentro de la ventana configurada.',
    },
  }
}

const getPaymentStats = async (tenantId, dateRange) => {
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)

  const [eventRows, orderRows] = await Promise.all([
    UserMetricEvent.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          occurredAt: { $gte: dateRange.start, $lte: dateRange.end },
          eventType: {
            $in: [
              USER_METRIC_EVENTS.PAYMENT_ATTEMPT,
              USER_METRIC_EVENTS.PAYMENT_APPROVED,
              USER_METRIC_EVENTS.PAYMENT_REJECTED,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          sessions: { $addToSet: '$sessionId' },
          value: { $sum: '$value' },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          tenantId: tenantObjectId,
          isDeleted: false,
          createdAt: { $gte: dateRange.start, $lte: dateRange.end },
        },
      },
      {
        $group: {
          _id: '$paymentStatus',
          orders: { $sum: 1 },
          revenueCents: { $sum: '$paymentIntent.amountCents' },
        },
      },
    ]),
  ])

  const eventMap = eventRows.reduce((acc, row) => {
    acc[row._id] = {
      count: row.count || 0,
      sessions: row.sessions?.length || 0,
      value: row.value || 0,
    }
    return acc
  }, {})

  const orderBreakdown = orderRows.reduce((acc, row) => {
    const key = row._id || 'unknown'
    acc[key] = {
      orders: row.orders || 0,
      revenue: Money.toDecimal(row.revenueCents || 0),
    }
    return acc
  }, {})

  const attempts = eventMap[USER_METRIC_EVENTS.PAYMENT_ATTEMPT]?.count || 0
  const approved = eventMap[USER_METRIC_EVENTS.PAYMENT_APPROVED]?.count || 0
  const rejected = eventMap[USER_METRIC_EVENTS.PAYMENT_REJECTED]?.count || 0

  return {
    attempts,
    approved,
    rejected,
    approvalRate: calculateRate(approved, attempts),
    attemptedValue: eventMap[USER_METRIC_EVENTS.PAYMENT_ATTEMPT]?.value || 0,
    approvedValue: eventMap[USER_METRIC_EVENTS.PAYMENT_APPROVED]?.value || 0,
    rejectedValue: eventMap[USER_METRIC_EVENTS.PAYMENT_REJECTED]?.value || 0,
    orderBreakdown,
  }
}

const getUserBehaviorStats = async (tenantId, dateRange) => {
  const tenantObjectId = new mongoose.Types.ObjectId(tenantId)
  const matchStage = {
    tenantId: tenantObjectId,
    occurredAt: { $gte: dateRange.start, $lte: dateRange.end },
  }

  const [
    counters,
    sessionRows,
    topPages,
    topSearches,
    sources,
    deviceBreakdown,
    funnelRows,
    dailyActivity,
  ] = await Promise.all([
    UserMetricEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
        },
      },
    ]),
    UserMetricEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$sessionId',
          userId: { $max: '$userId' },
          firstSeenAt: { $min: '$occurredAt' },
          lastSeenAt: { $max: '$occurredAt' },
          events: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: null,
          sessions: { $sum: 1 },
          authenticatedSessions: {
            $sum: { $cond: [{ $ne: ['$userId', null] }, 1, 0] },
          },
          anonymousSessions: {
            $sum: { $cond: [{ $eq: ['$userId', null] }, 1, 0] },
          },
          averageEventsPerSession: { $avg: '$events' },
        },
      },
    ]),
    UserMetricEvent.aggregate([
      {
        $match: {
          ...matchStage,
          eventType: 'page_view',
        },
      },
      {
        $group: {
          _id: '$path',
          views: { $sum: 1 },
          sessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          path: '$_id',
          views: 1,
          sessions: { $size: '$sessions' },
          _id: 0,
        },
      },
      { $sort: { views: -1 } },
      { $limit: metricsConfig.topPagesLimit },
    ]),
    UserMetricEvent.aggregate([
      {
        $match: {
          ...matchStage,
          eventType: 'search',
          searchQuery: { $nin: ['', null] },
        },
      },
      {
        $group: {
          _id: { $toLower: '$searchQuery' },
          count: { $sum: 1 },
          sessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          query: '$_id',
          count: 1,
          sessions: { $size: '$sessions' },
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
      { $limit: metricsConfig.topSearchesLimit },
    ]),
    UserMetricEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $ifNull: ['$attribution.utmSource', 'direct'],
          },
          sessions: { $addToSet: '$sessionId' },
          users: { $addToSet: '$userId' },
          conversions: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$eventType',
                    [
                      USER_METRIC_EVENTS.PURCHASE,
                      USER_METRIC_EVENTS.PAYMENT_APPROVED,
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $project: {
          channel: {
            $cond: [{ $eq: ['$_id', ''] }, 'direct', '$_id'],
          },
          sessions: { $size: '$sessions' },
          users: {
            $size: {
              $filter: {
                input: '$users',
                as: 'user',
                cond: { $ne: ['$$user', null] },
              },
            },
          },
          conversions: 1,
          _id: 0,
        },
      },
      { $sort: { sessions: -1 } },
      { $limit: metricsConfig.trafficSourcesLimit },
    ]),
    UserMetricEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$device.type',
          count: { $sum: 1 },
          sessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          type: { $ifNull: ['$_id', 'unknown'] },
          events: '$count',
          sessions: { $size: '$sessions' },
          _id: 0,
        },
      },
      { $sort: { sessions: -1 } },
    ]),
    UserMetricEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$eventType',
          sessions: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          eventType: '$_id',
          sessions: { $size: '$sessions' },
          _id: 0,
        },
      },
    ]),
    UserMetricEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
          events: { $sum: 1 },
          sessions: { $addToSet: '$sessionId' },
          pageViews: {
            $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PAGE_VIEW] }, 1, 0] },
          },
          productViews: {
            $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.PRODUCT_VIEW] }, 1, 0] },
          },
          addToCart: {
            $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.ADD_TO_CART] }, 1, 0] },
          },
          checkoutStarts: {
            $sum: { $cond: [{ $eq: ['$eventType', USER_METRIC_EVENTS.CHECKOUT_START] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          date: '$_id',
          events: 1,
          sessions: { $size: '$sessions' },
          pageViews: 1,
          productViews: 1,
          addToCart: 1,
          checkoutStarts: 1,
          _id: 0,
        },
      },
      { $sort: { date: 1 } },
    ]),
  ])

  const counterMap = counters.reduce((acc, item) => {
    acc[item._id] = item.count
    return acc
  }, {})

  const sessionEventMap = funnelRows.reduce((acc, item) => {
    acc[item.eventType] = item.sessions
    return acc
  }, {})

  const sessions = sessionRows[0] || {
    sessions: 0,
    authenticatedSessions: 0,
    anonymousSessions: 0,
    averageEventsPerSession: 0,
  }

  return {
    sessions: sessions.sessions || 0,
    authenticatedSessions: sessions.authenticatedSessions || 0,
    anonymousSessions: sessions.anonymousSessions || 0,
    averageEventsPerSession: Number((sessions.averageEventsPerSession || 0).toFixed(2)),
    pageViews: counterMap[USER_METRIC_EVENTS.PAGE_VIEW] || 0,
    productImpressions: counterMap[USER_METRIC_EVENTS.PRODUCT_IMPRESSION] || 0,
    productClicks: counterMap[USER_METRIC_EVENTS.PRODUCT_CLICK] || 0,
    productViews: counterMap[USER_METRIC_EVENTS.PRODUCT_VIEW] || 0,
    searches: counterMap[USER_METRIC_EVENTS.SEARCH] || 0,
    logins: counterMap[USER_METRIC_EVENTS.LOGIN] || 0,
    logouts: counterMap[USER_METRIC_EVENTS.LOGOUT] || 0,
    addToCart: counterMap[USER_METRIC_EVENTS.ADD_TO_CART] || 0,
    removeFromCart: counterMap[USER_METRIC_EVENTS.REMOVE_FROM_CART] || 0,
    wishlistAdds: counterMap[USER_METRIC_EVENTS.WISHLIST_ADD] || 0,
    checkoutStarts: counterMap[USER_METRIC_EVENTS.CHECKOUT_START] || 0,
    checkoutSteps: counterMap[USER_METRIC_EVENTS.CHECKOUT_STEP] || 0,
    paymentAttempts: counterMap[USER_METRIC_EVENTS.PAYMENT_ATTEMPT] || 0,
    paymentApproved: counterMap[USER_METRIC_EVENTS.PAYMENT_APPROVED] || 0,
    paymentRejected: counterMap[USER_METRIC_EVENTS.PAYMENT_REJECTED] || 0,
    purchases: counterMap[USER_METRIC_EVENTS.PURCHASE] || 0,
    productImpressionSessions: sessionEventMap[USER_METRIC_EVENTS.PRODUCT_IMPRESSION] || 0,
    productClickSessions: sessionEventMap[USER_METRIC_EVENTS.PRODUCT_CLICK] || 0,
    productViewSessions: sessionEventMap[USER_METRIC_EVENTS.PRODUCT_VIEW] || 0,
    addToCartSessions: sessionEventMap[USER_METRIC_EVENTS.ADD_TO_CART] || 0,
    checkoutStartSessions: sessionEventMap[USER_METRIC_EVENTS.CHECKOUT_START] || 0,
    paymentAttemptSessions: sessionEventMap[USER_METRIC_EVENTS.PAYMENT_ATTEMPT] || 0,
    topPages,
    topSearches,
    sources,
    deviceBreakdown,
    dailyActivity: fillMissingDays(dailyActivity, dateRange.start, dateRange.end),
  }
}

const calculateRate = (numerator, denominator) => {
  const base = Number(denominator || 0)
  if (base <= 0) return 0
  return Number(((Number(numerator || 0) / base) * 100).toFixed(2))
}

const mergeDailyMetrics = (
  revenueRows = [],
  orderRows = [],
  activityRows = [],
  cartRows = [],
) => {
  const orderMap = new Map(orderRows.map(row => [row.date, row]))
  const activityMap = new Map(activityRows.map(row => [row.date, row]))
  const cartMap = new Map(cartRows.map(row => [row.date, row]))

  return revenueRows.map(row => {
    const orders = orderMap.get(row.date)?.orders || 0
    const activity = activityMap.get(row.date) || {}
    const carts = cartMap.get(row.date) || {}

    return {
      date: row.date,
      revenue: row.revenue || 0,
      orders,
      sessions: activity.sessions || 0,
      pageViews: activity.pageViews || 0,
      productViews: activity.productViews || 0,
      addToCart: activity.addToCart || 0,
      checkoutStarts: activity.checkoutStarts || 0,
      conversions: orders,

      carts: carts.carts || 0,
      activeCarts: carts.activeCarts || 0,
      abandonedCarts: carts.abandonedCarts || 0,
      cartItems: carts.cartItems || 0,
      cartValue: carts.cartValue || 0,
      activeCartValue: carts.activeCartValue || 0,
      abandonedCartValue: carts.abandonedCartValue || 0,
    }
  })
}

const buildInternalFunnel = ({ userBehaviorStats, paidOrders, abandonedCarts }) => {
  const sessions = userBehaviorStats.sessions || 0

  return {
    sessions: {
      eventCount: sessions,
      rate: 100,
      source: 'UserMetricEvent.sessionId',
    },
    productImpression: {
      eventCount: userBehaviorStats.productImpressions || 0,
      sessions: userBehaviorStats.productImpressionSessions || 0,
      rate: calculateRate(userBehaviorStats.productImpressionSessions, sessions),
      source: USER_METRIC_EVENTS.PRODUCT_IMPRESSION,
    },
    productClick: {
      eventCount: userBehaviorStats.productClicks || 0,
      sessions: userBehaviorStats.productClickSessions || 0,
      rate: calculateRate(userBehaviorStats.productClickSessions, sessions),
      source: USER_METRIC_EVENTS.PRODUCT_CLICK,
    },
    viewItem: {
      eventCount: userBehaviorStats.productViews || 0,
      sessions: userBehaviorStats.productViewSessions || 0,
      rate: calculateRate(userBehaviorStats.productViewSessions, sessions),
      source: USER_METRIC_EVENTS.PRODUCT_VIEW,
    },
    addToCart: {
      eventCount: userBehaviorStats.addToCart || 0,
      sessions: userBehaviorStats.addToCartSessions || 0,
      rate: calculateRate(userBehaviorStats.addToCartSessions, sessions),
      source: USER_METRIC_EVENTS.ADD_TO_CART,
    },
    beginCheckout: {
      eventCount: userBehaviorStats.checkoutStarts || 0,
      sessions: userBehaviorStats.checkoutStartSessions || 0,
      rate: calculateRate(userBehaviorStats.checkoutStartSessions, sessions),
      source: USER_METRIC_EVENTS.CHECKOUT_START,
    },
    paymentAttempt: {
      eventCount: userBehaviorStats.paymentAttempts || 0,
      sessions: userBehaviorStats.paymentAttemptSessions || 0,
      rate: calculateRate(userBehaviorStats.paymentAttemptSessions, sessions),
      source: USER_METRIC_EVENTS.PAYMENT_ATTEMPT,
    },
    purchase: {
      eventCount: paidOrders || 0,
      rate: calculateRate(paidOrders, sessions),
      source: 'Order paymentStatus approved',
    },
    abandonedCart: {
      eventCount: abandonedCarts || 0,
      source: 'Cart',
    },
  }
}
