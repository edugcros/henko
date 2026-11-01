// 📁 src/services/productCreationService.js
//
// El alta de un producto, sea cual sea el camino que la pide.
//
// Había dos caminos que creaban productos y cada uno hacía su parte:
//   - createProduct (productCtrl), el alta del panel;
//   - createProductFromAnalysisJob (productAnalysisController), el alta
//     automática cuando termina un análisis con autoCreateProduct.
//
// El segundo hacía un Product.create pelado: no avisaba al catálogo del agente
// de IA (el agente no veía el producto hasta que otra cosa invalidara el
// catálogo), no actualizaba la plantilla de la subcategoría, armaba el slug a
// mano en vez de pedirle uno único a slugService, y no reconocía un producto
// que ya existiera para ese análisis.
//
// Acá queda lo que es igual para los dos. Cada camino arma los datos a su
// manera (el panel normaliza el formulario; el análisis lee la salida de la
// IA) y le pasa el resultado a createProductRecord.

import Product from '../models/productModel.js'
import ProductAnalysisJob from '../models/productAnalysisJobModel.js'
import logger from '../../config/logger.js'
import { buildProductSku, generateUniqueSlug } from '../utils/slugService.js'
import { isValidObjectId } from '../utils/requestContext.js'
import { registerAiCatalogChangedEvent } from './aiAgent/aiCatalogEventService.js'
import { upsertSubcategoryVariantTemplate } from './catalogCategoryService.js'

export const CATALOG_CHANGE_TYPES = {
  PRODUCT_CREATED: 'product_created',
  PRODUCT_UPDATED: 'product_updated',
  PRODUCT_DELETED: 'product_deleted',
  PRICE_CHANGED: 'price_changed',
  STOCK_CHANGED: 'stock_changed',
  VARIANT_CHANGED: 'variant_changed',
  CATEGORY_CHANGED: 'category_changed',
}

/**
 * Invalida el catálogo que usa el agente de IA. Nunca hace fallar la
 * operación que lo pide: el producto ya está guardado.
 */
export const registerProductCatalogChange = async ({
  tenantId,
  productId,
  changeType = CATALOG_CHANGE_TYPES.PRODUCT_UPDATED,
  source = 'product_controller',
  actorId = '',
  metadata = {},
} = {}) => {
  try {
    return await registerAiCatalogChangedEvent({
      tenantId,
      productId,
      changeType,
      source,
      actorId,
      metadata,
    })
  } catch (error) {
    logger.warn('[Product] No se pudo invalidar snapshot de catálogo IA', {
      tenantId: tenantId ? String(tenantId) : null,
      productId: productId ? String(productId) : null,
      changeType,
      error: error.message,
    })

    return null
  }
}

export const syncProductCatalogTemplate = async ({ tenantId, product, userId }) => {
  if (!product?.categoria || !product?.subcategoria) return null

  return upsertSubcategoryVariantTemplate({
    tenantId,
    category: product.categoria,
    subcategory: product.subcategoria,
    variantAttributes: product.variantAttributes,
    variants: product.variants,
    productAttributes: product.productAttributes,
    categoryAttributes: product.categoryAttributes,
    specifications: product.specifications,
    userId,
  })
}

/**
 * El producto que ya dejó un intento anterior de esta misma alta, si existe.
 *
 * El panel crea el producto y después sube imágenes, video y la imagen de
 * cada variante en pedidos separados. Si falla uno de esos pasos y la persona
 * vuelve a guardar, crear otra vez dejaba un duplicado (otro slug, otro SKU).
 *
 * - `clientRequestId`: el panel lo genera una vez por alta y lo repite en
 *   cada reintento.
 * - `aiAgentJobId`: un análisis termina en un solo producto, venga del panel
 *   o del alta automática del servidor (que lo registra en el trabajo como
 *   createdProductId).
 */
export const findAlreadyCreatedProduct = async ({ tenantId, clientRequestId, aiAgentJobId }) => {
  const alive = { tenantId, isDeleted: { $ne: true } }

  if (clientRequestId) {
    const byRequest = await Product.findOne({ ...alive, clientRequestId }).setOptions({ tenantId })
    if (byRequest) return byRequest
  }

  if (!isValidObjectId(aiAgentJobId)) return null

  const byJob = await Product.findOne({ ...alive, aiAgentJobId }).setOptions({ tenantId })
  if (byJob) return byJob

  const job = await ProductAnalysisJob.findOne({ _id: aiAgentJobId, tenantId })
    .select('createdProductId')
    .setOptions({ tenantId })
    .lean()

  if (!job?.createdProductId) return null

  return Product.findOne({ ...alive, _id: job.createdProductId }).setOptions({ tenantId })
}

const defaultCreatedSource = data => {
  if (data.aiAgentJobId) return 'agent'
  if (data.iaGenerated) return 'ai'
  return 'manual'
}

/**
 * Crea el producto, o devuelve el que ya creó este mismo intento.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string|null} [params.userId] - Quien crea; queda como actor del aviso
 *   al catálogo y de la plantilla.
 * @param {object} params.data - Los campos del producto, ya normalizados por
 *   el camino que llama. `slug` y `sku` son opcionales: se completan acá.
 * @param {string|null} [params.clientRequestId] - Ya validado por quien llama.
 * @param {string} [params.slugBase] - De dónde sale el slug. Por defecto
 *   `data.slug` o, si no hay, el título. Siempre se hace único en la tienda.
 * @returns {Promise<{ product: object, replayed: boolean }>}
 */
export const createProductRecord = async ({
  tenantId,
  userId = null,
  data,
  clientRequestId = null,
  slugBase = '',
}) => {
  const alreadyCreated = await findAlreadyCreatedProduct({
    tenantId,
    clientRequestId,
    aiAgentJobId: data.aiAgentJobId,
  })

  if (alreadyCreated) return { product: alreadyCreated, replayed: true }

  const slug = await generateUniqueSlug({
    title: slugBase || data.slug || data.title,
    tenantId,
  })

  const product = new Product({
    ...data,
    tenantId,
    slug,
    sku: data.sku || buildProductSku({ title: data.title, tenantId }),
    ...(clientRequestId ? { clientRequestId } : {}),
    audit: data.audit || {
      createdSource: defaultCreatedSource(data),
      lastSource: 'productCreationService',
    },
  })

  try {
    await product.save()
  } catch (saveError) {
    // Dos pedidos del mismo intento a la vez (doble clic): pasa uno y el otro
    // devuelve el producto que creó el primero. El choque puede venir del
    // índice de clientRequestId o antes del de slug, porque los dos pedidos
    // calcularon el mismo slug libre.
    if (saveError?.code === 11000 && clientRequestId) {
      const winner = await findAlreadyCreatedProduct({ tenantId, clientRequestId })
      if (winner) return { product: winner, replayed: true }
    }

    if (saveError?.code === 11000 && saveError.keyPattern?.clientRequestId) {
      const error = new Error(
        'Este intento de alta ya se usó. Recargá la página y volvé a cargar el producto.',
      )
      error.statusCode = 409
      throw error
    }

    throw saveError
  }

  await registerProductCatalogChange({
    tenantId,
    productId: product._id,
    changeType: CATALOG_CHANGE_TYPES.PRODUCT_CREATED,
    actorId: userId || '',
    metadata: {
      title: product.title,
      sku: product.sku,
      iaGenerated: product.iaGenerated,
      aiAgentJobId: product.aiAgentJobId ? String(product.aiAgentJobId) : '',
    },
  })

  try {
    await syncProductCatalogTemplate({ tenantId, product, userId })
  } catch (catalogError) {
    logger.error('❌ No se pudo sincronizar la plantilla de subcategoría', {
      category: product.categoria,
      error: catalogError.message,
      productId: String(product._id),
      subcategory: product.subcategoria,
      tenantId: String(tenantId),
    })
  }

  return { product, replayed: false }
}
