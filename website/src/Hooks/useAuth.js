// 📁 src/hooks/useAuth.js
import { useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { getMe, marcaDeSesion } from '@features/user/userSlice'

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

/**
 * Pregunta por la sesión sólo si tiene sentido preguntarla.
 *
 * A quien nunca inició sesión en este navegador no hay nada que
 * restaurarle, y preguntar le costaba dos llamadas garantizadas en cada
 * carga —/user/me da 401, /user/refresh da 403— más dos errores en la
 * consola que parecían una rotura. Multiplicado por cada visitante anónimo
 * de cada tienda, es tráfico que el backend paga para enterarse de algo que
 * ya se sabía.
 *
 * La marca la mantiene userSlice en cada entrada, confirmación y salida. No
 * es prueba de sesión —la verdad sigue siendo la cookie httpOnly, que JS no
 * puede leer—: sólo evita la pregunta cuando con certeza no hay nada que
 * preguntar.
 */
const ensureAuthBootstrap = dispatch => {
  if (!authBootstrapPromise) {
    authBootstrapPromise = marcaDeSesion.hay() ? dispatch(getMe()) : Promise.resolve(null)
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
