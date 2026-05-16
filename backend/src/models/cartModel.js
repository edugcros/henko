// 📁 src/models/cartModel.js
// VERSIÓN PRODUCCIÓN - MULTI-TENANT / VARIANTES / SNAPSHOTS DE PRECIO

import mongoose from 'mongoose'

const { Schema } = mongoose

// =====================================================
// CONSTANTES
// =====================================================

const DEFAULT_CURRENCY = 'ARS'
const MAX_CART_QUANTITY = Number(process.env.MAX_CART_QUANTITY || 99)

// =====================================================
// HELPERS
// =====================================================

const toMoney = value => {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Number(num.toFixed(2))
}

const toSafeQuantity = value => {
  const num = Number(value)
  if (!Number.isInteger(num) || num < 1) return 1
  return Math.min(num, MAX_CART_QUANTITY)
}

const normalizeAttributesObject = attrs => {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return {}

  return Object.entries(attrs).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc
    acc[String(key)] = String(value)
    return acc
  }, {})
}

const buildCartKey = ({ productId, variantId, selectedAttributes }) => {
  if (variantId) return `${productId}::${variantId}`

  const attrsKey = Object.entries(normalizeAttributesObject(selectedAttributes))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')

  return `${productId}::${attrsKey || 'base'}`
}

const normalizePromotionSnapshot = ({
  price,
  originalPrice,
  discountPercentage,
  hasPromotion,
  promotionId,
  promotionTitle,
  promotionType,
}) => {
  const safePrice = toMoney(price)
  const safeOriginalPrice = Math.max(toMoney(originalPrice), safePrice)
  const safeDiscountPercentage = Math.min(100, Math.max(0, Number(discountPercentage || 0)))

  const promotionIsCoherent =
    Boolean(hasPromotion) &&
    safeDiscountPercentage > 0 &&
    safePrice > 0 &&
    safePrice <= safeOriginalPrice

  return {
    price: safePrice,
    originalPrice: promotionIsCoherent ? safeOriginalPrice : safePrice,
    discountPercentage: promotionIsCoherent ? safeDiscountPercentage : 0,
    hasPromotion: promotionIsCoherent,
    promotionId: promotionIsCoherent ? promotionId || null : null,
    promotionTitle: promotionIsCoherent ? promotionTitle || null : null,
    promotionType: promotionIsCoherent ? promotionType || null : null,
  }
}

const findMatchingCartItem = ({ products, productId, variantId, cartKey, colorId, size, gender }) => {
  return products.find(item => {
    const sameProduct = String(item.productId) === String(productId)
    if (!sameProduct) return false

    const sameVariant = String(item.variantId || '') === String(variantId || '')
    const sameCartKey = String(item.cartKey || '') === String(cartKey || '')

    if (variantId || cartKey) {
      return sameCartKey || sameVariant
    }

    return (
      (!colorId || String(item.colorId || '') === String(colorId || '')) &&
      (!size || item.size === size) &&
      (!gender || item.gender === gender)
    )
  })
}

const resolveVariant = ({ product, variantId }) => {
  if (!variantId || !Array.isArray(product?.variants)) return null

  return product.variants.find(variant =>
    String(variant._id) === String(variantId) ||
    String(variant.id) === String(variantId) ||
    String(variant.key) === String(variantId) ||
    String(variant.sku) === String(variantId),
  ) || null
}

// =====================================================
// VARIANT SNAPSHOT SCHEMA
// =====================================================

const selectedVariantSchema = new Schema(
  {
    id: {
      type: Schema.Types.Mixed,
      default: null,
    },
    sku: {
      type: String,
      default: null,
      trim: true,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    discountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    hasPromotion: {
      type: Boolean,
      default: false,
    },
    promotionId: {
      type: Schema.Types.ObjectId,
      ref: 'PromotionalBlock',
      default: null,
    },
    promotionTitle: {
      type: String,
      default: null,
      trim: true,
    },
    promotionType: {
      type: String,
      default: null,
      trim: true,
    },
    stock: {
      type: Number,
      min: 0,
      default: 0,
    },
    image: {
      type: String,
      default: null,
      trim: true,
    },
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { _id: false },
)

// =====================================================
// CART ITEM SCHEMA
// =====================================================

const cartItemSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: [true, 'El tenantId es obligatorio'],
      index: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'El ID del producto es obligatorio'],
      index: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'La cantidad mínima es 1'],
      max: [MAX_CART_QUANTITY, `La cantidad máxima permitida es ${MAX_CART_QUANTITY}`],
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    discountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    hasPromotion: {
      type: Boolean,
      default: false,
    },
    promotionId: {
      type: Schema.Types.ObjectId,
      ref: 'PromotionalBlock',
      default: null,
      index: true,
    },
    promotionTitle: {
      type: String,
      default: null,
      trim: true,
    },
    promotionType: {
      type: String,
      default: null,
      trim: true,
    },
    currency: {
      type: String,
      default: DEFAULT_CURRENCY,
      uppercase: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      default: null,
      trim: true,
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    // Legacy compatibility
    colorId: {
      type: Schema.Types.ObjectId,
      ref: 'Color',
      default: null,
    },
    size: {
      type: String,
      default: null,
      trim: true,
    },
    gender: {
      type: String,
      enum: ['Hombre', 'Mujer', 'Niño', null],
      default: null,
    },

    // Variant support
    cartKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    variantId: {
      type: Schema.Types.Mixed,
      default: null,
      index: true,
    },
    variantSku: {
      type: String,
      default: null,
      trim: true,
    },
    variantSKU: {
      type: String,
      default: null,
      trim: true,
    },
    selectedAttributes: {
      type: Map,
      of: String,
      default: {},
    },
    variantAttributes: {
      type: Map,
      of: String,
      default: {},
    },
    selectedVariant: {
      type: selectedVariantSchema,
      default: null,
    },
  },
  {
    _id: true,
    timestamps: false,
  },
)

// =====================================================
// CART SCHEMA
// =====================================================

const cartSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    products: {
      type: [cartItemSchema],
      default: [],
    },
    appliedCoupon: {
      type: Schema.Types.ObjectId,
      ref: 'Coupon',
      default: null,
      index: true,
    },
    cartTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAfterDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// =====================================================
// DOCUMENT GUARDS
// =====================================================

cartSchema.pre('validate', function (next) {
  for (const item of this.products || []) {
    if (!item.tenantId) item.tenantId = this.tenantId

    if (String(item.tenantId) !== String(this.tenantId)) {
      return next(new Error('El item del carrito pertenece a un tenant distinto'))
    }

    item.quantity = toSafeQuantity(item.quantity)
    item.price = toMoney(item.price)
    item.originalPrice = toMoney(item.originalPrice || item.price)
    item.subtotal = toMoney(item.price * item.quantity)
  }

  this.calculateTotals()
  return next()
})

// =====================================================
// TOTALS
// =====================================================

cartSchema.methods.calculateTotals = function () {
  this.products.forEach(item => {
    item.subtotal = toMoney(Number(item.price || 0) * Number(item.quantity || 0))
  })

  this.cartTotal = toMoney(
    this.products.reduce((acc, item) => acc + Number(item.subtotal || 0), 0),
  )

  if (!this.appliedCoupon) {
    this.totalAfterDiscount = this.cartTotal
  }
}

// =====================================================
// ADD / UPDATE PRODUCT
// =====================================================

cartSchema.methods.addOrUpdateProduct = async function ({
  product,
  quantity,
  tenantId = null,

  // legacy
  colorId = null,
  size = null,
  gender = null,

  // variants
  variantId = null,
  variantSku = null,
  variantSKU = null,
  selectedAttributes = {},
  variantAttributes = {},
  selectedVariant = null,
  cartKey = null,

  // server-side pricing snapshot
  title = null,
  image = null,
  price = null,
  originalPrice = null,
  discountPercentage = 0,
  hasPromotion = false,
  promotionId = null,
  promotionTitle = null,
  promotionType = null,
  currency = DEFAULT_CURRENCY,
}) {
  if (!product?._id) {
    throw new Error('Producto inválido')
  }

  const safeQuantity = toSafeQuantity(quantity)
  const safeTenantId = tenantId || this.tenantId

  if (String(safeTenantId) !== String(this.tenantId)) {
    throw new Error('El producto pertenece a un tenant distinto al carrito')
  }

  const normalizedSelectedAttributes = normalizeAttributesObject(
    selectedAttributes && Object.keys(selectedAttributes).length
      ? selectedAttributes
      : variantAttributes,
  )

  const resolvedVariantId = variantId || selectedVariant?.id || selectedVariant?._id || null
  const resolvedCartKey = cartKey || buildCartKey({
    productId: product._id.toString(),
    variantId: resolvedVariantId,
    selectedAttributes: normalizedSelectedAttributes,
  })

  const matchedVariant = resolveVariant({ product, variantId: resolvedVariantId })

  if (resolvedVariantId && !matchedVariant) {
    throw new Error('La variante seleccionada no existe para este producto')
  }

  if (matchedVariant?.isActive === false) {
    throw new Error('La variante seleccionada está inactiva')
  }

  const stockAvailable = matchedVariant
    ? Number(matchedVariant.stock || 0)
    : typeof product.stock === 'number'
      ? Number(product.stock)
      : null

  const existingItem = findMatchingCartItem({
    products: this.products,
    productId: product._id,
    variantId: resolvedVariantId,
    cartKey: resolvedCartKey,
    colorId,
    size,
    gender,
  })

  const newQuantity = existingItem
    ? Number(existingItem.quantity || 0) + safeQuantity
    : safeQuantity

  if (newQuantity > MAX_CART_QUANTITY) {
    throw new Error(`La cantidad máxima permitida por item es ${MAX_CART_QUANTITY}`)
  }

  if (typeof stockAvailable === 'number' && newQuantity > stockAvailable) {
    throw new Error(`Stock insuficiente. Disponible: ${stockAvailable}`)
  }

  const pricing = normalizePromotionSnapshot({
    price: price ?? selectedVariant?.price ?? matchedVariant?.price ?? product?.price ?? 0,
    originalPrice:
      originalPrice ??
      selectedVariant?.originalPrice ??
      matchedVariant?.price ??
      product?.price ??
      price ??
      0,
    discountPercentage: discountPercentage ?? selectedVariant?.discountPercentage ?? 0,
    hasPromotion: hasPromotion ?? selectedVariant?.hasPromotion ?? false,
    promotionId: promotionId ?? selectedVariant?.promotionId ?? null,
    promotionTitle: promotionTitle ?? selectedVariant?.promotionTitle ?? null,
    promotionType: promotionType ?? selectedVariant?.promotionType ?? null,
  })

  const resolvedVariantSku = variantSku || variantSKU || selectedVariant?.sku || matchedVariant?.sku || null
  const resolvedVariantImage =
    selectedVariant?.image ||
    matchedVariant?.image?.url ||
    image ||
    product?.images?.[0]?.url ||
    product?.image ||
    null

  const payload = {
    tenantId: safeTenantId,
    productId: product._id,
    quantity: newQuantity,
    price: pricing.price,
    originalPrice: pricing.originalPrice,
    discountPercentage: pricing.discountPercentage,
    hasPromotion: pricing.hasPromotion,
    promotionId: pricing.promotionId,
    promotionTitle: pricing.promotionTitle,
    promotionType: pricing.promotionType,
    currency: currency || product?.currency || DEFAULT_CURRENCY,
    colorId: colorId || null,
    size: size || null,
    gender: gender || null,
    image: resolvedVariantImage,
    title: title || product?.title || 'Producto sin título',
    subtotal: toMoney(pricing.price * newQuantity),
    cartKey: resolvedCartKey,
    variantId: resolvedVariantId,
    variantSku: resolvedVariantSku,
    variantSKU: resolvedVariantSku,
    selectedAttributes: normalizedSelectedAttributes,
    variantAttributes: normalizedSelectedAttributes,
    selectedVariant:
      resolvedVariantId || Object.keys(normalizedSelectedAttributes).length
        ? {
          id: resolvedVariantId,
          sku: resolvedVariantSku,
          price: pricing.price,
          originalPrice: pricing.originalPrice,
          discountPercentage: pricing.discountPercentage,
          hasPromotion: pricing.hasPromotion,
          promotionId: pricing.promotionId,
          promotionTitle: pricing.promotionTitle,
          promotionType: pricing.promotionType,
          stock: typeof stockAvailable === 'number' ? stockAvailable : 0,
          image: resolvedVariantImage,
          attributes: normalizedSelectedAttributes,
        }
        : null,
  }

  if (existingItem) {
    Object.assign(existingItem, payload)
  } else {
    this.products.push(payload)
  }

  this.calculateTotals()
  const savedCart = await this.save()

  return {
    cart: savedCart,
    action: existingItem ? 'updated' : 'added',
  }
}

// =====================================================
// REMOVE PRODUCT
// =====================================================

cartSchema.methods.removeProduct = async function ({
  productId,
  variantId = null,
  cartKey = null,
}) {
  if (!productId) {
    throw new Error('ID de producto requerido para eliminar')
  }

  const initialLength = this.products.length

  this.products = this.products.filter(item => {
    const sameProduct = String(item.productId) === String(productId)
    if (!sameProduct) return true

    if (cartKey) {
      return String(item.cartKey || '') !== String(cartKey)
    }

    if (variantId) {
      return String(item.variantId || '') !== String(variantId)
    }

    return false
  })

  if (initialLength === this.products.length) {
    return this
  }

  this.calculateTotals()
  return await this.save()
}

// =====================================================
// INDEXES
// =====================================================

cartSchema.index({ userId: 1, tenantId: 1 }, { unique: true })
cartSchema.index({ userId: 1, updatedAt: -1 })
cartSchema.index({ tenantId: 1, updatedAt: -1 })
cartSchema.index({ 'products.productId': 1, 'products.variantId': 1 })
cartSchema.index({ 'products.cartKey': 1 })
cartSchema.index({ 'products.promotionId': 1 })

const Cart = mongoose.model('Cart', cartSchema)
export default Cart
