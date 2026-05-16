import Order from '../models/orderModel.js'
import { getTopVisitedProducts } from '../services/analyticsService.js'

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export const getDashboardData = async (req, res) => {
  try {
    const tenantId = req.user?.tenantId // <- multi-tenant seguro
    if (!tenantId) {
      return res.status(400).json({ message: 'Tenant no identificado' })
    }

    /* =====================================================
       1️⃣ Google Analytics (visitas + conversiones)
    ===================================================== */
    const topVisited = await getTopVisitedProducts()

    /* =====================================================
       2️⃣ Top productos vendidos (solo órdenes pagadas)
    ===================================================== */
    const topSold = await Order.aggregate([
      {
        $match: {
          tenant: tenantId,
          isPaid: true,
        },
      },
      { $unwind: '$products' },
      {
        $group: {
          _id: '$products.product',
          count: { $sum: '$products.count' },
          revenue: {
            $sum: {
              $multiply: ['$products.count', '$products.price'],
            },
          },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'details',
        },
      },
      { $unwind: '$details' },
      {
        $project: {
          _id: 0,
          title: '$details.title',
          sold: '$count',
          revenue: { $round: ['$revenue', 2] },
        },
      },
    ])

    /* =====================================================
       3️⃣ Revenue mensual (por año actual)
    ===================================================== */
    const currentYear = new Date().getFullYear()

    const monthlyRevenue = await Order.aggregate([
      {
        $match: {
          tenant: tenantId,
          isPaid: true,
          createdAt: {
            $gte: new Date(`${currentYear}-01-01`),
            $lte: new Date(`${currentYear}-12-31`),
          },
        },
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          revenue: { $sum: '$totalPrice' },
        },
      },
      { $sort: { '_id': 1 } },
    ])

    const formattedMonthly = Array.from({ length: 12 }, (_, i) => {
      const monthData = monthlyRevenue.find(m => m._id === i + 1)
      return {
        month: MONTHS[i],
        revenue: monthData ? Number(monthData.revenue.toFixed(2)) : 0,
      }
    })

    /* =====================================================
       Response final
    ===================================================== */
    return res.json({
      mostVisited: topVisited,
      mostSold: topSold,
      monthlyRevenue: formattedMonthly,
    })

  } catch (error) {
    console.error('Dashboard error:', error)
    return res.status(500).json({
      message: 'Error obteniendo datos del dashboard',
    })
  }
}

export default getDashboardData
