import React from 'react'
import { env } from '../../config/env.js'
import './ErrorBoundary.css'

// Un crash de render se tragaba acá entero: quedaba en el console.error del
// navegador que lo sufrió y el servidor no se enteraba nunca —la app alcanza a
// pedir tenant y tema antes de romperse, así que los access logs se ven sanos.
// Con una tienda por comercio no hay forma de pedirle la consola a cada
// cliente, y sin el stack no se puede distinguir un crash de un deslogueo.
//
// Se manda con fetch crudo y no con la instancia de axios a propósito: sus
// interceptores agregan CSRF y pueden disparar el refresh de sesión, y meter
// esa cadena a correr dentro de una app ya rota se arriesga a un segundo
// error que tape al primero. keepalive deja que el pedido sobreviva si el
// usuario recarga enseguida (que es lo que hace el botón de abajo).
let yaReportado = false

const reportarCrash = (error, info) => {
  // Un crash en bucle re-renderiza y volvería a reportar: con el primero
  // alcanza para entender la falla.
  if (yaReportado) return
  yaReportado = true

  try {
    if (!env.apiBaseUrl || typeof fetch !== 'function') return

    let autenticado = false
    try {
      // Misma clave que usa axiosConfig al limpiar la sesión del cliente.
      autenticado = Boolean(window.sessionStorage.getItem('user'))
    } catch {
      // Navegador con el almacenamiento bloqueado: el dato es opcional.
    }

    // apiBaseUrl viene crudo de la variable de entorno: si trae barra final,
    // concatenar daría //metrics/client-error.
    const base = String(env.apiBaseUrl).replace(/\/+$/, '')

    fetch(`${base}/metrics/client-error`, {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        [env.tenantHeader || 'x-tenant-domain']: window.location.hostname,
      },
      body: JSON.stringify({
        app: 'website',
        message: error?.message || String(error),
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
        route: `${window.location.pathname}${window.location.search}`,
        authenticated: autenticado,
      }),
      // Si el reporte falla no hay nada que hacer: lo que el usuario ve ya
      // está resuelto por el fallback de abajo.
    }).catch(() => {})
  } catch {
    // Reportar no puede ser nunca la causa de un segundo error.
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('🛑 Error capturado por ErrorBoundary:', error, info)
    reportarCrash(error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    const { hasError } = this.state
    const { fallback, children } = this.props

    if (hasError) {
      return (
        fallback || (
          <div className="error-boundary" role="alert" aria-live="assertive">
            <div className="error-container">
              <h1 className="error-title">😢 Ocurrió un error inesperado</h1>
              <p className="error-message">
                Lo sentimos, algo salió mal. Por favor, recarga la página o intenta más tarde.
              </p>
              <button className="error-btn" onClick={this.handleReload}>
                🔄 Recargar Página
              </button>
            </div>
          </div>
        )
      )
    }

    return children
  }
}

export default ErrorBoundary
