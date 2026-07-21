import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSelector } from 'react-redux'
import SpinnerCentered from '@components/SpinnerCentered'

const PrivateRoute = ({ allowedRoles }) => {
  const location = useLocation()

  const { isAuthenticated, isLoading, user } = useSelector(state => state.user)

  /**
   * 🌀 Mientras App está resolviendo sesión
   * NO redirigimos
   */
  if (isLoading) {
    return <SpinnerCentered />
  }

  /**
   * ❌ No autenticado
   */
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  /**
   * 🚫 Autenticado pero sin rol permitido
   */
  if (allowedRoles && Array.isArray(allowedRoles) && !allowedRoles.includes(user.role)) {
    return <Navigate to="/403" replace />
  }

  /**
   * ✅ Acceso concedido
   */
  return <Outlet />
}

export default PrivateRoute
