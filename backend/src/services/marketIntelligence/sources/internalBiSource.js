/**
 * internalBiSource.js
 *
 * Inteligencia de negocio interna del tenant: catálogo, ventas, stock.
 * Aísla estrictamente por tenantId (sección 16 del spec).
 *
 * ALCANCE Y SU LÍMITE:
 * Aporta a demand, commercial y opportunity. Las ventas propias son
 * evidencia dura de que los clientes de ESTE comercio compran esto — más
 * confiable, para él, que cualquier señal de marketplace.
 *
 * Pero responde otra pregunta: "¿mis clientes quieren esto?" NO es
 * "¿el mercado quiere esto?". Por eso el resultado lleva scope:'internal' y
 * el scoring lo topea: sirve para decidir sobre el catálogo propio, no para
 * concluir sobre el mercado.
 *
 * SOLO CUENTA VENTAS PAGADAS. Una orden pending, rejected o cancelled no es
 * una venta: es una intención que no se concretó. Contarlas infla la demanda
 * con carritos abandonados y pagos rechazados.
 */

import Product from '../../../models/productModel.js'
import Order from '../../../models/orderModel.js'
// import SearchLog from '../../../models/searchLogModel.js' // TODO: si existe tracking de búsquedas internas

const LOOKBACK_DAYS = 90
const MAX_MATCHED_PRODUCTS = 10
const MAX_CATEGORY_PRODUCTS = 200

export async function getInternalBiSignals({ tenantId, product }) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const terms = buildSearchTerms(product)
  if (terms.length === 0) {
    return {
      available: false,
      reason: 'NO_DISPONIBLE: el término de búsqueda no tiene palabras significativas',
    }
  }

  // Búsqueda en el catálogo del tenant.
  //
  // $text es la primaria porque usa el índice de texto del schema y cubre
  // todos los campos indexados (título, descripción, tags), no solo el que
  // yo elija. Una versión anterior de este archivo la reemplazó por un regex
  // sobre `title` y dejó de encontrar productos que antes sí matcheaba.
  //
  // El regex queda solo como fallback para el caso en que el índice de texto
  // no exista en algún entorno, donde $text tira error.
  const matched = await findMatchingProducts({ tenantId, product, terms })

  if (!matched.length) {
    // El tenant NO tiene este producto. Es un dato, no una falla: si el
    // mercado lo demanda, es una oportunidad no cubierta.
    return {
      available: true,
      scope: 'internal',
      isInCatalog: false,
      matchedProducts: 0,
      unitsSoldLast90Days: null,
      paidOrdersWithProduct: null,
      currentStock: null,
      categoryUnitsSold: null,
      marginPercent: null,
      internalSearchCount: 0,
    }
  }

  const productIds = matched.map(p => p._id)
  const categories = [...new Set(matched.map(p => p.categoria).filter(Boolean))]

  const [sales, categorySales] = await Promise.all([
    aggregatePaidSales({ tenantId, productIds, since }),
    categories.length
      ? aggregateCategorySales({ tenantId, categories, productIds, since })
      : Promise.resolve({ units: null }),
  ])

  return {
    available: true,
    scope: 'internal',
    isInCatalog: true,
    matchedProducts: matched.length,
    unitsSoldLast90Days: sales.units,
    paidOrdersWithProduct: sales.orders,
    currentStock: matched.reduce((sum, p) => sum + (Number(p.stock) || 0), 0),
    categoryUnitsSold: categorySales.units,
    marginPercent: null, // TODO: requiere costo de adquisición
    internalSearchCount: 0, // TODO: conectar con SearchLog cuando exista
  }
}

/**
 * Unidades vendidas y pagadas de estos productos en la ventana.
 *
 * Campos del schema real (orderModel.js): el array es `products`, la
 * referencia al producto es `products.product` y la cantidad es
 * `products.count`. El filtro de paymentStatus 'approved' es lo que
 * distingue una venta de un intento de compra.
 */
async function aggregatePaidSales({ tenantId, productIds, since }) {
  try {
    // aggregateByTenant ya inyecta el $match de tenantId + isDeleted:false,
    // así que el aislamiento no depende de que lo repita acá.
    const result = await Order.aggregateByTenant(tenantId, [
      { $match: { createdAt: { $gte: since }, paymentStatus: 'approved' } },
      { $unwind: '$products' },
      { $match: { 'products.product': { $in: productIds } } },
      {
        $group: {
          _id: null,
          units: { $sum: '$products.count' },
          orderIds: { $addToSet: '$_id' },
        },
      },
      { $project: { units: 1, orders: { $size: '$orderIds' } } },
    ])

    // Sin resultados = 0 ventas pagadas. Es una medición real, no un dato
    // faltante: las órdenes existen y ninguna incluyó este producto.
    return { units: result[0]?.units ?? 0, orders: result[0]?.orders ?? 0 }
  } catch {
    return { units: null, orders: null }
  }
}

/**
 * Rotación de la categoría, EXCLUYENDO los productos ya contados.
 *
 * Sin la exclusión, un producto que vende bien inflaría su propia señal de
 * categoría y `opportunity` leería un hueco donde no lo hay.
 */
async function aggregateCategorySales({ tenantId, categories, productIds, since }) {
  try {
    const categoryProducts = await Product.find({
      tenantId,
      categoria: { $in: categories },
      _id: { $nin: productIds },
    })
      .limit(MAX_CATEGORY_PRODUCTS)
      .select('_id')
      .setOptions({ tenantId })
      .lean()

    if (!categoryProducts.length) return { units: 0 }

    const ids = categoryProducts.map(p => p._id)

    const result = await Order.aggregateByTenant(tenantId, [
      { $match: { createdAt: { $gte: since }, paymentStatus: 'approved' } },
      { $unwind: '$products' },
      { $match: { 'products.product': { $in: ids } } },
      { $group: { _id: null, units: { $sum: '$products.count' } } },
    ])

    return { units: result[0]?.units ?? 0 }
  } catch {
    return { units: null }
  }
}

/**
 * Busca productos del tenant que matcheen el término.
 *
 * Estrategia dual: $text (usa el índice del schema, cubre todos los campos
 * indexados) con fallback a regex multi-campo si el índice no existe.
 */
async function findMatchingProducts({ tenantId, product, terms }) {
  const select = '_id title titulo stock categoria'

  try {
    const byText = await Product.find(
      { tenantId, $text: { $search: product } },
      { score: { $meta: 'textScore' } },
    )
      .sort({ score: { $meta: 'textScore' } })
      .limit(MAX_MATCHED_PRODUCTS)
      .select(select)
      .setOptions({ tenantId })
      .lean()

    if (byText.length) return byText
  } catch {
    // Sin índice de texto en este entorno: se usa el fallback.
  }

  // Fallback: regex sobre los campos donde puede vivir el nombre. Se buscan
  // ambas variantes (title/titulo) porque el proyecto usa las dos según el
  // camino por el que se creó el producto.
  const regexes = terms.map(term => new RegExp(escapeRegex(term), 'i'))

  return Product.find({
    tenantId,
    $or: [
      ...regexes.map(rx => ({ title: rx })),
      ...regexes.map(rx => ({ titulo: rx })),
      ...regexes.map(rx => ({ categoria: rx })),
      ...regexes.map(rx => ({ marca: rx })),
    ],
  })
    .limit(MAX_MATCHED_PRODUCTS)
    .select(select)
    .setOptions({ tenantId })
    .lean()
    .catch(() => [])
}

/** Palabras significativas del query, sin stopwords ni ruido. */
function buildSearchTerms(product) {
  const STOPWORDS = new Set([
    'de', 'la', 'el', 'los', 'las', 'un', 'una', 'para',
    'con', 'del', 'en', 'por', 'que', 'ver',
  ])

  return String(product || '')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^\wáéíóúñü]/gi, ''))
    .filter(w => w.length >= 3 && !STOPWORDS.has(w))
    .slice(0, 5)
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
