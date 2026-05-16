// 📁 website/src/utils/axiosConfig.js
import axios from 'axios'
import Cookies from 'js-cookie'
import { env } from '../config/env.js'

let _store = null
export const setApiStore = store => {
  _store = store
}

const getTenantDomain = () => {
  if (typeof window === 'undefined') return null
  return window.location.host
}

const getAuthToken = () => {
  return Cookies.get('token') || localStorage.getItem('token') || null
}

const api = axios.create({
  baseURL: env.apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

let csrfTokenPromise = null
let refreshTokenPromise = null

export const fetchCsrfToken = async () => {
  try {
    const res = await api.get('/user/csrf-token')
    const token = res.data?.csrfToken
    if (token) {
      api.defaults.headers.common['x-csrf-token'] = token
      return token
    }
  } catch (err) {
    console.error('[CSRF] Fallo crítico:', err.message)
    return null
  }
}

export const initCsrf = async () => {
  const token = await fetchCsrfToken()

  if (token) {
    api.defaults.headers.common[env.csrfHeaderName] = token
  }

  return token
}

api.interceptors.request.use(
  config => {
    config.headers = config.headers || {}

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

    if (config.skipTenantHeader) {
      delete config.headers['x-tenant-domain']
      delete config.headers['X-Tenant-Domain']
    }

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

api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config

    if (!originalRequest || originalRequest._retry) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const code = error.response?.data?.code
    const message = error.response?.data?.message || ''

    const isCsrfError =
      status === 403 && (code === 'EBADCSRFTOKEN' || message.toLowerCase().includes('csrf'))

    if (isCsrfError && !originalRequest.skipCsrfRetry) {
      originalRequest._retry = true

      const newCsrf = await fetchCsrfToken()

      if (newCsrf) {
        originalRequest.headers = originalRequest.headers || {}
        originalRequest.headers[env.csrfHeaderName] = newCsrf

        return api(originalRequest)
      }
    }

    const isAuthError = status === 401
    const isLoginRequest = originalRequest.url?.includes('/login')
    const isRefreshRequest = originalRequest.url?.includes('/refresh')

    if (isAuthError && !isLoginRequest && !isRefreshRequest && !originalRequest.skipAuthRefresh) {
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

        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export default api
