// 📁 src/services/cartPricingService.js
import { resolveBestActiveProductPromotion } from './promotionalBlockService.js'

const toMoney = value => {
  const num = Number(value || 0)
  return Number(num.toFixed(2))
}

export const resolveCartPricing = async ({
  tenantId,
  product,
  variant = null,
}) => {
  const originalPrice = variant
    ? Number(variant.price || 0)
    : Number(product.price || 0)

  const promotion = await resolveBestActiveProductPromotion({
    tenantId,
    productId: product._id,
  })

  if (!promotion) {
    return {
      price: toMoney(originalPrice),
      originalPrice: toMoney(originalPrice),
      discountPercentage: 0,
      hasPromotion: false,
      promotionId: null,
      promotionTitle: null,
      promotionType: null,
    }
  }

  const discountPercentage = Math.min(
    100,
    Math.max(0, Number(promotion.discountPercentage || 0)),
  )

  const discountedPrice = originalPrice * (1 - discountPercentage / 100)

  return {
    price: toMoney(discountedPrice),
    originalPrice: toMoney(originalPrice),
    discountPercentage,
    hasPromotion: discountPercentage > 0,
    promotionId: promotion.promotionId,
    promotionTitle: promotion.promotionTitle,
    promotionType: promotion.promotionType,
  }
}