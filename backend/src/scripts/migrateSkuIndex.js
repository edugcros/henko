// 📁 src/scripts/migrateSkuIndex.js
//
// Reemplaza el índice único del SKU de productos por uno que solo cuenta los
// productos que TIENEN SKU.
//
// POR QUÉ EXISTE
//
// El viejo, `tenantId_1_sku_1`, era `{ unique: true, sparse: true }`. En un
// índice compuesto sparse no excluye nada (tenantId existe siempre), así que
// todos los productos sin SKU de una tienda chocaban entre sí: el segundo
// fallaba con E11000. El nuevo es parcial (`sku` de tipo string) y lleva otro
// nombre; el porqué completo está junto a su declaración en productModel.js.
//
// POR QUÉ NO LO HACE ensure:indexes
//
// ensure:indexes crea el nuevo (otro nombre, no choca), pero nunca borra un
// índice, a propósito. Mientras el viejo siga, la restricción vieja sigue
// rigiendo. Este script es el paso explícito que lo borra.
//
// EN QUÉ ORDEN, Y POR QUÉ ES SEGURO
//
// 1. Crea el nuevo si falta. Si hay SKUs repetidos dentro de una tienda la
//    creación falla y no se toca nada más (no puede pasar mientras el viejo
//    exista, porque ya los impide).
// 2. Recién con el nuevo en pie, borra el viejo. Ningún momento queda sin
//    unicidad de SKU.
//
// Es idempotente: con el viejo ya borrado, no hace nada.
//
// Uso (por defecto NO cambia nada, solo informa):
//   npm run migrate:sku-index
//   npm run migrate:sku-index:apply
//   npm run migrate:sku-index:prod        (simulación contra producción)
//   npm run migrate:sku-index:prod:apply

import { pathToFileURL } from 'node:url'
import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import Product, { SKU_INDEX_NAME } from '../models/productModel.js'

export const LEGACY_SKU_INDEX_NAME = 'tenantId_1_sku_1'

const isSkuKey = key =>
  JSON.stringify(Object.entries(key || {})) ===
  JSON.stringify([
    ['tenantId', 1],
    ['sku', 1],
  ])

/**
 * @param {object} params
 * @param {import('mongodb').Collection} params.collection La de productos, del
 *   driver crudo: es una corrección de plataforma, cruza todas las tiendas.
 * @param {boolean} params.apply Sin él solo informa qué haría.
 * @returns {Promise<{action: 'nothing'|'plan'|'migrated', createdReplacement: boolean, droppedLegacy: boolean}>}
 */
export const migrateSkuIndex = async ({ collection, apply = false }) => {
  const indexes = await collection.indexes()
  const legacy = indexes.find(index => index.name === LEGACY_SKU_INDEX_NAME)
  const replacement = indexes.find(index => index.name === SKU_INDEX_NAME)

  if (!legacy) {
    return { action: 'nothing', createdReplacement: false, droppedLegacy: false }
  }

  // Solo se borra el índice que este script conoce. Si alguien lo cambió a
  // mano, mejor frenar que borrar algo que no se entiende.
  if (!isSkuKey(legacy.key) || !legacy.unique || legacy.partialFilterExpression) {
    const error = new Error(
      `El índice "${LEGACY_SKU_INDEX_NAME}" no es el esperado (único y sin filtro sobre tenantId+sku). No se tocó nada.`,
    )
    error.code = 'UNEXPECTED_LEGACY_INDEX'
    throw error
  }

  if (!apply) {
    return { action: 'plan', createdReplacement: !replacement, droppedLegacy: true }
  }

  const [keys, options] = Product.schema
    .indexes()
    .find(([, indexOptions]) => indexOptions?.name === SKU_INDEX_NAME)

  if (!replacement) {
    await collection.createIndex(keys, options)
  }

  // Se vuelve a mirar en la base antes de borrar: el viejo solo se va si el
  // nuevo está realmente creado.
  const created = (await collection.indexes()).some(index => index.name === SKU_INDEX_NAME)
  if (!created) {
    throw new Error(`No se encontró "${SKU_INDEX_NAME}" después de crearlo. No se borró el viejo.`)
  }

  await collection.dropIndex(LEGACY_SKU_INDEX_NAME)

  return { action: 'migrated', createdReplacement: !replacement, droppedLegacy: true }
}

const run = async () => {
  const apply = process.argv.includes('--apply')

  await connectDB()

  const result = await migrateSkuIndex({ collection: Product.collection, apply })

  logger.info(
    {
      nothing: '[MIGRACIÓN sku] El índice viejo ya no existe. Nada que hacer.',
      plan: '[MIGRACIÓN sku] Simulación: usar --apply para migrar.',
      migrated: '[MIGRACIÓN sku] Listo.',
    }[result.action],
    {
      indiceNuevo: SKU_INDEX_NAME,
      seCreaElNuevo: result.createdReplacement,
      seBorraElViejo: result.droppedLegacy,
    },
  )

  await mongoose.disconnect()
}

// Solo corre al ejecutarse como script; importado (en los tests) solo expone la
// función.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(async error => {
    logger.error('[MIGRACIÓN sku] Falló', { error: error.message, code: error.code })
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
}
