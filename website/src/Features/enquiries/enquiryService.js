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
    const url = `/enquiry${cleanEndpoint}`

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

// --- FUNCIONES EXPORTADAS CORREGIDAS ---

export const createEnquiry = async enquiryData => {
  // PASO 1: Especificamos el endpoint '/'
  // PASO 2: Pasamos enquiryData como el cuerpo del POST
  const response = await apiRequest('post', '/', enquiryData)
  return response // No hace falta .data aquí, apiRequest ya lo extrajo
}

export const getEnquiries = async () => {
  // Especificamos el endpoint '/' para obtener todas
  const response = await apiRequest('get', '/')
  return response
}

export const updateEnquiry = async data => {
  // data: { id, status }
  const response = await apiRequest('put', `/${data.id}`, {
    status: data.status,
  })
  return response
}

export const deleteEnquiry = async id => {
  const response = await apiRequest('delete', `/${id}`)
  return response
}

const enquiryService = {
  createEnquiry,
  getEnquiries,
  updateEnquiry,
  deleteEnquiry,
}

export default enquiryService
