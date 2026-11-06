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

import { readFileSync } from 'node:fs'

import mongoose from 'mongoose'
import { crearMongoEnMemoria, esperarA } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64url')
// El panel del comercio resuelve su clave: sin la de plataforma no habria tope que mostrar.
process.env.GEMINI_API_KEY = 'AIzaTEST'

const { default: AiOperation } = await import('../models/aiOperationModel.js')
const { default: AiProviderCall } = await import('../models/aiProviderCallModel.js')
const { default: AiConsumptionLedger } = await import('../models/aiConsumptionLedgerModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { default: AiTenantPolicy } = await import('../models/aiTenantPolicyModel.js')
const {
  reserveAiBudget,
  refundAiBudget,
  recordTokenSpend,
  recordImageProviderCall,
  AI_METRICS,
  DENY_REASONS,
  buildBudgetDenialMessage,
  checkAiEntitlement,
} = await import('../services/ai/aiBudgetService.js')
const { getAiBudgetSnapshot } = await import('../services/ai/aiBudgetService.js')
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')
const {
  getPlanCommitment,
  getPlanLimit,
  getPlatformBudgetSource,
  getPlatformMonthlyTokenBudget,
  getPlatformMonthlyUsdBudget,
  getPlatformUsdBudgetSource,
  getSharedKeyTenantUsdCap,
  getTenantPlanFraction,
  setPlatformCommitmentSnapshot,
} = await import('../services/ai/aiPlanPolicy.js')
const { invalidateTenantAiProfile, loadTenantAiProfile } =
  await import('../services/ai/aiCredentialsService.js')
const { encryptSecret } = await import('../services/aiAgent/secretCryptoService.js')
const { refreshPlatformAiSettings, setPlatformAiOverride, setTenantAiPolicy } =
  await import('../services/ai/platformAiSettingService.js')
const { PLATFORM_AI_SETTINGS } = await import('../models/platformAiSettingModel.js')
const { refreshPlatformCommitment } = await import('../services/ai/aiSpendReportService.js')
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
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
  await AiOperation.init()
  await AiProviderCall.init()
  await AiConsumptionLedger.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  delete process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET
  delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET
  // La fracción por comercio decide su techo en plata, así que un test que la
  // mueve se la dejaría puesta al siguiente.
  delete process.env.AI_PLATFORM_PER_TENANT_SHARE

  // La decisión se cachea 30 segundos por período. Sin borrarla, el segundo
  // test leería la del primero.
  await cacheDel(`ai:platform:breaker:${PERIODO_REAL}`)
  await AiPlatformUsage.deleteMany({ period: PERIODO_REAL })

  // También el contador del comercio: todos los casos comparten período y
  // tenant, así que sin esto el cupo llega acumulado del caso anterior y una
  // reserva se deniega por cuota cuando el test creía estar midiendo el techo
  // de plataforma.
  await AiUsage.deleteMany({ period: PERIODO_REAL }).setOptions({ ignoreTenant: true })

  // Lo que un caso le decidió al comercio no puede llegar al siguiente.
  await AiTenantPolicy.collection.deleteMany({})
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

const usoDelComercio = () =>
  AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
    .setOptions({ tenantId: TENANT })
    .lean()

const operacion = operationId =>
  AiOperation.findOne({ tenantId: TENANT, operationId }).setOptions({ tenantId: TENANT }).lean()

describe('una operación reabierta retiene y libera su reserva', () => {
  test('el reintento tras una devolución no deja plata retenida', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '1'

    const operationId = nuevaClave()

    await reservar(operationId)
    await refundAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      operationId,
      period: PERIODO_REAL,
    })
    await reservar(operationId)

    const reabierta = await operacion(operationId)

    expect(reabierta.status).toBe('running')
    expect(reabierta.reservedCostUsd).toBeGreaterThan(0)
    expect(reabierta.reservedTenantCostUsd).toBeGreaterThan(0)

    await recordTokenSpend({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      model: 'gemini-3.1-flash-lite',
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId,
    })

    const [comercio, plataforma] = await Promise.all([
      usoDelComercio(),
      AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
    ])

    expect(comercio.reservedCostUsd).toBe(0)
    expect(plataforma.reservedCostUsd).toBe(0)
  })

  test('el reintento en otro mes libera la reserva de ese mes', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    const operationId = nuevaClave()
    const pedir = period =>
      reserveAiBudget({
        tenantId: TENANT,
        metric: AI_METRICS.AGENT_MESSAGES,
        profile: PERFIL,
        period,
        operationId,
      })

    await pedir('2031-01')
    await refundAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      operationId,
      period: '2031-01',
    })
    await pedir('2031-02')

    expect((await operacion(operationId)).period).toBe('2031-02')
  })
})

describe('una imagen no deja plata retenida', () => {
  const imagen = operationId =>
    reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.IMAGE_EDITS,
      amount: 1,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId,
      provider: 'cloudflare',
      forcePlatformBilling: true,
    })

  test('devolver una imagen no deja reservas ni gasto', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '1'

    const operationId = nuevaClave()

    await imagen(operationId)
    await refundAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.IMAGE_EDITS,
      operationId,
      period: PERIODO_REAL,
      provider: 'cloudflare',
    })

    const [comercio, plataforma] = await Promise.all([
      usoDelComercio(),
      AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
    ])

    expect(comercio.reservedCostUsd).toBe(0)
    expect(comercio.estimatedCostUsd).toBeCloseTo(0, 10)
    expect(plataforma.reservedCostUsd).toBe(0)
    expect(plataforma.estimatedCostUsd).toBeCloseTo(0, 10)
  })

  // Optimizar el prompt son tokens de Gemini: Google los cobra aunque la imagen
  // después falle, y no son parte de la cuota de imágenes.
  test('los tokens del prompt no tocan la cuota y sobreviven a la devolución', async () => {
    const operationId = nuevaClave()

    await imagen(operationId)
    await recordTokenSpend({
      tenantId: TENANT,
      metric: AI_METRICS.IMAGE_EDITS,
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      model: 'gemini-3.1-flash-lite',
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId,
      callId: 'prompt:gemini-3.1-flash-lite',
    })

    expect((await usoDelComercio()).counters.imageEdits).toBe(1)

    await refundAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.IMAGE_EDITS,
      operationId,
      period: PERIODO_REAL,
      provider: 'cloudflare',
    })

    const devuelto = await usoDelComercio()

    expect(devuelto.counters.imageEdits).toBe(0)
    expect(devuelto.estimatedCostUsd).toBeCloseTo(0.0004, 8)
  })
})

describe('imágenes facturadas a la plataforma aunque Gemini use BYOK', () => {
  test('clasifica el pagador como plataforma y libera la reserva al liquidar', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '1'

    const operationId = nuevaClave()
    const resultado = await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.IMAGE_EDITS,
      amount: 1,
      profile: { ...PERFIL, keySource: 'tenant' },
      period: PERIODO_REAL,
      operationId,
      provider: 'cloudflare',
      forcePlatformBilling: true,
    })

    expect(resultado.allowed).toBe(true)

    const costoEsperado = 0.0006336
    const operacion = await esperarA(
      () =>
        AiOperation.findOne({ tenantId: TENANT, operationId })
          .setOptions({ tenantId: TENANT })
          .lean(),
      row => row?.status === 'completed',
    )
    const [usoTenant, usoPlataforma] = await Promise.all([
      AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
        .setOptions({ tenantId: TENANT })
        .lean(),
      AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
    ])

    expect(operacion.status).toBe('completed')
    expect(operacion.reservedCostUsd).toBe(0)
    expect(operacion.reservedTenantCostUsd).toBe(0)

    // El importe pasa a gasto liquidado y deja de figurar como reserva.
    expect(usoTenant.estimatedCostUsd).toBeCloseTo(costoEsperado, 10)
    expect(usoTenant.reservedCostUsd).toBe(0)
    expect(usoPlataforma.estimatedCostUsd).toBeCloseTo(costoEsperado, 10)
    expect(usoPlataforma.reservedCostUsd).toBe(0)

    // AiProviderCall queda como respaldo durable para reconstruir la fila
    // contable si la escritura asíncrona del ledger se pierde.
    await recordImageProviderCall({
      tenantId: TENANT,
      operationId,
      provider: 'cloudflare',
    })

    const llamadaDurable = await AiProviderCall.findOne({
      tenantId: TENANT,
      operationId,
      callId: 'main',
    })
      .setOptions({ tenantId: TENANT })
      .lean()
    expect(llamadaDurable.usageUnit).toBe('units')
    expect(llamadaDurable.unitQuantity).toBe(1)
    expect(llamadaDurable.unitLabel).toBe('image')
    expect(llamadaDurable.unitCostTotalUsd).toBeCloseTo(costoEsperado, 10)
    expect(llamadaDurable.costCurrency).toBe('USD')
    expect(llamadaDurable.tenantProviderCostCurrency).toBe('USD')
    expect(llamadaDurable.costUsd).toBeCloseTo(costoEsperado, 10)
    expect(llamadaDurable.tenantProviderCostUsd).toBeCloseTo(costoEsperado, 10)
    expect(llamadaDurable.provider).toBe('cloudflare')
    expect(llamadaDurable.actualModel).toBe('@cf/black-forest-labs/flux-1-schnell')
    expect(llamadaDurable.unitPricingSource).toBe('catalog')
    expect(llamadaDurable.unitSourceUrl).toBe(
      'https://developers.cloudflare.com/workers-ai/platform/pricing/',
    )

    // Aunque el perfil del comercio es BYOK, el gasto de esta operación lo
    // paga HENKO y debe figurar como platform en el libro.
    const fila = await esperarA(
      () =>
        AiConsumptionLedger.findOne({
          tenantId: TENANT,
          period: PERIODO_REAL,
          operationId,
          event: 'consumed',
        })
          .setOptions({ tenantId: TENANT })
          .lean(),
      row => Boolean(row),
    )
    expect(fila.keySource).toBe('platform')
    expect(fila.costUsd).toBeCloseTo(costoEsperado, 10)
    expect(fila.unit).toBe('units')
  })
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

// ─── BLOQUE 10 · cien al mismo tiempo ───────────────────────────────────────
//
// El costo real se conoce DESPUÉS de la respuesta. Entre comprobar el techo y
// ese momento hay una ventana, y con cien requests simultáneos los cien pasan
// la comprobación y los cien gastan. Un techo que se comprueba y no se reserva
// no es un techo: es una sugerencia.

describe('concurrencia · el techo se reserva, no se consulta', () => {
  const PLATA = 0.01 // lo que se compromete por operación de agentMessages

  test('cien reservas simultáneas contra un techo de USD 1', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '1'

    // Fracción completa para este comercio, porque lo que esta prueba verifica
    // es el techo GLOBAL. Con la fracción por defecto (0,5) el tope en plata
    // del comercio queda en USD 0,50 y muerde a la operación 50, así que la
    // denegación llegaría por tenant_usd_budget_exhausted y la prueba dejaría
    // de mirar lo que vino a mirar. El techo por comercio tiene su propia
    // prueba más abajo.
    process.env.AI_PLATFORM_PER_TENANT_SHARE = '1'

    const resultados = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reservar(`concurrente-${i}`)),
    )

    const permitidas = resultados.filter(r => r.allowed).length
    const denegadas = resultados.filter(r => !r.allowed)

    // USD 1 / USD 0,01 = 100 exactas. Ni una más.
    expect(permitidas).toBeLessThanOrEqual(1 / PLATA)

    const doc = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()

    // Lo comprometido no puede pasarse del techo. Sin la reserva atómica esto
    // daba 100 permitidas sin importar el techo.
    expect(doc.reservedCostUsd).toBeLessThanOrEqual(1)
    expect(doc.reservedCostUsd).toBeCloseTo(permitidas * PLATA, 6)

    if (denegadas.length > 0) {
      expect(denegadas[0].reason).toBe(DENY_REASONS.PLATFORM_BUDGET)
      expect(denegadas[0].detail).toBe('usd')
    }
  }, 60000)

  test('con techo holgado, las cien entran', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '1000'

    const resultados = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reservar(`holgadas-${i}`)),
    )

    expect(resultados.filter(r => r.allowed)).toHaveLength(100)
  }, 60000)
})

describe('liquidación · se devuelve la diferencia', () => {
  test('reservado 0,01 · real 0,0034 · queda retenido 0', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    const operationId = nuevaClave()
    const reserva = await reservar(operationId)
    expect(reserva.allowed).toBe(true)

    const conReserva = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    expect(conReserva.reservedCostUsd).toBeCloseTo(0.01, 6)
    // Todavía no se gastó nada: la auditoría contable compara este número
    // contra el libro y no puede incluir plata comprometida.
    expect(conReserva.estimatedCostUsd || 0).toBe(0)

    await recordTokenSpend({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_TOKENS,
      model: 'gemini-3.1-flash-lite',
      inputTokens: 2000,
      outputTokens: 500,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId,
    })
    // Se sondea la liquidación en vez de dormir 300 ms a ojo: termina apenas
    // ocurre, y si la máquina está lenta aguanta en lugar de fallar sin que
    // nada esté roto.
    const liquidado = await esperarA(
      () => AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
      doc => doc?.reservedCostUsd === 0,
    )

    // La retención vuelve a cero y queda SOLO el gasto real.
    expect(liquidado.reservedCostUsd).toBe(0)
    expect(liquidado.estimatedCostUsd).toBeGreaterThan(0)
    expect(liquidado.estimatedCostUsd).toBeLessThan(0.01)
  })

  test('una reserva denegada por cuota del comercio no retiene plata', async () => {
    // Sin esto, un comercio sin cupo le comería el techo a la plataforma con
    // cada intento fallido.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      limitOverride: 1,
    })
    const denegada = await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      limitOverride: 1,
    })

    expect(denegada.allowed).toBe(false)

    const doc = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    // Solo la que sí reservó retiene.
    expect(doc.reservedCostUsd).toBeCloseTo(0.01, 6)
  })

  test('devolver la operación suelta lo comprometido', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '10'

    const operationId = nuevaClave()
    await reservar(operationId)

    await refundAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      period: PERIODO_REAL,
      operationId,
    })
    const doc = await esperarA(
      () => AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean(),
      d => d?.reservedCostUsd === 0,
    )
    expect(doc.reservedCostUsd).toBe(0)
  })

  test('sin techo en dólares no se reserva nada, y no cuesta nada', async () => {
    // El comportamiento de hoy: sin AI_PLATFORM_MONTHLY_USD_BUDGET no hay
    // reserva financiera, así que tampoco hay escritura de más por operación.
    const resultado = await reservar(nuevaClave())

    expect(resultado.allowed).toBe(true)

    const doc = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    expect(doc?.reservedCostUsd || 0).toBe(0)
  })
})

// EL TECHO EN PLATA DE UN COMERCIO.
//
// POR QUE NO ALCANZABA EL DE TOKENS
//
// Lo dice el catalogo de precios: entre un modelo y otro de la cadena hay 5x de
// diferencia de tarifa, asi que el mismo tope de tokens puede costar veinte
// dolares o cien segun quien conteste — y eso lo decide la cadena de respaldo,
// no una politica. El techo en plata existia SOLO a nivel plataforma, o sea que
// cuando UN comercio se desbocaba el disyuntor cortaba para TODOS: el control
// existia, pero en la unidad equivocada y repartiendo el dano entre comercios
// que no habian hecho nada.
describe('techo en plata por comercio', () => {
  const PLATA = 0.01 // lo que se compromete por operacion de agentMessages

  const acotarEnPlata = usdCap =>
    setTenantAiPolicy({
      tenantId: TENANT,
      usdCap,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

  test('corta a este comercio y no a la plataforma entera', async () => {
    // Techo global holgado, tope del comercio chico: lo que tiene que morder es el
    // del comercio, no el global.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '2'
    await acotarEnPlata(0.1)

    const resultados = await Promise.all(
      Array.from({ length: 30 }, (_, i) => reservar(`plata-tenant-${i}`)),
    )

    const permitidas = resultados.filter(r => r.allowed).length
    const denegadas = resultados.filter(r => !r.allowed)

    // USD 0,10 / USD 0,01 = 10 exactas.
    expect(permitidas).toBeLessThanOrEqual(10)
    expect(denegadas.length).toBeGreaterThan(0)

    // El motivo distingue quien se quedo sin plata. Si dijera
    // platform_budget_exhausted, quien mire el log concluiria que hay que subir
    // el techo global cuando el problema es un solo comercio.
    expect(denegadas[0].reason).toBe(DENY_REASONS.TENANT_USD_BUDGET)

    // Y la plataforma sigue con plata: el daño no se reparte.
    const plataforma = await AiPlatformUsage.findOne({ period: PERIODO_REAL }).lean()
    expect(plataforma.reservedCostUsd).toBeLessThan(2)
  }, 60000)

  test('lo comprometido del comercio no se pasa de su techo', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '2'
    await acotarEnPlata(0.1)

    await Promise.all(Array.from({ length: 30 }, (_, i) => reservar(`plata-tope-${i}`)))

    const usage = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Sin la reserva atomica esto daba 30 permitidas sin importar el techo: el
    // costo real recien se conoce despues de la respuesta, asi que
    // comprobar-y-despues-gastar deja pasar las treinta.
    expect(usage.reservedCostUsd).toBeLessThanOrEqual(0.1 + 1e-9)
  }, 60000)

  test('sin acotar, el comercio entra igual que antes', async () => {
    // La regresion que importa: el tope nuevo no puede apretar a quien ya
    // funcionaba. Diez operaciones son USD 0,10, lejos de lo que cuesta su plan.
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    const resultados = await Promise.all(
      Array.from({ length: 10 }, (_, i) => reservar(`plata-holgado-${i}`)),
    )

    expect(resultados.every(r => r.allowed)).toBe(true)
  }, 60000)

  test('una denegacion no se come la plata del comercio', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '2'
    await acotarEnPlata(0.1)

    // Se llena el techo del comercio y despues se insiste.
    await Promise.all(Array.from({ length: 10 }, (_, i) => reservar(`plata-llena-${i}`)))

    const antes = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    await Promise.all(Array.from({ length: 5 }, (_, i) => reservar(`plata-insiste-${i}`)))

    const despues = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Los intentos denegados no comprometen nada: si sumaran, un comercio
    // trabado se quedaria trabado hasta fin de mes a fuerza de reintentos.
    expect(despues.reservedCostUsd).toBeCloseTo(antes.reservedCostUsd, 6)
  }, 60000)
})

// El tope en dolares puesto a mano sobre UN comercio.
//
// La fraccion acota cantidades y tiene piso de 1%, asi que no sirve para decir
// "este comercio no me puede costar mas de veinte dolares este mes". Para eso esta
// el usdCap, que manda mientras no supere lo que cuesta su plan.
describe('tope en dolares puesto a mano', () => {
  test('el usdCap le gana a la fraccion', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'

    await setTenantAiPolicy({
      tenantId: TENANT,
      usdCap: 0.05,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

    const resultados = await Promise.all(
      Array.from({ length: 30 }, (_, i) => reservar(`usdcap-${i}`)),
    )

    const permitidas = resultados.filter(r => r.allowed).length

    // USD 0,05 / USD 0,01 = 5 exactas, aunque su plan cueste mucho mas.
    expect(permitidas).toBeLessThanOrEqual(5)
    expect(resultados.some(r => r.reason === DENY_REASONS.TENANT_USD_BUDGET)).toBe(true)
  }, 60000)
})

// Sin techo global, la plata del comercio igual se libera.
//
// EL DEFECTO
//
// Los dos techos son independientes. getPlatformMonthlyUsdBudget devuelve
// UNLIMITED cuando no hay override ni variable de entorno —el estado POR
// DEFECTO—, asi que la reserva de plataforma es cero. Pero un comercio con
// usdCap puesto a mano SI compromete plata: la guarda del override corre antes
// de mirar el techo global.
//
// liquidarReserva liberaba la del comercio por el monto de la de plataforma, o
// sea cero. Cada operacion dejaba su estimado comprometido para siempre: el
// contador del comercio crecia hasta tocar su techo y despues se le denegaba
// todo por el resto del mes habiendo gastado casi nada. Justo a los comercios
// que alguien decidio acotar, en silencio, y al principio pareciendo que el
// techo funcionaba.
describe('liberacion sin techo global', () => {
  test('la plata comprometida del comercio vuelve al liquidar', async () => {
    const { setTenantAiPolicy } = await import('../services/ai/platformAiSettingService.js')
    const { recordAiConsumption } = await import('../services/ai/aiBudgetService.js')

    // El estado por defecto: SIN techo global en dolares.
    delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET

    await setTenantAiPolicy({
      tenantId: TENANT,
      usdCap: 1,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

    const permiso = await reservar('liberacion-sin-global')
    expect(permiso.allowed).toBe(true)

    const durante = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Mientras corre, hay plata comprometida.
    expect(durante.reservedCostUsd).toBeGreaterThan(0)

    await recordAiConsumption({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      amount: 1,
      profile: PERFIL,
      operationId: 'liberacion-sin-global',
      period: PERIODO_REAL,
      costUsd: 0.001,
    }).catch(() => null)

    const despues = await AiUsage.findOne({ tenantId: TENANT, period: PERIODO_REAL })
      .setOptions({ tenantId: TENANT })
      .lean()

    // Y al liquidar vuelve. Sin esto el comercio se bloqueaba solo.
    expect(despues.reservedCostUsd).toBe(0)
  }, 60000)
})

// Cada comercio tiene por defecto lo que compró, y gobernarlo solo lo baja.
//
// ANTES LA FRACCION NO HACIA NADA.
//
// Solo se aplicaba a planes ilimitados, y desde que se sacaron free y enterprise no
// queda ninguno. El panel decia "1% del techo = 2.000.000 tokens para este comercio" y
// el medidor seguia aplicando los 10.000.000 del plan. Los tests no lo veian porque
// usaban un plan ilimitado inventado.
describe('el cupo de cada comercio sale de su plan', () => {
  const reservarTokens = (plan, amount = 1000, extra = {}) =>
    reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_TOKENS,
      amount,
      profile: { ...PERFIL, plan },
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      ...extra,
    })

  const acotar = (cambios, tenantId = TENANT) =>
    setTenantAiPolicy({
      tenantId,
      ...cambios,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

  test.each(['starter', 'pro'])('sin tocar nada, %s tiene el plan entero', async plan => {
    const resultado = await reservarTokens(plan)

    expect(resultado.allowed).toBe(true)
    expect(resultado.limit).toBe(getPlanLimit(plan, AI_METRICS.AGENT_TOKENS))
  })

  test('el freno de la plataforma no cambia el cupo de nadie', async () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '400000'

    expect((await reservarTokens('pro')).limit).toBe(48_750_000)
  })

  test('gobernarlo le baja el cupo de verdad', async () => {
    // ESTA ES LA PROPIEDAD. Con el 1% seguia con el plan entero.
    await acotar({ share: 0.01 })

    expect((await reservarTokens('starter')).limit).toBe(300_000)
  })

  test('y deja de entrar lo que supera ese cupo', async () => {
    await acotar({ share: 0.01 })

    const resultado = await reservarTokens('starter', 400_000)

    expect(resultado.allowed).toBe(false)
    expect(resultado.limit).toBe(300_000)
  })

  test('baja todas las metricas, no solo los tokens', async () => {
    await acotar({ share: 0.5 })

    const mensajes = await reserveAiBudget({
      tenantId: TENANT,
      metric: AI_METRICS.AGENT_MESSAGES,
      profile: PERFIL,
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      guards: [AI_METRICS.AGENT_TOKENS],
    })

    expect(mensajes.limit).toBe(2000)
  })

  test('un comercio con clave propia no se ve afectado', async () => {
    await acotar({ share: 0.01 })

    const resultado = await reservarTokens('starter', 1000, {
      profile: { ...PERFIL, keySource: 'tenant' },
    })

    expect(resultado.allowed).toBe(true)
    expect(resultado.byok).toBe(true)
  })

  test.each([
    [null, 1],
    [0.25, 0.25],
    // Gobernar solo baja: lo que llegue de mas no le da mas que su plan.
    [5, 1],
    [0, 0.01],
  ])('la parte del plan de %s es %s', (share, esperada) => {
    expect(getTenantPlanFraction(share)).toBe(esperada)
  })

  test('acotar a uno no toca a los demas', async () => {
    await acotar({ share: 0.01 }, '64b7f0000000000000000002')

    expect((await reservarTokens('starter')).limit).toBe(30_000_000)
  })

  test('volver a null le devuelve el plan entero', async () => {
    await acotar({ share: 0.01 })
    await acotar({ share: null })

    expect((await reservarTokens('starter')).limit).toBe(30_000_000)
  })

  test('el panel del comercio muestra lo que se le aplica y lo que compro', async () => {
    // Un comercio propio: el perfil se cachea por id y otro caso ya dejo el de TENANT.
    const ACOTADO = '64b7f00000000000000000b2'

    await mongoose.connection.collection('tenants').insertOne({
      _id: new mongoose.Types.ObjectId(ACOTADO),
      name: 'Comercio acotado',
      slug: 'comercio-acotado',
      plan: 'starter',
      status: 'active',
      subscriptionStatus: 'active',
    })
    await acotar({ share: 0.5 }, ACOTADO)

    const { credits, metrics } = await getAiBudgetSnapshot(ACOTADO)

    expect(credits).toMatchObject({ limit: 2000, contracted: 4000, used: 0, remaining: 2000 })
    expect(metrics[AI_METRICS.AGENT_TOKENS].limit).toBe(15_000_000)
  })

  describe('en dolares', () => {
    const ACOTADO = { plan: 'starter', share: 0.5 }

    beforeEach(() => {
      process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '270'
    })

    test('depende del plan, y no del freno de la plataforma', () => {
      const starter = getSharedKeyTenantUsdCap({ plan: 'starter' })
      const pro = getSharedKeyTenantUsdCap({ plan: 'pro' })

      expect(starter).toBe(getPlanCommitment('starter').usd)
      expect(pro).toBeGreaterThan(starter * 1.5)

      process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '5000'
      expect(getSharedKeyTenantUsdCap({ plan: 'starter' })).toBe(starter)
    })

    test('gobernarlo lo baja en la misma proporcion', () => {
      expect(getSharedKeyTenantUsdCap(ACOTADO)).toBe(getPlanCommitment('starter').usd * 0.5)
    })

    test('un numero a mano baja el tope, pero no lo sube', () => {
      const delPlan = getPlanCommitment('starter').usd

      expect(getSharedKeyTenantUsdCap({ plan: 'starter', usdCap: 5 })).toBe(5)
      expect(getSharedKeyTenantUsdCap({ plan: 'starter', usdCap: delPlan * 10 })).toBe(delPlan)
    })

    test('sin freno en dolares no se mide plata, salvo a quien se la acoto', () => {
      delete process.env.AI_PLATFORM_MONTHLY_USD_BUDGET

      expect(getSharedKeyTenantUsdCap({ plan: 'starter' })).toBe(0)
      expect(getSharedKeyTenantUsdCap({ plan: 'starter', usdCap: 5 })).toBe(5)
    })

    test('un comercio que ya no existe no tiene tope', () => {
      expect(getSharedKeyTenantUsdCap({ plan: null })).toBe(0)
    })
  })

  describe('lo que compromete un plan', () => {
    test('toma el peor destino de la bolsa, sin sumar lo que no puede pasar junto', () => {
      // La bolsa entera en mensajes, que es lo que mas tokens gasta por credito.
      expect(getPlanCommitment('starter').tokens).toBe(30_000_000)
      expect(getPlanCommitment('pro').tokens).toBe(48_750_000)
    })

    test('el tope en dolares queda por debajo de lo que deja cada plan', () => {
      // ESTA ES LA PROPIEDAD. Neto de IVA y unos 6% de comision, al A3500 de $1.545,50:
      // ningun comercio puede costar mas de lo que deja, sin importar cuantos haya.
      expect(getPlanCommitment('starter').usd).toBe(16)
      expect(getPlanCommitment('pro').usd).toBe(26)
      expect(getPlanCommitment('starter').usd).toBeLessThan(24.8)
      expect(getPlanCommitment('pro').usd).toBeLessThan(32.2)
    })

    test('un plan forzado a ilimitado no promete un maximo', () => {
      process.env.AI_LIMIT_STARTER_VISION = '0'

      try {
        expect(getPlanCommitment('starter').unbounded).toBe(true)
      } finally {
        delete process.env.AI_LIMIT_STARTER_VISION
      }
    })
  })
})

// Una sola bolsa por comercio: cada accion descuenta de la misma.
describe('la bolsa de creditos', () => {
  // Un comercio por caso: el perfil y el contador no se contaminan entre si.
  let numero = 0
  const comercio = () => `64b7f00000000000000001${String(++numero).padStart(2, '0')}`

  const reservarAccion = (tenantId, metric, extra = {}) =>
    reserveAiBudget({
      tenantId,
      metric,
      profile: { ...PERFIL, tenantId },
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      ...extra,
    })

  const gastado = (tenantId, counters) =>
    AiUsage.collection.updateOne(
      { tenantId: new mongoose.Types.ObjectId(tenantId), period: PERIODO_REAL },
      { $set: Object.fromEntries(Object.entries(counters).map(([k, v]) => [`counters.${k}`, v])) },
      { upsert: true },
    )

  test('gastar en una funcion achica lo disponible en las otras', async () => {
    // ESTA ES LA PROPIEDAD. Con cupos separados esto entraba: 2.000 mensajes no le
    // quitaban nada a los analisis de mercado.
    const tenantId = comercio()

    await gastado(tenantId, { agentMessages: 3980 })

    const mercado = await reservarAccion(tenantId, AI_METRICS.MARKET_ANALYSES)

    expect(mercado.allowed).toBe(false)
    expect(mercado.reason).toBe(DENY_REASONS.CREDITS)
    expect(mercado.used).toBe(3980)
    expect(mercado.limit).toBe(4000)
  })

  test('lo que queda se puede usar en otra cosa mas barata', async () => {
    const tenantId = comercio()

    await gastado(tenantId, { agentMessages: 3980 })

    expect((await reservarAccion(tenantId, AI_METRICS.VISION)).allowed).toBe(true)
  })

  test('alcanza exactamente hasta el ultimo credito', async () => {
    const tenantId = comercio()

    await gastado(tenantId, { agentMessages: 3975 })

    expect((await reservarAccion(tenantId, AI_METRICS.MARKET_ANALYSES)).allowed).toBe(true)
    expect((await reservarAccion(tenantId, AI_METRICS.AGENT_MESSAGES)).reason).toBe(
      DENY_REASONS.CREDITS,
    )
  })

  test('el mensaje que ve el comercio habla de creditos', () => {
    expect(buildBudgetDenialMessage({ reason: DENY_REASONS.CREDITS })).toMatch(/créditos de IA/)
  })

  test('dos pedidos simultaneos no gastan el mismo credito', async () => {
    // La condicion vive en el filtro: no hay lectura previa que se pueda vencer.
    const tenantId = comercio()

    await gastado(tenantId, { agentMessages: 3990 })

    const resultados = await Promise.all(
      Array.from({ length: 30 }, () => reservarAccion(tenantId, AI_METRICS.AGENT_MESSAGES)),
    )

    expect(resultados.filter(r => r.allowed)).toHaveLength(10)
  }, 60000)

  test('devolver una operacion devuelve sus creditos', async () => {
    const tenantId = comercio()

    await gastado(tenantId, { agentMessages: 3980 })

    const vision = await reservarAccion(tenantId, AI_METRICS.VISION)

    await refundAiBudget({
      tenantId,
      metric: AI_METRICS.VISION,
      operationId: vision.operationId,
    })

    const usage = await AiUsage.findOne({ tenantId, period: PERIODO_REAL })
      .setOptions({ tenantId })
      .lean()

    expect(usage.counters.vision).toBe(0)
    expect((await reservarAccion(tenantId, AI_METRICS.VISION)).allowed).toBe(true)
  })

  test('gobernarlo achica la bolsa', async () => {
    const tenantId = comercio()

    await setTenantAiPolicy({
      tenantId,
      share: 0.5,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })
    await gastado(tenantId, { agentMessages: 2000 })

    expect((await reservarAccion(tenantId, AI_METRICS.VISION)).reason).toBe(DENY_REASONS.CREDITS)
  })

  test('el chequeo previo corta igual que la reserva', async () => {
    const tenantId = comercio()

    await gastado(tenantId, { agentMessages: 3980 })

    const resultado = await checkAiEntitlement({
      tenantId,
      metric: AI_METRICS.MARKET_ANALYSES,
      profile: { ...PERFIL, tenantId },
    })

    expect(resultado.allowed).toBe(false)
    expect(resultado.reason).toBe(DENY_REASONS.CREDITS)
  })

  test('el panel muestra lo que queda de verdad en cada funcion', async () => {
    const tenantId = comercio()

    await mongoose.connection.collection('tenants').insertOne({
      _id: new mongoose.Types.ObjectId(tenantId),
      name: 'Comercio con bolsa',
      slug: `comercio-bolsa-${tenantId}`,
      plan: 'starter',
      status: 'active',
      subscriptionStatus: 'active',
    })
    await gastado(tenantId, { agentMessages: 1000, vision: 100 })

    const { credits, metrics } = await getAiBudgetSnapshot(tenantId)

    expect(credits).toMatchObject({ used: 1300, limit: 4000, remaining: 2700 })
    // 2.700 creditos entran en 2.700 mensajes mas, o en 108 analisis de mercado.
    expect(metrics[AI_METRICS.AGENT_MESSAGES]).toMatchObject({ used: 1000, limit: 3700 })
    expect(metrics[AI_METRICS.MARKET_ANALYSES]).toMatchObject({ used: 0, limit: 108 })
    expect(metrics[AI_METRICS.VISION].creditCost).toBe(3)
  })
})

// Primero lo que el comercio pago con su plan, despues su clave.
describe('cuando se terminan los creditos', () => {
  const CLAVE = 'AIzaDELCOMERCIO'
  let numero = 0

  const comercio = async ({ conClave = true, plan = 'starter' } = {}) => {
    const tenantId = `64b7f00000000000000002${String(++numero).padStart(2, '0')}`

    await mongoose.connection.collection('tenants').insertOne({
      _id: new mongoose.Types.ObjectId(tenantId),
      name: `Comercio ${tenantId}`,
      slug: `comercio-${tenantId}`,
      plan,
      status: 'active',
      subscriptionStatus: 'active',
      ai: conClave ? { byokEnabled: true, geminiApiKey: encryptSecret(CLAVE) } : {},
    })

    return tenantId
  }

  const consumo = async (tenantId, campos) => {
    await AiUsage.collection.updateOne(
      { tenantId: new mongoose.Types.ObjectId(tenantId), period: PERIODO_REAL },
      { $set: campos },
      { upsert: true },
    )
    await invalidateTenantAiProfile(tenantId)
  }

  const agotar = tenantId => consumo(tenantId, { 'counters.agentMessages': 4000 })

  const perfil = tenantId => loadTenantAiProfile(tenantId)

  const reservar = async (tenantId, metric, extra = {}) =>
    reserveAiBudget({
      tenantId,
      metric,
      profile: await perfil(tenantId),
      period: PERIODO_REAL,
      operationId: nuevaClave(),
      ...extra,
    })

  test('con creditos disponibles, paga HENKO aunque tenga clave guardada', async () => {
    // ESTA ES LA PROPIEDAD. Si la clave mandara desde el principio, el comercio pagaria
    // dos veces: el plan y su cuenta de Google.
    const tenantId = await comercio()

    await consumo(tenantId, { 'counters.agentMessages': 100 })

    expect((await perfil(tenantId)).keySource).toBe('platform')
  })

  test('sin creditos entra su clave, tambien en Starter', async () => {
    const tenantId = await comercio()

    await agotar(tenantId)

    expect(await perfil(tenantId)).toMatchObject({ keySource: 'tenant', apiKey: CLAVE })
  })

  test('puede seguir con mensajes y analisis, sin pasar por la bolsa', async () => {
    const tenantId = await comercio()

    await agotar(tenantId)

    const mensaje = await reservar(tenantId, AI_METRICS.AGENT_MESSAGES)
    const vision = await reservar(tenantId, AI_METRICS.VISION)

    expect(mensaje).toMatchObject({ allowed: true, byok: true })
    expect(vision).toMatchObject({ allowed: true, byok: true })
  })

  test('los fondos siguen cortados: esos los paga HENKO a otro proveedor', async () => {
    const tenantId = await comercio()

    await agotar(tenantId)

    const fondo = await reservar(tenantId, AI_METRICS.IMAGE_EDITS, { forcePlatformBilling: true })

    expect(fondo.allowed).toBe(false)
    expect(fondo.reason).toBe(DENY_REASONS.CREDITS)
  })

  test('el analisis de mercado no sale gratis con la clave del comercio', async () => {
    // Las busquedas de Tavily las paga HENKO: una clave de Google no las cubre.
    const tenantId = await comercio()

    await agotar(tenantId)

    const analisis = await reservar(tenantId, AI_METRICS.MARKET_ANALYSES, {
      forcePlatformBilling: true,
    })

    expect(analisis.reason).toBe(DENY_REASONS.CREDITS)

    const fuente = readFileSync(
      new URL('../services/marketIntelligence/marketIntelligenceService.js', import.meta.url),
      'utf8',
    )

    expect(fuente).toMatch(
      /feature: AI_FEATURES\.MARKET_INTELLIGENCE[\s\S]*?forcePlatformBilling: true/,
    )
  })

  test('sin clave guardada, la IA espera a la renovacion', async () => {
    const tenantId = await comercio({ conClave: false })

    await agotar(tenantId)

    expect((await perfil(tenantId)).keySource).toBe('platform')
    expect((await reservar(tenantId, AI_METRICS.AGENT_MESSAGES)).reason).toBe(DENY_REASONS.CREDITS)
  })

  test('tambien entra si no alcanza para un analisis, aunque queden creditos', async () => {
    const tenantId = await comercio()

    await consumo(tenantId, { 'counters.agentMessages': 3998 })

    expect((await perfil(tenantId)).keySource).toBe('tenant')
  })

  test('tambien entra si llego a su tope en dolares', async () => {
    process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '500'

    const tenantId = await comercio()

    await consumo(tenantId, { estimatedCostUsd: 16, 'counters.agentMessages': 10 })

    expect((await perfil(tenantId)).keySource).toBe('tenant')
  })

  test('gobernarlo adelanta el momento en que entra la clave', async () => {
    const tenantId = await comercio()

    await setTenantAiPolicy({
      tenantId,
      share: 0.5,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })
    await consumo(tenantId, { 'counters.agentMessages': 2000 })

    expect((await perfil(tenantId)).keySource).toBe('tenant')
  })

  test('el rechazo destraba la clave sin esperar el minuto del cache', async () => {
    const tenantId = await comercio()

    await consumo(tenantId, { 'counters.agentMessages': 100 })
    expect((await perfil(tenantId)).keySource).toBe('platform')

    // El contador llega a la bolsa con el perfil de plataforma todavia en cache.
    await AiUsage.collection.updateOne(
      { tenantId: new mongoose.Types.ObjectId(tenantId), period: PERIODO_REAL },
      { $set: { 'counters.agentMessages': 4000 } },
    )

    expect((await reservar(tenantId, AI_METRICS.AGENT_MESSAGES)).reason).toBe(DENY_REASONS.CREDITS)
    expect((await perfil(tenantId)).keySource).toBe('tenant')
  })

  test('el mes siguiente vuelven los creditos y deja de usarse la clave', async () => {
    const tenantId = await comercio()

    await AiUsage.collection.insertOne({
      tenantId: new mongoose.Types.ObjectId(tenantId),
      period: '2020-01',
      counters: { agentMessages: 4000 },
    })
    await invalidateTenantAiProfile(tenantId)

    expect((await perfil(tenantId)).keySource).toBe('platform')
  })

  test('si no se puede saber, no se le factura al comercio', async () => {
    const tenantId = await comercio()
    const original = AiUsage.findOne

    AiUsage.findOne = () => {
      throw new Error('sin conexion')
    }

    try {
      await invalidateTenantAiProfile(tenantId)
      expect((await perfil(tenantId)).keySource).toBe('platform')
    } finally {
      AiUsage.findOne = original
      await invalidateTenantAiProfile(tenantId)
    }
  })
})

describe('el freno automatico', () => {
  const COMPROMETIDO = { tokens: 100_000_000, usd: 1000 }

  afterEach(async () => {
    setPlatformCommitmentSnapshot(null)
    await mongoose.connection.collection('tenants').deleteMany({})
    await mongoose.connection.collection('platformaisettings').deleteMany({})
    await refreshPlatformAiSettings()
    delete process.env.AI_BRAKE_MARGIN
  })

  const maximo = async (setting, value) => {
    await setPlatformAiOverride({
      setting,
      value,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })
    await refreshPlatformAiSettings()
  }

  test('es lo comprometido por planes mas un margen', () => {
    setPlatformCommitmentSnapshot(COMPROMETIDO)

    expect(getPlatformMonthlyTokenBudget()).toBe(125_000_000)
    expect(getPlatformMonthlyUsdBudget()).toBe(1250)
    expect(getPlatformBudgetSource()).toBe('auto')
    expect(getPlatformUsdBudgetSource()).toBe('auto')
  })

  test('el valor de Render ya no corta cuando hay una suma', () => {
    // ESTA ES LA PROPIEDAD. Un numero fijo cortaba a todos con cada venta nueva.
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000'
    setPlatformCommitmentSnapshot(COMPROMETIDO)

    expect(getPlatformMonthlyTokenBudget()).toBe(125_000_000)
  })

  test('crece solo con cada comercio nuevo', async () => {
    await mongoose.connection.collection('tenants').insertMany(
      ['01', '02'].map(n => ({
        _id: new mongoose.Types.ObjectId(`64b7f00000000000000003${n}`),
        name: `Comercio ${n}`,
        slug: `comercio-freno-${n}`,
        plan: 'starter',
        status: 'active',
        subscriptionStatus: 'active',
      })),
    )

    await refreshPlatformCommitment()

    expect(getPlatformMonthlyTokenBudget()).toBe(75_000_000)
  })

  test('el maximo del panel solo puede bajarlo', async () => {
    setPlatformCommitmentSnapshot(COMPROMETIDO)

    await maximo(PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET, 50_000_000)
    expect(getPlatformMonthlyTokenBudget()).toBe(50_000_000)
    expect(getPlatformBudgetSource()).toBe('panel')

    await maximo(PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET, 900_000_000)
    expect(getPlatformMonthlyTokenBudget()).toBe(125_000_000)
    expect(getPlatformBudgetSource()).toBe('auto')
  })

  test('cero en el panel sigue siendo apagar la IA', async () => {
    setPlatformCommitmentSnapshot(COMPROMETIDO)

    await maximo(PLATFORM_AI_SETTINGS.MONTHLY_USD_BUDGET, 0)

    expect(getPlatformMonthlyUsdBudget()).toBe(0)
  })

  test('sin suma todavia, sigue el valor configurado', () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '200000000'

    expect(getPlatformMonthlyTokenBudget()).toBe(200_000_000)
  })

  test('sin comercios no apaga la IA del primero que llegue', () => {
    process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '200000000'
    setPlatformCommitmentSnapshot({ tokens: 0, usd: 0 })

    expect(getPlatformMonthlyTokenBudget()).toBe(200_000_000)
  })

  test('si la suma falla, se queda con lo ultimo que supo', async () => {
    setPlatformCommitmentSnapshot(COMPROMETIDO)

    const { default: Tenant } = await import('../models/tenantModel.js')
    const original = Tenant.find

    Tenant.find = () => {
      throw new Error('sin conexion')
    }

    try {
      await refreshPlatformCommitment()
    } finally {
      Tenant.find = original
    }

    expect(getPlatformMonthlyTokenBudget()).toBe(125_000_000)
  })

  test('el margen se puede mover por entorno, pero nunca por debajo de lo vendido', () => {
    setPlatformCommitmentSnapshot(COMPROMETIDO)

    process.env.AI_BRAKE_MARGIN = '1.5'
    expect(getPlatformMonthlyTokenBudget()).toBe(150_000_000)

    process.env.AI_BRAKE_MARGIN = '0.5'
    expect(getPlatformMonthlyTokenBudget()).toBe(100_000_000)
  })
})
