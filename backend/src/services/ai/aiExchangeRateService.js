import AiFxRateSnapshot from '../../models/aiFxRateSnapshotModel.js'
import logger from '../../../config/logger.js'

const BCRA_API_BASE = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0'
const BCRA_DOCS_URL = 'https://www.bcra.gob.ar/apis-banco-central/'
const DEFAULT_SOURCE_CODE = 'REF'
const LOOKBACK_DAYS = 45
const REQUEST_TIMEOUT_MS = 8000
const CURRENT_QUOTE_CACHE_TTL_MS = 5 * 60 * 1000

const currentQuoteCache = new Map()

const toDate = value => {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('La fecha de cotización debe ser válida')
  }
  return date
}

const dateKey = value => toDate(value).toISOString().slice(0, 10)

const shiftDate = (date, days) => {
  const copy = toDate(date)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

const parseBcraResults = (payload, sourceCode) => {
  if (payload?.status !== 0 || !Array.isArray(payload.results)) {
    throw new Error('La API de estadísticas cambiarias del BCRA devolvió una respuesta inválida')
  }

  return payload.results
    .map(row => {
      const effectiveDate = String(row?.fecha || '')
      const detail = Array.isArray(row?.detalle)
        ? row.detalle.find(item => String(item?.codigoMoneda || '').toUpperCase() === sourceCode)
        : null
      const rate = Number(detail?.tipoCotizacion)

      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(rate) || rate <= 0) {
        return null
      }

      return {
        effectiveDate,
        rate,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
}

const saveSnapshots = async ({ rows, sourceCode, sourceUrl, capturedAt }) => {
  if (!rows.length) return

  await AiFxRateSnapshot.bulkWrite(
    rows.map(row => ({
      updateOne: {
        filter: { _id: `BCRA:${sourceCode}:${row.effectiveDate}` },
        // Primer valor observado por fecha efectiva: un snapshot histórico
        // no se reescribe si el BCRA revisa posteriormente una serie publicada.
        // Una corrección explícita requeriría un proceso de auditoría separado.
        update: {
          $setOnInsert: {
            dateKey: row.effectiveDate,
            source: 'bcra_api',
            sourceCode,
            baseCurrency: 'USD',
            quoteCurrency: 'ARS',
            rateType:
              sourceCode === 'REF'
                ? 'comunicacion_a_3500_reference'
                : 'bcra_currency_quote',
            rate: row.rate,
            sourceUrl,
            capturedAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )
}

const toQuote = snapshot => ({
  rate: Number(snapshot.rate),
  baseCurrency: snapshot.baseCurrency || 'USD',
  quoteCurrency: snapshot.quoteCurrency || 'ARS',
  source: snapshot.source || 'bcra_api',
  sourceCode: snapshot.sourceCode || DEFAULT_SOURCE_CODE,
  sourceUrl: snapshot.sourceUrl || BCRA_DOCS_URL,
  rateType: snapshot.rateType || 'bcra_currency_quote',
  effectiveDate: snapshot.dateKey,
  capturedAt: snapshot.capturedAt || snapshot.createdAt || null,
  changedBy: null,
  reason:
    snapshot.sourceCode === 'REF'
      ? 'Tipo de cambio de referencia BCRA, Comunicación A 3500 (mayorista).'
      : 'Cotización publicada por el BCRA.',
  historical: true,
  verified: true,
})

/**
 * Obtiene USD→ARS desde el BCRA y conserva snapshots por fecha efectiva.
 *
 * REF es el código publicado por el BCRA para el tipo de cambio de referencia
 * de la Comunicación A 3500. No se mezcla con dólar minorista, MEP ni tarjeta.
 * La fecha efectiva del último día hábil disponible se conserva por separado
 * de la fecha en que HENKO consultó la API.
 */
export const getBcraUsdArsQuote = async ({ asOf = new Date() } = {}) => {
  const targetDate = toDate(asOf)
  const targetKey = dateKey(targetDate)
  // El sistema reporta USD/ARS: el código REF representa exclusivamente el
  // dólar de referencia de la Comunicación A 3500. Aceptar otro código aquí
  // haría que una cotización EUR/ARS se etiquetara falsamente como USD/ARS.
  const code = DEFAULT_SOURCE_CODE

  const lowerBound = dateKey(shiftDate(targetDate, -LOOKBACK_DAYS))
  const todayKey = dateKey(new Date())
  const isHistoricalDate = targetKey < todayKey

  // Los períodos cerrados quedan congelados: una vez guardado el último dato
  // BCRA dentro de la ventana del período, no se vuelve a consultar la serie.
  if (isHistoricalDate) {
    const saved = await AiFxRateSnapshot.findOne({
      source: 'bcra_api',
      sourceCode: code,
      dateKey: { $gte: lowerBound, $lte: targetKey },
    })
      .sort({ dateKey: -1 })
      .lean()

    if (saved) return toQuote(saved)
  }

  const cacheKey = `${code}:${targetKey}`
  const cached = currentQuoteCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < CURRENT_QUOTE_CACHE_TTL_MS) {
    return cached.quote
  }

  const from = dateKey(shiftDate(targetDate, -LOOKBACK_DAYS))
  const url = new URL(`${BCRA_API_BASE}/Cotizaciones/${encodeURIComponent(code)}`)
  url.searchParams.set('fechaDesde', from)
  url.searchParams.set('fechaHasta', targetKey)
  url.searchParams.set('limit', '100')
  url.searchParams.set('offset', '0')

  const capturedAt = new Date()
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`BCRA respondió HTTP ${response.status} al consultar cotización ${code}`)
  }

  const payload = await response.json()
  const rows = parseBcraResults(payload, code).filter(row => row.effectiveDate <= targetKey)

  if (!rows.length) {
    throw new Error(`BCRA no publicó una cotización ${code} hasta ${targetKey}`)
  }

  await saveSnapshots({
    rows,
    sourceCode: code,
    sourceUrl: url.toString(),
    capturedAt,
  })

  const latest = rows[rows.length - 1]
  const quote = toQuote({
    dateKey: latest.effectiveDate,
    source: 'bcra_api',
    sourceCode: code,
    baseCurrency: 'USD',
    quoteCurrency: 'ARS',
    rateType:
      code === 'REF' ? 'comunicacion_a_3500_reference' : 'bcra_currency_quote',
    rate: latest.rate,
    sourceUrl: url.toString(),
    capturedAt,
  })

  currentQuoteCache.set(cacheKey, { quote, cachedAt: Date.now() })

  logger.info('[AI FX] Cotización USD/ARS obtenida del BCRA', {
    sourceCode: code,
    rate: quote.rate,
    effectiveDate: quote.effectiveDate,
    capturedAt: quote.capturedAt,
  })

  return quote
}

export default { getBcraUsdArsQuote }
