// Recuperar contraseña.
//
// Lo que se vigila: que valide antes de enviar, que mande el correo normalizado, que el
// mensaje de éxito NO confirme si la cuenta existe (el backend responde igual en los dos
// casos justamente para que este formulario no sirva para averiguar qué correos están
// registrados), y que un fallo se lea.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockForgot = jest.fn()

jest.unstable_mockModule('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

jest.unstable_mockModule('../features/auth/authServices.js', () => ({
  default: { forgotPassword: mockForgot },
}))

jest.unstable_mockModule('../config/env.js', () => ({
  env: { publicBaseDomain: 'tienda.example.test' },
}))

const { default: Forgotpassword } = await import('./Forgotpassword.js')

const campo = () => screen.getByLabelText('Correo electrónico')

beforeEach(() => {
  jest.clearAllMocks()
  mockForgot.mockResolvedValue({})
})

describe('Forgotpassword · formulario', () => {
  test('tiene un solo h1 y vuelve al login', () => {
    render(<Forgotpassword />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /recuperá tu contraseña/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a iniciar sesión/i })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  test('no envía vacío y dice qué falta', async () => {
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('El correo es obligatorio')).toBeInTheDocument()
    expect(campo()).toHaveAttribute('aria-invalid', 'true')
    expect(mockForgot).not.toHaveBeenCalled()
  })

  test('rechaza un correo mal escrito', async () => {
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await user.type(campo(), 'no-es-un-correo')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByText('Debe ser un correo válido')).toBeInTheDocument()
    expect(mockForgot).not.toHaveBeenCalled()
  })

  test('manda el correo sin espacios y en minúsculas', async () => {
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await user.type(campo(), 'Duena@Tienda.COM')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    await waitFor(() => expect(mockForgot).toHaveBeenCalledWith('duena@tienda.com'))
  })

  test('mientras envía, el botón queda deshabilitado y lo dice', async () => {
    mockForgot.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await user.type(campo(), 'duena@tienda.com')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))

    expect(await screen.findByRole('button', { name: /enviando/i })).toBeDisabled()
  })
})

describe('Forgotpassword · resultado', () => {
  const enviar = async user => {
    await user.type(campo(), 'duena@tienda.com')
    await user.click(screen.getByRole('button', { name: 'Enviar enlace' }))
  }

  test('el mensaje de éxito no confirma que la cuenta exista', async () => {
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await enviar(user)

    const aviso = await screen.findByRole('status')

    expect(aviso).toHaveTextContent(/si el correo existe en nuestro sistema/i)
    expect(aviso).not.toHaveTextContent(/te enviamos|enviado a|duena@tienda\.com/i)
    // El formulario se va: no se puede reenviar en bucle desde la misma pantalla.
    expect(screen.queryByRole('button', { name: 'Enviar enlace' })).not.toBeInTheDocument()
  })

  test('«Usar otro correo» vuelve al formulario', async () => {
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await enviar(user)
    await user.click(await screen.findByRole('button', { name: /usar otro correo/i }))

    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeInTheDocument()
  })

  test('si falla, lo dice como alerta y deja reintentar', async () => {
    mockForgot.mockRejectedValue(new Error('Demasiados intentos.'))
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await enviar(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos.')
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeEnabled()
  })

  test('si el error no trae mensaje, explica qué pasó', async () => {
    mockForgot.mockRejectedValue({})
    const user = userEvent.setup()
    render(<Forgotpassword />)

    await enviar(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos procesar la solicitud/i)
  })
})
