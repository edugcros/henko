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
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')

const {
  reserveAiBudget, refundAiBudget, recordAiConsumption, recordToolSpend,
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
  backfillLedgerFromProviderCalls,
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

  test('una clave CON dos puntos propios tampoco falta', async () => {
    // ESTE ERA EL BUG, Y EL TEST DE ARRIBA NO LO AGARRABA.
    //
    // El de arriba usa 'con-reparacion', una clave sin dos puntos. El agente
    // namespacea la suya:
    //
    //   AiOperation     agent:<tenant>:msg_<uuid>
    //   ledger          agent:<tenant>:msg_<uuid>:main
    //
    // El chequeo hacia split(':')[0], que sobre esa clave devuelve "agent" y
    // no coincide con nada. Medido en produccion: 8 de 23 operaciones del
    // periodo se reportaban ausentes TENIENDO sus filas, ledgerComplete
    // quedaba en false y la correccion se negaba a aplicar. O sea que el drift
    // que la reconciliacion existe para cerrar no se cerraba nunca.
    //
    // Y fallaba justo para el agente: el unico llamador que namespacea su
    // clave es el que mas filas escribe.
    const period = '2050-04'
    const operationId = `agent:${TENANT}:msg_9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f`

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId,
    })
    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 800,
      model: 'gemini-3.1-flash-lite', inputTokens: 600, outputTokens: 200,
      profile: PERFIL, period, operationId, callId: 'main',
    })
    await recordAiConsumption({
      tenantId: TENANT, metric: AI_METRICS.AGENT_TOKENS, amount: 500,
      model: 'gemini-3.1-flash-lite', inputTokens: 400, outputTokens: 100,
      profile: PERFIL, period, operationId, callId: 'repair',
    })
    await asentar()

    const informe = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(informe.missingFromLedger).toHaveLength(0)
    expect(informe.ledgerComplete).toBe(true)
  })

  test('un callId de varios segmentos tampoco la pierde', async () => {
    // Una llamada a herramienta entra como 'operacion:tool:tavily_search':
    // el callId agrega DOS segmentos, no uno. Cualquier arreglo que recorte
    // una cantidad fija de segmentos vuelve a romperse aca.
    const period = '2050-05'
    const operationId = `agent:${TENANT}:msg_herramienta`

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.MARKET_ANALYSES,
      profile: PERFIL, period, operationId,
    })
    await recordToolSpend({
      tenantId: TENANT, metric: AI_METRICS.MARKET_TOKENS,
      tool: 'tavily_search', quantity: 4,
      profile: PERFIL, period, operationId, provider: 'tavily',
    })
    await asentar()

    const informe = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(informe.missingFromLedger).toHaveLength(0)
    expect(informe.ledgerComplete).toBe(true)
  })

  test('una operacion que de verdad falta SIGUE detectandose', async () => {
    // La red no puede quedar tan laxa que deje pasar el caso real: si la
    // operacion no tiene NINGUNA fila, corregir contra el libro borraria
    // consumo de verdad.
    const period = '2050-06'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL, period, operationId: `agent:${TENANT}:msg_sin_libro`,
    })
    await asentar()

    // Se borran TODAS sus filas del ledger: la operacion queda huerfana.
    await AiConsumptionLedger.deleteMany({ operationId: { $regex: 'msg_sin_libro' } })
      .setOptions({ tenantId: TENANT })

    const informe = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(informe.ledgerComplete).toBe(false)
    expect(informe.missingFromLedger).toContain(`agent:${TENANT}:msg_sin_libro`)
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
    // Sin BYOK en juego, el libro entero y el libro sin BYOK son el mismo
    // número: esta fila la pagó la plataforma.
    expect(auditoria.cost).toEqual({
      ledger: 82.31,
      ledgerSinByok: 82.31,
      byok: 0,
      platformUsage: 82.31,
      tenantUsage: 80.21,
    })

    // La diferencia dice DÓNDE mirar: el libro y la plataforma coinciden, así
    // que el roto es el agregado por comercio.
    expect(auditoria.findings).toEqual([
      { between: ['ledger', 'tenantUsage'], difference: 2.1 },
      { between: ['platformUsage', 'tenantUsageSinByok'], difference: 2.1 },
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

  // LAS DOS RECONCILIACIONES TAMBIEN REDONDEABAN ANTES DE COMPARAR
  //
  // rebuildTenantProjection y rebuildPlatformProjection redondeaban a 4
  // decimales —el default de round()— y recien despues comparaban contra
  // COST_TOLERANCE_USD, que es 0.0001. Cuantizado a diezmilesimas, la minima
  // diferencia no nula ES la tolerancia, y la comparacion es `>`: una deriva
  // de exactamente un diezmilesimo quedaba callada.
  //
  // Mismo defecto que tenia auditAccounting, en version mas leve. Medido el
  // 19/09/2026 sobre Henko: la auditoria veia 0.000027 y el reconciliador
  // informaba deriva CERO, porque 1.066759 y 1.066786 caen en el mismo
  // diezmilesimo. Dos herramientas sobre los mismos datos sin acuerdo sobre
  // que significa "cuadra".

  test('una deriva apenas sobre la tolerancia se informa, y por lo que vale', async () => {
    // 0.00012 es el caso que separa las dos versiones: redondeado a 4
    // decimales da 0.0001, que NO es > 0.0001, asi que quedaba callado.
    const period = '2060-09'

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'apenas-encima',
      keySource: 'platform', costUsd: 10,
    })
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 10.00012 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })

    const reporte = await rebuildTenantProjection({ tenantId: TENANT, period })

    expect(reporte.hasDrift).toBe(true)
    expect(reporte.cost.drift).toBeCloseTo(0.00012, 6)
    // Y NO el 0.0001 al que lo achataba el redondeo previo.
    expect(reporte.cost.drift).toBeGreaterThan(0.0001)
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

  // EL REDONDEO PREVIO A COMPARAR HACÍA INALCANZABLE LA TOLERANCIA
  //
  // auditAccounting redondeaba cada total a centavos y recién después comparaba
  // contra COST_TOLERANCE_USD (0.0001). Cuantizado a centavos, la mínima
  // diferencia no nula es 0.01: cien veces la tolerancia. O daba exactamente
  // cero, o se reportaba.
  //
  // La prueba de acá arriba pasaba con el código viejo, pero por el motivo
  // equivocado: el redondeo llevaba 10.00002 y 10 al mismo centavo. No medía la
  // tolerancia, medía el redondeo. Estas dos sí la miden.

  test('dos montos en centavos distintos, pero la diferencia real es ruido', async () => {
    // Caen a los lados de un borde de redondeo: 1.00499 -> 1.00 y 1.00502 ->
    // 1.01. El código viejo reportaba 0.01 de descuadre. La diferencia real es
    // 0.00003, por debajo de la tolerancia: no hay nada que avisar.
    const period = '2060-05'

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'borde-de-centavo',
      keySource: 'platform', costUsd: 1.00499,
    })
    await AiPlatformUsage.updateOne(
      { period }, { $set: { estimatedCostUsd: 1.00502 } }, { upsert: true },
    )
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 1.00499 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(true)
    expect(auditoria.findings).toHaveLength(0)
  })

  test('una diferencia real de medio centavo se informa por lo que vale', async () => {
    // Los números son los de producción del 18/09/2026, período 2026-09. El
    // descuadre es real —49 veces la tolerancia— pero vale 0.004943, no 0.01.
    // El código viejo informaba el doble, indistinguible de ruido amplificado,
    // y con eso no se puede decidir si hay que reconstruir el contador.
    const period = '2060-06'

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'medio-centavo',
      keySource: 'platform', costUsd: 1.071712,
    })
    await AiPlatformUsage.updateOne(
      { period }, { $set: { estimatedCostUsd: 1.076655 } }, { upsert: true },
    )
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 1.071712 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(false)

    // Sin BYOK, 'ledgerSinByok' es el libro entero. El nombre cambia porque
    // ahora la comparación declara sobre qué base se hace.
    const contraPlataforma = auditoria.findings.find(
      f => f.between[0] === 'ledgerSinByok' && f.between[1] === 'platformUsage',
    )

    expect(contraPlataforma).toBeDefined()
    expect(contraPlataforma.difference).toBeCloseTo(-0.004943, 6)

    // Y NO el centavo entero que informaba antes.
    expect(Math.abs(contraPlataforma.difference)).toBeLessThan(0.01)

    // El libro y los comercios coinciden: eso es lo que señala al contador de
    // plataforma como el roto.
    expect(
      auditoria.findings.find(f => f.between.includes('tenantUsage') && f.between.includes('ledger')),
    ).toBeUndefined()
  })

  // BYOK NO PONE A LOS TRES NÚMEROS EN LA MISMA BASE
  //
  // Con key propia del comercio, HENKO no paga nada — pero el LIBRO sí guarda
  // lo que ese comercio le pagó a su proveedor, porque es la única forma de
  // que vea su gasto. AiUsage también lo guarda. AiPlatformUsage no:
  // registerPlatformConsumption recibe costUsd=0 y rebuildPlatformProjection
  // filtra keySource != 'tenant'.
  //
  // La auditoría comparaba el libro ENTERO contra el contador de plataforma,
  // así que apenas un comercio usara su propia key el descuadre era permanente
  // y del tamaño exacto del BYOK. Medido en producción: 0.056 de BYOK haciendo
  // que la deriva informada (0.004943) no se pareciera a la real (0.060943).

  test('con BYOK en el libro, los números siguen cuadrando', async () => {
    // ESTA ES LA PROPIEDAD. Todo consistente, más una fila BYOK. Antes esto
    // reportaba descuadre por el monto del BYOK, para siempre.
    const period = '2060-07'
    const OTRO = new mongoose.Types.ObjectId()

    // Lo que pagó la plataforma.
    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'byok-plataforma',
      keySource: 'platform', costUsd: 1,
    })
    // Lo que pagó el comercio con su propia key: entra al libro y a su
    // agregado, NO al contador de plataforma.
    await AiConsumptionLedger.create({
      tenantId: OTRO, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'byok-comercio',
      keySource: 'tenant', costUsd: 0.056,
    })

    await AiPlatformUsage.updateOne(
      { period }, { $set: { estimatedCostUsd: 1 } }, { upsert: true },
    )
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 1 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })
    await AiUsage.updateOne(
      { tenantId: OTRO, period },
      { $set: { estimatedCostUsd: 0.056 }, $setOnInsert: { tenantId: OTRO, period } },
      { upsert: true },
    ).setOptions({ tenantId: OTRO })

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(true)
    expect(auditoria.findings).toHaveLength(0)

    // Y el desglose queda a la vista, que es lo que permite leer el correo.
    expect(auditoria.cost.byok).toBeCloseTo(0.056, 6)
    expect(auditoria.cost.ledgerSinByok).toBeCloseTo(1, 6)
    expect(auditoria.cost.ledger).toBeCloseTo(1.056, 6)
  })

  test('con BYOK, una deriva real del contador se ve por lo que vale', async () => {
    // Mismo escenario, pero el contador de plataforma tiene medio centavo de
    // más. La deriva que hay que informar es ESA, no la que sale de comparar
    // contra el libro entero —que sería 0.056 más grande y apuntaría al lugar
    // equivocado.
    const period = '2060-08'
    const OTRO = new mongoose.Types.ObjectId()

    await AiConsumptionLedger.create({
      tenantId: TENANT, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'deriva-plataforma',
      keySource: 'platform', costUsd: 1,
    })
    await AiConsumptionLedger.create({
      tenantId: OTRO, period, event: 'consumed', metric: AI_METRICS.AGENT_TOKENS,
      amount: 1, unit: 'tokens', operationId: 'deriva-comercio',
      keySource: 'tenant', costUsd: 0.056,
    })

    await AiPlatformUsage.updateOne(
      { period }, { $set: { estimatedCostUsd: 1.004943 } }, { upsert: true },
    )
    await AiUsage.updateOne(
      { tenantId: TENANT, period },
      { $set: { estimatedCostUsd: 1 }, $setOnInsert: { tenantId: TENANT, period } },
      { upsert: true },
    ).setOptions({ tenantId: TENANT })
    await AiUsage.updateOne(
      { tenantId: OTRO, period },
      { $set: { estimatedCostUsd: 0.056 }, $setOnInsert: { tenantId: OTRO, period } },
      { upsert: true },
    ).setOptions({ tenantId: OTRO })

    const auditoria = await auditAccounting(period)

    expect(auditoria.balanced).toBe(false)

    const contraContador = auditoria.findings.find(
      f => f.between[0] === 'ledgerSinByok' && f.between[1] === 'platformUsage',
    )
    expect(contraContador).toBeDefined()
    expect(contraContador.difference).toBeCloseTo(-0.004943, 6)

    // El libro y los comercios coinciden: no hay hallazgo entre ellos.
    expect(
      auditoria.findings.find(f => f.between[0] === 'ledger' && f.between[1] === 'tenantUsage'),
    ).toBeUndefined()
  })
})

describe('reservas colgadas · también sueltan la plata comprometida', () => {
  test('barrer una colgada devuelve el cupo Y la reserva financiera', async () => {
    // Sin esto, un proceso que muere entre reservar y responder deja plata
    // retenida contra el techo de la plataforma hasta que cambia el mes — y
    // ese techo lo comparten TODOS los comercios.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'
    const period = getCurrentPeriod()

    try {
      await AiPlatformUsage.deleteMany({ period })

      const operationId = 'colgada-con-plata'
      await reserveAiBudget({
        tenantId: TENANT, metric: AI_METRICS.AGENT_MESSAGES,
        profile: PERFIL, period, operationId,
      })

      const retenida = await AiPlatformUsage.findOne({ period }).lean()
      expect(retenida.reservedCostUsd).toBeGreaterThan(0)

      await AiOperation.updateOne(
        { tenantId: TENANT, operationId },
        { $set: { startedAt: new Date(Date.now() - 3600000) } },
      ).setOptions({ tenantId: TENANT })

      await sweepStaleOperations()
      await asentar()

      const suelta = await AiPlatformUsage.findOne({ period }).lean()
      expect(suelta.reservedCostUsd).toBe(0)
    } finally {
      delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET
    }
  })
})

// ─── La auditoria automatica ────────────────────────────────────────────────

describe('auditoria automatica · un timer largo que nunca corre no sirve', () => {
  test('hace UNA pasada al arrancar, sin esperar el intervalo', async () => {
    // MEDIDO EN LOS LOGS DE PRODUCCION, y este es el motivo del test:
    //
    // Entre las 00:46 y las 06:25 de un mismo dia hay VEINTICINCO lineas de
    // "[AI ACCOUNTING] Auditoria automatica iniciada" y CERO de "Contabilidad
    // cuadrada" o "La contabilidad NO cuadra". El servicio arranco 25 veces y
    // el tick de sesenta minutos no llego a dispararse ni una; la ventana mas
    // larga entre reinicios fue de 60 minutos justos, al borde.
    //
    // O sea: la auditoria existia, estaba encendida, tenia su prueba, y no se
    // ejecuto nunca. Es la misma leccion que ya tenia escrita el barrido de
    // reservas viejas, y aca pegaba mas fuerte porque el intervalo es cuatro
    // veces mas largo.
    const { startAccountingAudit, stopAccountingAudit } = await import(
      '../services/ai/aiAccountingService.js'
    )

    const lineas = []
    const log = {
      info: (msg, meta) => lineas.push({ nivel: 'info', msg, meta }),
      warn: (msg, meta) => lineas.push({ nivel: 'warn', msg, meta }),
      error: (msg, meta) => lineas.push({ nivel: 'error', msg, meta }),
    }

    // La pasada de arranque se adelanta para no esperarla en el test.
    process.env.AI_ACCOUNTING_AUDIT_ON_START_MS = '50'

    try {
      startAccountingAudit({ logger: log })

      const arranque = lineas.find(l => l.msg?.includes('Auditoria automatica iniciada') ||
        l.msg?.includes('Auditoría automática iniciada'))
      expect(arranque).toBeDefined()
      // El anuncio dice cuando va a correr la primera, no solo cada cuanto.
      expect(arranque.meta.primeraPasadaEnSegundos).toBeGreaterThanOrEqual(0)

      await new Promise(r => setTimeout(r, 400))
    } finally {
      stopAccountingAudit()
      delete process.env.AI_ACCOUNTING_AUDIT_ON_START_MS
    }
  })

  test('apagarla cancela TAMBIEN la pasada de arranque', async () => {
    // Sin esto, stop dejaba una auditoria pendiente que se disparaba despues
    // de haber apagado el ciclo — en un test, sobre una base ya cerrada.
    const { startAccountingAudit, stopAccountingAudit } = await import(
      '../services/ai/aiAccountingService.js'
    )

    process.env.AI_ACCOUNTING_AUDIT_ON_START_MS = '150'

    const lineas = []
    const log = {
      info: (msg) => lineas.push(msg),
      warn: (msg) => lineas.push(msg),
      error: (msg) => lineas.push(msg),
    }

    try {
      startAccountingAudit({ logger: log })
      stopAccountingAudit()

      const antes = lineas.length
      await new Promise(r => setTimeout(r, 350))

      // Pasado el plazo de arranque, no aparecio ninguna linea nueva.
      expect(lineas.length).toBe(antes)
    } finally {
      stopAccountingAudit()
      delete process.env.AI_ACCOUNTING_AUDIT_ON_START_MS
    }
  })
})

// LA DEVOLUCION TIENE QUE DEVOLVER LO QUE SE COBRO
//
// getUpfrontCostUsd llamaba a computeImageCostUsd, que resuelve el precio con
// `at = new Date()`: el precio de HOY, no el del cobro. Mientras la devolucion
// ocurre segundos despues da lo mismo, pero sweepStaleOperations barre
// operaciones colgadas mucho despues.
//
// Si el precio por imagen cambio en el medio, se devuelve de mas o de menos —
// y el libro Y el agregado guardan la reversion equivocada, coherentes entre
// si, asi que ninguna auditoria lo nota. Eso anula la garantia que el libro
// existe para dar: el precio del momento, congelado en la fila.

describe('devolución · al precio que se cobró, no al de hoy', () => {
  const PRECIO_ORIGINAL = process.env.AI_COST_USD_PER_IMAGE_EDIT

  afterEach(() => {
    if (PRECIO_ORIGINAL === undefined) delete process.env.AI_COST_USD_PER_IMAGE_EDIT
    else process.env.AI_COST_USD_PER_IMAGE_EDIT = PRECIO_ORIGINAL
  })

  const costoGuardado = async period => {
    const u = await AiUsage.findOne({ tenantId: TENANT, period })
      .setOptions({ tenantId: TENANT })
      .lean()
    return Number(u?.estimatedCostUsd || 0)
  }

  test('un cambio de precio entre el cobro y la devolución no altera el monto', async () => {
    // ESTA ES LA PROPIEDAD. Con el recálculo, el comercio recuperaba 0.05
    // habiendo pagado 0.02 — o al revés si el precio bajaba.
    const period = '2061-01'

    process.env.AI_COST_USD_PER_IMAGE_EDIT = '0.02'

    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.IMAGE_EDITS,
      profile: { ...PERFIL, plan: 'pro' }, period, operationId: 'imagen-precio',
    })
    await asentar()

    const trasCobrar = await costoGuardado(period)
    expect(trasCobrar).toBeCloseTo(0.02, 6)

    // El precio sube DESPUÉS del cobro.
    process.env.AI_COST_USD_PER_IMAGE_EDIT = '0.05'

    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.IMAGE_EDITS,
      period, operationId: 'imagen-precio',
    })
    await asentar()

    // Vuelve a cero: se devolvió lo que se cobró.
    expect(await costoGuardado(period)).toBeCloseTo(0, 6)
  })

  test('la fila de devolución guarda el monto original', async () => {
    // Si el libro guardara el recálculo, la auditoría veria dos numeros
    // coherentes entre si y ambos equivocados: el peor caso.
    const period = '2061-02'

    process.env.AI_COST_USD_PER_IMAGE_EDIT = '0.02'
    await reserveAiBudget({
      tenantId: TENANT, metric: AI_METRICS.IMAGE_EDITS,
      profile: { ...PERFIL, plan: 'pro' }, period, operationId: 'imagen-libro',
    })
    await asentar()

    process.env.AI_COST_USD_PER_IMAGE_EDIT = '0.05'
    await refundAiBudget({
      tenantId: TENANT, metric: AI_METRICS.IMAGE_EDITS,
      period, operationId: 'imagen-libro',
    })
    await asentar()

    const devolucion = await AiConsumptionLedger.findOne({
      tenantId: TENANT, period, event: 'refunded', metric: AI_METRICS.IMAGE_EDITS,
    }).lean()

    expect(Number(devolucion?.costUsd)).toBeCloseTo(0.02, 6)
  })
})

// RELLENAR EL LIBRO DESDE LAS LLAMADAS AL PROVEEDOR
//
// writeLedgerEntry escribe SIN esperar y se traga los errores que no son clave
// repetida: la contabilidad no puede ser el motivo por el que un comercio se
// quede sin IA. Pero si esa escritura falla, los contadores subieron y la fila
// no existe, y el libro —que es la fuente de verdad— queda incompleto.
//
// rebuildTenantProjection ya DETECTA el caso y se niega a corregir contadores
// con el libro incompleto. Lo que faltaba era repararlo.
//
// No hace falta una coleccion nueva: AiProviderCall se escribe CON await antes
// de tocar ningun contador y guarda todo lo necesario.

describe('relleno del libro · desde las llamadas al proveedor', () => {
  // El indice unico de AiProviderCall es (tenant, operacion, llamada) y NO
  // incluye el periodo, asi que cada caso necesita su propia operacion.
  const opDe = period => `op-perdida-${period}`

  const llamada = (period, extra = {}) => AiProviderCall.create({
    tenantId: TENANT,
    operationId: opDe(period),
    callId: 'main',
    period,
    metric: AI_METRICS.AGENT_TOKENS,
    provider: 'gemini',
    actualModel: 'gemini-3.1-flash-lite',
    inputTokens: 900,
    outputTokens: 300,
    totalTokens: 1200,
    costUsd: 0.000239,
    tenantProviderCostUsd: 0.000239,
    keySource: 'platform',
    plan: 'starter',
    ...extra,
  })

  test('detecta la fila que falta y por defecto NO escribe', async () => {
    // ESTA ES LA PROPIEDAD. Sin esto el libro queda incompleto para siempre.
    const period = '2062-01'
    await llamada(period)

    const informe = await backfillLedgerFromProviderCalls({ period })

    expect(informe.checked).toBe(1)
    expect(informe.missing).toHaveLength(1)
    expect(informe.missing[0].operationId).toBe(opDe(period))
    expect(informe.applied).toBe(false)

    const filas = await AiConsumptionLedger.countDocuments({ period })
      .setOptions({ tenantId: TENANT })
    expect(filas).toBe(0)
  })

  test('con apply la repone con el costo congelado de la llamada', async () => {
    const period = '2062-02'
    await llamada(period)

    const informe = await backfillLedgerFromProviderCalls({ period, apply: true })

    expect(informe.written).toBe(1)

    const fila = await AiConsumptionLedger.findOne({ period })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(fila.event).toBe('consumed')
    expect(fila.operationId).toBe(opDe(period))
    expect(Number(fila.costUsd)).toBeCloseTo(0.000239, 9)
    expect(fila.amount).toBe(1200)
    expect(fila.unit).toBe('tokens')
    // Congelados en la llamada, no adivinados.
    expect(fila.keySource).toBe('platform')
    expect(fila.plan).toBe('starter')
  })

  test('no duplica lo que ya está en el libro', async () => {
    const period = '2062-03'
    await llamada(period)
    await backfillLedgerFromProviderCalls({ period, apply: true })

    const segunda = await backfillLedgerFromProviderCalls({ period, apply: true })

    expect(segunda.missing).toHaveLength(0)
    expect(
      await AiConsumptionLedger.countDocuments({ period }).setOptions({ tenantId: TENANT }),
    ).toBe(1)
  })

  test('la clave compuesta de una llamada secundaria se respeta', async () => {
    // El medidor guarda `operacion:llamada` cuando no es la principal. Si el
    // reconstructor usara solo operationId, chocaria con la fila de la
    // principal y no repondria nada — o peor, duplicaria con otra clave.
    const period = '2062-04'
    await llamada(period, { callId: 'herramienta-1' })

    await backfillLedgerFromProviderCalls({ period, apply: true })

    const fila = await AiConsumptionLedger.findOne({ period })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(fila.operationId).toBe(`${opDe(period)}:herramienta-1`)
  })

  test('sin llamadas no hace nada', async () => {
    const informe = await backfillLedgerFromProviderCalls({ period: '2062-99' })

    expect(informe.checked).toBe(0)
    expect(informe.missing).toHaveLength(0)
  })
})
