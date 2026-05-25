// 📁 src/features/product/productService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import Cookies from 'js-cookie'

const getAuthToken = () => {
  const token = Cookies.get('token') || localStorage.getItem('token') || null

  if (!token || token === 'null' || token === 'undefined') {
    return null
  }

  return token
}

const extractErrorMessage = (error, fallback = 'API Error') => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.code ||
    error?.message ||
    fallback
  )
}

const isPlainObject = value => {
  return value && typeof value === 'object' && !Array.isArray(value)
}

const safeJsonStringify = value => {
  if (value === undefined || value === null) return null

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const normalizeBoolean = value => {
  return value === true || value === 'true'
}

const normalizeAiProductPayload = productData => {
  if (!isPlainObject(productData)) {
    return productData
  }

  const normalized = {
    ...productData,
  }

  const hasAiOriginal =
    normalized.aiOriginalOutput !== undefined &&
    normalized.aiOriginalOutput !== null &&
    normalized.aiOriginalOutput !== ''

  const aiOriginalOutputAsString = hasAiOriginal
    ? safeJsonStringify(normalized.aiOriginalOutput)
    : null

  normalized.iaGenerated =
    normalizeBoolean(normalized.iaGenerated) || Boolean(aiOriginalOutputAsString)

  if (aiOriginalOutputAsString) {
    normalized.aiOriginalOutput = aiOriginalOutputAsString
  }

  if (normalized.aiConfidence !== undefined && normalized.aiConfidence !== null) {
    const confidence = Number(normalized.aiConfidence)
    normalized.aiConfidence = Number.isFinite(confidence) ? confidence : null
  }

  if (normalized.aiNeedsReview !== undefined && normalized.aiNeedsReview !== null) {
    normalized.aiNeedsReview = normalizeBoolean(normalized.aiNeedsReview)
  }

  return normalized
}

/**
 * Helper universal de requests.
 *
 * Soporta:
 * - params
 * - headers extra
 * - multipart/form-data
 * - withCredentials
 *
 * Nota importante:
 * Para FormData NO seteamos Content-Type manualmente.
 * El browser/Axios debe agregar multipart/form-data con boundary.
 */
const apiRequest = async (method, endpoint, data = undefined, options = {}) => {
  try {
    const csrfToken = await fetchCsrfToken()
    const token = getAuthToken()

    const {
      headers: customHeaders = {},
      params,
      withCredentials = true,
      ...restOptions
    } = options

    const headers = {
      Accept: 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...customHeaders,
    }

    const config = {
      method,
      url: `/product${endpoint}`,
      headers,
      params,
      withCredentials,
      ...restOptions,
    }

    if (data !== undefined) {
      config.data = data
    }

    const response = await api(config)
    return response.data
  } catch (error) {
    throw new Error(extractErrorMessage(error))
  }
}

/**
 * Crea producto.
 *
 * Mantiene intactos los campos IA:
 * - iaGenerated
 * - aiOriginalOutput
 * - aiConfidence
 * - aiSource
 * - aiImageHash
 * - aiNeedsReview
 */
const createProduct = async productData => {
  if (!productData || typeof productData !== 'object') {
    throw new Error('No se proporcionó el payload del producto')
  }

  const normalizedPayload = normalizeAiProductPayload(productData)

  return apiRequest('post', '/', normalizedPayload)
}

/**
 * Actualiza producto.
 *
 * Acepta:
 * - updateAProduct(productId, data)
 * - updateAProduct({ productId, data })
 */
const updateAProduct = async (productIdOrPayload, maybeData) => {
  let productId = productIdOrPayload
  let data = maybeData

  if (typeof productIdOrPayload === 'object' && productIdOrPayload !== null) {
    productId = productIdOrPayload.productId || productIdOrPayload.id
    data = productIdOrPayload.data
  }

  if (!productId) {
    throw new Error('ID del producto requerido')
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Payload de actualización inválido')
  }

  const normalizedPayload = normalizeAiProductPayload(data)

  return apiRequest('put', `/${productId}`, normalizedPayload)
}

/**
 * Eliminar producto completo.
 */
const deleteProduct = async productId => {
  if (!productId) {
    throw new Error('ID del producto requerido')
  }

  return apiRequest('delete', `/${productId}`)
}

/**
 * Subir imágenes globales del producto.
 * Backend espera field: images.
 */
const uploadProductImage = async (productId, imageFile) => {
  if (!productId || !imageFile) {
    throw new Error('Producto o imagen inválida')
  }

  const formData = new FormData()
  formData.append('images', imageFile)

  return apiRequest('post', `/${productId}/upload-image`, formData)
}

/**
 * Eliminar imagen específica del producto.
 * El backend actual espera public_id por query string.
 */
const deleteProductImage = async (productId, publicId) => {
  if (!productId) {
    throw new Error('ID del producto requerido')
  }

  if (!publicId) {
    throw new Error('public_id requerido')
  }

  return apiRequest('delete', `/${productId}/image`, undefined, {
    params: { public_id: publicId },
  })
}

/**
 * Obtener configuración de una categoría.
 */
const getCategoryConfig = async category => {
  if (!category) {
    throw new Error('Categoría requerida')
  }

  return apiRequest('get', `/categories/${encodeURIComponent(category)}/config`)
}

/**
 * Listar categorías del tenant actual.
 */
const getCategories = async () => {
  return apiRequest('get', '/categories')
}

/**
 * Obtener productos públicos del storefront.
 */
const getProducts = async (params = {}) => {
  return apiRequest('get', '/', undefined, {
    params,
    headers: {
      'X-Tenant-Domain': window.location.host,
    },
  })
}

/**
 * Obtener producto por ID.
 */
const getProduct = async productId => {
  if (!productId) {
    throw new Error('ID del producto requerido')
  }

  return apiRequest('get', `/${productId}`, undefined, {
    headers: {
      'X-Tenant-Domain': window.location.host,
    },
  })
}

/**
 * Calificar producto.
 */
const rateProduct = async ({ productId, star, comment, variantId = null }) => {
  if (!productId) {
    throw new Error('ID del producto requerido')
  }

  return apiRequest('put', `/rating/${productId}`, {
    star,
    comment,
    variantId,
  })
}

/**
 * Voto útil en reseña.
 */
const toggleHelpfulRating = async ({ productId, ratingId }) => {
  if (!productId || !ratingId) {
    throw new Error('productId y ratingId son requeridos')
  }

  return apiRequest('put', `/${productId}/rating/${ratingId}/helpful`)
}

/**
 * Asignar una imagen existente del producto a una variante.
 */
const assignVariantImage = async ({ productId, variantId, image }) => {
  if (!productId) {
    throw new Error('productId requerido')
  }

  if (!variantId) {
    throw new Error('variantId requerido')
  }

  if (!image?.url) {
    throw new Error('Imagen de variante inválida')
  }

  return apiRequest('put', `/${productId}/variant-image`, {
    variantId,
    image,
  })
}

const productService = {
  createProduct,
  updateAProduct,
  deleteProduct,
  uploadProductImage,
  deleteProductImage,
  getProducts,
  getProduct,
  rateProduct,
  getCategoryConfig,
  getCategories,
  toggleHelpfulRating,
  assignVariantImage,
}

export default productService