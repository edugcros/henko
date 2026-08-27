// 📁 website/src/utils/axiosConfig.js
import axios from 'axios'
import Cookies from 'js-cookie'
import { env } from '../config/env.js'

let _store = null
const METRIC_SESSION_KEY = 'henko_metric_session_id'
// Misma clave que userMetricsService.js usa para persistir el primer touch
// de UTMs — no se puede importar esa función acá (userMetricsService.js
// importa este archivo, no al revés), así que esta es una copia local
// minimalista que lee/escribe la misma clave, para que ambas queden
// sincronizadas en el mismo valor aunque el código esté duplicado.
const ATTRIBUTION_KEY = 'henko_metric_attribution'
const ATTRIBUTION_TTL_MS = 24 * 60 * 60 * 1000

export const setApiStore = store => {
  _store = store
}

const clearClientAuthState = () => {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem('user')
    window.sessionStorage.removeItem('wishlist')
    window.sessionStorage.removeItem('csrfToken')
  }

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
    const url = String(env.apiBaseUrl)
    if (/localhost|127\.0\.0\.1|\.local(:|\/|$)/i.test(url)) {
      throw new Error(
        `REACT_APP_API_BASE_URL inválido para producción: ${env.apiBaseUrl}`,
      )
    }
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

const getAttributionForHeader = () => {
  if (typeof window === 'undefined') return null

  try {
    const params = new window.URLSearchParams(window.location.search)
    const current = {
      utmSource: params.get('utm_source') || '',
      utmMedium: params.get('utm_medium') || '',
      utmCampaign: params.get('utm_campaign') || '',
      utmContent: params.get('utm_content') || '',
      utmTerm: params.get('utm_term') || '',
    }

    if (Object.values(current).some(Boolean)) {
      window.localStorage.setItem(
        ATTRIBUTION_KEY,
        JSON.stringify({
          value: current,
          expiresAt: Date.now() + ATTRIBUTION_TTL_MS,
        }),
      )
      return current
    }

    const stored = JSON.parse(
      window.localStorage.getItem(ATTRIBUTION_KEY) || 'null',
    )
    if (!stored || Date.now() > Number(stored.expiresAt || 0)) return null

    return stored.value || null
  } catch {
    return null
  }
}

const isSafeMethod = method => {
  return ['get', 'head', 'options'].includes(
    String(method || 'get').toLowerCase(),
  )
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

      // El backend responde 200 con csrfToken:null cuando CSRF_ENABLED=false
      // a nivel servidor — es un estado válido, no una falla (mismo caso ya
      // resuelto en cartService.js, este archivo tiene su propia copia del
      // fetch). Tratarlo como error acá tiraba "Fallo crítico" en cada
      // carga de la app aunque no hubiera nada roto.
      if (!token && res.data?.csrfEnabled === false) {
        cachedCsrfToken = null
        return null
      }

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

    // El rewrite de proxy en vercel.json (/api/:path* → backend) no matchea
    // una URL cuyo path termina en "/" (ej. "/product/?tenantId=...") — cae
    // al catch-all del SPA y Vercel devuelve (y cachea) el index.html en vez
    // de la respuesta real. Pasa con endpoints tipo "listar todo" que arman
    // la URL como `${recurso}${endpoint}` con endpoint:'/'. Sacar la barra
    // final acá, en el único lugar por el que pasa toda request, evita tener
    // que tocar cada service que arma la URL así.
    if (
      typeof requestConfig.url === 'string' &&
      requestConfig.url.length > 1 &&
      requestConfig.url.endsWith('/')
    ) {
      requestConfig.url = requestConfig.url.slice(0, -1)
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

    const metricSessionId = requestConfig.skipMetricSession
      ? null
      : getMetricSessionId()
    if (metricSessionId) {
      requestConfig.headers['x-metric-session-id'] = metricSessionId
    }

    const attribution = requestConfig.skipMetricSession
      ? null
      : getAttributionForHeader()
    if (attribution && Object.values(attribution).some(Boolean)) {
      requestConfig.headers['x-metric-attribution'] =
        JSON.stringify(attribution)
    }

    const fbc = Cookies.get('_fbc')
    const fbp = Cookies.get('_fbp')
    if (fbc) requestConfig.headers['x-fbc'] = fbc
    if (fbp) requestConfig.headers['x-fbp'] = fbp

    if (requestConfig.skipTenantHeader) {
      removeTenantHeaders(requestConfig.headers)
    }

    // Sin Authorization manual: el access token vive en una cookie httpOnly
    // desde el backend (fase 1 del refactor de JWT) — withCredentials:true
    // ya la manda sola.

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
      status === 403 &&
      (code === 'EBADCSRFTOKEN' || message.toLowerCase().includes('csrf'))

    if (
      isCsrfError &&
      !originalRequest._csrfRetry &&
      !originalRequest.skipCsrfRetry
    ) {
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

        // El refresh ya rotó y re-seteó la cookie httpOnly del access
        // token server-side — reintentar la request original alcanza, va
        // a viajar con la cookie nueva sola (withCredentials:true).
        await refreshTokenPromise

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
