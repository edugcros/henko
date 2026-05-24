// 📁 website/src/utils/axiosConfig.js
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
      'api.henko.com', // prohibido mientras todavía no uses .com real
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
// Helpers
// =====================================================

const getTenantDomain = () => {
  if (typeof window === 'undefined') return null
  return window.location.host
}

const tenantDomain = getTenantDomain()

if (tenantDomain) {
  config.headers[env.tenantHeader || 'x-tenant-domain'] = tenantDomain
}

const isValidToken = token => {
  return (
    token &&
    token !== 'null' &&
    token !== 'undefined' &&
    String(token).trim() !== ''
  )
}

const getAuthToken = () => {
  const cookieToken = Cookies.get('token')
  const localToken = localStorage.getItem('token')

  if (isValidToken(cookieToken)) return cookieToken
  if (isValidToken(localToken)) return localToken

  return null
}

const isSafeMethod = method => {
  return ['get', 'head', 'options'].includes(String(method || 'get').toLowerCase())
}

const shouldAttachCsrf = config => {
  if (config.skipCsrf === true) return false
  return !isSafeMethod(config.method)
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

if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
  // eslint-disable-next-line no-console
  console.log('[WEBSITE API BOOT]', {
    apiBaseUrl: env.apiBaseUrl,
    nodeEnv: env.nodeEnv,
    publicBaseDomain: env.publicBaseDomain,
    tenantHeader: env.tenantHeader,
    csrfHeaderName: env.csrfHeaderName,
  })
}

// =====================================================
// CSRF
// =====================================================

let cachedCsrfToken = null
let csrfTokenPromise = null
let refreshTokenPromise = null

export const clearCsrfToken = () => {
  cachedCsrfToken = null
  csrfTokenPromise = null
  delete api.defaults.headers.common[env.csrfHeaderName || 'x-csrf-token']
  delete api.defaults.headers.common['x-csrf-token']
  delete api.defaults.headers.common['X-CSRF-Token']
}

export const fetchCsrfToken = async ({ force = false } = {}) => {
  try {
    if (cachedCsrfToken && !force) {
      return cachedCsrfToken
    }

    if (csrfTokenPromise && !force) {
      return csrfTokenPromise
    }

    csrfTokenPromise = api
      .get('/user/csrf-token', {
        withCredentials: true,
        skipAuthRefresh: true,
        skipCsrfRetry: true,
        skipCsrf: true,
      })
      .then(res => {
        const token =
          res.data?.csrfToken ||
          res.data?.token ||
          res.headers?.['x-csrf-token'] ||
          res.headers?.['X-CSRF-Token'] ||
          null

        cachedCsrfToken = token || null

        if (token) {
          api.defaults.headers.common[env.csrfHeaderName || 'x-csrf-token'] = token
        }

        return cachedCsrfToken
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

    clearCsrfToken()
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
  async config => {
    config.headers = config.headers || {}
    config.withCredentials = true

    if (!config.baseURL) {
      config.baseURL = env.apiBaseUrl
    }

    if (config.publicRequest) {
      delete config.headers.Authorization
      delete config.headers.authorization
      delete config.headers['x-csrf-token']
      delete config.headers['X-CSRF-Token']
      delete config.headers['x-tenant-domain']
      delete config.headers['X-Tenant-Domain']

      config.withCredentials = false
      return config
    }

    if (env.enableTenantDomainResolution && !config.skipTenantHeader) {
      const tenantDomain = getTenantDomain()

      if (tenantDomain) {
        config.headers[env.tenantHeader || 'x-tenant-domain'] = tenantDomain
      }
    }

    if (config.skipTenantHeader) {
      delete config.headers['x-tenant-domain']
      delete config.headers['X-Tenant-Domain']
      delete config.headers[env.tenantHeader || 'x-tenant-domain']
    }

    const token = getAuthToken()

    if (isValidToken(token) && !config.url?.includes('/refresh')) {
      config.headers.Authorization = `Bearer ${token}`
    } else {
      delete config.headers.Authorization
      delete config.headers.authorization
    }

    if (shouldAttachCsrf(config)) {
      const headerName = env.csrfHeaderName || 'x-csrf-token'

      if (!config.headers[headerName]) {
        const csrfToken = await fetchCsrfToken()

        if (csrfToken) {
          config.headers[headerName] = csrfToken
        }
      }
    }

    if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
      console.log('[WEBSITE API REQUEST]', {
        method: config.method,
        baseURL: config.baseURL,
        url: config.url,
        fullURL: `${config.baseURL || ''}${config.url || ''}`,
        tenant: config.headers[env.tenantHeader || 'x-tenant-domain'],
        hasAuth: Boolean(config.headers.Authorization),
        hasCsrf: Boolean(config.headers[env.csrfHeaderName || 'x-csrf-token']),
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

    console.error('[WEBSITE API ERROR]', {
      status: error?.response?.status,
      baseURL: originalRequest?.baseURL,
      url: originalRequest?.url,
      fullURL: `${originalRequest?.baseURL || ''}${originalRequest?.url || ''}`,
      code: error?.response?.data?.code,
      data: error?.response?.data,
      message: error?.message,
    })

    if (!originalRequest) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const code = error.response?.data?.code
    const message = error.response?.data?.message || ''

    // =====================================================
    // CSRF retry
    // =====================================================

    console.log('[WEBSITE API REQUEST]', {
  host: window.location.host,
  tenantHeaderName: env.tenantHeader || 'x-tenant-domain',
  tenantHeaderValue: config.headers[env.tenantHeader || 'x-tenant-domain'],
  baseURL: config.baseURL,
  url: config.url,
  fullURL: `${config.baseURL || ''}${config.url || ''}`,
})
    const isCsrfError =
      status === 403 &&
      (
        code === 'EBADCSRFTOKEN' ||
        message.toLowerCase().includes('csrf')
      )

    if (isCsrfError && !originalRequest._csrfRetry && !originalRequest.skipCsrfRetry) {
      originalRequest._csrfRetry = true

      clearCsrfToken()

      const newCsrf = await fetchCsrfToken({ force: true })

      if (newCsrf) {
        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers[env.csrfHeaderName || 'x-csrf-token'] = newCsrf

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
      !originalRequest._authRetry &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._authRetry = true

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
        const token =
          res.data?.token ||
          res.data?.accessToken ||
          res.data?.data?.token ||
          res.data?.data?.accessToken ||
          null

        if (isValidToken(token)) {
          localStorage.setItem('token', token)
          api.defaults.headers.common.Authorization = `Bearer ${token}`

          originalRequest.headers = originalRequest.headers || {}
          originalRequest.headers.Authorization = `Bearer ${token}`
        }

        return api(originalRequest)
      } catch (refreshError) {
        localStorage.removeItem('token')
        Cookies.remove('token', { path: '/' })

        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export default api