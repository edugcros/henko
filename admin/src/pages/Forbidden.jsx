import React from 'react'
import { Link } from 'react-router-dom'
import './NotFound.css'

// PrivateRoute redirige acá cuando el usuario está logueado pero le falta el
// rol requerido por la ruta. Antes redirigía a /403 sin ruta registrada y
// caía en el fallback (NotFound), así que un permiso denegado se veía como
// "página no encontrada" y el usuario se confundía creyendo que la URL no
// existía.
const Forbidden = () => {
  return (
    <div className="notfound-container">
      <h1 className="notfound-title">403</h1>
      <p className="notfound-message">
        Tu cuenta no tiene permisos para acceder a esta sección.
      </p>
      <Link to="/admin" className="notfound-link">
        Volver al panel principal
      </Link>
    </div>
  )
}

export default Forbidden
