// 📁 src/services/aiAgent/aiAgentToolsV2Service.js
import mongoose from 'mongoose'
import Product from '../../models/productModel.js'
import Coupon from '../../models/couponModel.js'
import { buildCatalogSnapshotForTenant } from './aiCatalogSnapshotService.js'
import logger from '../../../config/logger.js'

const clean = value => String(value || '').trim()

const escapeRegex = value => {
  return clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const normalizeText = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const isValidObjectId = value => mongoose.Types.ObjectId.isValid(String(value || ''))

const extractIdValue = value => {
  return clean(value?._id || value?.id || value)
}

const normalizeNumber = value => {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

const normalizeMoney = (value, currency = 'ARS') => {
  const amount = normalizeNumber(value)

  try {
    return amount.toLocaleString('es-AR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    })
  } catch {
    return `$${Math.round(amount).toLocaleString('es-AR')}`
  }
}

const AI_AGENT_DEBUG =
  String(process.env.AI_AGENT_DEBUG || '').toLowerCase() === 'true'

const debugLog = (message, meta = {}) => {
  if (!AI_AGENT_DEBUG) return

  logger.debug('[AI_AGENT_TOOLS_V2]', {
    message,
    ...meta,
  })
}

const tokenizeQuery = query => {
  const ignored = new Set([
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
    'quisiera',
    'busco',
    'buscando',
    'necesito',
    'ayuda',
    'ayudame',
    'producto',
    'productos',
    'precio',
    'precios',
    'stock',
    'disponible',
    'disponibles',
    'comprar',
    'compra',
    'ver',
    'mostrar',
    'mostrame',
    'recomendar',
    'recomendame',
    'algo',
    'para',
    'con',
    'del',
    'los',
    'las',
    'una',
    'uno',
    'este',
    'esta',
    'ese',
    'esa',
  ])

  return normalizeText(query)
    .split(/[^a-z0-9]+/i)
    .map(word => word.trim())
    .filter(word => word.length >= 2)
    .filter(word => !ignored.has(word))
    .slice(0, 12)
}

const buildRegex = query => {
  const words = tokenizeQuery(query).filter(word => word.length >= 3)

  if (!words.length) return null

  return new RegExp(words.map(escapeRegex).join('|'), 'i')
}

const getProductBasePrice = product => {
  return (
    normalizeNumber(product.price) ||
    normalizeNumber(product.finalPrice) ||
    normalizeNumber(product.salePrice) ||
    normalizeNumber(product.discountPrice) ||
    normalizeNumber(product.precio) ||
    0
  )
}

const getVariantPrice = ({ variant, fallbackPrice }) => {
  return (
    normalizeNumber(variant?.price) ||
    normalizeNumber(variant?.finalPrice) ||
    normalizeNumber(variant?.salePrice) ||
    normalizeNumber(variant?.discountPrice) ||
    normalizeNumber(variant?.precio) ||
    fallbackPrice ||
    0
  )
}

const getVariantStock = variant => {
  return (
    normalizeNumber(variant?.stock) ||
    normalizeNumber(variant?.quantity) ||
    normalizeNumber(variant?.qty) ||
    normalizeNumber(variant?.inventory) ||
    0
  )
}

const getProductStock = product => {
  if (product?.hasVariants && Array.isArray(product.variants)) {
    return product.variants
      .filter(
        variant => variant?.isActive !== false && variant?.active !== false,
      )
      .reduce((total, variant) => total + getVariantStock(variant), 0)
  }

  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    const variantStock = product.variants
      .filter(
        variant => variant?.isActive !== false && variant?.active !== false,
      )
      .reduce((total, variant) => total + getVariantStock(variant), 0)

    if (variantStock > 0) return variantStock
  }

  return (
    normalizeNumber(product.stock) ||
    normalizeNumber(product.quantity) ||
    normalizeNumber(product.qty) ||
    normalizeNumber(product.inventory) ||
    0
  )
}

const normalizeAttributes = attributes => {
  if (
    !attributes ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    return {}
  }

  return Object.entries(attributes).reduce((acc, [key, value]) => {
    const cleanKey = clean(key)
    const cleanValue = clean(value)

    if (cleanKey && cleanValue) acc[cleanKey] = cleanValue

    return acc
  }, {})
}

const getVariantAttributes = variant => {
  return normalizeAttributes(
    variant?.attributes ||
      variant?.combinacion ||
      variant?.combination ||
      variant?.options ||
      variant?.selectedAttributes ||
      {},
  )
}

const getImageUrl = product => {
  if (Array.isArray(product.images) && product.images.length > 0) {
    const image =
      product.images.find(item => item?.isMain) || product.images[0]
    return image?.url || image?.secure_url || image?.src || ''
  }

  return product.image || product.thumbnail || product.imageUrl || ''
}

const getProductTitle = product => {
  return (
    clean(product.title) ||
    clean(product.name) ||
    clean(product.nombre) ||
    'Producto sin nombre'
  )
}

const getProductDescription = product => {
  return clean(
    product.description || product.descripcion || product.shortDescription,
  ).slice(0, 900)
}

const getProductBrand = product => {
  return clean(product.marca || product.brand || product.fabricante)
}

const getProductCategory = product => {
  return clean(product.categoria || product.category || product.categoryName)
}

const getProductSubcategory = product => {
  return clean(
    product.subcategoria || product.subcategory || product.subcategoryName,
  )
}

const getProductTags = product => {
  if (Array.isArray(product.tags))
    return product.tags.map(clean).filter(Boolean)

  if (typeof product.tags === 'string') {
    return product.tags.split(',').map(clean).filter(Boolean)
  }

  return []
}

export const normalizeProductForAgentTool = (product = {}) => {
  const price = getProductBasePrice(product)
  const stock = getProductStock(product)
  const currency = product.currency || product.moneda || 'ARS'

  const variants = Array.isArray(product.variants)
    ? product.variants
      .filter(
        variant => variant?.isActive !== false && variant?.active !== false,
      )
      .slice(0, 30)
      .map(variant => {
        const variantPrice = getVariantPrice({
          variant,
          fallbackPrice: price,
        })

        const variantStock = getVariantStock(variant)

        return {
          id: String(variant._id || variant.id || ''),
          key: clean(variant.key || variant.name || variant.title),
          sku: clean(variant.sku || variant.SKU),
          price: variantPrice,
          formattedPrice: normalizeMoney(variantPrice, currency),
          stock: variantStock,
          available: variantStock > 0,
          attributes: getVariantAttributes(variant),
          image:
            typeof variant.image === 'string'
              ? variant.image
              : variant.image?.url || variant.image?.secure_url || '',
        }
      })
    : []

  return {
    id: clean(product._id || product.id),
    title: getProductTitle(product),
    slug: clean(product.slug),
    sku: clean(product.sku || product.SKU),
    brand: getProductBrand(product),
    category: getProductCategory(product),
    subcategory: getProductSubcategory(product),
    price,
    formattedPrice: normalizeMoney(price, currency),
    compareAtPrice: normalizeNumber(product.compareAtPrice || product.oldPrice),
    currency,
    stock,
    available: stock > 0,
    status: product.status || '',
    visibility: product.visibility || '',
    image: getImageUrl(product),
    description: getProductDescription(product),
    tags: getProductTags(product),
    hasVariants: Boolean(product.hasVariants || variants.length > 0),
    variants,
  }
}

/**
 * Filtro base tolerante para producción:
 * - Respeta tenantId.
 * - Excluye eliminados.
 * - Acepta productos sin isDeleted definido.
 * - Acepta status comunes de publicación.
 * - Acepta visibility común o sin visibility.
 *
 * Esto evita que el agente quede sin catálogo si tus documentos viejos
 * no tienen exactamente status:'active' y visibility:'visible'.
 */
const buildBaseProductQuery = tenantId => ({
  tenantId,
  $and: [
    {
      $or: [
        { isDeleted: false },
        { isDeleted: null },
        { isDeleted: { $exists: false } },
      ],
    },
    {
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }],
    },
    {
      $or: [
        { status: 'active' },
        { status: 'published' },
        { status: 'visible' },
        { status: 'available' },
        { status: { $exists: false } },
        { status: null },
        { status: '' },
      ],
    },
    {
      $or: [
        { visibility: 'visible' },
        { visibility: 'public' },
        { visibility: 'storefront' },
        { visibility: { $exists: false } },
        { visibility: null },
        { visibility: '' },
      ],
    },
  ],
})

const getProductSearchText = product => {
  const variantText = Array.isArray(product.variants)
    ? product.variants
      .map(variant =>
        [
          variant?.sku,
          variant?.key,
          variant?.name,
          variant?.title,
          ...Object.values(getVariantAttributes(variant)),
        ]
          .filter(Boolean)
          .join(' '),
      )
      .join(' ')
    : ''

  return normalizeText(
    [
      getProductTitle(product),
      getProductDescription(product),
      product.sku,
      product.SKU,
      getProductBrand(product),
      getProductCategory(product),
      getProductSubcategory(product),
      ...getProductTags(product),
      variantText,
    ]
      .filter(Boolean)
      .join(' '),
  )
}

const scoreProduct = ({ product, query }) => {
  const tokens = tokenizeQuery(query)
  const text = getProductSearchText(product)
  const title = normalizeText(getProductTitle(product))
  const slug = normalizeText(product.slug)
  const sku = normalizeText(product.sku || product.SKU)

  let score = 0

  if (tokens.length === 0) return 0

  for (const token of tokens) {
    if (title.includes(token)) score += 35
    if (slug.includes(token)) score += 30
    if (sku.includes(token)) score += 28
    if (text.includes(token)) score += 12
  }

  if (getProductStock(product) > 0) score += 20
  if (
    product.hasVariants ||
    (Array.isArray(product.variants) && product.variants.length > 0)
  ) {
    score += 5
  }
  if (product.updatedAt) score += 2

  return score
}

const buildProductSearchCondition = regex => {
  if (!regex) return null

  return {
    $or: [
      { title: regex },
      { name: regex },
      { nombre: regex },
      { description: regex },
      { descripcion: regex },
      { shortDescription: regex },
      { sku: regex },
      { SKU: regex },
      { marca: regex },
      { brand: regex },
      { categoria: regex },
      { category: regex },
      { subcategoria: regex },
      { subcategory: regex },
      { tags: regex },

      { 'variants.sku': regex },
      { 'variants.SKU': regex },
      { 'variants.key': regex },
      { 'variants.name': regex },
      { 'variants.title': regex },

      { 'variants.attributes.color': regex },
      { 'variants.attributes.talle': regex },
      { 'variants.attributes.size': regex },
      { 'variants.attributes.medida': regex },
      { 'variants.attributes.modelo': regex },

      { 'variants.combinacion.color': regex },
      { 'variants.combinacion.talle': regex },
      { 'variants.combinacion.size': regex },
      { 'variants.combinacion.medida': regex },
      { 'variants.combinacion.modelo': regex },
    ],
  }
}

export const searchProductsTool = async ({
  tenantId,
  query,
  limit = 12,
} = {}) => {
  if (!tenantId) return []

  const regex = buildRegex(query)
  const cleanLimit = Math.min(Math.max(Number(limit || 12), 1), 30)

  const baseQuery = buildBaseProductQuery(tenantId)
  const searchCondition = buildProductSearchCondition(regex)

  let products = []
  const searchText = tokenizeQuery(query).join(' ')

  if (searchText) {
    try {
      products = await Product.find({
        ...baseQuery,
        $text: { $search: searchText },
      })
        .setOptions({ tenantId })
        .select({ score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' }, updatedAt: -1 })
        .limit(cleanLimit * 3)
        .lean()
    } catch (error) {
      const textIndexUnavailable =
        error?.code === 27 ||
        /text index|required for \$text/i.test(clean(error?.message))

      if (!textIndexUnavailable) throw error

      logger.warn('[AI_AGENT_TOOLS] product text index unavailable', {
        tenantId,
        message: error.message,
      })
    }
  }

  if (products.length === 0 && searchCondition) {
    products = await Product.find({
      ...baseQuery,
      $and: [...baseQuery.$and, searchCondition],
    })
      .setOptions({ tenantId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(cleanLimit * 3)
      .lean()
  }

  /**
   * Si no hubo match textual, damos contexto de catálogo disponible.
   * Pero marcamos el score bajo para que el prompt no lo trate como
   * una coincidencia exacta.
   */
  const sourceProducts =
    products.length > 0
      ? products
      : await Product.find(baseQuery)
        .setOptions({ tenantId })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(cleanLimit)
        .lean()

  const normalizedProducts = sourceProducts
    .map(product => ({
      product,
      score: scoreProduct({ product, query }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cleanLimit)
    .map(item => ({
      ...normalizeProductForAgentTool(item.product),
      matchScore: item.score,
      matchedQuery: Boolean(regex && products.length > 0),
    }))

  debugLog('products context generated', {
    tenantId,
    query,
    regex: regex ? String(regex) : null,
    foundBySearch: products.length,
    returned: normalizedProducts.length,
    products: normalizedProducts.slice(0, 8).map(product => ({
      id: product.id,
      title: product.title,
      slug: product.slug,
      price: product.price,
      stock: product.stock,
      variants: product.variants?.length || 0,
      matchScore: product.matchScore,
      matchedQuery: product.matchedQuery,
    })),
  })

  return normalizedProducts
}

export const getProductDetailsTool = async ({
  tenantId,
  productId,
  slug,
} = {}) => {
  if (!tenantId || (!productId && !slug)) return null

  const baseQuery = buildBaseProductQuery(tenantId)

  const query = {
    ...baseQuery,
    $and: [...baseQuery.$and],
  }

  if (productId) {
    if (!isValidObjectId(productId)) return null
    query._id = productId
  }
  if (slug) query.slug = slug

  const product = await Product.findOne(query).setOptions({ tenantId }).lean()

  return product ? normalizeProductForAgentTool(product) : null
}

export const getPromotionsTool = async ({ tenantId, limit = 8 } = {}) => {
  if (!tenantId) return []

  const now = new Date()
  const cleanLimit = Math.min(Math.max(Number(limit || 8), 1), 20)

  try {
    const coupons = await Coupon.find({
      tenantId,
      $and: [
        {
          $or: [
            { isDeleted: false },
            { isDeleted: null },
            { isDeleted: { $exists: false } },
          ],
        },
        {
          $or: [{ isActive: true }, { active: true }],
        },
        {
          $or: [
            { startDate: { $lte: now } },
            { startDate: null },
            { startDate: { $exists: false } },
          ],
        },
        {
          $or: [
            { endDate: { $gte: now } },
            { endDate: null },
            { endDate: { $exists: false } },
          ],
        },
        {
          $or: [
            { usageLimit: null },
            { usageLimit: { $exists: false } },
            { $expr: { $lt: ['$usageCount', '$usageLimit'] } },
          ],
        },
      ],
    })
      .setOptions({ tenantId })
      .sort({ priority: -1, updatedAt: -1, createdAt: -1 })
      .limit(cleanLimit)
      .lean()

    const productIds = [
      ...new Set(
        coupons
          .flatMap(coupon => [
            ...(Array.isArray(coupon.applicableProducts)
              ? coupon.applicableProducts
              : []),
            ...(Array.isArray(coupon.products) ? coupon.products : []),
            ...(Array.isArray(coupon.productIds) ? coupon.productIds : []),
          ])
          .map(extractIdValue)
          .filter(Boolean),
      ),
    ]

    const productMap = new Map()

    if (productIds.length > 0) {
      const relatedProducts = await Product.find({
        tenantId,
        _id: { $in: productIds },
      })
        .setOptions({ tenantId })
        .select(
          '_id title name nombre slug sku price finalPrice salePrice stock variants',
        )
        .lean()

      for (const product of relatedProducts) {
        productMap.set(
          String(product._id),
          normalizeProductForAgentTool(product),
        )
      }
    }

    return coupons.map(coupon => {
      const applicableProductIds = [
        ...new Set(
          [
            ...(Array.isArray(coupon.applicableProducts)
              ? coupon.applicableProducts
              : []),
            ...(Array.isArray(coupon.products) ? coupon.products : []),
            ...(Array.isArray(coupon.productIds) ? coupon.productIds : []),
          ]
            .map(extractIdValue)
            .filter(Boolean),
        ),
      ]

      const applicableProducts = applicableProductIds
        .map(id => productMap.get(id))
        .filter(Boolean)
        .map(product => ({
          id: product.id,
          title: product.title,
          slug: product.slug,
          sku: product.sku,
          price: product.price,
          formattedPrice: product.formattedPrice,
          stock: product.stock,
          available: product.available,
        }))

      const appliesToSpecificProducts = applicableProductIds.length > 0

      return {
        id: String(coupon._id),
        code: clean(coupon.code).toUpperCase(),
        description: clean(coupon.description),
        discountType: clean(coupon.discountType || coupon.type),
        discountValue: normalizeNumber(coupon.discountValue || coupon.value),
        minPurchaseAmount: normalizeNumber(coupon.minPurchaseAmount),
        maxDiscountAmount: normalizeNumber(coupon.maxDiscountAmount),
        startDate: coupon.startDate,
        endDate: coupon.endDate,
        stackable: Boolean(coupon.stackable),
        priority: normalizeNumber(coupon.priority),

        appliesToSpecificProducts,
        applicableProductIds,
        applicableProducts,

        usageScope: appliesToSpecificProducts
          ? 'specific_products'
          : 'general_cart',

        usageText: appliesToSpecificProducts
          ? applicableProducts.length > 0
            ? `Válido solo para: ${applicableProducts
              .map(product => product.title)
              .join(', ')}`
            : 'Válido solo para productos específicos configurados. Requiere validación antes de usarlo.'
          : 'Válido para compra general según condiciones del cupón',
      }
    })
  } catch (error) {
    logger.warn('[AI_AGENT_TOOLS] promotions unavailable:', {
      tenantId,
      message: error.message,
    })

    return []
  }
}

export const buildProductRecommendationTool = ({
  products = [],
  maxItems = 3,
} = {}) => {
  return products
    .filter(product => product.available)
    .sort((a, b) => {
      const scoreA = normalizeNumber(a.matchScore) + normalizeNumber(a.stock)
      const scoreB = normalizeNumber(b.matchScore) + normalizeNumber(b.stock)
      return scoreB - scoreA
    })
    .slice(0, maxItems)
    .map(product => ({
      id: product.id,
      title: product.title,
      price: product.price,
      formattedPrice: product.formattedPrice,
      stock: product.stock,
      slug: product.slug,
      matchScore: product.matchScore || 0,
      reason:
        product.matchScore > 0
          ? 'Coincide con tu búsqueda y está disponible'
          : product.hasVariants
            ? 'Tiene variantes disponibles'
            : 'Producto disponible',
    }))
}

export const runAgentCommerceTools = async ({
  tenantId,
  query,
  productLimit = 12,
  promotionLimit = 8,
} = {}) => {
  const [products, promotions, catalogSnapshot] = await Promise.all([
    searchProductsTool({
      tenantId,
      query,
      limit: productLimit,
    }),
    getPromotionsTool({
      tenantId,
      limit: promotionLimit,
    }),
    buildCatalogSnapshotForTenant({
      tenantId,
    }),
  ])

  const recommendations = buildProductRecommendationTool({
    products,
    maxItems: 3,
  })

  debugLog('commerce context completed', {
    tenantId,
    query,
    products: products.length,
    promotions: promotions.length,
    recommendations: recommendations.length,
    catalogSnapshot: {
      totalProducts: catalogSnapshot.totalProducts,
      withStock: catalogSnapshot.withStock,
      categories: catalogSnapshot.categories?.length || 0,
      brands: catalogSnapshot.brands?.length || 0,
    },
  })

  return {
    generatedAt: new Date().toISOString(),
    products,
    promotions,
    recommendations,
    catalogSnapshot,
  }
}
