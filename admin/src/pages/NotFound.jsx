import React from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../components/AuthShell.js'

const NotFound = () => {
  return (
    <AuthShell titleId="notfound-title">
      <span className="hk-auth-code">404</span>
      <h1 id="notfound-title">No encontramos esa página</h1>
      <p className="hk-auth-lead">La página que estás buscando no existe.</p>

      <Link className="hk-auth-submit" to="/admin">
        <span>Volver al panel principal</span>
      </Link>
    </AuthShell>
  )
}

export default NotFound
