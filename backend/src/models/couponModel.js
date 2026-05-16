// 📁 src/models/couponModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SOFT DELETE / REGLAS DE NEGOCIO

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// =====================================================
// CONSTANTES
// =====================================================

export const COUPON_DISCOUNT_TYPES = ['percentage', 'fixed_amount']

// =====================================================
// HELPERS
// =====================================================

const toMoney = value => {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Number(num.toFixed(2))
}

const toCents = amount => Math.round(toMoney(amount) * 100)

const normalizeCode = value => {
  return String(value || '')
    .trim()
    .toUpperCase()
}

const hasApplicableRestriction = coupon => {
  return Boolean(
    coupon.applicableProducts?.length ||
      coupon.applicableCategories?.length,
  )
}

// =====================================================
// SCHEMA
// =====================================================

const couponSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },

    code: {
      type: String,
      required: [true, 'El código del cupón es obligatorio'],
      uppercase: true,
      trim: true,
      minlength: [3, 'El código del cupón debe tener al menos 3 caracteres'],
      maxlength: [40, 'El código del cupón no puede superar 40 caracteres'],
    },

    description: {
      type: String,
      required: [true, 'La descripción es obligatoria'],
      trim: true,
      maxlength: [300, 'La descripción no puede superar 300 caracteres'],
    },

    discountType: {
      type: String,
      enum: COUPON_DISCOUNT_TYPES,
      required: [true, 'El tipo de descuento es obligatorio'],
      index: true,
    },

    discountValue: {
      type: Number,
      required: [true, 'El valor del descuento es obligatorio'],
      min: [0, 'El descuento no puede ser negativo'],
    },

    minPurchaseAmount: {
      type: Number,
      default: 0,
      min: [0, 'El mínimo de compra no puede ser negativo'],
    },

    maxDiscountAmount: {
      type: Number,
      default: null,
      min: [0, 'El descuento máximo no puede ser negativo'],
    },

    applicableProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],

    excludedProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],

    applicableCategories: [
      {
        type: String,
        trim: true,
      },
    ],

    usageLimit: {
      type: Number,
      default: null,
      min: [1, 'El límite total de uso debe ser al menos 1'],
    },

    usageCount: {
      type: Number,
      default: 0,
      min: [0, 'El conteo de uso no puede ser negativo'],
    },

    usageLimitPerUser: {
      type: Number,
      default: 1,
      min: [1, 'El límite por usuario debe ser al menos 1'],
    },

    startDate: {
      type: Date,
      required: [true, 'La fecha de inicio es obligatoria'],
      index: true,
    },

    endDate: {
      type: Date,
      required: [true, 'La fecha de finalización es obligatoria'],
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    stackable: {
      type: Boolean,
      default: false,
    },

    priority: {
      type: Number,
      default: 0,
      min: 0,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'El usuario creador es obligatorio'],
    },

    metadata: {
      totalRevenue: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalDiscountGiven: {
        type: Number,
        default: 0,
        min: 0,
      },
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// =====================================================
// INDEXES
// =====================================================

couponSchema.index({ tenantId: 1, code: 1 }, { unique: true })
couponSchema.index({ tenantId: 1, isActive: 1, isDeleted: 1, startDate: 1, endDate: 1 })
couponSchema.index({ tenantId: 1, discountType: 1, createdAt: -1 })
couponSchema.index({ tenantId: 1, applicableProducts: 1 })
couponSchema.index({ tenantId: 1, applicableCategories: 1 })
couponSchema.index({ tenantId: 1, deletedAt: -1 })

// =====================================================
// HOOKS
// =====================================================

couponSchema.pre('validate', function couponPreValidate(next) {
  try {
    this.code = normalizeCode(this.code)
    this.minPurchaseAmount = toMoney(this.minPurchaseAmount)
    this.maxDiscountAmount =
      this.maxDiscountAmount === null || this.maxDiscountAmount === undefined
        ? null
        : toMoney(this.maxDiscountAmount)
    this.discountValue = toMoney(this.discountValue)

    if (!this.code) {
      throw new Error('El código del cupón es obligatorio')
    }

    if (!this.startDate || !this.endDate) {
      throw new Error('Las fechas de inicio y fin son obligatorias')
    }

    if (new Date(this.startDate) >= new Date(this.endDate)) {
      throw new Error('La fecha de inicio debe ser anterior a la fecha de fin')
    }

    if (this.discountType === 'percentage') {
      if (this.discountValue <= 0 || this.discountValue > 100) {
        throw new Error('El porcentaje de descuento debe estar entre 0 y 100')
      }
    }

    if (this.discountType === 'fixed_amount') {
      if (this.discountValue <= 0) {
        throw new Error('El descuento fijo debe ser mayor a 0')
      }

      // Para descuentos fijos, maxDiscountAmount no aporta valor.
      this.maxDiscountAmount = null
    }

    if (
      this.maxDiscountAmount !== null &&
      this.maxDiscountAmount < 0
    ) {
      throw new Error('El descuento máximo no puede ser negativo')
    }

    if (
      this.usageLimit !== null &&
      Number(this.usageCount || 0) > Number(this.usageLimit)
    ) {
      throw new Error('usageCount no puede superar usageLimit')
    }

    if (Array.isArray(this.applicableProducts)) {
      this.applicableProducts = [...new Set(this.applicableProducts.map(String))]
    }

    if (Array.isArray(this.excludedProducts)) {
      this.excludedProducts = [...new Set(this.excludedProducts.map(String))]
    }

    if (Array.isArray(this.applicableCategories)) {
      this.applicableCategories = [...new Set(
        this.applicableCategories
          .map(value => String(value || '').trim())
          .filter(Boolean),
      )]
    }

    return next()
  } catch (error) {
    return next(error)
  }
})

// =====================================================
// VIRTUALS
// =====================================================

couponSchema.virtual('isScheduled').get(function () {
  return new Date() < this.startDate
})

couponSchema.virtual('isExpired').get(function () {
  return new Date() > this.endDate
})

couponSchema.virtual('isExhausted').get(function () {
  return this.usageLimit !== null && this.usageCount >= this.usageLimit
})

// =====================================================
// METHODS
// =====================================================

couponSchema.methods.isCurrentlyUsable = function isCurrentlyUsable(now = new Date()) {
  return Boolean(
    this.isActive &&
      !this.isDeleted &&
      now >= this.startDate &&
      now <= this.endDate &&
      (this.usageLimit === null || this.usageCount < this.usageLimit),
  )
}

couponSchema.methods.appliesToProduct = function appliesToProduct(product) {
  if (!product?._id) return false

  const productId = String(product._id)

  if (this.excludedProducts?.some(id => String(id) === productId)) {
    return false
  }

  if (!hasApplicableRestriction(this)) {
    return true
  }

  const appliesByProduct = this.applicableProducts?.some(id => String(id) === productId)
  const appliesByCategory = this.applicableCategories?.includes(product.categoria)

  return Boolean(appliesByProduct || appliesByCategory)
}

couponSchema.methods.calculateDiscountCents = function calculateDiscountCents(applicableSubtotalCents) {
  const subtotal = Number(applicableSubtotalCents || 0)

  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0

  const minPurchaseCents = toCents(this.minPurchaseAmount)

  if (subtotal < minPurchaseCents) {
    return 0
  }

  let discountCents = 0

  if (this.discountType === 'percentage') {
    discountCents = Math.round(subtotal * (this.discountValue / 100))

    if (this.maxDiscountAmount !== null) {
      discountCents = Math.min(discountCents, toCents(this.maxDiscountAmount))
    }
  } else {
    discountCents = Math.min(toCents(this.discountValue), subtotal)
  }

  return Math.min(discountCents, subtotal)
}

couponSchema.methods.softDelete = async function softDelete({ userId = null } = {}) {
  this.isDeleted = true
  this.isActive = false
  this.deletedAt = new Date()
  this.deletedBy = userId
  return this.save()
}

couponSchema.methods.restore = async function restore() {
  if (this.endDate < new Date()) {
    throw new Error('No se puede restaurar un cupón vencido')
  }

  this.isDeleted = false
  this.deletedAt = null
  this.deletedBy = null
  this.isActive = true
  return this.save()
}

// =====================================================
// STATICS
// =====================================================

couponSchema.statics.findActiveByCode = function findActiveByCode({ tenantId, code, now = new Date() }) {
  return this.findOne({
    tenantId,
    code: normalizeCode(code),
    isActive: true,
    isDeleted: false,
    startDate: { $lte: now },
    endDate: { $gte: now },
    $or: [
      { usageLimit: null },
      { usageLimit: { $exists: false } },
      { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
    ],
  }).setOptions({ tenantId })
}

// =====================================================
// TENANT PLUGIN
// =====================================================

couponSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

// =====================================================
// MODEL
// =====================================================

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema)

export default Coupon
