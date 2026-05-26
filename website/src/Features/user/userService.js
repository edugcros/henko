// 📁 src/features/user/userService.js
import Cookies from 'js-cookie'
import api, { fetchCsrfToken } from '@utils/axiosConfig'
import { env } from '../../config/env.js'

// ======================================================
// HELPERS
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

const extractApiError = (error, fallback = 'Error inesperado') => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback
  )
}

const normalizeBooleanSuccess = response => {
  if (!response) {
    return {
      success: false,
      message: 'Respuesta vacía del servidor',
    }
  }

  if (response.success === false) return response

  return {
    success: true,
    ...response,
  }
}

const sanitizeText = value => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

// ======================================================
// CSRF
// ======================================================

let cachedCsrfToken = null

const ensureCsrf = async () => {
  if (cachedCsrfToken) return cachedCsrfToken

  cachedCsrfToken = await fetchCsrfToken()
  return cachedCsrfToken
}

const resetCsrf = () => {
  cachedCsrfToken = null
}

// ======================================================
// API REQUEST
// ======================================================

const apiRequest = async (method, endpoint, data = undefined, options = {}) => {
  const normalizedMethod = String(method || 'get').toLowerCase()
  const isReadOnly = ['get', 'head', 'options'].includes(normalizedMethod)

  try {
    const shouldUseCsrf =
      !isReadOnly &&
      options.skipCsrf !== true

    const csrfToken = shouldUseCsrf ? await ensureCsrf() : null

    const config = {
      method: normalizedMethod,
      url: `/user${endpoint}`,
      data,
      withCredentials: true,
      ...options,
      headers: {
        Accept: 'application/json',
        ...(data instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(csrfToken
          ? { [env.csrfHeaderName || 'x-csrf-token']: csrfToken }
          : {}),
        ...(options.headers || {}),
      },
    }

    delete config.skipCsrf

    const response = await api(config)

    return normalizeBooleanSuccess(response.data)
  } catch (error) {
    const status = error?.response?.status
    const message = extractApiError(error, 'Error en la petición')

    if (status === 403 && /csrf|token/i.test(message) && options.skipCsrf !== true) {
      try {
        resetCsrf()

        const retryCsrfToken = isReadOnly ? null : await ensureCsrf()

        const retryConfig = {
          method: normalizedMethod,
          url: `/user${endpoint}`,
          data,
          withCredentials: true,
          ...options,
          headers: {
            Accept: 'application/json',
            ...(data instanceof FormData
              ? {}
              : { 'Content-Type': 'application/json' }),
            ...(retryCsrfToken
              ? { [env.csrfHeaderName || 'x-csrf-token']: retryCsrfToken }
              : {}),
            ...(options.headers || {}),
          },
        }

        delete retryConfig.skipCsrf

        const retryResponse = await api(retryConfig)

        return normalizeBooleanSuccess(retryResponse.data)
      } catch (retryError) {
        const retryMessage = extractApiError(retryError, message)

        console.error('User API Error Retry:', retryMessage)

        return {
          success: false,
          message: retryMessage,
          status: retryError?.response?.status,
          data: retryError?.response?.data || null,
        }
      }
    }

    console.error('User API Error:', message)

    return {
      success: false,
      message,
      status,
      data: error?.response?.data || null,
      errors: error?.response?.data?.errors || [],
    }
  }
}
// ======================================================
// AUTH
// ======================================================

const register = async userData => {
  const response = await apiRequest('post', '/register', userData, {
    skipCsrf: true,
  })

  if (response.success === false) return response

  const normalized = normalizeAuthResponse(response)

  if (normalized?.token) {
    localStorage.setItem('token', normalized.token)
  }

  return {
    success: true,
    data: {
      user: normalized?.user,
      token: normalized?.token,
    },
  }
}

const loginUser = async userData => {
  const response = await apiRequest('post', '/login', userData, {
    skipCsrf: true,
  })

  if (response.success === false) return response

  const normalized = normalizeAuthResponse(response)

  if (normalized?.token) {
    localStorage.setItem('token', normalized.token)
  }

  return {
    success: true,
    data: {
      user: normalized?.user,
      token: normalized?.token,
    },
  }
}

const loginAdmin = async values => {
  const response = await apiRequest('post', '/admin-login', values)

  if (response.success === false) return response

  const normalized = normalizeAuthResponse(response)

  if (normalized?.token) {
    localStorage.setItem('token', normalized.token)

    Cookies.set('token', normalized.token, {
      expires: 1,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    })
  }

  return {
    success: true,
    data: {
      user: normalized?.user,
      token: normalized?.token,
    },
  }
}

const logoutUser = async () => {
  const response = await apiRequest('post', '/logout')

  localStorage.removeItem('token')
  sessionStorage.removeItem('user')

  Cookies.remove('token', { path: '/' })
  Cookies.remove('XSRF-TOKEN', { path: '/' })
  Cookies.remove('X-CSRF-Token', { path: '/' })

  resetCsrf()

  return response
}

// ======================================================
// PROFILE
// ======================================================

const getCurrentUser = async () => {
  const response = await apiRequest('get', '/me', undefined, {
    skipAuthRefresh: false,
  })

  if (response.success === false) return response

  const normalized = normalizeAuthResponse(response)

  if (!normalized?.user) {
    return {
      success: false,
      message: 'No se pudo recuperar el perfil del usuario',
    }
  }

  return {
    success: true,
    data: {
      user: normalized.user,
      token: normalized.token || localStorage.getItem('token'),
    },
  }
}

const updateUser = userData => {
  return apiRequest('put', '/edit-user', userData)
}

const updateUserAddress = address => {
  return apiRequest('put', '/save-address', {
    address,
  })
}

const updatePassword = passwordData => {
  return apiRequest('put', '/password', passwordData)
}

// ======================================================
// PASSWORD RESET
// ======================================================

const requestPasswordReset = emailOrPayload => {
  const email =
    typeof emailOrPayload === 'string'
      ? emailOrPayload
      : emailOrPayload?.email

  return apiRequest('post', '/forgot-password', {
    email: sanitizeText(email).toLowerCase(),
  })
}

const resetPassword = payloadOrToken => {
  const payload =
    typeof payloadOrToken === 'object' && payloadOrToken !== null
      ? payloadOrToken
      : {
          token: payloadOrToken,
        }

  const token = sanitizeText(
    payload.token ||
      payload.resetToken ||
      payload.passwordResetToken,
  )

  const finalPassword = sanitizeText(
    payload.newPassword ||
      payload.password,
  )

  const confirmPassword = sanitizeText(
    payload.confirmPassword ||
      payload.passwordConfirm ||
      finalPassword,
  )

  return apiRequest('put', '/reset-password', {
    token,
    resetToken: token,
    passwordResetToken: token,
    password: finalPassword,
    newPassword: finalPassword,
    confirmPassword,
    passwordConfirm: confirmPassword,
  })
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
    const token = normalized?.token || response.data?.token || response.data?.accessToken

    if (!token) {
      throw new Error('Token ausente en refresh')
    }

    localStorage.setItem('token', token)

    Cookies.set('token', token, {
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    })

    return {
      success: true,
      data: {
        token,
      },
    }
  } catch (error) {
    sessionStorage.removeItem('user')
    localStorage.removeItem('token')
    Cookies.remove('token', { path: '/' })

    return {
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        'Sesión expirada. Inicie sesión nuevamente.',
    }
  }
}

// ======================================================
// WISHLIST
// ======================================================

const getUserWishlist = () => {
  return apiRequest('get', '/wishlist')
}

const toggleWishlist = productId => {
  return apiRequest('put', `/wishlist/${productId}`, {})
}

// ======================================================
// CUPONES / ÓRDENES
// ======================================================

const createCashOrder = orderData => {
  return apiRequest('post', '/cart/cash-order', orderData)
}

// ======================================================
// EXPORT
// ======================================================

const userService = {
  register,
  loginUser,
  logoutUser,
  loginAdmin,
  updateUser,
  updateUserAddress,
  updatePassword,
  requestPasswordReset,
  resetPassword,
  refreshToken,
  getUserWishlist,
  toggleWishlist,
  createCashOrder,
  getCurrentUser,
}

export default userService
