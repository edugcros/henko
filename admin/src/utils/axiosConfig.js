// 📁 admin/src/utils/axiosConfig.js
import axios from 'axios'
import { env } from '../config/env.js'

let _store = null
const METRIC_SESSION_KEY = 'henko_metric_session_id'

export const setApiStore = store => {
  _store = store
}

export const getApiStore = () => _store

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
// Tenant domain
// =====================================================

const getTenantDomain = () => {
  if (typeof window === 'undefined') return null
  return window.location.host
}

const getMetricSessionId = () => {
  if (typeof window === 'undefined') return null

  let sessionId = localStorage.getItem(METRIC_SESSION_KEY)

  if (!sessionId) {
    sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(METRIC_SESSION_KEY, sessionId)
  }

  return sessionId
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

if (env.adminBaseDomain && API_BASE_URL.includes(env.adminBaseDomain)) {
  throw new Error(
    `API_BASE_URL apunta al admin, no al backend: ${API_BASE_URL}`,
  )
}

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
})

// Debug temporal de producción
if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
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
  if (csrfTokenPromise && !force) {
    return csrfTokenPromise
  }

  csrfTokenPromise = (async () => {
    try {
      const response = await api.get('/user/csrf-token', {
        withCredentials: true,

        // Este endpoint no requiere access token.
        skipAuthRefresh: true,

        // No intentar obtener CSRF nuevamente si este endpoint
        // devuelve un error relacionado con CSRF.
        skipCsrfRetry: true,

        // No necesitamos métricas para el bootstrap del CSRF.
        skipMetricSession: true,
      })

      const token =
        response.data?.csrfToken ||
        response.data?.token ||
        response.headers?.['x-csrf-token'] ||
        null

      if (!token) {
        console.error('[CSRF] Backend respondió sin token', {
          status: response.status,
          hasData: Boolean(response.data),
        })

        clearCsrfToken()

        return null
      }

      api.defaults.headers.common['x-csrf-token'] = token

      return token
    } catch (error) {
      console.error('[CSRF] Error obteniendo token', {
        baseURL: env.apiBaseUrl,
        url: '/user/csrf-token',
        status: error?.response?.status ?? null,
        message:
          error?.response?.data?.message || error?.message || 'Unknown error',
      })

      clearCsrfToken()

      return null
    } finally {
      csrfTokenPromise = null
    }
  })()

  return csrfTokenPromise
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

    // El rewrite de proxy en vercel.json (/api/:path* → backend) no matchea
    // una URL cuyo path termina en "/" (ej. "/product/?tenantId=...") — cae
    // al catch-all del SPA y Vercel devuelve (y cachea) el index.html en vez
    // de la respuesta real. Pasa con endpoints tipo "listar todo" que arman
    // la URL como `${recurso}${endpoint}` con endpoint:'/'. Sacar la barra
    // final acá, en el único lugar por el que pasa toda request, evita tener
    // que tocar cada service que arma la URL así.
    if (
      typeof config.url === 'string' &&
      config.url.length > 1 &&
      config.url.endsWith('/')
    ) {
      config.url = config.url.slice(0, -1)
    }

    if (env.enableTenantDomainResolution) {
      const tenantDomain = getTenantDomain()

      if (tenantDomain) {
        config.headers[env.tenantHeader || 'x-tenant-domain'] = tenantDomain
      }
    }

    const metricSessionId = config.skipMetricSession
      ? null
      : getMetricSessionId()
    if (metricSessionId) {
      config.headers['x-metric-session-id'] = metricSessionId
    }

    // El access token viaja en la cookie httpOnly, que withCredentials:true ya
    // manda. Acá se leía además de sessionStorage y se mandaba como Bearer.
    //
    // El comentario que justificaba ese respaldo decía "si las cookies no están
    // disponibles (cross-origin, different domain)". No es el caso: el
    // vercel.json del panel reescribe /api/* al backend, así que el navegador ve
    // todas las llamadas contra su propio origen. Comprobado contra producción:
    // la respuesta de /api/user/csrf-token trae Set-Cookie con
    // `HttpOnly; Secure; SameSite=None` y sin Domain, o sea que la cookie queda
    // en el host del panel y se manda sola.
    //
    // Mientras el respaldo existió, el token estaba en sessionStorage y llegaba
    // primero —getAccessTokenFromRequest mira Bearer antes que la cookie—, así
    // que la cookie httpOnly no protegía nada: bastaba un XSS para leer el JWT
    // y usarlo hasta que venciera.
    //
    // Si alguien pone Authorization explícitamente en una request, se respeta.

    if (env.debugApi || process.env.REACT_APP_DEBUG_API === 'true') {
      console.log('[ADMIN API REQUEST]', {
        method: config.method,
        baseURL: config.baseURL,
        url: config.url,
        fullURL: `${config.baseURL || ''}${config.url || ''}`,
        tenant: config.headers[env.tenantHeader || 'x-tenant-domain'],
        hasAuth: Boolean(
          config.headers.Authorization || config.headers.authorization,
        ),
      })
    }
    const isFormData =
      typeof FormData !== 'undefined' && config.data instanceof FormData

    if (isFormData || config.isMultipart) {
      delete config.headers['Content-Type']
      delete config.headers['content-type']
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
      hasData: Boolean(error?.response?.data),
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
      (code === 'EBADCSRFTOKEN' || message.toLowerCase().includes('csrf'))

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
            // El refresh renueva la cookie httpOnly del access token en su
            // propia respuesta. El token que viene en el cuerpo no se guarda:
            // guardarlo era lo que devolvía el JWT al alcance de cualquier
            // script, request tras request, anulando la cookie.
            .finally(() => {
              refreshTokenPromise = null
            })
        }

        await refreshTokenPromise

        // Hay que soltar el Authorization viejo antes de reintentar.
        //
        // Este bloque asumía auth solo por cookie: el refresh rota la cookie
        // httpOnly server-side y reintentar alcanzaba. Después se agregó el
        // fallback por header Bearer (ver el interceptor de request), y eso
        // rompió el supuesto sin que nadie lo notara.
        //
        // originalRequest ya viene con el header puesto por el primer intento,
        // con el token que acaba de expirar. El interceptor de request no lo
        // reemplaza porque solo lo completa `if (!config.headers.Authorization)`.
        // Y el backend lee Bearer ANTES que la cookie
        // (utils/authRequest.js::getAccessTokenFromRequest), así que el
        // reintento mandaba el mismo token vencido y volvía a dar 401 —
        // teniendo al lado una cookie nueva y válida que quedaba tapada. Con
        // _retry ya marcado, no había tercer intento: 401 definitivo.
        //
        // Borrarlo deja que el interceptor lo complete con el token fresco que
        // el refresh guardó, y si no hay ninguno la request viaja solo con la
        // cookie, que es el camino que ya funcionaba.
        if (originalRequest.headers) {
          delete originalRequest.headers.Authorization
          delete originalRequest.headers.authorization
        }

        return api(originalRequest)
      } catch (refreshError) {
        // silentAuthCheck (useAuth.js::bootstrap, vía getCurrentUser): esta
        // request corre en TODAS las páginas, incluida /login, para
        // cualquier visitante tenga o no sesión. Redirigir acá cuando
        // falla el refresh recargaría /login — remonta App.js, que vuelve
        // a disparar el mismo chequeo, que vuelve a fallar: bucle
        // infinito. getMe.rejected (authSlice.js) ya deja
        // isAuthenticated:false sin necesidad de este redirect.
        if (typeof window !== 'undefined' && !originalRequest.silentAuthCheck) {
          window.location.href = '/login'
        }

        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export default api
