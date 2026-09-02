// 📁 src/services/tenantService.js
import axios from 'axios'
import api from '@utils/axiosConfig'
import { env } from '../config/env.js'

// ======================================================
// Helpers
// ======================================================

const normalizeDomain = value => {
  return String(value || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '')
    .trim()
    .toLowerCase()
}

const getBrowserDomain = () => {
  if (typeof window === 'undefined') return ''
  return normalizeDomain(window.location.hostname)
}

const publicClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 12000,
  withCredentials: false,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

const tenantService = {
  /**
   * Obtener configuración de tema pública por tenantId o slug.
   */
  getPublicTheme: async tenantId => {
    try {
      const response = await api.get(`/theme/public/${tenantId}`, {
        skipAuthRefresh: true,
        skipCsrfRetry: true,
        skipTenantHeader: true,
        publicRequest: true,
        params: { ts: Date.now() },
      })

      return {
        success: true,
        data: response.data?.data,
      }
    } catch (error) {
      console.error('Error en getPublicTheme:', error)

      return {
        success: false,
        error: error.response?.data?.message || 'Error cargando tema',
      }
    }
  },

  /**
   * Resolver tenant por dominio.
   * Endpoint público: no debe enviar Authorization, CSRF ni x-tenant-domain.
   */
  resolveTenantByDomain: async domains => {
    try {
      const domain = normalizeDomain(domains || getBrowserDomain())

      if (!domain) {
        return {
          success: false,
          error: 'No se pudo detectar el dominio del comercio',
        }
      }

      const response = await publicClient.get('/tenants/resolve', {
        params: { domains: domain },
      })

      return {
        success: true,
        data: response.data?.data,
      }
    } catch (error) {
      console.error('Error en resolveTenantByDomain:', error)

      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Error resolviendo tenant',
      }
    }
  },

  /**
   * Resolver tenant por slug.
   * Endpoint público: no debe enviar Authorization, CSRF ni x-tenant-domain.
   */
  resolveTenantBySlug: async slug => {
    try {
      const cleanSlug = String(slug || '')
        .trim()
        .toLowerCase()

      if (!cleanSlug) {
        return {
          success: false,
          error: 'Slug de comercio inválido',
        }
      }

      const response = await publicClient.get('/tenants/resolve', {
        params: { slug: cleanSlug },
      })

      return {
        success: true,
        data: response.data?.data,
      }
    } catch (error) {
      console.error('Error en resolveTenantBySlug:', error)

      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Error resolviendo tenant',
      }
    }
  },
}

export default tenantService
