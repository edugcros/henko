// Aislamiento entre comercios.
//
// Este archivo no podía existir hasta hoy. El plugin de tenant se apagaba
// entero cuando NODE_ENV era 'test', así que ninguna prueba podía descubrir una
// fuga entre comercios — la propiedad sobre la que descansa todo el modelo de
// negocio era indetectable por construcción. Peor: un test que intentara
// verificarla fallaba contra código correcto.
//
// Se prueba contra una base real en memoria, no con mocks, por el mismo motivo
// que el historial de precios: lo que hay que verificar es que los HOOKS de
// mongoose disparen. Un modelo mockeado probaría la aritmética y dejaría pasar
// el único fallo que importa acá.

import mongoose from 'mongoose'
import { crearMongoEnMemoria } from './testDB.js'

const TIENDA_A = new mongoose.Types.ObjectId()
const TIENDA_B = new mongoose.Types.ObjectId()

let mongod
let Ledger

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())

  // Se usa el ledger de consumo de IA porque lleva el plugin y no arrastra
  // dependencias: cualquier modelo con tenantPlugin serviría igual.
  Ledger = (await import('../models/aiConsumptionLedgerModel.js')).default
}, 60_000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

const movimiento = (tenantId, extra = {}) => ({
  tenantId,
  period: '2026-09',
  event: 'consumed',
  metric: 'vision',
  amount: 1,
  unit: 'units',
  ...extra,
})

beforeEach(async () => {
  await Ledger.collection.deleteMany({})

  await Ledger.collection.insertMany([
    movimiento(TIENDA_A, { costUsd: 1, createdAt: new Date() }),
    movimiento(TIENDA_A, { costUsd: 2, createdAt: new Date() }),
    movimiento(TIENDA_B, { costUsd: 99, createdAt: new Date() }),
  ])
})

describe('leer', () => {
  test('una tienda solo ve sus movimientos', async () => {
    const filas = await Ledger.find({}).setOptions({ tenantId: TIENDA_A })

    expect(filas).toHaveLength(2)
    expect(filas.every(f => String(f.tenantId) === String(TIENDA_A))).toBe(true)
  })

  test('un filtro vacío NO devuelve lo de todos', async () => {
    // El fallo que este archivo existe para detectar: si el plugin no
    // interviniera, esto traería las tres filas y la fuga pasaría inadvertida.
    const filas = await Ledger.find({}).setOptions({ tenantId: TIENDA_B })

    expect(filas).toHaveLength(1)
    expect(filas[0].costUsd).toBe(99)
  })

  test('pedir explícitamente el id de otro comercio se rechaza', async () => {
    // No alcanza con acotar: hay que impedir que alguien pase el id ajeno a
    // mano y se lleve el dato igual.
    await expect(
      Ledger.find({ tenantId: TIENDA_B }).setOptions({ tenantId: TIENDA_A }),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
  })

  test('una consulta sin comercio se rechaza en vez de traer todo', async () => {
    // Falla cerrado: sin contexto de tenant, la respuesta correcta es un error,
    // no el conjunto completo.
    await expect(Ledger.find({})).rejects.toMatchObject({
      code: 'TENANT_INVALID',
    })
  })

  test('contar tampoco cruza comercios', async () => {
    const total = await Ledger.countDocuments({}).setOptions({
      tenantId: TIENDA_A,
    })

    expect(total).toBe(2)
  })
})

describe('escribir', () => {
  test('guardar sin comercio se rechaza', async () => {
    // Lo atrapa la validación `required` del schema antes de que llegue el hook
    // del plugin — mongoose valida primero. Da igual cuál de las dos: lo que se
    // prueba es que no se puede escribir una fila huérfana, y que hay dos
    // capas cubriéndolo en vez de una.
    const fila = new Ledger(movimiento(undefined))

    await expect(fila.save()).rejects.toThrow(/tenantId/i)
  })

  test('el hook del plugin también lo cubre, no solo el schema', async () => {
    // Si alguien quitara `required` del campo creyendo que sobra, el plugin
    // sigue rechazando. Se prueba salteando la validación del schema para
    // llegar al hook.
    const fila = new Ledger(movimiento(undefined))

    await expect(fila.save({ validateBeforeSave: false })).rejects.toMatchObject({
      code: 'TENANT_INVALID',
    })
  })

  test('no se puede mover un movimiento a otro comercio', async () => {
    await expect(
      Ledger.updateMany({}, { $set: { tenantId: TIENDA_B } }).setOptions({
        tenantId: TIENDA_A,
      }),
    ).rejects.toMatchObject({ code: 'TENANT_MUTATION_FORBIDDEN' })
  })

  test('un borrado no alcanza a los datos de otro', async () => {
    await Ledger.deleteMany({}).setOptions({ tenantId: TIENDA_A })

    const quedan = await Ledger.collection.find({}).toArray()

    expect(quedan).toHaveLength(1)
    expect(String(quedan[0].tenantId)).toBe(String(TIENDA_B))
  })
})

describe('agregar', () => {
  test('un aggregate sin comercio se rechaza', async () => {
    await expect(
      Ledger.aggregate([{ $group: { _id: null, total: { $sum: '$costUsd' } } }]),
    ).rejects.toMatchObject({ code: 'TENANT_INVALID' })
  })

  test('acotado a un comercio, suma solo lo suyo', async () => {
    const [fila] = await Ledger.aggregate([
      { $group: { _id: null, total: { $sum: '$costUsd' } } },
    ]).option({ tenantId: TIENDA_A })

    expect(fila.total).toBe(3)
  })
})

describe('la salida explícita', () => {
  test('ignoreTenant cruza comercios, y es lo que usan los reportes de plataforma', async () => {
    // La excepción existe y está bien que exista: "¿cuánto va a pagar HENKO
    // este mes?" no tiene sentido comercio por comercio. Lo que importa es que
    // haya que escribirlo, y que se lea en el lugar donde se hace.
    const filas = await Ledger.find({}).setOptions({ ignoreTenant: true })

    expect(filas).toHaveLength(3)
  })

  test('sin pedirlo, nunca se cruza', async () => {
    // La contracara del anterior: el atajo tiene que ser explícito y no un
    // default. Durante mucho tiempo lo fue —NODE_ENV === 'test' lo activaba
    // solo— y por eso este archivo no podía existir.
    await expect(Ledger.find({})).rejects.toMatchObject({
      code: 'TENANT_INVALID',
    })
  })
})

describe('operaciones que antes no tenían hook', () => {
  test('findByIdAndDelete no borra la fila de otro comercio', async () => {
    const ajena = await Ledger.collection.findOne({ tenantId: TIENDA_B })

    const borrada = await Ledger.findByIdAndDelete(ajena._id).setOptions({ tenantId: TIENDA_A })

    expect(borrada).toBeNull()
    expect(await Ledger.collection.countDocuments({ _id: ajena._id })).toBe(1)
  })

  test('findOneAndDelete sin comercio se rechaza en vez de borrar cualquiera', async () => {
    await expect(Ledger.findOneAndDelete({})).rejects.toMatchObject({ code: 'TENANT_INVALID' })
    expect(await Ledger.collection.countDocuments({})).toBe(3)
  })

  test('distinct solo ve lo de su comercio', async () => {
    const costos = await Ledger.distinct('costUsd').setOptions({ tenantId: TIENDA_A })

    expect(costos.sort()).toEqual([1, 2])
  })

  test('un reemplazo no alcanza a otro comercio y conserva el propio', async () => {
    const ajena = await Ledger.collection.findOne({ tenantId: TIENDA_B })
    const propia = await Ledger.collection.findOne({ tenantId: TIENDA_A })

    const contraAjena = await Ledger.replaceOne(
      { _id: ajena._id },
      movimiento(undefined, { costUsd: 0 }),
    ).setOptions({ tenantId: TIENDA_A })
    expect(contraAjena.matchedCount).toBe(0)

    // Sin tenantId en el reemplazo, el documento no queda huérfano.
    const { tenantId, ...sinComercio } = movimiento(undefined, { costUsd: 5 })
    await Ledger.replaceOne({ _id: propia._id }, sinComercio).setOptions({ tenantId: TIENDA_A })
    const reemplazada = await Ledger.collection.findOne({ _id: propia._id })
    expect(String(reemplazada.tenantId)).toBe(String(TIENDA_A))
    expect(reemplazada.costUsd).toBe(5)
  })

  test('un reemplazo con otro comercio se rechaza', async () => {
    const propia = await Ledger.collection.findOne({ tenantId: TIENDA_A })

    await expect(
      Ledger.findOneAndReplace({ _id: propia._id }, movimiento(TIENDA_B)).setOptions({
        tenantId: TIENDA_A,
      }),
    ).rejects.toMatchObject({ code: 'TENANT_MUTATION_FORBIDDEN' })
  })

  test('insertMany no mete filas de otro comercio', async () => {
    await expect(
      Ledger.insertMany([movimiento(TIENDA_A), movimiento(TIENDA_B)], { tenantId: TIENDA_A }),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })

    expect(await Ledger.collection.countDocuments({})).toBe(3)
  })

  test('insertMany completa el comercio que falta con el del contexto', async () => {
    const { tenantId, ...sinComercio } = movimiento(undefined)

    await Ledger.insertMany([sinComercio], { tenantId: TIENDA_A })

    expect(await Ledger.collection.countDocuments({ tenantId: TIENDA_A })).toBe(3)
  })

  test('insertMany sin comercio en ningún lado se rechaza', async () => {
    const { tenantId, ...sinComercio } = movimiento(undefined)

    await expect(Ledger.insertMany([sinComercio])).rejects.toMatchObject({
      code: 'TENANT_INVALID',
    })
  })
})

describe('mover de comercio por otras vías', () => {
  test.each([
    ['$inc', { $inc: { tenantId: 1 } }],
    ['$max', { $max: { tenantId: TIENDA_B } }],
    ['un update con pipeline', [{ $set: { tenantId: TIENDA_B } }]],
    ['$replaceWith en pipeline', [{ $replaceWith: { tenantId: TIENDA_B } }]],
  ])('%s sobre tenantId se rechaza', async (_nombre, update) => {
    await expect(
      Ledger.updateMany({}, update).setOptions({ tenantId: TIENDA_A }),
    ).rejects.toMatchObject({ code: 'TENANT_MUTATION_FORBIDDEN' })
  })

  test('un update con pipeline que no toca tenantId sigue andando', async () => {
    await Ledger.updateMany({}, [{ $set: { costUsd: { $add: ['$costUsd', 10] } } }]).setOptions({
      tenantId: TIENDA_A,
    })

    const filas = await Ledger.collection.find({}).sort({ costUsd: 1 }).toArray()
    expect(filas.map(f => f.costUsd)).toEqual([11, 12, 99])
  })

  test('guardar un documento existente no lo pasa al comercio de la request', async () => {
    // Leído con la salida explícita (como un reporte de plataforma) y guardado
    // dentro de una request de otro comercio.
    const ajena = await Ledger.findOne({ tenantId: TIENDA_B }).setOptions({ ignoreTenant: true })
    ajena.costUsd = 100
    await ajena.save({ tenantId: TIENDA_A })

    const enBase = await Ledger.collection.findOne({ _id: ajena._id })
    expect(String(enBase.tenantId)).toBe(String(TIENDA_B))
    expect(enBase.costUsd).toBe(100)
  })

  test('cambiarle el comercio a un documento existente se rechaza', async () => {
    const propia = await Ledger.findOne({}).setOptions({ tenantId: TIENDA_A })
    propia.tenantId = TIENDA_B

    await expect(propia.save()).rejects.toMatchObject({ code: 'TENANT_MUTATION_FORBIDDEN' })
  })

  test('a un documento viejo sin comercio se le completa el de la request', async () => {
    // Lo que el hook hacía antes con cualquier documento: se conserva solo
    // para este caso, que no mueve nada.
    const { insertedId } = await Ledger.collection.insertOne({
      period: '2026-09',
      event: 'consumed',
      metric: 'vision',
      amount: 1,
      unit: 'units',
    })
    const huerfano = await Ledger.findById(insertedId).setOptions({ ignoreTenant: true })
    huerfano.tenantId = TIENDA_A
    await huerfano.save({ tenantId: TIENDA_A })

    const enBase = await Ledger.collection.findOne({ _id: insertedId })
    expect(String(enBase.tenantId)).toBe(String(TIENDA_A))
  })

  test('a un documento viejo sin comercio no se le puede poner otro que el de la request', async () => {
    const { insertedId } = await Ledger.collection.insertOne({
      period: '2026-09',
      event: 'consumed',
      metric: 'vision',
      amount: 1,
      unit: 'units',
    })
    const huerfano = await Ledger.findById(insertedId).setOptions({ ignoreTenant: true })
    huerfano.tenantId = TIENDA_B

    await expect(huerfano.save({ tenantId: TIENDA_A })).rejects.toMatchObject({
      code: 'TENANT_MUTATION_FORBIDDEN',
    })
  })

  test('un documento cargado sin tenantId se guarda sin tocar su comercio', async () => {
    const propia = await Ledger.findOne({}).select('costUsd').setOptions({ tenantId: TIENDA_A })
    propia.costUsd = 7
    await propia.save({ tenantId: TIENDA_A })

    const enBase = await Ledger.collection.findOne({ _id: propia._id })
    expect(String(enBase.tenantId)).toBe(String(TIENDA_A))
    expect(enBase.costUsd).toBe(7)
  })
})

describe('agregar · el $match de comercio', () => {
  test('un $match inicial de otro comercio se rechaza', async () => {
    await expect(
      Ledger.aggregate([{ $match: { tenantId: TIENDA_B } }]).option({ tenantId: TIENDA_A }),
    ).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
  })

  test('un $match de comercio que llega tarde no evita el filtro del principio', async () => {
    // Sin el filtro inicial, el $group sumaría las tres filas antes de que el
    // $match descartara nada.
    const [fila] = await Ledger.aggregate([
      { $group: { _id: null, total: { $sum: '$costUsd' }, tenantId: { $first: TIENDA_A } } },
      { $match: { tenantId: TIENDA_A } },
    ]).option({ tenantId: TIENDA_A })

    expect(fila.total).toBe(3)
  })
})
