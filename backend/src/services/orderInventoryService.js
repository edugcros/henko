import Product from '../models/productModel.js'

const buildStockFieldMode = product => {
  if (Object.prototype.hasOwnProperty.call(product, 'quantity')) {
    return 'quantity'
  }

  return 'stock'
}

export const decrementLineStock = async ({ line, tenantId, session = null }) => {
  const baseFilter = {
    _id: line.product,
    tenantId,
    isDeleted: { $ne: true },
  }

  let product

  if (line.variantId) {
    product = await Product.findOneAndUpdate(
      {
        ...baseFilter,
        variants: {
          $elemMatch: {
            _id: line.variantId,
            isActive: true,
            stock: { $gte: line.count },
          },
        },
        $or: [
          { stock: { $gte: line.count } },
          { quantity: { $gte: line.count } },
        ],
      },
      {
        $inc: {
          'variants.$.stock': -line.count,
          stock: -line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  } else {
    const existingProduct = await Product.findOne(baseFilter)
      .setOptions({ tenantId })
      .session(session)
      .lean()

    if (!existingProduct) {
      throw new Error(`Producto no disponible: ${line.titleSnapshot}`)
    }

    const stockField = buildStockFieldMode(existingProduct)

    product = await Product.findOneAndUpdate(
      {
        ...baseFilter,
        [stockField]: { $gte: line.count },
      },
      {
        $inc: {
          [stockField]: -line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  }

  if (!product) {
    throw new Error(
      `Stock insuficiente o producto no disponible: ${line.titleSnapshot}`,
    )
  }

  const remainingStock = Number(product.stock ?? product.quantity ?? 0)

  if (remainingStock <= 0 && product.status === 'active') {
    product.status = 'out-of-stock'
    await product.save({ session, tenantId })
  }

  return product
}

export const incrementLineStock = async ({ line, tenantId, session = null }) => {
  const baseFilter = {
    _id: line.product,
    tenantId,
    isDeleted: { $ne: true },
  }

  let product

  if (line.variantId) {
    product = await Product.findOneAndUpdate(
      {
        ...baseFilter,
        'variants._id': line.variantId,
      },
      {
        $inc: {
          'variants.$.stock': line.count,
          stock: line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  } else {
    const existingProduct = await Product.findOne(baseFilter)
      .setOptions({ tenantId })
      .session(session)
      .lean()

    if (!existingProduct) return null

    const stockField = buildStockFieldMode(existingProduct)

    product = await Product.findOneAndUpdate(
      baseFilter,
      {
        $inc: {
          [stockField]: line.count,
        },
      },
      {
        new: true,
        session,
      },
    ).setOptions({ tenantId })
  }

  const currentStock = Number(product?.stock ?? product?.quantity ?? 0)

  if (product && currentStock > 0 && product.status === 'out-of-stock') {
    product.status = 'active'
    await product.save({ session, tenantId })
  }

  return product
}

export const decrementStockForLines = async ({
  lines,
  tenantId,
  session = null,
}) => {
  for (const line of lines) {
    await decrementLineStock({ line, tenantId, session })
  }
}

export const restoreStockForLines = async ({
  lines,
  tenantId,
  session = null,
}) => {
  for (const line of lines) {
    await incrementLineStock({ line, tenantId, session })
  }
}
