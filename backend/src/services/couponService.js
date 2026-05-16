import Coupon from '../models/couponModel.js'
import CouponUsage from '../models/CouponUsageModel.js'
import { generateUniqueCode } from '../utils/codeGenerator.js'
import mongoose from 'mongoose'

class CouponService {
  async createCoupon(couponData, userId) {
    if (new Date(couponData.endDate) <= new Date(couponData.startDate)) {
      throw new Error('La fecha de fin debe ser posterior a la de inicio')
    }

    if (couponData.discountType === 'percentage' && couponData.discountValue > 100) {
      throw new Error('El porcentaje de descuento no puede exceder 100%')
    }

    if (!couponData.code) {
      couponData.code = await generateUniqueCode(Coupon, couponData.prefix || '', 8)
    } else {
      const exists = await Coupon.findOne({ code: couponData?.code })
      if (exists) throw new Error('El código de cupón ya existe')
    }

    const coupon = new Coupon({
      ...couponData,
      code: couponData?.code,
      createdBy: userId,
    })

    return await coupon.save()
  }

  async validateCoupon(code, userId, cartItems, subtotal) {
    const coupon = await Coupon.findOne({ code: code.toUpperCase() })
      .populate('applicableProducts', 'name price')
      .populate('excludedProducts', '_id')

    if (!coupon) throw new Error('Cupón no encontrado')
    
    if (!coupon.isValid()) {
      throw new Error('El cupón ha expirado o no está activo')
    }

    if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
      throw new Error('Este cupón ha alcanzado su límite de usos')
    }

    const userUsageCount = await CouponUsage.countDocuments({ 
      coupon: coupon._id, 
      user: userId, 
    })
    
    if (userUsageCount >= coupon.usageLimitPerUser) {
      throw new Error(`Has alcanzado el límite de usos (${coupon.usageLimitPerUser}) para este cupón`)
    }

    let applicableSubtotal = 0
    const applicableItems = []
    const inapplicableItems = []

    for (const item of cartItems) {
      const isApplicable = this.#isProductApplicable(coupon, item.product)
      if (isApplicable) {
        applicableSubtotal += item.price * item.quantity
        applicableItems.push(item)
      } else {
        inapplicableItems.push(item)
      }
    }

    if (applicableSubtotal === 0) {
      throw new Error('Este cupón no aplica a ningún producto en tu carrito')
    }

    if (applicableSubtotal < coupon.minPurchaseAmount) {
      throw new Error(`El monto mínimo para aplicar este cupón es ${coupon.minPurchaseAmount}`)
    }

    const discountAmount = coupon.calculateDiscount(applicableSubtotal)

    return {
      coupon,
      isValid: true,
      applicableSubtotal,
      discountAmount,
      finalAmount: subtotal - discountAmount,
      applicableItems,
      inapplicableItems,
      message: `Descuento de ${discountAmount.toFixed(2)} aplicado`,
    }
  }

  #isProductApplicable(coupon, product) {
    if (coupon.excludedProducts.some(ep => ep._id.toString() === product._id.toString())) {
      return false
    }

    if (!coupon.applicableProducts || coupon.applicableProducts.length === 0) {
      if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
        return coupon.applicableCategories.includes(product.category)
      }
      return true
    }

    return coupon.applicableProducts.some(ap => ap._id.toString() === product._id.toString())
  }

  async applyCoupon(code, userId, orderId, cartItems, subtotal, metadata = {}) {
    const session = await mongoose.startSession()
    
    try {
      let result
      
      await session.withTransaction(async () => {
        const validation = await this.validateCoupon(code, userId, cartItems, subtotal)
        
        if (!validation.isValid) {
          throw new Error(validation.message)
        }

        const { coupon, discountAmount } = validation

        await Coupon.findByIdAndUpdate(
          coupon._id,
          { 
            $inc: { 
              usageCount: 1,
              'metadata.totalDiscountGiven': discountAmount, 
            },
          },
          { session },
        )

        const usage = new CouponUsage({
          coupon: coupon._id,
          user: userId,
          order: orderId,
          products: cartItems.map(item => ({
            product: item.product._id,
            originalPrice: item.price,
            discountedPrice: item.price * (1 - (discountAmount / validation.applicableSubtotal)),
            quantity: item.quantity,
          })),
          originalAmount: subtotal,
          discountAmount,
          finalAmount: subtotal - discountAmount,
          ipAddress: metadata.ip,
          userAgent: metadata.userAgent,
        })

        await usage.save({ session })
        result = { success: true, discountAmount, usage }
      })

      return result
    } finally {
      await session.endSession()
    }
  }

  async getCouponStats(couponId) {
    const stats = await CouponUsage.aggregate([
      { $match: { coupon: new mongoose.Types.ObjectId(couponId) } },
      {
        $group: {
          _id: null,
          totalUses: { $sum: 1 },
          totalDiscount: { $sum: '$discountAmount' },
          totalRevenue: { $sum: '$finalAmount' },
          avgOrderValue: { $avg: '$originalAmount' },
        },
      },
    ])

    return stats[0] || null
  }
}

export default new CouponService()