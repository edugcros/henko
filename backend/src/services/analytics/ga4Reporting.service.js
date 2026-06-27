import { BetaAnalyticsDataClient } from '@google-analytics/data'

const DEFAULT_TIMEOUT_MS = 12000

const clean = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  return text || fallback
}

const toNumber = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeDate = value => {
  const text = clean(value)
  if (!text) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text
  }

  const date = new Date(text)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString().slice(0, 10)
}

const normalizeLimit = (value, fallback = 10, max = 100) => {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 1) return fallback

  return Math.min(max, parsed)
}

const parseCredentials = value => {
  if (!value) {
    throw new Error('Credenciales GA4 no configuradas')
  }

  let credentials

  try {
    credentials =
      typeof value === 'string'
        ? JSON.parse(value)
        : { ...value }
  } catch {
    throw new Error('Credenciales GA4 inválidas: JSON mal formado')
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service Account GA4 incompleta')
  }

  credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n')

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
      result[name] = toNumber(row.metricValues?.[index]?.value)
    })

    return result
  })
}

const sumRows = (rows, keys = []) => {
  return rows.reduce((acc, row) => {
    keys.forEach(key => {
      acc[key] = toNumber(acc[key]) + toNumber(row[key])
    })

    return acc
  }, {})
}

const averageRows = (rows, key) => {
  if (!rows.length) return 0

  return rows.reduce((sum, row) => sum + toNumber(row[key]), 0) / rows.length
}

const emptyDashboardTotals = () => ({
  sessions: 0,
  totalUsers: 0,
  newUsers: 0,
  screenPageViews: 0,
  averageSessionDuration: 0,
  bounceRate: 0,
  keyEvents: 0,
  purchaseRevenue: 0,
  conversions: 0,
  eventValue: 0,
})

export class GA4ReportingService {
  constructor(serviceAccountKey, propertyId) {
    const normalizedPropertyId = clean(propertyId)

    if (!/^\d+$/.test(normalizedPropertyId)) {
      throw new Error('GA4 propertyId inválido')
    }

    const credentials = parseCredentials(serviceAccountKey)

    this.propertyId = normalizedPropertyId
    this.property = `properties/${normalizedPropertyId}`
    this.client = new BetaAnalyticsDataClient({
      credentials,
      projectId: credentials.project_id,
    })
  }

  async runReport({
    startDate,
    endDate,
    dimensions = [],
    metrics = [],
    limit,
    ...options
  }) {
    const normalizedStartDate = normalizeDate(startDate)
    const normalizedEndDate = normalizeDate(endDate)

    if (!normalizedStartDate || !normalizedEndDate) {
      throw new Error('Rango de fechas GA4 inválido')
    }

    if (!Array.isArray(metrics) || metrics.length === 0) {
      throw new Error('GA4 requiere al menos una métrica')
    }

    const [response] = await this.client.runReport(
      {
        property: this.property,
        dateRanges: [
          {
            startDate: normalizedStartDate,
            endDate: normalizedEndDate,
          },
        ],
        dimensions: Array.isArray(dimensions)
          ? dimensions.filter(Boolean).map(name => ({ name }))
          : [],
        metrics: metrics.filter(Boolean).map(name => ({ name })),
        ...(limit ? { limit: normalizeLimit(limit, 10, 250) } : {}),
        ...options,
      },
      {
        timeout: DEFAULT_TIMEOUT_MS,
      },
    )

    return {
      rows: mapReportRows(response),
      rowCount: Number(response.rowCount || 0),
      metadata: response.metadata || null,
      propertyQuota: response.propertyQuota || null,
    }
  }

  async runSafeReport(config, fallback = null) {
    try {
      return await this.runReport(config)
    } catch (error) {
      return fallback
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
      orderBys: [
        {
          dimension: {
            dimensionName: 'date',
          },
        },
      ],
    })

    const rows = report.rows || []

    const totals = {
      ...emptyDashboardTotals(),
      ...sumRows(rows, [
        'sessions',
        'totalUsers',
        'newUsers',
        'screenPageViews',
        'keyEvents',
        'purchaseRevenue',
      ]),
      averageSessionDuration: averageRows(rows, 'averageSessionDuration'),
      bounceRate: averageRows(rows, 'bounceRate'),
    }

    totals.conversions = totals.keyEvents
    totals.eventValue = totals.purchaseRevenue

    return {
      totals,
      data: rows,
      rowCount: report.rowCount,
    }
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
          inListFilter: {
            values: eventNames,
          },
        },
      },
    })

    return eventNames.map(eventName => {
      const row = report.rows.find(item => item.eventName === eventName)

      return {
        eventName,
        eventCount: toNumber(row?.eventCount),
        users: toNumber(row?.totalUsers),
      }
    })
  }

  async getProductPerformance(startDate, endDate, limit = 10) {
    const safeLimit = normalizeLimit(limit, 10, 100)

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
      orderBys: [
        {
          metric: {
            metricName: 'itemRevenue',
          },
          desc: true,
        },
      ],
      limit: safeLimit,
    })

    const rows = report.rows || []

    return {
      topSelling: rows,
      topViewed: [...rows].sort(
        (a, b) => toNumber(b.itemsViewed) - toNumber(a.itemsViewed),
      ),
    }
  }

  async getTrafficSources(startDate, endDate) {
    const report = await this.runReport({
      startDate,
      endDate,
      dimensions: ['sessionDefaultChannelGroup'],
      metrics: ['sessions', 'totalUsers', 'keyEvents', 'purchaseRevenue'],
      orderBys: [
        {
          metric: {
            metricName: 'sessions',
          },
          desc: true,
        },
      ],
      limit: 50,
    })

    return {
      data: (report.rows || []).map(row => ({
        ...row,
        conversions: toNumber(row.keyEvents),
        eventValue: toNumber(row.purchaseRevenue),
      })),
    }
  }

  async getRealtimeMetrics() {
    /**
     * Realtime tiene compatibilidad más limitada que Core Reporting.
     * Por eso se intenta primero un set completo, y si GA4 rechaza alguna métrica,
     * se cae a un set mínimo.
     */
    const metricSets = [
      ['activeUsers', 'screenPageViews', 'eventCount', 'keyEvents'],
      ['activeUsers', 'eventCount', 'keyEvents'],
      ['activeUsers', 'eventCount'],
    ]

    for (const metrics of metricSets) {
      try {
        const [response] = await this.client.runRealtimeReport(
          {
            property: this.property,
            metrics: metrics.map(name => ({ name })),
          },
          {
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )

        const row = mapReportRows(response)[0] || {}

        return {
          activeUsers: toNumber(row.activeUsers),
          screenPageViews: toNumber(row.screenPageViews),
          eventCount: toNumber(row.eventCount),
          keyEvents: toNumber(row.keyEvents),
        }
      } catch {
        // Se prueba el siguiente set compatible.
      }
    }

    return {
      activeUsers: 0,
      screenPageViews: 0,
      eventCount: 0,
      keyEvents: 0,
    }
  }
}

export default GA4ReportingService