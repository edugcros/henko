import api, { fetchCsrfToken } from '@utils/axiosConfig'
import Cookies from 'js-cookie'

// ✅ Obtener token JWT desde cookie o localStorage
const getToken = () => Cookies.get('token') || localStorage.getItem('token')

// ✅ Función de llamada genérica a API con headers dinámicos y control de errores
const apiRequest = async ({
  method,
  endpoint,
  data = null,
  contentType = 'application/json',
  logLabel = null,
}) => {
  try {
    const csrfToken = await fetchCsrfToken()
    const token = getToken()

    const headers = {
      'x-csrf-token': csrfToken,
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(contentType && { 'Content-Type': contentType }),
    }

    const config = {
      method,
      url: `/enquiry${endpoint}`,
      headers,
      ...(data && { data }),
    }

    const response = await api(config)
    return response.data
  } catch (error) {
    console.error(
      `[blogService${logLabel ? ' → ' + logLabel : ''}] ❌`,
      error?.response?.data || error.message,
    )
    return {
      success: false,
      message:
        error?.response?.data?.message ||
        error.message ||
        'Error en el servidor',
    }
  }
}

const postQuery = async contactData => {
  try {
    const response = await apiRequest('post', '/enquiry', contactData)
    if (!response.success || !response.data)
      throw new Error('Respuesta inválida del servidor')

    sessionStorage.setItem('user', JSON.stringify(response.data))
    return response.data
  } catch (error) {
    console.error('⚠️ Error en login:', error)
    throw new Error(error?.response?.data?.message || 'Error en login')
  }
}

const getQueries = async () => {
  try {
    const response = await apiRequest('get', '/enquiry')
    if (!response.success || !response.data)
      throw new Error('Respuesta inválida del servidor')

    sessionStorage.setItem('user', JSON.stringify(response.data))
    return response.data
  } catch (error) {
    console.error('⚠️ Error en login:', error)
    throw new Error(error?.response?.data?.message || 'Error en login')
  }
}

const getQueryById = async id => {
  try {
    const response = await apiRequest('get', `/enquiry/${id}`)
    if (!response.success || !response.data)
      throw new Error('Respuesta inválida del servidor')

    sessionStorage.setItem('user', JSON.stringify(response.data))
    return response.data
  } catch (error) {
    console.error('⚠️ Error en login:', error)
    throw new Error(error?.response?.data?.message || 'Error en login')
  }
}

const updateQueryStatus = async (id, status) => {
  try {
    const response = await apiRequest('put', `/enquiry/${id}`, { status })
    if (!response.success || !response.data)
      throw new Error('Respuesta inválida del servidor')

    sessionStorage.setItem('user', JSON.stringify(response.data))
    return response.data
  } catch (error) {
    console.error('⚠️ Error en login:', error)
    throw new Error(error?.response?.data?.message || 'Error en login')
  }
}

const deleteQuery = async id => {
  try {
    const response = await apiRequest('delete', `/enquiry/${id}`)
    if (!response.success || !response.data)
      throw new Error('Respuesta inválida del servidor')

    sessionStorage.setItem('user', JSON.stringify(response.data))
    return response.data
  } catch (error) {
    console.error('⚠️ Error en login:', error)
    throw new Error(error?.response?.data?.message || 'Error en login')
  }
}

const contactService = {
  postQuery,
  getQueries,
  getQueryById,
  updateQueryStatus,
  deleteQuery,
}

export default contactService
