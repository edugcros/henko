// 📁 src/features/promotionalBlocks/promotionalBlocksService.js
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import Cookies from 'js-cookie'

const BASE_URL = '/promotional-blocks'

const getAuthToken = () =>
  Cookies.get('token') || localStorage.getItem('token') || null

const getTenantDomain = () => {
  if (typeof window === 'undefined') return undefined
  return window.location.host
}

const extractErrorMessage = (
  error,
  fallback = 'Error en Promotional Blocks',
) => {
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

/**
 * Helper universal de requests para Promotional Blocks.
 *
 * Respeta el mismo patrón de productService:
 * - CSRF automático
 * - Authorization Bearer
 * - withCredentials
 * - params
 * - headers extra
 * - X-Tenant-Domain para resolución multi-tenant
 */
const apiRequest = async (
  method,
  endpoint = '',
  data = undefined,
  options = {},
) => {
  try {
    const csrfToken = await fetchCsrfToken()
    const token = getAuthToken()

    const {
      headers: customHeaders = {},
      params,
      withCredentials = true,
      includeTenantDomain = true,
      ...restOptions
    } = options

    const tenantDomain = getTenantDomain()

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(includeTenantDomain && tenantDomain
        ? { 'X-Tenant-Domain': tenantDomain }
        : {}),
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
 * Listar bloques promocionales del tenant actual.
 *
 * Params soportados:
 * - page
 * - limit
 * - placement
 * - type
 * - q
 */
const getPromotionalBlocks = async (params = {}) => {
  return apiRequest('get', '/', undefined, {
    params,
  })
}

/**
 * Obtener bloque promocional por ID.
 */
const getPromotionalBlock = async blockId => {
  if (!blockId) {
    throw new Error('ID del bloque promocional requerido')
  }

  return apiRequest('get', `/${blockId}`)
}

/**
 * Crear bloque promocional.
 */
const createPromotionalBlock = async blockData => {
  if (!blockData || typeof blockData !== 'object') {
    throw new Error('No se proporcionó el payload del bloque promocional')
  }

  return apiRequest('post', '/', blockData)
}

/**
 * Actualizar bloque promocional.
 *
 * Acepta:
 * - updatePromotionalBlock(blockId, data)
 * - updatePromotionalBlock({ blockId, id, data })
 */
const updatePromotionalBlock = async (blockIdOrPayload, maybeData) => {
  let blockId = blockIdOrPayload
  let data = maybeData

  if (typeof blockIdOrPayload === 'object' && blockIdOrPayload !== null) {
    blockId =
      blockIdOrPayload.blockId || blockIdOrPayload.id || blockIdOrPayload._id
    data = blockIdOrPayload.data
  }

  if (!blockId) {
    throw new Error('ID del bloque promocional requerido')
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Payload de actualización inválido')
  }

  return apiRequest('put', `/${blockId}`, data)
}

/**
 * Activar/desactivar bloque promocional.
 *
 * Acepta:
 * - togglePromotionalBlockStatus(blockId, isActive)
 * - togglePromotionalBlockStatus({ blockId, id, isActive })
 */
const togglePromotionalBlockStatus = async (
  blockIdOrPayload,
  maybeIsActive,
) => {
  let blockId = blockIdOrPayload
  let isActive = maybeIsActive

  if (typeof blockIdOrPayload === 'object' && blockIdOrPayload !== null) {
    blockId =
      blockIdOrPayload.blockId || blockIdOrPayload.id || blockIdOrPayload._id
    isActive = blockIdOrPayload.isActive
  }

  if (!blockId) {
    throw new Error('ID del bloque promocional requerido')
  }

  if (typeof isActive !== 'boolean') {
    throw new Error('El estado del bloque debe ser booleano')
  }

  return apiRequest('patch', `/${blockId}/status`, { isActive })
}

/**
 * Eliminar bloque promocional.
 */
const deletePromotionalBlock = async (blockId, options = {}) => {
  if (!blockId) {
    throw new Error('ID del bloque promocional requerido')
  }

  const params = new URLSearchParams()

  if (options.hard === true) {
    params.set('hard', 'true')
  }

  const query = params.toString()

  const url = query
    ? `/promotional-blocks/${blockId}?${query}`
    : `/promotional-blocks/${blockId}`

  const response = await api.delete(url)

  return response.data
}

/**
 * Obtener bloques públicos para el storefront.
 *
 * Normalmente usado desde website/home.
 * Params:
 * - placement: home/category/cart/etc.
 * - type: weekly_offers/featured_products/etc.
 */
const getPublicPromotionalBlocks = async (params = {}) => {
  return apiRequest('get', '/public', undefined, {
    params,
    includeTenantDomain: true,
  })
}

/**
 * Obtener bloque público por slug.
 */
const getPublicPromotionalBlockBySlug = async slug => {
  if (!slug) {
    throw new Error('Slug del bloque promocional requerido')
  }

  return apiRequest('get', `/public/${encodeURIComponent(slug)}`, undefined, {
    includeTenantDomain: true,
  })
}

const promotionalBlocksService = {
  getPromotionalBlocks,
  getPromotionalBlock,
  createPromotionalBlock,
  updatePromotionalBlock,
  togglePromotionalBlockStatus,
  deletePromotionalBlock,
  getPublicPromotionalBlocks,
  getPublicPromotionalBlockBySlug,
}

export default promotionalBlocksService
