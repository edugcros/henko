// Un chunk que no carga se recupera solo. Un bug, no.
//
// POR QUÉ IMPORTA LA DIFERENCIA
//
// Todas las páginas son React.lazy(), con el hash del contenido en el nombre
// del archivo. Después de un deploy, una pestaña abierta desde antes pide
// archivos que ya no existen, y eso aparece como un error genérico la próxima
// vez que alguien entra a una pantalla que no había visitado.
//
// Recargar lo arregla. Pero recargar ante CUALQUIER error convierte un bug
// real en una pestaña girando para siempre, así que lo que se prueba acá es
// que la distinción sea correcta y que el freno frene.

import { jest } from '@jest/globals'
import React from 'react'
import { render, screen } from '@testing-library/react'
import ErrorBoundary, { esErrorDeChunk } from './ErrorBoundary'

const CLAVE = 'henko:chunk-reload'

let reload

const Explota = ({ error }) => {
  throw error
}

const chunkError = () => {
  const e = new Error(
    'Loading chunk 2831 failed. (missing: /js/2831.abc.chunk.js)',
  )
  e.name = 'ChunkLoadError'
  return e
}

beforeEach(() => {
  window.sessionStorage.clear()

  // La recarga entra por prop. window.location no es reemplazable en jsdom, y
  // pelearse con eso seria probar el navegador de mentira en vez del
  // comportamiento.
  reload = jest.fn()

  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('reconocer un chunk caído', () => {
  test('acepta las formas conocidas, de cada empaquetador y navegador', () => {
    expect(esErrorDeChunk(chunkError())).toBe(true)
    expect(esErrorDeChunk(new Error('Loading chunk 42 failed.'))).toBe(true)
    expect(esErrorDeChunk(new Error('Loading CSS chunk 7 failed'))).toBe(true)
    expect(
      esErrorDeChunk(
        new Error('Failed to fetch dynamically imported module: /x.js'),
      ),
    ).toBe(true)
    expect(esErrorDeChunk(new Error('Importing a module script failed.'))).toBe(
      true,
    )
  })

  test('ante la duda NO es un chunk', () => {
    // Tratar un bug como versión vieja lo esconde detrás de un refresh, y el
    // error vuelve a aparecer en cada sesión sin que nadie lo vea entero.
    expect(
      esErrorDeChunk(new Error('Cannot read properties of undefined')),
    ).toBe(false)
    expect(esErrorDeChunk(new Error('quality is not defined'))).toBe(false)
    expect(esErrorDeChunk(new TypeError('x.map is not a function'))).toBe(false)
    expect(esErrorDeChunk(null)).toBe(false)
    expect(esErrorDeChunk(undefined)).toBe(false)
  })
})

describe('recuperarse de una versión vieja', () => {
  test('un chunk caído recarga una vez, sin mostrar error', () => {
    render(
      <ErrorBoundary recargar={reload}>
        <Explota error={chunkError()} />
      </ErrorBoundary>,
    )

    expect(reload).toHaveBeenCalledTimes(1)
    // La recarga se lleva la pantalla; no tiene sentido mostrar un error que
    // el usuario no va a llegar a leer.
    expect(screen.queryByText(/Ocurrió un error inesperado/i)).toBeNull()
  })
})

describe('el freno anti-bucle', () => {
  test('la segunda falla seguida NO recarga: muestra pantalla', () => {
    // Si el archivo falta por un deploy incompleto o por la red del usuario,
    // recargar otra vez deja la pestaña girando para siempre y esconde el
    // problema real.
    window.sessionStorage.setItem(CLAVE, String(Date.now()))

    render(
      <ErrorBoundary recargar={reload}>
        <Explota error={chunkError()} />
      </ErrorBoundary>,
    )

    expect(reload).not.toHaveBeenCalled()
    expect(
      screen.getByText(/No se pudo cargar esta sección/i),
    ).toBeInTheDocument()
  })

  test('pasada la ventana, vuelve a permitirse una recarga', () => {
    // El freno es por tiempo, no un "ya reintenté para siempre": un deploy
    // dentro de dos horas tiene que poder recuperarse solo igual que este.
    window.sessionStorage.setItem(CLAVE, String(Date.now() - 60_000))

    render(
      <ErrorBoundary recargar={reload}>
        <Explota error={chunkError()} />
      </ErrorBoundary>,
    )

    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('sin sessionStorage sigue funcionando', () => {
    // Modo privado, o cookies de sitio bloqueadas. Una recarga que no se puede
    // contar es mejor que una pantalla de error por una versión vieja.
    jest
      .spyOn(window.sessionStorage.__proto__, 'getItem')
      .mockImplementation(() => {
        throw new Error('acceso denegado')
      })
    jest
      .spyOn(window.sessionStorage.__proto__, 'setItem')
      .mockImplementation(() => {
        throw new Error('acceso denegado')
      })

    render(
      <ErrorBoundary recargar={reload}>
        <Explota error={chunkError()} />
      </ErrorBoundary>,
    )

    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('un bug de verdad', () => {
  test('no recarga nunca, y lo dice con su propio mensaje', () => {
    render(
      <ErrorBoundary recargar={reload}>
        <Explota error={new TypeError('quality.flatRate is undefined')} />
      </ErrorBoundary>,
    )

    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText(/Ocurrió un error inesperado/i)).toBeInTheDocument()
    // Y no se confunde con el mensaje de versión vieja, que sugiere recargar.
    expect(screen.queryByText(/versión nueva del panel/i)).toBeNull()
  })

  test('el botón de recargar sigue estando para el usuario', () => {
    render(
      <ErrorBoundary recargar={reload}>
        <Explota error={new Error('algo se rompió')} />
      </ErrorBoundary>,
    )

    screen.getByRole('button', { name: /Recargar/i }).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  test('un fallback propio gana sobre las dos pantallas', () => {
    render(
      <ErrorBoundary recargar={reload} fallback={<p>pantalla propia</p>}>
        <Explota error={new Error('algo se rompió')} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('pantalla propia')).toBeInTheDocument()
  })
})

describe('sin errores', () => {
  test('no toca nada y renderiza a sus hijos', () => {
    render(
      <ErrorBoundary recargar={reload}>
        <p>el panel</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('el panel')).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })
})
