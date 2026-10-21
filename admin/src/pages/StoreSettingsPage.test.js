// Configuración del comercio (StoreSettingsPage).
//
// Donde el comercio corrige su nombre, su correo de contacto (a donde llegan los avisos de venta y las
// respuestas de los clientes), su teléfono, su dirección y su marca. No tenía tests. Lo que se fija:
//
//   - qué se carga del servidor y qué se muestra;
//   - qué se manda al guardar (sin espacios, con la forma exacta que espera la API);
//   - cuándo se puede guardar y cuándo no (nombre vacío, correo mal escrito);
//   - qué se le avisa a quien configura cuando sale bien o mal.
//
// Las dos secciones de dominios (correo propio y dirección de la tienda) tienen su propia lógica y
// sus propios tests: acá son cajas mínimas.

import React from 'react'
import { jest } from '@jest/globals'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const mockFetchSettings = jest.fn(() => ({ type: 'fetchSettings' }))
const mockSaveSettings = jest.fn(args => ({ type: 'saveSettings', args }))

const estado = { tenant: {} }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/tenant/tenantSlice', () => ({
  fetchTenantSettings: mockFetchSettings,
  saveTenantSettings: mockSaveSettings,
}))

jest.unstable_mockModule('../components/emailDomain/SendingDomainSection.jsx', () => ({
  default: ({ onIdentityChange }) => (
    <div data-testid="correo-propio">
      <button onClick={() => onIdentityChange({ effectiveFromAddress: 'ventas@kiosco.com' })}>
        identidad de correo
      </button>
    </div>
  ),
}))

jest.unstable_mockModule('../components/domains/StoreDomainSection.jsx', () => ({
  default: () => <div data-testid="direccion-tienda" />,
}))

const { default: StoreSettingsPage } = await import('./StoreSettingsPage.jsx')

const DATOS = {
  name: 'Kiosco Lucía',
  settings: {
    store: {
      description: 'Kiosco de barrio',
      contactEmail: 'hola@kiosco.com',
      contactPhone: '3585132769',
      address: 'Calle 1 123',
    },
    branding: { logoUrl: 'https://kiosco.com/logo.png', faviconUrl: 'https://kiosco.com/f.ico' },
  },
}

const montar = (tenant = {}) => {
  estado.tenant = { data: DATOS, isLoading: false, isSaving: false, isError: false, ...tenant }

  return render(<StoreSettingsPage />)
}

const campo = nombre => screen.getByLabelText(nombre, { exact: false })

const guardar = () => screen.getAllByRole('button', { name: /guardar cambios|guardando/i })[0]

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
})

describe('Comercio · carga', () => {
  test('al abrir pide la configuración del comercio', () => {
    montar()

    expect(mockFetchSettings).toHaveBeenCalledTimes(1)
  })

  test('mientras carga por primera vez muestra un indicador', () => {
    montar({ data: null, isLoading: true })

    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  test('si falla la primera carga muestra el mensaje del servidor', () => {
    montar({ data: null, isError: true, message: 'Sin conexión' })

    expect(screen.getByText('Sin conexión')).toBeTruthy()
  })

  test('un error sin mensaje muestra uno genérico', () => {
    montar({ data: null, isError: true })

    expect(screen.getByText('No se pudo cargar la configuración del comercio.')).toBeTruthy()
  })

  test('sin datos todavía no muestra nada', () => {
    const { container } = montar({ data: null })

    expect(container.textContent).toBe('')
  })

  test('carga los datos guardados en el formulario', () => {
    montar()

    expect(campo('Nombre del comercio').value).toBe('Kiosco Lucía')
    expect(campo('Descripción').value).toBe('Kiosco de barrio')
    expect(campo('Correo de contacto').value).toBe('hola@kiosco.com')
    expect(campo('Teléfono').value).toBe('3585132769')
    expect(campo('Dirección').value).toBe('Calle 1 123')
    expect(campo('URL del logo').value).toBe('https://kiosco.com/logo.png')
    expect(campo('URL del favicon').value).toBe('https://kiosco.com/f.ico')
  })

  test('un comercio recién creado, sin datos opcionales, arranca con campos vacíos', () => {
    montar({ data: { name: 'Nuevo' } })

    expect(campo('Nombre del comercio').value).toBe('Nuevo')
    expect(campo('Correo de contacto').value).toBe('')
    expect(campo('URL del logo').value).toBe('')
  })

  test('muestra el contador de la descripción', () => {
    montar()

    expect(screen.getByText('16/300')).toBeTruthy()
  })

  test('incluye las secciones de correo propio y de dirección de la tienda', () => {
    montar()

    expect(screen.getByTestId('correo-propio')).toBeTruthy()
    expect(screen.getByTestId('direccion-tienda')).toBeTruthy()
  })
})

describe('Comercio · así lo ve el cliente', () => {
  test('muestra el nombre del comercio y a dónde responden los clientes', () => {
    montar()

    expect(screen.getByText(/Responder a:/).parentElement.textContent).toContain('hola@kiosco.com')
    expect(screen.getByText(/De:/).parentElement.textContent).toContain('Kiosco Lucía')
  })

  test('sin correo de contacto avisa que las respuestas se pierden', () => {
    montar({ data: { ...DATOS, settings: { ...DATOS.settings, store: {} } } })

    expect(screen.getByText(/sin definir — las respuestas se pierden/)).toBeTruthy()
  })

  test('cuando el dominio propio informa su remitente, se muestra', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'identidad de correo' }))

    expect(screen.getByText(/De:/).parentElement.textContent).toContain('ventas@kiosco.com')
  })

  test('la vista previa sigue lo que se escribe en el nombre y el correo', async () => {
    montar()

    await userEvent.clear(campo('Nombre del comercio'))
    await userEvent.type(campo('Nombre del comercio'), 'Otro Nombre')
    await userEvent.clear(campo('Correo de contacto'))
    await userEvent.type(campo('Correo de contacto'), 'nuevo@kiosco.com')

    expect(screen.getByText(/De:/).parentElement.textContent).toContain('Otro Nombre')
    expect(screen.getByText(/Responder a:/).parentElement.textContent).toContain('nuevo@kiosco.com')
  })
})

describe('Comercio · validaciones', () => {
  test('el nombre vacío se marca y bloquea el guardado', async () => {
    montar()

    await userEvent.clear(campo('Nombre del comercio'))

    expect(screen.getByText('El nombre no puede quedar vacío')).toBeTruthy()
    expect(guardar().disabled).toBe(true)
  })

  test('un nombre de solo espacios cuenta como vacío', async () => {
    montar()

    await userEvent.clear(campo('Nombre del comercio'))
    await userEvent.type(campo('Nombre del comercio'), '   ')

    expect(guardar().disabled).toBe(true)
  })

  test('un correo mal escrito se marca y bloquea el guardado', async () => {
    montar()

    await userEvent.clear(campo('Correo de contacto'))
    await userEvent.type(campo('Correo de contacto'), 'hola@')

    expect(screen.getByText('Revisá el formato del correo')).toBeTruthy()
    expect(guardar().disabled).toBe(true)
  })

  test('el correo de contacto se puede dejar vacío', async () => {
    montar()

    await userEvent.clear(campo('Correo de contacto'))

    expect(guardar().disabled).toBe(false)
  })

  test('mientras guarda el botón queda bloqueado y dice «Guardando...»', () => {
    montar({ isSaving: true })

    expect(guardar().disabled).toBe(true)
    expect(guardar().textContent).toContain('Guardando...')
  })
})

describe('Comercio · guardar', () => {
  test('manda todo con la forma que espera la API, sin espacios', async () => {
    montar()

    await userEvent.clear(campo('Nombre del comercio'))
    await userEvent.type(campo('Nombre del comercio'), '  Kiosco Nuevo  ')
    await userEvent.clear(campo('Correo de contacto'))
    await userEvent.type(campo('Correo de contacto'), ' ventas@kiosco.com ')
    await userEvent.click(guardar())

    await waitFor(() => expect(mockSaveSettings).toHaveBeenCalledTimes(1))
    expect(mockSaveSettings).toHaveBeenCalledWith({
      name: 'Kiosco Nuevo',
      settings: {
        store: {
          description: 'Kiosco de barrio',
          contactEmail: 'ventas@kiosco.com',
          contactPhone: '3585132769',
          address: 'Calle 1 123',
        },
        branding: {
          logoUrl: 'https://kiosco.com/logo.png',
          faviconUrl: 'https://kiosco.com/f.ico',
        },
      },
    })
  })

  test('un campo vaciado se manda vacío para que se borre', async () => {
    montar()

    await userEvent.clear(campo('Teléfono'))
    await userEvent.clear(campo('URL del logo'))
    await userEvent.click(guardar())

    await waitFor(() => expect(mockSaveSettings).toHaveBeenCalled())

    const enviado = mockSaveSettings.mock.calls[0][0]

    expect(enviado.settings.store.contactPhone).toBe('')
    expect(enviado.settings.branding.logoUrl).toBe('')
  })

  test('al guardar avisa que quedó guardado', async () => {
    montar()

    await userEvent.click(guardar())

    expect(await screen.findByText('Datos del comercio guardados.')).toBeTruthy()
  })

  test('si falla, avisa con el mensaje del servidor', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'saveSettings' ? Promise.reject('Correo inválido') : Promise.resolve({}),
    }))
    montar()

    await userEvent.click(guardar())

    expect(await screen.findByText('Correo inválido')).toBeTruthy()
  })

  test('si falla sin mensaje, avisa con uno genérico', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'saveSettings' ? Promise.reject('') : Promise.resolve({})),
    }))
    montar()

    await userEvent.click(guardar())

    expect(await screen.findByText('No se pudieron guardar los datos.')).toBeTruthy()
  })

  test('con el nombre vacío no manda nada aunque se fuerce el clic', async () => {
    montar()

    await userEvent.clear(campo('Nombre del comercio'))
    await act(async () => {
      guardar().click()
    })

    expect(mockSaveSettings).not.toHaveBeenCalled()
  })

  test('cuando el servidor devuelve datos nuevos, el formulario los refleja', () => {
    const { rerender } = montar()

    estado.tenant = { ...estado.tenant, data: { ...DATOS, name: 'Nombre desde el servidor' } }
    rerender(<StoreSettingsPage />)

    expect(campo('Nombre del comercio').value).toBe('Nombre desde el servidor')
  })

  test('hay un botón para guardar en un solo lugar', () => {
    montar()

    expect(within(document.body).getAllByRole('button', { name: /guardar cambios/i })).toHaveLength(
      1,
    )
  })
})
