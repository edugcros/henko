// src/features/user/userService.js
import Cookies from 'js-cookie'
import api, { fetchCsrfToken } from '@utils/axiosConfig'

// ======================================================
// Normalización estricta de respuestas AUTH
// ======================================================
const normalizeAuthResponse = res => {
  if (!res) return null
  const raw = res?.data?.data || res?.data || res
  return {
    user: raw?.user || raw?.data?.user || null,
    token: raw?.token || raw?.data?.token || raw?.data?.accessToken || null,
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
// Request genérico (prefija /enquiry y agrega CSRF)
// ======================================================
// No atrapa errores acá: el caller (los thunks de enquirySlice.js) ya tiene
// su propio try/catch que espera que esto rechace para poder despachar
// rejectWithValue. Antes esto atrapaba y devolvía {success:false,...} como
// si fuera una respuesta válida — el thunk nunca se enteraba del fallo y en
// deleteEnquiry incluso quitaba la consulta de la lista sin haberla borrado
// realmente en el backend.
const apiRequest = async (method, endpoint, data, options = {}) => {
  const csrfToken = await ensureCsrf()

  const config = {
    method,
    url: `/enquiry${endpoint}`,
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
}

// --- FUNCIONES EXPORTADAS CORREGIDAS ---

export const getEnquiries = async () => {
  // Especificamos el endpoint '/' para obtener todas
  const response = await apiRequest('get', '/get')
  return response
}

// src/features/enquiry/enquiryService.js
export const sendReply = async (id, message) => {
  // ⚠️ Importante: Verifica si tu backend usa /enquiry/reply o solo /reply
  //
  // Sin .data acá: apiRequest ya devuelve el body completo ({success, data}),
  // igual que getEnquiries/updateEnquiry/deleteEnquiry en este mismo archivo.
  // Extraer .data acá duplicaba el unwrap que ya hace el thunk consumidor
  // (sendReplyEnquiry en enquirySlice.js), así que la respuesta real nunca
  // llegaba con forma de enquiry actualizada.
  const response = await apiRequest('post', `/reply/${id}`, { message })
  return response
}
export const updateEnquiryStatus = async (id, status) => {
  const response = await apiRequest('put', `/${id}`, { status })
  return response
}

// 🔴 ALTERNATIVA: Si prefieres mantener updateEnquiry, crea un alias
export const updateEnquiry = updateEnquiryStatus

export const deleteEnquiry = async id => {
  const response = await apiRequest('delete', `/${id}`)
  return response
}

const enquiryService = {
  getEnquiries,
  sendReply,
  updateEnquiry,
  deleteEnquiry,
}

export default enquiryService
