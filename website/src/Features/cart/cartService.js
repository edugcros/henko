// src/features/cart/cartService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'

let cachedCsrfToken = null

const extractErrorMessage = (error, fallback = 'Error inesperado') => {
  return error?.response?.data?.message || error?.message || fallback
}

const ensureCsrf = async () => {
  if (cachedCsrfToken) return cachedCsrfToken
  cachedCsrfToken = await fetchCsrfToken()
  return cachedCsrfToken
}

const apiRequest = async (method, endpoint, data, options = {}) => {
  const csrfToken = await ensureCsrf()

  const config = {
    method,
    url: `/user${endpoint}`,
    withCredentials: true,
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      'x-csrf-token': csrfToken,
      ...options.headers,
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
    console.error('Cart API Error:', message)
    throw new Error(message)
  }
}

// ======================================================
// Cart
// ======================================================
const getCart = async () => {
  return apiRequest('get', '/user-cart')
}

const addOrUpdateCartItem = async cartData => {
  if (!cartData?.productId) {
    throw new Error('productId requerido')
  }

  return apiRequest('post', '/cart', cartData)
}

/**
 * Soporta:
 * - removeCartItem('productId')
 * - removeCartItem({ productId, variantId, cartKey })
 */
const removeCartItem = async payload => {
  if (!payload) {
    throw new Error('payload requerido')
  }

  if (typeof payload === 'string') {
    return apiRequest('delete', `/cart/${payload}`)
  }

  const { productId, variantId, cartKey } = payload

  if (!productId) {
    throw new Error('productId requerido')
  }

  const params = new URLSearchParams()

  if (variantId) {
    params.append('variantId', variantId)
  }

  if (cartKey) {
    params.append('cartKey', cartKey)
  }

  const queryString = params.toString()
  const endpoint = queryString ? `/cart/${productId}?${queryString}` : `/cart/${productId}`

  return apiRequest('delete', endpoint)
}

const emptyCart = async () => {
  return apiRequest('delete', '/cart/empty')
}

const createCashOrder = async orderData => {
  return apiRequest('post', '/cart/cash-order', orderData)
}

const cartService = {
  getCart,
  addOrUpdateCartItem,
  removeCartItem,
  emptyCart,
  createCashOrder,
}

export default cartService
