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
    user: raw?.user || raw?.data?.user || raw?.data?.profile || raw?.profile || null,

    token: raw?.token || raw?.accessToken || raw?.data?.token || raw?.data?.accessToken || null,

    refreshToken: raw?.refreshToken || raw?.data?.refreshToken || null,
  }
}

// ======================================================
// Manejo uniforme de errores
// ======================================================

const getApiErrorMessage = (error, fallback = 'Error inesperado') => {
  if (typeof error === 'string') return error

  return (
    error?.response?.data?.message || error?.response?.data?.error || error?.message || fallback
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

    const csrfToken = shouldUseCsrf ? await ensureCsrf() : null

    // Sin Authorization manual: el access token vive en una cookie httpOnly
    // desde el backend (fase 1 del refactor de JWT) — withCredentials:true
    // ya la manda sola, y JS no puede (ni debe poder) leerla.
    const config = {
      method,
      url: `/user${endpoint}`,
      withCredentials: true,
      ...options,
      headers: {
        Accept: 'application/json',
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
      throw new Error(response?.data?.message || 'Respuesta inválida del servidor durante login')
    }

    // El token viaja también en el body además de la cookie httpOnly, y
    // authSlice lo guarda en sessionStorage para que axiosConfig lo mande
    // como Bearer cuando la cookie no está disponible. Acá se extraía con
    // normalizeAuthResponse y se descartaba, así que ese fallback nunca se
    // llenaba en el login: si la cookie no llegaba, toda request posterior
    // daba 401 "Token de acceso ausente" y el refresh que dispara el
    // interceptor moría con 403 por no tener sesión.
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
// FORGOT / RESET PASSWORD
// ======================================================

const forgotPassword = async email => {
  // /user/forgot-password está exento de CSRF (app.js) — quien pidió
  // recuperar su contraseña no tiene sesión, así que no puede tener un
  // token CSRF válido todavía.
  const response = await apiRequest(
    'post',
    '/forgot-password',
    { email },
    { withCredentials: true, skipCsrf: true },
  )

  return response
}

const resetPassword = async ({ token, password }) => {
  // Mismo motivo que forgotPassword: exento de CSRF.
  const response = await apiRequest(
    'put',
    '/reset-password',
    { token, password },
    { withCredentials: true, skipCsrf: true },
  )

  return response
}

// ======================================================
// CURRENT USER
// ======================================================

const getCurrentUser = async () => {
  // silentAuthCheck: esto se llama en el bootstrap de useAuth.js, en TODAS
  // las páginas incluida /login, para cualquier visitante tenga o no
  // sesión. Si no hay sesión, /me responde 401 y el interceptor intenta
  // refrescar — eso está bien (restaura la sesión sola si el refresh
  // token sigue vivo). Lo que no puede pasar es que, si el refresh
  // TAMBIÉN falla, el interceptor haga el redirect duro a /login que ya
  // hace para requests normales: en /login eso recarga la página, lo que
  // vuelve a montar useAuth(), que vuelve a llamar acá — bucle infinito.
  // Ver axiosConfig.js, el catch del bloque de refresh.
  const response = await apiRequest('get', '/me', undefined, {
    skipCsrf: false,
    silentAuthCheck: true,
  })

  const normalized = normalizeAuthResponse(response)

  if (!normalized?.user) {
    throw new Error('No se pudo recuperar el perfil del usuario')
  }

  return {
    success: true,
    data: {
      user: normalized.user,
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

    Cookies.remove('X-CSRF-Token', { path: '/' })
    Cookies.remove('XSRF-TOKEN', { path: '/' })
    Cookies.remove('_csrf', { path: '/' })

    clearCachedCsrf()

    throwApiError(error, 'Error al cerrar sesión')
  }
}

// ======================================================
// Export
// ======================================================

const authService = {
  loginUser,
  logoutUser,
  registerAdmin,
  getCurrentUser,
  forgotPassword,
  resetPassword,
}

export default authService
