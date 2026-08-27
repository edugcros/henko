import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { fetchCsrfToken } from '@utils/axiosConfig'
import { getMe, logoutUser, setCsrfToken } from '@features/auth/authSlice'

const CSRF_STORAGE_KEY = 'csrfToken'
const CSRF_FETCHED_AT_KEY = 'csrfTokenFetchedAt'
const USER_STORAGE_KEY = 'user'

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

const getUserFromStorage = () => {
  const item = safeSessionGet(USER_STORAGE_KEY)

  if (!item) return null

  try {
    return JSON.parse(item)
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
  safeSessionRemove([USER_STORAGE_KEY, CSRF_STORAGE_KEY, CSRF_FETCHED_AT_KEY])
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
    isAuthenticated: isAuthenticatedRedux,
    csrfToken: csrfTokenRedux,
  } = authState

  const [csrfTokenState, setCsrfTokenState] = useState(
    () => csrfTokenRedux || safeSessionGet(CSRF_STORAGE_KEY) || '',
  )
  const [bootstrapped, setBootstrapped] = useState(false)
  const [csrfLoading, setCsrfLoading] = useState(false)
  const [csrfError, setCsrfError] = useState(null)

  // El access token vive en una cookie httpOnly desde el backend — JS no
  // puede leerla para saber si hay sesión. El único chequeo confiable es
  // preguntarle al backend directamente vía /user/me; getMe.fulfilled/
  // .rejected en authSlice.js ya actualizan isAuthenticated/user según la
  // respuesta. No se dispara logoutUser() acá si falla: un 401 en el
  // bootstrap significa "nunca hubo sesión", no "había una sesión que
  // cerrar" — dispatchear logout ahí llamaría al backend sin necesidad.
  useEffect(() => {
    let active = true

    dispatch(getMe()).finally(() => {
      if (active) setBootstrapped(true)
    })

    return () => {
      active = false
    }
  }, [dispatch])

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
    return userRedux || getUserFromStorage()
  }, [userRedux])

  const userRole = user?.role || 'user'

  const isBlocked = Boolean(
    user?.isBlocked || user?.blocked || user?.status === 'blocked',
  )

  const isAuthenticated = useMemo(() => {
    return Boolean(isAuthenticatedRedux && user && !isBlocked)
  }, [isAuthenticatedRedux, user, isBlocked])

  const doLogoutUser = useCallback(async () => {
    clearLocalAuthSession()
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
    isLoading: !bootstrapped,
    logoutUser: doLogoutUser,
    refreshCsrf: fetchAndSetCsrf,
  }
}
