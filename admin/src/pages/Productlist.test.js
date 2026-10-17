// Lista de productos.
//
// Esta pantalla no tenía ningún test y toca cosas que no se deshacen: borra productos de forma
// permanente y cambia precio-visibilidad-stock de lo que ve el público. Lo que se fija acá es:
//
//   - la consulta al servidor: búsqueda, filtros, orden y paginación son del servidor, y cada cambio
//     de filtro vuelve a la página 1 (si no, se pide la página 4 de un resultado de 2 páginas);
//   - las acciones rápidas, con el dato exacto que mandan (archivar oculta, el stock se trunca…);
//   - el borrado: pide confirmación y no borra si se cancela;
//   - lo que cada fila le dice al comerciante (stock bajo, sin stock, oculto, variantes).

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockNavigate = jest.fn()
const mockDispatch = jest.fn()
const mockGetAdminProducts = jest.fn(args => ({ type: 'get', args }))
const mockUpdateAProduct = jest.fn(args => ({ type: 'update', args }))
const mockDeleteProduct = jest.fn(id => ({ type: 'delete', id }))

const estado = {
  product: {},
  user: { user: { tenantId: 't1' } },
}

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/product/productSlice', () => ({
  getAdminProducts: mockGetAdminProducts,
  updateAProduct: mockUpdateAProduct,
  deleteProduct: mockDeleteProduct,
}))

const { default: Productlist } = await import('./Productlist.js')

const PRODUCTOS = [
  {
    _id: 'p1',
    title: 'Casco AGV K1',
    marca: 'AGV',
    sku: 'CASCO-K1',
    categoria: 'Cascos',
    subcategoria: 'Integrales',
    price: 150000,
    stock: 20,
    status: 'active',
    visibility: 'visible',
    images: [{ url: 'casco.jpg', isMain: true }],
  },
  {
    _id: 'p2',
    title: 'Guantes Alpinestars',
    brand: undefined,
    price: 45000,
    stock: 3,
    lowStockThreshold: 5,
    status: 'draft',
    visibility: 'hidden',
    hasVariants: true,
    variants: [{ sku: 'GUA-M' }, { sku: 'GUA-L' }],
  },
  {
    _id: 'p3',
    title: 'Botas TCX',
    marca: 'TCX',
    price: 98000,
    stock: 0,
    status: 'out-of-stock',
    visibility: 'visible',
  },
]

const STATS = {
  total: 126,
  byStatus: { active: 100, draft: 12, archived: 4 },
  lowStock: 7,
  outOfStock: 3,
}

const montar = (producto = {}, usuario = { tenantId: 't1' }) => {
  estado.product = {
    adminProducts: PRODUCTOS,
    adminMeta: { totalPages: 1 },
    adminStats: STATS,
    isAdminLoading: false,
    isAdminError: false,
    adminMessage: '',
    ...producto,
  }
  estado.user = { user: usuario }

  return render(<Productlist />)
}

const ultimaConsulta = () =>
  mockGetAdminProducts.mock.calls[mockGetAdminProducts.mock.calls.length - 1][0]

const fila = titulo => screen.getByText(titulo).closest('tr')

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
})

describe('Lista de productos · consulta al servidor', () => {
  test('al abrir pide la primera página del comercio, de a 10 y de los más nuevos', async () => {
    montar()

    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    expect(ultimaConsulta()).toEqual({
      tenantId: 't1',
      page: 1,
      limit: 10,
      q: undefined,
      status: undefined,
      visibility: undefined,
      stockFilter: undefined,
      sort: 'created-desc',
    })
  })

  test('sin comercio identificado no consulta nada', async () => {
    montar({}, { tenantId: null })

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockGetAdminProducts).not.toHaveBeenCalled()
  })

  test('el comercio puede venir como objeto poblado', async () => {
    montar({}, { tenantId: { _id: 't9' } })

    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    expect(ultimaConsulta().tenantId).toBe('t9')
  })

  test('la búsqueda espera a que se deje de escribir y vuelve a la página 1', async () => {
    montar({ adminMeta: { totalPages: 5 } })
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: /page 3|página 3/i }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(3))

    await userEvent.type(screen.getByPlaceholderText(/buscar por nombre/i), ' casco ')

    // Escribir no consulta letra por letra: espera.
    expect(mockGetAdminProducts.mock.calls.filter(([a]) => a.q).length).toBe(0)

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ q: 'casco', page: 1 }), {
      timeout: 2000,
    })
  })

  test('elegir un estado o una visibilidad filtra y vuelve a la página 1', async () => {
    montar({ adminMeta: { totalPages: 5 } })
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /page 2|página 2/i }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(2))

    await userEvent.click(screen.getByRole('combobox', { name: /estado/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Borrador' }))

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: 'draft', page: 1 }))

    await userEvent.click(screen.getByRole('combobox', { name: /visibilidad/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Ocultos' }))

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ visibility: 'hidden', page: 1 }))
  })

  test('las tarjetas de resumen son filtros: se prenden y se apagan al volver a tocarlas', async () => {
    montar()
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByText('Activos'))
    await waitFor(() => expect(ultimaConsulta().status).toBe('active'))

    await userEvent.click(screen.getByText('Activos'))
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined())

    await userEvent.click(screen.getByText('Stock Bajo'))
    await waitFor(() => expect(ultimaConsulta().stockFilter).toBe('low'))

    await userEvent.click(screen.getByText('Sin Stock'))
    await waitFor(() => expect(ultimaConsulta().stockFilter).toBe('out'))

    await userEvent.click(screen.getByText('Sin Stock'))
    await waitFor(() => expect(ultimaConsulta().stockFilter).toBeUndefined())
  })

  test('ordenar: la primera vez asciende, la segunda desciende, y otra columna arranca ascendente', async () => {
    montar()
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Producto' }))
    await waitFor(() => expect(ultimaConsulta().sort).toBe('title-asc'))

    await userEvent.click(screen.getByRole('button', { name: 'Producto' }))
    await waitFor(() => expect(ultimaConsulta().sort).toBe('title-desc'))

    await userEvent.click(screen.getByRole('button', { name: 'Precio' }))
    await waitFor(() => expect(ultimaConsulta().sort).toBe('price-asc'))

    await userEvent.click(screen.getByRole('button', { name: 'Stock' }))
    await waitFor(() => expect(ultimaConsulta().sort).toBe('stock-asc'))
  })

  test('cambiar cuántos se ven por página vuelve a la 1', async () => {
    montar({ adminMeta: { totalPages: 5 } })
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /page 3|página 3/i }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(3))

    await userEvent.click(screen.getByRole('combobox', { name: /por página/i }))
    await userEvent.click(await screen.findByRole('option', { name: '25 por página' }))

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ limit: 25, page: 1 }))
  })

  test('la paginación solo aparece con más de una página, y cambia de página', async () => {
    const { unmount } = montar({ adminMeta: { totalPages: 1 } })

    expect(screen.queryByRole('navigation')).toBeNull()
    unmount()

    montar({ adminMeta: { totalPages: 4 } })
    await userEvent.click(screen.getByRole('button', { name: /page 2|página 2/i }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
  })
})

describe('Lista de productos · lo que dice cada fila', () => {
  test('encabezado con el total de productos', () => {
    montar()

    expect(screen.getByRole('heading', { name: 'Productos' })).toBeTruthy()
    expect(screen.getByText('126 productos en catálogo')).toBeTruthy()
  })

  test('el resumen cuenta por estado y por stock', () => {
    montar()

    for (const [titulo, valor] of [
      ['Total', '126'],
      ['Activos', '100'],
      ['Borradores', '12'],
      ['Archivados', '4'],
      ['Stock Bajo', '7'],
      ['Sin Stock', '3'],
    ]) {
      const tarjeta = screen.getByRole('button', { name: new RegExp(titulo, 'i') })

      expect(within(tarjeta).getByText(valor)).toBeTruthy()
    }
  })

  test('cada producto muestra nombre, marca, SKU, categoría y precio en pesos', () => {
    montar()

    const f = within(fila('Casco AGV K1'))

    expect(f.getByText('AGV')).toBeTruthy()
    expect(f.getByText('CASCO-K1')).toBeTruthy()
    expect(f.getByText('Cascos')).toBeTruthy()
    expect(f.getByText('Integrales')).toBeTruthy()
    expect(f.getByText(/\$\s*150\.000,00/)).toBeTruthy()
  })

  test('sin marca ni SKU propio: «Sin marca» y el SKU de la primera variante', () => {
    montar()

    const f = within(fila('Guantes Alpinestars'))

    expect(f.getByText(/sin marca/i)).toBeTruthy()
    expect(f.getByText('GUA-M')).toBeTruthy()
    expect(f.getByText('Sin categoría')).toBeTruthy()
  })

  test('un producto oculto lo dice, y uno con variantes también', () => {
    montar()

    const f = within(fila('Guantes Alpinestars'))

    expect(f.getByText(/oculto/i)).toBeTruthy()
    expect(f.getByText('Variantes')).toBeTruthy()
    expect(within(fila('Casco AGV K1')).queryByText('Variantes')).toBeNull()
  })

  test('el stock se lee en palabras: disponible, bajo (según SU umbral) o sin stock', () => {
    montar()

    expect(within(fila('Casco AGV K1')).getByText('Disponible')).toBeTruthy()
    expect(within(fila('Guantes Alpinestars')).getByText('Stock bajo')).toBeTruthy()
    expect(within(fila('Botas TCX')).getAllByText('Sin stock')).toBeTruthy()
  })

  test('el umbral de stock bajo es de cada producto, con 5 por defecto', () => {
    montar({
      adminProducts: [
        { ...PRODUCTOS[0], _id: 'a', title: 'Umbral alto', stock: 8, lowStockThreshold: 10 },
        {
          ...PRODUCTOS[0],
          _id: 'b',
          title: 'Umbral por defecto',
          stock: 4,
          lowStockThreshold: undefined,
        },
        {
          ...PRODUCTOS[0],
          _id: 'c',
          title: 'Justo en el umbral',
          stock: 5,
          lowStockThreshold: undefined,
        },
      ],
    })

    expect(within(fila('Umbral alto')).getByText('Stock bajo')).toBeTruthy()
    expect(within(fila('Umbral por defecto')).getByText('Stock bajo')).toBeTruthy()
    expect(within(fila('Justo en el umbral')).getByText('Disponible')).toBeTruthy()
  })

  test('el estado del producto se lee en palabras', () => {
    montar()

    expect(within(fila('Casco AGV K1')).getByText('Activo')).toBeTruthy()
    expect(within(fila('Guantes Alpinestars')).getByText('Borrador')).toBeTruthy()
    expect(within(fila('Botas TCX')).getAllByText('Sin stock').length).toBeGreaterThan(0)
  })

  test('un estado desconocido se muestra tal cual, y sin título dice «Sin título»', () => {
    montar({
      adminProducts: [{ _id: 'x', price: 1, stock: 1, status: 'pausado' }],
    })

    expect(screen.getByText('Sin título')).toBeTruthy()
    expect(screen.getByText('pausado')).toBeTruthy()
  })

  test('sin productos en la página lo dice', () => {
    montar({ adminProducts: [] })

    expect(screen.getByText(/no se encontraron productos/i)).toBeTruthy()
  })

  test('si falla la carga, lo dice con el motivo o con uno por defecto', () => {
    const { unmount } = montar({ isAdminError: true, adminMessage: 'Sin permiso.' })

    expect(screen.getByText('Sin permiso.')).toBeTruthy()
    unmount()

    montar({ isAdminError: true, adminMessage: '' })

    expect(screen.getByText('Error al cargar productos')).toBeTruthy()
  })

  test('en la primera carga no muestra la tabla, solo una espera', () => {
    montar({ isAdminLoading: true, adminProducts: [] })

    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('Lista de productos · acciones', () => {
  const abrirMenu = async titulo => {
    await userEvent.click(within(fila(titulo)).getByRole('button', { name: /más acciones/i }))
  }

  test('«Nuevo producto» lleva al alta, y el lápiz de una fila a su edición', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: /nuevo producto/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/admin/AddProduct')

    await userEvent.click(within(fila('Casco AGV K1')).getByRole('button', { name: /editar/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/admin/edit-product/p1')
  })

  test('editar el stock manda stock y umbral como enteros no negativos', async () => {
    montar()

    await abrirMenu('Casco AGV K1')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar stock' }))

    const dialogo = within(await screen.findByRole('dialog'))
    const stock = dialogo.getByLabelText('Stock actual')
    const umbral = dialogo.getByLabelText(/alerta de stock bajo/i)

    expect(stock).toHaveValue(20)
    expect(umbral).toHaveValue(5)

    await userEvent.clear(stock)
    await userEvent.type(stock, '12.9')
    await userEvent.clear(umbral)
    await userEvent.type(umbral, '-3')
    await userEvent.click(dialogo.getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenCalledWith({
        productId: 'p1',
        data: { stock: 12, lowStockThreshold: 0 },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('un producto con variantes no edita el stock acá: manda a la edición', async () => {
    montar()

    await abrirMenu('Guantes Alpinestars')

    expect(screen.queryByRole('menuitem', { name: 'Editar stock' })).toBeNull()

    await userEvent.click(await screen.findByRole('menuitem', { name: /stock por variante/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin/edit-product/p2')
  })

  test('cambiar el estado: no ofrece el que ya tiene, y archivar también lo oculta', async () => {
    montar()

    await abrirMenu('Casco AGV K1')

    expect(screen.queryByRole('menuitem', { name: 'Marcar como activo' })).toBeNull()

    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archivar' }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenCalledWith({
        productId: 'p1',
        data: { status: 'archived', visibility: 'hidden' },
      }),
    )
  })

  test('los otros estados cambian solo el estado', async () => {
    montar()

    await abrirMenu('Guantes Alpinestars')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Marcar como activo' }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenCalledWith({
        productId: 'p2',
        data: { status: 'active' },
      }),
    )

    await abrirMenu('Casco AGV K1')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Volver a borrador' }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenLastCalledWith({
        productId: 'p1',
        data: { status: 'draft' },
      }),
    )
  })

  test('mostrar u ocultar de la tienda alterna la visibilidad', async () => {
    montar()

    await abrirMenu('Guantes Alpinestars')
    await userEvent.click(await screen.findByRole('menuitem', { name: /mostrar en tienda/i }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenCalledWith({
        productId: 'p2',
        data: { visibility: 'visible' },
      }),
    )

    await abrirMenu('Casco AGV K1')
    await userEvent.click(await screen.findByRole('menuitem', { name: /ocultar de la tienda/i }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenLastCalledWith({
        productId: 'p1',
        data: { visibility: 'hidden' },
      }),
    )
  })

  test('si la acción rápida falla, la lista sigue usable', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'update' ? Promise.reject(new Error('500')) : Promise.resolve({}),
    }))
    montar()

    await abrirMenu('Casco AGV K1')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archivar' }))

    await waitFor(() => expect(mockUpdateAProduct).toHaveBeenCalled())

    expect(within(fila('Casco AGV K1')).getByRole('button', { name: /más acciones/i })).toBeTruthy()
  })
})

describe('Lista de productos · eliminar', () => {
  const pedirEliminar = async titulo => {
    await userEvent.click(within(fila(titulo)).getByRole('button', { name: /más acciones/i }))
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /eliminar permanentemente/i }),
    )
  }

  test('pide confirmación, dice qué se borra y sugiere archivar', async () => {
    montar()

    await pedirEliminar('Casco AGV K1')

    const dialogo = within(await screen.findByRole('dialog'))

    expect(dialogo.getByText('¿Eliminar producto?')).toBeTruthy()
    expect(dialogo.getByText('Casco AGV K1')).toBeTruthy()
    expect(dialogo.getByText(/no se puede deshacer/i)).toBeTruthy()
    expect(dialogo.getByText(/archivar/i)).toBeTruthy()
    expect(mockDeleteProduct).not.toHaveBeenCalled()
  })

  test('cancelar no borra nada', async () => {
    montar()

    await pedirEliminar('Casco AGV K1')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDeleteProduct).not.toHaveBeenCalled()
  })

  test('confirmar borra el producto elegido y lo avisa', async () => {
    montar()

    await pedirEliminar('Botas TCX')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }),
    )

    await waitFor(() => expect(mockDeleteProduct).toHaveBeenCalledWith('p3'))
    expect(await screen.findByText('Producto eliminado permanentemente')).toBeTruthy()
  })

  test('si no se puede borrar, lo dice con el motivo', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'delete'
          ? Promise.reject(new Error('El producto tiene órdenes asociadas.'))
          : Promise.resolve({}),
    }))
    montar()

    await pedirEliminar('Botas TCX')
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }),
    )

    expect(await screen.findByText('El producto tiene órdenes asociadas.')).toBeTruthy()
  })
})

// ─── Rediseño: filtros que se limpian, vacíos que dicen qué hacer, accesibilidad ───

describe('Lista de productos · limpiar filtros', () => {
  test('sin filtros no hay nada que limpiar', () => {
    montar()

    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).toBeNull()
  })

  test('con un filtro puesto aparece, y lo saca todo de una vez', async () => {
    montar()
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /activos/i }))
    await userEvent.click(screen.getByRole('button', { name: /stock bajo/i }))
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ status: 'active', stockFilter: 'low' }),
    )

    await userEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({
        status: undefined,
        stockFilter: undefined,
        visibility: undefined,
        q: undefined,
        page: 1,
      }),
    )
    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).toBeNull()
  })

  test('también vacía la búsqueda, sin esperar a que se deje de escribir', async () => {
    montar()
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    const buscador = screen.getByRole('textbox', { name: /buscar productos/i })
    await userEvent.type(buscador, 'casco')
    await waitFor(() => expect(ultimaConsulta().q).toBe('casco'), { timeout: 2000 })

    await userEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    expect(buscador).toHaveValue('')
    await waitFor(() => expect(ultimaConsulta().q).toBeUndefined())
  })

  test('«Total» saca el estado y el stock, pero no toca la búsqueda', async () => {
    montar()
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /borradores/i }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('draft'))

    await userEvent.click(screen.getByRole('button', { name: /^total/i }))

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: undefined, page: 1 }))
  })
})

describe('Lista de productos · cuando no hay productos', () => {
  test('con filtros puestos explica que son los filtros y deja limpiarlos', async () => {
    montar({ adminProducts: [] })
    await userEvent.click(screen.getByRole('button', { name: /archivados/i }))

    expect(screen.getByText('No se encontraron productos con esos filtros')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /limpiar filtros/i }).length).toBeGreaterThan(0)
  })

  test('un catálogo vacío invita a crear el primer producto', async () => {
    montar({ adminProducts: [], adminStats: { total: 0, byStatus: {} } })

    expect(screen.getByText('Todavía no cargaste ningún producto')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /crear tu primer producto/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/admin/AddProduct')
  })

  test('un catálogo vacío con filtros no dice «cargá tu primer producto»', async () => {
    montar({ adminProducts: [], adminStats: { total: 0, byStatus: {} } })
    await userEvent.click(screen.getByRole('button', { name: /sin stock/i }))

    expect(screen.queryByText('Todavía no cargaste ningún producto')).toBeNull()
    expect(screen.getByText(/no se encontraron productos con esos filtros/i)).toBeTruthy()
  })
})

describe('Lista de productos · accesibilidad y detalles', () => {
  test('el resumen son botones, y el filtro vigente se anuncia como activado', async () => {
    montar()

    const activos = screen.getByRole('button', { name: /activos/i })

    expect(activos.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /^total/i }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    await userEvent.click(activos)

    expect(activos.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^total/i }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  test('la columna por la que se ordena lo anuncia, y las otras no', async () => {
    montar()
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Precio' }))

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /precio/i }).getAttribute('aria-sort')).toBe(
        'ascending',
      ),
    )
    expect(
      screen.getByRole('columnheader', { name: /stock/i }).getAttribute('aria-sort'),
    ).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Precio' }))

    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /precio/i }).getAttribute('aria-sort')).toBe(
        'descending',
      ),
    )
  })

  test('los filtros, el buscador y la cantidad por página tienen nombre', () => {
    montar()

    expect(screen.getByRole('textbox', { name: /buscar productos/i })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /estado/i })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /visibilidad/i })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /productos por página/i })).toBeTruthy()
  })

  test('la paginación se anuncia en español', () => {
    montar({ adminMeta: { totalPages: 4 } })

    expect(screen.getByRole('button', { name: 'Ir a la página 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Página 1, actual' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Última página' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /go to/i })).toBeNull()
  })

  test('un solo producto no se cuenta en plural', () => {
    montar({ adminStats: { ...STATS, total: 1 } })

    expect(screen.getByText('1 producto en catálogo')).toBeTruthy()
  })

  test('tiene un solo h1', () => {
    montar()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  test('el lápiz y el menú de cada fila se deshabilitan mientras se guarda un cambio', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'update' ? new Promise(() => {}) : Promise.resolve({})),
    }))
    montar()

    await userEvent.click(
      within(fila('Casco AGV K1')).getByRole('button', { name: /más acciones/i }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archivar' }))

    await waitFor(() =>
      expect(within(fila('Casco AGV K1')).getByRole('button', { name: /editar/i })).toBeDisabled(),
    )
    // Las demás filas siguen disponibles.
    expect(within(fila('Botas TCX')).getByRole('button', { name: /editar/i })).toBeEnabled()
  })
})

describe('Lista de productos · en el celular', () => {
  const estrecha = () => {
    window.matchMedia = query => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
  }

  afterEach(() => {
    delete window.matchMedia
  })

  test('no hay tabla: cada producto es una tarjeta, con todo a la vista', () => {
    estrecha()
    montar()

    expect(screen.queryByRole('table')).toBeNull()

    const tarjetas = screen.getAllByRole('article')

    expect(tarjetas).toHaveLength(3)

    const casco = within(tarjetas[0])

    expect(casco.getByText('Casco AGV K1')).toBeTruthy()
    expect(casco.getByText('AGV')).toBeTruthy()
    expect(casco.getByText(/\$\s*150\.000,00/)).toBeTruthy()
    expect(casco.getByText('Disponible')).toBeTruthy()
    expect(casco.getByText('Activo')).toBeTruthy()
  })

  test('el stock bajo, lo oculto y las variantes también se ven', () => {
    estrecha()
    montar()

    const guantes = within(screen.getAllByRole('article')[1])

    expect(guantes.getByText('Stock bajo')).toBeTruthy()
    expect(guantes.getByText(/oculto/i)).toBeTruthy()
    expect(guantes.getByText('Variantes')).toBeTruthy()
    expect(guantes.getByText('Borrador')).toBeTruthy()
  })

  test('editar y las acciones rápidas funcionan igual que en la tabla', async () => {
    estrecha()
    montar()

    const casco = within(screen.getAllByRole('article')[0])

    await userEvent.click(casco.getByRole('button', { name: /editar/i }))
    expect(mockNavigate).toHaveBeenCalledWith('/admin/edit-product/p1')

    await userEvent.click(casco.getByRole('button', { name: /más acciones/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archivar' }))

    await waitFor(() =>
      expect(mockUpdateAProduct).toHaveBeenCalledWith({
        productId: 'p1',
        data: { status: 'archived', visibility: 'hidden' },
      }),
    )
  })

  test('sin productos muestra el mismo aviso que en escritorio', () => {
    estrecha()
    montar({ adminProducts: [] })

    expect(screen.getByText(/no se encontraron productos/i)).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})

describe('Lista de productos · la espera de la búsqueda', () => {
  test('pasar de página apenas se abre la lista no te devuelve a la 1', async () => {
    // Al abrir, la espera de la búsqueda arrancaba igual y, al cumplirse (400 ms), volvía a la página 1
    // aunque no se hubiera buscado nada: quien cambiaba de página en esos primeros instantes rebotaba.
    montar({ adminMeta: { totalPages: 5 } })
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: /page 3|página 3/i }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(3))

    // Más que la espera de la búsqueda (400 ms).
    await new Promise(resolve => setTimeout(resolve, 800))

    expect(ultimaConsulta().page).toBe(3)
    expect(
      mockGetAdminProducts.mock.calls.some(([consulta]) => consulta.page === 1 && consulta.q),
    ).toBe(false)
  })

  test('buscar lo mismo que ya se está buscando no vuelve a la página 1', async () => {
    montar({ adminMeta: { totalPages: 5 } })
    await waitFor(() => expect(mockGetAdminProducts).toHaveBeenCalled())

    const buscador = screen.getByRole('textbox', { name: /buscar productos/i })
    await userEvent.type(buscador, 'casco')
    await waitFor(() => expect(ultimaConsulta().q).toBe('casco'), { timeout: 2000 })

    await userEvent.click(screen.getByRole('button', { name: /page 3|página 3/i }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(3))

    // Un espacio al final no cambia la búsqueda: no hay por qué volver a la 1.
    await userEvent.type(buscador, ' ')
    await new Promise(resolve => setTimeout(resolve, 800))

    expect(ultimaConsulta()).toMatchObject({ q: 'casco', page: 3 })
  })
})
