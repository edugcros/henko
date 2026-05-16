/* eslint-env jest */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import PrivateRoute from '@components/PrivateRoute'
import { useAuth } from '@hooks/useAuth'

// 🧪 Mock dinámico del hook useAuth
jest.mock('@hooks/useAuth', () => ({
  useAuth: jest.fn(),
}))

const mockUseAuth = useAuth

// ✅ Componente simulado que solo debe renderizarse si el acceso es válido
const ComponentMock = () => <div>Acceso Autorizado</div>

describe('🔒 PrivateRoute', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('redirige a /login si no está autenticado', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      token: null,
      userRole: null,
      isBlocked: false,
      isLoading: false,
    })

    render(
      <MemoryRouter initialEntries={['/cart']}>
        <Routes>
          <Route
            path="/cart"
            element={
              <PrivateRoute>
                <ComponentMock />
              </PrivateRoute>
            }
          />
          <Route path="/login" element={<div>Página de Login</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.queryByText('Acceso Autorizado')).not.toBeInTheDocument()
    expect(screen.getByText('Página de Login')).toBeInTheDocument()
  })

  test('redirige a /unauthorized si está bloqueado', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'mock-token',
      userRole: 'user',
      isBlocked: true,
      isLoading: false,
    })

    render(
      <MemoryRouter initialEntries={['/cart']}>
        <Routes>
          <Route
            path="/cart"
            element={
              <PrivateRoute>
                <MockComponent />
              </PrivateRoute>
            }
          />
          <Route path="/unauthorized" element={<div>Acceso Denegado</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.queryByText('Acceso Autorizado')).not.toBeInTheDocument()
    expect(screen.getByText('Acceso Denegado')).toBeInTheDocument()
  })

  test('muestra contenido si está autenticado y no bloqueado', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: 'mock-token',
      userRole: 'user',
      isBlocked: false,
      isLoading: false,
    })

    render(
      <MemoryRouter initialEntries={['/cart']}>
        <Routes>
          <Route
            path="/cart"
            element={
              <PrivateRoute>
                <MockComponent />
              </PrivateRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Acceso Autorizado')).toBeInTheDocument()
  })
})
