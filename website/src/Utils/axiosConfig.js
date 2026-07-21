// 📁 website/src/utils/axiosConfig.js
import axios from 'axios'
import Cookies from 'js-cookie'
import { env } from '../config/env.js'

let _store = null
const METRIC_SESSION_KEY = 'henko_metric_session_id'

export const setApiStore = store => {
  _store = store
}

const clearClientAuthState = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('token')
    window.sessionStorage.removeItem('user')
    window.sessionStorage.removeItem('wishlist')
    window.sessionStorage.removeItem('csrfToken')
  }

  Cookies.remove('token', { path: '/' })
  delete api.defaults.headers.common.Authorization
  delete api.defaults.headers.common.authorization

  if (_store?.dispatch) {
    _store.dispatch({ type: 'user/resetAuthState' })
  }
}

// =====================================================
// Runtime guards
// =====================================================

const assertApiBaseUrl = () => {
  if (!env.apiBaseUrl) {
    throw new Error('REACT_APP_API_BASE_URL no está configurado')
  }

  if (env.isProduction) {
    const forbiddenValues = ['localhost', '127.0.0.1', 'henko.local']

    forbiddenValues.forEach(value => {
      if (String(env.apiBaseUrl).includes(value)) {
        throw new Error(`REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`)
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

  // Mejor para multi-tenant: evita mandar puerto en producción/dev.
  return window.location.hostname
}

const isValidToken = token => {
  return token && token !== 'null' && token !== 'undefined' && String(token).trim() !== ''
}

const getAuthToken = () => {
  const cookieToken = Cookies.get('token')
  const localToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null

  if (isValidToken(cookieToken)) return cookieToken
  if (isValidToken(localToken)) return localToken

  return null
}

const createMetricSessionId = () => {
  if (
    typeof window !== 'undefined' &&
    window.crypto &&
    typeof window.crypto.randomUUID === 'function'
  ) {
    return window.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const getMetricSessionId = () => {
  if (typeof window === 'undefined') return null

  try {
    let sessionId = window.localStorage.getItem(METRIC_SESSION_KEY)

    if (!sessionId) {
      sessionId = createMetricSessionId()
      window.localStorage.setItem(METRIC_SESSION_KEY, sessionId)
    }

    return sessionId
  } catch {
    return createMetricSessionId()
  }
}

const isSafeMethod = method => {
  return ['get', 'head', 'options'].includes(String(method || 'get').toLowerCase())
}

const shouldAttachCsrf = requestConfig => {
  if (requestConfig.skipCsrf === true) return false
  if (requestConfig.publicRequest === true) return false

  return !isSafeMethod(requestConfig.method)
}

const getCsrfHeaderName = () => {
  return env.csrfHeaderName || 'x-csrf-token'
}

const getTenantHeaderName = () => {
  return env.tenantHeader || 'x-tenant-domain'
}

const removeCsrfHeaders = headers => {
  delete headers[getCsrfHeaderName()]
  delete headers['x-csrf-token']
  delete headers['X-CSRF-Token']
}

const removeTenantHeaders = headers => {
  delete headers[getTenantHeaderName()]
  delete headers['x-tenant-domain']
  delete headers['X-Tenant-Domain']
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
  /*console.log('[WEBSITE API BOOT]', {
    apiBaseUrl: env.apiBaseUrl,
    nodeEnv: env.nodeEnv,
    publicBaseDomain: env.publicBaseDomain,
    tenantHeader: env.tenantHeader,
    csrfHeaderName: env.csrfHeaderName,
  })*/
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

  removeCsrfHeaders(api.defaults.headers.common)
}

export const fetchCsrfToken = async ({ force = false } = {}) => {
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
      skipMetricSession: true,
    })
    .then(res => {
      const token =
        res.data?.csrfToken ||
        res.data?.token ||
        res.headers?.['x-csrf-token'] ||
        res.headers?.['X-CSRF-Token'] ||
        null

      if (!token) {
        throw new Error('CSRF token no recibido desde backend')
      }

      cachedCsrfToken = token
      api.defaults.headers.common[getCsrfHeaderName()] = token

      return token
    })
    .catch(err => {
      console.error('[CSRF] Fallo crítico:', {
        baseURL: env.apiBaseUrl,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      })

      clearCsrfToken()
      return null
    })
    .finally(() => {
      csrfTokenPromise = null
    })

  return csrfTokenPromise
}

export const initCsrf = async () => {
  return fetchCsrfToken({ force: true })
}

// =====================================================
// Request interceptor
// =====================================================

api.interceptors.request.use(
  async requestConfig => {
    requestConfig.headers = requestConfig.headers || {}
    requestConfig.withCredentials = true

    if (!requestConfig.baseURL) {
      requestConfig.baseURL = env.apiBaseUrl
    }

    if (requestConfig.publicRequest) {
      delete requestConfig.headers.Authorization
      delete requestConfig.headers.authorization
      removeCsrfHeaders(requestConfig.headers)
      removeTenantHeaders(requestConfig.headers)

      requestConfig.withCredentials = false
      return requestConfig
    }

    if (env.enableTenantDomainResolution && !requestConfig.skipTenantHeader) {
      const tenantDomain = getTenantDomain()

      if (tenantDomain) {
        requestConfig.headers[getTenantHeaderName()] = tenantDomain
      }
    }

    const metricSessionId = requestConfig.skipMetricSession ? null : getMetricSessionId()
    if (metricSessionId) {
      requestConfig.headers['x-metric-session-id'] = metricSessionId
    }

    if (requestConfig.skipTenantHeader) {
      removeTenantHeaders(requestConfig.headers)
    }

    const token = getAuthToken()

    if (isValidToken(token) && !requestConfig.url?.includes('/refresh')) {
      requestConfig.headers.Authorization = `Bearer ${token}`
    } else {
      delete requestConfig.headers.Authorization
      delete requestConfig.headers.authorization
    }

    if (shouldAttachCsrf(requestConfig)) {
      const headerName = getCsrfHeaderName()

      if (!requestConfig.headers[headerName]) {
        const csrfToken = await fetchCsrfToken()

        if (csrfToken) {
          requestConfig.headers[headerName] = csrfToken
        }
      }
    }

    if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
      /*console.log('[WEBSITE API REQUEST]', {
        method: requestConfig.method,
        baseURL: requestConfig.baseURL,
        url: requestConfig.url,
        fullURL: `${requestConfig.baseURL || ''}${requestConfig.url || ''}`,
        tenant: requestConfig.headers[getTenantHeaderName()],
        hasAuth: Boolean(requestConfig.headers.Authorization),
        hasCsrf: Boolean(requestConfig.headers[getCsrfHeaderName()]),
      })*/
    }

    return requestConfig
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

    if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
      /*console.log('[WEBSITE API RESPONSE ERROR DEBUG]', {
        host: typeof window !== 'undefined' ? window.location.host : null,
        tenantHeaderName: getTenantHeaderName(),
        tenantHeaderValue:
          originalRequest.headers?.[getTenantHeaderName()] ||
          originalRequest.headers?.['x-tenant-domain'] ||
          originalRequest.headers?.['X-Tenant-Domain'],
        baseURL: originalRequest.baseURL,
        url: originalRequest.url,
        fullURL: `${originalRequest.baseURL || ''}${originalRequest.url || ''}`,
        status,
        code,
      })*/
    }

    // =====================================================
    // CSRF retry
    // =====================================================

    const isCsrfError =
      status === 403 && (code === 'EBADCSRFTOKEN' || message.toLowerCase().includes('csrf'))

    if (isCsrfError && !originalRequest._csrfRetry && !originalRequest.skipCsrfRetry) {
      originalRequest._csrfRetry = true

      clearCsrfToken()

      const newCsrf = await fetchCsrfToken({ force: true })

      if (newCsrf) {
        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers[getCsrfHeaderName()] = newCsrf

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
          const csrf = await fetchCsrfToken()

          refreshTokenPromise = api
            .post(
              '/user/refresh',
              {},
              {
                withCredentials: true,
                skipAuthRefresh: true,
                skipCsrfRetry: true,
                headers: csrf ? { [getCsrfHeaderName()]: csrf } : {},
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
        clearClientAuthState()

        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export default api
