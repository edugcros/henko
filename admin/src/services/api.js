// 📁 src/services/api.js
import api from '@utils/axiosConfig'
import { env } from '../config/env.js'

// ============================================================================
// Config pública
// ============================================================================

export const API_BASE_URL = env.apiBaseUrl

// ============================================================================
// Runtime guard
// ============================================================================

if (!API_BASE_URL) {
  throw new Error('REACT_APP_API_BASE_URL no está configurado en admin')
}

// ============================================================================
// Store bridge opcional
// ============================================================================

let _store = null

export const setApiStore = store => {
  _store = store
}

export const getApiStore = () => _store

// ============================================================================
// Auth API
// ============================================================================

export const userAPI = {
  login: credentials =>
    api.post('/user/login', credentials, {
      skipCsrf: true,
    }),

  adminLogin: credentials =>
    api.post('/user/admin-login', credentials, {
      skipCsrf: true,
    }),

  registerAdmin: data =>
    api.post('/user/register-admin', data, {
      skipCsrf: true,
    }),

  getProfile: () => api.get('/user/profile'),

  getMe: () => api.get('/user/me'),

  refresh: () =>
    api.post(
      '/user/refresh',
      {},
      {
        withCredentials: true,
        skipAuthRefresh: true,
        skipCsrfRetry: true,
      },
    ),

  logout: () => api.post('/user/logout'),
}

// ============================================================================
// Analytics API
// ============================================================================

export const analyticsAPI = {
  getStatus: () => api.get('/dash/stats'),

  configure: data => api.post('/analytics/config', data),

  getDashboard: params =>
    api.get('/dash/stats', {
      params,
    }),

  getRealtime: () => api.get('/analytics/realtime'),

  trackEvent: data => api.post('/analytics/track', data),
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

  getCurrent: () => api.get('/tenants/current'),
}

// ============================================================================
// Products API
// ============================================================================

export const productAPI = {
  getAll: params => api.get('/product', { params }),

  getById: id => api.get(`/product/${id}`),

  create: data => api.post('/product', data),

  update: (id, data) => api.put(`/product/${id}`, data),

  delete: id => api.delete(`/product/${id}`),
}

// ============================================================================
// Orders API
// ============================================================================

export const orderAPI = {
  getAll: params => api.get('/order/getAll', { params }),

  getById: id => api.get(`/order/${id}`),

  updateStatus: (id, status) => api.put(`/order/${id}/status`, { status }),

  delete: id => api.delete(`/order/${id}`),
}

// ============================================================================
// Export principal
// ============================================================================

const apiService = {
  user: userAPI,
  analytics: analyticsAPI,
  tenant: tenantAPI,
  product: productAPI,
  order: orderAPI,

  // Compatibilidad con código viejo
  login: userAPI.login,
  adminLogin: userAPI.adminLogin,
  registerAdmin: userAPI.registerAdmin,
  getMe: userAPI.getMe,
  logout: userAPI.logout,
  refresh: userAPI.refresh,
}

export default apiService
