// src/services/couponApi.js
import api from '@utils/axiosConfig'
import Cookies from 'js-cookie'


// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_TIMEOUT = 30000 // 30 segundos
const MAX_RETRIES = 2

// ======================================================
// UTILIDADES
// ======================================================

const getAuthToken = () => {
  return localStorage.getItem('token') || 
         Cookies.get('token') || 
         null
}

export const getTenantId = (source = {}) => {
  const tenantId =
    source.tenantId ||
    source.tenant?._id ||
    source.user?.tenantId ||
    localStorage.getItem('tenantId') ||
    null

  if (tenantId) return String(tenantId)

  if (typeof window !== 'undefined') {
    return window.location.hostname
  }

  return null
}

export const toObjectId = id => {
  if (!id) return null
  const normalized = String(id)
  return /^[a-f\d]{24}$/i.test(normalized) ? normalized : null
}

// ======================================================
// HEADERS
// ======================================================

const buildHeaders = (options = {}) => {
  const { hasBody = false } = options
  
  const headers = {
    Accept: 'application/json'
  }

  if (hasBody) {
    headers['Content-Type'] = 'application/json'
  }

  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return headers
}


// ======================================================
// MANEJO DE ERRORES
// ======================================================

class ApiError extends Error {
  constructor(message, code, status, field = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.field = field
    this.isValidation = status === 400 || code === 'VALIDATION_ERROR'
    this.isDuplicate = status === 409 || code === 'DUPLICATE_CODE'
    this.isAuth = status === 401
    this.isForbidden = status === 403
    this.isNotFound = status === 404
  }
}

const handleError = (error) => {
  const response = error.response
  const data = response?.data

  // Error de red
  if (!response) {
    throw new ApiError(
      'Error de conexión. Verifica tu internet.',
      'NETWORK_ERROR',
      0
    )
  }

  const status = response.status
  const code = data?.code || 'UNKNOWN_ERROR'
  const message = data?.message || error.message || 'Error desconocido'
  const field = data?.field || null

  throw new ApiError(message, code, status, field)
}

// ======================================================
// REQUEST BASE
// ======================================================

const executeRequest = async (config, retryCount = 0) => {
  try {
    const response = await api({
      ...config,
      timeout: API_TIMEOUT,
      withCredentials: true
    })
    return response.data
  } catch (error) {
    // Reintentar en errores de red (502, 503, 504) o timeouts
    const shouldRetry = retryCount < MAX_RETRIES && (
      !error.response ||
      [502, 503, 504].includes(error.response.status) ||
      error.code === 'ECONNABORTED'
    )

    if (shouldRetry) {
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)))
      return executeRequest(config, retryCount + 1)
    }

    handleError(error)
  }
}

const request = (method, endpoint, data, options = {}) => {
  const hasBody = data !== undefined && data !== null
  const isGetOrDelete = ['get', 'delete'].includes(method.toLowerCase())
  
  const config = {
    method,
    url: `/coupons${endpoint}`,
    headers: buildHeaders({ hasBody: hasBody && !isGetOrDelete })
  }

  if (hasBody && !isGetOrDelete) {
    config.data = data
  }

  // Query params para GET
  if (method.toLowerCase() === 'get' && options.params) {
    config.params = options.params
  }

  return executeRequest(config)
}

// ======================================================
// API METHODS
// ======================================================

export const couponApi = {
  // Listar con filtros y paginación
  getCoupons: (filters = {}) => {
    const { page = 1, limit = 20, status, search, discountType, sortBy, order } = filters
    
    const params = new URLSearchParams()
    if (page) params.append('page', page)
    if (limit) params.append('limit', limit)
    if (status && status !== 'all') params.append('status', status)
    if (search?.trim()) params.append('search', search.trim())
    if (discountType) params.append('discountType', discountType)
    if (sortBy) params.append('sortBy', sortBy)
    if (order) params.append('order', order)

    const query = params.toString()
    return request('get', query ? `?${query}` : '')
  },

  // Obtener por ID
  getById: (id) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)
    return request('get', `/${id}`)
  },

  // Crear cupón
  create: (data) => {
    const payload = {
      ...data,
      description: data.description?.trim()
    }

    if (data.code?.trim()) {
      payload.code = data.code.trim().toUpperCase()
    } else {
      delete payload.code
    }

    return request('post', '', payload)
  },


  // Actualizar cupón
  update: (id, data) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)

    const payload = {
      ...data,
      ...(data.description && { description: data.description.trim() })
    }

    if (data.code?.trim()) {
      payload.code = data.code.trim().toUpperCase()
    } else {
      delete payload.code
    }

    return request('put', `/${id}`, payload)
  },

  // Clonar cupón
  clone: (id) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)
    return request('post', `/${id}/clone`, {})
  },

  // Generar cupones masivos
  generateBulk: (config) => {
    const tenantId = getTenantId()
    
    if (!tenantId) {
      throw new ApiError('Tenant no identificado', 'NO_TENANT', 400)
    }

    const payload = {
      count: Math.min(Math.max(1, parseInt(config.count) || 10), 100),
      prefix: config.prefix?.toUpperCase()?.trim() || '',
      tenantId,
      ...config
    }

    return request('post', '/bulk', payload)
  },

  // Soft delete (desactivar)
  delete: (id) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)
    return request('delete', `/${id}`)
  },

  // Hard delete (eliminar permanentemente) - NUEVO
  permanentDeleteCoupon: (id, force = false) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)
    return request('delete', `/${id}/permanent?force=${force}`)
  },
  // Restaurar cupón desactivado - NUEVO
  restore: (id) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)
    return request('patch', `/${id}/restore`, {})
  },

  // Listar eliminados (admin) - NUEVO
  getDeleted: (filters = {}) => {
    const { page = 1, limit = 20 } = filters
    const params = new URLSearchParams()
    params.append('page', page)
    params.append('limit', limit)
    
    return request('get', `/deleted?${params.toString()}`)
  },

  // Estadísticas - NUEVO (faltaba en tu código)
  getStats: (id) => {
    if (!id) throw new ApiError('ID requerido', 'MISSING_ID', 400)
    return request('get', `/${id}/stats`)
  },

  // Asignar productos
  assignProducts: (couponId, productIds, mode = 'add') => {
    if (!couponId) throw new ApiError('ID de cupón requerido', 'MISSING_ID', 400)
    
    const ids = Array.isArray(productIds) ? productIds : [productIds]
    if (ids.length === 0) {
      throw new ApiError('Debe seleccionar al menos un producto', 'NO_PRODUCTS', 400)
    }

    const validModes = ['add', 'remove', 'replace']
    if (!validModes.includes(mode)) {
      throw new ApiError(`Modo inválido. Use: ${validModes.join(', ')}`, 'INVALID_MODE', 400)
    }

    return request('put', `/${couponId}/products`, {
      productIds: ids,
      mode
    })
  },

  // Validar cupón (checkout)
  validate: (code, context = {}) => {
    if (!code?.trim()) {
      throw new ApiError('Código de cupón requerido', 'MISSING_CODE', 400)
    }

    const { cartItems = [], subtotal = 0, userId } = context

    return request('post', '/validate', {
      code: code.toUpperCase().trim(),
      cartItems,
      subtotal: parseFloat(subtotal) || 0,
      userId
    })
  },

}

export { ApiError }
export default couponApi
