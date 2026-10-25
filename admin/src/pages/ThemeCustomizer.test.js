// Diseño web (ThemeCustomizer).
//
// Es donde el comercio cambia cómo se ve su tienda: colores, tipografía, hero, header, productos.
// Los editores de cada sección viven en features/theme/editors y tienen sus propios tests; acá se
// fija el marco que los envuelve, que no tenía ninguno:
//
//   - qué editor se muestra según la sección elegida;
//   - guardar, descartar y volver al tema por defecto, con sus confirmaciones;
//   - el guardado automático y los avisos de éxito y error.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

let estado

jest.unstable_mockModule('../hooks/useThemeConfig', () => ({
  useTheme: () => estado,
}))

const editor = nombre => props => (
  <div>
    Editor {nombre}
    <button type="button" onClick={() => props.onChange?.({ prueba: true })}>
      Cambiar {nombre}
    </button>
  </div>
)

jest.unstable_mockModule('../features/theme/editors', () => ({
  AdvancedEditor: editor('Avanzado'),
  AnimationsEditor: editor('Animaciones'),
  ColorsPanel: editor('Colores'),
  CustomButton: editor('Botones'),
  FooterEditor: editor('Footer'),
  HeaderEditor: editor('Header'),
  HeroPanel: editor('Hero'),
  LayoutEditor: editor('Layout'),
  LivePreview: ({ viewport }) => <div>Vista previa en {viewport}</div>,
  ProductsEditor: editor('Productos'),
  SpacingEditor: editor('Espaciado'),
  TypographyEditor: editor('Tipografía'),
}))

const { default: ThemeCustomizer } = await import('./ThemeCustomizer.js')

const TEMA = {
  general: { storeName: 'Kiosco Lucía', tagline: 'De todo un poco' },
  colors: { primary: '#0b6bff' },
  typography: {},
  header: {},
  footer: {},
}

const ok = { meta: { requestStatus: 'fulfilled' } }
const falla = { meta: { requestStatus: 'rejected' } }

const nuevoEstado = (extra = {}) => ({
  theme: TEMA,
  activeTheme: TEMA,
  hasChanges: false,
  isLoading: false,
  isSaving: false,
  error: null,
  autoSaveEnabled: true,
  autoSaveError: null,
  lastSaved: null,
  previewMode: false,
  toggleAutoSave: jest.fn(),
  togglePreview: jest.fn(),
  clearPreview: jest.fn(),
  clearError: jest.fn(),
  setSection: jest.fn(),
  updateField: jest.fn(),
  updateSection: jest.fn(),
  save: jest.fn(async () => ok),
  discard: jest.fn(),
  reset: jest.fn(async () => ok),
  uploadImage: jest.fn(),
  refresh: jest.fn(),
  ...extra,
})

const montar = (extra = {}) => {
  estado = nuevoEstado(extra)
  return render(
    <MemoryRouter initialEntries={['/admin/diseñoweb']}>
      <Routes>
        <Route path="/admin/diseñoweb" element={<ThemeCustomizer />} />
        <Route path="/admin" element={<div>Panel de administración</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Diseño web · secciones', () => {
  test('arranca en Colores y muestra la vista previa', () => {
    montar()

    expect(screen.getByText('Editor Colores')).toBeInTheDocument()
    expect(screen.getByText('Vista previa en desktop')).toBeInTheDocument()
  })

  test('desde la lista se elige otra sección y se muestra su editor', async () => {
    montar()

    await userEvent.click(screen.getAllByRole('button', { name: 'Volver a secciones' })[0])
    await userEvent.click(screen.getByText('Tipografía'))

    expect(screen.getByText('Editor Tipografía')).toBeInTheDocument()
    expect(estado.setSection).toHaveBeenLastCalledWith('typography')
  })

  test('un cambio en el editor se aplica a su sección', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar Colores' }))

    expect(estado.updateSection).toHaveBeenCalledWith('colors', { prueba: true })
  })

  test('el nombre de la tienda se edita desde la lista de secciones', async () => {
    montar()

    await userEvent.click(screen.getAllByRole('button', { name: 'Volver a secciones' })[0])
    fireEvent.change(screen.getByLabelText('Nombre de la tienda'), {
      target: { value: 'Kiosco Lucía 2' },
    })

    expect(estado.updateField).toHaveBeenCalledWith('general.storeName', 'Kiosco Lucía 2')
  })

  test('la vista previa cambia de tamaño', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }))

    expect(screen.getByText('Vista previa en mobile')).toBeInTheDocument()
  })
})

describe('Diseño web · guardar', () => {
  test('sin cambios no deja guardar', () => {
    montar()

    expect(screen.getByRole('button', { name: /Actualizado/ })).toBeDisabled()
  })

  test('con cambios guarda y avisa', async () => {
    montar({ hasChanges: true })

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    expect(estado.save).toHaveBeenCalled()
    expect(await screen.findByText('Tema guardado correctamente.')).toBeInTheDocument()
  })

  test('si falla muestra el error', async () => {
    montar({ hasChanges: true, save: jest.fn(async () => falla), error: 'Sesión vencida' })

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    expect(await screen.findByText('Sesión vencida')).toBeInTheDocument()
  })

  test('el guardado automático se prende y apaga', async () => {
    montar()

    await userEvent.click(screen.getByRole('switch'))

    expect(estado.toggleAutoSave).toHaveBeenCalled()
  })
})

describe('Diseño web · descartar y volver al tema por defecto', () => {
  test('descartar pide confirmación', async () => {
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false)
    montar({ hasChanges: true })

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(estado.discard).not.toHaveBeenCalled()

    confirmar.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(estado.discard).toHaveBeenCalled()
    confirmar.mockRestore()
  })

  test('volver al tema por defecto pide confirmación', async () => {
    const confirmar = jest.spyOn(window, 'confirm').mockReturnValue(false)
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Resetear tema' }))
    expect(estado.reset).not.toHaveBeenCalled()

    confirmar.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Resetear tema' }))
    await waitFor(() => expect(estado.reset).toHaveBeenCalled())
    confirmar.mockRestore()
  })
})

describe('Diseño web · carga', () => {
  test('mientras carga muestra un aviso', () => {
    montar({ theme: null, isLoading: true })

    expect(screen.getByText('Cargando configuración del tema...')).toBeInTheDocument()
  })
})
