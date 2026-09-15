// 📁 src/test/aiOperationIdempotency.test.js
//
// El reintento no puede cobrar dos veces. Contra una base real, porque el
// candado ES un índice único de Mongo: un mock del modelo probaría el mock.
//
// Lo que este archivo fija son los números que se midieron ANTES del arreglo,
// con las mismas llamadas:
//
//   reserveAiBudget x2   → ledger 1 fila ✓   counters.agentMessages 2 ✗
//   recordTokenSpend x2  → ledger 1 fila ✓   AiPlatformUsage.tokens 3000 ✗
//                                             (1500 realmente gastados)
//
// El ledger ya estaba protegido; los contadores no, porque el `$inc` corría
// antes y la escritura del ledger ni siquiera se esperaba.
//
// El segundo caso es el grave: AiPlatformUsage.tokens es lo que mide el
// disyuntor de plataforma. Contarlo doble puede disparar el freno de
// emergencia antes de tiempo y dejar sin IA a TODOS los comercios.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

const { default: AiConsumptionLedger } = await import(
  '../models/aiConsumptionLedgerModel.js'
)
const { default: AiOperation, AI_OPERATION_STATUS, AI_FEATURES, AI_PROVIDERS } =
  await import('../models/aiOperationModel.js')
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { reserveAiBudget, refundAiBudget, recordTokenSpend, AI_METRICS } = await import(
  '../services/ai/aiBudgetService.js'
)

const TENANT = '64b7f0000000000000000001'
const OTRO_TENANT = '64b7f0000000000000000002'

const PERFIL = {
  tenantId: TENANT,
  plan: 'starter',
  subscriptionStatus: 'active',
  trialEndsAt: null,
  keySource: 'platform',
  apiKey: 'AIzaTEST',
}

let mongod

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())

  // Los índices únicos son el mecanismo bajo prueba: sin esto, Mongoose los
  // construye en segundo plano y el primer test correría sin candado.
  await AiOperation.init()
  await AiConsumptionLedger.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

/** Las escrituras de trazabilidad no se esperan a propósito. */
const asentar = () => new Promise(r => setTimeout(r, 250))

const contador = async (period, metric = 'agentMessages') => {
  const usage = await AiUsage.findOne({ tenantId: TENANT, period })
    .setOptions({ tenantId: TENANT })
    .lean()

  return usage?.counters?.[metric] ?? 0
}

describe('reserva · el reintento no vuelve a cobrar', () => {
  test('dos reservas con la misma clave dejan el contador en uno', async () => {
    const period = '2030-01'
    const operationId = 'job-abc-123'

    const primera = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })
    const segunda = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })

    // Las dos permiten seguir: la reserva original se hizo y el reintento
    // tiene derecho a continuar. Denegarlo haría fallar algo que ya está pago.
    expect(primera.allowed).toBe(true)
    expect(segunda.allowed).toBe(true)
    expect(segunda.reason).toBe('replay')

    // Antes del arreglo esto daba 2.
    expect(await contador(period)).toBe(1)
  })

  test('la misma clave en dos comercios distintos no colisiona', async () => {
    const period = '2030-02'
    const operationId = 'hash-de-la-misma-imagen'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })
    const otro = await reserveAiBudget({
      tenantId: OTRO_TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: { ...PERFIL, tenantId: OTRO_TENANT }, period, operationId,
    })

    expect(otro.allowed).toBe(true)
    expect(otro.reason).not.toBe('replay')
    expect(await contador(period)).toBe(1)
  })

  test('sin clave estable, cada reserva es una operación distinta', async () => {
    // reserveAiBudget genera una clave cuando el llamador no la informa, así
    // que dos llamadas sin clave son dos operaciones y cobran dos veces. Es lo
    // correcto: no hay forma de saber que son la misma.
    const period = '2030-03'

    const a = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, profile: PERFIL, period,
    })
    const b = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, profile: PERFIL, period,
    })

    expect(a.operationId).not.toBe(b.operationId)
    expect(await contador(period)).toBe(2)
  })

  test('la operación queda registrada y corriendo', async () => {
    const period = '2030-04'
    const operationId = 'con-trazabilidad'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
      feature: 'aiAgent', provider: 'gemini', requestedModel: 'gemini-3.8-flash',
    })

    const op = await AiOperation.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(op.status).toBe(AI_OPERATION_STATUS.RUNNING)
    expect(op.feature).toBe('aiAgent')
    expect(op.provider).toBe('gemini')
    expect(op.requestedModel).toBe('gemini-3.8-flash')
    expect(op.startedAt).toBeInstanceOf(Date)
  })
})

describe('consumo · los tokens de plataforma se cuentan una vez', () => {
  test('dos registros con la misma clave no duplican el disyuntor', async () => {
    const period = '2030-05'
    const operationId = 'tokens-una-vez'

    for (let i = 0; i < 2; i++) {
      await recordTokenSpend({
        tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS,
        model: 'gemini-3.1-flash-lite',
        inputTokens: 1000, outputTokens: 500,
        profile: PERFIL, period, operationId,
      })
    }
    await asentar()

    const plataforma = await AiPlatformUsage.findOne({ period }).lean()
    const usage = await AiUsage.findOne({ tenantId: TENANT, period })
      .setOptions({ tenantId: TENANT })
      .lean()
    const filas = await AiConsumptionLedger.countDocuments({
      tenantId: TENANT, operationId,
    }).setOptions({ tenantId: TENANT })

    // Antes del arreglo: 3000.
    expect(plataforma.tokens).toBe(1500)
    expect(filas).toBe(1)

    // El costo tampoco se duplica: iba en el mismo camino sin guarda.
    const esperado = usage.estimatedCostUsd
    await recordTokenSpend({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS,
      model: 'gemini-3.1-flash-lite',
      inputTokens: 1000, outputTokens: 500,
      profile: PERFIL, period, operationId,
    })
    await asentar()

    const despues = await AiUsage.findOne({ tenantId: TENANT, period })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(despues.estimatedCostUsd).toBe(esperado)
  })

  test('guarda qué modelo respondió de verdad, no el que se pidió', async () => {
    const period = '2030-06'
    const operationId = 'fallback-visible'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
      requestedModel: 'gemini-3.8-flash',
    })

    // El fallback entregó otro modelo, y es el que se paga.
    await recordTokenSpend({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS,
      model: 'gemini-3.1-flash-lite',
      inputTokens: 800, outputTokens: 200,
      profile: PERFIL, period, operationId,
    })
    await asentar()

    const op = await AiOperation.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(op.requestedModel).toBe('gemini-3.8-flash')
    expect(op.actualModel).toBe('gemini-3.1-flash-lite')
    expect(op.status).toBe(AI_OPERATION_STATUS.COMPLETED)
    expect(op.completedAt).toBeInstanceOf(Date)
  })
})

describe('devolución · tampoco se repite', () => {
  test('dos refunds de la misma operación devuelven una sola vez', async () => {
    const period = '2030-07'
    const operationId = 'devolver-una-vez'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })
    expect(await contador(period)).toBe(1)

    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, period, operationId,
    })
    await asentar()
    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, period, operationId,
    })

    // Sin la guarda, el segundo refund dejaba el contador en -1 o abría cupo
    // que nadie pagó.
    expect(await contador(period)).toBe(0)

    const op = await AiOperation.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(op.status).toBe(AI_OPERATION_STATUS.REFUNDED)
  })
})

describe('sin cupo · la operación queda marcada como fallida', () => {
  test('una reserva denegada no deja la operación corriendo para siempre', async () => {
    const period = '2030-08'

    // Se agota el tope del plan con una reserva enorme.
    const limite = 1
    const operationId = 'sin-cupo'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'consume-todo', limitOverride: limite,
    })

    const denegada = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId, limitOverride: limite,
    })
    await asentar()

    expect(denegada.allowed).toBe(false)

    const op = await AiOperation.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Una operación que se queda en 'running' para siempre es indistinguible
    // de un proceso que murió a mitad de camino.
    expect(op.status).toBe(AI_OPERATION_STATUS.FAILED)
    expect(op.failedAt).toBeInstanceOf(Date)
  })
})

// ─── El reintento respeta en qué estado quedó la operación ──────────────────
//
// La primera versión de este candado trataba todo reintento igual: si la clave
// ya existía, devolvía `allowed: true` y no cobraba. Sonaba bien y tenía un
// agujero grave — una reserva DENEGADA por falta de cupo también queda
// registrada, así que un comercio sin cupo que reintentara con la misma clave
// pasaba igual, sin haber reservado nada.
//
// La regla correcta no es "¿ya existe?" sino "¿hay cupo reservado a su
// nombre?". running y completed lo tienen; pending, failed y refunded no.

describe('reintento · depende de si hay cupo retenido', () => {
  test('el reintento de una reserva DENEGADA sigue denegado', async () => {
    const period = '2031-01'
    const operationId = 'sin-cupo'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'quema-el-cupo', limitOverride: 1,
    })

    const primera = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId, limitOverride: 1,
    })
    await asentar()

    const reintento = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId, limitOverride: 1,
    })

    expect(primera.allowed).toBe(false)
    // Antes de este arreglo acá salía allowed:true con reason 'replay'.
    expect(reintento.allowed).toBe(false)
    expect(await contador(period)).toBe(1)
  })

  test('devuelta la reserva, el reintento puede volver a reservar', async () => {
    // Es el caso normal: el proveedor se cayó, se devolvió el cupo, se
    // reintenta con la misma clave. Bloquearlo dejaría al comercio sin poder
    // repetir algo por lo que no pagó.
    const period = '2031-02'
    const operationId = 'proveedor-caido'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })
    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, period, operationId,
    })
    await asentar()
    expect(await contador(period)).toBe(0)

    const reintento = await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })

    expect(reintento.allowed).toBe(true)
    expect(reintento.reason).not.toBe('replay')
    expect(await contador(period)).toBe(1)
  })

  test('DIEZ reintentos de una operación viva: una sola contable', async () => {
    const period = '2031-03'
    const operationId = 'diez-veces'

    const resultados = []
    for (let i = 0; i < 10; i++) {
      resultados.push(
        await reserveAiBudget({
          tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
          profile: PERFIL, period, operationId,
        }),
      )
    }
    await asentar()

    // Los diez pueden seguir; uno solo cobró.
    expect(resultados.every(r => r.allowed)).toBe(true)
    expect(resultados.filter(r => r.reason === 'replay')).toHaveLength(9)
    expect(await contador(period)).toBe(1)

    const operaciones = await AiOperation.countDocuments({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
    expect(operaciones).toBe(1)
  })
})

describe('trazabilidad · de dónde vino y quién cobró', () => {
  test('la operación guarda la función y el proveedor declarados', async () => {
    const period = '2031-04'
    const operationId = 'con-origen'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
      feature: AI_FEATURES.CART_RECOVERY,
      provider: AI_PROVIDERS.GEMINI,
    })

    const op = await AiOperation.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(op.feature).toBe('cartRecovery')
    expect(op.provider).toBe('gemini')
  })

  test('una función fuera del catálogo no entra', async () => {
    // Sin el enum, un typo en una función poco usada parte el reporte en dos
    // categorías que deberían ser una, y nadie se entera.
    await expect(
      AiOperation.create({
        tenantId: TENANT, operationId: 'inventada', period: '2031-05',
        metric: 'agentMessages', feature: 'carritoRecuperado',
      }),
    ).rejects.toThrow(/validation/i)
  })

  test('las tres funciones que comparten métrica se distinguen', async () => {
    // agentMessages lo usan el agente de WhatsApp, la recuperación de carritos
    // y la promoción social. Sin `feature` son indistinguibles en el reporte.
    const period = '2031-06'

    for (const feature of [
      AI_FEATURES.AI_AGENT,
      AI_FEATURES.CART_RECOVERY,
      AI_FEATURES.SOCIAL_PROMOTION,
    ]) {
      await reserveAiBudget({
        tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
        profile: PERFIL, period, operationId: `op-${feature}`, feature,
      })
    }

    const porFuncion = await AiOperation.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(TENANT), period } },
      { $group: { _id: '$feature', operaciones: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])

    expect(porFuncion.map(f => f._id)).toEqual([
      'aiAgent', 'cartRecovery', 'socialPromotion',
    ])
  })
})
