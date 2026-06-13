import api, { fetchCsrfToken } from '@utils/axiosConfig'

// ======================================================
// Manejo uniforme de errores
// ======================================================
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

// ======================================================
// CSRF Loader (con auto-recuperación)
// ======================================================
let cachedCsrfToken = null

const ensureCsrf = async () => {
  if (cachedCsrfToken) return cachedCsrfToken
  return await fetchCsrfToken()
}

// ======================================================
// Request genérico (prefija /user y agrega CSRF)
// ======================================================
const apiRequest = async (method, endpoint, data, options = {}) => {
  try {
    const csrfToken = await ensureCsrf()

    const config = {
      method,
      url: `/dash${endpoint}`,
      withCredentials: true,
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'x-csrf-token': csrfToken, // <--- enviar token CSRF
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

const getStats = async () => {
  const response = await apiRequest('get', '/stats')
  return response.data
}

const dashboardService = {
  getStats,
}

export default dashboardService
