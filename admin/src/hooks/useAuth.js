import { useEffect, useState, useMemo, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import Cookies from 'js-cookie'
import { jwtDecode } from 'jwt-decode'
import { fetchCsrfToken } from '@utils/axiosConfig'
import { logoutUser, setCsrfToken } from '@features/auth/authSlice'

const getTokenFromCookie = () => Cookies.get('token') || sessionStorage.getItem('token') || null
const getUserFromStorage = () => {
  try {
    const item = sessionStorage.getItem('user')
    return item && item !== 'undefined' ? JSON.parse(item) : null
  } catch { return null }
}

export const useAuth = () => {
  const dispatch = useDispatch()
  const {
    user: userRedux,
    token: tokenRedux,
    csrfToken: csrfTokenRedux,
    isLoading,
  } = useSelector(state => state.user)
  const [csrfToken, setCsrfTokenState] = useState(csrfTokenRedux || sessionStorage.getItem('csrfToken') || '')
  const [decodedToken, setDecodedToken] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const token = tokenRedux || getTokenFromCookie()
    if (!token) {
      setDecodedToken(null)
      setLoading(false)
      return
    }
    let isMounted = true
    try {
      const decoded = jwtDecode(token)
      if (decoded.exp * 1000 <= Date.now()) {
        dispatch(logoutUser())
        if (isMounted) setDecodedToken(null)
      } else {
        if (isMounted) setDecodedToken(decoded)
      }
    } catch {
      dispatch(logoutUser())
      if (isMounted) setDecodedToken(null)
    }
    setLoading(false)
    return () => { isMounted = false }
  }, [tokenRedux, dispatch])

  const fetchAndSetCsrf = useCallback(async () => {
    let csrf = sessionStorage.getItem('csrfToken')
    if (!csrf) {
      csrf = await fetchCsrfToken()
      if (csrf) {
        setCsrfTokenState(csrf)
        dispatch(setCsrfToken(csrf))
      }
    } else {
      setCsrfTokenState(csrf)
    }
    return csrf
  }, [dispatch])

  useEffect(() => { fetchAndSetCsrf() }, [fetchAndSetCsrf])

  const user = useMemo(
    () => userRedux || getUserFromStorage() || decodedToken,
    [userRedux, decodedToken]
  )
  const userRole = decodedToken?.role || user?.role || 'user'
  const isBlocked = !!decodedToken?.isBlocked

  const isAuthenticated = useMemo(
    () =>
      Boolean(
        decodedToken &&
        (tokenRedux || getTokenFromCookie()) &&
        user?.role &&
        !isBlocked
      ),
    [decodedToken, tokenRedux, user, isBlocked]
  )

  const dologoutUser = useCallback(() => {
    dispatch(logoutUser())
  }, [dispatch])

  return {
    isAuthenticated,
    user,
    userRole,
    isBlocked,
    csrfToken: csrfToken || csrfTokenRedux,
    isLoading: loading || isLoading,
    logoutUser: dologoutUser,
    refreshCsrf: fetchAndSetCsrf,
  }
}
