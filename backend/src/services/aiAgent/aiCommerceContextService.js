// 📁 src/services/aiAgent/aiCommerceContextService.js
import Product from '../../models/productModel.js'
import Coupon from '../../models/couponModel.js'

const clean = value => String(value || '').trim()

const escapeRegex = value => {
  return clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const buildSearchRegex = query => {
  const ignoredWords = new Set([
    'hola',
    'buenas',
    'buenos',
    'dias',
    'días',
    'tardes',
    'noches',
    'tenes',
    'tenés',
    'tienen',
    'quiero',
    'busco',
    'necesito',
    'producto',
    'productos',
    'precio',
    'precios',
    'stock',
    'disponible',
    'disponibles',
  ])

  const words = clean(query)
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length >= 3)
    .filter(word => !ignoredWords.has(word))
    .slice(0, 10)

  if (!words.length) return null

  return new RegExp(words.map(escapeRegex).join('|'), 'i')
}

const normalizeNumber = value => {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

const normalizeObject = value => {
  if (!value) return {}

  if (value instanceof Map) {
    return Object.fromEntries(value.entries())
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  return {}
}

const getMainImage = product => {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const main = product.images.find(image => image?.isMain) || product.images[0]
    return main?.url || ''
  }

  return ''
}

const getProductPrice = product => {
  return (
    normalizeNumber(product.price) ||
    normalizeNumber(product.finalPrice) ||
    normalizeNumber(product.salePrice) ||
    0
  )
}

const getVariantPrice = (variant, fallbackPrice) => {
  return normalizeNumber(variant.price) || normalizeNumber(fallbackPrice) || 0
}

const getProductStock = product => {
  if (product.hasVariants && Array.isArray(product.variants)) {
    return product.variants
      .filter(variant => variant?.isActive !== false)
      .reduce((total, variant) => total + normalizeNumber(variant.stock), 0)
  }

  return normalizeNumber(product.stock)
}

const normalizeAttributes = attributes => {
  const source = normalizeObject(attributes)

  return Object.entries(source).reduce((acc, [key, value]) => {
    const cleanKey = clean(key)
    const cleanValue = clean(value)

    if (cleanKey && cleanValue) {
      acc[cleanKey] = cleanValue
    }

    return acc
  }, {})
}

const normalizeAvailableAttributes = product => {
  const source = normalizeObject(product.availableAttributes)

  return Object.entries(source).reduce((acc, [key, value]) => {
    if (!key) return acc

    if (Array.isArray(value)) {
      acc[key] = value.map(item => clean(item)).filter(Boolean)
      return acc
    }

    if (value instanceof Set) {
      acc[key] = [...value].map(item => clean(item)).filter(Boolean)
      return acc
    }

    return acc
  }, {})
}

const normalizeProductForAgent = product => {
  const basePrice = getProductPrice(product)
  const stock = getProductStock(product)

  return {
    id: String(product._id),
    title: product.title || 'Producto sin nombre',
    slug: product.slug || '',
    sku: product.sku || '',
    brand: product.marca || '',
    category: product.categoria || '',
    subcategory: product.subcategoria || '',
    price: basePrice,
    compareAtPrice: normalizeNumber(product.compareAtPrice),
    currency: product.currency || 'ARS',
    stock,
    available: stock > 0,
    hasVariants: Boolean(product.hasVariants),
    availableAttributes: normalizeAvailableAttributes(product),
    condition: product.condicion || '',
    status: product.status || '',
    visibility: product.visibility || '',
    tags: Array.isArray(product.tags) ? product.tags : [],
    description: clean(product.description).slice(0, 900),
    image: getMainImage(product),
    updatedAt: product.updatedAt,
    variants: Array.isArray(product.variants)
      ? product.variants
        .filter(variant => variant?.isActive !== false)
        .slice(0, 16)
        .map(variant => ({
          id: String(variant._id || ''),
          key: variant.key || '',
          sku: variant.sku || '',
          price: getVariantPrice(variant, basePrice),
          stock: normalizeNumber(variant.stock),
          available: normalizeNumber(variant.stock) > 0,
          attributes: normalizeAttributes(variant.attributes),
          image: variant.image?.url || '',
        }))
      : [],
  }
}

const normalizeCouponForAgent = coupon => {
  return {
    id: String(coupon._id),
    code: coupon.code || '',
    description: coupon.description || '',
    discountType: coupon.discountType || '',
    discountValue: normalizeNumber(coupon.discountValue),
    minPurchaseAmount: normalizeNumber(coupon.minPurchaseAmount),
    maxDiscountAmount: normalizeNumber(coupon.maxDiscountAmount),
    applicableCategories: Array.isArray(coupon.applicableCategories)
      ? coupon.applicableCategories
      : [],
    usageLimit: coupon.usageLimit,
    usageCount: normalizeNumber(coupon.usageCount),
    startDate: coupon.startDate,
    endDate: coupon.endDate,
    stackable: Boolean(coupon.stackable),
    priority: normalizeNumber(coupon.priority),
  }
}

const buildBaseProductQuery = tenantId => {
  return {
    tenantId,
    isDeleted: false,
    $or: [
      { deletedAt: null },
      { deletedAt: { $exists: false } },
    ],
    status: 'active',
    visibility: 'visible',
  }
}

const buildProductSearchQuery = ({ tenantId, regex }) => {
  const query = buildBaseProductQuery(tenantId)

  if (!regex) return query

  query.$and = [
    {
      $or: [
        { title: regex },
        { description: regex },
        { sku: regex },
        { marca: regex },
        { categoria: regex },
        { subcategoria: regex },
        { tags: regex },
        { 'variants.sku': regex },
        { 'variants.key': regex },
        { 'variants.attributes.color': regex },
        { 'variants.attributes.talle': regex },
        { 'variants.attributes.size': regex },
        { 'variants.attributes.medida': regex },
      ],
    },
  ]

  return query
}

export const getRelevantProductsForAgent = async ({
  tenantId,
  query,
  limit = 8,
} = {}) => {
  if (!tenantId) return []

  const cleanLimit = Math.min(Math.max(Number(limit || 8), 1), 20)
  const regex = buildSearchRegex(query)

  const products = await Product.find(
    buildProductSearchQuery({
      tenantId,
      regex,
    }),
  )
    .setOptions({ tenantId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(cleanLimit)
    .lean()

  // Si la búsqueda puntual no encontró nada, traemos productos activos recientes
  // para que el agente conozca algo del catálogo y pueda orientar al cliente.
  if (products.length === 0 && regex) {
    const fallbackProducts = await Product.find(buildBaseProductQuery(tenantId))
      .setOptions({ tenantId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(cleanLimit)
      .lean()

    return fallbackProducts.map(normalizeProductForAgent)
  }

  return products.map(normalizeProductForAgent)
}

export const getActivePromotionsForAgent = async ({
  tenantId,
  limit = 8,
} = {}) => {
  if (!tenantId) return []

  const now = new Date()
  const cleanLimit = Math.min(Math.max(Number(limit || 8), 1), 20)

  try {
    const coupons = await Coupon.find({
      tenantId,
      isDeleted: false,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $or: [
        { usageLimit: null },
        { usageLimit: { $exists: false } },
        { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
      ],
    })
      .setOptions({ tenantId })
      .sort({ priority: -1, updatedAt: -1, createdAt: -1 })
      .limit(cleanLimit)
      .lean()

    return coupons.map(normalizeCouponForAgent)
  } catch (error) {
    console.warn('[AI_COMMERCE_CONTEXT] No se pudieron leer promociones:', {
      message: error.message,
    })

    return []
  }
}

export const getCatalogSnapshotForAgent = async ({ tenantId } = {}) => {
  if (!tenantId) {
    return {
      totalProducts: 0,
      activeProducts: 0,
      visibleProducts: 0,
      withStock: 0,
      categories: [],
      brands: [],
      lastUpdatedAt: null,
    }
  }

  const baseMatch = {
    tenantId,
    isDeleted: false,
    $or: [
      { deletedAt: null },
      { deletedAt: { $exists: false } },
    ],
  }

  const [summary] = await Product.aggregate([
    { $match: baseMatch },
    {
      $group: {
        _id: null,
        totalProducts: { $sum: 1 },
        activeProducts: {
          $sum: {
            $cond: [{ $eq: ['$status', 'active'] }, 1, 0],
          },
        },
        visibleProducts: {
          $sum: {
            $cond: [{ $eq: ['$visibility', 'visible'] }, 1, 0],
          },
        },
        withStock: {
          $sum: {
            $cond: [{ $gt: ['$stock', 0] }, 1, 0],
          },
        },
        categories: { $addToSet: '$categoria' },
        brands: { $addToSet: '$marca' },
        lastUpdatedAt: { $max: '$updatedAt' },
      },
    },
  ]).option({ tenantId })

  return {
    totalProducts: summary?.totalProducts || 0,
    activeProducts: summary?.activeProducts || 0,
    visibleProducts: summary?.visibleProducts || 0,
    withStock: summary?.withStock || 0,
    categories: (summary?.categories || []).filter(Boolean).slice(0, 30),
    brands: (summary?.brands || []).filter(Boolean).slice(0, 30),
    lastUpdatedAt: summary?.lastUpdatedAt || null,
  }
}

export const buildCommerceContextForAgent = async ({
  tenantId,
  tenant,
  query,
} = {}) => {
  const [products, promotions, catalogSnapshot] = await Promise.all([
    getRelevantProductsForAgent({
      tenantId,
      query,
      limit: 10,
    }),
    getActivePromotionsForAgent({
      tenantId,
      limit: 8,
    }),
    getCatalogSnapshotForAgent({
      tenantId,
    }),
  ])

  return {
    generatedAt: new Date().toISOString(),
    catalogSnapshot,
    tenant: {
      id: tenantId ? String(tenantId) : '',
      name:
        tenant?.name ||
        tenant?.storeName ||
        tenant?.businessName ||
        tenant?.nombre ||
        'la tienda',
      currency: tenant?.currency || tenant?.moneda || 'ARS',
      domain: tenant?.domain || tenant?.primaryDomain || '',
      policies: tenant?.policies || tenant?.settings?.policies || {},
    },
    products,
    promotions,
  }
}