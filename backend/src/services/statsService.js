// 📁 src/services/statsService.js

import Order from '../models/orderModel.js'
import Product from '../models/productModel.js'
import User from '../models/userModel.js'
import { Money } from '../utils/money.js'
import mongoose from 'mongoose'
import { GA4ReportingService } from './analytics/ga4Reporting.service.js'

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
  ] = await Promise.all([
    getSalesStats(tenantId, dateRange),
    getOrderStats(tenantId, dateRange),
    getUserStats(tenantId, dateRange),
    getProductStats(tenantId),
    getLowStockProducts(tenantId),
  ])

  return {
    summary: {
      revenue: salesStats.totalRevenue,
      revenueGrowth: salesStats.growth,
      orders: orderStats.totalOrders,
      ordersGrowth: orderStats.growth,
      averageOrderValue: orderStats.averageOrderValue,
      customers: userStats.totalCustomers,
      newCustomers: userStats.newCustomers,
      products: productStats.totalProducts,
      activeProducts: productStats.activeProducts,
    },
    lowStock: lowStockProducts,
    trends: {
      dailyRevenue: salesStats.dailyBreakdown,
      dailyOrders: orderStats.dailyBreakdown,
    },
  }
}

// ============================================================================
// 2. ANÁLISIS DE VENTAS
// ============================================================================

const getSalesStats = async (tenantId, dateRange) => {
  const matchStage = {
    tenantId: new mongoose.Types.ObjectId(tenantId),
    orderStatus: { $in: ['processing', 'delivered', 'dispatched'] },
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
  )

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

  const [stats, previousStats] = await Promise.all([
    Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: '$paymentIntent.amountCents' },
          daily: {
            $push: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: 1,
            },
          },
          statusBreakdown: {
            $push: '$orderStatus',
          },
        },
      },
    ]),

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
      { $group: { _id: null, totalOrders: { $sum: 1 } } },
    ]),
  ])

  const current = stats[0] || { totalOrders: 0, totalAmount: 0, daily: [], statusBreakdown: [] }
  const previous = previousStats[0] || { totalOrders: 0 }

  const growth = previous.totalOrders > 0
    ? ((current.totalOrders - previous.totalOrders) / previous.totalOrders * 100).toFixed(2)
    : 0

  // Calcular AOV (Average Order Value)
  const aov = current.totalOrders > 0
    ? Money.toDecimal(current.totalAmount) / current.totalOrders
    : 0

  // Breakdown por status
  const statusCounts = current.statusBreakdown.reduce((acc, status) => {
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})

  return {
    totalOrders: current.totalOrders,
    averageOrderValue: parseFloat(aov.toFixed(2)),
    growth: parseFloat(growth),
    statusBreakdown: statusCounts,
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

const getProductStats = async tenantId => {
  const stats = await Product.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        isDeleted: false,
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
          $sum: { $cond: [{ $lte: ['$quantity', 0] }, 1, 0] },
        },
        lowStock: {
          $sum: {
            $cond: [
              { $and: [{ $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$minStockAlert'] }] },
              1,
              0,
            ],
          },
        },
        totalInventoryValue: {
          $sum: { $multiply: ['$price', '$quantity'] },
        },
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

const getLowStockProducts = async (tenantId, limit = 10) => {
  const products = await Product.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    isDeleted: false,
    $expr: { $lte: ['$quantity', '$minStockAlert'] },
    quantity: { $gt: 0 }, // Excluir sin stock (son out of stock, no low stock)
  })
    .select('name sku quantity minStockAlert price images')
    .sort({ quantity: 1 })
    .limit(limit)
    .lean()

  return products.map(p => ({
    id: p._id,
    name: p.name,
    sku: p.sku,
    currentStock: p.quantity,
    minStock: p.minStockAlert,
    stockStatus: p.quantity === 0 ? 'out_of_stock' : 'low_stock',
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
export const getSalesChartDataInternal = async (tenantId, days = 7) => {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - parseInt(days))
  startDate.setHours(0, 0, 0, 0)

  const chartData = await Order.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        isDeleted: false,
        orderStatus: { $in: ['processing', 'delivered', 'dispatched'] },
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
    console.error('[GA4 Unified Stats Error]', error)
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
    const service = new GA4ReportingService(ga4.serviceAccountKey)
    
    // Período: últimos 30 días
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0]

    // Obtener datos en paralelo
    const [metrics, funnel, products, sources, realtime] = await Promise.all([
      service.getDashboardMetrics(startDate, endDate).catch(() => null),
      service.getEcommerceFunnel(startDate, endDate).catch(() => null),
      service.getProductPerformance(startDate, endDate, 5).catch(() => null),
      service.getTrafficSources(startDate, endDate).catch(() => null),
      service.getRealtimeMetrics().catch(() => ({ activeUsers: 0, pageViews: 0 })),
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
        realtime: realtime || { activeUsers: 0, pageViews: 0 },
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
    console.error('[GA4 Reporting Stats Error]', error)
    throw error
  }
}

/**
 * Estadísticas de marketing internas (sin GA4)
 */
const getInternalMarketingStats = async tenantId => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [orders, abandonedCarts, topProducts] = await Promise.all([
    // Órdenes completadas
    Order.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          orderStatus: { $in: ['processing', 'delivered', 'dispatched'] },
          createdAt: { $gte: thirtyDaysAgo },
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

    // Carritos abandonados (simulado - necesitarías modelo de Cart)
    Promise.resolve({ count: 0 }), // Placeholder

    // Top productos vendidos
    Order.aggregate([
      {
        $match: {
          tenantId: new mongoose.Types.ObjectId(tenantId),
          orderStatus: { $in: ['processing', 'delivered', 'dispatched'] },
          createdAt: { $gte: thirtyDaysAgo },
        },
      },
      { $unwind: '$products' },
      {
        $group: {
          _id: '$products.product',
          name: { $first: '$products.name' },
          quantity: { $sum: '$products.quantity' },
          revenue: { $sum: { $multiply: ['$products.price', '$products.quantity'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),
  ])

  const orderStats = orders[0] || { count: 0, revenue: 0, avgOrderValue: 0 }

  return {
    orders: orderStats.count,
    revenue: Money.toDecimal(orderStats.revenue),
    averageOrderValue: Money.toDecimal(orderStats.avgOrderValue || 0),
    abandonedCarts: abandonedCarts.count,
    conversionRate: 0, // Necesitarías sessions de GA4 para calcular esto
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

  switch (timeframe) {
  case '7d':
    start.setDate(start.getDate() - 7)
    break
  case '30d':
    start.setDate(start.getDate() - 30)
    break
  case '90d':
    start.setDate(start.getDate() - 90)
    break
  case '1y':
    start.setFullYear(start.getFullYear() - 1)
    break
  case 'mtd':
    start.setDate(1)
    break
  case 'ytd':
    start.setMonth(0, 1)
    break
  default:
    start.setDate(start.getDate() - 30)
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
  const { days = 30 } = options

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
    orderStatus: { $in: ['processing', 'delivered', 'dispatched'] },
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