// Asistente de primeros pasos (OnboardingWizard).
//
// Es lo primero que ve un comercio nuevo: cuatro pasos (tienda, apariencia, productos y pagos) para
// dejar la tienda lista para vender. No tenía tests. Lo que se fija acá:
//
//   - en qué paso arranca (el que el servidor recuerda) y con qué datos;
//   - qué valida y qué manda al servidor en cada paso, y que no avanza si guardar falla;
//   - cómo se navega: siguiente, anterior, saltear y finalizar;
//   - a dónde llevan los pasos de productos y de pagos.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const mockNavigate = jest.fn()
const mockFetchSettings = jest.fn(() => ({ type: 'fetchSettings' }))
const mockSaveSettings = jest.fn(args => ({ type: 'saveSettings', args }))
const mockAdvance = jest.fn(step => ({ type: 'advance', step }))

const estado = { tenant: {} }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.unstable_mockModule('../features/tenant/tenantSlice', () => ({
  fetchTenantSettings: mockFetchSettings,
  saveTenantSettings: mockSaveSettings,
  advanceOnboarding: mockAdvance,
}))

const { default: OnboardingWizard } = await import('./OnboardingWizard.js')

const COMERCIO = {
  name: 'Kiosco Lucía',
  onboarding: { step: 'store' },
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

const montar = (tenant = {}, data = COMERCIO) => {
  estado.tenant = { data, isLoading: false, ...tenant }

  return render(<OnboardingWizard />)
}

const campo = nombre => screen.getByLabelText(nombre, { exact: false })

const siguiente = () => screen.getByRole('button', { name: 'Siguiente' })

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
})

describe('Onboarding · arranque', () => {
  test('al abrir pide la configuración del comercio', () => {
    montar()

    expect(mockFetchSettings).toHaveBeenCalledTimes(1)
  })

  test('mientras carga muestra un indicador y no los pasos', () => {
    montar({ isLoading: true })

    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByText('Configura tu tienda')).toBeNull()
  })

  test('muestra el título y los cuatro pasos', () => {
    montar()

    expect(screen.getByText('Configura tu tienda')).toBeTruthy()

    for (const paso of ['Tu tienda', 'Apariencia', 'Productos', 'Pagos']) {
      expect(screen.getByText(paso)).toBeTruthy()
    }
  })

  test('el primer paso marca un 25 % de avance', () => {
    montar()

    const barra = screen.getAllByRole('progressbar')[0]

    expect(barra.getAttribute('aria-valuenow')).toBe('25')
  })

  test('arranca en el paso que el servidor recuerda', () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'products' } })

    expect(screen.getByText('Agrega tu primer producto')).toBeTruthy()
    expect(screen.getAllByRole('progressbar')[0].getAttribute('aria-valuenow')).toBe('75')
  })

  test('un paso desconocido arranca en el primero', () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'otro' } })

    expect(screen.getByText('Datos de tu tienda')).toBeTruthy()
  })

  test('carga los datos del comercio en el formulario', () => {
    montar()

    expect(campo('Nombre de la tienda').value).toBe('Kiosco Lucía')
    expect(campo('Descripcion').value).toBe('Kiosco de barrio')
    expect(campo('Email de contacto').value).toBe('hola@kiosco.com')
    expect(campo('Telefono de contacto').value).toBe('3585132769')
    expect(campo('Direccion').value).toBe('Calle 1 123')
  })
})

describe('Onboarding · paso «Tu tienda»', () => {
  test('un nombre de menos de 3 letras se marca y no se guarda', async () => {
    montar()

    await userEvent.clear(campo('Nombre de la tienda'))
    await userEvent.type(campo('Nombre de la tienda'), 'ab')
    await userEvent.click(siguiente())

    expect(await screen.findByText('Minimo 3 caracteres')).toBeTruthy()
    expect(mockSaveSettings).not.toHaveBeenCalled()
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  test('un nombre de solo espacios cuenta como vacío', async () => {
    montar()

    await userEvent.clear(campo('Nombre de la tienda'))
    await userEvent.type(campo('Nombre de la tienda'), '     ')
    await userEvent.click(siguiente())

    expect(await screen.findByText('Minimo 3 caracteres')).toBeTruthy()
  })

  test('un email mal escrito se marca y no se guarda', async () => {
    montar()

    await userEvent.clear(campo('Email de contacto'))
    await userEvent.type(campo('Email de contacto'), 'hola@')
    await userEvent.click(siguiente())

    expect(await screen.findByText('Email invalido')).toBeTruthy()
    expect(mockSaveSettings).not.toHaveBeenCalled()
  })

  test('el email de contacto se puede dejar vacío', async () => {
    montar()

    await userEvent.clear(campo('Email de contacto'))
    await userEvent.click(siguiente())

    await waitFor(() => expect(mockSaveSettings).toHaveBeenCalled())
  })

  test('guarda los datos de la tienda, avanza al paso siguiente y se lo avisa al servidor', async () => {
    montar()

    await userEvent.clear(campo('Nombre de la tienda'))
    await userEvent.type(campo('Nombre de la tienda'), '  Kiosco Nuevo  ')
    await userEvent.click(siguiente())

    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({
        name: 'Kiosco Nuevo',
        settings: {
          store: {
            description: 'Kiosco de barrio',
            contactEmail: 'hola@kiosco.com',
            contactPhone: '3585132769',
            address: 'Calle 1 123',
          },
        },
      }),
    )
    await waitFor(() => expect(mockAdvance).toHaveBeenCalledWith('theme'))
    expect(
      await screen.findByText(
        'Configura el logo de tu tienda. Podes cambiarlo despues desde Diseno Web.',
      ),
    ).toBeTruthy()
  })

  test('si guardar falla, no avanza', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'saveSettings' ? Promise.reject('Error') : Promise.resolve({}),
    }))
    montar()

    await userEvent.click(siguiente())

    await waitFor(() => expect(mockSaveSettings).toHaveBeenCalled())
    expect(mockAdvance).not.toHaveBeenCalled()
    expect(screen.getByText('Datos de tu tienda')).toBeTruthy()
  })

  test('«Anterior» está deshabilitado en el primer paso', () => {
    montar()

    expect(screen.getByRole('button', { name: 'Anterior' }).disabled).toBe(true)
  })
})

describe('Onboarding · paso «Apariencia»', () => {
  const enApariencia = () => montar({}, { ...COMERCIO, onboarding: { step: 'theme' } })

  test('guarda el logo y el favicon, y avanza a productos', async () => {
    enApariencia()

    await userEvent.clear(campo('URL del logo'))
    await userEvent.type(campo('URL del logo'), 'https://otro.com/logo.svg')
    await userEvent.click(siguiente())

    await waitFor(() =>
      expect(mockSaveSettings).toHaveBeenCalledWith({
        settings: {
          branding: {
            logoUrl: 'https://otro.com/logo.svg',
            faviconUrl: 'https://kiosco.com/f.ico',
          },
        },
      }),
    )
    await waitFor(() => expect(mockAdvance).toHaveBeenCalledWith('products'))
  })

  test('«Saltear» también guarda lo escrito antes de pasar al paso siguiente', async () => {
    enApariencia()

    await userEvent.click(screen.getByRole('button', { name: 'Saltear' }))

    await waitFor(() => expect(mockSaveSettings).toHaveBeenCalled())
    await waitFor(() => expect(mockAdvance).toHaveBeenCalledWith('products'))
  })

  test('muestra una vista previa del logo', () => {
    enApariencia()

    expect(screen.getByRole('img', { name: 'Logo preview' }).getAttribute('src')).toBe(
      'https://kiosco.com/logo.png',
    )
  })

  test('sin logo no hay vista previa', () => {
    montar(
      {},
      {
        ...COMERCIO,
        onboarding: { step: 'theme' },
        settings: { ...COMERCIO.settings, branding: {} },
      },
    )

    expect(screen.queryByRole('img')).toBeNull()
  })

  test('«Anterior» vuelve al paso de la tienda sin guardar nada', async () => {
    enApariencia()

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }))

    expect(screen.getByText('Datos de tu tienda')).toBeTruthy()
    expect(mockSaveSettings).not.toHaveBeenCalled()
  })
})

describe('Onboarding · productos, pagos y final', () => {
  test('el paso de productos lleva a cargar un producto', async () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'products' } })

    await userEvent.click(screen.getByRole('button', { name: 'Agregar producto' }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin/AddProduct')
  })

  test('el paso de productos se puede saltear sin guardar nada', async () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'products' } })

    await userEvent.click(screen.getByRole('button', { name: 'Saltear' }))

    expect(mockSaveSettings).not.toHaveBeenCalled()
    await waitFor(() => expect(mockAdvance).toHaveBeenCalledWith('payments'))
  })

  test('el paso de pagos lleva a la configuración de Mercado Pago', async () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'payments' } })

    await userEvent.click(screen.getByRole('button', { name: 'Configurar MercadoPago' }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin/configuracion-pagos')
  })

  test('en el último paso no hay «Siguiente» ni «Saltear», solo «Finalizar»', () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'payments' } })

    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Saltear' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Finalizar' })).toBeTruthy()
    expect(screen.getAllByRole('progressbar')[0].getAttribute('aria-valuenow')).toBe('100')
  })

  test('«Finalizar» marca el asistente como completado, lo avisa y vuelve al panel', async () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'payments' } })

    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }))

    await waitFor(() => expect(mockAdvance).toHaveBeenCalledWith('completed'))
    expect(await screen.findByText('Onboarding completado')).toBeTruthy()
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/admin'), { timeout: 3000 })
  })

  test('si finalizar falla, no avisa que se completó ni vuelve al panel', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'advance' ? Promise.reject('Error') : Promise.resolve({})),
    }))
    montar({}, { ...COMERCIO, onboarding: { step: 'payments' } })

    await userEvent.click(screen.getByRole('button', { name: 'Finalizar' }))

    await waitFor(() => expect(mockAdvance).toHaveBeenCalledWith('completed'))
    expect(screen.queryByText('Onboarding completado')).toBeNull()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('la vista previa del logo se esconde si la imagen no carga', () => {
    montar({}, { ...COMERCIO, onboarding: { step: 'theme' } })

    const logo = screen.getByRole('img', { name: 'Logo preview' })

    fireEvent.error(logo)

    expect(logo.style.display).toBe('none')
    expect(within(document.body).queryByText('Vista previa')).toBeTruthy()
  })
})
