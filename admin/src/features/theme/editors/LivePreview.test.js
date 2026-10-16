// Vista previa del diseñador de tienda: el botón «Abrir».
//
// EL DEFECTO QUE LO ORIGINÓ
//
// «Abrir» era un enlace con target=_blank y rel=noopener: abría la vista previa en una
// pestaña nueva, pero el panel no tenía ninguna referencia a ella, y el diseño solo se le
// manda por postMessage a la ventana del iframe. La pestaña abría la URL correcta y
// mostraba la plantilla por defecto, nunca lo que se estaba diseñando.
//
// Ahora el botón abre una ventana que el panel conserva y le manda el diseño apenas
// saluda, igual que al iframe. Lo que se prueba acá es ese contrato.

import { jest } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'

jest.unstable_mockModule('../../../config/env.js', () => ({
  env: {
    isProduction: true,
    storefrontPreviewUrl: 'https://tienda.example.test',
    publicBaseDomain: 'tienda.example.test',
  },
}))

const { default: LivePreview } = await import('./LivePreview.jsx')

const ORIGEN = 'https://tienda.example.test'
const READY = { type: 'HENKO_THEME_PREVIEW_READY' }
const TEMA = { colors: { primary: '#123456' }, general: { storeName: 'Mi marca' } }
const OTRO_TEMA = { colors: { primary: '#abcdef' }, general: { storeName: 'Otra marca' } }

const actualizacion = payload => ({ type: 'HENKO_THEME_PREVIEW_UPDATE', payload })

/**
 * Una ventana de verdad, no un objeto suelto: MessageEvent exige que `source` sea una
 * Window. Es un iframe vacío con postMessage espiado.
 */
const ventana = () => {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  frame.contentWindow.postMessage = jest.fn()

  return frame.contentWindow
}

const saludar = (source, origin = ORIGEN) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: READY, origin, source }))
  })

let popup
let abrir

beforeEach(() => {
  popup = ventana()
  abrir = jest.fn(() => popup)
  window.open = abrir
})

afterEach(() => {
  document.body.querySelectorAll('iframe').forEach(frame => frame.remove())
})

const iframeDelPanel = container =>
  container.querySelector('iframe[title="Preview real de tienda"]')

describe('LivePreview · botón «Abrir»', () => {
  test('abre la vista previa en una ventana con nombre fijo y conservando la referencia', () => {
    render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))

    expect(abrir).toHaveBeenCalledTimes(1)

    const [url, nombre, ...resto] = abrir.mock.calls[0]

    expect(url).toMatch(/^https:\/\/tienda\.example\.test\/theme-preview\?/)
    expect(url).toContain('source=admin')
    expect(url).toContain(`adminOrigin=${encodeURIComponent(window.location.origin)}`)
    // Con nombre fijo, un segundo clic reutiliza la pestaña en lugar de abrir otra.
    expect(nombre).toBe('henko-theme-preview')
    // Sin tercer argumento: nada de 'noopener', que es lo que dejaba al panel sin la
    // referencia a la ventana.
    expect(resto).toEqual([])
  })

  test('ya no es un enlace con noopener', () => {
    render(<LivePreview themeData={TEMA} />)

    const boton = screen.getByRole('button', { name: 'Abrir' })

    expect(boton.getAttribute('href')).toBeNull()
    expect(boton.getAttribute('target')).toBeNull()
    expect(boton.getAttribute('rel')).toBeNull()
  })

  test('no le manda el diseño a la ventana antes de que salude', () => {
    const { rerender } = render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    rerender(<LivePreview themeData={OTRO_TEMA} />)

    // La ventana todavía está cargando: si el destino no es el que creemos, el
    // navegador rechaza el envío con un error de origen.
    expect(popup.postMessage).not.toHaveBeenCalled()
  })

  test('cuando la ventana saluda, le manda el diseño actual', () => {
    render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(popup)

    expect(popup.postMessage).toHaveBeenCalledWith(actualizacion(TEMA), ORIGEN)
  })

  test('cada cambio del diseño llega a la ventana abierta, en vivo', () => {
    const { rerender } = render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(popup)
    popup.postMessage.mockClear()

    rerender(<LivePreview themeData={OTRO_TEMA} />)

    expect(popup.postMessage).toHaveBeenCalledWith(actualizacion(OTRO_TEMA), ORIGEN)
  })

  test('ignora un saludo que viene de otro origen', () => {
    render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(popup, 'https://sitio-ajeno.example.test')

    expect(popup.postMessage).not.toHaveBeenCalled()
  })

  test('ignora un saludo que viene de una ventana que no abrió el panel', () => {
    render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(ventana())

    expect(popup.postMessage).not.toHaveBeenCalled()
  })

  test('un segundo clic reinicia el saludo: la ventana recarga y hay que esperarlo de nuevo', () => {
    const { rerender } = render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(popup)
    popup.postMessage.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    rerender(<LivePreview themeData={OTRO_TEMA} />)

    expect(popup.postMessage).not.toHaveBeenCalled()

    saludar(popup)

    expect(popup.postMessage).toHaveBeenCalledWith(actualizacion(OTRO_TEMA), ORIGEN)
  })

  test('si la ventana se cerró, no le manda nada', () => {
    const { rerender } = render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(popup)
    popup.postMessage.mockClear()

    Object.defineProperty(popup, 'closed', { get: () => true, configurable: true })
    rerender(<LivePreview themeData={OTRO_TEMA} />)

    expect(popup.postMessage).not.toHaveBeenCalled()
  })

  test('si el navegador bloquea la ventana, lo dice en vez de no hacer nada', () => {
    window.open = jest.fn(() => null)

    render(<LivePreview themeData={TEMA} />)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))

    expect(screen.getByText(/bloqueó la ventana de vista previa/i)).toBeInTheDocument()
  })
})

describe('LivePreview · el panel en vivo (iframe) sigue funcionando', () => {
  test('le manda el diseño al iframe cuando saluda, y solo a él', () => {
    const { container } = render(<LivePreview themeData={TEMA} />)
    const iframe = iframeDelPanel(container).contentWindow

    iframe.postMessage = jest.fn()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))

    saludar(iframe)

    expect(iframe.postMessage).toHaveBeenCalledWith(actualizacion(TEMA), ORIGEN)
    // La ventana abierta todavía no saludó: no recibe nada.
    expect(popup.postMessage).not.toHaveBeenCalled()
  })

  test('el saludo del iframe no marca como lista a la ventana abierta', () => {
    const { container } = render(<LivePreview themeData={TEMA} />)
    const iframe = iframeDelPanel(container).contentWindow

    iframe.postMessage = jest.fn()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(iframe)
    iframe.postMessage.mockClear()

    expect(popup.postMessage).not.toHaveBeenCalled()
  })

  test('el estado cambia a «Conectada» solo con el saludo del iframe', () => {
    const { container } = render(<LivePreview themeData={TEMA} />)

    expect(screen.getByText('Esperando storefront')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    saludar(popup)

    // El saludo de la ventana abierta no dice nada sobre el iframe.
    expect(screen.getByText('Esperando storefront')).toBeInTheDocument()

    saludar(iframeDelPanel(container).contentWindow)

    expect(screen.getByText('Conectada con el storefront')).toBeInTheDocument()
  })
})
