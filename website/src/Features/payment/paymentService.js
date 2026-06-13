// 📁 src/features/payment/paymentService.js
import api from '@utils/axiosConfig'

const normalizeApiError = error => {
  const status = error?.response?.status || null
  const data = error?.response?.data || null

  console.error('API Error Detallado:', {
    message: error?.message,
    status,
    data,
    headers: error?.response?.headers,
  })

  if (data && typeof data === 'object') {
    return {
      success: false,
      status,
      code: data.code || data.errorCode || null,
      message: data.message || data.error || 'Error procesando el pago',
      details: data.details || data.detail || null,
      debug: data.debug,
      raw: data,
    }
  }

  return {
    success: false,
    status,
    code: null,
    message: error?.message || 'Error procesando el pago',
    details: null,
    debug: null,
    raw: null,
  }
}

const apiRequest = async (method, endpoint, data, options = {}) => {
  try {
    const normalizedMethod = String(method || 'get').toLowerCase()

    const cleanEndpoint = endpoint === '/' ? '' : endpoint
    const url = `/payments${cleanEndpoint}`

    const response = await api({
      method: normalizedMethod,
      url,
      data,
      withCredentials: true,
      ...options,
      headers: {
        Accept: 'application/json',
        ...(!['get', 'head', 'options'].includes(normalizedMethod) && {
          'Content-Type': 'application/json',
        }),
        ...options.headers,
      },
    })

    return response.data
  } catch (error) {
    throw normalizeApiError(error)
  }
}

const processPayment = async payload => {
  return apiRequest('post', '/process', payload)
}

const getPublicConfig = () =>
  apiRequest('get', '/config', undefined, {
    skipAuthRefresh: true,
    skipCsrfRetry: true,
  })

const getPaymentStatus = orderId =>
  apiRequest('get', `/status/${orderId}`, undefined, {
    headers: {
      Accept: 'application/json',
    },
  })

export default {
  getPublicConfig,
  processPayment,
  getPaymentStatus,
}
