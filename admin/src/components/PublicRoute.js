// 📁 src/components/PublicRoute.js
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import SpinnerCentered from '@components/SpinnerCentered'

// Sin esto, un usuario que aterriza en /login con una sesión ya válida (por
// ejemplo, tras un redirect duro a /login desde el interceptor de axios por
// una request que falló su refresh, mientras el bootstrap de useAuth() en
// App.js sí terminaba confirmando la sesión) se queda mirando el formulario
// para siempre — Login.js solo redirige tras un submit exitoso (isSuccess),
// nunca reacciona a un isAuthenticated que ya vino en true desde el
// arranque.
//
// Lee directo de Redux (state.user), igual que PrivateRoute.js, en vez de
// llamar a useAuth(): ese hook dispara su propio dispatch(getMe()) en cada
// mount, y llamarlo acá de nuevo (además del que ya corre una vez en
// App.js) dispararía un getMe() redundante cada vez que se visita /login.
const PublicRoute = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useSelector(state => state.user)

  if (isLoading) {
    return <SpinnerCentered />
  }

  if (isAuthenticated && user) {
    return <Navigate to="/" replace />
  }

  return children
}

export default PublicRoute
