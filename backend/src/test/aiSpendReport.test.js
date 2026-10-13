// El reporte de gasto, contra una base real.
//
// Una agregación no se puede verificar con mocks: lo único que probaría es que
// el pipeline se pasó tal como se escribió, no que Mongo devuelva lo que uno
// cree. Y acá el pipeline cambió de semántica.
//
// QUÉ CAMBIÓ
//
// Antes el reporte sumaba solo los 'consumed', y eso alcanzaba porque una fila
// de consumo se escribía únicamente cuando la operación ya había salido bien:
// no había nada que descontar. Desde que el costo de tarifa plana se cobra en
// el mismo movimiento que la cuota, la edición de imagen se cobra al reservar y
// se devuelve si el proveedor falla. Sin restar las devoluciones, el reporte
// contaría un gasto que se revirtió.

import mongoose from 'mongoose'
import { crearMongoEnMemoria } from './testDB.js'

const TENANT = new mongoose.Types.ObjectId()
const PERIODO = '2026-09'

let mongod
let Ledger
let getPeriodSpendByMetric
let getPeriodQuality

const fila = extra => ({
  tenantId: TENANT,
  period: PERIODO,
  event: 'consumed',
  metric: 'imageEdits',
  amount: 1,
  unit: 'units',
  operationId: null,
  costUsd: 0,
  createdAt: new Date(),
  ...extra,
})

const insertar = async (...filas) => Ledger.collection.insertMany(filas.map(fila))

const porMetrica = async metric =>
  (await getPeriodSpendByMetric(PERIODO)).find(row => row.metric === metric)

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())

  Ledger = (await import('../models/aiConsumptionLedgerModel.js')).default
  ;({ getPeriodSpendByMetric, getPeriodQuality } =
    await import('../services/ai/aiSpendReportService.js'))
}, 60_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

afterEach(async () => {
  await Ledger.collection.deleteMany({})
})

describe('getPeriodSpendByMetric · devoluciones', () => {
  test('una edición cobrada y devuelta no deja gasto', async () => {
    // Es el caso real: se reservó (y con eso se cobró), el proveedor falló y se
    // devolvió. Neto cero.
    await insertar(
      { event: 'consumed', costUsd: 0.02, operationId: 'op-1' },
      { event: 'refunded', costUsd: 0.02, operationId: 'op-1' },
    )

    const imagenes = await porMetrica('imageEdits')

    expect(imagenes.costUsd).toBe(0)
    expect(imagenes.operations).toBe(0)
  })

  test('de tres cobradas y una devuelta quedan dos', async () => {
    await insertar(
      { event: 'consumed', costUsd: 0.02, operationId: 'op-1' },
      { event: 'consumed', costUsd: 0.02, operationId: 'op-2' },
      { event: 'consumed', costUsd: 0.02, operationId: 'op-3' },
      { event: 'refunded', costUsd: 0.02, operationId: 'op-3' },
    )

    const imagenes = await porMetrica('imageEdits')

    expect(imagenes.costUsd).toBe(0.04)
    expect(imagenes.operations).toBe(2)
  })

  test('las reservas siguen sin contar', async () => {
    // Una reserva es intención. Para las métricas que no se cobran por
    // adelantado sigue existiendo como evento previo al consumo.
    await insertar(
      { event: 'reserved', metric: 'agentMessages', costUsd: 0, operationId: 'op-1' },
      {
        event: 'consumed',
        metric: 'agentTokens',
        unit: 'tokens',
        amount: 5000,
        costUsd: 0.01,
        operationId: 'op-1',
      },
    )

    const filas = await getPeriodSpendByMetric(PERIODO)

    expect(filas.find(f => f.metric === 'agentMessages')).toBeUndefined()
    expect(filas.find(f => f.metric === 'agentTokens').costUsd).toBe(0.01)
  })

  test('devolver un mensaje no borra los tokens que ya se gastaron', async () => {
    // El agente devuelve el mensaje cuando Google falla, pero los tokens de esa
    // llamada fallida se gastaron igual. Su fila de devolución lleva costo cero
    // justamente para que restarla no toque el gasto real.
    await insertar(
      {
        event: 'consumed',
        metric: 'agentTokens',
        unit: 'tokens',
        amount: 8000,
        costUsd: 0.03,
        operationId: 'op-1',
      },
      {
        event: 'refunded',
        metric: 'agentMessages',
        costUsd: 0,
        operationId: 'op-1',
      },
    )

    expect((await porMetrica('agentTokens')).costUsd).toBe(0.03)
    expect((await porMetrica('agentTokens')).tokens).toBe(8000)
  })
})

describe('calidad de la contabilidad', () => {
  const tokens = extra =>
    fila({ metric: 'agentTokens', unit: 'tokens', model: 'gemini-3.1-flash-lite', ...extra })

  test('las cuatro clases SUMAN el total, no se pisan', async () => {
    // Es la propiedad que hace utilizable el reporte: si las clases se
    // solaparan, una fila estimada Y con tarifa de respaldo sumaria dos veces
    // y el desglose no cerraria contra el gasto.
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      tokens({ amount: 1000, costUsd: 0.02, costEstimated: true }),
      tokens({ amount: 1000, costUsd: 0.04, priceFallback: true }),
      tokens({ amount: 1000, costUsd: 0.08, model: null }),
      // La peor combinacion: estimada Y con tarifa de respaldo Y sin modelo.
      // Cae en UNA sola clase, la mas grave.
      tokens({
        amount: 1000,
        costUsd: 0.16,
        costEstimated: true,
        priceFallback: true,
        model: null,
      }),
    ])

    const q = await getPeriodQuality(PERIODO)

    expect(q.measured + q.estimated + q.priceFallback + q.unknownModel).toBe(q.rows)
    expect(
      q.measuredCostUsd + q.estimatedCostUsd + q.fallbackCostUsd + q.unknownModelCostUsd,
    ).toBeCloseTo(q.costUsd, 6)

    // Y cada una donde corresponde: la de tres defectos cuenta como sin modelo.
    expect(q.measured).toBe(1)
    expect(q.estimated).toBe(1)
    expect(q.priceFallback).toBe(1)
    expect(q.unknownModel).toBe(2)
    expect(q.unknownModelCostUsd).toBeCloseTo(0.24, 6)
  })

  test('lo que se cobra por unidad no ensucia el porcentaje', async () => {
    // ESTE ERA EL BUG DEL REPORTE VIEJO. Medido en produccion sobre 2026-09:
    //
    //   todos los movimientos  160 filas · 27 estimadas (17%)
    //   solo las de tokens     132 filas ·  4 estimadas  (3%)
    //
    // La diferencia son ediciones de imagen: llevan costEstimated porque el
    // precio es por imagen y se cobra al reservar, y no llevan modelo porque
    // las sirve Replicate. Contarlas inflaba el defecto cuatro veces.
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      fila({ metric: 'imageEdits', unit: 'units', amount: 1, costUsd: 0.02, costEstimated: true }),
      fila({ metric: 'imageEdits', unit: 'units', amount: 1, costUsd: 0.02, costEstimated: true }),
    ])

    const q = await getPeriodQuality(PERIODO)

    // Antes: rows 3, estimatedRows 2. Ahora la pregunta se hace donde tiene
    // sentido.
    expect(q.rows).toBe(1)
    expect(q.estimated).toBe(0)
    expect(q.unknownModel).toBe(0)
    expect(q.measuredShare).toBe(100)

    // Y no desaparecen: se informan aparte.
    expect(q.flatRate).toEqual({ rows: 2, costUsd: 0.04 })
  })

  test('el porcentaje mide PLATA, no filas', async () => {
    // Una fila cara mal medida importa mas que diez baratas bien medidas, y un
    // porcentaje por filas diria lo contrario.
    await Ledger.collection.insertMany([
      ...Array.from({ length: 9 }, () => tokens({ amount: 10, costUsd: 0.001 })),
      tokens({ amount: 100000, costUsd: 0.991, costEstimated: true }),
    ])

    const q = await getPeriodQuality(PERIODO)

    expect(q.measured).toBe(9)
    expect(q.estimated).toBe(1)
    // 9 de 10 filas estan medidas, pero solo el 0,9% del gasto.
    expect(q.measuredShare).toBeCloseTo(0.9, 1)
  })

  test('sin gasto, el porcentaje es null y no 0%', async () => {
    // "No hubo gasto" y "el gasto es todo supuesto" son cosas distintas, y una
    // pantalla que muestre 0% donde no hubo nada asusta sin motivo.
    const q = await getPeriodQuality(PERIODO)

    expect(q.rows).toBe(0)
    expect(q.measuredShare).toBeNull()
    expect(q.costUsd).toBe(0)
  })

  test('las devoluciones no entran: la calidad se mide sobre lo consumido', async () => {
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      tokens({ event: 'refunded', amount: 1000, costUsd: 0, costEstimated: true }),
      tokens({ event: 'reserved', amount: 1000, costUsd: 0, costEstimated: true }),
    ])

    const q = await getPeriodQuality(PERIODO)

    expect(q.rows).toBe(1)
    expect(q.estimated).toBe(0)
  })

  test('el panel sigue leyendo los nombres que ya leia', async () => {
    await Ledger.collection.insertMany([
      tokens({ amount: 1000, costUsd: 0.01 }),
      tokens({ amount: 1000, costUsd: 0.02, costEstimated: true }),
      tokens({ amount: 1000, costUsd: 0.04, priceFallback: true }),
    ])

    const q = await getPeriodQuality(PERIODO)

    expect(q.rows).toBe(3)
    expect(q.estimatedRows).toBe(1)
    expect(q.fallbackRows).toBe(1)
  })
})

describe('por comercio · quien se lo gasto', () => {
  const OTRO = new mongoose.Types.ObjectId()

  const tokens = extra =>
    fila({ metric: 'agentTokens', unit: 'tokens', model: 'gemini-3.1-flash-lite', ...extra })

  test('separa el consumo de cada comercio', async () => {
    // TODO el resto del reporte es agregado: por metrica, por modelo, por
    // calidad, por origen de key. Ninguna de esas vistas contesta la pregunta
    // que uno se hace cuando el disyuntor corta — quien fue — y el dato estaba
    // a mano: el ledger tiene tenantId en cada fila.
    await Ledger.collection.insertMany([
      tokens({ amount: 10000, costUsd: 0.1 }),
      tokens({ amount: 5000, costUsd: 0.05 }),
      tokens({ amount: 1000, costUsd: 0.01, tenantId: OTRO }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const filas = await getPeriodSpendByTenant(PERIODO)

    expect(filas).toHaveLength(2)

    // Ordenado por lo que le cuesta a HENKO: el que hay que mirar primero va
    // primero.
    expect(filas[0].tenantId).toBe(String(TENANT))
    expect(filas[0].tokens).toBe(15000)
    expect(filas[0].platformCostUsd).toBeCloseTo(0.15, 6)

    expect(filas[1].tokens).toBe(1000)
  })

  test('las devoluciones restan, igual que en el resto del reporte', async () => {
    await Ledger.collection.insertMany([
      tokens({ amount: 10000, costUsd: 0.1, operationId: 'op-1' }),
      fila({
        event: 'refunded',
        metric: 'agentTokens',
        unit: 'tokens',
        amount: 10000,
        costUsd: 0.1,
        operationId: 'op-1',
      }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO)

    expect(comercio.tokens).toBe(0)
    expect(comercio.platformCostUsd).toBe(0)
  })

  test('separa lo que paga HENKO de lo que consume el comercio', async () => {
    // Con key propia el primero es cero y el segundo no. Confundirlos es
    // confundir "cuanto me cuesta servir a este comercio" con "cuanto consume
    // este comercio", que se deciden distinto.
    await Ledger.collection.insertMany([
      tokens({
        amount: 10000,
        costUsd: 0,
        tenantProviderCostUsd: 0.1,
        keySource: 'tenant',
      }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO)

    expect(comercio.platformCostUsd).toBe(0)
    expect(comercio.tenantProviderCostUsd).toBeCloseTo(0.1, 6)
    expect(comercio.keySources).toContain('tenant')
  })

  test('dice cuanto lleva de SU parte, no de la plataforma', async () => {
    // Es lo que vuelve accionable la tabla: un comercio al 90% de su parte se
    // va a quedar sin IA aunque la plataforma vaya al 30%. Sin esta columna,
    // la pantalla muestra un total tranquilizador mientras alguien se corta.
    await Ledger.collection.insertMany([tokens({ amount: 10000, costUsd: 0.1 })])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO)

    // Sin techo configurado no se inventa un porcentaje.
    if (comercio.tokenCap === null) {
      expect(comercio.percentOfCap).toBeNull()
    } else {
      expect(comercio.percentOfCap).toBeCloseTo((10000 / comercio.tokenCap) * 100, 1)
    }
  })

  test('un comercio borrado no rompe la tabla', async () => {
    // El ledger es append-only y el tenant puede haberse dado de baja: la fila
    // sigue siendo gasto real y tiene que verse.
    await Ledger.collection.insertMany([
      tokens({ amount: 500, costUsd: 0.01, tenantId: new mongoose.Types.ObjectId() }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO)

    expect(comercio.name).toBe('(comercio eliminado)')
    expect(comercio.tokens).toBe(500)
  })
})

// ─── CONTRA EL MES ANTERIOR ──────────────────────────────────────────────────
//
// Todo el resto del reporte compara contra un TECHO, y eso deja ciego al
// comercio que se desliza: duplica su consumo todos los meses y sigue lejos de
// su tope, así que ninguna alarma se enciende hasta que ya se comió el
// presupuesto.
//
// Esto se prueba contra una base real y no con mocks por el mismo motivo que
// el resto del archivo: lo que puede estar mal no es que el pipeline se pase
// como se escribió, es qué devuelve Mongo cuando se le pide agrupar dos meses
// y cortar por día.

const ANTERIOR = '2026-08'

/** Una fila en el día `day` del período que se indique, en UTC. */
const enDia = (period, day, extra = {}) =>
  fila({
    period,
    metric: 'agentTokens',
    unit: 'tokens',
    createdAt: new Date(`${period}-${String(day).padStart(2, '0')}T12:00:00.000Z`),
    ...extra,
  })

describe('getPreviousPeriod', () => {
  test('en enero vuelve a diciembre del año anterior', async () => {
    // El error obvio es restarle uno al mes: en enero eso da '2026-00', que no
    // existe, y la comparación se cae justo en el cierre de año.
    const { getPreviousPeriod } = await import('../services/ai/aiPeriod.js')

    expect(getPreviousPeriod('2026-01')).toBe('2025-12')
    expect(getPreviousPeriod('2026-10')).toBe('2026-09')
    expect(getPreviousPeriod('no es un período')).toBeNull()
  })
})

describe('tendencia contra el mes anterior', () => {
  test('un comercio que duplicó lo dice', async () => {
    await Ledger.collection.insertMany([
      enDia(ANTERIOR, 5, { costUsd: 0.5, amount: 1000 }),
      enDia(PERIODO, 5, { costUsd: 0.5, amount: 1000 }),
      enDia(PERIODO, 6, { costUsd: 0.5, amount: 1000 }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO, { trend: true })

    expect(comercio.previousUsd).toBeCloseTo(0.5, 6)
    expect(comercio.comparableUsd).toBeCloseTo(1, 6)
    expect(comercio.changePercent).toBe(100)
  })

  test('sin gasto el mes anterior no se inventa un porcentaje', async () => {
    // Dividir por cero daría Infinity y la pantalla mostraría "∞%". El null es
    // distinto de un 0%, que significa que gastó lo mismo.
    await Ledger.collection.insertMany([enDia(PERIODO, 5, { costUsd: 0.5, amount: 1000 })])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO, { trend: true })

    expect(comercio.changePercent).toBeNull()
    expect(comercio.previousUsd).toBe(0)
  })

  test('las devoluciones restan también en la comparación', async () => {
    await Ledger.collection.insertMany([
      enDia(ANTERIOR, 5, { costUsd: 1, amount: 1000, operationId: 'op-1' }),
      enDia(ANTERIOR, 5, {
        event: 'refunded',
        costUsd: 0.5,
        amount: 500,
        operationId: 'op-1',
      }),
      enDia(PERIODO, 5, { costUsd: 0.5, amount: 1000 }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO, { trend: true })

    // El mes pasado quedó neto en 0,50, así que gastar 0,50 ahora es no haber
    // cambiado. Sin restar la devolución, la tabla diría que cayó un 50%.
    expect(comercio.previousUsd).toBeCloseTo(0.5, 6)
    expect(comercio.changePercent).toBe(0)
  })

  test('sin pedirla, la comparación no se calcula', async () => {
    // Es una agregación cruzada sobre DOS meses del libro, y quien más llama a
    // esta función es el reporte de margen, que no la usa. Con la comparación
    // por omisión, abrir la pantalla de gasto la calcularía dos veces y una se
    // tiraría.
    await Ledger.collection.insertMany([
      enDia(ANTERIOR, 5, { costUsd: 0.5, amount: 1000 }),
      enDia(PERIODO, 5, { costUsd: 1, amount: 1000 }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(PERIODO)

    expect(comercio.changePercent).toBeNull()
    expect(comercio.previousUsd).toBeNull()
    // Lo demás de la fila no cambia: lo que no se calcula es la comparación.
    expect(comercio.platformCostUsd).toBeCloseTo(1, 6)
  })

  test('el mes en curso se compara con los MISMOS días del anterior', async () => {
    // ES LA PIEZA QUE DECIDE SI LA COLUMNA SIRVE O MIENTE.
    //
    // El mes en curso va por la mitad y el anterior está entero: comparar los
    // dos totales el día 13 muestra a TODOS los comercios desplomados, que no
    // es un dato sino una propiedad del calendario.
    const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')
    const actual = getCurrentPeriod()
    const [anio, mes] = actual.split('-').map(Number)
    const previo = `${mes === 1 ? anio - 1 : anio}-${String(mes === 1 ? 12 : mes - 1).padStart(2, '0')}`

    // Día 13: doce días cerrados. Hoy no cuenta —va a medio andar— y medirlo
    // contra un día completo del mes pasado inclinaría la cuenta para abajo.
    const now = new Date(`${actual}-13T10:00:00.000Z`)

    await Ledger.collection.insertMany([
      // Mes en curso: 1 dólar en los días comparables, más uno de hoy.
      enDia(actual, 3, { costUsd: 1, amount: 1000 }),
      enDia(actual, 13, { costUsd: 99, amount: 1000 }),
      // Mes anterior: 1 dólar dentro de la ventana y 50 fuera.
      enDia(previo, 3, { costUsd: 1, amount: 1000 }),
      enDia(previo, 25, { costUsd: 50, amount: 1000 }),
    ])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(actual, { now, trend: true })

    expect(comercio.comparableUsd).toBeCloseTo(1, 6)
    expect(comercio.previousComparableUsd).toBeCloseTo(1, 6)
    expect(comercio.changePercent).toBe(0)

    // El total del mes anterior se informa igual, completo: es otro dato y
    // sirve para otra cosa —cuánto costó de verdad— y por eso va aparte.
    expect(comercio.previousUsd).toBeCloseTo(51, 6)
    // Y lo del mes en curso que quedó fuera de la ventana sigue estando en el
    // costo de la fila: lo que se acota es la comparación, no el gasto.
    expect(comercio.platformCostUsd).toBeCloseTo(100, 6)
  })

  test('el día 1 del mes no hay nada que comparar', async () => {
    // Sin días cerrados, cualquier comparación daría "-100%" para todo el
    // mundo. Un null dice que no se puede saber, que es la verdad.
    const { getCurrentPeriod } = await import('../services/ai/aiPeriod.js')
    const actual = getCurrentPeriod()

    await Ledger.collection.insertMany([enDia(actual, 1, { costUsd: 1, amount: 1000 })])

    const { getPeriodSpendByTenant } = await import('../services/ai/aiSpendReportService.js')
    const [comercio] = await getPeriodSpendByTenant(actual, {
      now: new Date(`${actual}-01T10:00:00.000Z`),
      trend: true,
    })

    expect(comercio.changePercent).toBeNull()
    expect(comercio.comparableUsd).toBeNull()
    expect(comercio.platformCostUsd).toBeCloseTo(1, 6)
  })
})

describe('getTenantSpendDetail · un comercio día por día', () => {
  const OTRO = new mongoose.Types.ObjectId()

  test('la serie viene completa, con los días sin gasto en cero', async () => {
    // Con los días salteados, un comercio que gastó el 3 y el 20 dibuja dos
    // barras pegadas y el gráfico dice que gastó dos días seguidos.
    await Ledger.collection.insertMany([
      enDia(PERIODO, 3, { costUsd: 0.3, amount: 300 }),
      enDia(PERIODO, 20, { costUsd: 0.2, amount: 200 }),
    ])

    const { getTenantSpendDetail } = await import('../services/ai/aiSpendReportService.js')
    const detalle = await getTenantSpendDetail(String(TENANT), PERIODO)

    // Septiembre tiene 30 días.
    expect(detalle.daily).toHaveLength(30)
    expect(detalle.daily[2]).toMatchObject({ day: 3, costUsd: 0.3, tokens: 300 })
    expect(detalle.daily[3]).toMatchObject({ day: 4, costUsd: 0, tokens: 0 })
    expect(detalle.daily[19]).toMatchObject({ day: 20, costUsd: 0.2 })
    expect(detalle.totals.costUsd).toBeCloseTo(0.5, 6)
  })

  test('no mezcla el consumo de otro comercio', async () => {
    // Es una lectura cross-tenant con ignoreTenant: lo único que la mantiene
    // acotada a un comercio es el $match, y una lectura de plataforma que
    // devuelve datos del vecino es la peor falla posible de esta pantalla.
    await Ledger.collection.insertMany([
      enDia(PERIODO, 3, { costUsd: 0.3, amount: 300 }),
      enDia(PERIODO, 3, { costUsd: 99, amount: 99999, tenantId: OTRO }),
    ])

    const { getTenantSpendDetail } = await import('../services/ai/aiSpendReportService.js')
    const detalle = await getTenantSpendDetail(String(TENANT), PERIODO)

    expect(detalle.totals.costUsd).toBeCloseTo(0.3, 6)
    expect(detalle.daily[2].tokens).toBe(300)
  })

  test('trae el mes anterior y en qué se le fue', async () => {
    await Ledger.collection.insertMany([
      enDia(ANTERIOR, 10, { costUsd: 0.1, amount: 100 }),
      enDia(PERIODO, 10, { costUsd: 0.3, amount: 300 }),
      enDia(PERIODO, 11, { metric: 'marketTokens', costUsd: 0.6, amount: 600 }),
    ])

    const { getTenantSpendDetail } = await import('../services/ai/aiSpendReportService.js')
    const detalle = await getTenantSpendDetail(String(TENANT), PERIODO)

    expect(detalle.previousPeriod).toBe(ANTERIOR)
    expect(detalle.previousTotals.costUsd).toBeCloseTo(0.1, 6)
    // Agosto tiene 31 días y septiembre 30: la serie del mes anterior tiene el
    // largo de SU mes, no el del período pedido.
    expect(detalle.previousDaily).toHaveLength(31)

    // Un mes cerrado se compara entero contra el anterior entero.
    expect(detalle.comparison.days).toBe(30)
    expect(detalle.comparison.changePercent).toBe(800)

    // Lo mismo repartido en análisis de mercado o en el agente lleva a
    // palancas distintas, y el total del mes no las separa.
    expect(detalle.byMetric[0]).toMatchObject({ metric: 'marketTokens', costUsd: 0.6 })
    expect(detalle.byMetric[1]).toMatchObject({ metric: 'agentTokens', costUsd: 0.3 })
  })

  test('un id que no es un ObjectId devuelve null en vez de romper', async () => {
    const { getTenantSpendDetail } = await import('../services/ai/aiSpendReportService.js')

    // 'no-soy-un-id' tiene DOCE caracteres, y ese es justo el caso que
    // mongoose.Types.ObjectId.isValid deja pasar: un ObjectId son 12 bytes y
    // la función los acepta crudos. Con esa validación, esta llamada devolvía
    // un detalle entero en cero con el nombre "(comercio eliminado)" — una
    // pantalla que parece una respuesta y no lo es.
    expect(await getTenantSpendDetail('no-soy-un-id', PERIODO)).toBeNull()
    expect(await getTenantSpendDetail('', PERIODO)).toBeNull()
    expect(await getTenantSpendDetail(undefined, PERIODO)).toBeNull()
  })
})
