// 📁 src/features/payment/paymentService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'

let cachedCsrfToken = null

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
      message:
        data.message ||
        data.error ||
        'Error procesando el pago',
      details:
        data.details ||
        data.detail ||
        null,
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

const ensureCsrf = async ({ force = false } = {}) => {
  if (!force && cachedCsrfToken) return cachedCsrfToken

  cachedCsrfToken = await fetchCsrfToken()
  return cachedCsrfToken
}

const apiRequest = async (method, endpoint, data, options = {}) => {
  try {
    const csrfToken = await ensureCsrf()

    const cleanEndpoint = endpoint === '/' ? '' : endpoint
    const url = `/payments${cleanEndpoint}`

    const response = await api({
      method,
      url,
      data,
      withCredentials: true,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      ...options,
    })

    return response.data
  } catch (error) {
    const normalizedError = normalizeApiError(error)

    // Si falló por CSRF, limpiamos cache para el próximo intento.
    if (
      normalizedError.status === 403 ||
      normalizedError.code === 'EBADCSRFTOKEN' ||
      String(normalizedError.message || '').toLowerCase().includes('csrf')
    ) {
      cachedCsrfToken = null
    }

    throw normalizedError
  }
}

const processPayment = async payload => {
  console.log('Enviando datos de pago al backend:', {
    orderId: payload?.orderId,
    payment_method_id: payload?.payment_method_id,
    installments: payload?.installments,
    issuer_id: payload?.issuer_id,
    payerEmail: payload?.payer?.email,
    hasToken: Boolean(payload?.token),
  })

  return apiRequest('post', '/process', payload)
}

export default {
  processPayment,
}