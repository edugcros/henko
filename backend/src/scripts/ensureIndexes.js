// 📁 src/scripts/ensureIndexes.js
//
// Detecta y crea los índices que declaran los modelos y que la base no tiene.
//
// POR QUÉ ES UN SCRIPT
//
// Producción corre con autoIndex apagado, así que ningún índice se crea solo.
// El porqué completo, y por qué importa para el dinero, está en
// services/indexHealthService.js.
//
// Uso (por defecto NO crea nada, solo informa):
//   npm run ensure:indexes
//   npm run ensure:indexes -- --apply
//
// Sale con código 1 si falta algún índice (en simulación) o si alguno no se
// pudo crear (con --apply), para poder usarlo en un chequeo de despliegue.
//
// Construir un índice sobre una colección grande consume recursos de la base:
// conviene correrlo con --apply fuera de horas pico.

import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import { ensureAllIndexes, findMissingIndexes } from '../services/indexHealthService.js'

const run = async () => {
  const apply = process.argv.includes('--apply')

  await connectDB()

  let exitCode

  if (!apply) {
    const { missing, failed, checked, drift, retainedLegacy } = await findMissingIndexes()

    logger.info('[ÍNDICES] Simulación', {
      modelos: checked,
      conFaltantes: missing.length,
      driftNoReconocido: drift.length,
      indicesLegacyRetenidos: retainedLegacy.length,
    })

    for (const item of missing) {
      logger.warn(`[ÍNDICES] Faltan en ${item.collection} (${item.model})`, {
        indices: item.indexes.map(index => ({
          nombre: index.name,
          keys: index.keys,
          unique: index.unique,
          partial: index.partial,
          blockedReason: index.blockedReason,
        })),
      })
    }

    if (drift.length) logger.warn('[ÍNDICES] Drift que requiere revisión', { drift })
    if (retainedLegacy.length) {
      logger.info('[ÍNDICES] Índices legacy retenidos; no se eliminarán en esta etapa.', {
        retainedLegacy,
      })
    }
    if (failed.length) logger.warn('[ÍNDICES] No se pudo comprobar', { failed })

    logger.info(
      missing.length || failed.length || drift.length
        ? '[ÍNDICES] Simulación terminada. Revisar el detalle antes de usar --apply.'
        : '[ÍNDICES] No hay índices faltantes ni drift no reconocido.',
    )

    exitCode = missing.length || failed.length || drift.length ? 1 : 0
  } else {
    const { created, createdIndexes, errors, drift, retainedLegacy } = await ensureAllIndexes()

    logger.info('[ÍNDICES] Índices creados', { modelos: created, createdIndexes })

    if (retainedLegacy.length) {
      // Intencionalmente no se dropean: la migración SKU tiene un paso separado
      // que crea/verifica el reemplazo y recién después retira el índice viejo.
      logger.info('[ÍNDICES] Índices legacy preservados para migración explícita.', {
        retainedLegacy,
      })
    }
    if (drift.length) logger.warn('[ÍNDICES] Drift no reconocido; no se eliminó nada.', { drift })

    for (const error of errors) {
      logger.error(`[ÍNDICES] No se pudo crear en ${error.model}`, error)
    }

    exitCode = errors.length || drift.length ? 1 : 0
  }

  await mongoose.disconnect()
  process.exit(exitCode)
}

run().catch(async error => {
  logger.error(`[ÍNDICES] Falló: ${error.stack || error.message}`)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
