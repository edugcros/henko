// 📁 src/test/aiAnomalies.test.js
//
// Comercios que hoy gastan muy por encima de SU propia costumbre.
//
// QUÉ CIEGO CUBRE
//
// Todo el resto del paquete compara contra un TECHO. Eso deja afuera el caso
// más común de desborde: un comercio chico que multiplica por cincuenta su
// consumo habitual y sigue lejísimos del techo, porque el techo está pensado
// para un comercio grande. Ninguna alarma suena hasta que ya se comió el
// presupuesto de todos.
//
// Esto compara cada comercio contra sí mismo: no importa cuánto gasta, importa
// cuánto cambió.
//
// CONTRA BASE REAL
//
// La detección es una agregación del libro agrupada por comercio y por día.
// Con un mock se probaría el mock, y justo lo que puede salir mal acá es la
// agregación: la zona horaria del $dayOfMonth, el signo de las devoluciones, y
// qué días entran a la base.

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64url')

const { default: AiConsumptionLedger, LEDGER_EVENT } = await import(
  '../models/aiConsumptionLedgerModel.js'
)
const { getSpendAnomalies } = await import('../services/ai/aiSpendReportService.js')

const TRANQUILO = new mongoose.Types.ObjectId('64b7f00000000000000000b1')
const DESBOCADO = new mongoose.Types.ObjectId('64b7f00000000000000000b2')
const NUEVO = new mongoose.Types.ObjectId('64b7f00000000000000000b3')

// El mes en curso: la detección solo corre sobre él, porque sobre uno cerrado
// no hay nada que hacer con el dato.
const AHORA = new Date()
const PERIODO = `${AHORA.getUTCFullYear()}-${String(AHORA.getUTCMonth() + 1).padStart(2, '0')}`

// El día 15, para tener catorce días de base sin depender de cuándo corra el
// test. El reloj se pasa por parámetro justamente para eso.
const HOY = new Date(Date.UTC(AHORA.getUTCFullYear(), AHORA.getUTCMonth(), 15, 14, 0, 0))

const enElDia = dia =>
  new Date(Date.UTC(AHORA.getUTCFullYear(), AHORA.getUTCMonth(), dia, 10, 0, 0))

let mongod

const asentar = async ({ tenantId, day, costUsd, event = LEDGER_EVENT.CONSUMED }) =>
  AiConsumptionLedger.collection.insertOne({
    tenantId,
    period: PERIODO,
    event,
    metric: 'agentTokens',
    unit: 'tokens',
    amount: 1000,
    costUsd,
    createdAt: enElDia(day),
    updatedAt: enElDia(day),
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
  await AiConsumptionLedger.collection.deleteMany({})
})

describe('la detección de anomalías', () => {
  test('un comercio parejo no aparece', async () => {
    // Una lista que incluye a todos no señala a nadie.
    for (let dia = 1; dia <= 15; dia += 1) {
      await asentar({ tenantId: TRANQUILO, day: dia, costUsd: 0.4 })
    }

    expect(await getSpendAnomalies(PERIODO, { now: HOY })).toEqual([])
  })

  test('un comercio que se desbocó hoy aparece con su múltiplo', async () => {
    // ESTA ES LA PROPIEDAD. Catorce días a USD 0,10 y hoy USD 5: cincuenta
    // veces su costumbre, y sigue siendo el 10% de un techo de USD 50.
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: DESBOCADO, day: dia, costUsd: 0.1 })
    }
    await asentar({ tenantId: DESBOCADO, day: 15, costUsd: 5 })

    const [anomalia] = await getSpendAnomalies(PERIODO, { now: HOY })

    expect(String(anomalia.tenantId)).toBe(String(DESBOCADO))
    expect(anomalia.todayUsd).toBe(5)
    expect(anomalia.typicalUsd).toBe(0.1)
    expect(anomalia.factor).toBe(50)
  })

  test('un solo pico viejo NO tapa el segundo', async () => {
    // ESTE ES EL MOTIVO DE LA MEDIANA. Con promedio, el día desbocado del 10
    // levantaría la base lo suficiente como para que el de hoy pareciera
    // normal: el mecanismo se desactivaría solo justo cuando empieza a hacer
    // falta.
    //
    // Trece días a USD 0,10, el día 10 a USD 20 y hoy a USD 5.
    // Promedio de la base = (13 × 0,10 + 20) / 14 = 1,52 → 5 / 1,52 = 3,3
    // Mediana de la base = 0,10 → 5 / 0,10 = 50
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: DESBOCADO, day: dia, costUsd: dia === 10 ? 20 : 0.1 })
    }
    await asentar({ tenantId: DESBOCADO, day: 15, costUsd: 5 })

    const [anomalia] = await getSpendAnomalies(PERIODO, { now: HOY })

    expect(anomalia.typicalUsd).toBe(0.1)
    expect(anomalia.factor).toBe(50)
  })

  test('un múltiplo grande sobre nada no es noticia', async () => {
    // Pasar de USD 0,001 a USD 0,01 son "diez veces más" y no significa nada.
    // Sin el piso, la lista se llenaría de ruido y nadie la miraría.
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: TRANQUILO, day: dia, costUsd: 0.001 })
    }
    await asentar({ tenantId: TRANQUILO, day: 15, costUsd: 0.02 })

    expect(await getSpendAnomalies(PERIODO, { now: HOY })).toEqual([])
  })

  test('un comercio que arranca de cero se reporta sin múltiplo', async () => {
    // No hay división que hacer, pero el caso es real: pasó de no consumir a
    // consumir. Se informa factor null, que es distinto de "no se pasó".
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: NUEVO, day: dia, costUsd: 0 })
    }
    await asentar({ tenantId: NUEVO, day: 15, costUsd: 3 })

    const [anomalia] = await getSpendAnomalies(PERIODO, { now: HOY })

    expect(String(anomalia.tenantId)).toBe(String(NUEVO))
    expect(anomalia.factor).toBe(null)
    expect(anomalia.typicalUsd).toBe(0)
  })

  test('los que arrancan de cero van primero', async () => {
    // No tienen múltiplo con qué ordenarse y son, por definición, un cambio
    // total. Ordenarlos al final los escondería debajo de casos menores.
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: NUEVO, day: dia, costUsd: 0 })
      await asentar({ tenantId: DESBOCADO, day: dia, costUsd: 0.1 })
    }
    await asentar({ tenantId: NUEVO, day: 15, costUsd: 1 })
    await asentar({ tenantId: DESBOCADO, day: 15, costUsd: 5 })

    const anomalias = await getSpendAnomalies(PERIODO, { now: HOY })

    expect(anomalias).toHaveLength(2)
    expect(String(anomalias[0].tenantId)).toBe(String(NUEVO))
  })

  test('sin historia suficiente no se juzga a nadie', async () => {
    // Un comercio nuevo aparecería como anomalía el día que empieza a usar el
    // producto — que es exactamente lo que uno quiere que pase y no algo para
    // alarmarse.
    const diaTres = new Date(Date.UTC(AHORA.getUTCFullYear(), AHORA.getUTCMonth(), 3, 14))

    await asentar({ tenantId: DESBOCADO, day: 1, costUsd: 0.01 })
    await asentar({ tenantId: DESBOCADO, day: 2, costUsd: 0.01 })
    await asentar({ tenantId: DESBOCADO, day: 3, costUsd: 10 })

    expect(await getSpendAnomalies(PERIODO, { now: diaTres })).toEqual([])
  })

  test('las devoluciones se restan', async () => {
    // Una operación devuelta no se gastó. Contarla igual inflaría el día de hoy
    // y dispararía un aviso por plata que volvió.
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: DESBOCADO, day: dia, costUsd: 0.1 })
    }
    await asentar({ tenantId: DESBOCADO, day: 15, costUsd: 5 })
    await asentar({
      tenantId: DESBOCADO,
      day: 15,
      costUsd: 4.9,
      event: LEDGER_EVENT.REFUNDED,
    })

    // Queda en USD 0,10, que es su costumbre exacta y además debajo del piso.
    expect(await getSpendAnomalies(PERIODO, { now: HOY })).toEqual([])
  })

  test('un comercio desbocado no arrastra a los demás a la lista', async () => {
    // La base es POR COMERCIO. Si se calculara sobre el total de la plataforma,
    // el desbocado subiría la vara y escondería a cualquier otro.
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: TRANQUILO, day: dia, costUsd: 0.4 })
      await asentar({ tenantId: DESBOCADO, day: dia, costUsd: 0.1 })
    }
    await asentar({ tenantId: TRANQUILO, day: 15, costUsd: 0.4 })
    await asentar({ tenantId: DESBOCADO, day: 15, costUsd: 5 })

    const anomalias = await getSpendAnomalies(PERIODO, { now: HOY })

    expect(anomalias).toHaveLength(1)
    expect(String(anomalias[0].tenantId)).toBe(String(DESBOCADO))
  })

  test('un período cerrado no se analiza', async () => {
    // Sobre un mes terminado no hay nada que hacer con el dato, y la consulta
    // costaría igual.
    expect(await getSpendAnomalies('2024-03', { now: HOY })).toEqual([])
  })

  test('el nombre del comercio viaja con la anomalía', async () => {
    // Sin él la lista es de ObjectId y no se puede actuar sobre ella. El
    // comercio no existe en esta base, así que se informa como eliminado en vez
    // de romper.
    for (let dia = 1; dia <= 14; dia += 1) {
      await asentar({ tenantId: DESBOCADO, day: dia, costUsd: 0.1 })
    }
    await asentar({ tenantId: DESBOCADO, day: 15, costUsd: 5 })

    const [anomalia] = await getSpendAnomalies(PERIODO, { now: HOY })

    expect(anomalia.name).toBe('(comercio eliminado)')
  })
})
