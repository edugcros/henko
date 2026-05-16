// 📁 src/models/CouponUsageModel.js
// VERSIÓN PRODUCCIÓN - HISTORIAL DE USO TENANT-SCOPED / SNAPSHOTS

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

const couponUsageProductSchema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    titleSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    variantKey: {
      type: String,
      default: null,
      trim: true,
    },
    selectedAttributes: {
      type: Map,
      of: String,
      default: {},
    },
    originalPriceCents: {
      type: Number,
      required: true,
      min: 0,
    },
    discountedPriceCents: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false },
)

const couponUsageSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },

    coupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
      index: true,
    },

    couponCodeSnapshot: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    discountTypeSnapshot: {
      type: String,
      enum: ['percentage', 'fixed_amount'],
      required: true,
    },

    discountValueSnapshot: {
      type: Number,
      required: true,
      min: 0,
    },

    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },

    products: {
      type: [couponUsageProductSchema],
      default: [],
    },

    originalAmountCents: {
      type: Number,
      required: true,
      min: 0,
    },

    discountAmountCents: {
      type: Number,
      required: true,
      min: 0,
    },

    finalAmountCents: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    appliedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    ipAddress: {
      type: String,
      default: null,
      trim: true,
    },

    userAgent: {
      type: String,
      default: null,
      trim: true,
    },
  },
  {
    timestamps: true,
  },
)

// =====================================================
// INDEXES
// =====================================================

couponUsageSchema.index({ tenantId: 1, coupon: 1, user: 1, appliedAt: -1 })
couponUsageSchema.index({ tenantId: 1, order: 1 }, { unique: true })
couponUsageSchema.index({ tenantId: 1, appliedAt: -1 })

// =====================================================
// HOOKS
// =====================================================

couponUsageSchema.pre('validate', function couponUsagePreValidate(next) {
  if (this.finalAmountCents !== this.originalAmountCents - this.discountAmountCents) {
    return next(new Error('Los montos del uso de cupón son inconsistentes'))
  }

  return next()
})

// =====================================================
// TENANT PLUGIN
// =====================================================

couponUsageSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

// =====================================================
// MODEL
// =====================================================

const CouponUsage =
  mongoose.models.CouponUsage || mongoose.model('CouponUsage', couponUsageSchema)

export default CouponUsage
