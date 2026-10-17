// Restablecer contraseña (la pantalla a la que lleva el enlace del correo).
//
// Lo que se vigila: que valide antes de enviar y mande el token del enlace con la contraseña
// nueva, que un enlace vencido deje pedir otro, que después de restablecer lleve al login
// pero sin mandar a nadie que ya se fue de la pantalla, y que no haya enlace sin token.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockReset = jest.fn()
const mockNavigate = jest.fn()
const params = { token: 'tok-123' }

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => params,
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

jest.unstable_mockModule('../features/auth/authServices.js', () => ({
  default: { resetPassword: mockReset },
}))

jest.unstable_mockModule('../config/env.js', () => ({
  env: { publicBaseDomain: 'tienda.example.test' },
}))

const { default: Resetpassword } = await import('./Resetpassword.js')

const nueva = () => screen.getByLabelText('Nueva contraseña')
const confirmar = () => screen.getByLabelText('Confirmar contraseña')

const completar = async (user, clave = 'clave-nueva-1', repetida = clave) => {
  await user.type(nueva(), clave)
  await user.type(confirmar(), repetida)
  await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
}

beforeEach(() => {
  jest.clearAllMocks()
  params.token = 'tok-123'
  mockReset.mockResolvedValue({})
})

describe('Resetpassword · formulario', () => {
  test('tiene un solo h1, los campos para el gestor de contraseñas y vuelve al login', () => {
    render(<Resetpassword />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(nueva()).toHaveAttribute('autocomplete', 'new-password')
    expect(confirmar()).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('link', { name: /volver a iniciar sesión/i })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  test('no envía vacío y dice qué falta', async () => {
    const user = userEvent.setup()
    render(<Resetpassword />)

    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))

    expect(await screen.findByText('La contraseña es obligatoria')).toBeInTheDocument()
    expect(screen.getByText('Confirmá la contraseña')).toBeInTheDocument()
    expect(mockReset).not.toHaveBeenCalled()
  })

  test('exige 8 caracteres', async () => {
    const user = userEvent.setup()
    render(<Resetpassword />)

    await completar(user, 'corta')

    expect(
      await screen.findByText('La contraseña debe tener al menos 8 caracteres'),
    ).toBeInTheDocument()
    expect(mockReset).not.toHaveBeenCalled()
  })

  test('no envía si las dos contraseñas no coinciden', async () => {
    const user = userEvent.setup()
    render(<Resetpassword />)

    await completar(user, 'clave-nueva-1', 'clave-nueva-2')

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(confirmar()).toHaveAttribute('aria-invalid', 'true')
    expect(mockReset).not.toHaveBeenCalled()
  })

  test('manda el token del enlace junto con la contraseña nueva', async () => {
    const user = userEvent.setup()
    render(<Resetpassword />)

    await completar(user)

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith({ token: 'tok-123', password: 'clave-nueva-1' }),
    )
  })

  test('las dos contraseñas se muestran y se ocultan juntas', async () => {
    const user = userEvent.setup()
    render(<Resetpassword />)

    expect(nueva()).toHaveAttribute('type', 'password')
    expect(confirmar()).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseñas' }))
    expect(nueva()).toHaveAttribute('type', 'text')
    expect(confirmar()).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Ocultar contraseñas' }))
    expect(nueva()).toHaveAttribute('type', 'password')
  })

  test('mientras guarda, el botón queda deshabilitado y lo dice', async () => {
    mockReset.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<Resetpassword />)

    await completar(user)

    expect(await screen.findByRole('button', { name: /guardando/i })).toBeDisabled()
  })
})

describe('Resetpassword · enlace vencido', () => {
  test('si el servidor lo rechaza, lo dice y deja pedir otro enlace', async () => {
    mockReset.mockRejectedValue(new Error('El enlace venció.'))
    const user = userEvent.setup()
    render(<Resetpassword />)

    await completar(user)

    const alerta = await screen.findByRole('alert')

    expect(alerta).toHaveTextContent('El enlace venció.')
    expect(screen.getByRole('link', { name: /pedir un nuevo enlace/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    // El formulario sigue ahí: se puede reintentar.
    expect(screen.getByRole('button', { name: 'Restablecer contraseña' })).toBeEnabled()
  })

  test('sin mensaje del servidor, explica que el enlace es inválido o venció', async () => {
    mockReset.mockRejectedValue({})
    const user = userEvent.setup()
    render(<Resetpassword />)

    await completar(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/inválido o expirado/i)
  })

  test('un enlace sin token no muestra el formulario y ofrece pedir otro', () => {
    params.token = undefined
    render(<Resetpassword />)

    expect(screen.getByRole('alert')).toHaveTextContent(/el enlace de recuperación no es válido/i)
    expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /pedir un nuevo enlace/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })
})

describe('Resetpassword · después de restablecer', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const restablecer = async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    const vista = render(<Resetpassword />)

    await completar(user)
    await screen.findByRole('status')

    return vista
  }

  test('avisa que quedó lista y ofrece ir al login ya mismo', async () => {
    await restablecer()

    expect(screen.getByRole('status')).toHaveTextContent(/restablecida correctamente/i)
    expect(screen.getByRole('link', { name: /ir a iniciar sesión/i })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument()
  })

  test('lleva al login a los 2,5 segundos, no antes', async () => {
    await restablecer()

    act(() => jest.advanceTimersByTime(2400))
    expect(mockNavigate).not.toHaveBeenCalled()

    act(() => jest.advanceTimersByTime(200))
    expect(mockNavigate).toHaveBeenCalledWith('/login')
  })

  test('si la persona se va antes, no la manda al login igual', async () => {
    const { unmount } = await restablecer()

    unmount()
    act(() => jest.advanceTimersByTime(5000))

    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
