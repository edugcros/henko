// Pantallas de 404 y 403.
//
// El 403 existe por un motivo concreto: PrivateRoute redirigía a /403 sin ruta registrada y caía en
// el fallback, así que un permiso denegado se veía como «página no encontrada». Si las dos pantallas
// vuelven a parecerse al punto de confundirse, esto lo atrapa: cada una dice su código y su motivo.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen } from '@testing-library/react'

jest.unstable_mockModule('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

jest.unstable_mockModule('../config/env.js', () => ({
  env: { publicBaseDomain: 'tienda.example.test' },
}))

const { default: NotFound } = await import('./NotFound.jsx')
const { default: Forbidden } = await import('./Forbidden.jsx')

describe('404 · la página no existe', () => {
  test('dice 404 y que la página no existe', () => {
    render(<NotFound />)

    expect(screen.getByText('404')).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 1, name: /no encontramos esa página/i }),
    ).toBeTruthy()
    expect(screen.getByText('La página que estás buscando no existe.')).toBeTruthy()
  })

  test('lleva de vuelta al panel', () => {
    render(<NotFound />)

    expect(screen.getByRole('link', { name: 'Volver al panel principal' })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  test('no se confunde con un permiso denegado', () => {
    render(<NotFound />)

    expect(screen.queryByText(/permisos/i)).toBeNull()
    expect(screen.queryByText('403')).toBeNull()
  })
})

describe('403 · sin permisos', () => {
  test('dice 403 y que falta el permiso, no que la página no exista', () => {
    render(<Forbidden />)

    expect(screen.getByText('403')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: /no tenés acceso/i })).toBeTruthy()
    expect(
      screen.getByText('Tu cuenta no tiene permisos para acceder a esta sección.'),
    ).toBeTruthy()
    expect(screen.queryByText(/no existe/i)).toBeNull()
  })

  test('lleva de vuelta al panel', () => {
    render(<Forbidden />)

    expect(screen.getByRole('link', { name: 'Volver al panel principal' })).toHaveAttribute(
      'href',
      '/admin',
    )
  })

  test('las dos pantallas tienen un solo h1', () => {
    const { unmount } = render(<NotFound />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    unmount()

    render(<Forbidden />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
