// 📁 src/services/aiAgent/aiCatalogSnapshotService.js
import Product from '../../models/productModel.js'

const clean = value => String(value || '').trim()

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
      .filter(variant => variant?.isActive !== false && variant?.active !== false)
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
    product?.stock ||
      product?.quantity ||
      product?.qty ||
      product?.inventory,
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
      ],
    },
    {
      $or: [
        { visibility: 'visible' },
        { visibility: 'public' },
        { visibility: 'storefront' },
        { visibility: { $exists: false } },
        { visibility: null },
      ],
    },
  ],
})

const extractCategories = products => {
  return uniq(
    products.flatMap(product => [
      product.categoria,
      product.category,
      product.categoryName,
      product.subcategoria,
      product.subcategory,
      product.subcategoryName,
    ]),
  ).slice(0, 80)
}

const extractBrands = products => {
  return uniq(
    products.flatMap(product => [
      product.marca,
      product.brand,
      product.fabricante,
    ]),
  ).slice(0, 80)
}

const extractTopProducts = products => {
  return products
    .filter(product => getProductStock(product) > 0)
    .slice(0, 10)
    .map(product => ({
      id: String(product._id),
      title: product.title || product.name || product.nombre || 'Producto sin nombre',
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

  const products = await Product.find(buildProductMatch(tenantId))
    .setOptions({ tenantId })
    .select(
      [
        '_id',
        'title',
        'name',
        'nombre',
        'slug',
        'marca',
        'brand',
        'fabricante',
        'categoria',
        'category',
        'categoryName',
        'subcategoria',
        'subcategory',
        'subcategoryName',
        'stock',
        'quantity',
        'qty',
        'inventory',
        'variants',
        'status',
        'visibility',
        'updatedAt',
        'createdAt',
      ].join(' '),
    )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(1000)
    .lean()

  const withStockProducts = products.filter(product => getProductStock(product) > 0)

  const lastUpdatedProduct = products
    .filter(product => product.updatedAt || product.createdAt)
    .sort((a, b) => {
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    })[0]

  return {
    totalProducts: products.length,
    activeProducts: products.length,
    visibleProducts: products.length,
    withStock: withStockProducts.length,
    withoutStock: Math.max(0, products.length - withStockProducts.length),
    categories: extractCategories(products),
    brands: extractBrands(products),
    topAvailableProducts: extractTopProducts(products),
    lastUpdatedAt:
      lastUpdatedProduct?.updatedAt ||
      lastUpdatedProduct?.createdAt ||
      null,
  }
}