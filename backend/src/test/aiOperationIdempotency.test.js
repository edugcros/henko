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

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
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
const { default: AiProviderCall, CALL_ID } = await import(
  '../models/aiProviderCallModel.js'
)
const { reserveAiBudget, refundAiBudget, recordTokenSpend, recordAiConsumption, AI_METRICS } =
  await import(
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
  await AiProviderCall.init()
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

// ─── BLOQUE 3 · la devolución se reclama, no se consulta ────────────────────
//
// La guarda anterior leía el estado y después decidía. Dos refunds
// concurrentes leían 'running' los dos, los dos decidían que había algo que
// devolver, y los dos descontaban: la misma carrera que todo esto viene
// cerrando, un nivel más arriba.

describe('devolución · exactamente una vez, no al menos una', () => {
  test('dos refunds SIMULTÁNEOS devuelven una sola vez', async () => {
    const period = '2032-01'
    const operationId = 'carrera-de-refunds'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })
    expect(await contador(period)).toBe(1)

    // En paralelo, que es donde la guarda vieja se rompía.
    await Promise.all([
      refundAiBudget({
        tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, period, operationId,
      }),
      refundAiBudget({
        tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, period, operationId,
      }),
    ])
    await asentar()

    // Con la guarda vieja esto podía quedar en -1: cupo regalado.
    expect(await contador(period)).toBe(0)
  })

  test('no se devuelve cupo de una operación que nunca lo retuvo', async () => {
    const period = '2032-02'
    const operationId = 'nunca-reservo'

    // Se agota el tope y se intenta reservar: queda 'failed', sin cupo.
    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'quema', limitOverride: 1,
    })
    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId, limitOverride: 1,
    })
    await asentar()
    expect(await contador(period)).toBe(1)

    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES, period, operationId,
    })
    await asentar()

    // Devolverle cupo a algo que nunca lo reservó sería regalarle cuota.
    expect(await contador(period)).toBe(1)
  })
})

// ─── BLOQUE 4 · una operación puede hacer varias llamadas ───────────────────
//
// El cerebro del agente contesta y, si la respuesta sale mal formada, la
// repara con una SEGUNDA llamada que se paga igual. Antes eso se registraba
// inventándole a la reparación una operación falsa —`${operationId}:repair`—
// para que el índice del ledger no la rechazara. Contaba dos operaciones donde
// hay una, y desde que AiOperation gobierna el cobro, la reparación aparecía
// como una operación sin reserva propia.

describe('llamadas al proveedor · la unidad es la llamada, no la operación', () => {
  test('respuesta y reparación: una operación, dos llamadas, dos consumos', async () => {
    const period = '2032-03'
    const operationId = 'contesta-y-repara'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })

    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 1000,
      model: 'gemini-3.1-flash-lite', inputTokens: 700, outputTokens: 300,
      profile: PERFIL, period, operationId,
    })
    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 400,
      model: 'gemini-3.1-flash-lite', inputTokens: 300, outputTokens: 100,
      profile: PERFIL, period, operationId, callId: CALL_ID.REPAIR,
    })
    await asentar()

    // Las DOS se cobran: antes del sufijo, la reparación viajaba gratis en la
    // contabilidad y cara en la factura.
    expect(await contador(period, 'agentTokens')).toBe(1400)

    // Una sola operación.
    const operaciones = await AiOperation.countDocuments({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
    expect(operaciones).toBe(1)

    // Dos llamadas.
    const llamadas = await AiProviderCall.find({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(llamadas.map(l => l.callId).sort()).toEqual(['main', 'repair'])

    // Y dos filas de consumo en el ledger, distinguibles.
    const filas = await AiConsumptionLedger.countDocuments({
      tenantId: TENANT, event: 'consumed',
      operationId: { $in: [operationId, `${operationId}:repair`] },
    }).setOptions({ tenantId: TENANT })
    expect(filas).toBe(2)
  })

  test('la misma llamada repetida sí se descarta', async () => {
    const period = '2032-04'
    const operationId = 'repite-la-misma'

    for (let i = 0; i < 5; i++) {
      await recordAiConsumption({
        tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 500,
        model: 'gemini-3.1-flash-lite', inputTokens: 400, outputTokens: 100,
        profile: PERFIL, period, operationId, callId: CALL_ID.REPAIR,
      })
    }
    await asentar()

    expect(await contador(period, 'agentTokens')).toBe(500)

    const llamadas = await AiProviderCall.countDocuments({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
    expect(llamadas).toBe(1)
  })

  test('la llamada guarda qué se pidió, qué respondió y cuánto costó', async () => {
    const period = '2032-05'
    const operationId = 'llamada-completa'

    await recordTokenSpend({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS,
      model: 'gemini-3.1-flash-lite',
      inputTokens: 2000, outputTokens: 500,
      profile: PERFIL, period, operationId,
      provider: 'gemini', requestedModel: 'gemini-3.8-flash',
    })
    await asentar()

    const llamada = await AiProviderCall.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(llamada.callId).toBe('main')
    expect(llamada.provider).toBe('gemini')
    expect(llamada.requestedModel).toBe('gemini-3.8-flash')
    expect(llamada.actualModel).toBe('gemini-3.1-flash-lite')
    expect(llamada.totalTokens).toBe(2500)
    expect(llamada.costUsd).toBeGreaterThan(0)
  })

  test('la fila guarda el razonamiento y la tarifa con la que se cobró', async () => {
    // El usageMetadata REAL de gemini-3.6-flash, medido contra la API.
    const { readUsage } = await import('../services/ai/aiUsageMetadata.js')
    const period = '2032-06'
    const operationId = 'llamada-con-pensamiento'

    const usage = readUsage({
      model: 'gemini-3.1-flash-lite',
      usageMetadata: {
        promptTokenCount: 61,
        candidatesTokenCount: 387,
        thoughtsTokenCount: 462,
        totalTokenCount: 910,
        serviceTier: 'standard',
      },
    })

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: usage.totalTokens,
      profile: PERFIL,
      period,
      operationId,
      provider: 'gemini',
      usage,
    })
    await asentar()

    const llamada = await AiProviderCall.findOne({ tenantId: TENANT, operationId })
      .setOptions({ tenantId: TENANT })
      .lean()

    // La salida facturable incluye lo que el modelo razonó.
    expect(llamada.outputTokens).toBe(387 + 462)
    expect(llamada.thinkingTokens).toBe(462)
    expect(llamada.serviceTier).toBe('standard')
    expect(llamada.cachedInputTokens).toBeNull()

    // La fila se verifica sola: costo = tokens × tarifa guardada.
    expect(llamada.priceInputPerMillion).toBeGreaterThan(0)
    expect(llamada.priceOutputPerMillion).toBeGreaterThan(0)
    expect(llamada.costEstimated).toBe(false)
    expect(llamada.costUsd).toBeCloseTo(
      (llamada.inputTokens * llamada.priceInputPerMillion +
        llamada.outputTokens * llamada.priceOutputPerMillion) /
        1e6,
      6,
    )
  })

  test('un consumo con operación cierra la operación; sin ella queda colgada', async () => {
    // ESTE ERA EL AGUJERO, medido en producción:
    //
    //   Ledger: 68 de 155 consumos con operationId nulo.
    //   AiOperation: marketAnalyses → 2 running, 0 completed. Nunca una.
    //
    // Cinco de los seis llamadores tenían la clave de la reserva en la mano
    // —la usaban para el reembolso— y no se la pasaban al consumo. Sin ella,
    // claimConsumption se va en la primera línea: no hay candado, no hay fila
    // de AiProviderCall, no se liquida la reserva, y sobre todo NO SE CIERRA
    // LA OPERACIÓN. El barrido de colgadas la levanta después y la REEMBOLSA:
    // el comercio recibía el trabajo y la cuota se le devolvía igual.
    const period = '2032-07'

    const conOperacion = 'consumo-con-operacion'
    await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_ANALYSES,
      profile: PERFIL,
      period,
      operationId: conOperacion,
    })

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      amount: 1500,
      model: 'gemini-3.1-flash-lite',
      profile: PERFIL,
      period,
      operationId: conOperacion,
      provider: 'gemini',
    })
    await asentar()

    const operacion = await AiOperation.findOne({ tenantId: TENANT, operationId: conOperacion })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(operacion.status).toBe('completed')

    // Y dejó su fila de llamada al proveedor.
    const llamada = await AiProviderCall.findOne({ tenantId: TENANT, operationId: conOperacion })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(llamada).not.toBeNull()
    expect(llamada.provider).toBe('gemini')

    // El contraste: el mismo consumo sin la clave no deja rastro de llamada.
    const sinOperacion = 'consumo-sin-operacion'
    await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_ANALYSES,
      profile: PERFIL,
      period,
      operationId: sinOperacion,
    })

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.MARKET_TOKENS,
      amount: 1500,
      model: 'gemini-3.1-flash-lite',
      profile: PERFIL,
      period,
    })
    await asentar()

    const colgada = await AiOperation.findOne({ tenantId: TENANT, operationId: sinOperacion })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Sigue retenida: es lo que pasaba en producción con TODOS los análisis.
    expect(colgada.status).toBe('running')
    expect(
      await AiProviderCall.countDocuments({ tenantId: TENANT, operationId: sinOperacion }).setOptions(
        { tenantId: TENANT },
      ),
    ).toBe(0)
  })
})

describe('todo consumo pagado informa su operación', () => {
  // Guardián estructural: el bug no fue una línea mal escrita, fue que la
  // clave era OPCIONAL y cinco llamadores se la olvidaron durante meses sin
  // que nada se quejara. Esto recorre el backend y exige que cada
  // recordAiConsumption la pase.
  test('ningún recordAiConsumption se llama sin operationId', () => {
    const SRC = path.resolve('src')

    const archivos = (dir, acc = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'test') archivos(full, acc)
        } else if (e.name.endsWith('.js')) acc.push(full)
      }
      return acc
    }

    const culpables = []

    for (const archivo of archivos(SRC)) {
      // El propio servicio define la función; no se audita a sí mismo.
      if (archivo.endsWith('aiBudgetService.js')) continue

      const codigo = fs.readFileSync(archivo, 'utf8')

      // Cada invocación, desde el paréntesis hasta su cierre.
      for (const m of codigo.matchAll(/recordAiConsumption\(\{/g)) {
        let i = m.index + m[0].length
        let nivel = 1
        while (i < codigo.length && nivel > 0) {
          if (codigo[i] === '{') nivel += 1
          if (codigo[i] === '}') nivel -= 1
          i += 1
        }

        // Sin comentarios: el porqué de esta regla está escrito ARRIBA de cada
        // llamada y menciona operationId varias veces, así que buscarlo en el
        // texto crudo daba positivo aunque el argumento no estuviera. Se probó
        // quitándole la clave al análisis de mercado: el test pasaba igual.
        const llamada = codigo
          .slice(m.index, i)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter(l => !l.trim().startsWith('//'))
          .join('\n')

        if (!/\boperationId\b/.test(llamada)) {
          culpables.push(path.relative(process.cwd(), archivo))
        }
      }
    }

    expect(culpables).toEqual([])
  })
})
