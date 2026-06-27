// src/features/theme/themeApi.js - VERSIÓN PRODUCCIÓN REFACTORIZADA
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import Cookies from 'js-cookie'
import { sanitizePayload, normalizeImageAsset } from './utils/themeSanitizer.js'

export { normalizeImageAsset }

// ==========================================
// CONFIGURACIÓN
// ==========================================

const API_BASE = '/theme/admin' // Todos los admin van aquí
const PUBLIC_BASE = '/theme' // Públicos sin /admin

const DEFAULT_TIMEOUT = 30000
const UPLOAD_TIMEOUT = 60000

// ==========================================
// UTILIDADES INTERNAS
// ==========================================

const getAuthToken = () => Cookies.get('token')

/**
 * Construye headers según tipo de request
 */
const buildHeaders = async ({ isMultipart = false, customHeaders = {} }) => {
  const headers = { ...customHeaders }

  // CSRF
  try {
    const csrfToken = await fetchCsrfToken()
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  } catch {
    console.warn('[ThemeAPI] No se pudo obtener CSRF token')
  }

  // Auth
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`

  // Content-Type solo si NO es FormData (axios lo setea con boundary)
  if (!isMultipart) {
    headers['Content-Type'] = 'application/json'
  }

  return headers
}

/**
 * Manejo centralizado de errores HTTP
 */
const handleHttpError = (error, context) => {
  const status = error?.response?.status
  const data = error?.response?.data
  const message = data?.message || error.message

  const errorMap = {
    400: 'Datos inválidos. Verifique la información enviada.',
    401: 'Sesión expirada. Inicie sesión nuevamente.',
    403: 'No tiene permisos para esta acción.',
    404: 'Recurso no encontrado.',
    413: 'Archivo demasiado grande. Máximo 5MB permitido.',
    422:
      'Validación fallida: ' +
      (data?.errors?.map(e => e.message).join(', ') || message),
    429: 'Demasiadas peticiones. Espere un momento.',
    500: 'Error interno del servidor. Intente más tarde.',
  }

  const userMessage =
    errorMap[status] || message || `Error ${status || 'desconocido'}`

  if (process.env.NODE_ENV === 'development') {
    console.error(`[ThemeAPI Error] ${context}:`, {
      status,
      message,
      data,
      config: error.config,
    })
  }

  const enhancedError = new Error(userMessage)
  enhancedError.status = status
  enhancedError.originalError = error
  enhancedError.responseData = data
  throw enhancedError
}

/**
 * Request base con manejo de errores
 */
const request = async (method, endpoint, options = {}) => {
  const {
    data = null,
    baseUrl = API_BASE,
    isMultipart = false,
    responseType = 'json',
    timeout = DEFAULT_TIMEOUT,
    customHeaders = {},
  } = options

  const url = `${baseUrl}${endpoint}`

  try {
    const headers = await buildHeaders({ isMultipart, customHeaders })

    const config = {
      method: method.toLowerCase(),
      url,
      headers,
      timeout,
      responseType,
    }

    if (data !== null) {
      config.data = isMultipart ? data : sanitizePayload(data)
    }

    // Debug dev
    if (process.env.NODE_ENV === 'development') {
      console.log(`[ThemeAPI] ${method} ${url}`, {
        isMultipart,
        hasData: !!data,
        dataType: data instanceof FormData ? 'FormData' : typeof data,
      })
    }

    const response = await api(config)
    return response.data
  } catch (error) {
    handleHttpError(error, `${method} ${url}`)
  }
}

// ==========================================
// API PÚBLICA (NO AUTH)
// ==========================================

/**
 * Obtener tema público (para storefront/preview)
 */
export const getPublicTheme = () => request('GET', '', { baseUrl: PUBLIC_BASE })

/**
 * Obtener tema por tenantId específico
 */
export const getPublicThemeById = tenantId =>
  request('GET', `/public/${tenantId}`, { baseUrl: PUBLIC_BASE })

/**
 * Obtener CSS generado (para <link> tag)
 */
export const getThemeCSS = () =>
  request('GET', '/theme.css', {
    baseUrl: PUBLIC_BASE,
    responseType: 'text',
  })

// ==========================================
// API ADMIN (REQUIERE AUTH)
// ==========================================

/**
 * Obtener tema completo para edición
 */
export const getTheme = () => request('GET', '')

/**
 * Actualización completa (con validación full)
 */
export const updateTheme = data => request('PUT', '', { data })

/**
 * Actualización parcial (auto-save)
 */
export const patchTheme = data => request('PATCH', '', { data })

/**
 * Crear preview sin activar
 */
export const createPreview = data => request('POST', '/preview', { data })

/**
 * Activar preview como tema principal
 */
export const activatePreview = previewId =>
  request('POST', `/preview/${previewId}/activate`)

/**
 * Resetear a defaults
 */
export const resetTheme = () => request('POST', '/reset')

/**
 * Toggle modo mantenimiento
 */
export const toggleMaintenance = enabled =>
  request('POST', '/maintenance', { data: { enabled } })

// ==========================================
// IMPORT/EXPORT
// ==========================================

/**
 * Exportar tema como JSON
 */
export const exportTheme = () =>
  request('GET', '/export', { responseType: 'blob' })

/**
 * Importar tema desde JSON
 */
export const importTheme = data => request('POST', '/import', { data })

/**
 * Descargar export automáticamente
 */
export const downloadExport = async filename => {
  const blob = await exportTheme()
  const url = window.URL.createObjectURL(blob)
  let link = null

  try {
    link = document.createElement('a')
    link.href = url
    link.download = filename || `theme-export-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
  } finally {
    if (link?.parentNode) {
      document.body.removeChild(link)
    }
    window.URL.revokeObjectURL(url)
  }
}

// ==========================================
// VERSIONADO
// ==========================================

/**
 * Obtener historial de versiones
 */
export const getThemeHistory = (limit = 10) =>
  request('GET', `/history?limit=${limit}`)

/**
 * Rollback a versión específica
 */
export const rollbackTheme = version =>
  request('POST', '/rollback', { data: { version } })

/**
 * Validar configuración sin guardar
 */
export const validateTheme = data => request('POST', '/validate', { data })

// ==========================================
// UPLOADS
// ==========================================

/**
 * Subir imagen genérica
 */
export const uploadImage = (file, type = 'generic') => {
  const formData = new FormData()
  formData.append('image', file) // 'image' no 'images' (single en multer)
  formData.append('type', type)

  return request('POST', '/upload-image', {
    data: formData,
    isMultipart: true,
    timeout: UPLOAD_TIMEOUT,
  })
}

export const uploadLogo = file => uploadImage(file, 'logo')
export const uploadHeroImage = file => uploadImage(file, 'hero')
export const uploadFavicon = file => uploadImage(file, 'favicon')

// ==========================================
// EXPORT LEGACY (default object)
// ==========================================

const themeApi = {
  // Públicos
  getPublicTheme,
  getPublicThemeById,
  getThemeCSS,

  // Admin
  getTheme,
  updateTheme,
  patchTheme,
  createPreview,
  activatePreview,
  resetTheme,
  toggleMaintenance,

  // Import/Export
  exportTheme,
  importTheme,
  downloadExport,

  // Versionado
  getThemeHistory,
  rollbackTheme,
  validateTheme,

  // Uploads
  uploadImage,
  uploadLogo,
  uploadHeroImage,
  uploadFavicon,
}

export default themeApi
