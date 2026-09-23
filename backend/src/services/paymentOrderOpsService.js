import Cart from '../models/cartModel.js'
import Order, { PAYMENT_STATUS } from '../models/orderModel.js'
import { toObjectId } from '../utils/requestContext.js'
import { withOptionalTransaction } from '../utils/withOptionalTransaction.js'
import {
  decrementLineStock,
  incrementLineStock,
  restoreStockForLines,
} from './orderInventoryService.js'
import logger from '../../config/logger.js'

const getSafeErrorMessage = error => {
  return error?.message || 'Error inesperado'
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

/**
 * Devuelve al catálogo el stock de una venta que Mercado Pago informa como
 * devuelta o contracargada.
 *
 * ESTO NO LO HACÍA NADIE
 *
 * La reposición de stock committeado vivía solo en el camino de admin
 * (orderAdminMutationService). Cuando la devolución llega del PROVEEDOR,
 * applyMercadoPagoStatusToOrder pone paymentStatus en 'refunded' y ahí
 * terminaba: las unidades quedaban vendidas para siempre, y la orden ni
 * siquiera dejaba una línea en el auditLog.
 *
 * Medido en producción: la única orden reembolsada tiene stockCommittedAt del
 * 11/09 y stockRestoredAt en null, y su auditLog no tiene ninguna entrada
 * 'refunded' — o sea que no pasó por el camino de admin. Una unidad vendida,
 * devuelta, y nunca devuelta al inventario.
 *
 * `releaseRejectedPaymentReservationIfNeeded`, acá arriba, NO cubre esto:
 * mira `stockReservedAt && !stockCommittedAt`, que es el caso contrario —una
 * RESERVA que nunca llegó a venta. Un pago aprobado siempre tiene el stock
 * committeado y la reserva limpia.
 *
 * LA CLAVE SE TOMA ANTES DE REPONER
 *
 * Mercado Pago reintenta los webhooks, y el polling de estado puede correr en
 * paralelo con uno. Reponer y después marcar dejaría una ventana en la que
 * dos ejecuciones devuelven el mismo stock: el catálogo terminaría prometiendo
 * unidades que no existen, y lo siguiente es una venta que no se puede
 * despachar. Por eso se reclama `stockRestoredAt` con un update condicional y
 * solo sigue el que lo gana.
 *
 * Si la reposición falla se suelta la marca, para que el próximo reintento lo
 * vuelva a intentar en vez de dar por hecho un stock que nunca volvió.
 */
export const restoreCommittedStockOnRefundIfNeeded = async ({ order, tenantId }) => {
  if (order.paymentStatus !== PAYMENT_STATUS.REFUNDED) return
  if (!order.stockCommittedAt || order.stockRestoredAt) return

  const claimed = await Order.findOneAndUpdate(
    {
      _id: order._id,
      tenantId: toObjectId(tenantId),
      stockRestoredAt: null,
    },
    { $set: { stockRestoredAt: new Date() } },
    { new: true },
  ).setOptions({ tenantId })

  // Otro reintento del webhook ya lo repuso.
  if (!claimed) return

  try {
    await restoreStockForLines({ lines: order.products, tenantId })

    order.stockRestoredAt = claimed.stockRestoredAt

    order.addAuditEntry?.({
      action: 'stock_restored',
      performedByRole: 'system',
      reason: 'Devolución informada por Mercado Pago',
      metadata: {
        lineas: (order.products || []).length,
        providerPaymentId: order.paymentIntent?.providerPaymentId || null,
      },
    })

    logger.info('📦 Stock devuelto al catálogo por reembolso del proveedor', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
    })
  } catch (error) {
    await Order.updateOne(
      { _id: order._id, tenantId: toObjectId(tenantId) },
      { $set: { stockRestoredAt: null } },
    )
      .setOptions({ tenantId })
      .catch(() => {})

    logger.error('❌ No se pudo devolver el stock de una orden reembolsada', {
      orderId: order._id?.toString?.(),
      tenantId: String(tenantId),
      message: getSafeErrorMessage(error),
    })
  }
}
