// 📁 src/test/aiDualBudget.test.js
//
// Dos controles de gasto, no uno con dos nombres.
//
//   tokens → VOLUMEN. No depende de ningún precio, así que es la red cuando el
//            catálogo de tarifas está viejo o el modelo no figura en él.
//   usd    → PLATA. Es lo que HENKO paga, y el único que sube cuando la cadena
//            de respaldo entrega un modelo cinco veces más caro sin que se
//            mueva un solo token de más.
//
// El caso que motiva todo esto: entre gemini-3.6-flash (0,75/3,75 por millón) y
// gemini-3.1-flash-lite (0,25/1,50) hay 5x. El mismo tope de tokens puede
// costar veinte dólares o cien según qué modelo esté respondiendo, y eso lo
// decide la cadena de respaldo cuando el pedido está saturado, no una
// configuración.
//
// Contra base real: lo que se prueba es el disyuntor que corta la IA de TODOS
// los comercios, y con mocks se probaría el mock.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

const { default: AiOperation } = await import('../models/aiOperationModel.js')
const { default: AiProviderCall } = await import('../models/aiProviderCallModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { reserveAiBudget, AI_METRICS, DENY_REASONS } = await import(
  '../services/ai/aiBudgetService.js'
)
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')
const { cacheDel } = await import('../utils/cache.js')

const TENANT = '64b7f0000000000000000001'

const PERFIL = {
  tenantId: TENANT,
  plan: 'starter',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  keySource: 'platform',
  apiKey: 'AIzaTEST',
}

let mongod
let contador = 0

/**
 * El disyuntor se pregunta por AHORA, no por el período que pide la reserva:
 * usa getCurrentPeriod() para leer el consumo y para su caché. Escribir el
 * consumo en un período inventado no lo afecta — el primer intento de estos
 * tests lo hacía y todos pasaban por el lado equivocado.
 */
const PERIODO_REAL = getCurrentPeriod()

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await AiOperation.init()
  await AiProviderCall.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET
  delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET

  // La decisión se cachea 30 segundos por período. Sin borrarla, el segundo
  // test leería la del primero.
  await cacheDel(`ai:platform:breaker:${PERIODO_REAL}`)
  await AiPlatformUsage.deleteMany({ period: PERIODO_REAL })
})

/** Una clave de operación distinta por caso; el período es siempre el real. */
const nuevaClave = () => `caso-${contador++}`

const conConsumo = async ({ tokens = 0, costUsd = 0 }) => {
  await AiPlatformUsage.updateOne(
    { period: PERIODO_REAL },
    {
      $set: { tokens, estimatedCostUsd: costUsd },
      $setOnInsert: { period: PERIODO_REAL },
    },
    { upsert: true },
  )
}

const reservar = operationId =>
  reserveAiBudget({
    tenantId: TENANT,
    metric: AI_METRICS.AGENT_MESSAGES,
    profile: PERFIL,
    period: PERIODO_REAL,
    operationId,
  })

describe('lo que hay hoy en producción no cambia', () => {
  test('sin el techo en dólares, manda el de tokens igual que siempre', async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'

    await conConsumo({ tokens: 1000, costUsd: 999999 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.reason).toBe(DENY_REASONS.PLATFORM_BUDGET)
    // El costo enorme no participa: sin AI_PLATFORM_MONTHLY_USD_BUDGET, el
    // techo en dólares es ilimitado.
    expect(resultado.detail).toBe('tokens')
  })

  test('sin ninguno de los dos, no hay disyuntor', async () => {

    await conConsumo({ tokens: 99999999, costUsd: 99999 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(true)
  })
})

describe('el techo en dólares corta por su cuenta', () => {
  test('el gasto se pasa y los tokens no: corta igual', async () => {
    // ESTE es el caso que el tope de tokens no puede ver. La cadena de
    // respaldo entregó un modelo cinco veces más caro: el volumen va por el
    // 10% y la plata ya se pasó.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await conConsumo({ tokens: 100000, costUsd: 100.5 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.detail).toBe('usd')
  })

  test('los tokens se pasan y el gasto no: también corta', async () => {
    // El techo de tokens no queda decorativo. Es la red cuando el número en
    // dólares está mal: sale de multiplicar tokens por un catálogo de precios,
    // y un modelo que no figura se cobra con la tarifa de respaldo.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await conConsumo({ tokens: 1500, costUsd: 3 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.detail).toBe('tokens')
  })

  test('con los dos pasados, se informa el de la plata', async () => {
    // Entre dos techos superados, el que hay que contarle al dueño de la
    // plataforma es el que le cuesta dinero.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    await conConsumo({ tokens: 5000, costUsd: 50 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(false)
    expect(resultado.detail).toBe('usd')
  })

  test('debajo de los dos techos, pasa', async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000000'
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await conConsumo({ tokens: 500, costUsd: 4.2 })

    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(true)
  })

  test('el techo en dólares admite decimales', async () => {
    // A diferencia del de tokens, no se redondea a entero: un techo de 99,50
    // es perfectamente razonable y redondearlo a 99 cortaría medio dólar antes.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '99.50'

    await conConsumo({ tokens: 10, costUsd: 99.4 })
    expect((await reservar(nuevaClave())).allowed).toBe(true)

    await cacheDel(`ai:platform:breaker:${PERIODO_REAL}`)
    await conConsumo({ tokens: 10, costUsd: 99.6 })
    expect((await reservar(nuevaClave())).allowed).toBe(false)
  })
})
