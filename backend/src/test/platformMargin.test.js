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
import { crearMongoEnMemoria } from './testDB.js'

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
const { default: AiConsumptionLedger, LEDGER_EVENT } =
  await import('../models/aiConsumptionLedgerModel.js')
const { default: AiUsage } = await import('../models/aiUsageModel.js')
const { getPlatformMarginReport } = await import('../services/platform/platformMarginService.js')
const { updateTenantStatus, getUsdRate, deleteTenant } = await import(
  '../controller/platformCtrl.js',
)
const { default: PlatformAiSetting, PLATFORM_AI_SETTINGS } = await import(
  '../models/platformAiSettingModel.js',
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
  mongod = await crearMongoEnMemoria()
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

// Suspender un comercio: lo unico que esta pantalla puede hacerle a un negocio
// que paga, y por eso lo unico que tiene que estar bien atado.
//
// NO BORRA NADA, a proposito. El caso que motiva la funcion es un comercio que
// cuesta mas de lo que paga, y para eso frenarlo alcanza. Borrarlo seria
// irreversible justo con los datos que harian falta si despues discute un cobro.
//
// El corte ya lo aplica tenantMiddleware, que resuelve unicamente comercios con
// status 'active'. Esto solo mueve la perilla.
describe('suspension de comercio', () => {
  const respuesta = () => ({
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  })

  const pedir = async (tenantId, cuerpo, email = 'dueno@henko.test') => {
    const req = { params: { tenantId: String(tenantId) }, body: cuerpo, user: { email } }
    const res = respuesta()

    await updateTenantStatus(req, res, err => {
      if (err) throw err
    })

    return res
  }

  beforeEach(async () => {
    await crearComercio(CARO, { name: 'Caro', plan: 'starter' })
  })

  test('suspender deja el motivo y el autor en la fila', async () => {
    const res = await pedir(CARO, { suspended: true, reason: 'Cuesta mas de lo que paga' })

    expect(res.statusCode).toBe(200)

    const tenant = await Tenant.collection.findOne({ _id: CARO })

    expect(tenant.status).toBe('suspended')
    // Sin motivo ni autor no hay con que responder cuando el comercio reclame.
    expect(tenant.suspendedReason).toBe('Cuesta mas de lo que paga')
    expect(tenant.suspendedByEmail).toBe('dueno@henko.test')
    expect(tenant.suspendedAt).toBeInstanceOf(Date)
  })

  test('no se puede suspender sin decir por que', async () => {
    const res = await pedir(CARO, { suspended: true })

    expect(res.statusCode).toBe(400)

    const tenant = await Tenant.collection.findOne({ _id: CARO })

    expect(tenant.status).toBe('active')
  })

  test('reactivar limpia el motivo, que si no se lee como si siguiera suspendido', async () => {
    await pedir(CARO, { suspended: true, reason: 'prueba' })
    const res = await pedir(CARO, { suspended: false })

    expect(res.statusCode).toBe(200)

    const tenant = await Tenant.collection.findOne({ _id: CARO })

    expect(tenant.status).toBe('active')
    expect(tenant.suspendedReason).toBeNull()
    expect(tenant.suspendedAt).toBeNull()
    expect(tenant.suspendedByEmail).toBeNull()
  })

  test('reactivar no necesita motivo: volver a habilitar no hay que defenderlo', async () => {
    await pedir(CARO, { suspended: true, reason: 'prueba' })

    expect((await pedir(CARO, { suspended: false })).statusCode).toBe(200)
  })

  test('suspender NO borra nada del comercio', async () => {
    await pedir(CARO, { suspended: true, reason: 'prueba' })

    const tenant = await Tenant.collection.findOne({ _id: CARO })

    // Lo que haria falta si el comercio reclama o discute un cobro.
    expect(tenant.name).toBe('Caro')
    expect(tenant.plan).toBe('starter')
    expect(tenant.createdAt).toBeInstanceOf(Date)
  })

  test('un comercio dado de baja no se reactiva desde aca', async () => {
    await Tenant.collection.updateOne({ _id: CARO }, { $set: { status: 'deleted' } })

    const res = await pedir(CARO, { suspended: false })

    // Es otra decision y esta pantalla no es el lugar para tomarla sin querer.
    expect(res.statusCode).toBe(409)
  })

  test('un id que no es un comercio no pasa', async () => {
    expect((await pedir('no-es-un-id', { suspended: true, reason: 'x' })).statusCode).toBe(400)
  })

  test('hace falta decir si queda suspendido o activo', async () => {
    expect((await pedir(CARO, { reason: 'x' })).statusCode).toBe(400)
  })
})

// De donde sale el tipo de cambio que se informa.
//
// El numero solo no alcanza: toda la utilidad de esta tarjeta esta en poder
// distinguir el valor que una persona decidio del que quedo por defecto. Si la
// procedencia miente, el aviso de "esto esta viejo" deja de significar algo.
describe('procedencia del tipo de cambio', () => {
  const respuesta = () => ({
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  })

  const consultar = async () => {
    const res = respuesta()
    await getUsdRate({}, res, err => {
      if (err) throw err
    })
    return res.body.data
  }

  const asentarAjuste = (setting, value, dias = 0) =>
    PlatformAiSetting.collection.insertOne({
      setting,
      value,
      previousValue: null,
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
      createdAt: new Date(Date.now() - dias * 24 * 60 * 60 * 1000),
    })

  beforeEach(async () => {
    await PlatformAiSetting.collection.deleteMany({})
  })

  test('sin ninguna fila dice que viene del entorno', async () => {
    const data = await consultar()

    expect(data.source).toBe('env')
    expect(data.ageDays).toBeNull()
  })

  test('con un valor cargado dice panel, con su autor y su antiguedad', async () => {
    await asentarAjuste(PLATFORM_AI_SETTINGS.USD_ARS_RATE, 1650, 47)

    const data = await consultar()

    expect(data.source).toBe('panel')
    expect(data.updatedByEmail).toBe('dueno@henko.test')
    // De esto depende el aviso de desactualizado.
    expect(data.ageDays).toBe(47)
  })

  test('si se quito el override NO dice panel', async () => {
    // Quitar el override escribe una fila con value null y devuelve el mando a
    // la variable de entorno. Informar 'panel' ahi diria que el numero lo
    // decidio una persona cuando en realidad es el default, y la tarjeta no
    // mostraria el aviso de "nadie lo cargo".
    await asentarAjuste(PLATFORM_AI_SETTINGS.USD_ARS_RATE, null, 0)

    const data = await consultar()

    expect(data.source).toBe('env')
    expect(data.ageDays).toBeNull()
  })

  test('la fila del dolar se encuentra aunque otros ajustes la hayan corrido', async () => {
    // El historial general trae las ultimas 100 filas de TODOS los ajustes. El
    // techo se mueve en caliente cuando el disyuntor corta, asi que la fila del
    // dolar se cae de esa ventana y la pantalla afirmaba que nadie lo habia
    // cargado. Un aviso que grita en falso deja de ser leido.
    await asentarAjuste(PLATFORM_AI_SETTINGS.USD_ARS_RATE, 1650, 30)

    for (let i = 0; i < 120; i += 1) {
      await asentarAjuste(PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET, 200_000_000 + i, 1)
    }

    const data = await consultar()

    expect(data.source).toBe('panel')
    expect(data.ageDays).toBe(30)
  })
})

// Dar de baja un comercio: la unica operacion de esta pantalla que no se
// deshace con un clic.
//
// QUE BORRA Y QUE NO
//
// Pone status en 'deleted', lo que lo saca de toda operacion y del reporte de
// margen. NO borra el libro de consumo de IA, y eso es a proposito: esas filas
// registran lo que HENKO PAGO. Si desaparecieran, el gasto mensual de la
// plataforma dejaria de cuadrar con lo que facturo Google y el historial del
// disyuntor quedaria mal.
describe('baja de comercio', () => {
  const respuesta = () => ({
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  })

  const borrar = async (tenantId, cuerpo, email = 'dueno@henko.test') => {
    const req = { params: { tenantId: String(tenantId) }, body: cuerpo, user: { email } }
    const res = respuesta()

    await deleteTenant(req, res, err => {
      if (err) throw err
    })

    return res
  }

  beforeEach(async () => {
    await crearComercio(CARO, { name: 'Caro', plan: 'starter' })
  })

  test('da de baja y deja el motivo y el autor', async () => {
    const res = await borrar(CARO, { confirmName: 'Caro', reason: 'Pidio la baja' })

    expect(res.statusCode).toBe(200)

    const tenant = await Tenant.collection.findOne({ _id: CARO })

    expect(tenant.status).toBe('deleted')
    expect(tenant.suspendedReason).toBe('Pidio la baja')
    expect(tenant.suspendedByEmail).toBe('dueno@henko.test')
  })

  test('sin el nombre exacto no borra', async () => {
    const res = await borrar(CARO, { confirmName: 'caro', reason: 'x' })

    // Minusculas no alcanza: el punto es que quien confirma haya MIRADO el
    // nombre, no que adivine una forma aproximada.
    expect(res.statusCode).toBe(400)
    expect((await Tenant.collection.findOne({ _id: CARO })).status).toBe('active')
  })

  test('sin nombre tampoco', async () => {
    expect((await borrar(CARO, { reason: 'x' })).statusCode).toBe(400)
    expect((await Tenant.collection.findOne({ _id: CARO })).status).toBe('active')
  })

  test('sin motivo tampoco', async () => {
    expect((await borrar(CARO, { confirmName: 'Caro' })).statusCode).toBe(400)
    expect((await Tenant.collection.findOne({ _id: CARO })).status).toBe('active')
  })

  test('no se puede dar de baja dos veces', async () => {
    await borrar(CARO, { confirmName: 'Caro', reason: 'x' })

    expect((await borrar(CARO, { confirmName: 'Caro', reason: 'x' })).statusCode).toBe(409)
  })

  test('el libro de consumo NO se borra: registra lo que HENKO pago', async () => {
    await asentar({ tenantId: CARO, costUsd: 3.5 })
    await borrar(CARO, { confirmName: 'Caro', reason: 'x' })

    // Si estas filas desaparecieran, el gasto mensual de la plataforma dejaria
    // de cuadrar con lo que facturo Google.
    const filas = await AiConsumptionLedger.collection.countDocuments({ tenantId: CARO })

    expect(filas).toBe(1)
  })

  test('un comercio dado de baja sale del reporte de margen', async () => {
    await asentar({ tenantId: CARO, costUsd: 3.5 })
    await borrar(CARO, { confirmName: 'Caro', reason: 'x' })

    const { tenants } = await getPlatformMarginReport(PERIODO)

    expect(tenants.find(t => String(t.tenantId) === String(CARO))).toBeUndefined()
  })

  test('pero sigue en el reporte de gasto, marcado', async () => {
    await asentar({ tenantId: CARO, costUsd: 3.5 })
    await borrar(CARO, { confirmName: 'Caro', reason: 'x' })

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const filas = await getPeriodSpendByTenant(PERIODO)
    const fila = filas.find(f => String(f.tenantId) === String(CARO))

    // El gasto ocurrio: la fila tiene que seguir. Lo que hace falta es que la
    // pantalla pueda distinguirla de una sobre la que se puede actuar.
    expect(fila).toBeDefined()
    expect(fila.tenantStatus).toBe('deleted')
    expect(fila.tenantGone).toBe(false)
  })

  test('un comercio borrado a mano de la base se marca como ausente', async () => {
    // Es el estado en el que queda si alguien lo borra directo de Mongo en
    // lugar de usar esta pantalla: el libro queda sin documento al que unir.
    await asentar({ tenantId: CARO, costUsd: 3.5 })
    await Tenant.collection.deleteOne({ _id: CARO })

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const filas = await getPeriodSpendByTenant(PERIODO)
    const fila = filas.find(f => String(f.tenantId) === String(CARO))

    expect(fila).toBeDefined()
    expect(fila.tenantGone).toBe(true)
    expect(fila.name).toBe('(comercio eliminado)')
  })
})

// Las filas del SEGUNDO camino del reporte tambien dicen si el comercio existe.
//
// getPeriodSpendByTenant devuelve filas por dos caminos: las que tienen
// movimientos en el libro, y las de comercios con la IA pausada y sin consumo en
// el periodo —que se agregan a proposito para que no se caigan de la tabla—.
//
// Las banderas se habian agregado solo al primero, asi que un comercio dado de
// baja con politica pausada y sin consumo aparecia con el boton "Gobernar" y
// todas las acciones habilitadas: el mismo defecto que esto vino a arreglar,
// por el otro camino del codigo.
describe('comercio pausado y sin consumo', () => {
  test('la fila dice que el comercio esta dado de baja', async () => {
    const { setTenantAiPolicy } = await import('../services/ai/platformAiSettingService.js')

    await crearComercio(CARO, { name: 'Caro', plan: 'starter' })
    await Tenant.collection.updateOne({ _id: CARO }, { $set: { status: 'deleted' } })

    // Pausado y sin una sola fila en el libro este periodo.
    await setTenantAiPolicy({
      tenantId: String(CARO),
      suspended: true,
      suspendedReason: 'prueba',
      changedByEmail: 'dueno@henko.test',
      reason: 'prueba',
    })

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const filas = await getPeriodSpendByTenant(PERIODO)
    const fila = filas.find(f => String(f.tenantId) === String(CARO))

    expect(fila).toBeDefined()
    expect(fila.operations).toBe(0)
    // Sin esto la pantalla le ofrecia acciones a un comercio dado de baja.
    expect(fila.tenantStatus).toBe('deleted')
    expect(fila.tenantGone).toBe(false)
  })
})
