// src/features/cart/cartService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import { env } from '../../config/env.js'

let cachedCsrfToken = null
let csrfInFlight = null

const extractErrorMessage = (error, fallback = 'Error inesperado') => {
  return error?.response?.data?.message || error?.message || fallback
}

const getAccessToken = () => {
  const token = localStorage.getItem('token')

  if (!token || token === 'null' || token === 'undefined') {
    return null
  }

  return token
}

const ensureCsrf = async () => {
  if (cachedCsrfToken) return cachedCsrfToken

  if (!csrfInFlight) {
    csrfInFlight = fetchCsrfToken()
      .then(token => {
        if (!token) {
          throw new Error('No se pudo obtener token CSRF')
        }

        cachedCsrfToken = token
        return token
      })
      .finally(() => {
        csrfInFlight = null
      })
  }

  return csrfInFlight
}

const resetCsrf = () => {
  cachedCsrfToken = null
}

const apiRequest = async (method, endpoint, data, options = {}) => {
  const normalizedMethod = String(method || 'get').toLowerCase()
  const isMutatingRequest = ['post', 'put', 'patch', 'delete'].includes(
    normalizedMethod,
  )

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  }

  const token = getAccessToken()

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  if (isMutatingRequest && !options.skipCsrf) {
    const csrfToken = await ensureCsrf()
    headers[env.csrfHeaderName || 'x-csrf-token'] = csrfToken
  }

  const config = {
    method: normalizedMethod,
    url: `/user${endpoint}`,
    withCredentials: true,
    ...options,
    headers,
  }

  if (data !== undefined) {
    config.data = data
  }

  try {
    const res = await api(config)
    return res.data
  } catch (error) {
    const status = error?.response?.status
    const code = error?.response?.data?.code

    if (status === 403 && code === 'EBADCSRFTOKEN' && !options._csrfRetried) {
      resetCsrf()

      const csrfToken = await ensureCsrf()

      const retryConfig = {
        ...config,
        _csrfRetried: true,
        headers: {
          ...headers,
          [env.csrfHeaderName || 'x-csrf-token']: csrfToken,
        },
      }

      const retryRes = await api(retryConfig)
      return retryRes.data
    }

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
  if (!payload) throw new Error('payload requerido')

  if (typeof payload === 'string') {
    const res = await api.delete(`/user/cart/${payload}`, {
      withCredentials: true,
    })
    return res.data
  }

  const { productId, variantId, cartKey } = payload

  if (!productId) throw new Error('productId requerido')

  const params = new URLSearchParams()

  if (variantId) params.append('variantId', variantId)
  if (cartKey) params.append('cartKey', cartKey)

  const queryString = params.toString()
  const url = queryString
    ? `/user/cart/${productId}?${queryString}`
    : `/user/cart/${productId}`

  const res = await api.delete(url, {
    withCredentials: true,
  })

  return res.data
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
