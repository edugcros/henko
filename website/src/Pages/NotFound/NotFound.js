// 📁 src/pages/NotFound.jsx
import React from 'react'
import { Link } from 'react-router-dom'
import './NotFound.css'

const NotFound = () => {
  return (
    <div className="notfound-container">
      <div className="notfound-content">
        <h1 className="notfound-title">404</h1>
        <p className="notfound-message">Página no encontrada</p>
        <p className="notfound-subtext">La página que estás buscando no existe o fue movida.</p>
        <Link to="/" className="notfound-button">
          Volver al Inicio
        </Link>
      </div>
    </div>
  )
}

export default NotFound
