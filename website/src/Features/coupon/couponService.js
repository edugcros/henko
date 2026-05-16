import api, { fetchCsrfToken } from '@utils/axiosConfig'

const handleApiError = (error, fallback = 'Error inesperado') => {
  // Prioridad 1: Error enviado por el Backend (res.status(400).send({message: '...'}))
  // Prioridad 2: Error de Axios (error.message)
  const msg = error?.response?.data?.message || error?.message || fallback

  console.error('API Error:', msg)

  // Retornamos un objeto con el mismo "shape" que el éxito pero con success: false
  return {
    success: false,
    message: msg,
    errors: error?.response?.data?.errors || [], // Por si envías lista de validaciones
  }
}

let cachedCsrfToken = null
const ensureCsrf = async () => {
  if (cachedCsrfToken) return cachedCsrfToken
  cachedCsrfToken = await fetchCsrfToken()
  return cachedCsrfToken
}

const apiRequest = async (method, endpoint, data, options = {}) => {
  try {
    const csrfToken = await ensureCsrf()

    // Si endpoint es "/" o undefined, mandamos "/enquiry"
    const cleanEndpoint = !endpoint || endpoint === '/' ? '' : endpoint
    const url = `/coupons${cleanEndpoint}`

    const config = {
      method,
      url,
      withCredentials: true,
      ...options,
      headers: {
        Accept: 'application/json',
        'x-csrf-token': csrfToken,
        ...options.headers,
      },
    }

    if (data !== undefined) config.data = data
    const res = await api(config)

    // IMPORTANTE: Devolvemos res.data directamente porque apiRequest
    // ya está retornando el contenido de la respuesta.
    return res.data
  } catch (err) {
    return handleApiError(err)
  }
}

const getAllCoupons = async () => {
  const response = await apiRequest('get', '/')
  return response.data
}

const getCouponById = async id => {
  const response = await apiRequest('get', `/${id}`)
  return response.data
}

const updateCoupon = async (id, couponData) => {
  const response = await apiRequest('put', `/${id}`, couponData)
  return response.data
}

const deleteCoupon = async id => {
  const response = await apiRequest('delete', `/${id}`)
  return response.data
}

// En couponService.js, cambia applyCoupon por algo más robusto:
const applyCoupon = async couponData => {
  // couponData debería ser { code, items, subtotal }
  const response = await apiRequest('post', '/validate', couponData)
  console.log('Response:', response)
  return response.data
}

const getCouponDetails = async id => {
  const response = await apiRequest('get', `/${id}`)
  const { discount, isActive, usageLimit, usedCount } = response.data
  return { discount, isActive, usageLimit, usedCount }
}

const couponService = {
  getAllCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  applyCoupon,
  getCouponDetails,
}

export default couponService
