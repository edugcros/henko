import React from 'react'
import './ErrorBoundary.css'

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
    // Aquí podrías enviar el error a Sentry u otro logger
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
                Lo sentimos, algo salió mal. Por favor, recarga la página o
                intenta más tarde.
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
