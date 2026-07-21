// 📁 src/features/promotionalBlocks/promotionalBlocksService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import Cookies from 'js-cookie'

const BASE_URL = '/promotional-blocks'

const getAuthToken = () => Cookies.get('token') || localStorage.getItem('token') || null

const getTenantDomain = () => {
  if (typeof window === 'undefined') return undefined
  return window.location.host
}

const extractErrorMessage = (error, fallback = 'Error en Promotional Blocks') => {
  const data = error?.response?.data

  if (typeof data === 'string') return data
  if (data?.message) return data.message
  if (data?.error) return data.error

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    return data.errors
      .map(err => err?.msg || err?.message || err)
      .filter(Boolean)
      .join(', ')
  }

  return error?.message || fallback
}

const apiRequest = async (method, endpoint = '', data = undefined, options = {}) => {
  try {
    const csrfToken = await fetchCsrfToken()
    const token = getAuthToken()

    const {
      headers: customHeaders = {},
      params,
      withCredentials = true,
      includeAuth = false,
      includeCsrf = false,
      includeTenantDomain = true,
      ...restOptions
    } = options

    const tenantDomain = getTenantDomain()

    const headers = {
      Accept: 'application/json',
      ...(includeCsrf && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(includeAuth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...(includeTenantDomain && tenantDomain ? { 'X-Tenant-Domain': tenantDomain } : {}),
      ...customHeaders,
    }

    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers,
      params,
      withCredentials,
      ...restOptions,
    }

    if (data !== undefined) {
      config.data = data
    }

    const response = await api(config)
    return response.data
  } catch (error) {
    throw new Error(extractErrorMessage(error))
  }
}

/**
 * Website público:
 * GET /api/promotional-blocks/public?placement=home
 */
const getPublicPromotionalBlocks = async (params = {}) => {
  return apiRequest('get', '/public', undefined, {
    params,
    includeAuth: false,
    includeCsrf: false,
    includeTenantDomain: true,
  })
}

/**
 * Website público:
 * GET /api/promotional-blocks/public/:slug
 */
const getPublicPromotionalBlockBySlug = async slug => {
  if (!slug) {
    throw new Error('Slug del bloque promocional requerido')
  }

  return apiRequest('get', `/public/${encodeURIComponent(slug)}`, undefined, {
    includeAuth: false,
    includeCsrf: false,
    includeTenantDomain: true,
  })
}

const promotionalBlocksService = {
  getPublicPromotionalBlocks,
  getPublicPromotionalBlockBySlug,
}

export default promotionalBlocksService
