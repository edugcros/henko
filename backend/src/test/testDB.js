import mongoose from 'mongoose'

// Sufijo obligatorio de la base de pruebas.
//
// ESTO NO ES COSMÉTICO. `disconnectTestDB` borra la base entera, y sin
// MONGODB_TEST_URI configurada esta conexión caía a MONGODB_URL — la base de
// DESARROLLO. O sea que correr la suite completa borraba la base local de
// trabajo, en silencio y sin que nada en el nombre de la función lo sugiriera.
//
// Ahora la base de pruebas se deriva de la de desarrollo agregándole el sufijo,
// así que sale gratis (mismo servidor, mismo replica set, misma configuración) y
// no hay forma de que apunte a la de trabajo por olvidarse una variable.
const TEST_DB_SUFFIX = '-test'

/**
 * La URI de pruebas, con el nombre de base forzado a terminar en `-test`.
 *
 * Se manipula la parte de la ruta y se dejan intactos el host, las credenciales
 * y la query (`?replicaSet=rs0` es la que habilita transacciones, y perderla
 * rompería la mitad de las pruebas de pedidos).
 */
export const resolveTestDbUri = () => {
  const raw = String(
    process.env.MONGODB_TEST_URI ||
      process.env.MONGO_TEST_URI ||
      process.env.MONGODB_URL ||
      process.env.MONGO_URI ||
      '',
  ).trim()

  if (!raw.startsWith('mongodb')) {
    throw new Error('Cadena de conexión Mongo inválida. Verifica MONGODB_TEST_URI o MONGO_TEST_URI')
  }

  // `mongodb+srv://` no lo entiende URL sin ayuda, y acá solo hace falta separar
  // la ruta de lo demás.
  const [beforeQuery, query] = raw.split('?')
  const separator = beforeQuery.indexOf('/', beforeQuery.indexOf('://') + 3)

  const authority = separator === -1 ? beforeQuery : beforeQuery.slice(0, separator)
  const dbName = separator === -1 ? '' : beforeQuery.slice(separator + 1)

  if (!dbName) {
    throw new Error(
      'La cadena de conexión de pruebas no nombra una base de datos: no se puede derivar una de test.',
    )
  }

  const testDbName = dbName.endsWith(TEST_DB_SUFFIX) ? dbName : `${dbName}${TEST_DB_SUFFIX}`

  return `${authority}/${testDbName}${query ? `?${query}` : ''}`
}

export const connectTestDB = async () => {
  if (mongoose.connection.readyState === 1) return

  await mongoose.connect(resolveTestDbUri())
}

/**
 * Vacía colecciones antes de una prueba, cruzando comercios a propósito.
 *
 * Un `Model.deleteMany()` pelado ya no funciona acá, y está bien que no
 * funcione: el plugin de aislamiento dejó de apagarse con NODE_ENV=test, así
 * que una consulta sin comercio en contexto falla en las pruebas igual que en
 * producción. Ese atajo volvía indetectable una fuga entre comercios, que es la
 * propiedad sobre la que descansa todo el modelo multi-tenant.
 *
 * Limpiar la base SÍ cruza comercios por definición, así que se declara como
 * cualquier otro cruce legítimo: con ignoreTenant y el motivo al lado. Se pone
 * en un solo lugar para que ninguna prueba tenga que aprender a escribirlo.
 */
export const resetCollections = async (...models) => {
  for (const model of models) {
    await model.deleteMany({}).setOptions({
      ignoreTenant: true,
      platformScope: 'limpieza de la base entre pruebas',
    })
  }
}

export const disconnectTestDB = async () => {
  if (mongoose.connection.readyState === 0) return

  // Última barrera antes de un borrado. Si por lo que sea la conexión no es la
  // base de pruebas, se cierra sin borrar nada: perder el estado de una prueba
  // es un inconveniente, perder una base de trabajo no.
  if (mongoose.connection.name?.endsWith(TEST_DB_SUFFIX)) {
    await mongoose.connection.dropDatabase()
  }

  await mongoose.connection.close()
}

// =====================================================
// Mongo en memoria
// =====================================================

/**
 * Cuánto se le da a `mongod` para levantar antes de darlo por fallado.
 *
 * POR QUÉ NO ALCANZABAN LOS 10 SEGUNDOS QUE TRAE POR DEFECTO
 *
 * Veintisiete suites levantan y apagan su propio `mongod`, y como la suite
 * corre con `--runInBand` son veintisiete arranques en fila dentro de la misma
 * corrida. En una máquina ocupada —un antivirus mirando el binario, la caché
 * de disco fría, un build corriendo al lado— alguno se pasa de diez segundos y
 * la suite entera se cae con:
 *
 *   GenericMMSError: Instance failed to start within 10000ms
 *
 * Medido: pasó con `aiReconciliation`, que tiró sus 39 pruebas y volvió a
 * pasar sola al correrla aislada. Eso es lo peor de un verde inestable — no se
 * distingue de un rojo real hasta que se investiga.
 *
 * Cuatro suites ya pasaban este mismo valor, agregado a mano cuando les falló
 * a ellas. Acá queda en un solo lugar y con el motivo escrito.
 *
 * Subir el techo no hace más lenta ninguna corrida: si `mongod` arranca en
 * trescientos milisegundos, arranca en trescientos milisegundos. Lo único que
 * cambia es cuánto se espera antes de declararlo muerto.
 */
const ARRANQUE_MONGO_MS = 60000

export const crearMongoEnMemoria = async (opciones = {}) => {
  const { MongoMemoryServer } = await import('mongodb-memory-server')

  return MongoMemoryServer.create({
    ...opciones,
    instance: { launchTimeout: ARRANQUE_MONGO_MS, ...opciones.instance },
  })
}

export const crearReplicaEnMemoria = async (opciones = {}) => {
  const { MongoMemoryReplSet } = await import('mongodb-memory-server')

  return MongoMemoryReplSet.create({
    replSet: { count: 1, ...opciones.replSet },
    ...opciones,
    instanceOpts: opciones.instanceOpts || [{ launchTimeout: ARRANQUE_MONGO_MS }],
  })
}

/**
 * Espera a que una lectura cumpla una condición, en vez de dormir un rato fijo
 * y cruzar los dedos.
 *
 * POR QUÉ
 *
 * Varias pruebas esperaban con `setTimeout` un plazo elegido a ojo y después
 * afirmaban sobre la base. Eso es una carrera: en una máquina ocupada el plazo
 * se queda corto y la prueba falla sin que nada esté roto — la clase de verde
 * inestable que no se distingue de un rojo real.
 *
 * Sondear invierte el trato: termina apenas la condición se cumple, así que es
 * MÁS rápido en el caso normal, y aguanta mucho más cuando la máquina está
 * lenta. Y cuando se agota, dice cuál fue el último valor visto, que es lo que
 * uno necesita para entender por qué.
 *
 * No sirve para afirmar que algo NO pasó: eso no se puede sondear y hay que
 * esperar un plazo de verdad.
 */
export const esperarA = async (leer, cumple, { timeoutMs = 10000, pasoMs = 20 } = {}) => {
  const limite = Date.now() + timeoutMs
  let ultimo

  for (;;) {
    ultimo = await leer()

    if (cumple(ultimo)) return ultimo

    if (Date.now() >= limite) {
      throw new Error(
        `La condición no se cumplió en ${timeoutMs}ms. Último valor leído: ${JSON.stringify(ultimo)}`,
      )
    }

    await new Promise(resolve => setTimeout(resolve, pasoMs))
  }
}
