import { BetaAnalyticsDataClient } from '@google-analytics/data'
import dotenv from 'dotenv'
import logger from '../../config/logger.js'

dotenv.config()

const propertyId = process.env.GA_PROPERTY_ID
const isAnalyticsConfigured = Boolean(
  process.env.GA_PROPERTY_ID &&
    process.env.GA_CLIENT_EMAIL &&
    process.env.GA_PRIVATE_KEY &&
    process.env.GA_PROJECT_ID,
)

const credentials = {
  client_email: process.env.GA_CLIENT_EMAIL,
  private_key: process.env.GA_PRIVATE_KEY?.replace(/\\n/g, '\n'),
}

const analyticsDataClient = isAnalyticsConfigured
  ? new BetaAnalyticsDataClient({
    credentials,
    projectId: process.env.GA_PROJECT_ID,
  })
  : null

// backend/services/analyticsService.js

export const getTopVisitedProducts = async () => {
  try {
    if (!analyticsDataClient || !propertyId) return []

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
    logger.warn('Error consultando GA4', { error: error.message })
    return []
  }
}
