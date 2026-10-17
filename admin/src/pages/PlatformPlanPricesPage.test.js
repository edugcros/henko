// Precios de los planes (pantalla del dueño de la plataforma).
//
// Acá se define lo que se muestra en la pantalla de planes, en el checkout y lo que se le cobra al
// comercio, así que lo que se vigila es lo que puede costar plata: que cada plan diga de dónde sale
// su precio y si se puede contratar, que el diálogo anticipe lo que va a pasar (sobre todo con el
// vacío y el cero, que NO son planes gratis), que lo enviado sea lo escrito y que el historial diga
// a qué plan corresponde cada cambio.

import { jest } from '@jest/globals'
import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockGetPlanPrices = jest.fn()
const mockUpdatePlanPrice = jest.fn()

jest.unstable_mockModule('../services/platformService.js', () => ({
  getPlanPrices: mockGetPlanPrices,
  updatePlanPrice: mockUpdatePlanPrice,
}))

const { default: PlatformPlanPricesPage } = await import('./PlatformPlanPricesPage.jsx')

const catalogo = (overrides = {}) => ({
  currency: 'ARS',
  plans: [
    { plan: 'starter', monthlyPriceArs: 15000, source: 'panel', currency: 'ARS' },
    { plan: 'pro', monthlyPriceArs: 42000, source: 'env', currency: 'ARS' },
  ],
  history: [],
  ...overrides,
})

const montar = async data => {
  mockGetPlanPrices.mockResolvedValue(data)
  render(<PlatformPlanPricesPage />)
  await screen.findByRole('heading', { level: 1, name: /precios de los planes/i })
}

const tarjeta = nombre => within(screen.getByLabelText(`Plan ${nombre}`))

const abrirDialogo = async nombre => {
  const user = userEvent.setup()
  await user.click(tarjeta(nombre).getByRole('button', { name: /cambiar precio/i }))
  return { user, dialogo: within(await screen.findByRole('dialog')) }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Precios de los planes · cada plan', () => {
  test('muestra el precio y de dónde sale', async () => {
    await montar(catalogo())

    expect(tarjeta('Emprendedor').getByText(/\$\s*15\.000/)).toBeInTheDocument()
    expect(tarjeta('Emprendedor').getByText('Definido acá')).toBeInTheDocument()
    expect(tarjeta('Profesional').getByText(/\$\s*42\.000/)).toBeInTheDocument()
    expect(tarjeta('Profesional').getByText('Variable de entorno')).toBeInTheDocument()
  })

  test('un plan con precio se puede contratar', async () => {
    await montar(catalogo())

    expect(tarjeta('Emprendedor').getByText('Se puede contratar')).toBeInTheDocument()
  })

  test('un plan sin configurar lo dice y avisa que no se puede contratar', async () => {
    await montar(
      catalogo({
        plans: [
          { plan: 'starter', monthlyPriceArs: null, source: 'unset' },
          { plan: 'pro', monthlyPriceArs: 42000, source: 'panel' },
        ],
      }),
    )

    const emprendedor = tarjeta('Emprendedor')

    expect(emprendedor.getAllByText('Sin configurar').length).toBeGreaterThan(0)
    expect(emprendedor.getByText('No se puede contratar')).toBeInTheDocument()
    expect(emprendedor.getByText(/nadie lo configuró todavía/i)).toBeInTheDocument()
  })

  test('un plan en cero tampoco se puede contratar: cero no es gratis', async () => {
    await montar(
      catalogo({
        plans: [
          { plan: 'starter', monthlyPriceArs: 0, source: 'panel' },
          { plan: 'pro', monthlyPriceArs: 42000, source: 'panel' },
        ],
      }),
    )

    expect(tarjeta('Emprendedor').getByText('No se puede contratar')).toBeInTheDocument()
  })

  test('no ofrece editar un plan que esta pantalla no sabe guardar', async () => {
    await montar(
      catalogo({
        plans: [
          { plan: 'starter', monthlyPriceArs: 15000, source: 'panel' },
          { plan: 'enterprise', monthlyPriceArs: 99000, source: 'panel' },
        ],
      }),
    )

    expect(screen.queryByLabelText(/plan enterprise/i)).not.toBeInTheDocument()
  })
})

describe('Precios de los planes · historial', () => {
  test('sin cambios, lo dice', async () => {
    await montar(catalogo())

    expect(screen.getByText(/todavía no se cambió ningún precio/i)).toBeInTheDocument()
  })

  test('cada cambio dice a qué plan corresponde, quién lo hizo y por qué', async () => {
    await montar(
      catalogo({
        history: [
          {
            _id: 'h1',
            setting: 'planPriceProArs',
            previousValue: 40000,
            value: 42000,
            changedByEmail: 'duena@henkart.com.ar',
            reason: 'Ajuste por inflación',
            createdAt: '2026-10-01T12:00:00.000Z',
          },
          {
            _id: 'h2',
            setting: 'planPriceStarterArs',
            previousValue: null,
            value: 15000,
            changedByEmail: 'duena@henkart.com.ar',
            reason: '',
            createdAt: '2026-09-18T12:00:00.000Z',
          },
        ],
      }),
    )

    const filas = screen.getAllByRole('row').slice(1)

    expect(within(filas[0]).getByText('Profesional')).toBeInTheDocument()
    expect(within(filas[0]).getByText(/\$\s*40\.000/)).toBeInTheDocument()
    expect(within(filas[0]).getByText(/\$\s*42\.000/)).toBeInTheDocument()
    expect(within(filas[0]).getByText('Ajuste por inflación')).toBeInTheDocument()

    expect(within(filas[1]).getByText('Emprendedor')).toBeInTheDocument()
    // «De» venía vacío: se lee «Sin configurar», no «$ 0».
    expect(within(filas[1]).getByText('Sin configurar')).toBeInTheDocument()
    // Sin motivo, una raya y no un hueco.
    expect(within(filas[1]).getByText('—')).toBeInTheDocument()
  })

  test('una clave que no conoce se muestra tal cual, sin adivinar', async () => {
    await montar(
      catalogo({
        history: [
          {
            _id: 'h3',
            setting: 'planPriceEnterpriseArs',
            previousValue: 1,
            value: 2,
            changedByEmail: 'x@y.z',
            createdAt: '2026-10-01T12:00:00.000Z',
          },
        ],
      }),
    )

    expect(screen.getByText('planPriceEnterpriseArs')).toBeInTheDocument()
  })
})

describe('Precios de los planes · cambiar un precio', () => {
  test('el diálogo arranca con el precio actual y no guarda sin un motivo', async () => {
    await montar(catalogo())

    const { dialogo } = await abrirDialogo('Emprendedor')

    expect(dialogo.getByLabelText(/precio mensual en pesos/i)).toHaveValue(15000)
    expect(dialogo.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  test('manda el plan, el precio escrito y el motivo, y la pantalla toma la respuesta', async () => {
    mockUpdatePlanPrice.mockResolvedValue(
      catalogo({
        plans: [
          { plan: 'starter', monthlyPriceArs: 52000, source: 'panel' },
          { plan: 'pro', monthlyPriceArs: 42000, source: 'env' },
        ],
      }),
    )
    await montar(catalogo())

    const { user, dialogo } = await abrirDialogo('Emprendedor')
    const campo = dialogo.getByLabelText(/precio mensual en pesos/i)

    await user.clear(campo)
    await user.type(campo, '52000')
    await user.type(dialogo.getByLabelText(/por qué se cambia/i), 'Ajuste de octubre')
    await user.click(dialogo.getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpdatePlanPrice).toHaveBeenCalledWith({
        plan: 'starter',
        priceArs: 52000,
        reason: 'Ajuste de octubre',
      }),
    )
    // El diálogo se cierra y la tarjeta muestra el precio nuevo.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(tarjeta('Emprendedor').getByText(/\$\s*52\.000/)).toBeInTheDocument()
  })

  test('el campo vacío manda null: quita el precio, no lo pone en cero', async () => {
    mockUpdatePlanPrice.mockResolvedValue(catalogo())
    await montar(catalogo())

    const { user, dialogo } = await abrirDialogo('Emprendedor')

    await user.clear(dialogo.getByLabelText(/precio mensual en pesos/i))
    await user.type(dialogo.getByLabelText(/por qué se cambia/i), 'Quitar el precio')
    await user.click(dialogo.getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpdatePlanPrice).toHaveBeenCalledWith({
        plan: 'starter',
        priceArs: null,
        reason: 'Quitar el precio',
      }),
    )
  })

  test('anticipa lo que va a pasar: precio, vacío y cero', async () => {
    await montar(catalogo())

    const { user, dialogo } = await abrirDialogo('Emprendedor')
    const campo = dialogo.getByLabelText(/precio mensual en pesos/i)

    expect(dialogo.getByText(/el plan va a costar \$\s*15\.000 por mes/i)).toBeInTheDocument()

    await user.clear(campo)
    expect(dialogo.getByText(/se quita el precio definido acá/i)).toBeInTheDocument()

    await user.type(campo, '0')
    expect(dialogo.getByText(/con 0 el plan se guarda, pero no se puede contratar/i)).toBeVisible()
  })

  test('no promete planes gratis: el cero no es gratis', async () => {
    await montar(catalogo())

    await abrirDialogo('Emprendedor')

    // Antes el diálogo decía «0 lo hace gratis», y un plan en cero ni se puede contratar.
    expect(document.body.textContent).not.toMatch(/gratis/i)
  })

  test('un precio negativo no se puede guardar y la vista previa dice qué corregir', async () => {
    await montar(catalogo())

    const { user, dialogo } = await abrirDialogo('Emprendedor')
    const campo = dialogo.getByLabelText(/precio mensual en pesos/i)

    await user.clear(campo)
    await user.type(campo, '-5')
    await user.type(dialogo.getByLabelText(/por qué se cambia/i), 'Prueba')

    expect(dialogo.getByText(/el precio tiene que ser un número de pesos/i)).toBeVisible()
    expect(dialogo.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(mockUpdatePlanPrice).not.toHaveBeenCalled()
  })

  test('si el servidor lo rechaza, lo dice y el diálogo sigue abierto', async () => {
    mockUpdatePlanPrice.mockRejectedValue({
      response: { data: { message: 'Indicá por qué se cambia el precio.' } },
    })
    await montar(catalogo())

    const { user, dialogo } = await abrirDialogo('Emprendedor')

    await user.type(dialogo.getByLabelText(/por qué se cambia/i), 'x')
    await user.click(dialogo.getByRole('button', { name: 'Guardar' }))

    expect(await dialogo.findByText('Indicá por qué se cambia el precio.')).toBeVisible()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('Cancelar cierra el diálogo sin guardar nada', async () => {
    await montar(catalogo())

    const { user, dialogo } = await abrirDialogo('Emprendedor')

    await user.click(dialogo.getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockUpdatePlanPrice).not.toHaveBeenCalled()
  })
})

describe('Precios de los planes · carga', () => {
  test('si no se pueden cargar, lo dice con el motivo y deja reintentar', async () => {
    mockGetPlanPrices.mockRejectedValueOnce({
      response: { data: { message: 'No sos dueño de la plataforma.' } },
    })
    render(<PlatformPlanPricesPage />)

    expect(await screen.findByText('No sos dueño de la plataforma.')).toBeInTheDocument()

    mockGetPlanPrices.mockResolvedValue(catalogo())
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(
      await screen.findByRole('heading', { level: 1, name: /precios de los planes/i }),
    ).toBeInTheDocument()
  })

  test('tiene un solo h1 y un encabezado por plan y por sección', async () => {
    await montar(catalogo())

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2, name: 'Emprendedor' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Profesional' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Historial' })).toBeInTheDocument()
  })
})
