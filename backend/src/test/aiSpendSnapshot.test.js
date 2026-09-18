// 📁 src/test/aiSpendSnapshot.test.js
//
// El armado completo de lo que consume la pantalla de gasto de plataforma.
//
// POR QUÉ APARECE, Y QUÉ NO CUBRÍA LA SUITE
//
// getPlatformSpendSnapshot ya se llamaba en aiReconciliation.test.js, pero con
// el período '2040-08' — uno futuro, elegido para aislar la reconciliación. Y
// dos de los bloques nuevos cortan temprano cuando el período NO es el actual:
// el pronóstico no proyecta sobre un mes cerrado y las anomalías no se calculan.
//
// O sea que el camino que recorre la pantalla de verdad —período en curso, con
// todos los bloques ejecutándose— no lo ejercitaba nadie. Esta prueba es el
// punto de ensamble de todo lo que se agregó: si algo quedó mal importado o una
// agregación revienta, acá se ve antes que en producción.
//
// Contra base real porque el snapshot son seis agregaciones cruzando comercios
// con el aislamiento salteado a propósito. Con mocks se probarían los mocks.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')
// Techos fijos para que las cuentas del test se puedan seguir a mano.
process.env.AI_PLATFORM_MONTHLY_TOKEN_BUDGET = '1000000'
process.env.AI_PLATFORM_MONTHLY_USD_BUDGET = '100'
process.env.AI_PLATFORM_PER_TENANT_SHARE = '0.5'

const { default: Tenant } = await import('../models/tenantModel.js')
const { default: AiTenantPolicy } = await import('../models/aiTenantPolicyModel.js')
const { default: AiPlatformUsage } = await import('../models/aiPlatformUsageModel.js')
const { default: AiConsumptionLedger, LEDGER_EVENT } = await import(
  '../models/aiConsumptionLedgerModel.js'
)
const { getPlatformSpendSnapshot } = await import('../services/ai/aiSpendReportService.js')
const { setTenantAiPolicy } = await import('../services/ai/platformAiSettingService.js')
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')

const PERIODO = getCurrentPeriod()

const ACTIVO = new mongoose.Types.ObjectId('64b7f00000000000000000d1')
const PAUSADO = new mongoose.Types.ObjectId('64b7f00000000000000000d2')

const AHORA = new Date()
const diaDelMes = dia =>
  new Date(Date.UTC(AHORA.getUTCFullYear(), AHORA.getUTCMonth(), dia, 10, 0, 0))

let mongod

const crearComercio = (id, name, plan = 'pro') =>
  Tenant.collection.insertOne({
    _id: id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    plan,
    status: 'active',
    subscriptionStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

const asentar = ({ tenantId, day, costUsd, tokens = 1000, model = 'gemini-3.1-flash-lite' }) =>
  AiConsumptionLedger.collection.insertOne({
    tenantId,
    period: PERIODO,
    event: LEDGER_EVENT.CONSUMED,
    metric: 'agentTokens',
    unit: 'tokens',
    amount: tokens,
    costUsd,
    tenantProviderCostUsd: costUsd,
    keySource: 'platform',
    model,
    createdAt: diaDelMes(day),
    updatedAt: diaDelMes(day),
  })

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
  await AiTenantPolicy.init()
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await Tenant.collection.deleteMany({})
  await AiTenantPolicy.collection.deleteMany({})
  await AiPlatformUsage.collection.deleteMany({})
  await AiConsumptionLedger.collection.deleteMany({})
})

describe('el snapshot del panel de gasto', () => {
  test('se arma entero sobre el período EN CURSO', async () => {
    // ESTA ES LA PRUEBA QUE FALTABA. El único llamado que existía usaba un
    // período futuro, donde el pronóstico y las anomalías no se ejecutan.
    await crearComercio(ACTIVO, 'Comercio Activo')
    await asentar({ tenantId: ACTIVO, day: 1, costUsd: 2 })
    await asentar({ tenantId: ACTIVO, day: 2, costUsd: 3 })

    await AiPlatformUsage.collection.insertOne({
      period: PERIODO,
      tokens: 2000,
      estimatedCostUsd: 5,
      reservedCostUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const snapshot = await getPlatformSpendSnapshot()

    expect(snapshot.period).toBe(PERIODO)
    // Los bloques que consume la pantalla. Que existan importa tanto como su
    // contenido: la pantalla desestructura el objeto, y un bloque ausente es un
    // undefined que revienta recién al renderizar.
    expect(snapshot.budget).toBeDefined()
    expect(snapshot.consumption).toBeDefined()
    expect(snapshot.breaker).toBeDefined()
    expect(Array.isArray(snapshot.byMetric)).toBe(true)
    expect(Array.isArray(snapshot.byModel)).toBe(true)
    expect(Array.isArray(snapshot.byTenant)).toBe(true)
    expect(Array.isArray(snapshot.anomalies)).toBe(true)
    expect(snapshot.forecast).toBeDefined()
    expect(snapshot.degradation).toBeDefined()
  })

  test('el pronóstico viene con la serie y los dos ritmos', async () => {
    await crearComercio(ACTIVO, 'Comercio Activo')
    await asentar({ tenantId: ACTIVO, day: 1, costUsd: 2 })

    await AiPlatformUsage.collection.insertOne({
      period: PERIODO,
      tokens: 1000,
      estimatedCostUsd: 2,
      reservedCostUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { forecast } = await getPlatformSpendSnapshot()

    expect(Array.isArray(forecast.daily)).toBe(true)
    expect(typeof forecast.dailyAvgUsd).toBe('number')
    expect(typeof forecast.recentAvgUsd).toBe('number')
    expect(forecast.daysInPeriod).toBeGreaterThanOrEqual(28)
    expect(forecast.recentWindowDays).toBe(7)
  })

  test('el escalón de servicio sale del MISMO porcentaje que muestra el panel', async () => {
    // Dos números que tendrían que coincidir y se calculan por caminos
    // distintos terminan no coincidiendo. Acá se verifica que el nivel se
    // deriva del peor de los dos techos, igual que el medidor.
    //
    // USD 85 de un techo de 100 son 85%: modo economía, y todavía no el
    // escalón donde se posponen funciones.
    await AiPlatformUsage.collection.insertOne({
      period: PERIODO,
      tokens: 10000,
      estimatedCostUsd: 85,
      reservedCostUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { degradation } = await getPlatformSpendSnapshot()

    expect(degradation.level).toBe('economy')
    expect(degradation.percentUsed).toBe(85)
    expect(degradation.economyAt).toBe(80)
    expect(degradation.essentialAt).toBe(90)
  })

  test('el escalón mira también el techo de TOKENS, no solo el de plata', async () => {
    // Con los dos techos puestos, mirar uno solo deja pasar el caso inverso:
    // mucho volumen y poca plata.
    await AiPlatformUsage.collection.insertOne({
      period: PERIODO,
      tokens: 950000, // 95% del techo de 1.000.000
      estimatedCostUsd: 1, // 1% del techo de USD 100
      reservedCostUsd: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { degradation } = await getPlatformSpendSnapshot()

    expect(degradation.level).toBe('essential')
    expect(degradation.percentUsed).toBe(95)
  })

  test('cada comercio viene con su política para poder gobernarlo', async () => {
    // La tabla es el lugar donde se mira Y se actúa: sin estos campos, la
    // pantalla no puede mostrar quién está acotado ni quién pausado.
    await crearComercio(ACTIVO, 'Comercio Activo')
    await asentar({ tenantId: ACTIVO, day: 1, costUsd: 2 })

    await setTenantAiPolicy({
      tenantId: String(ACTIVO),
      share: 0.1,
      changedByEmail: 'duenio@henko.com',
      reason: 'consumía de más',
    })

    const { byTenant } = await getPlatformSpendSnapshot()
    const fila = byTenant.find(t => t.tenantId === String(ACTIVO))

    expect(fila.name).toBe('Comercio Activo')
    expect(fila.share).toBe(0.1)
    expect(fila.suspended).toBe(false)
    // Y el tope mostrado es el SUYO, no el global: 1.000.000 × 0,1.
    expect(fila.tokenCap).toBe(100000)
  })

  test('un comercio pausado aparece aunque no tenga consumo', async () => {
    // Dejó de consumir, así que no tiene filas en el libro y se caería de la
    // tabla — justo el que alguien decidió vigilar, invisible en la pantalla
    // desde donde se lo tiene que poder levantar.
    await crearComercio(PAUSADO, 'Comercio Pausado')

    await setTenantAiPolicy({
      tenantId: String(PAUSADO),
      suspended: true,
      suspendedReason: 'factura impaga',
      changedByEmail: 'duenio@henko.com',
      reason: 'mora',
    })

    const { byTenant } = await getPlatformSpendSnapshot()
    const fila = byTenant.find(t => t.tenantId === String(PAUSADO))

    expect(fila).toBeDefined()
    expect(fila.name).toBe('Comercio Pausado')
    expect(fila.suspended).toBe(true)
    expect(fila.suspendedReason).toBe('factura impaga')
    expect(fila.tokens).toBe(0)
  })

  test('un mes sin nada no rompe la pantalla', async () => {
    // El caso del día 1, o el de un despliegue nuevo. Una pantalla de control
    // que revienta cuando no hay datos es peor que no tenerla: falla justo
    // cuando uno entra a ver por qué no hay datos.
    const snapshot = await getPlatformSpendSnapshot()

    expect(snapshot.byTenant).toEqual([])
    expect(snapshot.anomalies).toEqual([])
    expect(snapshot.consumption.tokens).toBe(0)
    expect(snapshot.degradation.level).toBe('normal')
    // Sin días cerrados no hay ritmo, y un pronóstico salido de cero datos
    // sería un número inventado con apariencia de medición.
    expect(snapshot.forecast.projectedUsd).toBe(null)
  })

  test('un período pasado tampoco rompe', async () => {
    // La pantalla deja elegir período. Los bloques que solo tienen sentido
    // sobre el mes en curso se apagan en vez de fallar.
    const snapshot = await getPlatformSpendSnapshot('2024-03')

    expect(snapshot.period).toBe('2024-03')
    expect(snapshot.anomalies).toEqual([])
    expect(snapshot.forecast.projectedUsd).toBe(null)
    expect(snapshot.degradation).toBeDefined()
  })
})
