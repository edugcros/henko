// Bloques promocionales (PromotionalBlocksPage).
//
// Son las secciones de ofertas, destacados y novedades que se ven en la tienda. Crear o activar uno
// con descuento además avisa por email a los clientes que tienen esos productos en favoritos. No
// tenía tests. Se usa el store real con los servicios simulados, para fijar lo que viaja al backend:
//
//   - el listado y sus filtros;
//   - crear y editar, con los productos elegidos;
//   - activar, desactivar y eliminar, siempre con confirmación.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'

const mockList = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockToggle = jest.fn()
const mockDelete = jest.fn()
const mockProducts = jest.fn()
const mockAdminProducts = jest.fn()

jest.unstable_mockModule('../features/promotionalBlocks/promotionalBlocksService', () => ({
  default: {
    getPromotionalBlocks: mockList,
    getPromotionalBlock: jest.fn(),
    createPromotionalBlock: mockCreate,
    updatePromotionalBlock: mockUpdate,
    togglePromotionalBlockStatus: mockToggle,
    deletePromotionalBlock: mockDelete,
    getPublicPromotionalBlocks: jest.fn(),
    getPublicPromotionalBlockBySlug: jest.fn(),
  },
}))
jest.unstable_mockModule('../features/product/productService.js', () => ({
  default: {
    getProducts: mockProducts,
    getAdminProducts: mockAdminProducts,
  },
}))

const { default: promotionalBlocksReducer } =
  await import('../features/promotionalBlocks/promotionalBlocksSlice')
const { default: productReducer } = await import('../features/product/productSlice.js')
const { default: PromotionalBlocksPage } = await import('./PromotionalBlocksPage.js')

const dias = n => new Date(Date.now() + n * 86400000).toISOString()

const MOCHILA = { _id: 'p1', title: 'Mochila urbana', price: 39900, images: [{ url: 'm.jpg' }] }
const BOTELLA = { _id: 'p2', title: 'Botella térmica', price: 15900, images: [{ url: 'b.jpg' }] }

const VIGENTE = {
  _id: 'b1',
  title: 'Semana del ahorro',
  slug: 'semana-del-ahorro',
  type: 'weekly_offers',
  placement: 'home',
  description: 'Lo más buscado con descuento',
  maxItems: 5,
  priority: 1,
  startDate: dias(-1),
  endDate: dias(6),
  isActive: true,
  visibility: 'public',
  products: [{ productId: MOCHILA, discountPercentage: 10, priority: 1, isActive: true }],
}
const PROGRAMADO = {
  ...VIGENTE,
  _id: 'b2',
  title: 'Liquidación de invierno',
  slug: 'liquidacion',
  type: 'clearance',
  startDate: dias(3),
  endDate: dias(10),
  products: [],
}
const VENCIDO = {
  ...VIGENTE,
  _id: 'b3',
  title: 'Hot Sale',
  slug: 'hot-sale',
  type: 'seasonal_campaign',
  startDate: dias(-20),
  endDate: dias(-10),
  products: [],
}

const RESPUESTA = {
  data: [VIGENTE, PROGRAMADO, VENCIDO],
  meta: { total: 3, page: 1, pages: 1, limit: 10 },
}

const montar = () => {
  const store = configureStore({
    reducer: { promotionalBlocks: promotionalBlocksReducer, product: productReducer },
  })
  render(
    <Provider store={store}>
      <MemoryRouter>
        <PromotionalBlocksPage />
      </MemoryRouter>
    </Provider>,
  )
  return store
}

const dialogo = () => within(screen.getByRole('dialog'))
// "Título" a secas: los productos elegidos tienen su "Título personalizado".
const campoTitulo = () => dialogo().getByRole('textbox', { name: /^Título\s*\*?$/ })
const fila = titulo => screen.getByText(titulo).closest('tr')

beforeEach(() => {
  jest.clearAllMocks()
  mockList.mockResolvedValue(RESPUESTA)
  mockProducts.mockResolvedValue({ data: [MOCHILA, BOTELLA] })
  mockAdminProducts.mockResolvedValue({ data: [MOCHILA, BOTELLA], meta: { total: 2 } })
  mockCreate.mockImplementation(async data => ({ data: { _id: 'nuevo', ...data } }))
  mockUpdate.mockImplementation(async (id, data) => ({ data: { _id: id, ...data } }))
  mockToggle.mockResolvedValue({ data: {} })
  mockDelete.mockResolvedValue({ data: {} })
})

describe('Bloques promocionales · listado', () => {
  test('muestra cada bloque con su tipo, ubicación y estado', async () => {
    montar()

    expect(await screen.findByText('Semana del ahorro')).toBeInTheDocument()
    expect(within(fila('Liquidación de invierno')).getByText('Programado')).toBeInTheDocument()
    expect(within(fila('Hot Sale')).getByText('Expirado')).toBeInTheDocument()
    expect(within(fila('Semana del ahorro')).getByText('Activo')).toBeInTheDocument()
  })

  test('buscar consulta al backend con el texto', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    fireEvent.change(screen.getByLabelText('Buscar bloque'), { target: { value: 'hot' } })

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'hot' })),
    )
  })
})

describe('Bloques promocionales · crear y editar', () => {
  test('crea un bloque con el producto elegido', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    fireEvent.change(campoTitulo(), {
      target: { value: 'Novedades de octubre' },
    })
    await userEvent.click(await dialogo().findByText('Botella térmica'))
    await userEvent.click(dialogo().getByRole('button', { name: 'Crear bloque' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    const enviado = mockCreate.mock.calls[0][0]
    expect(enviado).toMatchObject({ title: 'Novedades de octubre', placement: 'home' })
    expect(enviado.products).toEqual([expect.objectContaining({ productId: 'p2' })])
  })

  test('sin título no se crea', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Crear bloque' }))

    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('editar manda los cambios al bloque correcto', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(within(fila('Semana del ahorro')).getAllByRole('button')[0])
    fireEvent.change(campoTitulo(), {
      target: { value: 'Semana del ahorro 2' },
    })
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][0]).toBe('b1')
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({
      title: 'Semana del ahorro 2',
      products: [expect.objectContaining({ productId: 'p1', discountPercentage: 10 })],
    })
  })
})

describe('Bloques promocionales · activar y eliminar', () => {
  test('desactivar pide confirmación', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(within(fila('Semana del ahorro')).getByRole('switch'))
    expect(mockToggle).not.toHaveBeenCalled()

    await userEvent.click(dialogo().getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mockToggle).toHaveBeenCalled())
    expect(mockToggle.mock.calls[0]).toEqual(['b1', false])
  })

  test('eliminar pide confirmación', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    const botones = within(fila('Hot Sale')).getAllByRole('button')
    await userEvent.click(botones[botones.length - 1])
    expect(mockDelete).not.toHaveBeenCalled()

    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar definitivamente' }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalled())
    expect(mockDelete.mock.calls[0][0]).toBe('b3')
  })
})
