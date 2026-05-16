// 📁 src/services/api.js
import api from '@utils/axiosConfig'
import { env } from '../config/env.js'

// ============================================================================
// Config pública
// ============================================================================

export const API_BASE_URL = env.apiBaseUrl

// ============================================================================
// Store bridge opcional
// ============================================================================

let _store = null

export const setApiStore = store => {
  _store = store

  // Si axiosConfig también expone setApiStore, podés conectarlo ahí.
  // Por ahora mantenemos compatibilidad sin duplicar interceptores.
}

export const getApiStore = () => _store

// ============================================================================
// Analytics API
// ============================================================================

export const analyticsAPI = {
  getStatus: () => api.get('/analytics/status'),

  configure: data => api.post('/analytics/config', data),

  getDashboard: params =>
    api.get('/analytics/dashboard', {
      params,
    }),

  getRealtime: () => api.get('/analytics/realtime'),

  trackEvent: data => api.post('/analytics/track', data),
}

// ============================================================================
// User API
// ============================================================================

export const userAPI = {
  login: credentials => api.post('/user/login', credentials),

  adminLogin: credentials => api.post('/user/admin-login', credentials),

  registerAdmin: data => api.post('/user/register-admin', data, {
    skipCsrf: true,
  }),

  getProfile: () => api.get('/user/profile'),

  getMe: () => api.get('/user/me'),

  refresh: () => api.post('/user/refresh', {}, {
    withCredentials: true,
    skipAuthRefresh: true,
    skipCsrfRetry: true,
  }),

  logout: () => api.post('/user/logout'),
}

// ============================================================================
// Tenant API
// ============================================================================

export const tenantAPI = {
  resolve: params =>
    api.get('/tenants/resolve', {
      params,
      skipAuthRefresh: true,
      skipCsrfRetry: true,
    }),
}

// ============================================================================
// Theme API
// ============================================================================

export const themeAPI = {
  getPublicTheme: tenantId =>
    api.get(`/theme/public/${tenantId}`, {
      skipAuthRefresh: true,
      skipCsrfRetry: true,
    }),

  getAdminTheme: () => api.get('/theme/admin'),

  updateAdminTheme: data => api.put('/theme/admin', data),

  patchAdminTheme: data => api.patch('/theme/admin', data),

  resetTheme: () => api.post('/theme/admin/reset'),
}

// ============================================================================
// Export principal
// ============================================================================

export default api