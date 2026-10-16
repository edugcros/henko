// 📁 src/services/indexHealthService.js
//
// Compara los índices que declaran los modelos con los que existen en la base,
// y puede crear los que faltan.
//
// POR QUÉ HACE FALTA
//
// Producción corre con `autoIndex: false` (config/connectDB.js), así que
// Mongoose NO crea ningún índice al arrancar. Eso es lo correcto para no
// bloquear una colección grande con una construcción en el arranque, pero tiene
// una consecuencia que no se veía: si nadie los crea a mano, no existen. Y
// varias garantías de dinero viven SOLO en índices únicos —la idempotencia de
// la creación de órdenes, un id de pago por comercio, un cupón consumido una
// vez por orden, los candados de pago—. Sin el índice, el código que dice
// "el índice único lo impide" no impide nada.
//
// No era hipotético: dos de esos índices (orderModel) llevaban `$ne: null` en el
// partialFilterExpression, que MongoDB rechaza, y con autoIndex apagado el
// rechazo no se veía en ningún lado.
//
// NUNCA BORRA. `diffIndexes` también informa `toDrop`; acá solo se muestra.
// Borrar un índice por una diferencia de opciones es una decisión de una
// persona, no de un arranque.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import mongoose from 'mongoose'

import logger from '../../config/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Modelos declarados fuera de src/models: viven en el servicio que los usa.
const EXTRA_MODEL_FILES = [
  '../features/theme/themeConfigModel.js',
  './paymentConcurrencyService.js',
  './paymentWebhookService.js',
  './paymentEmailService.js',
]

/** Importa todos los modelos para que queden registrados en mongoose. */
export const loadAllModels = async () => {
  const modelsDir = path.join(__dirname, '../models')

  const files = fs
    .readdirSync(modelsDir)
    .filter(name => name.endsWith('.js') && name !== 'tenantPlugin.js')
    .map(name => path.join(modelsDir, name))

  for (const extra of EXTRA_MODEL_FILES) {
    files.push(path.join(__dirname, extra))
  }

  for (const file of files) {
    await import(pathToFileURL(file).href)
  }

  return Object.keys(mongoose.models)
}

const describeIndex = ([keys, options]) => ({
  keys,
  unique: Boolean(options?.unique),
  partial: options?.partialFilterExpression || null,
})

/**
 * Qué índices faltan por modelo. Solo lectura.
 *
 * @returns {Promise<{ missing: Array, failed: Array, checked: number }>}
 */
export const findMissingIndexes = async () => {
  await loadAllModels()

  const missing = []
  const failed = []
  let checked = 0

  for (const [name, model] of Object.entries(mongoose.models)) {
    try {
      const { toCreate = [] } = await model.diffIndexes()

      checked += 1

      if (toCreate.length) {
        const declared = new Map(
          model.schema.indexes().map(entry => [JSON.stringify(entry[0]), entry]),
        )

        missing.push({
          model: name,
          collection: model.collection.collectionName,
          indexes: toCreate.map(item => {
            const keys = item?.key || item
            const entry = declared.get(JSON.stringify(keys))

            return entry ? describeIndex(entry) : { keys }
          }),
        })
      }
    } catch (error) {
      // Colección que todavía no existe: todo lo declarado falta.
      if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) {
        const declared = model.schema.indexes()

        if (declared.length) {
          missing.push({
            model: name,
            collection: model.collection.collectionName,
            indexes: declared.map(describeIndex),
          })
        }

        checked += 1
        continue
      }

      failed.push({ model: name, message: error.message })
    }
  }

  return { missing, failed, checked }
}

/**
 * Crea los índices que faltan. Idempotente: los que ya existen no se tocan.
 *
 * Un fallo en un modelo no frena a los demás. El caso típico es un índice único
 * que choca con datos duplicados ya guardados: eso necesita que una persona
 * mire los duplicados, y no debe impedir crear el resto.
 *
 * @returns {Promise<{ created: string[], errors: Array }>}
 */
export const ensureAllIndexes = async () => {
  const { missing } = await findMissingIndexes()

  const created = []
  const errors = []

  for (const item of missing) {
    const model = mongoose.models[item.model]

    try {
      await model.createIndexes()
      created.push(item.model)
    } catch (error) {
      errors.push({
        model: item.model,
        code: error?.code || null,
        message: error.message,
      })
    }
  }

  return { created, errors, missing }
}

/**
 * Aviso de arranque: si falta algún índice declarado, que se vea en el log.
 * No crea nada y no bloquea el arranque.
 */
export const reportIndexHealth = async () => {
  try {
    const { missing, failed, checked } = await findMissingIndexes()

    if (!missing.length && !failed.length) {
      logger.info('[ÍNDICES] Todos los índices declarados existen', { modelos: checked })
      return { missing, failed, checked }
    }

    if (missing.length) {
      logger.error(
        '[ÍNDICES] Faltan índices declarados en los modelos. Varias garantías (idempotencia de órdenes, id de pago único, cupón por orden) dependen de ellos. Ejecutar: npm run ensure:indexes:prod',
        { modelos: missing.map(m => ({ modelo: m.model, indices: m.indexes.length })) },
      )
    }

    if (failed.length) {
      logger.warn('[ÍNDICES] No se pudo comprobar algún modelo', { failed })
    }

    return { missing, failed, checked }
  } catch (error) {
    logger.warn('[ÍNDICES] La comprobación de índices falló', { error: error.message })
    return null
  }
}
