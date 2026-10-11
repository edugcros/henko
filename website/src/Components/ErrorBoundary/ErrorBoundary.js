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
// Cuántos reportes acepta una carga de la app. No es uno solo porque las tres
// clases de falla son distintas y la primera que aparezca no debe tapar a las
// otras; y no es ilimitado porque un error en bucle inundaría el log.
const TOPE_DE_REPORTES = 3
let reportados = 0

// La ruta del crash termina en los logs del hosting, que son durables, y hay
// rutas que llevan credenciales usables en la URL: /reset-password/:token tiene
// el token de reseteo en el path y /verify-email?token=... en la consulta.
// Mandarla cruda copiaba esas credenciales al log, donde después las ve
// cualquiera con acceso al panel. Para depurar sirve la FORMA de la ruta, no el
// valor del token.
//
// Se recorta por forma y no por lista de rutas conocidas: una ruta nueva con un
// token en la URL no debería filtrar nada por el solo hecho de ser nueva.
//
// Pero recortar de más también cuesta: si /product/zapatillas-running-azules
// llega como /product/***, el reporte deja de decir qué página se rompió. Lo
// que separa un token de un slug es el guión —los slugs separan palabras, los
// tokens son un bloque— más el largo.
const HEX_LARGO = /^[a-f0-9]{24,}$/i // ObjectIds de Mongo y tokens en hexa
const BLOQUE_OPACO = /^[A-Za-z0-9_]{20,}$/ // un bloque sin palabras separadas
const DEMASIADO_LARGO = /^[A-Za-z0-9_-]{40,}$/ // JWT o base64url, con guiones o sin

const esOpaco = parte =>
  HEX_LARGO.test(parte) || BLOQUE_OPACO.test(parte) || DEMASIADO_LARGO.test(parte)

export const rutaSegura = () => {
  try {
    const camino = String(window.location.pathname || '/')
      .split('/')
      .map(parte => (esOpaco(parte) ? '***' : parte))
      .join('/')

    // Se conservan los nombres de los parámetros y se descartan TODOS los
    // valores. El nombre dice qué venía en la URL —que es la pista útil—; el
    // valor es exactamente lo que no puede salir. Sin lista de claves
    // sensibles: cualquier lista se queda corta con el próximo parámetro.
    const claves = [...new URLSearchParams(window.location.search).keys()]
    const consulta = claves.length ? `?${claves.map(c => `${c}=***`).join('&')}` : ''

    return `${camino}${consulta}`
  } catch {
    // Nunca vale la pena arriesgar un segundo error acá, ni mandar la URL sin
    // recortar como alternativa.
    return '(ruta no disponible)'
  }
}

export const reportarCrash = (error, info, origen = 'render') => {
  if (reportados >= TOPE_DE_REPORTES) return
  reportados += 1

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
        // El origen distingue las tres clases de falla, que se diagnostican
        // distinto: un crash de render rompe la pantalla, una promesa
        // rechazada deja la app viva y mostrando un mensaje de error.
        message: `[${origen}] ${error?.message || String(error)}`,
        stack: error?.stack || '',
        componentStack: info?.componentStack || '',
        route: rutaSegura(),
        authenticated: autenticado,
      }),
      // Si el reporte falla no hay nada que hacer: lo que el usuario ve ya
      // está resuelto por el fallback de abajo.
    }).catch(() => {})
  } catch {
    // Reportar no puede ser nunca la causa de un segundo error.
  }
}

// Un ErrorBoundary de React sólo captura errores de render, de los métodos de
// ciclo de vida y de los constructores. NO captura promesas rechazadas ni
// errores dentro de manejadores async, y ahí es donde vive la mayoría de las
// fallas de una app que habla con una API: un thunk que rechaza deja la app
// entera viva, mostrando su mensaje de error, sin que el boundary se entere.
//
// Por eso la primera versión de este reporte no sirvió para el login que
// fallaba desde el celular: el login daba 200, el usuario veía un error, y no
// llegaba ningún reporte porque no había crash de render que reportar.
export const registrarReporteGlobal = () => {
  if (typeof window === 'undefined') return

  window.addEventListener('unhandledrejection', evento => {
    const causa = evento?.reason
    reportarCrash(
      causa instanceof Error ? causa : new Error(String(causa)),
      null,
      'promesa-rechazada',
    )
  })

  window.addEventListener('error', evento => {
    // Los errores de carga de recursos (img, script) también disparan 'error'
    // y no traen Error: no son fallas de la app y sólo harían ruido.
    if (!evento?.error) return
    reportarCrash(evento.error, null, 'error-global')
  })
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
