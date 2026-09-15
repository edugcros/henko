// 📁 src/test/aiReconciliation.test.js
//
// Lo que convierte a AiUsage en una PROYECCIÓN y no en una segunda verdad.
//
// El tope de cuota vive dentro del filtro del findOneAndUpdate que reserva, así
// que el contador tiene que estar materializado: un número que hay que calcular
// agregando el ledger no puede ir adentro de ese filtro sin leer primero y
// escribir después, que es la carrera que todo este trabajo viene cerrando.
//
// Entonces el contador se queda. Lo que lo hace una proyección es que se pueda
// RECONSTRUIR desde el ledger y que la diferencia se pueda ver.
//
// Contra base real: son agregaciones de Mongo y el punto es justamente que
// coincidan con lo que el medidor escribió por el otro camino.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')

const { default: AiConsumptionLedger } = await import(
  '../models/aiConsumptionLedgerModel.js'
)
const { default: AiOperation } = await import('../models/aiOperationModel.js')
const { default: AiProviderCall } = await import('../models/aiProviderCallModel.js')
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')

const { reserveAiBudget, refundAiBudget, recordAiConsumption, AI_METRICS } =
  await import('../services/ai/aiBudgetService.js')
const { reconcileTenantUsage, reconcilePlatformUsage, getPlatformSpendSnapshot } =
  await import('../services/ai/aiSpendReportService.js')

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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await AiOperation.init()
  await AiProviderCall.init()
  await AiConsumptionLedger.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

const asentar = () => new Promise(r => setTimeout(r, 300))

const contador = async (period, metric) => {
  const usage = await AiUsage.findOne({ tenantId: TENANT, period })
    .setOptions({ tenantId: TENANT })
    .lean()

  return usage?.counters?.[metric] ?? 0
}

describe('reconciliación · el ledger reconstruye el contador', () => {
  test('sin desviación, no reporta nada y no escribe', async () => {
    const period = '2040-01'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'a',
    })
    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'b',
    })
    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 1200,
      model: 'gemini-3.1-flash-lite', inputTokens: 900, outputTokens: 300,
      profile: PERFIL, period, operationId: 'a',
    })
    await asentar()

    const reporte = await reconcileTenantUsage({ tenantId: TENANT, period })

    expect(reporte.hasDrift).toBe(false)
    expect(reporte.applied).toBe(false)
    expect(reporte.counters.agentMessages).toEqual({ stored: 2, ledger: 2, drift: 0 })
    expect(reporte.counters.agentTokens).toEqual({ stored: 1200, ledger: 1200, drift: 0 })
  })

  test('la devolución se resta de los dos lados', async () => {
    const period = '2040-02'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'va-y-vuelve',
    })
    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      period, operationId: 'va-y-vuelve',
    })
    await asentar()

    const reporte = await reconcileTenantUsage({ tenantId: TENANT, period })

    expect(reporte.counters.agentMessages).toEqual({ stored: 0, ledger: 0, drift: 0 })
    expect(reporte.hasDrift).toBe(false)
  })

  test('visión: la unidad separa el cupo de los tokens que gastó', async () => {
    // El caso que rompe cualquier reconciliación ingenua. Reservar una visión
    // escribe una fila de UNA UNIDAD; los tokens que esa visión gastó escriben
    // otra fila con la MISMA métrica y unidad 'tokens'. El contador de cuota
    // solo contiene la primera. Sumarlas daría un contador de visión en
    // cientos de miles y la reconciliación "corregiría" el número bueno.
    const period = '2040-03'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.VISION,
      profile: PERFIL, period, operationId: 'una-vision',
    })

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.VISION,
      amount: 48000, unit: 'tokens', operationId: 'una-vision-tokens',
      keySource: 'platform', costUsd: 0.02,
    })
    await asentar()

    const reporte = await reconcileTenantUsage({ tenantId: TENANT, period })

    expect(reporte.counters.vision).toEqual({ stored: 1, ledger: 1, drift: 0 })
  })

  test('detecta una desviación real y la corrige contra el ledger', async () => {
    const period = '2040-04'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'legitima',
    })
    await asentar()

    // Un contador inflado, que es exactamente lo que dejaba el bug del
    // reintento antes del Bloque 1: el $inc corría dos veces y el ledger
    // guardaba una sola fila.
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $inc: { 'counters.agentMessages': 4 } },
    ).setOptions({ tenantId: TENANT })

    expect(await contador(period, 'agentMessages')).toBe(5)

    const informe = await reconcileTenantUsage({ tenantId: TENANT, period })

    expect(informe.hasDrift).toBe(true)
    expect(informe.counters.agentMessages).toEqual({ stored: 5, ledger: 1, drift: 4 })
    // Por defecto NO escribe: primero se mira, después se decide.
    expect(informe.applied).toBe(false)
    expect(await contador(period, 'agentMessages')).toBe(5)

    const aplicado = await reconcileTenantUsage({ tenantId: TENANT, period, apply: true })

    expect(aplicado.applied).toBe(true)
    expect(await contador(period, 'agentMessages')).toBe(1)
  })

  test('correr la corrección dos veces da lo mismo', async () => {
    // Se escribe el VALOR del ledger, no la diferencia: por eso es idempotente
    // sin importar cuántas veces se corra ni qué la desalineó.
    const period = '2040-05'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'idempotente',
    })
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $inc: { 'counters.agentMessages': 7 } },
    ).setOptions({ tenantId: TENANT })
    await asentar()

    await reconcileTenantUsage({ tenantId: TENANT, period, apply: true })
    const primera = await contador(period, 'agentMessages')

    const segunda = await reconcileTenantUsage({ tenantId: TENANT, period, apply: true })

    expect(primera).toBe(1)
    expect(segunda.hasDrift).toBe(false)
    expect(await contador(period, 'agentMessages')).toBe(1)
  })
})

describe('reconciliación de plataforma · el contador del disyuntor', () => {
  test('detecta el contador inflado que dispararía el freno antes de tiempo', async () => {
    const period = '2040-06'

    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 5000,
      model: 'gemini-3.1-flash-lite', inputTokens: 4000, outputTokens: 1000,
      profile: PERFIL, period, operationId: 'plataforma-1',
    })
    await asentar()

    // Lo que dejaba el reintento: 5000 reales contados como 15000.
    await AiPlatformUsage.updateOne({ period }, { $inc: { tokens: 10000 } })

    const informe = await reconcilePlatformUsage({ period })

    expect(informe.hasDrift).toBe(true)
    expect(informe.tokens).toEqual({ stored: 15000, ledger: 5000, drift: 10000 })

    const aplicado = await reconcilePlatformUsage({ period, apply: true })
    expect(aplicado.applied).toBe(true)

    const despues = await AiPlatformUsage.findOne({ period }).lean()
    expect(despues.tokens).toBe(5000)
  })

  test('el consumo con key del comercio no le cuenta a la plataforma', async () => {
    // BYOK gasta la cuota de Google del comercio, no la de HENKO. Contarlo
    // acercaría el disyuntor sin que la plataforma hubiera gastado un peso.
    const period = '2040-07'

    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 9000,
      model: 'gemini-3.1-flash-lite', inputTokens: 7000, outputTokens: 2000,
      profile: { ...PERFIL, keySource: 'tenant' },
      period, operationId: 'byok-1',
    })
    await asentar()

    const informe = await reconcilePlatformUsage({ period })

    expect(informe.tokens.ledger).toBe(0)
  })
})

describe('la diferencia se ve sin que nadie corra nada', () => {
  test('el snapshot de plataforma la trae, y NO la corrige', async () => {
    // Una reconciliación que hay que acordarse de correr es código muerto. Y
    // corregir un agregado como efecto secundario de abrir una pantalla es la
    // clase de sorpresa que uno no quiere en el camino de la plata: el reporte
    // muestra, la corrección se pide aparte.
    const period = '2040-08'

    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 3000,
      model: 'gemini-3.1-flash-lite', inputTokens: 2000, outputTokens: 1000,
      profile: PERFIL, period, operationId: 'para-el-snapshot',
    })
    await asentar()
    await AiPlatformUsage.updateOne({ period }, { $inc: { tokens: 2000 } })

    const snapshot = await getPlatformSpendSnapshot(period)

    expect(snapshot.reconciliation.hasDrift).toBe(true)
    expect(snapshot.reconciliation.tokens.drift).toBe(2000)
    expect(snapshot.reconciliation.applied).toBe(false)

    // El contador sigue como estaba: mirar no corrige.
    const despues = await AiPlatformUsage.findOne({ period }).lean()
    expect(despues.tokens).toBe(5000)
  })
})
