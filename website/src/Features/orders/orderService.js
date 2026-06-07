import api, { fetchCsrfToken } from '@utils/axiosConfig'

let csrfTokenPromise = null

const ensureCsrf = async () => {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetchCsrfToken().catch(error => {
      csrfTokenPromise = null
      throw error
    })
  }

  return csrfTokenPromise
}

const normalizeApiError = (error, fallback) => ({
  success: false,
  status: error?.response?.status || null,
  code: error?.response?.data?.code || null,
  message:
    error?.response?.data?.message ||
    error?.message ||
    fallback,
  errors: error?.response?.data?.errors || [],
})

const apiRequest = async ({
  method,
  endpoint,
  data,
  params,
  signal,
}) => {
  try {
    const normalizedMethod = String(method || 'get').toLowerCase()
    const headers = {
      Accept: 'application/json',
    }

    if (!['get', 'head', 'options'].includes(normalizedMethod)) {
      headers['x-csrf-token'] = await ensureCsrf()
      headers['Content-Type'] = 'application/json'
    }

    const response = await api({
      method: normalizedMethod,
      url: `/order${endpoint}`,
      data,
      params,
      signal,
      headers,
      withCredentials: true,
    })

    return response.data
  } catch (error) {
    return normalizeApiError(error, 'No se pudo completar la operación de órdenes')
  }
}

const createOrder = orderData =>
  apiRequest({
    method: 'post',
    endpoint: '/create',
    data: orderData,
  })

const getOrders = (params = {}, { signal } = {}) =>
  apiRequest({
    method: 'get',
    endpoint: '/my-orders',
    params: {
      page: params.page ?? 1,
      limit: params.limit ?? 10,
      status: params.status || undefined,
      paymentStatus: params.paymentStatus || undefined,
      fulfillmentStatus: params.fulfillmentStatus || undefined,
    },
    signal,
  })

const getOrderById = (id, { signal } = {}) =>
  apiRequest({
    method: 'get',
    endpoint: `/my-orders/${id}`,
    signal,
  })

const resendConfirmationEmail = orderId =>
  apiRequest({
    method: 'post',
    endpoint: `/${orderId}/resend-email`,
  })

export default {
  createOrder,
  getOrders,
  getOrderById,
  resendConfirmationEmail,
}
