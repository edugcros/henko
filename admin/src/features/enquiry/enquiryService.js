// src/features/user/userService.js
import Cookies from 'js-cookie'
import api, { fetchCsrfToken } from '@utils/axiosConfig'

// ======================================================
// Normalización estricta de respuestas AUTH
// ======================================================
const normalizeAuthResponse = res => {
  if (!res) return null
  const raw = res?.data?.data || res?.data || res;
  return {
    user: raw?.user || raw?.data?.user || null,
    token: raw?.token || raw?.data?.token || raw?.data?.accessToken || null,
  }
}

// ======================================================
// Manejo uniforme de errores
// ======================================================
const handleApiError = (error, fallback = 'Error inesperado') => {
  // Prioridad 1: Error enviado por el Backend (res.status(400).send({message: '...'}))
  // Prioridad 2: Error de Axios (error.message)
  const msg = error?.response?.data?.message || error?.message || fallback;

  console.error('API Error:', msg);
  
  // Retornamos un objeto con el mismo "shape" que el éxito pero con success: false
  return { 
    success: false, 
    message: msg,
    errors: error?.response?.data?.errors || [] // Por si envías lista de validaciones
  };
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
    
  } catch (err) {
    return handleApiError(err)
  }
}

// --- FUNCIONES EXPORTADAS CORREGIDAS ---

export const getEnquiries = async () => {
  // Especificamos el endpoint '/' para obtener todas
  const response = await apiRequest('get', '/get');
  return response;
};

// src/features/enquiry/enquiryService.js
export const sendReply = async (id, message) => {
  // ⚠️ Importante: Verifica si tu backend usa /enquiry/reply o solo /reply
  const response = await apiRequest('post', `/reply/${id}`, { message });
  return response.data;
};
export const updateEnquiryStatus = async (id, status) => {
  const response = await apiRequest('put', `/${id}`, { status });
  return response;
};

// 🔴 ALTERNATIVA: Si prefieres mantener updateEnquiry, crea un alias
export const updateEnquiry = updateEnquiryStatus;

export const deleteEnquiry = async (id) => {
  const response = await apiRequest('delete', `/${id}`);
  return response;
};

const enquiryService = {
  getEnquiries,
  sendReply,
  updateEnquiry,
  deleteEnquiry,
};

export default enquiryService;
