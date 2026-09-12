// 📁 src/services/aiAgent/aiAbandonedCartDetectorService.js
import Cart from '../../models/cartModel.js'
import Tenant from '../../models/tenantModel.js'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import {
  createCartRecoveryFromCart,
  getCartRecoveryReadiness,
} from './aiCartRecoveryService.js'

const toSafeNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const getCartProducts = cart => {
  return Array.isArray(cart?.products) ? cart.products : []
}

const RECOVERY_ACTIVE_STATUSES = Object.freeze([
  'pending',
  'scheduled',
  'processing',
  'sent',
  'responded',
  'converted',
])

const CART_FINAL_STATUSES = Object.freeze([
  'converted',
  'completed',
  'checked_out',
  'ordered',
  'cancelled',
])

const serializeId = value => {
  return value ? String(value) : null
}

export const detectAbandonedCarts = async ({
  olderThanMinutes = 30,
  limit = 50,
  tenantId = null,
} = {}) => {
  const safeOlderThanMinutes = Math.min(
    Math.max(toSafeNumber(olderThanMinutes, 30), 5),
    60 * 24 * 30,
  )
  const safeLimit = Math.min(Math.max(toSafeNumber(limit, 50), 1), 250)
  const threshold = new Date(Date.now() - safeOlderThanMinutes * 60 * 1000)

  const query = {
    updatedAt: { $lte: threshold },
    'products.0': { $exists: true },
    $or: [
      { status: { $exists: false } },
      { status: null },
      { status: '' },
      { status: { $nin: CART_FINAL_STATUSES } },
    ],
    ...(tenantId ? { tenantId } : {}),
  }

  const carts = await Cart.find(query)
    .setOptions(tenantId ? { tenantId } : { ignoreTenant: true })
    .sort({ updatedAt: 1 })
    .limit(safeLimit)
    .lean()

  const results = []

  // Por qué NO se recupera, cuando no se recupera.
  //
  // Antes, un comercio con el canal de WhatsApp apagado o sin regla activa
  // hacía que createCartRecoveryFromCart devolviera null y el ciclo siguiera
  // sin dejar rastro: cada 60 segundos, en silencio. Ahora el motivo queda en
  // el resultado del ciclo, que es lo que el worker registra.
  //
  // Se consulta una vez por comercio por ciclo y se recuerda: el barrido cruza
  // comercios y no tiene sentido repetir la misma consulta por cada carrito.
  const readinessByTenant = new Map()

  const readinessFor = async tenantIdOfCart => {
    const key = String(tenantIdOfCart)

    if (!readinessByTenant.has(key)) {
      readinessByTenant.set(key, await getCartRecoveryReadiness({ tenantId: tenantIdOfCart }))
    }

    return readinessByTenant.get(key)
  }

  for (const cart of carts) {
    try {
      if (!cart?.tenantId || !cart?._id) continue
      if (getCartProducts(cart).length === 0) continue

      const readiness = await readinessFor(cart.tenantId)

      if (!readiness.ready) {
        results.push({
          cartId: serializeId(cart._id),
          tenantId: serializeId(cart.tenantId),
          status: 'skipped',
          reason: readiness.reason,
        })
        continue
      }

      const existing = await AiCartRecovery.findOne({
        tenantId: cart.tenantId,
        cartId: serializeId(cart._id),
        status: {
          $in: RECOVERY_ACTIVE_STATUSES,
        },
      }).setOptions({ tenantId: cart.tenantId })

      if (existing) continue

      const tenant = await Tenant.findById(cart.tenantId)
        .setOptions({ ignoreTenant: true })
        .lean()

      if (!tenant) {
        results.push({
          cartId: serializeId(cart._id),
          status: 'skipped',
          reason: 'tenant_not_found',
        })
        continue
      }

      const recovery = await createCartRecoveryFromCart({
        tenantId: cart.tenantId,
        tenant,
        cart,
        userId: cart.userId || cart.user || cart.orderby || null,
      })

      if (recovery) {
        results.push({
          cartId: serializeId(cart._id),
          recoveryId: serializeId(recovery._id),
          status: 'scheduled',
        })
        continue
      }

      // Llegó hasta acá con todo prendido: lo que falta es del carrito, no de
      // la configuración. El caso típico es un carrito sin usuario asociado o
      // un usuario sin teléfono, y hasta ahora también era invisible.
      results.push({
        cartId: serializeId(cart._id),
        tenantId: serializeId(cart.tenantId),
        status: 'skipped',
        reason: 'cart_without_reachable_contact',
      })
    } catch (error) {
      results.push({
        cartId: cart?._id,
        status: 'failed',
        error: error?.message || 'unknown_error',
      })
    }
  }

  return results
}
