import { BetaAnalyticsDataClient } from '@google-analytics/data'
import dotenv from 'dotenv'

dotenv.config()

const propertyId = process.env.GA_PROPERTY_ID

const credentials = {
  client_email: process.env.GA_CLIENT_EMAIL,
  private_key: process.env.GA_PRIVATE_KEY.replace(/\\n/g, '\n'),
}

const analyticsDataClient = new BetaAnalyticsDataClient({
  credentials,
  projectId: process.env.GA_PROJECT_ID,
})

// backend/services/analyticsService.js

export const getTopVisitedProducts = async () => {
  try {
    const [response] = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      // Incluimos pagePath para que el filtro funcione correctamente
      dimensions: [
        { name: 'pageTitle' },
        { name: 'pagePath' },
      ],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'sessionsWithPurchase' }, // Más fiable para conversiones en GA4
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: { matchType: 'CONTAINS', value: '/product' },
        },
      },
      limit: 10,
    })

    return response.rows.map(row => ({
      name: row.dimensionValues[0].value, // pageTitle
      path: row.dimensionValues[1].value, // pagePath (útil para debug)
      views: parseInt(row.metricValues[0].value, 10),
      conversions: parseInt(row.metricValues[1].value, 10),
    }))
  } catch (error) {
    // Si ves un error de "Metric not found", cambia sessionsWithPurchase por "transactions"
    console.error('Error GA4:', error.message)
    return []
  }
}