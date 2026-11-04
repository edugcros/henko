// 📁 src/test/indexHealth.test.js
//
// Que la auditoría de índices NO declare sana una garantía que no existe.
//
// EL CASO QUE LA ORIGINÓ, MEDIDO EN PRODUCCIÓN
//
// `tenantPlugin` agrega `{ tenantId: 1 }` a casi todos los modelos, y algunos
// declaran ADEMÁS `{ tenantId: 1 }` con `unique`. El schema queda entonces con
// dos entradas de la misma clave y distinta semántica — pasa en PricingPolicy,
// AiTenantPolicy y ThemeConfig.
//
// `diffIndexes()` informa la clave PELADA, sin opciones. Al desempatar con
// `[].every()`, que devuelve true, se elegía la PRIMERA candidata: la del
// plugin, sin `unique`. El índice físico no único la satisfacía, se marcaba
// `alreadyExists` y el índice único desaparecía del informe.
//
// Contra la base real: `pricingpolicies` tiene `tenantId_1` NO único mientras
// el modelo lo declara `unique: true`. La auditoría decía que estaba todo
// bien. Una garantía sin efecto y además invisible, que es exactamente lo que
// este servicio existe para evitar.
//
// Contra base real y no con mocks: lo que se prueba es cómo se comporta
// `diffIndexes()` de Mongoose frente a índices físicos concretos, y con un
// mock se probaría el mock.

import mongoose from 'mongoose'
import { crearMongoEnMemoria } from './testDB.js'

process.env.AI_AGENT_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64url')

const { findMissingIndexes } = await import('../services/indexHealthService.js')

let mongod

beforeAll(async () => {
  mongod = await crearMongoEnMemoria()
  await mongoose.connect(mongod.getUri())
}, 180000)

afterAll(async () => {
  await mongoose.disconnect()
  await mongod?.stop()
})

/**
 * Un modelo con la MISMA ambigüedad que los reales: la clave declarada dos
 * veces, una pelada y otra única.
 */
const crearModeloAmbiguo = nombre => {
  // `autoIndex: false` es imprescindible, y además es lo que hace producción
  // (config/connectDB.js). Con él encendido Mongoose construye los índices
  // declarados apenas se usa el modelo, así que la prueba no podría montar el
  // estado que quiere medir: el índice único ya estaría creado antes de mirar.
  const schema = new mongoose.Schema(
    { tenantId: mongoose.Schema.Types.ObjectId, valor: String },
    { autoIndex: false },
  )

  // El orden importa: la pelada va PRIMERA, que es como la deja tenantPlugin
  // y es justo el orden con el que el desempate viejo se equivocaba.
  schema.index({ tenantId: 1 })
  schema.index({ tenantId: 1 }, { unique: true })

  return mongoose.model(nombre, schema)
}

const faltantesDe = async nombreModelo => {
  const { missing } = await findMissingIndexes()
  return missing.find(m => m.model === nombreModelo)?.indexes || []
}

describe('auditoría de índices · declaraciones ambiguas', () => {
  test('con un índice NO único presente, el único sigue informándose', async () => {
    // EL CASO DE PricingPolicy EN PRODUCCIÓN.
    const Modelo = crearModeloAmbiguo('AmbiguoConPlano')

    await Modelo.collection.createIndex({ tenantId: 1 })

    const indices = await faltantesDe('AmbiguoConPlano')

    // No puede quedar vacío: eso sería afirmar que la unicidad está cubierta.
    expect(indices.length).toBeGreaterThan(0)

    const unico = indices.find(i => i.unique)

    expect(unico).toBeDefined()
    // Y se informa BLOQUEADO, no como creable: ya hay un índice con ese
    // nombre y otra semántica, así que crear a secas fallaría. Hace falta
    // una migración explícita, y el servicio no borra índices.
    expect(unico.blockedReason).toMatch(/incompatible/i)
  })

  test('con el índice único YA presente, no se informa nada', async () => {
    // El contrapeso: si la garantía está, el informe tiene que quedar limpio.
    // Sin este caso, el test de arriba pasaría con un servicio que reporta
    // todo siempre.
    const Modelo = crearModeloAmbiguo('AmbiguoConUnico')

    await Modelo.collection.createIndex({ tenantId: 1 }, { unique: true })

    const indices = await faltantesDe('AmbiguoConUnico')
    const unico = indices.find(i => i.unique && !i.blockedReason)

    expect(unico).toBeUndefined()
  })

  test('sin ningún índice, no adivina cuál de las dos crear: bloquea', async () => {
    // Sin nada físico, las dos declaraciones compiten y ninguna está
    // satisfecha. Elegir una sería adivinar, y crear la equivocada deja la
    // garantía sin efecto igual que antes — con el agravante de que el
    // informe diría que se creó.
    //
    // La salida correcta es bloquear y mandar a arreglar el modelo. El
    // repositorio ya resolvió esto una vez: aiTenantPolicyModel le da nombre
    // propio al índice único para que ambos puedan convivir.
    const Modelo = crearModeloAmbiguo('AmbiguoSinNada')

    await Modelo.createCollection()

    const indices = await faltantesDe('AmbiguoSinNada')

    expect(indices.length).toBeGreaterThan(0)
    expect(indices[0].blockedReason).toMatch(/misma clave/i)
  })

  test('con nombre propio dejan de competir y el único se crea', async () => {
    // La solución del lado del modelo, que es la de fondo: con nombres
    // distintos los dos índices pueden existir a la vez y no hay ambigüedad
    // que resolver.
    const schema = new mongoose.Schema(
      { tenantId: mongoose.Schema.Types.ObjectId },
      { autoIndex: false },
    )

    schema.index({ tenantId: 1 })
    schema.index({ tenantId: 1 }, { unique: true, name: 'conNombre_tenant_unique' })

    const Modelo = mongoose.model('ConNombrePropio', schema)
    await Modelo.createCollection()
    await Modelo.collection.createIndex({ tenantId: 1 })

    const indices = await faltantesDe('ConNombrePropio')
    const unico = indices.find(i => i.name === 'conNombre_tenant_unique')

    expect(unico).toBeDefined()
    expect(unico.unique).toBe(true)
    // Creable: su nombre no choca con nada de lo que ya hay.
    expect(unico.blockedReason).toBeNull()
  })
})

describe('índice del SKU de productos', () => {
  let Product
  let SKU_INDEX_NAME
  let migrateSkuIndex
  let LEGACY_SKU_INDEX_NAME

  const tenantA = new mongoose.Types.ObjectId()
  const tenantB = new mongoose.Types.ObjectId()
  const producto = (tenantId, extra = {}) => ({
    tenantId,
    title: 'Remera',
    slug: `remera-${new mongoose.Types.ObjectId()}`,
    description: 'Remera de algodón',
    marca: 'Henko',
    categoria: 'Indumentaria',
    subcategoria: 'Remeras',
    price: 1000,
    ...extra,
  })

  beforeAll(async () => {
    ;({ default: Product, SKU_INDEX_NAME } = await import('../models/productModel.js'))
    ;({ migrateSkuIndex, LEGACY_SKU_INDEX_NAME } = await import('../scripts/migrateSkuIndex.js'))
    await Product.syncIndexes()
  })

  beforeEach(async () => {
    await Product.collection.deleteMany({})
  })

  test('dos productos sin SKU en la misma tienda conviven', async () => {
    // Con el índice viejo (sparse en un compuesto) el segundo fallaba con E11000.
    await Product.collection.insertOne(producto(tenantA))
    await Product.collection.insertOne(producto(tenantA, { sku: null }))

    // Y por el modelo: un SKU vacío se normaliza a "sin SKU".
    await new Product(producto(tenantA, { sku: '  ' })).save()

    expect(await Product.collection.countDocuments({ tenantId: tenantA })).toBe(3)
  })

  test('el SKU sigue siendo único dentro de cada tienda, no entre tiendas', async () => {
    await Product.collection.insertOne(producto(tenantA, { sku: 'REM-01' }))
    await Product.collection.insertOne(producto(tenantB, { sku: 'REM-01' }))

    await expect(
      Product.collection.insertOne(producto(tenantA, { sku: 'REM-01' })),
    ).rejects.toMatchObject({ code: 11000 })
  })

  test('retiene el SKU legacy y reporta el reemplazo faltante sin eliminar índices', async () => {
    // Simula exactamente el estado de producción: legacy presente, parcial
    // nuevo todavía ausente.
    await Product.collection.dropIndex(SKU_INDEX_NAME)
    await Product.collection.createIndex(
      { tenantId: 1, sku: 1 },
      { name: LEGACY_SKU_INDEX_NAME, unique: true, sparse: true },
    )

    try {
      const { missing, retainedLegacy, drift } = await findMissingIndexes()
      const legacy = retainedLegacy.find(
        index => index.model === 'Product' && index.name === LEGACY_SKU_INDEX_NAME,
      )
      const productMissing = missing.find(item => item.model === 'Product')
      const replacement = productMissing?.indexes.find(index => index.name === SKU_INDEX_NAME)

      expect(legacy).toMatchObject({
        model: 'Product',
        collection: Product.collection.collectionName,
        name: LEGACY_SKU_INDEX_NAME,
        unique: true,
        sparse: true,
        retained: true,
        actionTaken: 'none',
        replacement: {
          name: SKU_INDEX_NAME,
          keys: { tenantId: 1, sku: 1 },
        },
        migration: 'npm run migrate:sku-index:prod:apply',
      })
      expect(replacement).toMatchObject({
        name: SKU_INDEX_NAME,
        keys: { tenantId: 1, sku: 1 },
        unique: true,
        partial: { sku: { $type: 'string' } },
        blockedReason: null,
      })
      expect(drift.some(item => item.model === 'Product')).toBe(false)

      // La comprobación es de solo lectura: el legacy sigue en MongoDB y el
      // índice nuevo aún no fue creado por el auditor.
      const indexes = await Product.collection.listIndexes().toArray()
      expect(indexes.some(index => index.name === LEGACY_SKU_INDEX_NAME)).toBe(true)
      expect(indexes.some(index => index.name === SKU_INDEX_NAME)).toBe(false)
    } finally {
      await Product.collection.dropIndex(LEGACY_SKU_INDEX_NAME).catch(() => undefined)
      await Product.syncIndexes()
    }
  })

  describe('migración del índice viejo', () => {
    let coleccion

    beforeEach(async () => {
      coleccion = mongoose.connection.db.collection(`sku_migracion_${Date.now()}`)
      await coleccion.insertOne({ tenantId: tenantA })
    })

    afterEach(async () => {
      await coleccion.drop().catch(() => undefined)
    })

    const nombres = async () => (await coleccion.indexes()).map(index => index.name).sort()

    test('simula sin tocar nada, migra con apply y después no hace nada', async () => {
      await coleccion.createIndex({ tenantId: 1, sku: 1 }, { unique: true, sparse: true })

      expect(await migrateSkuIndex({ collection: coleccion })).toMatchObject({ action: 'plan' })
      expect(await nombres()).toEqual(['_id_', LEGACY_SKU_INDEX_NAME])

      expect(await migrateSkuIndex({ collection: coleccion, apply: true })).toEqual({
        action: 'migrated',
        createdReplacement: true,
        droppedLegacy: true,
      })
      expect(await nombres()).toEqual(['_id_', SKU_INDEX_NAME])

      const [nuevo] = (await coleccion.indexes()).filter(i => i.name === SKU_INDEX_NAME)
      expect(nuevo).toMatchObject({
        unique: true,
        partialFilterExpression: { sku: { $type: 'string' } },
      })

      expect(await migrateSkuIndex({ collection: coleccion, apply: true })).toMatchObject({
        action: 'nothing',
      })
    })

    test('si el nuevo ya existe (lo creó ensure:indexes), solo borra el viejo', async () => {
      await coleccion.createIndex({ tenantId: 1, sku: 1 }, { unique: true, sparse: true })
      await coleccion.createIndex(
        { tenantId: 1, sku: 1 },
        {
          unique: true,
          name: SKU_INDEX_NAME,
          partialFilterExpression: { sku: { $type: 'string' } },
        },
      )

      expect(await migrateSkuIndex({ collection: coleccion, apply: true })).toMatchObject({
        action: 'migrated',
        createdReplacement: false,
      })
      expect(await nombres()).toEqual(['_id_', SKU_INDEX_NAME])
    })

    test('si ya hay un índice con el nombre nuevo pero no es el esperado, no borra el viejo', async () => {
      await coleccion.createIndex({ tenantId: 1, sku: 1 }, { unique: true, sparse: true })
      // Mismo nombre, no único: borrar el viejo dejaría la tienda sin unicidad.
      await coleccion.createIndex(
        { tenantId: 1, sku: 1 },
        { name: SKU_INDEX_NAME, partialFilterExpression: { sku: { $type: 'string' } } },
      )

      for (const apply of [false, true]) {
        await expect(migrateSkuIndex({ collection: coleccion, apply })).rejects.toMatchObject({
          code: 'UNEXPECTED_REPLACEMENT_INDEX',
        })
      }
      expect(await nombres()).toEqual(['_id_', LEGACY_SKU_INDEX_NAME, SKU_INDEX_NAME].sort())
    })

    test('si el viejo no es el esperado, frena sin tocar nada', async () => {
      await coleccion.createIndex({ tenantId: 1, sku: 1 }, { sparse: true })

      await expect(migrateSkuIndex({ collection: coleccion, apply: true })).rejects.toMatchObject({
        code: 'UNEXPECTED_LEGACY_INDEX',
      })
      expect(await nombres()).toEqual(['_id_', LEGACY_SKU_INDEX_NAME])
    })

    test('si no puede crear el nuevo, el viejo queda', async () => {
      await coleccion.createIndex({ tenantId: 1, sku: 1 }, { unique: true, sparse: true })
      // Que falle la creación (en producción, por ejemplo, un corte de red).
      const fallaAlCrear = new Proxy(coleccion, {
        get: (target, prop) =>
          prop === 'createIndex'
            ? () => Promise.reject(new Error('sin conexión'))
            : target[prop].bind(target),
      })

      await expect(migrateSkuIndex({ collection: fallaAlCrear, apply: true })).rejects.toThrow(
        'sin conexión',
      )
      expect(await nombres()).toEqual(['_id_', LEGACY_SKU_INDEX_NAME])
    })
  })
})
