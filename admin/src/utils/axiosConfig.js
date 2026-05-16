// 📁 admin/src/utils/axiosConfig.js
import axios from 'axios'
import Cookies from 'js-cookie'
import { env } from '../config/env.js'

let _store = null
export const setApiStore = store => {
  _store = store
}

// =====================================================
// Tenant domain
// =====================================================

const getTenantDomain = () => {
  if (typeof window === 'undefined') return null

  // Usar host completo permite que el backend vea el puerto en desarrollo.
  // Tu backend debe normalizar y remover :3001 si corresponde.
  return window.location.host
}

const getAuthToken = () => {
  return (
    Cookies.get('token') ||
    localStorage.getItem('token') ||
    null
  )
}

// =====================================================
// Axios instance
// =====================================================

const api = axios.create({
  baseURL: env.apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

// =====================================================
// CSRF
// =====================================================

let csrfTokenPromise = null
let refreshTokenPromise = null

export const fetchCsrfToken = async () => {
  try {
    const res = await api.get('/user/csrf-token');
    const token = res.data?.csrfToken;
    if (token) {
      api.defaults.headers.common['x-csrf-token'] = token;
      return token;
    }
  } catch (err) {
    console.error('[CSRF] Fallo crítico:', err.message);
    return null;
  }
};

export const initCsrf = async () => {
  const token = await fetchCsrfToken()

  if (token) {
    api.defaults.headers.common['x-csrf-token'] = token
  }

  return token
}

// =====================================================
// Request interceptor
// =====================================================

api.interceptors.request.use(
  config => {
    config.headers = config.headers || {}

    if (env.enableTenantDomainResolution) {
      const tenantDomain = getTenantDomain()

      if (tenantDomain) {
        config.headers[env.tenantHeader] = tenantDomain
      }
    }

    const token = getAuthToken()

    if (token && !config.url?.includes('/refresh')) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  },
  error => Promise.reject(error),
)

// =====================================================
// Response interceptor
// =====================================================

api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config

    if (!originalRequest) {
      return Promise.reject(error)
    }

    if (originalRequest._retry) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const code = error.response?.data?.code
    const message = error.response?.data?.message || ''

    // =====================================================
    // CSRF retry
    // =====================================================

    const isCsrfError =
      status === 403 &&
      (
        code === 'EBADCSRFTOKEN' ||
        message.toLowerCase().includes('csrf')
      )

    if (isCsrfError && !originalRequest.skipCsrfRetry) {
      originalRequest._retry = true

      const newCsrf = await fetchCsrfToken()

      if (newCsrf) {
        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers['x-csrf-token'] = newCsrf

        return api(originalRequest)
      }
    }

    // =====================================================
    // Auth refresh
    // =====================================================

    const isAuthError = status === 401
    const isLoginRequest = originalRequest.url?.includes('/login')
    const isRefreshRequest = originalRequest.url?.includes('/refresh')

    if (
      isAuthError &&
      !isLoginRequest &&
      !isRefreshRequest &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._retry = true

      try {
        if (!refreshTokenPromise) {
          refreshTokenPromise = api
            .post('/user/refresh', {}, {
              withCredentials: true,
              skipAuthRefresh: true,
              skipCsrfRetry: true,
            })
            .finally(() => {
              refreshTokenPromise = null
            })
        }

        const res = await refreshTokenPromise
        const token = res.data?.token || res.data?.accessToken

        if (token) {
          localStorage.setItem('token', token)
          api.defaults.headers.common.Authorization = `Bearer ${token}`

          originalRequest.headers = originalRequest.headers || {}
          originalRequest.headers.Authorization = `Bearer ${token}`
        }

        return api(originalRequest)
      } catch (refreshError) {
        localStorage.removeItem('token')
        Cookies.remove('token')

        if (typeof window !== 'undefined') {
          window.location.href = '/login'
        }

        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export default api