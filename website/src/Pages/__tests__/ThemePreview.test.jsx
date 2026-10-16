/* eslint-env jest */
// Vista previa del diseñador: con quién conversa.
//
// EL DEFECTO QUE LO ORIGINÓ
//
// La vista previa solo sabía hablar con window.parent, o sea con el iframe del panel. El
// botón «Abrir» del admin la abre en una pestaña propia, donde window.parent es la propia
// ventana: el saludo «estoy lista» se mandaba a sí misma y cualquier diseño recibido se
// descartaba. Resultado: la pestaña mostraba la plantilla por defecto y nunca lo que se
// estaba diseñando.
//
// Ahora, fuera de un iframe, el interlocutor es window.opener: la ventana que la abrió.

import React from 'react'
import { render } from '@testing-library/react'
import ThemePreview, { getAdminWindow } from '../ThemePreview'
import { setPreviewMode, updatePreviewConfig } from '@features/theme/themeSlice'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: () => null,
}))
jest.mock('@components/CustomHeader', () => () => null)
jest.mock('@components/Footer', () => () => null)
jest.mock('@pages/Home', () => () => null)
jest.mock('@features/theme/themeSlice', () => ({
  setPreviewMode: jest.fn(value => ({ type: 'setPreviewMode', payload: value })),
  updatePreviewConfig: jest.fn(config => ({ type: 'updatePreviewConfig', payload: config })),
}))
jest.mock('../../config/env.js', () => ({
  env: {
    isProduction: true,
    adminPreviewOrigins: 'https://admin.example.test',
    adminBaseDomain: 'admin.example.test',
  },
}))

const ADMIN = 'https://admin.example.test'
const READY = { type: 'HENKO_THEME_PREVIEW_READY' }
const DISENO = { colors: { primary: '#123456' }, general: { storeName: 'Mi marca' } }
const actualizacion = payload => ({ type: 'HENKO_THEME_PREVIEW_UPDATE', payload })

/** Una ventana de verdad —MessageEvent exige que `source` sea una Window— con postMessage espiado. */
const ventana = () => {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  frame.contentWindow.postMessage = jest.fn()

  return frame.contentWindow
}

const definir = (nombre, valor) =>
  Object.defineProperty(window, nombre, { value: valor, configurable: true, writable: true })

const original = {}

beforeEach(() => {
  for (const nombre of ['opener', 'parent']) {
    original[nombre] = Object.getOwnPropertyDescriptor(window, nombre)
  }

  mockDispatch.mockClear()
  setPreviewMode.mockClear()
  updatePreviewConfig.mockClear()
  sessionStorage.clear()
  window.history.pushState({}, '', `/theme-preview?ts=0&adminOrigin=${encodeURIComponent(ADMIN)}`)
})

afterEach(() => {
  for (const nombre of ['opener', 'parent']) {
    if (original[nombre]) Object.defineProperty(window, nombre, original[nombre])
    else delete window[nombre]
  }

  document.body.querySelectorAll('iframe').forEach(frame => frame.remove())
})

const recibir = (source, data, origin = ADMIN) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))

describe('getAdminWindow', () => {
  it('dentro de un iframe, el interlocutor es el padre', () => {
    const padre = ventana()
    definir('parent', padre)

    expect(getAdminWindow()).toBe(padre)
  })

  it('en una pestaña propia, el interlocutor es quien la abrió', () => {
    const abridora = ventana()
    definir('opener', abridora)

    expect(getAdminWindow()).toBe(abridora)
  })

  it('suelta, sin padre ni opener, no hay interlocutor', () => {
    definir('opener', null)

    expect(getAdminWindow()).toBeNull()
  })

  it('el padre manda sobre el opener', () => {
    const padre = ventana()
    definir('parent', padre)
    definir('opener', ventana())

    expect(getAdminWindow()).toBe(padre)
  })
})

describe('ThemePreview abierta en una pestaña propia (botón «Abrir»)', () => {
  it('le avisa «estoy lista» a quien la abrió, al origen que ese pidió', () => {
    const abridora = ventana()
    definir('opener', abridora)

    render(<ThemePreview />)

    expect(abridora.postMessage).toHaveBeenCalledWith(READY, ADMIN)
  })

  it('aplica el diseño que le manda quien la abrió y lo guarda para recargas', () => {
    const abridora = ventana()
    definir('opener', abridora)

    render(<ThemePreview />)
    recibir(abridora, actualizacion(DISENO))

    expect(updatePreviewConfig).toHaveBeenCalledWith(DISENO)
    expect(JSON.parse(sessionStorage.getItem('henko_theme_preview_config'))).toEqual(DISENO)
  })

  it('recibe cada cambio del diseño, no solo el primero', () => {
    const abridora = ventana()
    definir('opener', abridora)
    const otro = { ...DISENO, general: { storeName: 'Otra marca' } }

    render(<ThemePreview />)
    recibir(abridora, actualizacion(DISENO))
    recibir(abridora, actualizacion(otro))

    expect(updatePreviewConfig).toHaveBeenNthCalledWith(1, DISENO)
    expect(updatePreviewConfig).toHaveBeenNthCalledWith(2, otro)
  })

  it('descarta un diseño que viene de un origen que no es el del admin', () => {
    const abridora = ventana()
    definir('opener', abridora)

    render(<ThemePreview />)
    recibir(abridora, actualizacion(DISENO), 'https://sitio-ajeno.example.test')

    expect(updatePreviewConfig).not.toHaveBeenCalled()
  })

  it('descarta un diseño que viene de una ventana que no la abrió', () => {
    definir('opener', ventana())

    render(<ThemePreview />)
    recibir(ventana(), actualizacion(DISENO))

    expect(updatePreviewConfig).not.toHaveBeenCalled()
  })

  it('descarta mensajes que no son una actualización de diseño', () => {
    const abridora = ventana()
    definir('opener', abridora)

    render(<ThemePreview />)
    recibir(abridora, { type: 'OTRA_COSA', payload: DISENO })
    recibir(abridora, actualizacion(null))
    recibir(abridora, actualizacion('texto'))

    expect(updatePreviewConfig).not.toHaveBeenCalled()
  })

  it('si alguien la abre suelta, sin nadie que la haya abierto, no manda nada a ningún lado', () => {
    definir('opener', null)
    const espiaPropia = jest.spyOn(window, 'postMessage')

    render(<ThemePreview />)

    // Antes el saludo se mandaba a sí misma con el origen del admin y el navegador
    // rechazaba el envío con un error de origen.
    expect(espiaPropia).not.toHaveBeenCalled()
    espiaPropia.mockRestore()
  })
})

describe('ThemePreview dentro del iframe del panel (no se rompe)', () => {
  it('le avisa al padre y aplica el diseño que este manda', () => {
    const padre = ventana()
    definir('parent', padre)

    render(<ThemePreview />)
    recibir(padre, actualizacion(DISENO))

    expect(padre.postMessage).toHaveBeenCalledWith(READY, ADMIN)
    expect(updatePreviewConfig).toHaveBeenCalledWith(DISENO)
  })

  it('con el padre presente, ignora al opener', () => {
    const padre = ventana()
    const abridora = ventana()
    definir('parent', padre)
    definir('opener', abridora)

    render(<ThemePreview />)
    recibir(abridora, actualizacion(DISENO))

    expect(updatePreviewConfig).not.toHaveBeenCalled()
  })
})
