// Alta de tienda: lo que la pantalla muestra y manda.
//
// El comportamiento del identificador de tienda tiene su propio archivo
// (AdminRegister.slug.test.js). Acá: el plan que viaja desde la pantalla de planes, la
// validación, lo que se envía, y los dos estados de salida (error y tienda creada).

import { jest } from '@jest/globals'
import React from 'react'

// La pantalla lee la configuración al importarse y aborta sin esto.
process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'
process.env.REACT_APP_NODE_ENV = 'test'
process.env.REACT_APP_PUBLIC_BASE_DOMAIN = 'henkart.com.ar'
process.env.REACT_APP_ADMIN_BASE_DOMAIN = 'admin.henkart.com.ar'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

const mockCrear = jest.fn(() => () => Promise.resolve({}))

jest.unstable_mockModule('../features/auth/authSlice', () => ({
  __esModule: true,
  default: (state = {}) => state,
  createUserAdmin: mockCrear,
}))

const { default: AdminRegister } = await import('./AdminRegister')
const { Provider } = await import('react-redux')
const { configureStore } = await import('@reduxjs/toolkit')
const { MemoryRouter } = await import('react-router-dom')

const montar = ({ estado = {}, ruta = '/signup' } = {}) => {
  const store = configureStore({
    reducer: {
      user: () => ({ loading: {}, isError: false, isSuccess: false, message: '', ...estado }),
    },
  })

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[ruta]}>
        <AdminRegister />
      </MemoryRouter>
    </Provider>,
  )
}

const escribir = async (user, valores) => {
  const v = {
    nombre: 'Lucía',
    apellido: 'Pérez',
    correo: '  Lucia@Kiosco.COM ',
    celular: '03585132769',
    tienda: 'Kiosco Lucía',
    clave: 'secreta-123',
    ...valores,
  }

  await user.type(screen.getByLabelText('Nombre'), v.nombre)
  await user.type(screen.getByLabelText('Apellido'), v.apellido)
  await user.type(screen.getByLabelText('Correo'), v.correo)
  await user.type(screen.getByLabelText('Celular'), v.celular)
  await user.type(screen.getByLabelText('Nombre de la tienda'), v.tienda)
  await user.type(screen.getByLabelText('Contraseña'), v.clave)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('AdminRegister · plan elegido', () => {
  test('muestra el plan que se eligió en la pantalla de planes y deja cambiarlo', () => {
    montar({ ruta: '/signup?plan=pro' })

    const aviso = screen.getByText(/plan elegido/i).closest('p')

    expect(aviso).toHaveTextContent('Profesional')
    expect(screen.getByRole('link', { name: 'Cambiar' })).toHaveAttribute('href', '/subscripcion')
  })

  test('sin plan en la dirección, arranca con el primero que se vende', () => {
    montar()

    expect(screen.getByText(/plan elegido/i).closest('p')).toHaveTextContent('Emprendedor')
  })

  test('un plan que no existe cae al primero, no a uno inventado', () => {
    montar({ ruta: '/signup?plan=oro' })

    expect(screen.getByText(/plan elegido/i).closest('p')).toHaveTextContent('Emprendedor')
  })

  test('el plan elegido es el que se envía', async () => {
    const user = userEvent.setup()
    montar({ ruta: '/signup?plan=pro' })

    await escribir(user, {})
    await user.click(screen.getByRole('button', { name: 'Crear tienda' }))

    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(1))
    expect(mockCrear.mock.calls[0][0].plan).toBe('pro')
  })
})

describe('AdminRegister · formulario', () => {
  test('tiene un solo h1 y los campos que pide el gestor de contraseñas', () => {
    montar()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByLabelText('Correo')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('autocomplete', 'given-name')
  })

  test('no envía vacío y marca cada campo obligatorio', async () => {
    const user = userEvent.setup()
    montar()

    await user.click(screen.getByRole('button', { name: 'Crear tienda' }))

    expect(await screen.findByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('El apellido es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('El correo es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('El celular es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('El nombre de la tienda es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('La contraseña es obligatoria')).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true')
    expect(mockCrear).not.toHaveBeenCalled()
  })

  test('envía los datos normalizados', async () => {
    const user = userEvent.setup()
    montar()

    await escribir(user, {})
    await user.click(screen.getByRole('button', { name: 'Crear tienda' }))

    await waitFor(() => expect(mockCrear).toHaveBeenCalledTimes(1))
    expect(mockCrear.mock.calls[0][0]).toEqual({
      firstname: 'Lucía',
      lastname: 'Pérez',
      email: 'lucia@kiosco.com',
      mobile: '3585132769', // sin el 0 de adelante
      storeName: 'Kiosco Lucía',
      storeSlug: 'kiosco-lucia',
      plan: 'starter',
      password: 'secreta-123',
      turnstileToken: '',
    })
  })

  test('el celular se limpia a dígitos y sin 0 inicial', async () => {
    const user = userEvent.setup()
    montar()

    await user.type(screen.getByLabelText('Celular'), '0 358-513 2769')

    expect(screen.getByLabelText('Celular')).toHaveValue('3585132769')
  })

  test('un identificador reservado se rechaza antes de enviar', async () => {
    const user = userEvent.setup()
    montar()

    await escribir(user, {})
    const slug = screen.getByLabelText('Identificador de tienda')
    await user.clear(slug)
    await user.type(slug, 'admin')
    await user.click(screen.getByRole('button', { name: 'Crear tienda' }))

    expect(await screen.findByText(/ese identificador está reservado/i)).toBeInTheDocument()
    expect(mockCrear).not.toHaveBeenCalled()
  })

  test('la contraseña se puede mostrar y volver a ocultar', async () => {
    const user = userEvent.setup()
    montar()

    const clave = screen.getByLabelText('Contraseña')
    expect(clave).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(clave).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(clave).toHaveAttribute('type', 'password')
  })

  test('la vista previa dice dónde va a quedar la tienda', async () => {
    const user = userEvent.setup()
    montar()

    await user.type(screen.getByLabelText('Nombre de la tienda'), 'Kiosco Lucía')

    expect(await screen.findByText('kiosco-lucia.henkart.com.ar')).toBeInTheDocument()
    expect(screen.getByText('admin.henkart.com.ar')).toBeInTheDocument()
  })

  test('ofrece ingresar a quien ya tiene cuenta', () => {
    montar()

    expect(screen.getByRole('link', { name: 'Ingresá' })).toHaveAttribute('href', '/login')
  })
})

describe('AdminRegister · salidas', () => {
  test('un error del servidor se anuncia como alerta', () => {
    montar({ estado: { isError: true, message: 'Ese correo ya está registrado.' } })

    expect(screen.getByRole('alert')).toHaveTextContent('Ese correo ya está registrado.')
  })

  test('sin mensaje del servidor, igual explica qué pasó', () => {
    montar({ estado: { isError: true, message: '' } })

    expect(screen.getByRole('alert')).toHaveTextContent('Error creando la tienda')
  })

  test('mientras crea la tienda, el botón queda deshabilitado y lo dice', () => {
    montar({ estado: { loading: { createAdmin: true } } })

    expect(screen.getByRole('button', { name: /creando tienda/i })).toBeDisabled()
  })

  test('con la tienda creada muestra las direcciones y el acceso al panel', () => {
    montar({
      estado: {
        isSuccess: true,
        user: {
          tenant: {
            name: 'Kiosco Lucía',
            storefrontUrl: 'https://kiosco-lucia.henkart.com.ar',
            adminUrl: 'https://admin.henkart.com.ar',
          },
        },
      },
    })

    expect(screen.getByRole('heading', { level: 1, name: '¡Tienda creada!' })).toBeInTheDocument()
    expect(screen.getByText('Kiosco Lucía')).toBeInTheDocument()
    expect(screen.getByText('kiosco-lucia.henkart.com.ar')).toBeInTheDocument()
    expect(screen.getByText('admin.henkart.com.ar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /abrir panel de control/i })).toBeInTheDocument()
    // Ya no es un formulario.
    expect(screen.queryByRole('button', { name: 'Crear tienda' })).not.toBeInTheDocument()
  })
})

describe('AdminRegister · no promete lo que el producto no sostiene', () => {
  test('no anuncia prueba gratis ni plazos', () => {
    montar()

    expect(document.body.textContent).not.toMatch(/gratis|sin costo|14 días|en minutos|prueba/i)
  })
})
