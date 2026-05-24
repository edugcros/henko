// 📁 admin/src/utils/axiosConfig.js
import axios from 'axios'
import Cookies from 'js-cookie'
import { env } from '../config/env.js'

let _store = null

export const setApiStore = store => {
  _store = store
}

// =====================================================
// Runtime guards
// =====================================================

const assertApiBaseUrl = () => {
  if (!env.apiBaseUrl) {
    throw new Error('REACT_APP_API_BASE_URL no está configurado')
  }

  if (env.isProduction) {
    const forbiddenValues = [
      'localhost',
      '127.0.0.1',
      'henko.local',
      'api.henko.com',
    ]

    forbiddenValues.forEach(value => {
      if (String(env.apiBaseUrl).includes(value)) {
        throw new Error(
          `REACT_APP_API_BASE_URL inválido para esta etapa: ${env.apiBaseUrl}`,
        )
      }
    })
  }
}

assertApiBaseUrl()

// =====================================================
// Tenant domain
// =====================================================

const getTenantDomain = () => {
  if (typeof window === 'undefined') return null
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

const API_BASE_URL =
  env.apiBaseUrl ||
  process.env.REACT_APP_API_BASE_URL ||
  process.env.REACT_APP_API_URL ||
  ''

if (!API_BASE_URL) {
  throw new Error('REACT_APP_API_BASE_URL no está configurado en admin')
}

if (API_BASE_URL.includes('henko-admin.vercel.app')) {
  throw new Error(`API_BASE_URL inválido: ${API_BASE_URL}`)
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

console.log('[ADMIN API BOOT]', {
  apiBaseUrl: API_BASE_URL,
  envApiBaseUrl: env.apiBaseUrl,
  reactApiBaseUrl: process.env.REACT_APP_API_BASE_URL,
})

// Debug temporal de producción
if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
  // eslint-disable-next-line no-console
  console.log('[ADMIN API BOOT]', {
    apiBaseUrl: env.apiBaseUrl,
    nodeEnv: env.nodeEnv,
    adminBaseDomain: env.adminBaseDomain,
    publicBaseDomain: env.publicBaseDomain,
  })
}

// =====================================================
// CSRF
// =====================================================

let csrfTokenPromise = null
let refreshTokenPromise = null

export const clearCsrfToken = () => {
  csrfTokenPromise = null
  delete api.defaults.headers.common['x-csrf-token']
}

export const fetchCsrfToken = async ({ force = false } = {}) => {
  try {
    if (csrfTokenPromise && !force) {
      return csrfTokenPromise
    }

    csrfTokenPromise = api
      .get('/user/csrf-token', {
        withCredentials: true,
        skipAuthRefresh: true,
        skipCsrfRetry: true,
      })
      .then(res => {
        const token =
          res.data?.csrfToken ||
          res.data?.token ||
          res.headers?.['x-csrf-token'] ||
          null

        if (token) {
          api.defaults.headers.common['x-csrf-token'] = token
        }

        return token
      })
      .finally(() => {
        csrfTokenPromise = null
      })

    return csrfTokenPromise
  } catch (err) {
    console.error('[CSRF] Fallo crítico:', {
      baseURL: env.apiBaseUrl,
      message: err?.message,
      status: err?.response?.status,
      data: err?.response?.data,
    })

    return null
  }
}

export const initCsrf = async () => {
  return fetchCsrfToken({ force: true })
}

// =====================================================
// Request interceptor
// =====================================================

api.interceptors.request.use(
  config => {
    config.headers = config.headers || {}

    if (!config.baseURL) {
      config.baseURL = API_BASE_URL
    }

    if (env.enableTenantDomainResolution) {
      const tenantDomain = getTenantDomain()

      if (tenantDomain) {
        config.headers[env.tenantHeader || 'x-tenant-domain'] = tenantDomain
      }
    }

    const token = getAuthToken()

    if (token && !config.url?.includes('/refresh')) {
      config.headers.Authorization = `Bearer ${token}`
    }

    if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
      console.log('[ADMIN API REQUEST]', {
        method: config.method,
        baseURL: config.baseURL,
        url: config.url,
        fullURL: `${config.baseURL || ''}${config.url || ''}`,
        tenant: config.headers[env.tenantHeader || 'x-tenant-domain'],
      })
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

    console.error('[ADMIN API ERROR]', {
      status: error?.response?.status,
      baseURL: originalRequest?.baseURL,
      url: originalRequest?.url,
      fullURL: `${originalRequest?.baseURL || ''}${originalRequest?.url || ''}`,
      data: error?.response?.data,
      message: error?.message,
    })

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

      const newCsrf = await fetchCsrfToken({ force: true })

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
            .post(
              '/user/refresh',
              {},
              {
                withCredentials: true,
                skipAuthRefresh: true,
                skipCsrfRetry: true,
              },
            )
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