// 📁 src/features/user/productService.js (Nota: asegúrate del nombre del archivo)
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

    // 🔍 CORRECCIÓN DE URL: Evitamos el doble slash y aseguramos el prefijo correcto
    // Si endpoint es "/", mandamos "/product", si es "/123" mandamos "/product/123"
    const cleanEndpoint = endpoint === '/' ? '' : endpoint
    const url = `/order${cleanEndpoint}`

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
    return res.data
  } catch (err) {
    return handleApiError(err)
  }
}

const inflight = new Map()

const makeQueryKey = (params = {}) =>
  JSON.stringify({
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    status: params.status || null,
    q: params.q || null,
    from: params.from || null,
    to: params.to || null,
  })

// Crear orden (SIEMPRE antes de pagar)
const createOrder = async orderData => {
  const response = await apiRequest('post', '/create', orderData)
  console.log('CREATE ORDER RESPONSE:', response)
  return response.data
}

// Órdenes del usuario autenticado
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
      q: params.q,
      from: params.from,
      to: params.to,
    },
    signal,
  ).finally(() => inflight.delete(key))

  inflight.set(key, req)
  return req
}

// Orden puntual (opcional, si la necesitás)
const getOrderById = async id => {
  const response = await apiRequest('get', `/${id}`)
  return response.data
}

// ⚠️ Solo admin (si lo usás desde panel)
const updateOrderStatus = async (id, status) => {
  const response = await apiRequest('put', `/${id}/status`, {
    orderStatus: status,
  })
  return response.data
}

const orderService = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
}

export default orderService
