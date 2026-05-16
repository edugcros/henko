// src/pages/Unauthorized.jsx
import React from 'react'
import { Link } from 'react-router-dom'

const Unauthorized = () => {
  return (
    <div style={{ textAlign: 'center', padding: '3rem' }}>
      <h1>🚫 Acceso Denegado</h1>
      <p>No tienes permiso para ver esta página.</p>
      <Link to="/" style={{ color: 'blue', textDecoration: 'underline' }}>
        Volver al inicio
      </Link>
    </div>
  )
}

export default Unauthorized
