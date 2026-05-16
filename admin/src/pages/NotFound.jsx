import React from 'react'
import { Link } from 'react-router-dom'
import './NotFound.css'

const NotFound = () => {
  return (
    <div className="notfound-container">
      <h1 className="notfound-title">404</h1>
      <p className="notfound-message">
        La página que estás buscando no existe.
      </p>
      <Link to="/admin" className="notfound-link">
        Volver al panel principal
      </Link>
    </div>
  )
}

export default NotFound
