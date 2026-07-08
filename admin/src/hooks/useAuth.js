import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import Cookies from 'js-cookie'
import { jwtDecode } from 'jwt-decode'
import { fetchCsrfToken } from '@utils/axiosConfig'
import { logoutUser, setCsrfToken } from '@features/auth/authSlice'

const CSRF_STORAGE_KEY = 'csrfToken'
const CSRF_FETCHED_AT_KEY = 'csrfTokenFetchedAt'
const USER_STORAGE_KEY = 'user'
const TOKEN_STORAGE_KEY = 'token'

// El backend suele emitir CSRF por ~15 min.
// Refrescamos antes para evitar 403 intermitentes.
const CSRF_MAX_AGE_MS = 10 * 60 * 1000

const isBrowser = () => typeof window !== 'undefined'

const safeSessionGet = key => {
  if (!isBrowser()) return null

  try {
    const value = window.sessionStorage.getItem(key)
    return value && value !== 'undefined' && value !== 'null' ? value : null
  } catch {
    return null
  }
}

const safeSessionSet = (key, value) => {
  if (!isBrowser()) return

  try {
    if (value === undefined || value === null || value === '') {
      window.sessionStorage.removeItem(key)
      return
    }

    window.sessionStorage.setItem(key, String(value))
  } catch {
    // noop
  }
}

const safeSessionRemove = keys => {
  if (!isBrowser()) return

  try {
    keys.forEach(key => window.sessionStorage.removeItem(key))
  } catch {
    // noop
  }
}

const getTokenFromStorage = () => {
  return safeSessionGet(TOKEN_STORAGE_KEY)
}

const getTokenFromCookie = () => {
  try {
    return Cookies.get('token') || null
  } catch {
    return null
  }
}

const getRuntimeToken = tokenRedux => {
  return tokenRedux || getTokenFromStorage() || getTokenFromCookie()
}

const getUserFromStorage = () => {
  const item = safeSessionGet(USER_STORAGE_KEY)

  if (!item) return null

  try {
    return JSON.parse(item)
  } catch {
    return null
  }
}

const decodeTokenSafely = token => {
  if (!token) return null

  try {
    const decoded = jwtDecode(token)

    if (!decoded || typeof decoded !== 'object') {
      return null
    }

    if (decoded.exp && decoded.exp * 1000 <= Date.now()) {
      return null
    }

    return decoded
  } catch {
    return null
  }
}

const isStoredCsrfFresh = () => {
  const token = safeSessionGet(CSRF_STORAGE_KEY)
  const fetchedAt = Number(safeSessionGet(CSRF_FETCHED_AT_KEY) || 0)

  if (!token || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return false
  }

  return Date.now() - fetchedAt < CSRF_MAX_AGE_MS
}

const clearLocalAuthSession = () => {
  safeSessionRemove([
    TOKEN_STORAGE_KEY,
    USER_STORAGE_KEY,
    CSRF_STORAGE_KEY,
    CSRF_FETCHED_AT_KEY,
  ])
}

export const useAuth = () => {
  const dispatch = useDispatch()

  /**
   * Compatibilidad:
   * - Si tu store está montado como state.user, funciona.
   * - Si está montado como state.auth, también funciona.
   */
  const authState = useSelector(state => state.user || state.auth || {})

  const {
    user: userRedux,
    token: tokenRedux,
    csrfToken: csrfTokenRedux,
    isLoading,
  } = authState

  const [csrfTokenState, setCsrfTokenState] = useState(
    () => csrfTokenRedux || safeSessionGet(CSRF_STORAGE_KEY) || '',
  )
  const [decodedToken, setDecodedToken] = useState(null)
  const [loading, setLoading] = useState(true)
  const [csrfLoading, setCsrfLoading] = useState(false)
  const [csrfError, setCsrfError] = useState(null)

  useEffect(() => {
    let active = true

    const token = getRuntimeToken(tokenRedux)

    if (!token) {
      setDecodedToken(null)
      setLoading(false)
      return () => {
        active = false
      }
    }

    const decoded = decodeTokenSafely(token)

    if (!decoded) {
      clearLocalAuthSession()
      dispatch(logoutUser())

      if (active) {
        setDecodedToken(null)
        setLoading(false)
      }

      return () => {
        active = false
      }
    }

    if (active) {
      setDecodedToken(decoded)
      setLoading(false)
    }

    return () => {
      active = false
    }
  }, [tokenRedux, dispatch])

  const fetchAndSetCsrf = useCallback(
    async ({ force = false } = {}) => {
      if (!force && isStoredCsrfFresh()) {
        const cached = safeSessionGet(CSRF_STORAGE_KEY)

        if (cached) {
          setCsrfTokenState(cached)
          dispatch(setCsrfToken(cached))
          return cached
        }
      }

      setCsrfLoading(true)
      setCsrfError(null)

      try {
        const csrf = await fetchCsrfToken()

        if (csrf) {
          safeSessionSet(CSRF_STORAGE_KEY, csrf)
          safeSessionSet(CSRF_FETCHED_AT_KEY, String(Date.now()))
          setCsrfTokenState(csrf)
          dispatch(setCsrfToken(csrf))
        }

        return csrf || ''
      } catch (error) {
        setCsrfError(error)

        return ''
      } finally {
        setCsrfLoading(false)
      }
    },
    [dispatch],
  )

  useEffect(() => {
    fetchAndSetCsrf()
  }, [fetchAndSetCsrf])

  useEffect(() => {
    if (csrfTokenRedux && csrfTokenRedux !== csrfTokenState) {
      setCsrfTokenState(csrfTokenRedux)
      safeSessionSet(CSRF_STORAGE_KEY, csrfTokenRedux)
      safeSessionSet(CSRF_FETCHED_AT_KEY, String(Date.now()))
    }
  }, [csrfTokenRedux, csrfTokenState])

  const user = useMemo(() => {
    return userRedux || getUserFromStorage() || decodedToken
  }, [userRedux, decodedToken])

  const userRole = decodedToken?.role || user?.role || 'user'

  const isBlocked = Boolean(
    decodedToken?.isBlocked ||
    user?.isBlocked ||
    user?.blocked ||
    user?.status === 'blocked',
  )

  const isAuthenticated = useMemo(() => {
    const token = getRuntimeToken(tokenRedux)

    return Boolean(decodedToken && token && user && !isBlocked)
  }, [decodedToken, tokenRedux, user, isBlocked])

  const doLogoutUser = useCallback(async () => {
    clearLocalAuthSession()
    setDecodedToken(null)
    setCsrfTokenState('')
    await dispatch(logoutUser())
  }, [dispatch])

  return {
    isAuthenticated,
    user,
    userRole,
    isBlocked,
    csrfToken: csrfTokenState || csrfTokenRedux || '',
    csrfLoading,
    csrfError,
    isLoading: loading || Boolean(isLoading),
    logoutUser: doLogoutUser,
    refreshCsrf: fetchAndSetCsrf,
  }
}
