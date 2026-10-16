/* eslint-env jest */
import React from 'react'
import { render, screen } from '@testing-library/react'
import PlatformLanding from '../PlatformLanding'

jest.mock('@components/Meta', () => () => null)
jest.mock('@utils/adminUrl', () => ({
  buildAdminUrl: path => 'https://admin.example.test' + path,
  SUBSCRIPTION_PATH: '/subscripcion',
}))

describe('PlatformLanding', () => {
  it('renders the hero and links to subscription plans', () => {
    render(<PlatformLanding />)

    expect(screen.getByRole('heading', { name: /tu tienda online/i })).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /ver planes|crear mi tienda|elegir un plan/i }).length,
    ).toBeGreaterThan(0)
  })

  it('renders all feature cards and their headings', () => {
    render(<PlatformLanding />)

    expect(screen.getByRole('heading', { name: /lo necesario para vender/i })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /una tienda que lleva tu marca/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /productos y stock bajo control/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /pedidos, clientes y gestión/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /configurá tus medios de pago/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /diseñá una tienda a tu estilo/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /información para decidir mejor/i }),
    ).toBeInTheDocument()
  })
})
