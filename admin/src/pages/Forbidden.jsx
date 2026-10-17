import React from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../components/AuthShell.js'

// PrivateRoute redirige acá cuando el usuario está logueado pero le falta el
// rol requerido por la ruta. Antes redirigía a /403 sin ruta registrada y
// caía en el fallback (NotFound), así que un permiso denegado se veía como
// "página no encontrada" y el usuario se confundía creyendo que la URL no
// existía.
const Forbidden = () => {
  return (
    <AuthShell titleId="forbidden-title">
      <span className="hk-auth-code">403</span>
      <h1 id="forbidden-title">No tenés acceso a esta sección</h1>
      <p className="hk-auth-lead">Tu cuenta no tiene permisos para acceder a esta sección.</p>

      <Link className="hk-auth-submit" to="/admin">
        <span>Volver al panel principal</span>
      </Link>
    </AuthShell>
  )
}

export default Forbidden
