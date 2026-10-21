// Pedidos (AdminOrdersPage).
//
// Esta pantalla tenía más de 2.300 líneas y ningún test, y es donde el comerciante cobra, despacha,
// cancela, reembolsa y borra. Lo que se fija acá es:
//
//   1. Las funciones puras: cómo se lee el cliente, el email, los montos y los estados de una orden,
//      qué órdenes están protegidas contra el borrado y cómo sale el CSV.
//   2. La consulta al servidor: búsqueda, filtros y paginación son del servidor y cada cambio de
//      filtro vuelve a la página 1.
//   3. Las acciones sobre un pedido, con el dato exacto que mandan: cambiar pago y logística, guardar
//      el envío, cancelar, reembolsar y borrar (con su segunda confirmación para las protegidas).
//   4. Lo que la pantalla le cuenta al comerciante: resumen, estados, errores, vacío y carga.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const thunk = tipo => jest.fn(args => ({ type: tipo, args }))
const mockGetOrders = thunk('getOrders')
const mockUpdateStatus = thunk('updateStatus')
const mockUpdatePayment = thunk('updatePayment')
const mockUpdateFulfillment = thunk('updateFulfillment')
const mockCancel = thunk('cancel')
const mockRefund = thunk('refund')
const mockDelete = thunk('delete')
const mockUpdateShipment = thunk('updateShipment')

const estado = { order: {} }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/order/orderSlice', () => ({
  getOrdersThunk: mockGetOrders,
  updateOrderStatusThunk: mockUpdateStatus,
  updateOrderPaymentStatusThunk: mockUpdatePayment,
  updateOrderFulfillmentStatusThunk: mockUpdateFulfillment,
  cancelOrderThunk: mockCancel,
  refundOrderThunk: mockRefund,
  deleteOrderThunk: mockDelete,
  updateOrderShipmentThunk: mockUpdateShipment,
}))

const {
  default: AdminOrdersPage,
  normalizeValue,
  resolveMoneyAmount,
  formatCurrency,
  formatDateShort,
  normalizeOrderStatusForUI,
  normalizeOrderStatusForLegacyApi,
  buildApiFilters,
  getOrderDisplayId,
  getOrderCustomerName,
  getOrderCustomerEmail,
  getOrderCustomerPhone,
  getProductImageUrl,
  getLineImageUrl,
  getLineTitle,
  getLineSku,
  getLineQuantity,
  isOrderProtectedFromDelete,
  escapeCsv,
  buildOrdersCsv,
} = await import('./AdminOrdersPage.js')

const ORDEN_ABIERTA = {
  _id: 'o1aaaaaa0001',
  orderNumber: 'A-1001',
  createdAt: '2026-10-10T12:00:00.000Z',
  shippingAddress: {
    email: 'ana@mail.com',
    firstName: 'Ana',
    lastName: 'Pérez',
    address: 'Calle Falsa 123',
    city: 'Córdoba',
    zipCode: '5000',
    country: 'AR',
  },
  totals: { subtotal: 1500, discount: 0, total: 1500 },
  orderStatus: 'open',
  paymentStatus: 'pending',
  fulfillmentStatus: 'unfulfilled',
  products: [{ title: 'Casco AGV K1', sku: 'CASCO-K1', count: 1, price: 1500, subtotal: 1500 }],
}

const ORDEN_CARA = {
  _id: 'o2aaaaaa0002',
  orderNumber: 'A-1002',
  createdAt: '2026-10-11T12:00:00.000Z',
  shippingAddress: { email: 'beto@mail.com', firstName: 'Beto', lastName: 'Gómez' },
  totals: { subtotal: 250000, discount: 0, total: 250000 },
  orderStatus: 'open',
  paymentStatus: 'pending',
  fulfillmentStatus: 'unfulfilled',
  products: [
    { title: 'Campera Dainese', count: 1, price: 200000, subtotal: 200000 },
    { title: 'Guantes', count: 2, price: 25000, subtotal: 50000 },
  ],
}

const ORDEN_PAGADA = {
  _id: 'o3aaaaaa0003',
  orderNumber: 'A-1003',
  createdAt: '2026-10-12T12:00:00.000Z',
  shippingAddress: { email: 'cami@mail.com', firstName: 'Cami', lastName: 'Ruiz' },
  totals: { subtotal: 80000, discount: 0, total: 80000 },
  orderStatus: 'processing',
  paymentStatus: 'approved',
  fulfillmentStatus: 'preparing',
  products: [{ title: 'Botas TCX', count: 1, price: 80000, subtotal: 80000 }],
}

const ORDENES = [ORDEN_ABIERTA, ORDEN_CARA, ORDEN_PAGADA]

const montar = ({ ordenes = ORDENES, resumen, paginacion, ...resto } = {}) => {
  estado.order = {
    list: {
      data: {
        data: ordenes,
        pagination: paginacion || { total: ordenes.length, page: 1, pages: 1, limit: 10 },
        ...(resumen ? { summary: resumen } : {}),
      },
    },
    isLoading: false,
    isError: false,
    message: '',
    isUpdating: false,
    ...resto,
  }

  return render(<AdminOrdersPage />)
}

const ultimaConsulta = () => mockGetOrders.mock.calls[mockGetOrders.mock.calls.length - 1][0]
const fila = numero => screen.getByText(`#${numero}`).closest('tr')

const botonDeFila = (numero, nombre) => within(fila(numero)).getByRole('button', { name: nombre })

const comboPago = () => within(panel()).getByRole('combobox', { name: /estado del pago/i })
const comboLogistica = () => within(panel()).getByRole('combobox', { name: /estado logístico/i })

const abrirOrden = async numero => {
  await userEvent.click(screen.getByText(`#${numero}`))
}

const panel = () => screen.getByText('Panel de Control').parentElement

const elegir = async (combo, opcion) => {
  await userEvent.click(combo)
  await userEvent.click(await screen.findByRole('option', { name: opcion }))
}

beforeAll(() => {
  URL.createObjectURL = jest.fn(() => 'blob:orders')
  URL.revokeObjectURL = jest.fn()
  HTMLAnchorElement.prototype.click = jest.fn()
})

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
})

describe('Pedidos · lectura de una orden', () => {
  test('normalizeValue entiende los números de MongoDB y descarta lo que no es número', () => {
    expect(normalizeValue({ $numberDecimal: '12.5' })).toBe(12.5)
    expect(normalizeValue({ $numberInt: '3' })).toBe(3)
    expect(normalizeValue({ $numberLong: '9' })).toBe(9)
    expect(normalizeValue('7')).toBe(7)
    expect(normalizeValue(null)).toBe(0)
    expect(normalizeValue(undefined)).toBe(0)
    expect(normalizeValue('abc')).toBe(0)
    expect(normalizeValue(Infinity)).toBe(0)
  })

  test('resolveMoneyAmount prefiere el monto decimal y si no, usa los centavos', () => {
    expect(resolveMoneyAmount(20, 5000)).toBe(20)
    expect(resolveMoneyAmount(0, 1550)).toBe(15.5)
    expect(resolveMoneyAmount(undefined, 250)).toBe(2.5)
    expect(resolveMoneyAmount({ $numberDecimal: '3' }, 900)).toBe(3)
    expect(resolveMoneyAmount(0, 0)).toBe(0)
    expect(resolveMoneyAmount(null, undefined)).toBe(0)
  })

  test('formatCurrency usa pesos argentinos con dos decimales', () => {
    expect(formatCurrency(1234.5)).toMatch(/\$\s?1\.234,50/)
    expect(formatCurrency(null)).toMatch(/\$\s?0,00/)
    expect(formatCurrency({ $numberDecimal: '10' })).toMatch(/\$\s?10,00/)
  })

  test('formatDateShort da día/mes/año corto o un guion', () => {
    expect(formatDateShort('2026-10-10T12:00:00.000Z')).toBe('10/10/26')
    expect(formatDateShort(null)).toBe('-')
    expect(formatDateShort('no es fecha')).toBe('-')
  })

  test('getOrderDisplayId usa el número de pedido, si no el final del id, si no «SIN-ID»', () => {
    expect(getOrderDisplayId({ orderNumber: 'A-9', _id: 'abcdef123456' })).toBe('A-9')
    expect(getOrderDisplayId({ _id: 'abcdef123456' })).toBe('CDEF123456'.slice(-8))
    expect(getOrderDisplayId({})).toBe('SIN-ID')
    expect(getOrderDisplayId(null)).toBe('SIN-ID')
  })

  test('getOrderCustomerName busca en el usuario, en la copia del cliente y en la dirección', () => {
    expect(
      getOrderCustomerName({ orderby: { firstName: 'Ana', lastName: 'Paz' }, shippingAddress: {} }),
    ).toBe('Ana Paz')
    expect(getOrderCustomerName({ customerSnapshot: { firstname: 'Beto', lastname: 'Gil' } })).toBe(
      'Beto Gil',
    )
    expect(getOrderCustomerName({ shippingAddress: { firstName: 'Cami', lastName: 'Ruiz' } })).toBe(
      'Cami Ruiz',
    )
    expect(getOrderCustomerName({ shippingAddress: { firstName: 'Solo' } })).toBe('Solo')
    expect(getOrderCustomerName({})).toBe('')
  })

  test('getOrderCustomerEmail sigue el mismo orden que el backend para los emails', () => {
    const orden = {
      shippingAddress: { email: 'envio@x.com' },
      customerSnapshot: { email: 'copia@x.com' },
      paymentIntent: { payerEmail: 'pago@x.com' },
      orderby: { email: 'usuario@x.com' },
    }

    expect(getOrderCustomerEmail(orden)).toBe('envio@x.com')
    expect(getOrderCustomerEmail({ ...orden, shippingAddress: {} })).toBe('copia@x.com')
    expect(getOrderCustomerEmail({ ...orden, shippingAddress: {}, customerSnapshot: {} })).toBe(
      'pago@x.com',
    )
    expect(getOrderCustomerEmail({ orderby: { email: 'usuario@x.com' } })).toBe('usuario@x.com')
    expect(getOrderCustomerEmail({})).toBe('Sin email')
  })

  test('getOrderCustomerPhone busca el teléfono en varios lugares', () => {
    expect(getOrderCustomerPhone({ orderby: { phone: '1' } })).toBe('1')
    expect(getOrderCustomerPhone({ orderby: { mobile: '2' } })).toBe('2')
    expect(getOrderCustomerPhone({ customerSnapshot: { mobile: '3' } })).toBe('3')
    expect(getOrderCustomerPhone({ shippingAddress: { phone: '4' } })).toBe('4')
    expect(getOrderCustomerPhone({})).toBe('')
  })

  test('las imágenes de cada línea salen de la copia, de la línea o del producto', () => {
    expect(getProductImageUrl(null)).toBeNull()
    expect(getProductImageUrl({ image: { url: 'a.jpg' } })).toBe('a.jpg')
    expect(getProductImageUrl({ image: 'b.jpg' })).toBe('b.jpg')
    expect(getProductImageUrl({ images: 'c.jpg' })).toBe('c.jpg')
    expect(
      getProductImageUrl({ images: [{ url: 'x.jpg' }, { url: 'principal.jpg', isMain: true }] }),
    ).toBe('principal.jpg')
    expect(getProductImageUrl({ images: ['solo.jpg'] })).toBe('solo.jpg')

    expect(
      getLineImageUrl({
        imageSnapshot: 'copia.jpg',
        image: 'linea.jpg',
        product: { image: 'p.jpg' },
      }),
    ).toBe('copia.jpg')
    expect(getLineImageUrl({ image: 'linea.jpg', product: { image: 'p.jpg' } })).toBe('linea.jpg')
    expect(getLineImageUrl({ product: { image: 'p.jpg' } })).toBe('p.jpg')
    expect(getLineImageUrl({})).toBeNull()
  })

  test('título, SKU y cantidad de una línea tienen alternativas', () => {
    expect(getLineTitle({ product: { title: 'Del producto' }, title: 'De la línea' })).toBe(
      'Del producto',
    )
    expect(getLineTitle({ titleSnapshot: 'Copia' })).toBe('Copia')
    expect(getLineTitle({})).toBe('Producto sin título')

    expect(getLineSku({ product: { sku: 'P' } })).toBe('P')
    expect(getLineSku({ variantSku: 'V' })).toBe('V')
    expect(getLineSku({})).toBeNull()

    expect(getLineQuantity({ count: 3 })).toBe(3)
    expect(getLineQuantity({ quantity: 2 })).toBe(2)
    expect(getLineQuantity({ count: -1 })).toBe(0)
    expect(getLineQuantity({})).toBe(0)
  })
})

describe('Pedidos · estados', () => {
  test('los estados viejos se traducen a los de la pantalla', () => {
    expect(normalizeOrderStatusForUI('payment_pending')).toBe('open')
    expect(normalizeOrderStatusForUI('not_processed')).toBe('open')
    expect(normalizeOrderStatusForUI('dispatched')).toBe('shipped')
    expect(normalizeOrderStatusForUI(' Delivered ')).toBe('delivered')
    expect(normalizeOrderStatusForUI('cancelled')).toBe('cancelled')
    expect(normalizeOrderStatusForUI('algo raro')).toBe('open')
    expect(normalizeOrderStatusForUI('')).toBe('open')
  })

  test('hacia el servidor viejo solo viajan los estados conocidos', () => {
    expect(normalizeOrderStatusForLegacyApi('cancelled')).toBe('cancelled')
    expect(normalizeOrderStatusForLegacyApi('Refunded')).toBe('refunded')
    expect(normalizeOrderStatusForLegacyApi('bogus')).toBe('open')
  })

  test('buildApiFilters limpia el estado y recorta la búsqueda a 100 caracteres', () => {
    const filtros = buildApiFilters({
      page: 2,
      limit: 10,
      status: ' Shipped ',
      paymentStatus: 'approved',
      q: `  ${'a'.repeat(150)}  `,
    })

    expect(filtros).toMatchObject({
      page: 2,
      limit: 10,
      status: 'shipped',
      paymentStatus: 'approved',
    })
    expect(filtros.q).toHaveLength(100)
  })

  test('una orden con pago aprobado, entregada o reembolsada está protegida contra el borrado', () => {
    expect(isOrderProtectedFromDelete({ paymentStatus: 'approved' })).toBe(true)
    expect(isOrderProtectedFromDelete({ orderStatus: 'delivered' })).toBe(true)
    expect(isOrderProtectedFromDelete({ orderStatus: 'refunded' })).toBe(true)
    expect(isOrderProtectedFromDelete({ fulfillmentStatus: 'delivered' })).toBe(true)
    expect(isOrderProtectedFromDelete({ paymentStatus: 'pending', orderStatus: 'open' })).toBe(
      false,
    )
    expect(
      isOrderProtectedFromDelete({ paymentStatus: 'rejected', orderStatus: 'cancelled' }),
    ).toBe(false)
    expect(isOrderProtectedFromDelete({})).toBe(false)
  })
})

describe('Pedidos · exportación a CSV', () => {
  test('escapeCsv encierra el valor entre comillas y duplica las comillas internas', () => {
    expect(escapeCsv('hola')).toBe('"hola"')
    expect(escapeCsv('dijo "hola"')).toBe('"dijo ""hola"""')
    expect(escapeCsv(null)).toBe('""')
    expect(escapeCsv(0)).toBe('"0"')
  })

  test('buildOrdersCsv arma el encabezado y una fila por orden', () => {
    const csv = buildOrdersCsv([ORDEN_ABIERTA])
    const [encabezado, fila1] = csv.split('\n')

    expect(encabezado).toBe(
      '"Pedido","Fecha","Cliente","Email","Total","Estado orden","Estado pago","Estado logística","Items"',
    )
    expect(fila1).toBe(
      '"A-1001","10/10/26","Ana Pérez","ana@mail.com","1500.00","open","pending","unfulfilled","1"',
    )
    expect(buildOrdersCsv([])).toBe(encabezado)
  })
})

describe('Pedidos · consulta al servidor', () => {
  test('al abrir pide la primera página, de a 10 y de las más nuevas', async () => {
    montar()

    await waitFor(() => expect(mockGetOrders).toHaveBeenCalled())

    expect(ultimaConsulta()).toEqual({
      page: 1,
      limit: 10,
      status: '',
      paymentStatus: '',
      fulfillmentStatus: '',
      q: '',
      sortBy: 'createdAt',
      sortDir: 'desc',
    })
  })

  test('buscar espera a que termine de escribir y vuelve a la página 1', async () => {
    montar({ paginacion: { total: 40, page: 3, pages: 4, limit: 10 } })
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByPlaceholderText(/buscar por id/i), 'ana')

    await waitFor(() => expect(ultimaConsulta().q).toBe('ana'), { timeout: 2000 })
    expect(ultimaConsulta().page).toBe(1)
  })

  test('la búsqueda se puede borrar con la cruz', async () => {
    montar()
    const buscador = screen.getByPlaceholderText(/buscar por id/i)

    await userEvent.type(buscador, 'ana')
    await waitFor(() => expect(ultimaConsulta().q).toBe('ana'), { timeout: 2000 })

    await userEvent.click(screen.getByRole('button', { name: /borrar la búsqueda/i }))

    expect(buscador.value).toBe('')
    await waitFor(() => expect(ultimaConsulta().q).toBe(''))
  })

  test('cada filtro vuelve a la página 1 y manda el valor elegido', async () => {
    montar({ paginacion: { total: 40, page: 3, pages: 4, limit: 10 } })
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalled())

    const estadoOrden = screen.getByRole('combobox', { name: /estado orden/i })
    const pago = screen.getByRole('combobox', { name: /^pago$/i })
    const logistica = screen.getByRole('combobox', { name: /^logística$/i })

    await elegir(estadoOrden, 'Enviada')
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: 'shipped', page: 1 }))

    await elegir(pago, 'Aprobado')
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ status: 'shipped', paymentStatus: 'approved' }),
    )

    await elegir(logistica, 'Preparando')
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ fulfillmentStatus: 'preparing', page: 1 }),
    )
  })

  test('cambiar de página vuelve a consultar con esa página', async () => {
    montar({ paginacion: { total: 25, page: 1, pages: 3, limit: 10 } })
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /ir a la página 2/i }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
  })

  test('con una sola página no hay paginación', () => {
    montar()

    expect(screen.queryByRole('button', { name: /ir a la página 2/i })).toBeNull()
  })

  test('«Actualizar» vuelve a pedir lo mismo', async () => {
    montar()
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    expect(mockGetOrders).toHaveBeenCalledTimes(2)
  })
})

describe('Pedidos · lo que se ve', () => {
  test('lista cada pedido con su cliente, total y estados', () => {
    montar()

    const abierta = within(fila('A-1001'))

    expect(abierta.getByText('ana@mail.com')).toBeTruthy()
    expect(abierta.getByText('Ana Pérez')).toBeTruthy()
    expect(abierta.getByText(/1\.500,00/)).toBeTruthy()
    expect(abierta.getByText('1 items')).toBeTruthy()
    expect(abierta.getByText('10/10/26')).toBeTruthy()
    expect(abierta.getByText('Abierta')).toBeTruthy()
    expect(abierta.getByText('Pendiente')).toBeTruthy()
    expect(abierta.getByText('Sin preparar')).toBeTruthy()

    const pagada = within(fila('A-1003'))

    expect(pagada.getByText('Procesando')).toBeTruthy()
    expect(pagada.getByText('Aprobado')).toBeTruthy()
    expect(pagada.getByText('Preparando')).toBeTruthy()
  })

  const tile = nombre =>
    within(screen.getByRole('region', { name: /resumen de pedidos/i }))
      .getByText(nombre)
      .closest('button, div')

  test('el resumen sale del servidor, sobre todo lo filtrado y no solo de la página', () => {
    montar({
      paginacion: { total: 250, page: 1, pages: 25, limit: 10 },
      resumen: {
        total: 12340,
        byStatus: { payment_pending: 20, not_processed: 5, processing: 7, delivered: 30 },
      },
    })

    expect(screen.getByText(/250 pedidos/)).toBeTruthy()
    expect(within(tile('Pedidos')).getByText('250')).toBeTruthy()
    expect(within(tile('Ventas')).getByText(/12\.340,00/)).toBeTruthy()
    expect(within(tile('Abiertas')).getByText('25')).toBeTruthy()
    expect(within(tile('Procesando')).getByText('7')).toBeTruthy()
    expect(within(tile('Entregadas')).getByText('30')).toBeTruthy()
  })

  test('sin resumen del servidor cuenta lo que hay cargado', () => {
    montar()

    expect(screen.getByText(/3 pedidos/)).toBeTruthy()
    expect(within(tile('Ventas')).getByText(/331\.500,00/)).toBeTruthy()
    expect(within(tile('Abiertas')).getByText('2')).toBeTruthy()
    expect(within(tile('Procesando')).getByText('1')).toBeTruthy()
    expect(within(tile('Entregadas')).getByText('0')).toBeTruthy()
  })

  test('tocar una cifra del resumen filtra por ese estado, y tocarla de nuevo lo quita', async () => {
    montar()
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalled())

    await userEvent.click(tile('Abiertas'))
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: 'open', page: 1 }))
    expect(tile('Abiertas').getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(tile('Procesando'))
    await waitFor(() => expect(ultimaConsulta().status).toBe('processing'))

    await userEvent.click(tile('Procesando'))
    await waitFor(() => expect(ultimaConsulta().status).toBe(''))
  })

  test('«Limpiar filtros» aparece solo con filtros y los saca todos juntos', async () => {
    montar({ paginacion: { total: 40, page: 3, pages: 4, limit: 10 } })
    await waitFor(() => expect(mockGetOrders).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).toBeNull()

    await elegir(screen.getByRole('combobox', { name: /estado orden/i }), 'Enviada')
    await elegir(screen.getByRole('combobox', { name: /^pago$/i }), 'Aprobado')
    await userEvent.type(screen.getByRole('textbox', { name: /buscar pedidos/i }), 'ana')
    await waitFor(() => expect(ultimaConsulta().q).toBe('ana'), { timeout: 2000 })

    await userEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({
        status: '',
        paymentStatus: '',
        fulfillmentStatus: '',
        q: '',
        page: 1,
      }),
    )
    expect(screen.getByRole('textbox', { name: /buscar pedidos/i }).value).toBe('')
    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).toBeNull()
  })

  test('sin pedidos avisa que no se encontraron', () => {
    montar({ ordenes: [] })

    expect(screen.getByText(/no se encontraron pedidos/i)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('mientras carga por primera vez muestra el aviso de carga', () => {
    montar({ ordenes: [], isLoading: true })

    expect(screen.getByText(/cargando pedidos/i)).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor', () => {
    montar({ ordenes: [], isError: true, message: 'No se pudo conectar' })

    expect(screen.getByText('No se pudo conectar')).toBeTruthy()
  })

  test('si falla la carga sin mensaje muestra uno genérico', () => {
    montar({ ordenes: [], isError: true })

    expect(screen.getByText('Error al cargar órdenes')).toBeTruthy()
  })

  test('mientras se actualiza una orden lo avisa y bloquea los botones', () => {
    montar({ isUpdating: true })

    expect(screen.getByText(/actualizando orden/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /actualizar/i }).disabled).toBe(true)
    expect(screen.getByPlaceholderText(/buscar por id/i).disabled).toBe(true)
  })
})

describe('Pedidos · detalle de un pedido', () => {
  test('al tocar la fila se abren los productos, el envío y el panel de control', async () => {
    montar()

    expect(screen.queryByText('Panel de Control')).toBeNull()

    await abrirOrden('A-1002')

    expect(screen.getByText('Productos (2)')).toBeTruthy()
    expect(screen.getByText('Campera Dainese')).toBeTruthy()
    expect(screen.getByText('Guantes')).toBeTruthy()
    expect(screen.getByText('Panel de Control')).toBeTruthy()
    expect(screen.getByText('Resumen del pedido')).toBeTruthy()
    expect(screen.getByText('Datos de envío')).toBeTruthy()
  })

  test('tocar de nuevo la fila la cierra, y abrir otra cierra la anterior', async () => {
    montar()

    await abrirOrden('A-1001')
    expect(screen.getByText('Casco AGV K1')).toBeTruthy()

    await abrirOrden('A-1001')
    expect(screen.queryByText('Casco AGV K1')).toBeNull()

    await abrirOrden('A-1001')
    await abrirOrden('A-1003')

    expect(screen.queryByText('Casco AGV K1')).toBeNull()
    expect(screen.getByText('Botas TCX')).toBeTruthy()
  })

  test('muestra el SKU, la cantidad y el subtotal de cada línea', async () => {
    montar()
    await abrirOrden('A-1001')

    expect(screen.getByText('SKU: CASCO-K1')).toBeTruthy()
    expect(screen.getByText(/1 × .*1\.500,00/)).toBeTruthy()
  })

  test('la dirección de envío muestra nombre, calle, ciudad y código postal', async () => {
    montar()
    await abrirOrden('A-1001')

    expect(screen.getByText('Dirección de envío')).toBeTruthy()
    expect(screen.getByText('Calle Falsa 123')).toBeTruthy()
    expect(screen.getByText(/Córdoba, CP: 5000, AR/)).toBeTruthy()
  })

  test('«Ver detalle» abre el pedido en una ventana con el cliente', async () => {
    montar()

    await userEvent.click(botonDeFila('A-1001', 'Ver detalle'))

    const ventana = await screen.findByRole('dialog')

    expect(within(ventana).getByText('Pedido #A-1001')).toBeTruthy()
    expect(within(ventana).getByText('Cliente')).toBeTruthy()
    expect(within(ventana).getAllByText('ana@mail.com').length).toBeGreaterThan(0)
    expect(within(ventana).getByText('Casco AGV K1')).toBeTruthy()
  })

  test('la ventana de detalle se cierra con la cruz', async () => {
    montar()

    await userEvent.click(botonDeFila('A-1001', 'Ver detalle'))
    const ventana = await screen.findByRole('dialog')

    await userEvent.click(within(ventana).getByRole('button', { name: /cerrar el detalle/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('Pedidos · pago y logística', () => {
  test('pasar un pago chico a «Aprobado» se manda directo', async () => {
    montar()
    await abrirOrden('A-1001')

    await elegir(comboPago(), 'Aprobado')

    expect(mockUpdatePayment).toHaveBeenCalledWith({
      id: 'o1aaaaaa0001',
      paymentStatus: 'approved',
    })
    expect(await screen.findByText('Estado de pago actualizado correctamente')).toBeTruthy()
  })

  test('aprobar un pago de más de $100.000 pide confirmar antes de mandarlo', async () => {
    montar()
    await abrirOrden('A-1002')

    await elegir(comboPago(), 'Aprobado')

    expect(mockUpdatePayment).not.toHaveBeenCalled()

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('Confirmar Aprobación de Pago')).toBeTruthy()
    expect(within(dialogo).getByText(/250\.000,00/, { selector: 'strong' })).toBeTruthy()
    expect(within(dialogo).getByText(/orden de alto valor/i)).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, aprobar' }))

    await waitFor(() =>
      expect(mockUpdatePayment).toHaveBeenCalledWith({
        id: 'o2aaaaaa0002',
        paymentStatus: 'approved',
      }),
    )
    expect(await screen.findByText('Pago aprobado correctamente')).toBeTruthy()
  })

  test('si se cancela la confirmación, no se manda nada', async () => {
    montar()
    await abrirOrden('A-1002')

    await elegir(comboPago(), 'Aprobado')

    const dialogo = await screen.findByRole('dialog')

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockUpdatePayment).not.toHaveBeenCalled()
  })

  test('la logística está bloqueada hasta que el pago esté aprobado', async () => {
    montar()
    await abrirOrden('A-1001')

    const logistica = comboLogistica()

    expect(logistica.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(/la logística se habilita cuando el pago está aprobado/i)).toBeTruthy()
  })

  test('con el pago aprobado se puede avanzar la logística', async () => {
    montar()
    await abrirOrden('A-1003')

    const pago = comboPago()
    const logistica = comboLogistica()

    expect(pago.getAttribute('aria-disabled')).toBe('true')

    await elegir(logistica, 'Lista para envío')

    expect(mockUpdateFulfillment).toHaveBeenCalledWith({
      id: 'o3aaaaaa0003',
      fulfillmentStatus: 'ready_to_ship',
    })
    expect(await screen.findByText('Estado logístico actualizado correctamente')).toBeTruthy()
  })

  test('de «Preparando» no se puede volver a «Sin preparar»', async () => {
    montar()
    await abrirOrden('A-1003')

    await userEvent.click(comboLogistica())

    expect(screen.queryByRole('option', { name: 'Sin preparar' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Lista para envío' })).toBeTruthy()
  })

  test('si el servidor rechaza el cambio muestra su mensaje', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'updatePayment'
          ? Promise.reject({ message: 'El pago ya fue conciliado' })
          : Promise.resolve({}),
    }))
    montar()
    await abrirOrden('A-1001')

    await elegir(comboPago(), 'Rechazado')

    expect(await screen.findByText('El pago ya fue conciliado')).toBeTruthy()
  })
})

describe('Pedidos · datos de envío', () => {
  test('guardar manda el código y el transportista sin espacios', async () => {
    montar()
    await abrirOrden('A-1003')

    const guardar = screen.getByRole('button', { name: /guardar envío/i })

    expect(guardar.disabled).toBe(true)

    await userEvent.type(screen.getByLabelText('Código de seguimiento'), '  AR123  ')
    await userEvent.type(screen.getByLabelText('Transportista'), 'Andreani')

    expect(guardar.disabled).toBe(false)

    await userEvent.click(guardar)

    await waitFor(() =>
      expect(mockUpdateShipment).toHaveBeenCalledWith({
        id: 'o3aaaaaa0003',
        trackingNumber: 'AR123',
        carrier: 'Andreani',
      }),
    )
    expect(await screen.findByText('Datos de envío actualizados correctamente')).toBeTruthy()
  })

  test('muestra los datos de envío que ya había y las fechas', async () => {
    montar({
      ordenes: [
        {
          ...ORDEN_PAGADA,
          shipment: {
            trackingNumber: 'XYZ9',
            carrier: 'OCA',
            shippedAt: '2026-10-13T15:30:00.000Z',
          },
        },
      ],
    })
    await abrirOrden('A-1003')

    expect(screen.getByLabelText('Código de seguimiento').value).toBe('XYZ9')
    expect(screen.getByLabelText('Transportista').value).toBe('OCA')
    expect(screen.getByText(/despachado:/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /guardar envío/i }).disabled).toBe(true)
  })

  // Los mismos topes que recorta el backend (orderCtrl): 200 el código y 100 el transportista. En
  // MUI 9 `inputProps` se ignora sin avisar, así que el atributo tiene que estar en el <input> real.
  test('el código y el transportista tienen largo máximo', async () => {
    montar()
    await abrirOrden('A-1003')

    expect(screen.getByLabelText('Código de seguimiento').getAttribute('maxlength')).toBe('200')
    expect(screen.getByLabelText('Transportista').getAttribute('maxlength')).toBe('100')
  })
})

describe('Pedidos · cancelar, reembolsar y eliminar', () => {
  const confirmar = async nombre => {
    const dialogo = await screen.findByRole('dialog')

    await userEvent.click(within(dialogo).getByRole('button', { name: nombre }))
  }

  test('cancelar pide confirmación y manda el motivo', async () => {
    montar()
    await abrirOrden('A-1001')

    await userEvent.click(within(panel()).getByRole('button', { name: 'Cancelar' }))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('Confirmar Cancelación')).toBeTruthy()
    expect(within(dialogo).getByText(/restaura el stock reservado/i)).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, cancelar' }))

    await waitFor(() =>
      expect(mockCancel).toHaveBeenCalledWith({
        id: 'o1aaaaaa0001',
        reason: 'Cancelación manual desde admin',
      }),
    )
    expect(await screen.findByText('Orden cancelada correctamente')).toBeTruthy()
  })

  test('no se puede cancelar una orden con el pago aprobado: hay que reembolsar', async () => {
    montar()
    await abrirOrden('A-1003')

    expect(within(panel()).getByRole('button', { name: 'Cancelar' }).disabled).toBe(true)
    expect(within(panel()).getByRole('button', { name: 'Reembolsar' }).disabled).toBe(false)
  })

  test('reembolsar solo está disponible con el pago aprobado', async () => {
    montar()
    await abrirOrden('A-1001')

    expect(within(panel()).getByRole('button', { name: 'Reembolsar' }).disabled).toBe(true)
  })

  test('reembolsar avisa que el dinero se devuelve aparte, en Mercado Pago', async () => {
    montar()
    await abrirOrden('A-1003')

    await userEvent.click(within(panel()).getByRole('button', { name: 'Reembolsar' }))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('Confirmar Reembolso')).toBeTruthy()
    expect(within(dialogo).getByText(/Mercado Pago/)).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, reembolsar' }))

    await waitFor(() => expect(mockRefund).toHaveBeenCalledWith({ id: 'o3aaaaaa0003' }))
    expect(await screen.findByText(/verificá que el reembolso se haya procesado/i)).toBeTruthy()
  })

  test('eliminar una orden común pide confirmación y no fuerza el borrado', async () => {
    montar()

    await userEvent.click(botonDeFila('A-1001', 'Eliminar orden'))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('Confirmar Eliminación')).toBeTruthy()
    expect(within(dialogo).getByText(/¿Deseas eliminar la orden #A-1001\?/)).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, eliminar' }))

    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({
        id: 'o1aaaaaa0001',
        force: false,
        reason: 'Eliminación manual desde panel admin',
      }),
    )
    expect(await screen.findByText('Orden eliminada correctamente')).toBeTruthy()
  })

  test('eliminar una orden protegida lo avisa en el mensaje', async () => {
    montar()

    await userEvent.click(botonDeFila('A-1003', 'Eliminar orden'))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText(/tiene estado sensible/i)).toBeTruthy()
  })

  test('si el servidor pide una segunda confirmación, la muestra y recién ahí fuerza el borrado', async () => {
    let intentos = 0

    mockDispatch.mockImplementation(action => ({
      unwrap: () => {
        if (action.type === 'delete') {
          intentos += 1

          if (!action.args.force) {
            return Promise.reject({ status: 409, code: 'ORDER_DELETE_REQUIRES_FORCE' })
          }
        }

        return Promise.resolve({})
      },
    }))
    montar()

    await userEvent.click(botonDeFila('A-1003', 'Eliminar orden'))
    await confirmar('Sí, eliminar')

    expect(await screen.findByText('Confirmar Eliminación Forzada')).toBeTruthy()
    expect(screen.getByText(/última confirmación/i)).toBeTruthy()
    expect(await screen.findByText(/la orden está protegida\. confirmá nuevamente/i)).toBeTruthy()
    expect(intentos).toBe(1)

    await confirmar('Sí, eliminar forzadamente')

    await waitFor(() =>
      expect(mockDelete).toHaveBeenLastCalledWith({
        id: 'o3aaaaaa0003',
        force: true,
        reason: 'Eliminación forzada confirmada desde panel admin',
      }),
    )
    expect(await screen.findByText('Orden eliminada forzadamente')).toBeTruthy()
  })

  test('un error distinto al pedir eliminar no abre la segunda confirmación', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'delete' ? Promise.reject({ message: 'Sin permiso' }) : Promise.resolve({}),
    }))
    montar()

    await userEvent.click(botonDeFila('A-1001', 'Eliminar orden'))
    await confirmar('Sí, eliminar')

    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    expect(screen.queryByText('Confirmar Eliminación Forzada')).toBeNull()
  })

  test('eliminar desde el detalle cierra la ventana del pedido', async () => {
    montar()

    await userEvent.click(botonDeFila('A-1001', 'Ver detalle'))
    const ventana = await screen.findByRole('dialog')

    await userEvent.click(within(ventana).getByRole('button', { name: /^eliminar$/i }))

    const confirmacion = (await screen.findAllByRole('dialog')).find(d =>
      within(d).queryByText('Confirmar Eliminación'),
    )

    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Sí, eliminar' }))

    await waitFor(() => expect(screen.queryByText('Pedido #A-1001')).toBeNull())
  })

  test('cancelar el diálogo de confirmación no manda nada', async () => {
    montar()

    await userEvent.click(botonDeFila('A-1001', 'Eliminar orden'))
    await confirmar('Cancelar')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('Pedidos · exportar', () => {
  test('exporta lo que hay en pantalla y lo avisa', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: /exportar/i }))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Exportación generada correctamente')).toBeTruthy()
  })

  test('sin pedidos el botón de exportar está deshabilitado', () => {
    montar({ ordenes: [] })

    expect(screen.getByRole('button', { name: /exportar/i }).disabled).toBe(true)
  })
})

describe('Pedidos · en el celular', () => {
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

  test('no hay tabla: cada pedido es una tarjeta con todo a la vista', () => {
    estrecha()
    montar()

    expect(screen.queryByRole('table')).toBeNull()

    const tarjetas = screen.getAllByRole('article')

    expect(tarjetas).toHaveLength(3)

    const primera = within(tarjetas[0])

    expect(primera.getByText('#A-1001')).toBeTruthy()
    expect(primera.getByText('ana@mail.com')).toBeTruthy()
    expect(primera.getByText('Ana Pérez')).toBeTruthy()
    expect(primera.getByText(/1\.500,00/)).toBeTruthy()
    expect(primera.getByText('Abierta')).toBeTruthy()
    expect(primera.getByText('Pendiente')).toBeTruthy()
    expect(primera.getByText('Sin preparar')).toBeTruthy()
  })

  test('«Ver detalle» abre la ventana del pedido con todos sus paneles', async () => {
    estrecha()
    montar()

    await userEvent.click(
      within(screen.getAllByRole('article')[1]).getByRole('button', { name: /ver detalle/i }),
    )

    const ventana = await screen.findByRole('dialog')

    expect(within(ventana).getByText('Pedido #A-1002')).toBeTruthy()
    expect(within(ventana).getByText('Campera Dainese')).toBeTruthy()
    expect(within(ventana).getByText('Panel de Control')).toBeTruthy()
  })

  test('eliminar desde la tarjeta pide la misma confirmación', async () => {
    estrecha()
    montar()

    await userEvent.click(
      within(screen.getAllByRole('article')[0]).getByRole('button', { name: /eliminar orden/i }),
    )

    expect(await screen.findByText('Confirmar Eliminación')).toBeTruthy()
  })

  test('sin pedidos muestra el mismo aviso que en escritorio', () => {
    estrecha()
    montar({ ordenes: [] })

    expect(screen.getByText(/no se encontraron pedidos/i)).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
