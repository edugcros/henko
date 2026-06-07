// 📁 src/services/promotionalBlockService.js
// VERSIÓN PRODUCCIÓN - TENANT-SAFE / STOREFRONT / PRICING SERVER-SIDE

import PromotionalBlock from '../models/promotionalBlockModel.js'
import Product from '../models/productModel.js'

// =====================================================
// HELPERS
// =====================================================

const toUniqueStringIds = values => {
  return [...new Set(
    (values || [])
      .filter(Boolean)
      .map(value => String(value)),
  )]
}

const escapeRegex = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sortPublicProducts = products => {
  return (products || [])
    .filter(item => item?.isActive !== false && item?.productId)
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100))
}

const isActiveProductPromotionItem = item => {
  return Boolean(
    item &&
      item.isActive !== false &&
      Number(item.discountPercentage || 0) > 0,
  )
}

const buildPublicBlockQuery = ({ tenantId, placement, type }) => {
  const now = new Date()

  const query = {
    tenantId,
    isDeleted: false,
    isActive: true,
    visibility: 'public',
    startDate: { $lte: now },
    endDate: { $gte: now },
  }

  if (placement) query.placement = placement
  if (type) query.type = type

  return query
}

const publicProductPopulateConfig = tenantId => ({
  path: 'products.productId',
  match: {
    tenantId,
    status: { $in: ['active', 'out-of-stock'] },
    visibility: 'visible',
    isDeleted: { $ne: true },
  },
  select:
    'title slug price compareAtPrice currency images categoria subcategoria marca status visibility stock hasVariants variants',
})

// =====================================================
// VALIDACIONES DE INTEGRIDAD TENANT
// =====================================================

export const validateProductsBelongToTenant = async ({ tenantId, products = [] }) => {
  const productIds = toUniqueStringIds(
    products.map(item => item?.productId),
  )

  if (productIds.length === 0) return

  const foundProducts = await Product.find({
    _id: { $in: productIds },
    tenantId,
    isDeleted: { $ne: true },
  })
    .setOptions({ tenantId })
    .select('_id')
    .lean()

  if (foundProducts.length !== productIds.length) {
    const error = new Error(
      'Uno o más productos no pertenecen a este comercio o no existen.',
    )
    error.statusCode = 400
    throw error
  }
}

// =====================================================
// ADMIN
// =====================================================

export const findAdminBlocks = async ({
  tenantId,
  page = 1,
  limit = 10,
  placement,
  type,
  q,
  includeHidden = true,
  includeDeleted = false,
}) => {
  const safePage = Math.max(Number(page) || 1, 1)
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100)

  const query = {
    tenantId,
  }

  if (includeDeleted === true) {
  // No filtra isDeleted: trae activos y eliminados.
  } else {
    query.isDeleted = false
  }
  if (placement) query.placement = placement
  if (type) query.type = type
  if (!includeHidden) query.visibility = 'public'

  if (q) {
    const safeRegex = new RegExp(escapeRegex(String(q).trim().slice(0, 80)), 'i')

    query.$or = [
      { title: safeRegex },
      { slug: safeRegex },
      { description: safeRegex },
    ]
  }

  const [data, total] = await Promise.all([
    PromotionalBlock.find(query)
      .setOptions({ tenantId })
      .sort({ priority: 1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate({
        path: 'products.productId',
        match: {
          tenantId,
          isDeleted: { $ne: true },
        },
        select:
          'title slug price compareAtPrice currency images categoria subcategoria status visibility stock tenantId hasVariants variants',
      })
      .lean(),

    PromotionalBlock.countDocuments(query).setOptions({ tenantId }),
  ])

  return {
    data,
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit) || 1,
    },
  }
}

// =====================================================
// STOREFRONT
// =====================================================

export const findPublicBlocks = async ({
  tenantId,
  placement = 'home',
  type,
}) => {
  const blocks = await PromotionalBlock.find(
    buildPublicBlockQuery({ tenantId, placement, type }),
  )
    .setOptions({ tenantId })
    .sort({ priority: 1, createdAt: -1 })
    .populate(publicProductPopulateConfig(tenantId))
    .lean()

  return blocks.map(block => ({
    ...block,
    products: sortPublicProducts(block.products).slice(0, block.maxItems),
  }))
}

export const findPublicBlockBySlug = async ({ tenantId, slug }) => {
  const block = await PromotionalBlock.findOne({
    ...buildPublicBlockQuery({ tenantId }),
    slug,
  })
    .setOptions({ tenantId })
    .populate(publicProductPopulateConfig(tenantId))
    .lean()

  if (!block) return null

  return {
    ...block,
    products: sortPublicProducts(block.products).slice(0, block.maxItems),
  }
}

// =====================================================
// PRICING SERVER-SIDE PARA CARRITO / CHECKOUT
// =====================================================

/**
 * Resuelve la mejor promoción activa para un producto.
 *
 * Regla de conflicto:
 * 1. mayor descuento gana,
 * 2. si empatan, menor priority del bloque gana,
 * 3. si empatan, menor priority del item gana,
 * 4. si empatan, bloque más reciente gana.
 */
export const resolveBestActiveProductPromotion = async ({
  tenantId,
  productId,
}) => {
  if (!tenantId || !productId) return null

  const now = new Date()

  const blocks = await PromotionalBlock.find({
    tenantId,
    isDeleted: false,
    isActive: true,
    visibility: 'public',
    startDate: { $lte: now },
    endDate: { $gte: now },
    products: {
      $elemMatch: {
        productId,
        isActive: { $ne: false },
        discountPercentage: { $gt: 0 },
      },
    },
  })
    .setOptions({ tenantId })
    .select('_id title type priority createdAt products')
    .lean()

  if (!blocks.length) return null

  const candidates = blocks.flatMap(block => {
    return (block.products || [])
      .filter(item => {
        return (
          String(item.productId) === String(productId) &&
          isActiveProductPromotionItem(item)
        )
      })
      .map(item => ({
        promotionId: block._id,
        promotionTitle: block.title,
        promotionType: block.type,
        blockPriority: Number(block.priority || 100),
        itemPriority: Number(item.priority || 100),
        discountPercentage: Number(item.discountPercentage || 0),
        createdAt: block.createdAt,
      }))
  })

  if (!candidates.length) return null

  candidates.sort((a, b) => {
    if (b.discountPercentage !== a.discountPercentage) {
      return b.discountPercentage - a.discountPercentage
    }

    if (a.blockPriority !== b.blockPriority) {
      return a.blockPriority - b.blockPriority
    }

    if (a.itemPriority !== b.itemPriority) {
      return a.itemPriority - b.itemPriority
    }

    return new Date(b.createdAt) - new Date(a.createdAt)
  })

  return candidates[0]
}
