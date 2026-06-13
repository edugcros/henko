// 📁 src/services/aiAgent/aiAbandonedCartDetectorService.js
// Detector adaptado a Henko: Cart.products, userId, tenantId, updatedAt.
import Cart from '../../models/cartModel.js'
import Tenant from '../../models/tenantModel.js'
import AiCartRecovery from '../../models/aiCartRecoveryModel.js'
import { createCartRecoveryFromCart } from './aiCartRecoveryService.js'

export const detectAbandonedCarts = async ({
  olderThanMinutes = 30,
  limit = 50,
} = {}) => {
  const threshold = new Date(Date.now() - Number(olderThanMinutes) * 60 * 1000)

  const carts = await Cart.find({
    updatedAt: { $lte: threshold },
    products: { $exists: true, $ne: [] },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean()

  const results = []

  for (const cart of carts) {
    try {
      if (!cart?.tenantId || !cart?._id) continue

      const existing = await AiCartRecovery.findOne({
        tenantId: cart.tenantId,
        cartId: cart._id,
        status: {
          $in: ['pending', 'scheduled', 'sent', 'responded', 'converted'],
        },
      }).setOptions({ tenantId: cart.tenantId })

      if (existing) continue

      const tenant = await Tenant.findById(cart.tenantId).lean()

      const recovery = await createCartRecoveryFromCart({
        tenantId: cart.tenantId,
        tenant,
        cart,
        userId: cart.userId || cart.user || cart.orderby || null,
      })

      if (recovery) {
        results.push({
          cartId: cart._id,
          recoveryId: recovery._id,
          status: 'scheduled',
        })
      }
    } catch (error) {
      results.push({
        cartId: cart?._id,
        status: 'failed',
        error: error.message,
      })
    }
  }

  return results
}
