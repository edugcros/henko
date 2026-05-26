// 📁 src/models/productModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / VARIANTES / STOCK / SOFT DELETE

import mongoose from 'mongoose'

import { tenantPlugin } from './tenantPlugin.js'

const { Schema } = mongoose

// =====================================================
// CONSTANTES
// =====================================================

const DEFAULT_CURRENCY = 'ARS'
const DEFAULT_IMAGE_ALT = ''
const ALLOWED_VARIANT_ATTRIBUTE_TYPES = ['select', 'color', 'text']
const ALLOWED_PRODUCT_CONDITIONS = ['nuevo', 'usado', 'reacondicionado']
const ALLOWED_PRODUCT_STATUSES = ['active', 'draft', 'archived', 'out-of-stock']
const ALLOWED_PRODUCT_VISIBILITIES = ['visible', 'hidden']

// =====================================================
// HELPERS
// =====================================================

const toMoney = value => {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Number(num.toFixed(2))
}

const toNonNegativeInteger = value => {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.trunc(num)
}

const normalizeText = value => {
  return typeof value === 'string' ? value.trim() : value
}

const normalizeKeyPart = value => {
  return String(value || '')
    .trim()
    .toLowerCase()
}

const normalizeTags = tags => {
  if (!Array.isArray(tags)) return []

  return [...new Set(
    tags
      .filter(value => value !== undefined && value !== null)
      .map(value => String(value).trim().toLowerCase())
      .filter(Boolean),
  )]
}

const normalizeAttributesObject = attributes => {
  if (!attributes) return {}

  if (attributes instanceof Map) {
    return Object.fromEntries(
      [...attributes.entries()]
        .filter(([key, value]) => key && value !== undefined && value !== null)
        .map(([key, value]) => [normalizeKeyPart(key), String(value).trim()]),
    )
  }

  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    return {}
  }

  return Object.entries(attributes).reduce((acc, [key, value]) => {
    if (!key || value === undefined || value === null) return acc
    acc[normalizeKeyPart(key)] = String(value).trim()
    return acc
  }, {})
}

const buildVariantKeyFromAttributes = attributes => {
  return Object.entries(normalizeAttributesObject(attributes))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
}

const normalizeSku = value => {
  const clean = String(value || '').trim().toUpperCase()
  return clean || undefined
}

const calculateAverageRating = ratings => {
  if (!Array.isArray(ratings) || ratings.length === 0) return 0

  const validRatings = ratings.filter(rating => Number(rating?.star) >= 1 && Number(rating?.star) <= 5)

  if (!validRatings.length) return 0

  const total = validRatings.reduce((sum, rating) => sum + Number(rating.star), 0)
  return Math.round((total / validRatings.length) * 10) / 10
}

const buildAvailableAttributes = variants => {
  const attrMap = new Map()

  for (const variant of variants || []) {
    if (variant?.isActive === false) continue

    const attributes = normalizeAttributesObject(variant.attributes)

    for (const [key, value] of Object.entries(attributes)) {
      if (!attrMap.has(key)) attrMap.set(key, new Set())
      attrMap.get(key).add(value)
    }
  }

  return Object.fromEntries(
    [...attrMap.entries()].map(([key, values]) => [
      key,
      [...values].sort((a, b) => String(a).localeCompare(String(b))),
    ]),
  )
}

const calculateVariantsStock = variants => {
  return (variants || [])
    .filter(variant => variant?.isActive !== false)
    .reduce((total, variant) => total + toNonNegativeInteger(variant.stock), 0)
}

const ensureSingleMainImage = images => {
  if (!Array.isArray(images) || images.length === 0) return

  const firstMainIndex = images.findIndex(image => image?.isMain === true)
  const mainIndex = firstMainIndex >= 0 ? firstMainIndex : 0

  images.forEach((image, index) => {
    image.isMain = index === mainIndex
    image.order = Number.isFinite(Number(image.order)) ? Number(image.order) : index
  })

  images.sort((a, b) => {
    if (a.isMain && !b.isMain) return -1
    if (!a.isMain && b.isMain) return 1
    return Number(a.order || 0) - Number(b.order || 0)
  })
}

const assertUniqueVariantKeysAndSkus = variants => {
  const keys = new Set()
  const skus = new Set()

  for (const variant of variants || []) {
    const key = String(variant?.key || '').trim()
    const sku = normalizeSku(variant?.sku)

    if (!key) {
      throw new Error('Cada variante debe tener una key válida')
    }

    if (keys.has(key)) {
      throw new Error(`La variante con key "${key}" está duplicada`)
    }

    keys.add(key)

    if (sku) {
      if (skus.has(sku)) {
        throw new Error(`La variante con SKU "${sku}" está duplicada dentro del producto`)
      }

      skus.add(sku)
    }
  }
}

const syncChildTenantIds = product => {
  if (!product?.tenantId) return

  for (const image of product.images || []) {
    image.tenantId = product.tenantId
  }

  for (const rating of product.ratings || []) {
    rating.tenantId = product.tenantId
  }

  for (const variant of product.variants || []) {
    variant.tenantId = product.tenantId
  }
}

const normalizeVariants = variants => {
  for (const variant of variants || []) {
    const attributes = normalizeAttributesObject(variant.attributes)

    variant.attributes = attributes
    variant.key = normalizeText(variant.key) || buildVariantKeyFromAttributes(attributes)
    variant.price = toMoney(variant.price)
    variant.stock = toNonNegativeInteger(variant.stock)
    variant.sku = normalizeSku(variant.sku)

    if (variant.image && typeof variant.image === 'object') {
      variant.image.public_id = normalizeText(variant.image.public_id) || ''
      variant.image.url = normalizeText(variant.image.url) || ''
    }
  }
}

const normalizeVariantAttributes = variantAttributes => {
  for (const attribute of variantAttributes || []) {
    attribute.name = normalizeKeyPart(attribute.name)
    attribute.label = normalizeText(attribute.label)

    if (!ALLOWED_VARIANT_ATTRIBUTE_TYPES.includes(attribute.type)) {
      attribute.type = 'select'
    }
  }
}

const normalizeDerivedProductFields = product => {
  syncChildTenantIds(product)

  product.title = normalizeText(product.title)
  product.slug = typeof product.slug === 'string' ? product.slug.trim().toLowerCase() : product.slug
  product.description = normalizeText(product.description)
  product.marca = normalizeText(product.marca)
  product.categoria = normalizeText(product.categoria)
  product.subcategoria = normalizeText(product.subcategoria)
  product.currency = normalizeText(product.currency || DEFAULT_CURRENCY)?.toUpperCase() || DEFAULT_CURRENCY
  product.sku = normalizeSku(product.sku)
  product.tags = normalizeTags(product.tags)
  product.price = toMoney(product.price)
  product.compareAtPrice = toMoney(product.compareAtPrice)
  product.stock = toNonNegativeInteger(product.stock)

  normalizeVariantAttributes(product.variantAttributes)
  normalizeVariants(product.variants)
  assertUniqueVariantKeysAndSkus(product.variants)

  if (product.compareAtPrice > 0 && product.compareAtPrice < product.price) {
    throw new Error('compareAtPrice no puede ser menor que price')
  }

  if (product.hasVariants) {
    product.stock = calculateVariantsStock(product.variants)
    product.availableAttributes = buildAvailableAttributes(product.variants)
  } else {
    product.availableAttributes = {}
  }

  product.totalrating = calculateAverageRating(product.ratings)

  ensureSingleMainImage(product.images)

  if (product.isModified?.('status') && product.status === 'active' && !product.publishedAt) {
    product.publishedAt = new Date()
  }
}

// =====================================================
// SUB-SCHEMAS
// =====================================================

const imageSchema = new Schema(
  {
    public_id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    alt: {
      type: String,
      trim: true,
      maxlength: 200,
      default: DEFAULT_IMAGE_ALT,
    },
    isMain: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
  },
  {
    _id: true,
    timestamps: true,
  },
)

const ratingSchema = new Schema(
  {
    star: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    postedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    postedByName: {
      type: String,
      trim: true,
      default: '',
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    helpfulVotes: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    _id: true,
    timestamps: true,
  },
)

const variantSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    attributes: {
      type: Map,
      of: String,
      required: true,
      default: {},
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      default: undefined,
    },
    image: {
      public_id: {
        type: String,
        trim: true,
        default: '',
      },
      url: {
        type: String,
        trim: true,
        default: '',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
  },
  {
    _id: true,
    timestamps: true,
  },
)

const variantAttributeSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ALLOWED_VARIANT_ATTRIBUTE_TYPES,
      default: 'select',
    },
  },
  {
    _id: false,
  },
)

// =====================================================
// MAIN SCHEMA
// =====================================================

const productSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },

    // Básico & SEO
    title: {
      type: String,
      required: [true, 'El título es obligatorio'],
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      required: [true, 'El slug es obligatorio'],
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'La descripción es obligatoria'],
      trim: true,
      maxlength: 5000,
    },
    tags: {
      type: [String],
      default: [],
    },

    // Clasificación
    marca: {
      type: String,
      required: [true, 'La marca es obligatoria'],
      trim: true,
      index: true,
    },
    categoria: {
      type: String,
      required: [true, 'La categoría es obligatoria'],
      trim: true,
      index: true,
    },
    subcategoria: {
      type: String,
      required: [true, 'La subcategoría es obligatoria'],
      trim: true,
      index: true,
    },
    atributos: {
      type: Schema.Types.Mixed,
      default: {},
    },

    // Variantes
    hasVariants: {
      type: Boolean,
      default: false,
      index: true,
    },
    variantAttributes: {
      type: [variantAttributeSchema],
      default: [],
    },
    variants: {
      type: [variantSchema],
      default: [],
    },
    availableAttributes: {
      type: Map,
      of: [String],
      default: {},
    },

    // Precio & Stock
    price: {
      type: Number,
      required: [true, 'El precio es obligatorio'],
      min: 0,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    compareAtPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      index: true,
      default: undefined,
    },

    // Estado
    condicion: {
      type: String,
      enum: ALLOWED_PRODUCT_CONDITIONS,
      default: 'nuevo',
    },
    status: {
      type: String,
      enum: ALLOWED_PRODUCT_STATUSES,
      default: 'active',
      index: true,
    },
    visibility: {
      type: String,
      enum: ALLOWED_PRODUCT_VISIBILITIES,
      default: 'visible',
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },

    // Multimedia & Ratings
    images: {
      type: [imageSchema],
      default: [],
    },
    ratings: {
      type: [ratingSchema],
      default: [],
    },
    totalrating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    // IA
    iaGenerated: {
      type: Boolean,
      default: false,
      index: true,
    },

    aiOriginalOutput: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    aiConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null,
    },

    aiSource: {
      type: String,
      default: null,
      trim: true,
    },

    aiImageHash: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },

    aiNeedsReview: {
      type: Boolean,
      default: false,
      index: true,
    },

    aiAgentJobId: {
      type: Schema.Types.ObjectId,
      ref: 'ProductAnalysisJob',
      default: null,
      index: true,
    },

    aiAgentScheduledAt: {
      type: Date,
      default: null,
    },

    aiAutomationMode: {
      type: String,
      enum: ['manual', 'agent-assisted', 'agent-autosave'],
      default: 'manual',
      index: true,
    },

    // Auditoría
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
    publishedAt: {
      type: Date,
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

productSchema.index({ tenantId: 1, slug: 1 }, { unique: true })
productSchema.index({ tenantId: 1, sku: 1 }, { unique: true, sparse: true })
productSchema.index({ tenantId: 1, 'variants.sku': 1 }, { sparse: true })
productSchema.index({ tenantId: 1, status: 1, visibility: 1, isDeleted: 1, createdAt: -1 })
productSchema.index({ tenantId: 1, categoria: 1, subcategoria: 1, status: 1, visibility: 1, isDeleted: 1 })
productSchema.index({ tenantId: 1, isDeleted: 1, updatedAt: -1 })

productSchema.index({
  tenantId: 1,
  title: 'text',
  description: 'text',
  marca: 'text',
  categoria: 'text',
  subcategoria: 'text',
  tags: 'text',
})

// =====================================================
// VIRTUALS
// =====================================================

productSchema.virtual('isAvailable').get(function () {
  if (this.isDeleted || this.status !== 'active') return false

  return this.hasVariants
    ? this.variants.some(variant => variant.isActive && Number(variant.stock || 0) > 0)
    : Number(this.stock || 0) > 0
})

productSchema.virtual('discountPercentage').get(function () {
  if (Number(this.compareAtPrice || 0) > Number(this.price || 0)) {
    return Math.round(((this.compareAtPrice - this.price) / this.compareAtPrice) * 100)
  }

  return 0
})

// =====================================================
// HOOKS
// =====================================================

productSchema.pre('validate', function productPreValidate(next) {
  try {
    normalizeDerivedProductFields(this)
    return next()
  } catch (error) {
    return next(error)
  }
})

// =====================================================
// METHODS
// =====================================================

productSchema.methods.recalculateDerivedFields = function recalculateDerivedFields() {
  normalizeDerivedProductFields(this)
  return this
}

productSchema.methods.getVariantData = function getVariantData(attributes) {
  if (!this.hasVariants) {
    return {
      price: this.price,
      stock: this.stock,
      sku: this.sku,
    }
  }

  const key = buildVariantKeyFromAttributes(attributes)
  const variant = this.variants.find(item => item.key === key && item.isActive)

  return variant
    ? {
      price: variant.price,
      stock: variant.stock,
      sku: variant.sku,
      image: variant.image,
      variantId: variant._id,
    }
    : null
}

productSchema.methods.softDelete = async function softDelete({ userId = null } = {}) {
  this.isDeleted = true
  this.deletedAt = new Date()
  this.status = 'archived'
  this.visibility = 'hidden'
  this.updatedBy = userId

  return this.save()
}

// =====================================================
// STATICS
// =====================================================

productSchema.statics.findActiveStorefrontProduct = function findActiveStorefrontProduct({
  productId,
  tenantId,
}) {
  return this.findOne({
    _id: productId,
    tenantId,
    isDeleted: { $ne: true },
    visibility: 'visible',
    status: { $in: ['active', 'out-of-stock'] },
  })
}

productSchema.statics.recalculateAndSaveById = async function recalculateAndSaveById({
  productId,
  tenantId,
}) {
  const product = await this.findOne({
    _id: productId,
    tenantId,
    isDeleted: { $ne: true },
  })

  if (!product) return null

  product.recalculateDerivedFields()
  return product.save()
}

/**
 * Ajuste de stock atómico con validación de no-negatividad.
 * delta puede ser positivo o negativo.
 */
productSchema.statics.updateStockAtomic = async function updateStockAtomic({
  productId,
  tenantId,
  delta,
  variantKey = null,
}) {
  const safeDelta = Number(delta)

  if (!Number.isFinite(safeDelta) || safeDelta === 0) {
    throw new Error('delta de stock inválido')
  }

  const product = await this.findOne({
    _id: productId,
    tenantId,
    isDeleted: { $ne: true },
  })

  if (!product) return null

  if (variantKey) {
    const variant = product.variants.find(item => item.key === variantKey)

    if (!variant) {
      throw new Error('Variante no encontrada')
    }

    const nextVariantStock = Number(variant.stock || 0) + safeDelta

    if (nextVariantStock < 0) {
      throw new Error('Stock insuficiente para la variante')
    }

    variant.stock = nextVariantStock
    product.markModified('variants')
  } else {
    const nextStock = Number(product.stock || 0) + safeDelta

    if (nextStock < 0) {
      throw new Error('Stock insuficiente')
    }

    product.stock = nextStock
  }

  product.recalculateDerivedFields()

  if (product.stock <= 0 && product.status === 'active') {
    product.status = 'out-of-stock'
  }

  if (product.stock > 0 && product.status === 'out-of-stock') {
    product.status = 'active'
  }

  return product.save()
}

// =====================================================
// TENANT PLUGIN
// =====================================================

productSchema.plugin(tenantPlugin, {
  addTenantField: false,
})

// =====================================================
// MODEL
// =====================================================

const Product = mongoose.models.Product || mongoose.model('Product', productSchema)

export default Product
