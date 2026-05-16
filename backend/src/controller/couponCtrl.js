// 📁 src/controller/couponCtrl.js
// VERSIÓN PRODUCCIÓN - TENANT-SAFE / CARRITO SERVER-SIDE / ADMIN

import crypto from 'node:crypto'
import mongoose from 'mongoose'

import Coupon from '../models/couponModel.js'
import Product from '../models/productModel.js'
import Cart from '../models/cartModel.js'
import CouponUsage from '../models/CouponUsageModel.js'
import { resolveCartPricing } from '../services/cartPricingService.js'
import logger from '../../config/logger.js'

// =====================================================
// CONSTANTES
// =====================================================

const MAX_BULK_COUPONS = 100
const SAFE_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'code',
  'startDate',
  'endDate',
  'usageCount',
  'priority',
])

// =====================================================
// HELPERS GENERALES
// =====================================================

const isValidId = value => mongoose.Types.ObjectId.isValid(String(value || ''))
const toObjectId = value => (isValidId(value) ? new mongoose.Types.ObjectId(String(value)) : null)
const toCents = value => Math.round(Number(value || 0) * 100)
const fromCents = value => Number((Number(value || 0) / 100).toFixed(2))

const sanitizeString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback
  const clean = value.trim()
  return clean || fallback
}

const escapeRegex = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toSafePage = value => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

const toSafeLimit = (value, fallback = 20) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, 100)
}

const getUserId = req => req.user?._id || req.user?.id || null

const resolveTenantContext = req => {
  const domainTenantId = req.tenantId ? String(req.tenantId) : null
  const userTenantId = req.user?.tenantId ? String(req.user.tenantId) : null

  if (!domainTenantId || !isValidId(domainTenantId)) {
    const error = new Error('Tenant no resuelto')
    error.statusCode = 400
    throw error
  }

  if (userTenantId && userTenantId !== domainTenantId) {
    const error = new Error('El usuario no pertenece al tenant resuelto por el dominio')
    error.statusCode = 403
    throw error
  }

  return {
    tenantId: domainTenantId,
    tenantObjectId: toObjectId(domainTenantId),
  }
}

const ensureAdminUser = req => {
  if (req.user?.role !== 'admin') {
    const error = new Error('Permisos insuficientes')
    error.statusCode = 403
    throw error
  }
}

const selectedAttributesToObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const findVariant = ({ product, cartItem }) => {
  if (!product?.hasVariants) return null

  const variantIdentifier =
    cartItem.variantId ||
    cartItem.selectedVariant?.id ||
    cartItem.variantSku ||
    cartItem.variantSKU ||
    null

  if (!variantIdentifier) return null

  return (
    product.variants?.find(variant =>
      String(variant._id) === String(variantIdentifier) ||
      String(variant.key) === String(variantIdentifier) ||
      String(variant.sku) === String(variantIdentifier),
    ) || null
  )
}

const buildStatusQuery = (status, now = new Date()) => {
  switch (status) {
  case 'active':
    return {
      isDeleted: false,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $or: [
        { usageLimit: null },
        { usageLimit: { $exists: false } },
        { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
      ],
    }

  case 'expired':
    return {
      isDeleted: false,
      endDate: { $lt: now },
    }

  case 'scheduled':
    return {
      isDeleted: false,
      startDate: { $gt: now },
      isActive: true,
    }

  case 'exhausted':
    return {
      isDeleted: false,
      isActive: true,
      usageLimit: { $ne: null },
      $expr: { $gte: ['$usageCount', '$usageLimit'] },
    }

  case 'inactive':
    return {
      isDeleted: false,
      isActive: false,
    }

  case 'deleted':
    return {
      isDeleted: true,
    }

  default:
    return {
      isDeleted: false,
    }
  }
}

const formatPublicCoupon = coupon => ({
  _id: coupon._id,
  code: coupon.code,
  description: coupon.description,
  discountType: coupon.discountType,
  discountValue: coupon.discountValue,
  minPurchaseAmount: coupon.minPurchaseAmount,
  maxDiscountAmount: coupon.maxDiscountAmount,
  endDate: coupon.endDate,
  applicableProducts: coupon.applicableProducts || [],
  applicableCategories: coupon.applicableCategories || [],
})

const generateCouponCode = async ({ tenantId, prefix = 'CUPON' }) => {
  const cleanPrefix = sanitizeString(prefix, 'CUPON')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'CUPON'

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase()
    const code = `${cleanPrefix}-${suffix}`
    const exists = await Coupon.exists({ tenantId, code }).setOptions({ tenantId })

    if (!exists) return code
  }

  throw new Error('No se pudo generar un código único de cupón')
}

// =====================================================
// ELEGIBILIDAD SERVER-SIDE
// =====================================================

const getCouponUsageCountForUser = async ({ couponId, userId, tenantId }) => {
  if (!userId) return 0

  return CouponUsage.countDocuments({
    tenantId,
    coupon: couponId,
    user: userId,
  }).setOptions({ tenantId })
}

const loadCurrentCart = async ({ userId, tenantId }) => {
  const cart = await Cart.findOne({
    userId,
    tenantId,
  })
    .populate('appliedCoupon')
    .lean()

  if (!cart || !Array.isArray(cart.products) || cart.products.length === 0) {
    const error = new Error('El carrito está vacío')
    error.statusCode = 400
    throw error
  }

  return cart
}

const buildCartPricingLines = async ({ cart, tenantId }) => {
  const productIds = cart.products.map(item => item.productId)

  const products = await Product.find({
    _id: { $in: productIds },
    tenantId,
    isDeleted: { $ne: true },
  })
    .setOptions({ tenantId })
    .lean()

  const productMap = new Map(products.map(product => [String(product._id), product]))
  const lines = []

  for (const cartItem of cart.products) {
    const product = productMap.get(String(cartItem.productId))

    if (!product) {
      throw new Error('Uno o más productos del carrito ya no están disponibles')
    }

    const variant = findVariant({ product, cartItem })

    if (product.hasVariants && !variant) {
      throw new Error(`La variante seleccionada ya no existe para "${product.title}"`)
    }

    const pricing = await resolveCartPricing({
      tenantId,
      product,
      variant,
    })

    const quantity = Number(cartItem.quantity || 0)
    const lineSubtotalCents = Math.round(Number(pricing.price || 0) * quantity * 100)

    lines.push({
      product,
      variant,
      cartItem,
      quantity,
      subtotalCents: lineSubtotalCents,
      selectedAttributes: selectedAttributesToObject(
        cartItem.selectedAttributes ||
          cartItem.variantAttributes ||
          cartItem.selectedVariant?.attributes,
      ),
    })
  }

  return lines
}

const evaluateCouponForCart = async ({
  coupon,
  userId,
  tenantId,
  cart,
}) => {
  const now = new Date()

  if (!coupon.isCurrentlyUsable(now)) {
    const error = new Error('Cupón no disponible')
    error.code = 'COUPON_NOT_AVAILABLE'
    throw error
  }

  const userUsageCount = await getCouponUsageCountForUser({
    couponId: coupon._id,
    userId,
    tenantId,
  })

  if (
    coupon.usageLimitPerUser !== null &&
    userUsageCount >= coupon.usageLimitPerUser
  ) {
    const error = new Error('Ya alcanzaste el límite de uso de este cupón')
    error.code = 'USER_LIMIT_REACHED'
    throw error
  }

  const lines = await buildCartPricingLines({ cart, tenantId })
  const applicableLines = lines.filter(({ product }) => coupon.appliesToProduct(product))

  if (!applicableLines.length) {
    const error = new Error('Este cupón no aplica a ningún producto del carrito')
    error.code = 'NOT_APPLICABLE'
    throw error
  }

  const applicableSubtotalCents = applicableLines.reduce(
    (total, line) => total + line.subtotalCents,
    0,
  )

  const cartSubtotalCents = lines.reduce(
    (total, line) => total + line.subtotalCents,
    0,
  )

  const discountAmountCents = coupon.calculateDiscountCents(applicableSubtotalCents)

  if (discountAmountCents <= 0) {
    const error = new Error('El cupón no genera descuento para esta compra')
    error.code = 'ZERO_DISCOUNT'
    throw error
  }

  return {
    coupon,
    lines,
    applicableLines,
    cartSubtotalCents,
    applicableSubtotalCents,
    discountAmountCents,
    finalTotalCents: Math.max(0, cartSubtotalCents - discountAmountCents),
  }
}

// =====================================================
// STOREFRONT: VALIDAR / APLICAR
// =====================================================

export const validateCoupon = async (req, res) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const userId = getUserId(req)
    const code = sanitizeString(req.body?.code).toUpperCase()

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        message: 'Debes iniciar sesión para validar un cupón',
      })
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        code: 'CODE_REQUIRED',
        message: 'Código de cupón requerido',
      })
    }

    const [coupon, cart] = await Promise.all([
      Coupon.findActiveByCode({ tenantId, code }),
      loadCurrentCart({ userId, tenantId }),
    ])

    if (!coupon) {
      return res.status(404).json({
        success: false,
        code: 'COUPON_NOT_FOUND',
        message: 'Cupón no encontrado',
      })
    }

    const result = await evaluateCouponForCart({
      coupon,
      userId,
      tenantId,
      cart,
    })

    return res.status(200).json({
      success: true,
      valid: true,
      data: {
        coupon: formatPublicCoupon(coupon),
        applicableItemsCount: result.applicableLines.length,
        applicableSubtotal: fromCents(result.applicableSubtotalCents),
        subtotal: fromCents(result.cartSubtotalCents),
        discountAmount: fromCents(result.discountAmountCents),
        finalTotal: fromCents(result.finalTotalCents),
      },
    })
  } catch (error) {
    logger.warn(`⚠️ validateCoupon: ${error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code || 'COUPON_INVALID',
      message: error.message,
    })
  }
}

/**
 * Nombre legacy mantenido por compatibilidad con el frontend actual.
 * Ya NO aplica cupón a una orden: aplica cupón al carrito actual.
 * La orden lo consumirá atómicamente en createOrder().
 */
export const applyCouponToOrder = async (req, res) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const userId = getUserId(req)
    const code = sanitizeString(req.body?.code).toUpperCase()

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Debes iniciar sesión para aplicar un cupón',
      })
    }

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'Código de cupón requerido',
      })
    }

    const [coupon, cart] = await Promise.all([
      Coupon.findActiveByCode({ tenantId, code }),
      Cart.findOne({ userId, tenantId }),
    ])

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Cupón no encontrado',
      })
    }

    if (!cart || !cart.products?.length) {
      return res.status(400).json({
        success: false,
        message: 'El carrito está vacío',
      })
    }

    const cartLean = cart.toObject()
    const result = await evaluateCouponForCart({
      coupon,
      userId,
      tenantId,
      cart: cartLean,
    })

    cart.appliedCoupon = coupon._id
    cart.totalAfterDiscount = fromCents(result.finalTotalCents)
    await cart.save()

    return res.status(200).json({
      success: true,
      data: {
        coupon: formatPublicCoupon(coupon),
        subtotal: fromCents(result.cartSubtotalCents),
        discountAmount: fromCents(result.discountAmountCents),
        totalAfterDiscount: fromCents(result.finalTotalCents),
      },
      message: 'Cupón aplicado al carrito correctamente',
    })
  } catch (error) {
    logger.warn(`⚠️ applyCouponToOrder: ${error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
      code: error.code || 'APPLY_ERROR',
    })
  }
}

export const getCouponsByProduct = async (req, res) => {
  try {
    const { tenantId } = resolveTenantContext(req)
    const { productId } = req.params
    const userId = getUserId(req)

    if (!isValidId(productId)) {
      return res.status(400).json({
        success: false,
        message: 'ID de producto inválido',
      })
    }

    const product = await Product.findOne({
      _id: productId,
      tenantId,
      isDeleted: { $ne: true },
      visibility: 'visible',
      status: { $in: ['active', 'out-of-stock'] },
    })
      .setOptions({ tenantId })
      .lean()

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Producto no encontrado',
      })
    }

    const now = new Date()

    const coupons = await Coupon.find({
      tenantId,
      isDeleted: false,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $and: [
        {
          $or: [
            { excludedProducts: { $size: 0 } },
            { excludedProducts: { $ne: product._id } },
          ],
        },
        {
          $or: [
            { applicableProducts: product._id },
            { applicableProducts: { $size: 0 }, applicableCategories: { $size: 0 } },
            { applicableCategories: product.categoria },
          ],
        },
      ],
    })
      .setOptions({ tenantId })
      .select(
        'code description discountType discountValue maxDiscountAmount minPurchaseAmount usageLimit usageCount endDate applicableProducts applicableCategories usageLimitPerUser',
      )
      .lean()

    let usageMap = new Map()

    if (userId) {
      const usages = await CouponUsage.aggregate([
        {
          $match: {
            tenantId: toObjectId(tenantId),
            user: toObjectId(userId),
            coupon: { $in: coupons.map(coupon => coupon._id) },
          },
        },
        {
          $group: {
            _id: '$coupon',
            count: { $sum: 1 },
          },
        },
      ]).option({ tenantId })

      usageMap = new Map(usages.map(usage => [String(usage._id), usage.count]))
    }

    return res.status(200).json({
      success: true,
      data: coupons.map(coupon => ({
        ...coupon,
        userCanUse:
          !userId ||
          Number(usageMap.get(String(coupon._id)) || 0) < Number(coupon.usageLimitPerUser || 1),
      })),
    })
  } catch (error) {
    logger.error(`❌ getCouponsByProduct: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Error obteniendo cupones',
    })
  }
}

// =====================================================
// ADMIN CRUD
// =====================================================

export const createCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)

    const coupon = await Coupon.create({
      ...req.body,
      tenantId,
      createdBy: getUserId(req),
    })

    return res.status(201).json({
      success: true,
      data: coupon,
      message: 'Cupón creado exitosamente',
    })
  } catch (error) {
    logger.error(`❌ createCoupon: ${error.stack || error.message}`)

    const statusCode = error.code === 11000 ? 409 : error.statusCode || 400

    return res.status(statusCode).json({
      success: false,
      message:
        error.code === 11000
          ? 'El código de cupón ya existe en este comercio'
          : error.message,
    })
  }
}

export const getCoupons = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)

    const {
      status = 'all',
      search,
      discountType,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query

    const query = {
      tenantId,
      ...buildStatusQuery(status),
    }

    if (discountType) query.discountType = discountType

    if (search?.trim()) {
      const safeRegex = new RegExp(escapeRegex(search.trim().slice(0, 80)), 'i')
      query.$or = [
        { code: safeRegex },
        { description: safeRegex },
      ]
    }

    const currentPage = toSafePage(page)
    const itemsPerPage = toSafeLimit(limit)
    const skip = (currentPage - 1) * itemsPerPage
    const safeSortBy = SAFE_SORT_FIELDS.has(sortBy) ? sortBy : 'createdAt'
    const sortOrder = order === 'asc' ? 1 : -1

    const [coupons, total] = await Promise.all([
      Coupon.find(query)
        .setOptions({ tenantId })
        .populate('applicableProducts', 'title sku price images')
        .populate('createdBy', 'firstname lastname email')
        .sort({ [safeSortBy]: sortOrder })
        .skip(skip)
        .limit(itemsPerPage)
        .lean(),
      Coupon.countDocuments(query).setOptions({ tenantId }),
    ])

    return res.status(200).json({
      success: true,
      data: coupons,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / itemsPerPage) || 1,
        limit: itemsPerPage,
        hasNext: currentPage < Math.ceil(total / itemsPerPage),
        hasPrev: currentPage > 1,
      },
    })
  } catch (error) {
    logger.error(`❌ getCoupons: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    })
  }
}

export const getCouponById = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const coupon = await Coupon.findOne({
      _id: id,
      tenantId,
      isDeleted: false,
    })
      .setOptions({ tenantId })
      .populate('applicableProducts', 'title sku price images')
      .populate('createdBy', 'firstname lastname email')

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Cupón no encontrado',
      })
    }

    return res.status(200).json({ success: true, data: coupon })
  } catch (error) {
    logger.error(`❌ getCouponById: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    })
  }
}

export const updateCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const coupon = await Coupon.findOne({
      _id: id,
      tenantId,
      isDeleted: false,
    }).setOptions({ tenantId })

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Cupón no encontrado',
      })
    }

    const forbiddenFields = new Set([
      '_id',
      'tenantId',
      'createdBy',
      'usageCount',
      'isDeleted',
      'deletedAt',
      'deletedBy',
    ])

    Object.entries(req.body || {}).forEach(([key, value]) => {
      if (!forbiddenFields.has(key)) {
        coupon[key] = value
      }
    })

    await coupon.save()

    return res.status(200).json({
      success: true,
      data: coupon,
      message: 'Cupón actualizado correctamente',
    })
  } catch (error) {
    logger.error(`❌ updateCoupon: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
}

export const deleteCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const coupon = await Coupon.findOne({
      _id: id,
      tenantId,
      isDeleted: false,
    }).setOptions({ tenantId })

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Cupón no encontrado',
      })
    }

    await coupon.softDelete({ userId: getUserId(req) })

    return res.status(200).json({
      success: true,
      message: 'Cupón eliminado correctamente',
    })
  } catch (error) {
    logger.error(`❌ deleteCoupon: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    })
  }
}

export const getDeletedCoupons = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const page = toSafePage(req.query.page)
    const limit = toSafeLimit(req.query.limit)
    const skip = (page - 1) * limit

    const query = {
      tenantId,
      isDeleted: true,
    }

    const [coupons, total] = await Promise.all([
      Coupon.find(query)
        .setOptions({ tenantId })
        .sort({ deletedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Coupon.countDocuments(query).setOptions({ tenantId }),
    ])

    return res.status(200).json({
      success: true,
      data: coupons,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
        limit,
      },
    })
  } catch (error) {
    logger.error(`❌ getDeletedCoupons: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    })
  }
}

export const restoreCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const coupon = await Coupon.findOne({
      _id: id,
      tenantId,
      isDeleted: true,
    }).setOptions({ tenantId })

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Cupón eliminado no encontrado',
      })
    }

    await coupon.restore()

    return res.status(200).json({
      success: true,
      data: coupon,
      message: 'Cupón restaurado correctamente',
    })
  } catch (error) {
    logger.error(`❌ restoreCoupon: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
}

export const permanentDeleteCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const usageExists = await CouponUsage.exists({
      tenantId,
      coupon: id,
    }).setOptions({ tenantId })

    if (usageExists) {
      return res.status(409).json({
        success: false,
        message: 'No se puede eliminar permanentemente un cupón con historial de uso',
      })
    }

    const deleted = await Coupon.findOneAndDelete({
      _id: id,
      tenantId,
      isDeleted: true,
    }).setOptions({ tenantId })

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Cupón eliminado no encontrado',
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Cupón eliminado permanentemente',
    })
  } catch (error) {
    logger.error(`❌ permanentDeleteCoupon: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    })
  }
}

export const cloneCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { id } = req.params

    if (!isValidId(id)) {
      return res.status(400).json({ success: false, message: 'ID inválido' })
    }

    const original = await Coupon.findOne({
      _id: id,
      tenantId,
      isDeleted: false,
    })
      .setOptions({ tenantId })
      .lean()

    if (!original) {
      return res.status(404).json({
        success: false,
        message: 'Cupón no encontrado',
      })
    }

    const code = await generateCouponCode({ tenantId, prefix: original.code })

    const cloned = await Coupon.create({
      ...original,
      _id: undefined,
      code,
      description: `${original.description} (Copia)`,
      usageCount: 0,
      isActive: false,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: getUserId(req),
      metadata: {
        totalRevenue: 0,
        totalDiscountGiven: 0,
      },
    })

    return res.status(201).json({
      success: true,
      data: cloned,
      message: 'Cupón clonado exitosamente',
    })
  } catch (error) {
    logger.error(`❌ cloneCoupon: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
}

export const generateBulkCoupons = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const count = Math.min(Number(req.body?.count || 10), MAX_BULK_COUPONS)
    const prefix = sanitizeString(req.body?.prefix, 'CUPON')
    const results = []
    const errors = []

    for (let index = 0; index < count; index += 1) {
      try {
        const code = await generateCouponCode({ tenantId, prefix })

        const coupon = await Coupon.create({
          ...req.body,
          code,
          tenantId,
          createdBy: getUserId(req),
          usageCount: 0,
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
        })

        results.push(coupon)
      } catch (error) {
        errors.push({ index, message: error.message })
      }
    }

    return res.status(201).json({
      success: true,
      data: {
        created: results.length,
        failed: errors.length,
        coupons: results,
        errors,
      },
    })
  } catch (error) {
    logger.error(`❌ generateBulkCoupons: ${error.stack || error.message}`)

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    })
  }
}

export const assignProductsToCoupon = async (req, res) => {
  try {
    ensureAdminUser(req)
    const { tenantId } = resolveTenantContext(req)
    const { couponId } = req.params
    const { productIds = [], mode = 'add' } = req.body

    if (!isValidId(couponId)) {
      return res.status(400).json({ success: false, message: 'ID de cupón inválido' })
    }

    if (!Array.isArray(productIds) || !productIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Debes proporcionar al menos un producto',
      })
    }

    if (!['add', 'remove', 'replace'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Modo inválido. Usa: add, remove o replace',
      })
    }

    const coupon = await Coupon.findOne({
      _id: couponId,
      tenantId,
      isDeleted: false,
    }).setOptions({ tenantId })

    if (!coupon) {
      return res.status(404).json({
        success: false,
        message: 'Cupón no encontrado',
      })
    }

    const validProducts = await Product.find({
      _id: { $in: productIds },
      tenantId,
      isDeleted: { $ne: true },
    })
      .setOptions({ tenantId })
      .select('_id')
      .lean()

    const validIds = validProducts.map(product => String(product._id))

    if (validIds.length !== productIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Uno o más productos no pertenecen a este comercio o no existen',
      })
    }

    const currentIds = coupon.applicableProducts.map(id => String(id))

    if (mode === 'replace') {
      coupon.applicableProducts = validIds
    }

    if (mode === 'add') {
      coupon.applicableProducts = [...new Set([...currentIds, ...validIds])]
    }

    if (mode === 'remove') {
      coupon.applicableProducts = currentIds.filter(id => !validIds.includes(id))
    }

    await coupon.save()
    await coupon.populate('applicableProducts', 'title sku price images')

    return res.status(200).json({
      success: true,
      data: coupon,
      message: 'Productos del cupón actualizados correctamente',
    })
  } catch (error) {
    logger.error(`❌ assignProductsToCoupon: ${error.stack || error.message}`)

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    })
  }
}

export default {
  validateCoupon,
  getCouponsByProduct,
  createCoupon,
  getCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  cloneCoupon,
  generateBulkCoupons,
  assignProductsToCoupon,
  applyCouponToOrder,
  getDeletedCoupons,
  permanentDeleteCoupon,
  restoreCoupon,
}
