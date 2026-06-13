import mongoose from 'mongoose'

import connectDB from '../../config/connectDB.js'
import logger from '../../config/logger.js'
import Product from '../models/productModel.js'
import { upsertSubcategoryVariantTemplate } from '../services/catalogCategoryService.js'

const run = async () => {
  await connectDB()

  const cursor = Product.find({
    isDeleted: { $ne: true },
    categoria: { $type: 'string', $ne: '' },
    subcategoria: { $type: 'string', $ne: '' },
  })
    .setOptions({ ignoreTenant: true })
    .select({
      tenantId: 1,
      categoria: 1,
      subcategoria: 1,
      variantAttributes: 1,
      variants: 1,
    })
    .lean()
    .cursor()

  let processed = 0
  let synchronized = 0
  let failed = 0

  for await (const product of cursor) {
    processed += 1

    try {
      await upsertSubcategoryVariantTemplate({
        tenantId: product.tenantId,
        category: product.categoria,
        subcategory: product.subcategoria,
        variantAttributes: product.variantAttributes,
        variants: product.variants,
      })
      synchronized += 1
    } catch (error) {
      failed += 1
      logger.error('Error sincronizando plantilla histórica de producto', {
        error: error.message,
        productId: String(product._id),
        tenantId: String(product.tenantId),
      })
    }
  }

  logger.info('Backfill de plantillas de variantes finalizado', {
    failed,
    processed,
    synchronized,
  })

  if (failed > 0) {
    process.exitCode = 1
  }
}

run()
  .catch(error => {
    logger.error(`Backfill de catálogo falló: ${error.stack || error.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
