// La contabilidad de un análisis de imagen, de punta a punta: analyzeImage contra
// una base real, con Gemini simulado.
//
// POR QUÉ EXISTE
//
// La clave de la operación era fija por imagen y por mes, y cada error nacía de
// combinar esa clave con una llamada real al proveedor: analizar otra vez la misma
// foto no se cobraba ni se registraba, y reintentar tras una respuesta inválida
// dejaba la operación corriendo con la plata retenida. Las suites del presupuesto
// no lo ven porque le pasan la clave a mano.

import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import sharp from 'sharp'

import { crearMongoEnMemoria } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

// La suite corre sin .env: sin clave de plataforma la reserva se niega antes de
// llegar a lo que se prueba acá.
process.env.GEMINI_API_KEY = 'AIzaTEST'

const generateContent = jest.fn()

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent }
    }
  },
}))

const { default: Tenant } = await import('../models/tenantModel.js')
const { default: AiOperation } = await import('../models/aiOperationModel.js')
const { default: AiProviderCall } = await import('../models/aiProviderCallModel.js')
const { default: AiConsumptionLedger } = await import('../models/aiConsumptionLedgerModel.js')
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { analyzeImage } = await import('../services/aiVisionService.js')
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')

const PERIODO = getCurrentPeriod()
const USO = { promptTokenCount: 1000, candidatesTokenCount: 100, totalTokenCount: 1100 }
const ANALISIS = JSON.stringify({ titulo: 'Zapatilla', categoria: 'Calzado' })

const respuestaDeGemini = (texto, usageMetadata = USO) => ({
  response: Promise.resolve({ usageMetadata, text: () => texto }),
})

let mongod
let tenant
let foto

const uso = () =>
  AiUsage.findOne({ tenantId: tenant._id, period: PERIODO })
    .setOptions({ tenantId: tenant._id })
    .lean()

const operaciones = () =>
  AiOperation.find({ tenantId: tenant._id }).setOptions({ tenantId: tenant._id }).lean()

const llamadas = () =>
  AiProviderCall.find({ tenantId: tenant._id }).setOptions({ tenantId: tenant._id }).lean()

const asentar = () => new Promise(resolve => setTimeout(resolve, 150))

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())

  await AiOperation.init()
  await AiProviderCall.init()
  await AiConsumptionLedger.init()

  foto = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  generateContent.mockReset()

  tenant = await Tenant.create({
    name: 'Comercio',
    slug: `comercio-${new mongoose.Types.ObjectId()}`,
    plan: 'pro',
    subscriptionStatus: 'active',
  })
})

describe('cada análisis es una operación', () => {
  test('la misma foto analizada dos veces se cobra y se registra dos veces', async () => {
    generateContent.mockResolvedValue(respuestaDeGemini(ANALISIS))

    await analyzeImage(foto, 'image/png', String(tenant._id))
    await analyzeImage(foto, 'image/png', String(tenant._id))
    await asentar()

    const consumo = await uso()

    expect(consumo.counters.vision).toBe(2)
    expect(await llamadas()).toHaveLength(2)
    expect(consumo.estimatedCostUsd).toBeCloseTo(2 * 0.0004, 8)
    expect((await operaciones()).map(o => o.status)).toEqual(['completed', 'completed'])
  })

  test('una respuesta inválida devuelve la cuota y conserva el gasto', async () => {
    generateContent.mockResolvedValueOnce(respuestaDeGemini('esto no es json'))

    await expect(analyzeImage(foto, 'image/png', String(tenant._id))).rejects.toThrow()
    await asentar()

    const consumo = await uso()
    const [operacion] = await operaciones()

    expect(consumo.counters.vision).toBe(0)
    expect(consumo.estimatedCostUsd).toBeCloseTo(0.0004, 8)
    expect(consumo.reservedCostUsd).toBe(0)
    expect(operacion.status).toBe('refunded')
  })

  test('reintentar tras una respuesta inválida no deja nada colgado', async () => {
    generateContent
      .mockResolvedValueOnce(respuestaDeGemini('esto no es json'))
      .mockResolvedValueOnce(respuestaDeGemini(ANALISIS))

    await analyzeImage(foto, 'image/png', String(tenant._id)).catch(() => null)
    await analyzeImage(foto, 'image/png', String(tenant._id))
    await asentar()

    const consumo = await uso()
    const estados = (await operaciones()).map(o => o.status).sort()

    expect(estados).toEqual(['completed', 'refunded'])
    expect(consumo.counters.vision).toBe(1)
    expect(consumo.reservedCostUsd).toBe(0)
    expect(consumo.estimatedCostUsd).toBeCloseTo(2 * 0.0004, 8)

    const plataforma = await AiPlatformUsage.findOne({ period: PERIODO }).lean()

    expect(plataforma.reservedCostUsd).toBe(0)
  })

  test('si Gemini falla no queda gasto y se devuelve la cuota', async () => {
    generateContent.mockRejectedValueOnce(
      Object.assign(new Error('API key not valid'), { status: 400 }),
    )

    await expect(analyzeImage(foto, 'image/png', String(tenant._id))).rejects.toThrow()
    await asentar()

    const consumo = await uso()

    expect(consumo.counters.vision).toBe(0)
    expect(consumo.estimatedCostUsd || 0).toBe(0)
    expect(await llamadas()).toHaveLength(0)
  })
})
