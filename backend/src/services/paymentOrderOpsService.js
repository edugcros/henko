import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import { toObjectId } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const getSafeErrorMessage = error => {
  return error?.message || 'Error inesperado'
}

export const validateCartBelongsToTenant = async (cartId, userId, tenantId) => {
  const cart = await Cart.findOne({
    _id: toObjectId(cartId),
    userId: toObjectId(userId),
    tenantId: toObjectId(tenantId),
    isDeleted: false,
  }).populate('products.productId', 'tenantId title price images currency quantity stock')

  if (!cart) {
    throw new Error('CARRITO_NO_ENCONTRADO')
  }

  if (!cart.products?.length) {
    throw new Error('CARRITO_VACIO')
  }

  for (const item of cart.products) {
    const product = item.productId

    if (!product) {
      throw new Error(`PRODUCTO_NO_ENCONTRADO: ${item.productId}`)
    }

    const productTenantId = product.tenantId || item.tenantId

    if (productTenantId && String(productTenantId) !== String(tenantId)) {
      logger.error('🚨 PRODUCTO_CROSS_TENANT', {
        productId: product._id?.toString?.(),
        productTenantId: String(productTenantId),
        cartTenantId: String(tenantId),
      })

      throw new Error('PRODUCTO_INVALIDO: Producto no pertenece a este comercio')
    }
  }

  return cart
}

export const reserveStockAtomic = async (products, tenantId) => {
  const reservedProducts = []

  try {
    for (const item of products || []) {
      const result = await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: toObjectId(tenantId),
          isDeleted: false,
          quantity: { $gte: item.count },
        },
        {
          $inc: {
            quantity: -item.count,
            reserved: item.count,
          },
        },
        { new: true },
      )

      if (!result) {
        for (const reserved of reservedProducts) {
          await Product.findOneAndUpdate(
            {
              _id: reserved.productId,
              tenantId: toObjectId(tenantId),
              reserved: { $gte: reserved.count },
            },
            {
              $inc: {
                quantity: reserved.count,
                reserved: -reserved.count,
              },
            },
          )
        }

        throw new Error(`STOCK_INSUFFICIENT: ${item.titleSnapshot || item.product}`)
      }

      reservedProducts.push({
        productId: item.product,
        count: item.count,
      })
    }

    return true
  } catch (error) {
    logger.error('❌ Error reservando stock', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    throw error
  }
}

export const releaseReservedStock = async (products, tenantId) => {
  try {
    for (const item of products || []) {
      const result = await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: toObjectId(tenantId),
          reserved: { $gte: item.count },
        },
        {
          $inc: {
            quantity: item.count,
            reserved: -item.count,
          },
        },
        { new: true },
      )

      if (!result) {
        logger.warn('⚠️ No se pudo liberar stock reservado', {
          tenantId: String(tenantId),
          productId: item.product?.toString?.() || String(item.product),
          count: item.count,
        })
      }
    }

    logger.info('✅ Stock liberado', {
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error liberando stock', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })
  }
}

export const confirmSoldStock = async (products, tenantId) => {
  try {
    for (const item of products || []) {
      const result = await Product.findOneAndUpdate(
        {
          _id: item.product,
          tenantId: toObjectId(tenantId),
          reserved: { $gte: item.count },
        },
        {
          $inc: {
            reserved: -item.count,
            sold: item.count,
          },
        },
        { new: true },
      )

      if (!result) {
        logger.warn('⚠️ No se pudo confirmar stock vendido', {
          tenantId: String(tenantId),
          productId: item.product?.toString?.() || String(item.product),
          count: item.count,
        })
      }
    }

    logger.info('✅ Stock confirmado como vendido', {
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error confirmando venta', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    throw error
  }
}

export const clearUserCartAfterApprovedPayment = async ({ userId, tenantId }) => {
  try {
    await Cart.deleteOne({
      userId: toObjectId(userId),
      tenantId: toObjectId(tenantId),
    })

    logger.info('🧹 Carrito limpiado tras pago aprobado', {
      userId: String(userId),
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error limpiando carrito post-pago', {
      userId: String(userId),
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })
  }
}
