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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const { default: ThemeCustomizer, saveStatus } = await import('./ThemeCustomizer.js')

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

const abrir = nombre =>
  userEvent.click(screen.getByRole('button', { name: new RegExp(`^${nombre}`) }))
const dialogo = () => within(screen.getByRole('dialog'))

describe('Diseño web · secciones', () => {
  test('arranca en la lista de secciones, con la vista previa al lado', () => {
    montar()

    expect(screen.getByRole('navigation', { name: 'Secciones del diseño' })).toBeInTheDocument()
    expect(screen.queryByText(/^Editor /)).toBeNull()
    expect(screen.getByText('Vista previa en desktop')).toBeInTheDocument()
  })

  test('desde la lista se elige una sección y se muestra su editor', async () => {
    montar()

    await abrir('Tipografía')

    expect(screen.getByText('Editor Tipografía')).toBeInTheDocument()
    expect(estado.setSection).toHaveBeenLastCalledWith('typography')

    await userEvent.click(screen.getByRole('button', { name: 'Todas las secciones' }))
    expect(screen.getByRole('navigation', { name: 'Secciones del diseño' })).toBeInTheDocument()
  })

  test('un cambio en el editor se aplica a su sección', async () => {
    montar()

    await abrir('Colores')
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar Colores' }))

    expect(estado.updateSection).toHaveBeenCalledWith('colors', { prueba: true })
  })

  test('el nombre de la tienda se edita desde la lista de secciones', () => {
    montar()

    fireEvent.change(screen.getByLabelText(/^Nombre de la tienda/), {
      target: { value: 'Kiosco Lucía 2' },
    })

    expect(estado.updateField).toHaveBeenCalledWith('general.storeName', 'Kiosco Lucía 2')
  })

  test('el nombre de la tienda se puede borrar: no vuelve a aparecer «Mi Tienda»', () => {
    montar({ theme: { ...TEMA, general: { storeName: '', tagline: '' } } })

    expect(screen.getByLabelText(/^Nombre de la tienda/).value).toBe('')
  })

  test('borrar el nombre no manda un vacío (el backend lo rechaza) y lo explica', () => {
    montar()

    fireEvent.change(screen.getByLabelText(/^Nombre de la tienda/), { target: { value: '   ' } })

    expect(estado.updateField).not.toHaveBeenCalledWith('general.storeName', expect.anything())
    expect(screen.getByLabelText(/^Nombre de la tienda/).value).toBe('   ')
    expect(screen.getByText(/No puede quedar vacío/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Nombre de la tienda/), {
      target: { value: 'Kiosco Lucía' },
    })

    expect(estado.updateField).toHaveBeenCalledWith('general.storeName', 'Kiosco Lucía')
    expect(screen.queryByText(/No puede quedar vacío/)).toBeNull()
  })

  test('la vista previa cambia de tamaño', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Celular' }))

    expect(screen.getByText('Vista previa en mobile')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Celular' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('la vista amplia esconde el editor y vuelve', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Vista amplia' }))
    expect(screen.queryByRole('complementary', { name: 'Editor' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Volver al editor' }))
    expect(screen.getByRole('complementary', { name: 'Editor' })).toBeInTheDocument()
  })
})

describe('Diseño web · guardar', () => {
  test('sin cambios no deja guardar y dice que está guardado', () => {
    montar({ lastSaved: '2026-10-25T14:32:00.000Z' })

    expect(screen.getByRole('button', { name: /Guardado/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/Guardado a las/)
  })

  test('con cambios guarda y avisa', async () => {
    montar({ hasChanges: true, autoSaveEnabled: false })

    expect(screen.getByRole('status')).toHaveTextContent('Cambios sin guardar')
    await userEvent.click(screen.getByRole('button', { name: /^Guardar$/ }))

    expect(estado.save).toHaveBeenCalled()
    expect(await screen.findByText('Diseño guardado.')).toBeInTheDocument()
  })

  test('si falla dice por qué', async () => {
    montar({
      hasChanges: true,
      save: jest.fn(async () => ({ ...falla, payload: 'Sesión vencida' })),
    })

    await userEvent.click(screen.getByRole('button', { name: /^Guardar$/ }))

    expect(await screen.findByText('No se pudo guardar: Sesión vencida')).toBeInTheDocument()
  })

  test('el guardado automático se prende y apaga', async () => {
    montar()

    await userEvent.click(screen.getByRole('switch', { name: 'Guardar solo' }))

    expect(estado.toggleAutoSave).toHaveBeenCalled()
  })

  test('si el guardado automático falla, lo dice', async () => {
    montar({ hasChanges: true, autoSaveError: { message: 'Demasiados pedidos', status: 429 } })

    expect(screen.getByRole('status')).toHaveTextContent('No se pudo guardar solo')
    expect(
      await screen.findByText('No se pudo guardar solo: Demasiados pedidos'),
    ).toBeInTheDocument()
  })

  test('saveStatus pone primero lo que necesita atención', () => {
    expect(saveStatus({ isSaving: true, autoSaveError: { message: 'x' } }).label).toBe('Guardando…')
    expect(saveStatus({ hasChanges: true, autoSaveEnabled: true }).label).toBe(
      'Guardando en un momento…',
    )
    expect(saveStatus({}).label).toBe('Todo guardado')
  })
})

describe('Diseño web · confirmaciones', () => {
  test('descartar pide confirmación en un diálogo', async () => {
    montar({ hasChanges: true })

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Cancelar' }))
    expect(estado.discard).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Descartar cambios' }))
    expect(estado.discard).toHaveBeenCalled()
  })

  test('volver al diseño original pide confirmación y avisa', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Volver al diseño original' }))
    expect(estado.reset).not.toHaveBeenCalled()

    await userEvent.click(dialogo().getByRole('button', { name: 'Volver al diseño original' }))

    expect(estado.reset).toHaveBeenCalled()
    expect(await screen.findByText('La tienda volvió al diseño original.')).toBeInTheDocument()
  })

  test('mientras vuelve al diseño original el diálogo no se cierra', async () => {
    montar({ reset: jest.fn(() => new Promise(() => {})) })

    await userEvent.click(screen.getByRole('button', { name: 'Más acciones' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Volver al diseño original' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Volver al diseño original' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialogo().getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })

  test('salir sin cambios vuelve al panel directo', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Volver al panel' }))

    expect(screen.getByText('Panel de administración')).toBeInTheDocument()
  })

  test('salir con cambios sin guardar pregunta antes', async () => {
    montar({ hasChanges: true })

    await userEvent.click(screen.getByRole('button', { name: 'Volver al panel' }))
    expect(screen.queryByText('Panel de administración')).toBeNull()

    await userEvent.click(dialogo().getByRole('button', { name: 'Salir sin guardar' }))

    expect(estado.discard).toHaveBeenCalled()
    expect(screen.getByText('Panel de administración')).toBeInTheDocument()
  })
})

describe('Diseño web · carga', () => {
  test('mientras carga muestra un aviso', () => {
    montar({ theme: null, isLoading: true })

    expect(screen.getByText('Cargando el diseño de la tienda…')).toBeInTheDocument()
  })

  test('si la carga falla lo dice y deja reintentar, en vez de girar para siempre', async () => {
    montar({ theme: null, error: 'Sin conexión' })

    expect(
      screen.getByText(/No se pudo cargar el diseño de la tienda: Sin conexión/),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(estado.refresh).toHaveBeenCalled()
  })
})

describe('Diseño web · celular', () => {
  const original = window.matchMedia

  beforeEach(() => {
    window.matchMedia = query => ({
      matches: true,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  })
  afterEach(() => {
    window.matchMedia = original
  })

  test('alterna entre editar y ver la tienda', async () => {
    montar()

    expect(screen.getByRole('navigation', { name: 'Secciones del diseño' })).toBeInTheDocument()
    expect(screen.queryByText('Vista previa en desktop')).toBeNull()

    await userEvent.click(screen.getByRole('tab', { name: 'Ver tienda' }))

    expect(screen.getByText('Vista previa en desktop')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Secciones del diseño' })).toBeNull()
  })
})
