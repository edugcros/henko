// src/services/indexHealthService.js
//
// Auditoría y creación controlada de índices MongoDB.
//
// Principios de seguridad:
// - Nunca elimina documentos ni índices.
// - En producción, no usa syncIndexes() ni crea índices al arrancar.
// - Inspecciona cada índice faltante por separado.
// - Si un índice con el mismo nombre existe con opciones incompatibles,
//   bloquea esa creación y devuelve un diagnóstico accionable.
// - Un fallo en un índice/modelo no impide revisar los demás.
//
// La migración de un índice existente a unique:true debe planificarse aparte:
// este servicio no elimina automáticamente el índice anterior.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mongoose from 'mongoose'
import logger from '../../config/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Modelos declarados fuera de src/models.
const EXTRA_MODEL_FILES = [
  '../features/theme/themeConfigModel.js',
  './paymentConcurrencyService.js',
  './paymentWebhookService.js',
  './paymentEmailService.js',
]

const NAMESPACE_NOT_FOUND_CODES = new Set([26])

const isNamespaceNotFound = error =>
  NAMESPACE_NOT_FOUND_CODES.has(error?.code) ||
  error?.codeName === 'NamespaceNotFound' ||
  /ns not found|namespace .* not found/i.test(String(error?.message || ''))

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// Ordena recursivamente las claves para comparar expresiones BSON/JSON sin
// depender del orden de las propiedades de objetos anidados.
const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isPlainObject(value)) {
    if (value instanceof Date) return value.toISOString()
    if (value?._bsontype === 'ObjectId') return String(value)
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])]),
  )
}

const stableStringify = value => JSON.stringify(stableValue(value))

// El orden de los campos del key pattern es significativo para MongoDB.
const sameKeyPattern = (left, right) => {
  if (!isPlainObject(left) || !isPlainObject(right)) return false

  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value,
    )
  )
}

const defaultIndexName = keys =>
  Object.entries(keys || {})
    .map(([field, direction]) => `${field}_${String(direction)}`)
    .join('_')

const indexNameFor = definition => definition?.options?.name || defaultIndexName(definition?.keys)

// Estas son las opciones que afectan habitualmente la semántica o la
// compatibilidad del índice. Las diferencias de opciones no se corrigen
// eliminando el índice existente: se informan y se bloquea la creación.
const SEMANTIC_INDEX_OPTIONS = [
  'unique',
  'sparse',
  'partialFilterExpression',
  'expireAfterSeconds',
  'collation',
  'hidden',
  'wildcardProjection',
  'weights',
  'default_language',
  'language_override',
  'textIndexVersion',
  '2dsphereIndexVersion',
  'bits',
  'min',
  'max',
  'bucketSize',
]

const optionValue = (options, key) => {
  if (key === 'unique' || key === 'sparse' || key === 'hidden') {
    return Boolean(options?.[key])
  }

  return options?.[key] ?? null
}

const sameSemanticOptions = (left = {}, right = {}) =>
  SEMANTIC_INDEX_OPTIONS.every(
    key => stableStringify(optionValue(left, key)) === stableStringify(optionValue(right, key)),
  )

const isSameIndexDefinition = (existing, desired) =>
  Boolean(existing && desired) &&
  sameKeyPattern(existing.key, desired.keys) &&
  sameSemanticOptions(existing, desired.options)

const safeCreateOptions = options => {
  const result = { ...(options || {}) }
  // MongoDB moderno ignora background; se omite para evitar depender de una
  // opción histórica. Las opciones semánticas se preservan.
  delete result.background
  return result
}

/**
 * Convierte las entradas que devuelve Mongoose diffIndexes() a una definición
 * de índice con keys y options. Si no puede asociarla con el schema, la deja
 * bloqueada; jamás adivina opciones como unique o partialFilterExpression.
 */
const resolveIndexDefinition = (model, diffEntry, existingIndexes = []) => {
  const hasKeyProperty = isPlainObject(diffEntry) && isPlainObject(diffEntry.key)
  const keys = hasKeyProperty ? diffEntry.key : diffEntry

  if (!isPlainObject(keys) || Object.keys(keys).length === 0) {
    return {
      keys: null,
      options: {},
      blockedReason: 'Mongoose devolvió una definición de índice inválida.',
    }
  }

  const diffOptions = hasKeyProperty
    ? Object.fromEntries(Object.entries(diffEntry).filter(([key]) => key !== 'key'))
    : {}

  const candidates = model.schema
    .indexes()
    .filter(([schemaKeys]) => sameKeyPattern(schemaKeys, keys))

  if (candidates.length === 0) {
    return {
      keys,
      options: diffOptions,
      blockedReason:
        'No se pudo asociar el índice faltante con una declaración del schema; creación bloqueada por seguridad.',
    }
  }

  // Primero, las opciones que trajo el propio diff. Cuando vienen, desempatan
  // sin adivinar nada.
  const porOpciones = Object.keys(diffOptions).length
    ? candidates.filter(([, schemaOptions]) =>
        Object.entries(diffOptions).every(
          ([key, value]) =>
            stableStringify(schemaOptions?.[key] ?? null) === stableStringify(value ?? null),
        ),
      )
    : candidates

  /**
   * DOS DECLARACIONES CON LA MISMA CLAVE, Y ELEGIR LA PRIMERA OCULTABA UN
   * ÍNDICE ÚNICO QUE NO EXISTE.
   *
   * `tenantPlugin` agrega `{ tenantId: 1 }` a casi todos los modelos, y
   * algunos declaran ADEMÁS `{ tenantId: 1 }` con `unique`. El schema queda
   * entonces con dos entradas de la misma clave y distinta semántica.
   *
   * Cuando `diffIndexes()` informa la clave PELADA —sin opciones, que es lo
   * que hace— `diffOptions` queda vacío y `[].every()` devuelve true para la
   * PRIMERA candidata. Se elegía la del plugin, sin `unique`; el índice
   * físico no único la satisfacía; se marcaba `alreadyExists` y el índice
   * único desaparecía del informe.
   *
   * Medido contra producción: `PricingPolicy.tenantId` tiene índice NO único
   * mientras el modelo lo declara `unique: true`. La versión anterior de este
   * archivo lo reportaba como faltante; con el desempate por la primera, el
   * informe decía que estaba todo bien. Una garantía sin efecto y además
   * invisible — exactamente lo que este servicio existe para evitar.
   *
   * El desempate correcto no es "la primera" ni "la más restrictiva" (las dos
   * son adivinar): es la que el índice FÍSICO todavía no satisface. Si
   * diffIndexes dice que falta algo, lo que falta es justamente la
   * declaración que difiere de lo que hay. Y si quedan varias, no se elige:
   * se bloquea y se informa.
   */
  const noSatisfechas = porOpciones.filter(
    ([schemaKeys, schemaOptions]) =>
      !existingIndexes.some(existing =>
        isSameIndexDefinition(existing, { keys: schemaKeys, options: schemaOptions || {} }),
      ),
  )

  const finalistas = noSatisfechas.length > 0 ? noSatisfechas : porOpciones

  if (finalistas.length > 1) {
    return {
      keys,
      options: diffOptions,
      blockedReason:
        `El schema declara ${finalistas.length} índices con la misma clave y semántica distinta; ` +
        'no se puede deducir cuál falta. Creación bloqueada: resolvé la ambigüedad en el modelo.',
    }
  }

  const [, schemaOptions] = finalistas[0] || porOpciones[0] || candidates[0]

  return {
    keys,
    options: { ...(schemaOptions || {}), ...diffOptions },
    blockedReason: null,
  }
}

const inspectExistingIndexes = async model => {
  try {
    return await model.collection.listIndexes().toArray()
  } catch (error) {
    if (isNamespaceNotFound(error)) return []
    throw error
  }
}

const describeIndex = (definition, existingIndexes = []) => {
  const name = indexNameFor(definition)
  const sameName = existingIndexes.find(index => index.name === name)
  let blockedReason = definition.blockedReason || null

  if (!blockedReason && sameName && !isSameIndexDefinition(sameName, definition)) {
    blockedReason =
      `Ya existe el índice "${name}" con keys u opciones incompatibles. ` +
      'No se modificó ni eliminó; requiere una migración explícita.'
  }

  const alreadyExists = Boolean(sameName && isSameIndexDefinition(sameName, definition))

  return {
    keys: definition.keys,
    name,
    unique: Boolean(definition.options?.unique),
    partial: definition.options?.partialFilterExpression || null,
    options: definition.options,
    alreadyExists,
    blockedReason,
  }
}

/** Importa todos los modelos para registrarlos en Mongoose. */
export const loadAllModels = async () => {
  const modelsDir = path.join(__dirname, '../models')

  if (!fs.existsSync(modelsDir)) {
    throw new Error(`No existe el directorio de modelos: ${modelsDir}`)
  }

  const files = fs
    .readdirSync(modelsDir)
    .filter(name => name.endsWith('.js') && name !== 'tenantPlugin.js')
    .sort()
    .map(name => path.join(modelsDir, name))

  for (const relativeFile of EXTRA_MODEL_FILES) {
    const file = path.join(__dirname, relativeFile)
    // Algunos extras pueden no estar en ciertas variantes del proyecto. No se
    // omiten en silencio: se registra un aviso útil y se continúa con los que
    // existen. Un archivo que sí existe pero falla al importar hará fallar la
    // operación y quedará en el diagnóstico del script llamador.
    if (!fs.existsSync(file)) {
      logger.warn('[ÍNDICES] Archivo extra de modelos no encontrado', {
        archivo: relativeFile,
      })
      continue
    }
    files.push(file)
  }

  for (const file of [...new Set(files)]) {
    await import(pathToFileURL(file).href)
  }

  return Object.keys(mongoose.models)
}

/**
 * Compara las definiciones de los modelos con MongoDB. Solo lectura.
 * No crea ni elimina índices.
 *
 * @returns {Promise<{missing: Array, failed: Array, checked: number, drift: Array}>}
 */
export const findMissingIndexes = async () => {
  await loadAllModels()

  const missing = []
  const failed = []
  const drift = []
  let checked = 0

  for (const [name, model] of Object.entries(mongoose.models)) {
    try {
      const diff = await model.diffIndexes()
      const toCreate = Array.isArray(diff?.toCreate) ? diff.toCreate : []
      const toDrop = Array.isArray(diff?.toDrop) ? diff.toDrop : []
      const existingIndexes = await inspectExistingIndexes(model)

      checked += 1

      // Los índices físicos se le pasan al resolutor porque los necesita para
      // desempatar entre dos declaraciones con la misma clave: la que falta
      // es la que lo existente todavía no satisface.
      const indexes = toCreate.map(entry =>
        describeIndex(resolveIndexDefinition(model, entry, existingIndexes), existingIndexes),
      )

      // Si otro proceso creó el índice después de diffIndexes(), no se informa
      // como pendiente si su definición semántica ya coincide.
      const pending = indexes.filter(index => !index.alreadyExists)

      if (pending.length > 0) {
        missing.push({
          model: name,
          collection: model.collection.collectionName,
          indexes: pending,
          toDrop,
        })
      }

      if (toDrop.length > 0) {
        drift.push({
          model: name,
          collection: model.collection.collectionName,
          indexesToDrop: toDrop,
          actionTaken: 'none',
        })
      }
    } catch (error) {
      if (isNamespaceNotFound(error)) {
        // Una colección inexistente no tiene índices físicos; se reportan todos
        // los declarados como pendientes sin tocar la base.
        const declared = model.schema
          .indexes()
          .map(([keys, options]) => describeIndex({ keys, options, blockedReason: null }, []))

        checked += 1
        if (declared.length > 0) {
          missing.push({
            model: name,
            collection: model.collection.collectionName,
            indexes: declared,
            toDrop: [],
          })
        }
        continue
      }

      failed.push({ model: name, message: error?.message || String(error) })
    }
  }

  return { missing, failed, checked, drift }
}

/**
 * Crea individualmente los índices faltantes y no conflictivos.
 *
 * Seguridad:
 * - No usa Model.createIndexes() para no volver a intentar todos los índices
 *   del modelo de una sola vez.
 * - Nunca llama dropIndex(), dropIndexes() ni syncIndexes().
 * - Un índice que choque por clave/nombre/opciones se registra como error y se
 *   omite, dejando la migración en manos de un procedimiento explícito.
 *
 * @returns {Promise<{created: string[], createdIndexes: Array, errors: Array, missing: Array, drift: Array}>}
 */
export const ensureAllIndexes = async () => {
  const { missing, failed, checked, drift } = await findMissingIndexes()
  const created = []
  const createdIndexes = []
  const errors = failed.map(item => ({
    model: item.model,
    code: null,
    phase: 'diffIndexes',
    message: item.message,
  }))

  for (const item of missing) {
    const model = mongoose.models[item.model]
    if (!model) {
      errors.push({
        model: item.model,
        code: null,
        message: 'El modelo no está registrado; se omitió la creación.',
      })
      continue
    }

    let modelCreated = false

    for (const index of item.indexes) {
      if (index.alreadyExists) continue

      if (index.blockedReason) {
        errors.push({
          model: item.model,
          index: index.name,
          code: 'INDEX_CONFLICT',
          message: index.blockedReason,
        })
        continue
      }

      if (!index.keys || !isPlainObject(index.options)) {
        errors.push({
          model: item.model,
          index: index.name,
          code: 'INVALID_INDEX_DEFINITION',
          message: 'Definición de índice incompleta; se omitió la creación por seguridad.',
        })
        continue
      }

      try {
        // Revalidar justo antes de crear para reducir la posibilidad de una
        // carrera con otro proceso de migración.
        const existingIndexes = await inspectExistingIndexes(model)
        const current = describeIndex(
          { keys: index.keys, options: index.options, blockedReason: null },
          existingIndexes,
        )

        if (current.alreadyExists) continue

        if (current.blockedReason) {
          errors.push({
            model: item.model,
            index: index.name,
            code: 'INDEX_CONFLICT',
            message: current.blockedReason,
          })
          continue
        }

        const options = safeCreateOptions(index.options)
        const actualName = await model.collection.createIndex(index.keys, options)

        modelCreated = true
        createdIndexes.push({
          model: item.model,
          collection: item.collection,
          index: actualName || index.name,
          keys: index.keys,
          unique: Boolean(options.unique),
        })
      } catch (error) {
        errors.push({
          model: item.model,
          index: index.name,
          code: error?.code ?? null,
          codeName: error?.codeName ?? null,
          message: error?.message || String(error),
        })
      }
    }

    if (modelCreated) created.push(item.model)
  }

  return { created, createdIndexes, errors, missing, checked, drift }
}

/** Aviso de arranque/health check: solo informa; nunca modifica índices. */
export const reportIndexHealth = async () => {
  try {
    const { missing, failed, checked, drift } = await findMissingIndexes()
    const blockedCount = missing.reduce(
      (total, item) => total + item.indexes.filter(index => index.blockedReason).length,
      0,
    )

    if (!missing.length && !failed.length && !drift.length) {
      logger.info('[ÍNDICES] Todos los índices declarados están sincronizados', {
        modelos: checked,
      })
      return { missing, failed, checked, drift }
    }

    if (missing.length) {
      logger.error(
        '[ÍNDICES] Hay índices declarados que faltan. No se crearon ni eliminaron índices durante esta comprobación.',
        {
          modelos: missing.map(item => ({
            modelo: item.model,
            indicesFaltantes: item.indexes.length,
            indicesBloqueados: item.indexes.filter(index => index.blockedReason).length,
          })),
          blockedCount,
        },
      )
    }

    if (drift.length) {
      logger.warn(
        '[ÍNDICES] Hay índices físicos que difieren del schema. Requieren revisión explícita; no se eliminaron.',
        { drift },
      )
    }

    if (failed.length) {
      logger.warn('[ÍNDICES] No se pudo comprobar algún modelo', { failed })
    }

    return { missing, failed, checked, drift }
  } catch (error) {
    logger.warn('[ÍNDICES] La comprobación de índices falló', {
      error: error?.message || String(error),
    })
    return null
  }
}
