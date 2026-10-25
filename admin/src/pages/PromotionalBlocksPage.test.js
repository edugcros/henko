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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const {
  default: PromotionalBlocksPage,
  getBlockStatus,
  validateBlock,
} = await import('./PromotionalBlocksPage.js')

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
    expect(within(fila('Hot Sale')).getByText('Vencido')).toBeInTheDocument()
    expect(within(fila('Semana del ahorro')).getByText('En la tienda')).toBeInTheDocument()
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

    await userEvent.click(dialogo().getByRole('button', { name: 'Pausar' }))

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

const resumen = () => within(screen.getByRole('region', { name: 'Resumen de bloques' }))

describe('Bloques promocionales · lo que se ve en la tienda', () => {
  test('el resumen cuenta todos los bloques y filtra al tocarlo', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    expect(resumen().getByRole('button', { name: 'En la tienda 1' })).toBeInTheDocument()
    expect(resumen().getByRole('button', { name: 'Todos 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await userEvent.click(resumen().getByRole('button', { name: /^Vencidos/ }))

    expect(screen.getByText('Hot Sale')).toBeInTheDocument()
    expect(screen.queryByText('Semana del ahorro')).toBeNull()
  })

  test('pide todos los bloques (hasta 100) para que el resumen no cuente solo una página', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, page: 1 }))
  })

  test('un bloque fuera del inicio dice que no se muestra, y uno oculto dice que está oculto', async () => {
    mockList.mockResolvedValue({
      data: [
        { ...VIGENTE, _id: 'c1', title: 'En el carrito', placement: 'cart' },
        { ...VIGENTE, _id: 'c2', title: 'Escondido', visibility: 'hidden' },
      ],
      meta: { total: 2 },
    })
    montar()

    await screen.findByText('En el carrito')
    expect(within(fila('En el carrito')).getByText('No se muestra')).toBeInTheDocument()
    expect(within(fila('Escondido')).getByText('Oculto')).toBeInTheDocument()
  })

  test('getBlockStatus explica por qué se ve o no', () => {
    const ahora = Date.now()
    expect(getBlockStatus({ ...VIGENTE, isActive: false }, ahora)).toBe('paused')
    expect(getBlockStatus({ ...VIGENTE, placement: 'checkout' }, ahora)).toBe('nowhere')
    expect(getBlockStatus(PROGRAMADO, ahora)).toBe('scheduled')
    expect(getBlockStatus(VIGENTE, ahora)).toBe('live')
  })

  test('si falla la carga deja reintentar', async () => {
    mockList.mockRejectedValueOnce(new Error('Sin conexión'))
    montar()

    expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
    mockList.mockResolvedValue(RESPUESTA)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Semana del ahorro')).toBeInTheDocument()
  })
})

describe('Bloques promocionales · elegir productos', () => {
  test('busca en todo el catálogo, en el servidor', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    fireEvent.change(dialogo().getByLabelText('Buscar productos para agregar'), {
      target: { value: 'termo' },
    })

    await waitFor(() =>
      expect(mockAdminProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'termo', limit: 24 }),
      ),
    )
    expect(mockProducts).not.toHaveBeenCalled()
  })

  test('al editar, un producto que no está en la búsqueda se muestra con su nombre', async () => {
    mockAdminProducts.mockResolvedValue({ data: [BOTELLA] })
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Editar Semana del ahorro' }))

    expect(dialogo().getByRole('article', { name: 'Mochila urbana' })).toBeInTheDocument()
    expect(dialogo().queryByText('p1')).toBeNull()
  })

  test('con un descuento avisa que se manda un email a quienes lo tienen en favoritos', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Editar Semana del ahorro' }))

    expect(dialogo().getByText(/avisa por email a los clientes/)).toBeInTheDocument()
  })

  test('al llegar al máximo no deja agregar más', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    fireEvent.change(dialogo().getByLabelText('Máximo'), { target: { value: '1' } })
    await userEvent.click(await dialogo().findByText('Mochila urbana'))

    const botella = dialogo().getByText('Botella térmica').closest('[role="listitem"]')
    expect(botella).toBeDisabled()
    expect(within(botella).getByText('Llegaste al máximo')).toBeInTheDocument()
  })

  test('una búsqueda lenta no pisa el resultado de la más reciente', async () => {
    let soltarPrimera
    mockAdminProducts
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            soltarPrimera = () => resolve({ data: [MOCHILA] })
          }),
      )
      .mockResolvedValueOnce({ data: [BOTELLA] })
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    fireEvent.change(dialogo().getByLabelText('Buscar productos para agregar'), {
      target: { value: 'bot' },
    })
    await dialogo().findByText('Botella térmica')

    await act(async () => soltarPrimera())

    expect(dialogo().getByText('Botella térmica')).toBeInTheDocument()
    expect(dialogo().queryByText('Mochila urbana')).toBeNull()
  })
})

describe('Bloques promocionales · validación antes de mandar', () => {
  test('una descripción de más de 300 caracteres se marca y no se manda', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    fireEvent.change(campoTitulo(), { target: { value: 'Novedades' } })
    fireEvent.change(dialogo().getByLabelText('Descripción'), {
      target: { value: 'a'.repeat(301) },
    })
    await userEvent.click(dialogo().getByRole('button', { name: 'Crear bloque' }))

    expect(dialogo().getByText('Hasta 300 caracteres.')).toBeInTheDocument()
    expect(dialogo().getByText('Revisá 1 campo marcado.')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('un descuento de más de 100 se marca', async () => {
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Editar Semana del ahorro' }))
    fireEvent.change(dialogo().getByLabelText('% de descuento'), { target: { value: '150' } })
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar cambios' }))

    expect(dialogo().getByText('Entre 0 y 100.')).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('validateBlock copia los límites del backend', () => {
    const base = {
      title: 'Ofertas',
      slug: '',
      description: '',
      startDate: '2026-11-01T10:00',
      endDate: '2026-11-08T10:00',
      maxItems: 5,
      priority: 1,
      products: [],
    }
    expect(validateBlock(base)).toEqual({})
    expect(validateBlock({ ...base, title: 'x'.repeat(121) })).toHaveProperty('title')
    expect(validateBlock({ ...base, endDate: '2026-10-01T10:00' })).toHaveProperty('endDate')
    expect(validateBlock({ ...base, maxItems: 21 })).toHaveProperty('maxItems')
    expect(validateBlock({ ...base, priority: 1.5 })).toHaveProperty('priority')
    expect(
      validateBlock({
        ...base,
        products: [
          { productId: 'p1', discountPercentage: 10, priority: 1, customLabel: 'x'.repeat(81) },
        ],
      }),
    ).toHaveProperty('producto:p1:customLabel')
  })

  test('si el backend rechaza, el error queda adentro del formulario y no se pierde lo escrito', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Ya existe un bloque con esa dirección'))
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo bloque' }))
    fireEvent.change(campoTitulo(), { target: { value: 'Novedades' } })
    await userEvent.click(dialogo().getByRole('button', { name: 'Crear bloque' }))

    expect(await dialogo().findByText('Ya existe un bloque con esa dirección')).toBeInTheDocument()
    expect(campoTitulo().value).toBe('Novedades')
  })
})

describe('Bloques promocionales · confirmaciones', () => {
  test('activar un bloque con descuentos avisa del email a clientes', async () => {
    mockList.mockResolvedValue({
      data: [{ ...VIGENTE, isActive: false }],
      meta: { total: 1 },
    })
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(within(fila('Semana del ahorro')).getByRole('switch'))

    expect(dialogo().getByText(/avisa por email a los clientes/)).toBeInTheDocument()
    expect(dialogo().getByRole('button', { name: 'Activar' })).toBeInTheDocument()
  })

  test('si eliminar falla, el diálogo queda abierto con el motivo', async () => {
    mockDelete.mockRejectedValueOnce(new Error('No encontrado'))
    montar()
    await screen.findByText('Semana del ahorro')

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Hot Sale' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar definitivamente' }))

    expect(await dialogo().findByText('No encontrado')).toBeInTheDocument()
  })
})
