import api, { fetchCsrfToken } from '@utils/axiosConfig'

const extractErrorMessage = (error, fallback = 'Error inesperado') => {
  return error?.response?.data?.message || error?.message || fallback
}

let cachedCsrfToken = null

const ensureCsrf = async () => {
  if (cachedCsrfToken) return cachedCsrfToken
  cachedCsrfToken = await fetchCsrfToken()
  return cachedCsrfToken
}

const apiRequest = async (
  method,
  endpoint,
  { data, params, isMultipart = false } = {},
) => {
  const normalizedMethod = method.toLowerCase()
  const isReadOnly = ['get', 'head', 'options'].includes(normalizedMethod)

  const token = localStorage.getItem('token')
  const csrfToken = isReadOnly ? null : await ensureCsrf()

  const config = {
    method: normalizedMethod,
    url: `/product${endpoint}`,
    withCredentials: true,
    params,
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(isMultipart ? { 'Content-Type': 'multipart/form-data' } : {}),
    },
  }

  if (data !== undefined) {
    config.data = data
  }

  try {
    const res = await api(config)
    return res.data
  } catch (error) {
    const message = extractErrorMessage(error)
    const enhancedError = new Error(message)
    enhancedError.status = error?.response?.status
    enhancedError.response = error?.response

    console.error('Product API Error:', message)
    throw enhancedError
  }
}

const createProduct = data => apiRequest('post', '/', { data })

const updateProduct = ({ productId, data }) =>
  apiRequest('put', `/${productId}`, { data })

const deleteProduct = productId => apiRequest('delete', `/${productId}`)

const uploadProductImage = (productId, file) => {
  const formData = new FormData()
  formData.append('images', file)
  return apiRequest('post', `/${productId}/upload-image`, {
    data: formData,
    isMultipart: true,
  })
}

const deleteProductImage = ({ productId, public_id }) =>
  apiRequest('delete', `/${productId}/image`, {
    params: { public_id },
  })

const getCategoryConfig = category =>
  apiRequest('get', `/categories/${encodeURIComponent(category)}/config`)

const getCategories = () => apiRequest('get', '/categories')

const getAllProducts = (params = {}) => apiRequest('get', '/', { params })

const getProduct = productId => apiRequest('get', `/${productId}`)

const rateProduct = async ({ productId, star, rating, comment = '' }) => {
  const normalizedStar = Math.trunc(Number(star ?? rating))

  console.log('⭐ productService.rateProduct payload:', {
    productId,
    star,
    rating,
    normalizedStar,
    comment,
  })

  return apiRequest('put', `/rating/${productId}`, {
    data: {
      star: normalizedStar,
      rating: normalizedStar,
      comment,
    },
  })
}
const toggleHelpfulRating = ({ productId, ratingId }) =>
  apiRequest('put', `/${productId}/rating/${ratingId}/helpful`)

export default {
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  deleteProductImage,
  getCategoryConfig,
  getCategories,
  getAllProducts,
  getProduct,
  rateProduct,
  toggleHelpfulRating,
}
