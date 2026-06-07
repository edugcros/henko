// src/features/coupons/couponService.js
import { couponApi, ApiError } from '../../services/couponApi'

// ======================================================
// ERRORES PERSONALIZADOS
// ======================================================

export class ValidationError extends Error {
  constructor(message, field = null) {
    super(message)
    this.name = 'ValidationError'
    this.code = 'VALIDATION_ERROR'
    this.field = field
    this.isValidation = true
  }
}

export class DuplicateError extends Error {
  constructor(message, field = 'code') {
    super(message)
    this.name = 'DuplicateError'
    this.code = 'DUPLICATE_CODE'
    this.field = field
    this.isValidation = true
  }
}

// ======================================================
// CACHE LRU (Producción)
// ======================================================

class LRUCache {
  constructor(maxSize = 100, ttlMs = 60000) {
    this.maxSize = maxSize
    this.ttl = ttlMs
    this.cache = new Map()
  }

  get(key) {
    const item = this.cache.get(key)
    if (!item) return null
    
    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return null
    }

    // Mover al final (más reciente)
    this.cache.delete(key)
    this.cache.set(key, item)
    return item.value
  }

  set(key, value, customTtl) {
    // Eliminar el más antiguo si está lleno
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + (customTtl || this.ttl)
    })
  }

  invalidate(pattern) {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key)
    }
  }

  clear() {
    this.cache.clear()
  }

  size() {
    return this.cache.size
  }
}

const cache = new LRUCache(100, 60000)

// ======================================================
// VALIDADORES
// ======================================================

const validators = {
  coupon: (data) => {
    const errors = []
    
    if (!data.description?.trim()) {
      errors.push({ field: 'description', message: 'La descripción es requerida' })
    }
    
    const discountValue = parseFloat(data.discountValue)
    if (!discountValue || discountValue <= 0) {
      errors.push({ field: 'discountValue', message: 'El valor debe ser mayor a 0' })
    }
    
    if (data.discountType === 'percentage' && discountValue > 100) {
      errors.push({ field: 'discountValue', message: 'El porcentaje no puede superar 100%' })
    }
    
    if ((data.minPurchaseAmount || 0) < 0) {
      errors.push({ field: 'minPurchaseAmount', message: 'No puede ser negativo' })
    }
    
    const usageLimitPerUser = parseInt(data.usageLimitPerUser) || 0
    if (usageLimitPerUser < 1) {
      errors.push({ field: 'usageLimitPerUser', message: 'Debe ser al menos 1' })
    }
    
    const start = data.startDate ? new Date(data.startDate) : null
    const end = data.endDate ? new Date(data.endDate) : null
    
    if (start && end && end <= start) {
      errors.push({ field: 'endDate', message: 'Debe ser posterior a la fecha de inicio' })
    }
    
    if (errors.length > 0) {
      const error = new ValidationError('Error de validación', errors[0].field)
      error.errors = errors
      throw error
    }
  },
  
  code: (code) => {
    if (!code || code.length < 3) {
      throw new ValidationError('El código debe tener al menos 3 caracteres', 'code')
    }
  }
}

// ======================================================
// NORMALIZADORES
// ======================================================

const normalizeCoupon = (data) => {
  if (!data) return null

  const now = new Date()
  const startDate = data.startDate ? new Date(data.startDate) : null
  const endDate = data.endDate ? new Date(data.endDate) : null
  const deletedAt = data.deletedAt ? new Date(data.deletedAt) : null

  const isDeleted = data.isDeleted === true || !!deletedAt

  let status = 'inactive'
  let isValid = false

  if (isDeleted) {
    status = 'deleted'
  } else if (data.isActive) {
    if (startDate && now < startDate) {
      status = 'scheduled'
    } else if (endDate && now > endDate) {
      status = 'expired'
    } else if (data.usageLimit && data.usageCount >= data.usageLimit) {
      status = 'exhausted'
    } else {
      status = 'active'
      isValid = true
    }
  }

  return {
    id: data._id?.toString() || data.id?.toString(),
    code: data.code,
    description: data.description?.trim(),
    discountType: data.discountType,
    discountValue: parseFloat(data.discountValue) || 0,
    discountFormatted:
      data.discountType === 'percentage'
        ? `${data.discountValue}%`
        : `$${data.discountValue}`,

    minPurchaseAmount: Math.max(0, parseFloat(data.minPurchaseAmount) || 0),
    maxDiscountAmount: data.maxDiscountAmount
      ? parseFloat(data.maxDiscountAmount)
      : null,

    usageLimit: data.usageLimit ? parseInt(data.usageLimit) : null,
    usageCount: Math.max(0, parseInt(data.usageCount) || 0),
    usageLimitPerUser: Math.max(1, parseInt(data.usageLimitPerUser) || 1),
    remainingUses: data.usageLimit
      ? Math.max(0, data.usageLimit - (data.usageCount || 0))
      : null,

    startDate,
    endDate,
    createdAt: data.createdAt ? new Date(data.createdAt) : null,
    deletedAt,

    status,
    isValid,
    isActive: !isDeleted && !!data.isActive,
    isDeleted,

    isExhausted: data.usageLimit
      ? (data.usageCount || 0) >= data.usageLimit
      : false,

    stackable: !!data.stackable,
    priority: parseInt(data.priority) || 0,

    applicableProducts: (data.applicableProducts || []).map(normalizeProductRef),
    excludedProducts: (data.excludedProducts || []).map((p) =>
      typeof p === 'object'
        ? p._id?.toString() || p.id?.toString()
        : p
    ),
    applicableCategories: data.applicableCategories || [],

    tenantId:
      data.tenantId?._id?.toString() ||
      data.tenantId?.toString(),

    createdBy:
      data.createdBy?._id?.toString() ||
      data.createdBy?.toString(),

    metadata: data.metadata || {},

    badge:
      data.discountType === 'percentage'
        ? `-${data.discountValue}%`
        : `-$${data.discountValue}`,

    expiresIn: endDate && !isDeleted
      ? calculateExpiresIn(endDate)
      : null
  }
}


const normalizeProductRef = (product) => {
  if (!product || typeof product !== 'object') {
    const id = product?.toString?.() || ''

    return {
      id,
      name: '',
      title: '',
      sku: '',
      price: 0,
      images: [],
      category: ''
    }
  }

  return {
    id: product._id?.toString() || product.id?.toString(),
    name: product.title || product.name,
    title: product.title || product.name,
    sku: product.sku,
    price: parseFloat(product.price) || 0,
    images: product.images || [],
    category: product.category || product.categoria
  }
}

const calculateExpiresIn = (endDate) => {
  const days = Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'Expirado'
  if (days === 1) return '1 día'
  if (days <= 7) return `${days} días`
  if (days <= 30) return `${Math.floor(days / 7)} semanas`
  return `${Math.floor(days / 30)} meses`
}

const normalizeList = (response) => {
  const items = response?.data || response?.items || response || []
  
  return {
    items: items.map(normalizeCoupon),
    pagination: {
      total: parseInt(response?.pagination?.total || response?.total) || items.length,
      page: parseInt(response?.pagination?.page || response?.page) || 1,
      pages: parseInt(response?.pagination?.pages || response?.pages) || 1,
      limit: parseInt(response?.pagination?.limit || response?.limit) || 20,
      hasNext: (response?.pagination?.page || 1) < (response?.pagination?.pages || 1),
      hasPrev: (response?.pagination?.page || 1) > 1
    },
    meta: response?.meta || {}
  }
}

// ======================================================
// SERVICIO PRINCIPAL
// ======================================================

export const couponService = {

  /**
   * Desactivar cupón (soft delete)
   */
  delete: async (id) => {
    if (!id) throw new ValidationError('ID requerido', 'id')
    const response = await couponApi.delete(id)
    
    cache.invalidate(`coupons:${id}`)
    cache.invalidate('coupons:list')
    cache.invalidate('coupons:deleted')
    
    return {
      success: true,
      message: 'Cupón eliminado',
      id,
      data: response?.data
    }
  },

  /**
   * Eliminar permanentemente (hard delete)
   */
  permanentDeleteCoupon: async (id, options = {}) => {
    const { force = false } = options
    if (!id) throw new ValidationError('ID requerido', 'id')
    
    try {
      const response = await couponApi.permanentDeleteCoupon(id, force)
      
      cache.invalidate(`coupons:${id}`)
      cache.invalidate('coupons:list')
      cache.invalidate('coupons:deleted')
      
      return {
        success: true,
        message: 'Cupón eliminado permanentemente',
        data: response?.data
      }
    } catch (error) {
      if (error.code === 'COUPON_HAS_USAGE') {
        throw new Error(
          'Este cupón tiene usos registrados en órdenes. ' +
          'Contacta a un administrador para forzar la eliminación.'
        )
      }
      throw error
    }
  },


  /**
   * Restaurar cupón desactivado
   */
  restore: async (id) => {
    if (!id) throw new ValidationError('ID requerido', 'id')
    
    const response = await couponApi.restore(id)
    
    cache.invalidate(`coupons:${id}`)
    cache.invalidate('coupons:list')
    cache.invalidate('coupons:deleted')
    
    return {
      success: true,
      message: 'Cupón restaurado',
      data: normalizeCoupon(response?.data)
    }
  },

  /**
   * Listar cupones eliminados (papelera)
   */
  getDeleted: async (filters = {}) => {
    const cacheKey = `coupons:deleted:${JSON.stringify(filters)}`
    
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const response = await couponApi.getDeleted(filters)
    const normalized = normalizeList(response)
    
    cache.set(cacheKey, normalized, 30000)
    return normalized
  },
  
  // Listar con cache
  getCoupons: async (filters = {}, options = {}) => {
    const { useCache = true, ...restFilters } = filters
    const cacheKey = `coupons:list:${JSON.stringify(restFilters)}`
    
    if (useCache) {
      const cached = cache.get(cacheKey)
      if (cached) return cached
    }

    const response = await couponApi.getCoupons(restFilters)
    const normalized = normalizeList(response)
    
    if (useCache) {
      cache.set(cacheKey, normalized, 30000) // 30 seg cache lista
    }

    return normalized
  },

  getById: async (id, options = {}) => {
    if (!id) throw new ValidationError('ID requerido', 'id')
    
    const cacheKey = `coupons:${id}`
    
    if (options.useCache) {
      const cached = cache.get(cacheKey)
      if (cached) return cached
    }

    const response = await couponApi.getById(id)
    const normalized = normalizeCoupon(response?.data || response)
    
    if (options.useCache && normalized) {
      cache.set(cacheKey, normalized, 60000) // 1 min cache individual
    }

    return normalized
  },

  create: async (data) => {
    validators.coupon(data)
    if (data.code) validators.code(data.code)
      
    const cleanData = {
      ...data,
      description: data.description?.trim(),
      discountValue: parseFloat(data.discountValue),
      minPurchaseAmount: parseFloat(data.minPurchaseAmount) || 0,
      maxDiscountAmount: data.maxDiscountAmount ? parseFloat(data.maxDiscountAmount) : undefined,
      usageLimit: data.usageLimit ? parseInt(data.usageLimit) : null,
      usageLimitPerUser: parseInt(data.usageLimitPerUser) || 1,
      priority: parseInt(data.priority) || 0,
      applicableProducts: data.applicableProducts?.filter(Boolean) || [],
      startDate: data.startDate,
      endDate: data.endDate
    }

    if (data.code?.trim()) {
      cleanData.code = data.code.trim().toUpperCase()
    }

    try {
      const response = await couponApi.create(cleanData)
      const normalized = normalizeCoupon(response?.data || response)
      
      cache.invalidate('coupons:list')
      return normalized
    } catch (error) {
      if (error.isDuplicate || error.code === 'DUPLICATE_CODE') {
        throw new DuplicateError(
          cleanData.code
            ? `El código "${cleanData.code}" ya existe`
            : 'No se pudo generar un código único. Intenta nuevamente.',
          'code',
        )
      }
      if (error.code === 'NO_TENANT') {
        throw new ValidationError('Error de configuración: Tenant no identificado', 'tenant')
      }
      throw error
    }
  },

  update: async (id, data) => {
    if (!id) throw new ValidationError('ID requerido', 'id')
    
    if (data.code) validators.code(data.code)
    
    if (data.discountValue !== undefined && data.discountType === 'percentage' && data.discountValue > 100) {
      throw new ValidationError('El porcentaje no puede superar 100%', 'discountValue')
    }

    const cleanData = {
      ...data,
      ...(data.description && { description: data.description.trim() }),
      ...(data.discountValue !== undefined && { discountValue: parseFloat(data.discountValue) }),
      ...(data.applicableProducts && { applicableProducts: data.applicableProducts.filter(Boolean) })
    }

    if (data.code?.trim()) {
      cleanData.code = data.code.trim().toUpperCase()
    } else {
      delete cleanData.code
    }

    try {
      const response = await couponApi.update(id, cleanData)
      const normalized = normalizeCoupon(response?.data || response)
      
      cache.invalidate(`coupons:${id}`)
      cache.invalidate('coupons:list')
      return normalized
    } catch (error) {
      if (error.isDuplicate) {
        throw new DuplicateError('El código ya está en uso', 'code')
      }
      throw error
    }
  },


  clone: async (id) => {
    if (!id) throw new ValidationError('ID requerido', 'id')
    
    try {
      const response = await couponApi.clone(id)
      const normalized = normalizeCoupon(response?.data || response)
      
      cache.invalidate('coupons:list')
      return normalized
    } catch (error) {
      if (error.isDuplicate) {
        throw new DuplicateError('Conflicto al generar código. Intenta de nuevo.', 'code')
      }
      throw error
    }
  },

  generateBulk: async (config) => {
    const { count = 10, prefix = '', ...couponData } = config
    
    if (count < 1 || count > 100) {
      throw new ValidationError('Debe generar entre 1 y 100 cupones', 'count')
    }

    validators.coupon(couponData)

    try {
      const response = await couponApi.generateBulk({
        count: Math.min(parseInt(count), 100),
        prefix: prefix.toUpperCase(),
        ...couponData
      })
      const payload = response?.data || response

      cache.invalidate('coupons:list')
      
      return {
        success: true,
        created: parseInt(payload?.created) || 0,
        failed: parseInt(payload?.failed) || 0,
        total: (payload?.created || 0) + (payload?.failed || 0),
        coupons: (payload?.coupons || []).map(normalizeCoupon),
        errors: payload?.errors || []
      }
    } catch (error) {
      if (error.isDuplicate) {
        throw new DuplicateError('Algunos códigos ya existen. Intenta con otro prefijo.', 'prefix')
      }
      throw error
    }
  },

  assignProducts: async (couponId, productIds, mode = 'add') => {
    if (!couponId) throw new ValidationError('ID de cupón requerido', 'couponId')
    
    const ids = Array.isArray(productIds) ? productIds : [productIds]
    if (ids.length === 0) {
      throw new ValidationError('Selecciona al menos un producto', 'productIds')
    }

    const response = await couponApi.assignProducts(couponId, ids, mode)
    const normalized = normalizeCoupon(response?.data || response)
    
    cache.invalidate(`coupons:${couponId}`)
    return normalized
  },

  validate: async (code, context = {}) => {
    if (!code?.trim()) throw new ValidationError('Código requerido', 'code')

    const response = await couponApi.validate(code.trim(), {
      cartItems: context.cartItems || [],
      subtotal: context.subtotal || 0,
      userId: context.userId
    })
    
    return {
      valid: !!response?.valid,
      coupon: response?.coupon ? normalizeCoupon(response.coupon) : null,
      discountAmount: parseFloat(response?.discountAmount) || 0,
      discountType: response?.discountType,
      applicableItems: response?.applicableItems || [],
      inapplicableItems: response?.inapplicableItems || [],
      message: response?.message || '',
      newTotal: parseFloat(response?.newTotal) || 0,
      savings: parseFloat(response?.savings) || 0
    }
  },

  calculateDiscount: (coupon, subtotal) => {
    if (!coupon?.isValid) return 0
    
    const minPurchase = coupon.minPurchaseAmount || 0
    if (subtotal < minPurchase) return 0
    
    let discount = 0
    
    if (coupon.discountType === 'percentage') {
      discount = subtotal * (coupon.discountValue / 100)
      if (coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount) {
        discount = coupon.maxDiscountAmount
      }
    } else {
      discount = coupon.discountValue
    }
    
    return Math.round(Math.min(discount, subtotal) * 100) / 100
  },

  getStats: async (id) => {
    if (!id) throw new ValidationError('ID requerido', 'id')
    
    const response = await couponApi.getStats(id)
    
    return {
      totalUses: parseInt(response?.totalUses) || 0,
      totalDiscount: parseFloat(response?.totalDiscount) || 0,
      totalRevenue: parseFloat(response?.totalRevenue) || 0,
      avgOrderValue: parseFloat(response?.avgOrderValue) || 0,
      conversionRate: parseFloat(response?.conversionRate) || 0,
      revenuePerUse: (response?.totalRevenue || 0) / Math.max(1, response?.totalUses || 1),
      discountPerUse: (response?.totalDiscount || 0) / Math.max(1, response?.totalUses || 1)
    }
  },

  // Gestión de cache
  clearCache: () => cache.clear(),
  invalidateCache: (pattern) => cache.invalidate(pattern),
  getCacheSize: () => cache.size(),

  // Exportar errores
  ValidationError,
  DuplicateError
}

export default couponService
