// 📁 src/services/aiAgent/aiCatalogSnapshotService.js
import Product from '../../models/productModel.js'

const clean = value => String(value || '').trim()
const snapshotCache = new Map()
const MAX_CACHE_ENTRIES = Math.min(
  Math.max(Number(process.env.AI_CATALOG_SNAPSHOT_MAX_CACHE_ENTRIES || 500), 50),
  5000,
)
const CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.AI_CATALOG_SNAPSHOT_TTL_MS || 60000), 5000),
  300000,
)

export const invalidateCatalogSnapshot = tenantId => {
  const cacheKey = clean(tenantId)

  if (!cacheKey) {
    snapshotCache.clear()
    return true
  }

  return snapshotCache.delete(cacheKey)
}

const setCatalogSnapshotCache = (cacheKey, value) => {
  if (snapshotCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = snapshotCache.keys().next().value
    if (oldestKey) snapshotCache.delete(oldestKey)
  }

  snapshotCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })
}

const uniq = values => {
  return [...new Set(values.map(clean).filter(Boolean))]
}

const normalizeNumber = value => {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

const getProductStock = product => {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    const variantStock = product.variants
      .filter(
        variant => variant?.isActive !== false && variant?.active !== false,
      )
      .reduce((total, variant) => {
        return (
          total +
          normalizeNumber(
            variant?.stock ||
              variant?.quantity ||
              variant?.qty ||
              variant?.inventory,
          )
        )
      }, 0)

    if (variantStock > 0) return variantStock
  }

  return normalizeNumber(
    product?.stock || product?.quantity || product?.qty || product?.inventory,
  )
}

const buildProductMatch = tenantId => ({
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

const extractTopProducts = products => {
  return products
    .filter(product => getProductStock(product) > 0)
    .slice(0, 10)
    .map(product => ({
      id: String(product._id),
      title:
        product.title ||
        product.name ||
        product.nombre ||
        'Producto sin nombre',
      slug: product.slug || '',
      brand: product.marca || product.brand || '',
      category: product.categoria || product.category || '',
      subcategory: product.subcategoria || product.subcategory || '',
      stock: getProductStock(product),
      updatedAt: product.updatedAt || product.createdAt || null,
    }))
}

export const buildCatalogSnapshotForTenant = async ({ tenantId } = {}) => {
  if (!tenantId) {
    return {
      totalProducts: 0,
      activeProducts: 0,
      visibleProducts: 0,
      withStock: 0,
      withoutStock: 0,
      categories: [],
      brands: [],
      topAvailableProducts: [],
      lastUpdatedAt: null,
    }
  }

  const cacheKey = String(tenantId)
  const cached = snapshotCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const match = buildProductMatch(tenantId)
  const [products, summaries] = await Promise.all([
    Product.find(match)
      .setOptions({ tenantId })
      .select(
        '_id title name nombre slug marca brand fabricante categoria category categoryName subcategoria subcategory subcategoryName stock quantity qty inventory variants updatedAt createdAt',
      )
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(50)
      .lean(),
    Product.aggregate([
      { $match: match },
      {
        $set: {
          computedVariantStock: {
            $sum: {
              $map: {
                input: { $ifNull: ['$variants', []] },
                as: 'variant',
                in: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ['$$variant.isActive', false] },
                        { $ne: ['$$variant.active', false] },
                      ],
                    },
                    {
                      $ifNull: [
                        '$$variant.stock',
                        {
                          $ifNull: [
                            '$$variant.quantity',
                            {
                              $ifNull: [
                                '$$variant.qty',
                                { $ifNull: ['$$variant.inventory', 0] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
      {
        $set: {
          computedStock: {
            $cond: [
              { $gt: ['$computedVariantStock', 0] },
              '$computedVariantStock',
              {
                $ifNull: [
                  '$stock',
                  {
                    $ifNull: [
                      '$quantity',
                      { $ifNull: ['$qty', { $ifNull: ['$inventory', 0] }] },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          withStock: {
            $sum: { $cond: [{ $gt: ['$computedStock', 0] }, 1, 0] },
          },
          categories: {
            $addToSet: {
              $ifNull: [
                '$categoria',
                { $ifNull: ['$category', '$categoryName'] },
              ],
            },
          },
          subcategories: {
            $addToSet: {
              $ifNull: [
                '$subcategoria',
                { $ifNull: ['$subcategory', '$subcategoryName'] },
              ],
            },
          },
          brands: {
            $addToSet: {
              $ifNull: ['$marca', { $ifNull: ['$brand', '$fabricante'] }],
            },
          },
          lastUpdatedAt: {
            $max: { $ifNull: ['$updatedAt', '$createdAt'] },
          },
        },
      },
    ]).option({ tenantId }),
  ])
  const summary = summaries[0] || {}
  const totalProducts = Number(summary.totalProducts || 0)
  const withStock = Number(summary.withStock || 0)

  const snapshot = {
    totalProducts,
    activeProducts: totalProducts,
    visibleProducts: totalProducts,
    withStock,
    withoutStock: Math.max(0, totalProducts - withStock),
    categories: uniq([
      ...(summary.categories || []),
      ...(summary.subcategories || []),
    ]).slice(0, 80),
    brands: uniq(summary.brands || []).slice(0, 80),
    topAvailableProducts: extractTopProducts(products),
    lastUpdatedAt: summary.lastUpdatedAt || null,
  }

  setCatalogSnapshotCache(cacheKey, snapshot)

  return snapshot
}
