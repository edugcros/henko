// Verificación del correo del dueño del comercio (destino del enlace que llega por mail).
//
// Lo que se vigila: que el token del enlace sea lo que se manda, que un enlace sin token no pegue
// al servidor, que cada resultado se lea (listo / inválido / vencido), y sobre todo que el token
// se use UNA sola vez: es de un solo uso, y en StrictMode el efecto corre dos veces; el segundo
// intento recibiría «token inválido» sobre una verificación que en realidad salió bien.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'

const mockGet = jest.fn()
const busqueda = { valor: '?token=abc' }

jest.unstable_mockModule('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(busqueda.valor)],
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

// El alias @utils lo reescribe babel antes de que Jest vea el import: se mockea la ruta ya resuelta.
jest.unstable_mockModule('../utils/axiosConfig', () => ({
  default: { get: mockGet },
}))

jest.unstable_mockModule('../config/env.js', () => ({
  env: { publicBaseDomain: 'tienda.example.test' },
}))

const { default: VerifyEmailPage } = await import('./VerifyEmailPage.jsx')

beforeEach(() => {
  jest.clearAllMocks()
  busqueda.valor = '?token=abc'
  mockGet.mockResolvedValue({ data: { success: true, message: 'Correo verificado.' } })
})

describe('Verificar correo · el enlace', () => {
  test('manda el token del enlace, codificado, y sin pasar por el refresco de sesión', async () => {
    busqueda.valor = '?token=a%20b%2Bc'

    render(<VerifyEmailPage />)

    await screen.findByRole('heading', { level: 1, name: /correo verificado/i })

    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledWith('/user/verify-email?token=a%20b%2Bc', {
      skipAuthRefresh: true,
      skipCsrfRetry: true,
    })
  })

  test('un enlace sin token no le pega al servidor y lo dice', async () => {
    busqueda.valor = ''

    render(<VerifyEmailPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El enlace no incluye un token de verificación.',
    )
    expect(mockGet).not.toHaveBeenCalled()
  })

  test('el token es de un solo uso: en StrictMode se pide una vez, no dos', async () => {
    render(
      <React.StrictMode>
        <VerifyEmailPage />
      </React.StrictMode>,
    )

    await screen.findByRole('heading', { level: 1, name: /correo verificado/i })

    expect(mockGet).toHaveBeenCalledTimes(1)
  })
})

describe('Verificar correo · resultados', () => {
  test('mientras verifica, lo dice', async () => {
    mockGet.mockReturnValue(new Promise(() => {}))

    render(<VerifyEmailPage />)

    expect(screen.getByRole('heading', { level: 1, name: /verificando tu correo/i })).toBeTruthy()
    expect(screen.getByRole('status')).toHaveTextContent('Verificando tu correo...')
  })

  test('listo: muestra el mensaje del servidor y lleva a entrar al panel', async () => {
    render(<VerifyEmailPage />)

    await screen.findByRole('heading', { level: 1, name: /correo verificado/i })
    const aviso = screen.getByRole('status')

    expect(aviso).toHaveTextContent('Correo verificado.')
    expect(aviso).toHaveTextContent('Tu cuenta de comercio ya está activa.')
    expect(screen.getByRole('link', { name: 'Entrar al panel' })).toHaveAttribute('href', '/login')
  })

  test('listo sin mensaje del servidor, igual lo confirma', async () => {
    mockGet.mockResolvedValue({ data: { success: true } })

    render(<VerifyEmailPage />)

    await screen.findByRole('heading', { level: 1, name: /correo verificado/i })

    expect(screen.getByRole('status')).toHaveTextContent('Correo verificado correctamente.')
  })

  test('el servidor lo rechaza: muestra el motivo y ofrece volver al inicio de sesión', async () => {
    mockGet.mockRejectedValue({ response: { data: { message: 'El enlace ya se usó.' } } })

    render(<VerifyEmailPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('El enlace ya se usó.')
    expect(screen.getByRole('heading', { level: 1, name: /no pudimos verificar/i })).toBeTruthy()
    expect(screen.getByText(/si el enlace expiró, volvé a registrarte/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Ir al inicio de sesión' })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  test('sin mensaje del servidor, dice que el enlace es inválido, ya se usó o expiró', async () => {
    mockGet.mockRejectedValue({})

    render(<VerifyEmailPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El enlace es inválido, ya se usó o expiró.',
    )
  })

  test('respuesta sin success: muestra lo que dijo el servidor, no «verificado»', async () => {
    mockGet.mockResolvedValue({ data: { success: false, message: 'Token vencido.' } })

    render(<VerifyEmailPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Token vencido.')
    expect(screen.queryByRole('link', { name: 'Entrar al panel' })).toBeNull()
  })

  test('tiene un solo h1', async () => {
    render(<VerifyEmailPage />)

    await screen.findByRole('heading', { level: 1, name: /correo verificado/i })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
