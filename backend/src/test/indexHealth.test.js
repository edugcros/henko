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
