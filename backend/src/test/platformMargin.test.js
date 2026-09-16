// 📁 src/test/platformMargin.test.js
//
// El margen por comercio: lo que paga menos lo que cuesta.
//
// POR QUÉ APARECE AHORA
//
// Este reporte existía sin ninguna prueba, y se le cambió la FUENTE del costo
// de IA: leía AiUsage.estimatedCostUsd —una proyección que otro proceso
// reconstruye cada hora desde el libro— y ahora lee el libro directamente.
//
// Un margen calculado contra un número que un proceso de fondo corrige cambia
// solo, sin que pase nada en el negocio, y hace que dos pantallas del mismo
// panel den cifras distintas para el mismo comercio. Esa es la propiedad que
// estas pruebas fijan, junto con las dos que hacían falta para poder actuar:
// el margen en PORCENTAJE y la marca de quién no es rentable.
//
// Contra base real porque todo el reporte son agregaciones cruzando comercios
// con el plugin de aislamiento salteado a propósito.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')
// Precios y cambio fijos: sin esto las cuentas esperadas dependerían del
// entorno y el test diría cosas distintas en cada máquina.
process.env.PLAN_PRICE_ARS_STARTER = '10000'
process.env.PLAN_PRICE_ARS_PRO = '40000'
process.env.USD_ARS_RATE = '1000'
// Los costos fijos de plataforma se restan una sola vez del total. En cero para
// que el total del test sea la suma de los márgenes y nada más.
process.env.PLATFORM_INFRA_MONTHLY_COST_USD = '0'
process.env.PLATFORM_STORAGE_MONTHLY_COST_USD = '0'

const { default: Tenant } = await import('../models/tenantModel.js')
const { default: AiConsumptionLedger, LEDGER_EVENT } = await import(
  '../models/aiConsumptionLedgerModel.js'
)
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { getPlatformMarginReport } = await import(
  '../services/platform/platformMarginService.js'
)
const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')

const PERIODO = getCurrentPeriod()

const RENTABLE = new mongoose.Types.ObjectId('64b7f00000000000000000c1')
const CARO = new mongoose.Types.ObjectId('64b7f00000000000000000c2')

let mongod

const crearComercio = (id, { name, plan }) =>
  Tenant.collection.insertOne({
    _id: id,
    name,
    // El slug es único en la colección: sin él, dos comercios del mismo test
    // chocan por `slug: null` y el fallo no dice nada del margen.
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    plan,
    status: 'active',
    subscriptionStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

const asentar = ({ tenantId, costUsd, tenantProviderCostUsd = null, keySource = 'platform' }) =>
  AiConsumptionLedger.collection.insertOne({
    tenantId,
    period: PERIODO,
    event: LEDGER_EVENT.CONSUMED,
    metric: 'agentTokens',
    unit: 'tokens',
    amount: 1000,
    costUsd,
    ...(tenantProviderCostUsd === null ? {} : { tenantProviderCostUsd }),
    keySource,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})

beforeEach(async () => {
  await Tenant.collection.deleteMany({})
  await AiConsumptionLedger.collection.deleteMany({})
  await AiUsage.collection.deleteMany({})
})

describe('de dónde sale el costo de IA', () => {
  test('sale del LIBRO y no del contador agregado', async () => {
    // ESTA ES LA PROPIEDAD. El contador dice una cosa y el libro otra —que es
    // exactamente el estado que la auditoría contable existe para corregir— y
    // el margen tiene que seguir al libro, que es la fuente declarada.
    await crearComercio(RENTABLE, { name: 'Rentable', plan: 'starter' })

    // El libro: USD 2.
    await asentar({ tenantId: RENTABLE, costUsd: 2 })

    // El contador, desviado: USD 9. Si el margen lo leyera, daría $1.000.
    await AiUsage.collection.insertOne({
      tenantId: RENTABLE,
      period: PERIODO,
      estimatedCostUsd: 9,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const reporte = await getPlatformMarginReport(PERIODO)
    const fila = reporte.tenants.find(t => String(t.tenantId) === String(RENTABLE))

    // USD 2 × 1.000 = $2.000 de costo, sobre un plan de $10.000.
    expect(fila.aiCostArs).toBe(2000)
    expect(fila.estimatedMarginArs).toBe(8000)
  })

  test('el consumo con key propia del comercio NO entra al margen', async () => {
    // Lo paga el comercio contra Google. Cargárselo a HENKO mostraría como
    // ruinoso justamente al comercio que no le cuesta nada.
    await crearComercio(RENTABLE, { name: 'Con key propia', plan: 'starter' })

    await asentar({
      tenantId: RENTABLE,
      costUsd: 0,
      tenantProviderCostUsd: 7,
      keySource: 'tenant',
    })

    const reporte = await getPlatformMarginReport(PERIODO)
    const fila = reporte.tenants.find(t => String(t.tenantId) === String(RENTABLE))

    expect(fila.aiCostArs).toBe(0)
    expect(fila.estimatedMarginArs).toBe(10000)
  })

  test('un comercio sin consumo tiene costo cero, no queda afuera', async () => {
    // El libro solo tiene filas de quien consumió. Un comercio que pagó y no
    // usó nada es el más rentable de todos y tiene que verse.
    await crearComercio(RENTABLE, { name: 'Sin uso', plan: 'pro' })

    const reporte = await getPlatformMarginReport(PERIODO)
    const fila = reporte.tenants.find(t => String(t.tenantId) === String(RENTABLE))

    expect(fila.aiCostArs).toBe(0)
    expect(fila.estimatedMarginArs).toBe(40000)
  })
})

describe('qué se puede hacer con el reporte', () => {
  test('el margen viene también en porcentaje', async () => {
    // Un mismo margen en pesos sobre planes distintos son negocios distintos, y
    // en la columna de pesos se ven iguales.
    await crearComercio(RENTABLE, { name: 'Rentable', plan: 'starter' })
    await asentar({ tenantId: RENTABLE, costUsd: 2 })

    const reporte = await getPlatformMarginReport(PERIODO)
    const fila = reporte.tenants.find(t => String(t.tenantId) === String(RENTABLE))

    // $8.000 sobre $10.000.
    expect(fila.marginPercent).toBe(80)
  })

  test('marca al comercio que cuesta más de lo que paga', async () => {
    // Es la única fila del reporte sobre la que hay que hacer algo. Sin la
    // marca se pierde entre las demás: en una lista larga, un negativo es una
    // celda más.
    await crearComercio(CARO, { name: 'Ruinoso', plan: 'starter' })
    await asentar({ tenantId: CARO, costUsd: 25 })

    const reporte = await getPlatformMarginReport(PERIODO)
    const fila = reporte.tenants.find(t => String(t.tenantId) === String(CARO))

    // USD 25 × 1.000 = $25.000 de costo sobre un plan de $10.000.
    expect(fila.estimatedMarginArs).toBe(-15000)
    expect(fila.unprofitable).toBe(true)
    expect(fila.marginPercent).toBe(-150)
  })

  test('un comercio rentable no queda marcado', async () => {
    await crearComercio(RENTABLE, { name: 'Rentable', plan: 'pro' })
    await asentar({ tenantId: RENTABLE, costUsd: 1 })

    const reporte = await getPlatformMarginReport(PERIODO)
    const fila = reporte.tenants.find(t => String(t.tenantId) === String(RENTABLE))

    expect(fila.unprofitable).toBe(false)
  })

  test('los totales dicen cuántos pierden plata y cuánta', async () => {
    // Es la primera pregunta al abrir la pantalla, y contarlos a ojo sobre la
    // tabla no escala más allá de una docena de comercios.
    await crearComercio(RENTABLE, { name: 'Rentable', plan: 'pro' })
    await crearComercio(CARO, { name: 'Ruinoso', plan: 'starter' })
    await asentar({ tenantId: RENTABLE, costUsd: 1 })
    await asentar({ tenantId: CARO, costUsd: 25 })

    const { totals } = await getPlatformMarginReport(PERIODO)

    expect(totals.unprofitableCount).toBe(1)
    expect(totals.unprofitableLossArs).toBe(-15000)
    // Y el total sigue siendo la suma de los dos: 39.000 − 15.000.
    expect(totals.totalEstimatedMarginArs).toBe(24000)
  })
})
