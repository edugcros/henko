// 📁 src/Components/PublicRoute.js

import React from 'react'
import { useLocation, Navigate } from 'react-router-dom'
import PropTypes from 'prop-types'
import { useAuth } from '@hooks/useAuth'
import SpinnerCentered from '@components/SpinnerCentered/SpinnerCentered'
import { publicRoutesSet } from '@routes/routesConfig'

const PublicRoute = ({ children }) => {
  const location = useLocation()
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) return <SpinnerCentered />

  // 🔎 Limpiar la ruta (evita errores por trailing slashes)
  const path = location.pathname.replace(/\/$/, '')
  const isExplicitlyPublic = publicRoutesSet.has(path)

  // 🔒 Si el usuario está autenticado y accede a una ruta pública como /login, redirigir al home
  if (isAuthenticated && isExplicitlyPublic) {
    return <Navigate to="/" replace />
  }

  // ✅ Si no está autenticado o está en una ruta pública permitida, mostrar contenido
  return children
}

PublicRoute.propTypes = {
  children: PropTypes.node.isRequired,
}

export default PublicRoute
