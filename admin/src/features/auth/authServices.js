// 📁 src/features/user/userService.js
import Cookies from 'js-cookie'
import api, { fetchCsrfToken } from '@utils/axiosConfig'

// ======================================================
// Normalización estricta de respuestas AUTH
// ======================================================

const normalizeAuthResponse = response => {
  if (!response) return null

  const raw = response?.data || response

  return {
    user:
      raw?.user ||
      raw?.data?.user ||
      raw?.data?.profile ||
      raw?.profile ||
      null,

    token:
      raw?.token ||
      raw?.accessToken ||
      raw?.data?.token ||
      raw?.data?.accessToken ||
      null,

    refreshToken:
      raw?.refreshToken ||
      raw?.data?.refreshToken ||
      null,
  }
}

// ======================================================
// Manejo uniforme de errores
// ======================================================

const getApiErrorMessage = (error, fallback = 'Error inesperado') => {
  if (typeof error === 'string') return error

  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  )
}

const throwApiError = (error, fallback = 'Error inesperado') => {
  const message = getApiErrorMessage(error, fallback)
  const apiError = new Error(message)

  apiError.response = error?.response
  apiError.status = error?.response?.status
  apiError.data = error?.response?.data

  throw apiError
}

// ======================================================
// CSRF Loader
// ======================================================

let cachedCsrfToken = null
let csrfPromise = null

const ensureCsrf = async ({ force = false } = {}) => {
  if (cachedCsrfToken && !force) return cachedCsrfToken
  if (csrfPromise && !force) return csrfPromise

  csrfPromise = fetchCsrfToken()
    .then(token => {
      cachedCsrfToken = token || null
      return cachedCsrfToken
    })
    .finally(() => {
      csrfPromise = null
    })

  return csrfPromise
}

export const clearCachedCsrf = () => {
  cachedCsrfToken = null
}

// ======================================================
// Request genérico
// ======================================================

const apiRequest = async (method, endpoint, data = undefined, options = {}) => {
  try {
    const shouldUseCsrf =
      !['get', 'head', 'options'].includes(String(method).toLowerCase()) &&
      options.skipCsrf !== true

    const csrfToken = shouldUseCsrf
      ? await ensureCsrf()
      : null

    const isValidToken = token => {
      return (
        token &&
        token !== 'null' &&
        token !== 'undefined' &&
        String(token).trim() !== ''
      )
    }

    const rawToken =
      localStorage.getItem('token') ||
      Cookies.get('token') ||
      null

    const token = isValidToken(rawToken) ? rawToken : null

    const config = {
      method,
      url: `/user${endpoint}`,
      withCredentials: true,
      ...options,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...options.headers,
      },
    }

    if (data !== undefined) {
      config.data = data
    }

    const response = await api(config)
    const payload = response.data

    if (payload?.success === false) {
      const error = new Error(payload?.message || 'Error en la operación')
      error.response = response
      error.status = response.status
      error.data = payload
      throw error
    }

    return payload
  } catch (error) {
    /**
     * Importante:
     * No devolver { success:false } acá.
     * Hay que lanzar error para que createAsyncThunk entre por rejected.
     */
    throwApiError(error)
  }
}

// ======================================================
// REGISTER ADMIN / CREATE TENANT
// ======================================================

const registerAdmin = async payload => {
  const response = await apiRequest('post', '/register-admin', payload, {
    withCredentials: true,

    /**
     * Si en app.js eximiste /user/register-admin de CSRF,
     * podés dejar skipCsrf:true.
     *
     * Si decidís proteger register-admin con CSRF, cambiá a false.
     */
    skipCsrf: true,
  })

  if (!response?.success) {
    throw new Error(response?.message || 'Error al crear el comercio')
  }

  return response
}

// ======================================================
// LOGIN ADMIN
// ======================================================

const loginUser = async userData => {
  try {
    const response = await apiRequest('post', '/admin-login', userData, {
      withCredentials: true,
      skipCsrf: true,
      skipCsrfRetry: true,
    })

    const normalized = normalizeAuthResponse(response)

    if (!normalized?.user) {
      throw new Error(
        response?.data?.message ||
          'Respuesta inválida del servidor durante login',
      )
    }

    const { token } = normalized

    if (token) {
      localStorage.setItem('token', token)
    }

    return {
    success: true,
    data: {
      user: normalized?.user,
      token: normalized?.token,
    },
    }
  } catch (error) {
    throwApiError(error, 'Error al iniciar sesión')
  }
}
// ======================================================
// CURRENT USER
// ======================================================

const getCurrentUser = async () => {
  const response = await apiRequest('get', '/me', undefined, {
    skipCsrf: false,
  })

  const normalized = normalizeAuthResponse(response)

  if (!normalized?.user) {
    throw new Error('No se pudo recuperar el perfil del usuario')
  }

  return {
    success: true,
    data: {
      user: normalized.user,
      token: localStorage.getItem('token'),
    },
  }
}

// ======================================================
// LOGOUT
// ======================================================

const logoutUser = async () => {
  try {
    const response = await apiRequest('post', '/logout', undefined, {
      withCredentials: true,
    })

    sessionStorage.clear()
    localStorage.removeItem('token')

    Cookies.remove('token', { path: '/' })
    Cookies.remove('X-CSRF-Token', { path: '/' })
    Cookies.remove('XSRF-TOKEN', { path: '/' })
    Cookies.remove('_csrf', { path: '/' })

    clearCachedCsrf()

    return {
      success: true,
      message: response?.message || 'Sesión cerrada correctamente',
    }
  } catch (error) {
    sessionStorage.clear()
    localStorage.removeItem('token')

    Cookies.remove('token', { path: '/' })
    Cookies.remove('X-CSRF-Token', { path: '/' })
    Cookies.remove('XSRF-TOKEN', { path: '/' })
    Cookies.remove('_csrf', { path: '/' })

    clearCachedCsrf()

    throwApiError(error, 'Error al cerrar sesión')
  }
}

// ======================================================
// ORDERS
// ======================================================

const inflight = new Map()

const makeQueryKey = (params = {}) => JSON.stringify({
  page: params.page ?? 1,
  limit: params.limit ?? 20,
  status: params.status || null,
  q: params.q || null,
  from: params.from || null,
  to: params.to || null,
})

const getOrders = async (params = {}, { signal } = {}) => {
  const key = makeQueryKey(params)

  if (inflight.has(key)) {
    return inflight.get(key)
  }

  const request = api
    .get('/order/getAll', {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 20,
        status: params.status,
        q: params.q,
        from: params.from,
        to: params.to,
      },
      withCredentials: true,
      signal,
    })
    .then(response => {
      if (response.data?.success === false) {
        throw new Error(response.data?.message || 'Error al obtener órdenes')
      }

      return response.data
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, request)
  return request
}

const updateOrderStatus = async (id, status) => {
  try {
    const csrfToken = await ensureCsrf()

    const response = await api.put(
      `/order/${id}/status`,
      { status },
      {
        withCredentials: true,
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : {},
      },
    )

    if (response.data?.success === false) {
      throw new Error(response.data?.message || 'No se pudo actualizar el estado')
    }

    return response.data
  } catch (error) {
    throwApiError(error, 'Error al actualizar estado')
  }
}

// ======================================================
// TOKEN REFRESH
// ======================================================

const refreshToken = async () => {
  try {
    const response = await api.post(
      '/user/refresh',
      {},
      {
        withCredentials: true,
        skipAuthRefresh: true,
        skipCsrfRetry: true,
      },
    )

    if (response.data?.success === false) {
      throw new Error(response.data?.message || 'Refresh inválido')
    }

    const normalized = normalizeAuthResponse(response.data)
    const token =
      normalized?.token ||
      response.data?.token ||
      response.data?.accessToken

    if (!token) {
      throw new Error('Token ausente en refresh')
    }

    localStorage.setItem('token', token)

    const me = await api.get('/user/me', {
      withCredentials: true,
      skipAuthRefresh: true,
      skipCsrfRetry: true,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const user =
      me?.data?.data?.user ||
      me?.data?.data ||
      me?.data?.user ||
      null

    return {
      success: true,
      data: {
        user,
        token,
      },
    }
  } catch (error) {
    sessionStorage.removeItem('user')
    localStorage.removeItem('token')
    Cookies.remove('token', { path: '/' })

    return {
      success: false,
      message: getApiErrorMessage(
        error,
        'Sesión expirada. Inicie sesión nuevamente.',
      ),
    }
  }
}

// ======================================================
// Export
// ======================================================

const authService = {
  loginUser,
  getOrders,
  updateOrderStatus,
  logoutUser,
  registerAdmin,
  refreshToken,
  getCurrentUser,
}

export default authService
