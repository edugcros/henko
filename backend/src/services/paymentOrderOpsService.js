import Cart from '../models/cartModel.js'
import { toObjectId } from '../utils/requestContext.js'
import {
  decrementStockForLines,
  restoreStockForLines,
} from './orderInventoryService.js'
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
  })
    .setOptions({ tenantId })
    .populate(
      'products.productId',
      'tenantId title slug sku price images currency stock status visibility isDeleted hasVariants variants',
    )

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
  const reservedLines = []

  try {
    for (const line of products || []) {
      await decrementStockForLines({
        lines: [line],
        tenantId: toObjectId(tenantId),
      })
      reservedLines.push(line)
    }

    return true
  } catch (error) {
    if (reservedLines.length) {
      await restoreStockForLines({
        lines: reservedLines,
        tenantId: toObjectId(tenantId),
      })
    }

    logger.error('❌ Error reservando stock', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    throw error
  }
}

export const releaseReservedStock = async (
  products,
  tenantId,
  { session = null } = {},
) => {
  try {
    await restoreStockForLines({
      lines: products || [],
      tenantId: toObjectId(tenantId),
      session,
    })

    logger.info('✅ Stock liberado', {
      tenantId: String(tenantId),
    })
  } catch (error) {
    logger.error('❌ Error liberando stock', {
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })

    throw error
  }
}

export const confirmSoldStock = async (
  products,
  tenantId,
  { session = null } = {},
) => {
  void products
  void session

  // La reserva ya descuenta el stock canónico. Confirmar la venta sólo
  // consolida el estado de la orden y no debe volver a mutar inventario.
  logger.info('✅ Reserva de stock confirmada como venta', {
    tenantId: String(tenantId),
  })
}

export const clearUserCartAfterApprovedPayment = async ({ userId, tenantId }) => {
  try {
    await Cart.deleteOne({
      userId: toObjectId(userId),
      tenantId: toObjectId(tenantId),
    }).setOptions({ tenantId })

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
