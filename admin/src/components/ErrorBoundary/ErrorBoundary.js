import React from 'react'
import './ErrorBoundary.css'

/**
 * Un chunk que no carga no es un bug: es una versión vieja del panel.
 *
 * EL PROBLEMA
 *
 * Todas las páginas se cargan con React.lazy() (ver pages/index.js), así que
 * cada una vive en su propio archivo con el hash del contenido en el nombre.
 * Cuando sale un deploy, los archivos de las páginas que cambiaron pasan a
 * llamarse distinto y los viejos dejan de existir.
 *
 * Una pestaña que quedó abierta desde antes del deploy sigue teniendo en
 * memoria los nombres viejos. Al navegar a una página que todavía no había
 * cargado, pide un archivo que ya no está, el import() se rechaza y el
 * boundary muestra "ocurrió un error inesperado" — que es exactamente lo que
 * NO pasó: la aplicación está bien, lo único que pasó es que el usuario tiene
 * la guía telefónica del año pasado.
 *
 * Y el error aparece justo donde menos se entiende: no al desplegar, sino la
 * próxima vez que alguien entra a una pantalla que no había visitado.
 *
 * QUÉ HACE AHORA
 *
 * Se recupera solo: recarga una vez, el navegador revalida el index —que sale
 * con max-age=0, must-revalidate— y con los nombres nuevos la página entra. El
 * usuario ve un parpadeo en vez de un error.
 *
 * CON FRENO, PORQUE RECARGAR SOLO ES PELIGROSO
 *
 * Si el chunk falta por algo que una recarga no arregla —un deploy incompleto,
 * la red del usuario, un bloqueador— recargar en bucle deja la pestaña
 * girando para siempre y esconde el problema real. Por eso se permite UNA
 * recarga cada VENTANA_MS: la segunda falla seguida muestra pantalla, con su
 * mensaje propio, que es distinto del de un bug.
 *
 * El freno se guarda por tiempo y no por un "ya reintenté": el boundary se
 * monta ANTES de que el import() se rechace —lo de adentro está en Suspense—
 * así que cualquier marca que se limpiara al montar se limpiaría siempre y el
 * freno no frenaría nada.
 */
const CLAVE_REINTENTO = 'henko:chunk-reload'
const VENTANA_MS = 15000

/**
 * ¿Es un chunk que no cargó, y no un error del código?
 *
 * Cada empaquetador y cada navegador lo dice distinto, así que se preguntan
 * todas las formas conocidas. Ante la duda NO se recarga: tratar un bug real
 * como si fuera un chunk viejo lo esconde detrás de un refresh.
 */
export const esErrorDeChunk = error => {
  if (!error) return false
  // El nombre que le pone webpack. Es el caso limpio.
  if (error.name === 'ChunkLoadError') return true

  const mensaje = String(error.message || '')

  return (
    // webpack
    /Loading chunk [^\s]+ failed/i.test(mensaje) ||
    /Loading CSS chunk/i.test(mensaje) ||
    // Vite / navegadores con módulos nativos
    /Failed to fetch dynamically imported module/i.test(mensaje) ||
    /error loading dynamically imported module/i.test(mensaje) ||
    // Safari
    /Importing a module script failed/i.test(mensaje) ||
    /Unable to preload CSS/i.test(mensaje)
  )
}

/**
 * Recargar, en un solo lugar y sustituible.
 *
 * Va por prop (`recargar`) en vez de llamar a window.location directamente
 * porque window.location no se puede reemplazar en el entorno de tests —no es
 * redefinible— y probar esto contra el navegador de mentira en vez de contra
 * el comportamiento es probar el navegador de mentira.
 *
 * reload() y no una navegación: conserva la URL, que es a donde el usuario
 * quería ir, y el index revalida por su propio Cache-Control.
 */
const recargarPagina = () => window.location.reload()

/** sessionStorage puede tirar en modo privado; que eso no rompa la pantalla. */
const leerUltimoReintento = () => {
  try {
    return Number(window.sessionStorage.getItem(CLAVE_REINTENTO)) || 0
  } catch {
    return 0
  }
}

const marcarReintento = () => {
  try {
    window.sessionStorage.setItem(CLAVE_REINTENTO, String(Date.now()))
  } catch {
    // Sin sessionStorage no hay freno posible. Se sigue igual: una recarga que
    // no se puede contar es mejor que una pantalla de error por una versión
    // vieja, y el navegador que no guarda nada es el caso raro.
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, esChunk: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, esChunk: esErrorDeChunk(error) }
  }

  get recargar() {
    return this.props.recargar || recargarPagina
  }

  componentDidCatch(error, info) {
    if (esErrorDeChunk(error)) {
      const desdeElUltimo = Date.now() - leerUltimoReintento()

      if (desdeElUltimo > VENTANA_MS) {
        console.warn(
          '♻️ Falta un archivo del panel (versión vieja en esta pestaña). Recargando una vez.',
          error.message,
        )
        marcarReintento()
        this.recargar()
        return
      }

      // Segunda seguida: recargar otra vez sería un bucle.
      console.error(
        '🛑 El archivo sigue sin cargar después de recargar. No es una versión vieja.',
        error,
        info,
      )
      return
    }

    console.error('🛑 Error capturado por ErrorBoundary:', error, info)
  }

  handleReload = () => {
    this.recargar()
  }

  render() {
    const { hasError, esChunk } = this.state
    const { fallback, children } = this.props

    if (!hasError) return children
    if (fallback) return fallback

    // Dos mensajes distintos porque son dos problemas distintos, y lo que el
    // usuario puede hacer al respecto también.
    const titulo = esChunk
      ? '🔄 No se pudo cargar esta sección'
      : '😢 Ocurrió un error inesperado'

    const mensaje = esChunk
      ? 'Puede que haya una versión nueva del panel. Recargá la página; si vuelve a pasar, avisanos.'
      : 'Lo sentimos, algo salió mal. Por favor, recarga la página o intenta más tarde.'

    return (
      <div className="error-boundary" role="alert" aria-live="assertive">
        <div className="error-container">
          <h1 className="error-title">{titulo}</h1>
          <p className="error-message">{mensaje}</p>
          <button className="error-btn" onClick={this.handleReload}>
            🔄 Recargar Página
          </button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
