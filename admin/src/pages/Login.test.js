// Login del panel.
//
// Se vigila lo que el rediseño no puede romper: que el formulario valide antes de enviar, que
// envíe lo que el comercio escribió, que un error de credenciales y una cuenta sin verificar se
// vean distintos (la segunda tiene salida), que la contraseña se pueda mostrar, y que al entrar
// se pida el token CSRF antes de navegar.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = jest.fn()
const mockDispatch = jest.fn()
const mockLoginUser = jest.fn(values => ({ type: 'auth/login', payload: values }))
const mockClearState = jest.fn(() => ({ type: 'auth/clear' }))
const mockSetCsrfToken = jest.fn(token => ({ type: 'auth/csrf', payload: token }))
const mockFetchCsrfToken = jest.fn()
const mockApiPost = jest.fn()
const estado = { user: null, isError: false, isSuccess: false, message: '', isNotVerified: false }

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

jest.unstable_mockModule('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: selector => selector({ user: estado }),
}))

jest.unstable_mockModule('../features/auth/authSlice.js', () => ({
  loginUser: mockLoginUser,
  clearState: mockClearState,
  setCsrfToken: mockSetCsrfToken,
}))

jest.unstable_mockModule('../utils/axiosConfig.js', () => ({
  default: { post: mockApiPost },
  fetchCsrfToken: mockFetchCsrfToken,
}))

jest.unstable_mockModule('../config/env.js', () => ({
  env: { publicBaseDomain: 'tienda.example.test' },
}))

const { default: Login } = await import('./Login.js')

const reset = () =>
  Object.assign(estado, {
    user: null,
    isError: false,
    isSuccess: false,
    message: '',
    isNotVerified: false,
  })

beforeEach(() => {
  jest.clearAllMocks()
  reset()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
  mockFetchCsrfToken.mockResolvedValue('csrf-123')
})

const campos = () => ({
  email: screen.getByLabelText('Correo electrónico'),
  password: screen.getByLabelText('Contraseña'),
})

describe('Login · formulario', () => {
  test('tiene un solo h1, el formulario y los campos correctos para el gestor de contraseñas', () => {
    render(<Login />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /ingresá a tu panel/i })).toBeInTheDocument()
    expect(campos().email).toHaveAttribute('autocomplete', 'username')
    expect(campos().password).toHaveAttribute('autocomplete', 'current-password')
  })

  test('no envía con los campos vacíos y dice qué falta', async () => {
    const user = userEvent.setup()
    render(<Login />)

    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('El correo es obligatorio')).toBeInTheDocument()
    expect(screen.getByText('La contraseña es obligatoria')).toBeInTheDocument()
    expect(campos().email).toHaveAttribute('aria-invalid', 'true')
    expect(mockLoginUser).not.toHaveBeenCalled()
  })

  test('rechaza un correo mal escrito', async () => {
    const user = userEvent.setup()
    render(<Login />)

    await user.type(campos().email, 'no-es-un-correo')
    await user.type(campos().password, 'x')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Debe ser un correo válido')).toBeInTheDocument()
    expect(mockLoginUser).not.toHaveBeenCalled()
  })

  test('envía exactamente lo que se escribió', async () => {
    const user = userEvent.setup()
    render(<Login />)

    await user.type(campos().email, 'duena@tienda.com')
    await user.type(campos().password, 'secreta-123')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() =>
      expect(mockLoginUser).toHaveBeenCalledWith({
        email: 'duena@tienda.com',
        password: 'secreta-123',
      }),
    )
  })

  test('la contraseña se puede mostrar y volver a ocultar', async () => {
    const user = userEvent.setup()
    render(<Login />)

    expect(campos().password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(campos().password).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(campos().password).toHaveAttribute('type', 'password')
  })

  test('mientras envía, el botón queda deshabilitado y lo dice', async () => {
    mockDispatch.mockImplementation(() => ({ unwrap: () => new Promise(() => {}) }))
    const user = userEvent.setup()
    render(<Login />)

    await user.type(campos().email, 'duena@tienda.com')
    await user.type(campos().password, 'secreta-123')
    await user.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByRole('button', { name: /ingresando/i })).toBeDisabled()
  })
})

describe('Login · errores y cuenta sin verificar', () => {
  test('un error de credenciales se anuncia como alerta y no ofrece reenviar el correo', () => {
    Object.assign(estado, { isError: true, message: 'Credenciales inválidas' })
    render(<Login />)

    expect(screen.getByRole('alert')).toHaveTextContent('Credenciales inválidas')
    expect(screen.queryByRole('button', { name: /reenviar/i })).not.toBeInTheDocument()
  })

  test('sin mensaje del servidor, igual explica qué pasó', () => {
    Object.assign(estado, { isError: true, message: '' })
    render(<Login />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      /credenciales inválidas o error de conexión/i,
    )
  })

  test('una cuenta sin verificar ofrece reenviar el correo, y lo hace con el correo escrito', async () => {
    Object.assign(estado, { isError: true, isNotVerified: true, message: 'Verificá tu correo.' })
    mockApiPost.mockResolvedValue({ data: { message: 'Te lo reenviamos.' } })
    const user = userEvent.setup()
    render(<Login />)

    const reenviar = screen.getByRole('button', { name: /reenviar correo de verificación/i })
    expect(reenviar).toBeDisabled() // sin correo escrito no hay a dónde mandarlo

    await user.type(campos().email, 'duena@tienda.com')
    await user.click(reenviar)

    expect(mockApiPost).toHaveBeenCalledWith('/user/resend-verification', {
      email: 'duena@tienda.com',
    })
    expect(await screen.findByText('Te lo reenviamos.')).toBeInTheDocument()
  })

  test('si el reenvío falla, lo dice', async () => {
    Object.assign(estado, { isError: true, isNotVerified: true, message: 'Verificá tu correo.' })
    mockApiPost.mockRejectedValue({ response: { data: { message: 'Demasiados intentos.' } } })
    const user = userEvent.setup()
    render(<Login />)

    await user.type(campos().email, 'duena@tienda.com')
    await user.click(screen.getByRole('button', { name: /reenviar correo de verificación/i }))

    expect(await screen.findByText('Demasiados intentos.')).toBeInTheDocument()
  })
})

describe('Login · entrada y salidas', () => {
  test('al entrar pide el token CSRF, lo guarda y recién ahí navega', async () => {
    Object.assign(estado, { isSuccess: true, user: { id: 'u1' } })
    render(<Login />)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
    expect(mockFetchCsrfToken).toHaveBeenCalledTimes(1)
    expect(mockSetCsrfToken).toHaveBeenCalledWith('csrf-123')
  })

  test('si no llega el token CSRF, igual entra', async () => {
    mockFetchCsrfToken.mockResolvedValue(null)
    Object.assign(estado, { isSuccess: true, user: { id: 'u1' } })
    render(<Login />)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
    expect(mockSetCsrfToken).not.toHaveBeenCalled()
  })

  test('al salir de la pantalla limpia el estado de error', () => {
    const { unmount } = render(<Login />)

    unmount()

    expect(mockClearState).toHaveBeenCalled()
  })

  test('ofrece recuperar la contraseña, registrarse y ver los planes', () => {
    render(<Login />)

    expect(screen.getByRole('link', { name: /olvidaste tu contraseña/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    expect(screen.getByRole('link', { name: 'Registrate' })).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('link', { name: 'Ver planes' })).toHaveAttribute(
      'href',
      '/subscripcion',
    )
  })

  test('el logo es el de Henkart y vuelve al sitio', () => {
    render(<Login />)

    const enlace = screen.getByRole('link', { name: /henkart, volver al sitio/i })
    expect(enlace.getAttribute('href')).toMatch(/^https?:\/\/tienda\.example\.test$/)
    expect(screen.getByAltText('Henkart')).toBeInTheDocument()
  })

  test('no promete nada que el producto no sostenga', () => {
    render(<Login />)

    expect(document.body.textContent).not.toMatch(/gratis|sin costo|14 días|prueba/i)
  })
})
