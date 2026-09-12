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
    throw new Error(
      'Cadena de conexión Mongo inválida. Verifica MONGODB_TEST_URI o MONGO_TEST_URI',
    )
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
