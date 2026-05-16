// 📁 src/models/promotionalBlockModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / SOFT DELETE / PRICING PROMOCIONAL

import mongoose from 'mongoose'
import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// =====================================================
// CONSTANTES
// =====================================================

export const PROMOTIONAL_BLOCK_TYPES = [
  'weekly_offers',
  'featured_products',
  'new_arrivals',
  'clearance',
  'seasonal_campaign',
  'custom',
]

export const PROMOTIONAL_BLOCK_PLACEMENTS = [
  'home',
  'category',
  'product_detail',
  'cart',
  'checkout',
]

export const PROMOTIONAL_BLOCK_VISIBILITIES = ['public', 'hidden']

// =====================================================
// HELPERS
// =====================================================

const normalizePriority = value => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 1
  return Math.min(100, Math.max(1, Math.trunc(num)))
}

const normalizeDiscountPercentage = value => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.min(100, Math.max(0, num))
}

const assertUniqueProducts = products => {
  const seen = new Set()

  for (const item of products || []) {
    const productId = String(item?.productId || '')

    if (!productId) continue

    if (seen.has(productId)) {
      throw new Error('No se puede repetir el mismo producto dentro de un bloque promocional.')
    }

    seen.add(productId)
  }
}

// =====================================================
// SUB-SCHEMA
// =====================================================

const promotionalProductSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },

    customTitle: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },

    customLabel: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },

    discountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    priority: {
      type: Number,
      min: 1,
      max: 100,
      default: 1,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  },
)

// =====================================================
// MAIN SCHEMA
// =====================================================

const promotionalBlockSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },

    title: {
      type: String,
      required: [true, 'El título es obligatorio'],
      trim: true,
      maxlength: 120,
    },

    slug: {
      type: String,
      required: [true, 'El slug es obligatorio'],
      lowercase: true,
      trim: true,
      maxlength: 140,
    },

    type: {
      type: String,
      enum: PROMOTIONAL_BLOCK_TYPES,
      default: 'custom',
      index: true,
    },

    placement: {
      type: String,
      enum: PROMOTIONAL_BLOCK_PLACEMENTS,
      default: 'home',
      index: true,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },

    /**
     * Hasta 20 productos administrables.
     * maxItems define cuántos se muestran públicamente, no cuántos se pueden cargar.
     */
    products: {
      type: [promotionalProductSchema],
      default: [],
      validate: {
        validator(items) {
          return Array.isArray(items) && items.length <= 20
        },
        message: 'Un bloque promocional no puede tener más de 20 productos.',
      },
    },

    maxItems: {
      type: Number,
      min: 1,
      max: 20,
      default: 5,
    },

    priority: {
      type: Number,
      min: 1,
      max: 100,
      default: 1,
      index: true,
    },

    startDate: {
      type: Date,
      required: [true, 'La fecha de inicio es obligatoria'],
      index: true,
    },

    endDate: {
      type: Date,
      required: [true, 'La fecha de fin es obligatoria'],
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    visibility: {
      type: String,
      enum: PROMOTIONAL_BLOCK_VISIBILITIES,
      default: 'public',
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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

promotionalBlockSchema.index(
  { tenantId: 1, slug: 1 },
  { unique: true },
)

promotionalBlockSchema.index({
  tenantId: 1,
  placement: 1,
  type: 1,
  isDeleted: 1,
  isActive: 1,
  visibility: 1,
  startDate: 1,
  endDate: 1,
  priority: 1,
})

promotionalBlockSchema.index({
  tenantId: 1,
  isDeleted: 1,
  updatedAt: -1,
})

promotionalBlockSchema.index({
  tenantId: 1,
  'products.productId': 1,
})

// =====================================================
// HOOKS
// =====================================================

promotionalBlockSchema.pre('validate', function promotionalBlockPreValidate(next) {
  try {
    if (this.startDate && this.endDate && this.endDate <= this.startDate) {
      throw new Error('La fecha de fin debe ser posterior a la fecha de inicio.')
    }

    this.maxItems = normalizePriority(this.maxItems)
    this.priority = normalizePriority(this.priority)

    for (const item of this.products || []) {
      item.priority = normalizePriority(item.priority)
      item.discountPercentage = normalizeDiscountPercentage(item.discountPercentage)
    }

    assertUniqueProducts(this.products)

    return next()
  } catch (error) {
    return next(error)
  }
})

// =====================================================
// METHODS
// =====================================================

promotionalBlockSchema.methods.isCurrentlyPublic = function isCurrentlyPublic(now = new Date()) {
  return Boolean(
    !this.isDeleted &&
      this.isActive &&
      this.visibility === 'public' &&
      now >= this.startDate &&
      now <= this.endDate,
  )
}

promotionalBlockSchema.methods.softDelete = async function softDelete({ userId = null } = {}) {
  this.isDeleted = true
  this.isActive = false
  this.deletedAt = new Date()
  this.deletedBy = userId
  this.updatedBy = userId
  return this.save()
}

// =====================================================
// TENANT PLUGIN
// =====================================================

promotionalBlockSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

// =====================================================
// MODEL
// =====================================================

const PromotionalBlock =
  mongoose.models.PromotionalBlock ||
  mongoose.model('PromotionalBlock', promotionalBlockSchema)

export default PromotionalBlock
