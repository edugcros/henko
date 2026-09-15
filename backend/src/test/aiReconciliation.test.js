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

const {
  reserveAiBudget, refundAiBudget, recordAiConsumption,
  sweepStaleOperations, AI_METRICS,
} = await import('../services/ai/aiBudgetService.js')
const { getPlatformSpendSnapshot } = await import(
  '../services/ai/aiSpendReportService.js'
)
const {
  rebuildTenantProjection,
  rebuildPlatformProjection,
  auditAccounting,
  runAccountingAudit,
} = await import('../services/ai/aiAccountingService.js')

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

    const reporte = await rebuildTenantProjection({ tenantId: TENANT, period })

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

    const reporte = await rebuildTenantProjection({ tenantId: TENANT, period })

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

    const reporte = await rebuildTenantProjection({ tenantId: TENANT, period })

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

    const informe = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(informe.hasDrift).toBe(true)
    expect(informe.counters.agentMessages).toEqual({ stored: 5, ledger: 1, drift: 4 })
    // Por defecto NO escribe: primero se mira, después se decide.
    expect(informe.applied).toBe(false)
    expect(await contador(period, 'agentMessages')).toBe(5)

    const aplicado = await rebuildTenantProjection({ tenantId: TENANT, period, apply: true })

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

    await rebuildTenantProjection({ tenantId: TENANT, period, apply: true })
    const primera = await contador(period, 'agentMessages')

    const segunda = await rebuildTenantProjection({ tenantId: TENANT, period, apply: true })

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

    const informe = await rebuildPlatformProjection({ period })

    expect(informe.hasDrift).toBe(true)
    expect(informe.tokens).toEqual({ stored: 15000, ledger: 5000, drift: 10000 })

    const aplicado = await rebuildPlatformProjection({ period, apply: true })
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

    const informe = await rebuildPlatformProjection({ period })

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

// ─── BLOQUE 5 · el libro es la verdad, pero solo si está completo ───────────
//
// Declarar al ledger fuente de verdad solo vale si el ledger tiene todo. Hoy
// puede no tenerlo: writeLedgerEntry no se espera y se traga los errores que
// no son clave repetida, a propósito, para que la contabilidad nunca rompa
// una operación de IA. Si esa escritura falla, el contador subió y la fila no
// existe.
//
// Medido antes de esta guarda: un contador CORRECTO en 3, con una fila
// perdida, quedaba en 2 después de "corregirlo". La reconciliación destruía
// el número bueno.

describe('fuente de verdad · no se corrige contra un libro corto', () => {
  test('detecta que al ledger le faltan operaciones y NO toca el contador', async () => {
    const period = '2050-01'

    // Claves propias: operationId es unico POR COMERCIO, no por periodo.
    // Reusar una de otro test la trata como reintento y no incrementa nada,
    // que es el comportamiento correcto de una clave de idempotencia.
    for (const operationId of ['corto-1', 'corto-2', 'corto-3']) {
      await reserveAiBudget({
        tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
        profile: PERFIL, period, operationId,
      })
    }
    await asentar()

    // La escritura del ledger de una de ellas falló.
    await AiConsumptionLedger.deleteOne({ tenantId: TENANT, operationId: 'corto-3' })
      .setOptions({ tenantId: TENANT })

    const informe = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(informe.ledgerComplete).toBe(false)
    expect(informe.missingFromLedger).toContain('corto-3')

    // Aunque se pida aplicar, no se aplica: corregir contra un libro corto
    // sería borrar consumo real.
    const intento = await rebuildTenantProjection({ tenantId: TENANT, period, apply: true })

    expect(intento.applied).toBe(false)
    expect(await contador(period, 'agentMessages')).toBe(3)
  })

  test('con el libro completo, sí corrige', async () => {
    const period = '2050-02'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'completa',
    })
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $inc: { 'counters.agentMessages': 3 } },
    ).setOptions({ tenantId: TENANT })
    await asentar()

    const aplicado = await rebuildTenantProjection({ tenantId: TENANT, period, apply: true })

    expect(aplicado.ledgerComplete).toBe(true)
    expect(aplicado.applied).toBe(true)
    expect(await contador(period, 'agentMessages')).toBe(1)
  })

  test('una llamada extra no cuenta como operación faltante', async () => {
    // La reparación entra al ledger como 'operacion:repair'. Compararla de
    // forma literal la daría por ausente y bloquearía toda corrección.
    const period = '2050-03'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'con-reparacion',
    })
    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 600,
      model: 'gemini-3.1-flash-lite', inputTokens: 400, outputTokens: 200,
      profile: PERFIL, period, operationId: 'con-reparacion', callId: 'repair',
    })
    await asentar()

    const informe = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(informe.ledgerComplete).toBe(true)
    expect(informe.missingFromLedger).toHaveLength(0)
  })
})

// ─── Reservas colgadas ──────────────────────────────────────────────────────
//
// Una operación entra en 'running' cuando se reserva el cupo y sale cuando se
// registra el consumo o se devuelve la reserva. Si el proceso muere en el
// medio —un deploy a mitad de una llamada, un crash— no pasa ninguna de las
// dos: el comercio queda pagando algo que nunca recibió, hasta que cambie el
// mes.

describe('reservas colgadas · el cupo vuelve solo', () => {
  const vieja = async (operationId, period, minutos = 60) => {
    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })

    // Se la envejece: el barrido mira startedAt.
    await AiOperation.updateOne(
      { tenantId: TENANT, operationId },
      { $set: { startedAt: new Date(Date.now() - minutos * 60000) } },
    ).setOptions({ tenantId: TENANT })
  }

  test('devuelve el cupo de una operación que quedó corriendo', async () => {
    const period = '2051-01'
    await vieja('murio-a-mitad', period)
    await asentar()
    expect(await contador(period, 'agentMessages')).toBe(1)

    const resultado = await sweepStaleOperations()

    expect(resultado.swept).toBeGreaterThanOrEqual(1)
    expect(await contador(period, 'agentMessages')).toBe(0)

    const op = await AiOperation.findOne({ tenantId: TENANT, operationId: 'murio-a-mitad' })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(op.status).toBe('refunded')
  })

  test('no toca las que todavía están corriendo', async () => {
    const period = '2051-02'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'recien-empezada',
    })
    await asentar()

    await sweepStaleOperations()

    // El análisis de mercado más lento medido tardó 116 segundos. Barrer algo
    // vivo le regala el trabajo al comercio y, peor, descuenta cupo de algo
    // que sí se va a entregar.
    expect(await contador(period, 'agentMessages')).toBe(1)
  })

  test('barrer dos veces no devuelve dos veces', async () => {
    const period = '2051-03'
    await vieja('doble-barrido', period)
    await asentar()

    await sweepStaleOperations()
    await sweepStaleOperations()

    // Reusa refundAiBudget, que tiene el reclamo atómico: dos instancias del
    // servidor barriendo a la vez no pueden devolver la misma reserva dos
    // veces.
    expect(await contador(period, 'agentMessages')).toBe(0)
  })

  test('no barre una que ya se completó', async () => {
    const period = '2051-04'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: 'termino-bien',
    })
    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 300,
      model: 'gemini-3.1-flash-lite', inputTokens: 200, outputTokens: 100,
      profile: PERFIL, period, operationId: 'termino-bien',
    })
    await AiOperation.updateOne(
      { tenantId: TENANT, operationId: 'termino-bien' },
      { $set: { startedAt: new Date(Date.now() - 3600000) } },
    ).setOptions({ tenantId: TENANT })
    await asentar()

    await sweepStaleOperations()

    expect(await contador(period, 'agentMessages')).toBe(1)
  })
})

// ─── BLOQUE 7 · las tres representaciones tienen que dar lo mismo ───────────
//
// El libro, la suma de lo que cree cada comercio y el contador de plataforma
// se escriben en el MISMO acto, con el mismo número. Si no coinciden, alguien
// pagó algo que no se le cobró o al revés.

describe('auditoría contable · detectar, no corregir', () => {
  test('cuando todo cuadra, no hay hallazgos', async () => {
    const period = '2060-01'

    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 12000,
      model: 'gemini-3.1-flash-lite', inputTokens: 9000, outputTokens: 3000,
      profile: PERFIL, period, operationId: 'cuadra-1',
    })
    await asentar()

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(true)
    expect(auditoria.findings).toHaveLength(0)
    expect(auditoria.cost.ledger).toBe(auditoria.cost.platformUsage)
    expect(auditoria.cost.ledger).toBe(auditoria.cost.tenantUsage)
  })

  test('el caso del enunciado: el comercio quedó corto', async () => {
    //   Ledger:           82.31
    //   AiPlatformUsage:  82.31
    //   AiUsage:          80.21   ← 2,10 que alguien pagó y nadie le cobró
    const period = '2060-02'

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'enunciado',
      keySource: 'platform', costUsd: 82.31,
    })
    await AiPlatformUsage.updateOne(
      { period },
      { $set: { estimatedCostUsd: 82.31, tokens: 1 } },
      { upsert: true },
    )
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 80.21 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(false)
    expect(auditoria.cost).toEqual({
      ledger: 82.31,
      platformUsage: 82.31,
      tenantUsage: 80.21,
    })

    // La diferencia dice DÓNDE mirar: el libro y la plataforma coinciden, así
    // que el roto es el agregado por comercio.
    expect(auditoria.findings).toEqual([
      { between: ['ledger', 'tenantUsage'], difference: 2.1 },
      { between: ['platformUsage', 'tenantUsage'], difference: 2.1 },
    ])
  })

  test('el ciclo automático NO corrige nada', async () => {
    // Corregir un agregado sin que una persona haya mirado la evidencia es la
    // forma más rápida de convertir un bug de lectura en pérdida de datos. Ya
    // pasó acá: la primera versión bajaba un contador correcto de 3 a 2.
    const period = '2060-03'

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'no-corregir',
      keySource: 'platform', costUsd: 50,
    })
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 10 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })

    const resultado = await runAccountingAudit({ period })

    expect(resultado.balanced).toBe(false)

    // El número sigue mal DESPUÉS de auditar: detectar y corregir son dos
    // actos, y el segundo se pide.
    const despues = await AiUsage.findOne({ tenantId: TENANT, period })
      .setOptions({ tenantId: TENANT })
      .lean()

    expect(despues.estimatedCostUsd).toBe(10)
  })

  test('una diferencia de centésimas de centavo no es un hallazgo', async () => {
    // Son las mismas sumas hechas en otro orden. Reportarlas entrenaría a
    // ignorar el aviso que importa.
    const period = '2060-04'

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'ruido',
      keySource: 'platform', costUsd: 10.000_02,
    })
    await AiPlatformUsage.updateOne(
      { period }, { $set: { estimatedCostUsd: 10 } }, { upsert: true },
    )
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 10 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(true)
  })
})
