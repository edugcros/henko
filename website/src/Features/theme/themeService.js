// 📁 src/Features/theme/themeService.js
import api from '@utils/axiosConfig'

// ==========================================
// Helpers
// ==========================================

const cleanMongoFields = config => {
  if (!config) return {}

  const { _id, createdAt, updatedAt, __v, ...cleanConfig } = config
  return cleanConfig
}

const normalizeServiceResponse = response => {
  return response?.data?.data || response?.data
}

const normalizeTenantResponse = response => {
  const data = response?.data?.data || response?.data
  const tenantId = data?.tenantId || data?._id || data?.id

  if (!tenantId) {
    throw new Error('Backend no devolvió tenantId válido')
  }

  return {
    tenantId,
    _id: tenantId,
    name: data?.name || data?.storeName || data?.slug,
    slug: data?.slug,
    ...data,
  }
}

const handleServiceError = (error, fallback = 'Error inesperado') => {
  console.error('[themeService]', error?.response?.data || error?.message || error)

  return {
    success: false,
    error: error?.response?.data?.message || error?.message || fallback,
    status: error?.response?.status,
  }
}

// ==========================================
// Servicio
// ==========================================

const themeService = {
  /**
   * Resuelve tenant por dominio.
   * GET /api/tenants/resolve
   */
  resolveTenantByDomain: async domain => {
    try {
      const response = await api.get('/tenants/resolve', {
        params: { domains: domain },
        timeout: 10000,
        skipAuthRefresh: true,
        skipCsrfRetry: true,
      })

      return {
        success: true,
        data: normalizeTenantResponse(response),
      }
    } catch (error) {
      return handleServiceError(error, 'Error resolviendo tenant')
    }
  },

  /**
   * Obtiene tema público por tenantId.
   * GET /api/theme/public/:tenantId
   */
  getPublicTheme: async tenantId => {
    try {
      if (!tenantId) throw new Error('tenantId requerido')

      const response = await api.get(`/theme/public/${tenantId}`, {
        timeout: 10000,
        skipAuthRefresh: true,
        skipCsrfRetry: true,
      })

      return {
        success: true,
        data: normalizeServiceResponse(response),
      }
    } catch (error) {
      return handleServiceError(error, 'Error cargando tema público')
    }
  },

  /**
   * Obtiene tema completo protegido para admin.
   * GET /api/theme/admin
   */
  getThemeConfig: async token => {
    try {
      const response = await api.get('/theme/admin', {
        timeout: 10000,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })

      return {
        success: true,
        data: normalizeServiceResponse(response),
      }
    } catch (error) {
      return handleServiceError(error, 'Error cargando configuración de tema')
    }
  },

  /**
   * Actualiza tema protegido para admin.
   * PUT /api/theme/
   */
  updateThemeConfig: async (token, config) => {
    try {
      if (!config) throw new Error('Config requerido')

      const response = await api.put('/theme/', cleanMongoFields(config), {
        timeout: 15000,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })

      return {
        success: true,
        data: normalizeServiceResponse(response),
        message: response.data?.message,
      }
    } catch (error) {
      return handleServiceError(error, 'Error actualizando configuración de tema')
    }
  },

  /**
   * Resetea tema protegido para admin.
   * POST /api/theme/reset
   */
  resetThemeConfig: async token => {
    try {
      const response = await api.post(
        '/theme/reset',
        {},
        {
          timeout: 10000,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      )

      return {
        success: true,
        data: normalizeServiceResponse(response),
        message: response.data?.message,
      }
    } catch (error) {
      return handleServiceError(error, 'Error reseteando configuración de tema')
    }
  },

  /**
   * Preview de tema protegido para admin.
   * POST /api/theme/preview
   */
  previewThemeConfig: async (token, config) => {
    try {
      const response = await api.post('/theme/preview', cleanMongoFields(config), {
        timeout: 10000,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })

      return {
        success: true,
        data: normalizeServiceResponse(response),
      }
    } catch (error) {
      return handleServiceError(error, 'Error generando preview de tema')
    }
  },

  /**
   * Sube asset protegido para admin.
   * POST /api/theme/upload/:assetType
   */
  uploadThemeAsset: async (token, file, assetType) => {
    try {
      if (!file) throw new Error('Archivo requerido')
      if (!assetType) throw new Error('assetType requerido')

      const formData = new FormData()
      formData.append('image', file)

      const response = await api.post(`/theme/upload/${assetType}`, formData, {
        timeout: 30000,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // No seteamos Content-Type. Axios lo maneja con boundary.
        },
      })

      return {
        success: true,
        data: normalizeServiceResponse(response),
        message: response.data?.message,
      }
    } catch (error) {
      return handleServiceError(error, 'Error subiendo asset de tema')
    }
  },
}

export default themeService
