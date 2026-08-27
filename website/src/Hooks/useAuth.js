// 📁 src/hooks/useAuth.js
import { useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { getMe } from '@features/user/userSlice'

/**
 * Hook para manejar la sesión del usuario en el Frontend.
 * No busca el JWT en cookies porque es httpOnly (invisible para JS) — el
 * único chequeo confiable de si hay sesión es preguntarle al backend
 * directamente vía /user/me (getMe), que ya actualiza
 * isAuthenticated/user en Redux según la respuesta real.
 *
 * useAuth() se llama desde 4 componentes distintos (App.js, PrivateRoute,
 * PublicRoute, privateLayout) — cada uno con su propia instancia del hook.
 * Sin este cache a nivel módulo, cada montaje/desmontaje al navegar entre
 * rutas públicas/privadas dispararía un getMe() nuevo. authBootstrapPromise
 * asegura que el dispatch real ocurra una sola vez por sesión de la SPA; el
 * resto de las instancias solo esperan la misma promesa ya en vuelo (o ya
 * resuelta). Después del bootstrap inicial, loginUser/logoutUser ya
 * mantienen isAuthenticated/user al día en Redux directamente — no hace
 * falta repetir el chequeo.
 */
let authBootstrapPromise = null

const ensureAuthBootstrap = dispatch => {
  if (!authBootstrapPromise) {
    authBootstrapPromise = dispatch(getMe())
  }

  return authBootstrapPromise
}

export const useAuth = () => {
  const dispatch = useDispatch()
  const userFromRedux = useSelector(state => state.user?.user)
  const isAuthenticatedRedux = useSelector(state => state.user?.isAuthenticated)
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    let active = true

    ensureAuthBootstrap(dispatch).finally(() => {
      if (active) setBootstrapped(true)
    })

    return () => {
      active = false
    }
  }, [dispatch])

  const isAuthenticated = Boolean(isAuthenticatedRedux && userFromRedux)
  const userRole = userFromRedux?.role || 'user'
  const isBlocked = !!userFromRedux?.isBlocked

  return {
    isAuthenticated,
    userRole,
    user: userFromRedux,
    isLoading: !bootstrapped,
    isBlocked,
    // El token no se expone aquí porque JS no debe manipularlo (Seguridad)
  }
}
