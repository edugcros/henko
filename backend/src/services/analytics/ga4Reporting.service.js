import { BetaAnalyticsDataClient } from '@google-analytics/data'

const parseCredentials = value => {
  if (!value) {
    throw new Error('Credenciales GA4 no configuradas')
  }

  const credentials =
    typeof value === 'string' ? JSON.parse(value) : { ...value }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service Account GA4 incompleta')
  }

  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
  return credentials
}

const mapReportRows = response => {
  const dimensionNames = (response.dimensionHeaders || []).map(item => item.name)
  const metricNames = (response.metricHeaders || []).map(item => item.name)

  return (response.rows || []).map(row => {
    const result = {}

    dimensionNames.forEach((name, index) => {
      result[name] = row.dimensionValues?.[index]?.value || ''
    })

    metricNames.forEach((name, index) => {
      result[name] = Number(row.metricValues?.[index]?.value || 0)
    })

    return result
  })
}

export class GA4ReportingService {
  constructor(serviceAccountKey, propertyId) {
    const normalizedPropertyId = String(propertyId || '').trim()

    if (!/^\d+$/.test(normalizedPropertyId)) {
      throw new Error('GA4 propertyId inválido')
    }

    const credentials = parseCredentials(serviceAccountKey)
    this.property = `properties/${normalizedPropertyId}`
    this.client = new BetaAnalyticsDataClient({
      credentials,
      projectId: credentials.project_id,
    })
  }

  async runReport({ startDate, endDate, dimensions = [], metrics, ...options }) {
    const [response] = await this.client.runReport({
      property: this.property,
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map(name => ({ name })),
      metrics: metrics.map(name => ({ name })),
      ...options,
    })

    return {
      rows: mapReportRows(response),
      rowCount: Number(response.rowCount || 0),
    }
  }

  async getDashboardMetrics(startDate, endDate) {
    const report = await this.runReport({
      startDate,
      endDate,
      dimensions: ['date'],
      metrics: [
        'sessions',
        'totalUsers',
        'newUsers',
        'screenPageViews',
        'averageSessionDuration',
        'bounceRate',
        'keyEvents',
        'purchaseRevenue',
      ],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    })

    const totals = report.rows.reduce((acc, row) => {
      for (const key of [
        'sessions',
        'totalUsers',
        'newUsers',
        'screenPageViews',
        'keyEvents',
        'purchaseRevenue',
      ]) {
        acc[key] += Number(row[key] || 0)
      }

      acc.averageSessionDuration += Number(row.averageSessionDuration || 0)
      acc.bounceRate += Number(row.bounceRate || 0)
      return acc
    }, {
      sessions: 0,
      totalUsers: 0,
      newUsers: 0,
      screenPageViews: 0,
      averageSessionDuration: 0,
      bounceRate: 0,
      keyEvents: 0,
      purchaseRevenue: 0,
    })

    if (report.rows.length) {
      totals.averageSessionDuration /= report.rows.length
      totals.bounceRate /= report.rows.length
    }

    totals.conversions = totals.keyEvents
    totals.eventValue = totals.purchaseRevenue

    return { totals, data: report.rows }
  }

  async getEcommerceFunnel(startDate, endDate) {
    const eventNames = [
      'view_item',
      'add_to_cart',
      'begin_checkout',
      'add_payment_info',
      'purchase',
    ]
    const report = await this.runReport({
      startDate,
      endDate,
      dimensions: ['eventName'],
      metrics: ['eventCount', 'totalUsers'],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: { values: eventNames },
        },
      },
    })

    return eventNames.map(eventName => {
      const row = report.rows.find(item => item.eventName === eventName)
      return {
        eventName,
        eventCount: Number(row?.eventCount || 0),
        users: Number(row?.totalUsers || 0),
      }
    })
  }

  async getProductPerformance(startDate, endDate, limit = 10) {
    const report = await this.runReport({
      startDate,
      endDate,
      dimensions: ['itemId', 'itemName'],
      metrics: [
        'itemsViewed',
        'itemsAddedToCart',
        'ecommercePurchases',
        'itemRevenue',
      ],
      orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
      limit: Math.min(100, Math.max(1, Number(limit) || 10)),
    })

    return {
      topSelling: report.rows,
      topViewed: [...report.rows].sort(
        (a, b) => Number(b.itemsViewed || 0) - Number(a.itemsViewed || 0),
      ),
    }
  }

  async getTrafficSources(startDate, endDate) {
    const report = await this.runReport({
      startDate,
      endDate,
      dimensions: ['sessionDefaultChannelGroup'],
      metrics: ['sessions', 'totalUsers', 'keyEvents', 'purchaseRevenue'],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 50,
    })

    return {
      data: report.rows.map(row => ({
        ...row,
        conversions: row.keyEvents,
        eventValue: row.purchaseRevenue,
      })),
    }
  }

  async getRealtimeMetrics() {
    const [response] = await this.client.runRealtimeReport({
      property: this.property,
      metrics: [
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'eventCount' },
        { name: 'keyEvents' },
      ],
    })

    return mapReportRows(response)[0] || {
      activeUsers: 0,
      screenPageViews: 0,
      eventCount: 0,
      keyEvents: 0,
    }
  }
}

export default GA4ReportingService
