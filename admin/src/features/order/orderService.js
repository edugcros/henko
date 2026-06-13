// 📁 src/features/order/orderService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'

const getAuthToken = () => localStorage.getItem('token')

const handleApiError = (error, fallback = 'Error inesperado') => {
  const msg = error?.response?.data?.message || error?.message || fallback

  console.error('API Error:', {
    message: msg,
    status: error?.response?.status,
    data: error?.response?.data,
  })

  return {
    success: false,
    message: msg,
    errors: error?.response?.data?.errors || [],
    code: error?.response?.data?.code || null,
    status: error?.response?.status || null,
    data: error?.response?.data?.data || null,
  }
}

const apiRequest = async (
  method,
  endpoint,
  data = undefined,
  params = undefined,
  signal = undefined,
) => {
  try {
    await fetchCsrfToken()

    const token = getAuthToken()

    if (!token) {
      return {
        success: false,
        message: 'Sesión expirada. Por favor inicie sesión nuevamente.',
        errors: [],
        code: 'AUTH_TOKEN_MISSING',
      }
    }

    const config = {
      method,
      url: `/order${endpoint}`,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      withCredentials: true,
      ...(data !== undefined && { data }),
      ...(params !== undefined && { params }),
      ...(signal && { signal }),
    }

    const response = await api(config)

    return {
      success: true,
      data: response.data,
      message: response.data?.message || 'OK',
    }
  } catch (error) {
    return handleApiError(error)
  }
}

const inflight = new Map()

const makeQueryKey = (params = {}) =>
  JSON.stringify({
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    status: params.status || null,
    paymentStatus: params.paymentStatus || null,
    fulfillmentStatus: params.fulfillmentStatus || null,
    q: params.q || null,
    from: params.from || null,
    to: params.to || null,
    sortBy: params.sortBy || 'createdAt',
    sortDir: params.sortDir || 'desc',
    minTotal: params.minTotal || null,
    maxTotal: params.maxTotal || null,
  })

const createOrder = async orderData => {
  try {
    await fetchCsrfToken()

    const token = getAuthToken()

    if (!token) {
      return {
        success: false,
        message: 'No autorizado',
        errors: [],
        code: 'AUTH_TOKEN_MISSING',
      }
    }

    const response = await api.post('/order/create', orderData, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      withCredentials: true,
    })

    return {
      success: true,
      data: response.data,
      message: response.data?.message || 'Orden creada correctamente',
    }
  } catch (error) {
    return handleApiError(error, 'No se pudo crear la orden')
  }
}

const getOrders = async (params = {}, { signal } = {}) => {
  const key = makeQueryKey(params)

  if (inflight.has(key)) return inflight.get(key)

  const req = apiRequest(
    'get',
    '/getAll',
    undefined,
    {
      page: params.page ?? 1,
      limit: params.limit ?? 20,
      status: params.status,
      paymentStatus: params.paymentStatus,
      fulfillmentStatus: params.fulfillmentStatus,
      q: params.q,
      from: params.from,
      to: params.to,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      minTotal: params.minTotal,
      maxTotal: params.maxTotal,
    },
    signal,
  ).finally(() => inflight.delete(key))

  inflight.set(key, req)

  return req
}

const getMyOrders = (page = 1, { signal } = {}) =>
  apiRequest('get', '/my-orders', undefined, { page }, signal)

const updateOrderStatus = async ({ id, orderStatus }) => {
  if (!id) {
    return {
      success: false,
      message: 'ID de orden requerido',
      errors: [],
      code: 'ORDER_ID_REQUIRED',
    }
  }

  if (!orderStatus || typeof orderStatus !== 'string') {
    return {
      success: false,
      message: 'orderStatus inválido',
      errors: [],
      code: 'ORDER_STATUS_INVALID',
    }
  }

  return apiRequest('put', `/${id}/status`, { orderStatus })
}

const updateOrderPaymentStatus = async ({ id, paymentStatus }) => {
  if (!id) {
    return {
      success: false,
      message: 'ID de orden requerido',
      errors: [],
      code: 'ORDER_ID_REQUIRED',
    }
  }

  if (!paymentStatus || typeof paymentStatus !== 'string') {
    return {
      success: false,
      message: 'paymentStatus inválido',
      errors: [],
      code: 'PAYMENT_STATUS_INVALID',
    }
  }

  return apiRequest('put', `/${id}/payment-status`, { paymentStatus })
}

const updateOrderFulfillmentStatus = async ({ id, fulfillmentStatus }) => {
  if (!id) {
    return {
      success: false,
      message: 'ID de orden requerido',
      errors: [],
      code: 'ORDER_ID_REQUIRED',
    }
  }

  if (!fulfillmentStatus || typeof fulfillmentStatus !== 'string') {
    return {
      success: false,
      message: 'fulfillmentStatus inválido',
      errors: [],
      code: 'FULFILLMENT_STATUS_INVALID',
    }
  }

  return apiRequest('put', `/${id}/fulfillment-status`, { fulfillmentStatus })
}

const cancelOrder = async ({ id, reason }) => {
  if (!id) {
    return {
      success: false,
      message: 'ID de orden requerido',
      errors: [],
      code: 'ORDER_ID_REQUIRED',
    }
  }

  return apiRequest('post', `/${id}/cancel`, {
    reason: reason || 'Cancelación manual',
  })
}

const refundOrder = async ({ id }) => {
  if (!id) {
    return {
      success: false,
      message: 'ID de orden requerido',
      errors: [],
      code: 'ORDER_ID_REQUIRED',
    }
  }

  return apiRequest('post', `/${id}/refund`)
}

const deleteOrder = async ({ id, force = false } = {}) => {
  if (!id) {
    return {
      success: false,
      message: 'ID de orden requerido',
      errors: [],
      code: 'ORDER_ID_REQUIRED',
    }
  }

  return apiRequest('delete', `/${id}`, {
    force: Boolean(force),
  })
}

const orderService = {
  getOrders,
  getMyOrders,
  createOrder,
  updateOrderStatus,
  updateOrderPaymentStatus,
  updateOrderFulfillmentStatus,
  cancelOrder,
  refundOrder,
  deleteOrder,
}

export default orderService
