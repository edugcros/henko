import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { crearMongoEnMemoria } from './testDB.js'

const { default: AiFxRateSnapshot } = await import('../models/aiFxRateSnapshotModel.js')
const { getBcraUsdArsQuote } = await import('../services/ai/aiExchangeRateService.js')

let mongod
const originalFetch = globalThis.fetch

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
  await AiFxRateSnapshot.init()
}, 180000)

afterAll(async () => {
  globalThis.fetch = originalFetch
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await AiFxRateSnapshot.deleteMany({})
  globalThis.fetch = jest.fn()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('getBcraUsdArsQuote', () => {
  test('consulta REF, valida la respuesta y guarda snapshots por fecha efectiva', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 0,
        results: [
          {
            fecha: '2026-10-29',
            detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 1514.2, tipoPase: 0 }],
          },
          {
            fecha: '2026-10-30',
            detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 1515.8766, tipoPase: 0 }],
          },
        ],
      }),
    })

    const quote = await getBcraUsdArsQuote({
      asOf: new Date('2026-10-31T23:59:59.999Z'),
    })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const requestedUrl = new URL(globalThis.fetch.mock.calls[0][0])
    expect(requestedUrl.pathname).toBe(
      '/estadisticascambiarias/v1.0/Cotizaciones/REF',
    )
    expect(requestedUrl.searchParams.get('fechaHasta')).toBe('2026-10-31')
    expect(quote).toMatchObject({
      rate: 1515.8766,
      baseCurrency: 'USD',
      quoteCurrency: 'ARS',
      source: 'bcra_api',
      sourceCode: 'REF',
      rateType: 'comunicacion_a_3500_reference',
      effectiveDate: '2026-10-30',
      historical: true,
      verified: true,
    })

    const snapshots = await AiFxRateSnapshot.find({ sourceCode: 'REF' }).lean()
    expect(snapshots).toHaveLength(2)
    expect(snapshots.map(row => row.dateKey)).toEqual(['2026-10-29', '2026-10-30'])
    expect(snapshots[1].rate).toBe(1515.8766)
  })

  test('un período histórico reutiliza el snapshot guardado y no vuelve a consultar BCRA', async () => {
    await AiFxRateSnapshot.create({
      _id: 'BCRA:REF:2026-10-30',
      dateKey: '2026-10-30',
      source: 'bcra_api',
      sourceCode: 'REF',
      baseCurrency: 'USD',
      quoteCurrency: 'ARS',
      rateType: 'comunicacion_a_3500_reference',
      rate: 1515.8766,
      sourceUrl: 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/REF',
      capturedAt: new Date('2026-10-31T00:01:00.000Z'),
    })

    const quote = await getBcraUsdArsQuote({
      asOf: new Date('2026-11-01T23:59:59.999Z'),
    })

    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(quote.rate).toBe(1515.8766)
    expect(quote.effectiveDate).toBe('2026-10-30')
    expect(quote.capturedAt).toEqual(new Date('2026-10-31T00:01:00.000Z'))
  })

  test('rechaza respuestas HTTP fallidas y no registra cotizaciones inventadas', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 503,
    })

    await expect(
      getBcraUsdArsQuote({
        asOf: new Date('2026-10-15T12:00:00.000Z'),
      }),
    ).rejects.toThrow('BCRA respondió HTTP 503')

    expect(await AiFxRateSnapshot.countDocuments()).toBe(0)
  })

  test('rechaza valores de cotización cero o no numéricos', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 0,
        results: [
          {
            fecha: '2026-10-14',
            detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 0 }],
          },
          {
            fecha: '2026-10-15',
            detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 'no-es-un-numero' }],
          },
        ],
      }),
    })

    await expect(
      getBcraUsdArsQuote({
        asOf: new Date('2026-10-15T23:59:59.999Z'),
      }),
    ).rejects.toThrow('BCRA no publicó una cotización REF')

    expect(await AiFxRateSnapshot.countDocuments()).toBe(0)
  })
})
