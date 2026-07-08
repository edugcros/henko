import Cart from '../models/cartModel.js'
import { toObjectId } from '../utils/requestContext.js'
import { withOptionalTransaction } from '../utils/withOptionalTransaction.js'
import { decrementLineStock, incrementLineStock } from './orderInventoryService.js'
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

// Reserva stock descontando `stock`/`variants[].stock` (el modelo canónico de
// inventario, el mismo que usa orderInventoryService.js para el flujo COD).
// El producto no distingue "disponible" de "reservado": reservar significa
// descontar ya mismo, y liberar significa devolver esa cantidad si el pago
// termina rechazado/cancelado. Se ejecuta dentro de una transacción (cuando
// Mongo la soporta) para que, si una línea falla por falta de stock, las
// líneas ya descontadas de ese mismo intento se reviertan automáticamente.
export const reserveStockAtomic = async (products, tenantId) => {
  try {
    await withOptionalTransaction(async session => {
      for (const item of products || []) {
        await decrementLineStock({ line: item, tenantId, session })
      }
    })

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
      const result = await incrementLineStock({ line: item, tenantId })

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

// El stock ya se descontó de forma definitiva en reserveStockAtomic: el
// schema de Product no tiene un contador de "vendido" separado de `stock`,
// así que confirmar la venta no requiere ningún ajuste adicional acá.
export const confirmSoldStock = async (products, tenantId) => {
  logger.info('✅ Stock confirmado como vendido', {
    tenantId: String(tenantId),
    productsCount: products?.length || 0,
  })
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
