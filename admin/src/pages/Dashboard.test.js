// Panel de control (Dashboard).
//
// Esta pantalla no tenía ni un test y decide cosas con plata: cuánto vendió el comercio, cuánto vale
// lo que se abandonó, qué plan paga. Acá se fijan dos capas:
//
//   1. Los cálculos que arman lo que se muestra (embudo, filas por día, catálogo de productos…), que
//      son funciones puras y llevan la lógica que más veces se corrigió: el embudo contaba el doble
//      de compras porque leía eventos en vez de órdenes pagadas.
//   2. La pantalla: qué muestra con datos, con la carga, con el error, cada estado de suscripción, y
//      cuándo consulta (solo con sesión, y se actualiza sola cada 30 segundos).
//
// Los gráficos (recharts) se reemplazan por una caja que cuenta filas: jsdom no tiene tamaño, así que
// el gráfico real no dibuja nada, y lo que importa acá es qué datos le llegan.

import React from 'react'
import { jest } from '@jest/globals'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockGetDashboard = jest.fn()
const mockApiGet = jest.fn()
const mockNavigate = jest.fn()
const mockDispatch = jest.fn()
const mockSnackbar = jest.fn()
const estado = {
  user: { isAuthenticated: true },
  tenant: { data: { onboarding: { completed: true } }, isLoading: false },
}

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

jest.unstable_mockModule('notistack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

jest.unstable_mockModule('../features/tenant/tenantSlice', () => ({
  fetchTenantSettings: () => ({ type: 'tenant/fetch' }),
}))

jest.unstable_mockModule('../services/api', () => ({
  analyticsAPI: { getDashboard: mockGetDashboard },
}))

jest.unstable_mockModule('../utils/axiosConfig', () => ({
  default: { get: mockApiGet },
}))

jest.unstable_mockModule('recharts', () => {
  const Nada = () => null
  return {
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
    BarChart: ({ data, children }) => (
      <div data-testid="grafico" data-filas={Array.isArray(data) ? data.length : 0}>
        {children}
      </div>
    ),
    Bar: Nada,
    CartesianGrid: Nada,
    Legend: Nada,
    Tooltip: Nada,
    XAxis: Nada,
    YAxis: Nada,
  }
})

const {
  default: Dashboard,
  buildDailyRows,
  buildFunnelChartData,
  buildProductCatalog,
  buildProductLookup,
  firstNonEmptyArray,
  formatDateLabel,
  formatMoney,
  formatNumber,
  formatPercent,
  getPageLabel,
  getPaidOrders,
  getProductDisplayName,
  getProductImage,
  getProductKeyFromPath,
  getSummarySessions,
  getVerticalChartHeight,
  mergeDailyMetricRows,
  normalizeSearchRows,
  normalizeTopPageRows,
  normalizeTopProductRows,
  toNumber,
  truncateText,
} = await import('./Dashboard.js')

// ─── 1. Cálculos ─────────────────────────────────────────────────────────────

describe('Dashboard · formatos', () => {
  test('números y plata en formato argentino', () => {
    expect(formatNumber(1234567)).toBe('1.234.567')
    expect(formatNumber(null)).toBe('0')
    expect(formatMoney(1234.5)).toBe('$1.234,50')
    expect(formatMoney(undefined)).toBe('$0,00')
    expect(formatPercent(12.3456)).toBe('12.35%')
    expect(formatPercent(null)).toBe('0.00%')
  })

  test('toNumber no deja pasar basura', () => {
    expect(toNumber('5')).toBe(5)
    expect(toNumber('abc')).toBe(0)
    expect(toNumber(undefined)).toBe(0)
    expect(toNumber(Infinity)).toBe(0)
  })

  test('formatDateLabel acorta las fechas ISO y deja pasar lo demás', () => {
    expect(formatDateLabel('2026-10-05')).toBe('05/10')
    expect(formatDateLabel('semana 40')).toBe('semana 40')
    expect(formatDateLabel(null)).toBe('')
  })

  test('truncateText corta con puntos suspensivos y tolera vacío', () => {
    expect(truncateText('a'.repeat(30), 10)).toBe(`${'a'.repeat(9)}…`)
    expect(truncateText('corto', 10)).toBe('corto')
    expect(truncateText(null)).toBe('')
  })

  test('el alto del gráfico vertical crece con las filas, con un mínimo', () => {
    expect(getVerticalChartHeight([], 340)).toBe(340)
    expect(getVerticalChartHeight(new Array(10).fill({}), 340)).toBe(570)
    expect(getVerticalChartHeight(undefined)).toBe(340)
  })

  test('firstNonEmptyArray elige el primer arreglo con algo', () => {
    expect(firstNonEmptyArray([], null, [1], [2])).toEqual([1])
    expect(firstNonEmptyArray(null, undefined, [])).toEqual([])
  })

  test('sesiones y órdenes pagadas: el resumen manda y el otro es respaldo', () => {
    expect(getSummarySessions({ sessions: 5 }, { sessions: 9 })).toBe(5)
    expect(getSummarySessions({}, { sessions: 9 })).toBe(9)
    expect(getSummarySessions({ sessions: 0 }, { sessions: 9 })).toBe(0)
    expect(getPaidOrders({ paidOrders: 3, orders: 6 })).toBe(3)
    expect(getPaidOrders({ orders: 6 })).toBe(6)
    expect(getPaidOrders({})).toBe(0)
  })
})

describe('Dashboard · filas por día', () => {
  test('fusiona las fuentes por fecha tomando el mayor valor de cada métrica, ordenadas', () => {
    const filas = mergeDailyMetricRows(
      [{ date: '2026-10-02', revenue: 100, orders: 1 }],
      [
        { _id: '2026-10-01', sessions: 5 },
        { date: '2026-10-02', revenue: 80, sessions: 7 },
      ],
    )

    expect(filas.map(f => f.date)).toEqual(['2026-10-01', '2026-10-02'])
    expect(filas[0]).toMatchObject({ sessions: 5, revenue: 0 })
    expect(filas[1]).toMatchObject({ revenue: 100, orders: 1, sessions: 7 })
  })

  test('descarta las filas sin fecha y tolera grupos nulos', () => {
    expect(mergeDailyMetricRows(null, [{ revenue: 5 }], undefined)).toEqual([])
  })

  test('buildDailyRows junta tendencias y actividad de usuarios, y tolera datos vacíos', () => {
    const filas = buildDailyRows({
      trends: { daily: [{ date: '2026-10-01', revenue: 50 }] },
      userBehavior: { dailyActivity: [{ date: '2026-10-01', sessions: 4 }] },
    })

    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({ revenue: 50, sessions: 4 })
    expect(buildDailyRows(undefined)).toEqual([])
  })
})

describe('Dashboard · productos', () => {
  test('el producto sale de la ruta /product/<clave>', () => {
    expect(getProductKeyFromPath('/product/casco-agv?x=1')).toBe('casco-agv')
    expect(getProductKeyFromPath('/product/casco-agv/')).toBe('casco-agv')
    expect(getProductKeyFromPath('/product/a%20b')).toBe('a b')
    expect(getProductKeyFromPath('/product/%E0%A4%A')).toBe('%E0%A4%A') // mal codificado: tal cual
    expect(getProductKeyFromPath('/product')).toBe('')
    expect(getProductKeyFromPath('/product/product')).toBe('')
    expect(getProductKeyFromPath('/cart')).toBe('')
  })

  test('la imagen se busca en los lugares donde puede venir', () => {
    expect(getProductImage({ image: 'a.jpg' })).toBe('a.jpg')
    expect(getProductImage({ images: [{ secure_url: 'b.jpg' }] })).toBe('b.jpg')
    expect(getProductImage({ gallery: [{ url: 'c.jpg' }] })).toBe('c.jpg')
    expect(getProductImage({})).toBe('')
  })

  test('el nombre sigue un orden de preferencia y cae en «Producto»', () => {
    expect(getProductDisplayName({ fullName: 'F', title: 'T' })).toBe('F')
    expect(getProductDisplayName({ title: 'T', name: 'N' })).toBe('T')
    expect(getProductDisplayName({ slug: 'casco' })).toBe('casco')
    expect(getProductDisplayName({})).toBe('Producto')
  })

  test('el catálogo junta el mismo producto de varias listas sin duplicarlo', () => {
    const catalogo = buildProductCatalog(
      [{ productId: 'p1', title: 'Casco', revenue: 10 }],
      [
        { productId: 'p1', image: 'casco.jpg' },
        { productId: 'p2', title: 'Guantes' },
      ],
      [{ title: 'Sin identificador' }],
    )

    expect(catalogo).toHaveLength(2)
    expect(catalogo[0]).toMatchObject({ productId: 'p1', image: 'casco.jpg', revenue: 10 })
    expect(catalogo[1]).toMatchObject({ productId: 'p2', title: 'Guantes' })
  })

  test('el buscador de productos acepta cualquiera de sus identificadores, sin pisarse', () => {
    const lookup = buildProductLookup([
      { productId: 'p1', slug: 'casco-agv', title: 'Casco' },
      { productId: 'p9', slug: 'casco-agv', title: 'Otro' },
    ])

    expect(lookup.get('p1').title).toBe('Casco')
    expect(lookup.get('casco-agv').title).toBe('Casco') // gana el primero
    expect(lookup.get('p9').title).toBe('Otro')
  })

  test('los más vendidos: máximo 10, nombre acortado y números forzados a número', () => {
    const filas = normalizeTopProductRows(
      Array.from({ length: 12 }, (_, i) => ({
        title: i === 0 ? 'Un nombre bastante largo para una barra' : `P${i}`,
        revenue: '100',
        views: undefined,
      })),
    )

    expect(filas).toHaveLength(10)
    expect(filas[0].fullName).toBe('Un nombre bastante largo para una barra')
    expect(filas[0].name.length).toBeLessThanOrEqual(24)
    expect(filas[0]).toMatchObject({ revenue: 100, views: 0, clicks: 0 })
    expect(normalizeTopProductRows(null)).toEqual([])
  })
})

describe('Dashboard · páginas y búsquedas', () => {
  test('las páginas conocidas llevan su nombre, y las demás su ruta', () => {
    expect(getPageLabel('/cart/?a=1')).toBe('Carrito')
    expect(getPageLabel('/')).toBe('Inicio')
    expect(getPageLabel('')).toBe('Inicio')
    expect(getPageLabel('/algo-raro')).toBe('/algo-raro')
  })

  test('una visita a un producto muestra el producto, no la ruta técnica', () => {
    const lookup = buildProductLookup([
      { productId: 'p1', slug: 'casco-agv', title: 'Casco AGV', image: 'casco.jpg' },
    ])

    const filas = normalizeTopPageRows(
      [
        { path: '/product/casco-agv', views: '40', sessions: 20 },
        { path: '/cart', views: 10 },
        { views: 1 },
      ],
      lookup,
    )

    expect(filas[0]).toMatchObject({
      isProductPage: true,
      title: 'Casco AGV',
      image: 'casco.jpg',
      views: 40,
    })
    expect(filas[1]).toMatchObject({ isProductPage: false, title: 'Carrito', image: '' })
    expect(filas[2]).toMatchObject({ path: '/', title: 'Inicio' })
  })

  test('una búsqueda se asocia al producto por id directo o por parecido de nombre', () => {
    const catalogo = buildProductCatalog([
      { productId: 'p1', title: 'Casco AGV K1', slug: 'casco-agv-k1' },
      { productId: 'p2', title: 'Guantes' },
    ])
    const lookup = buildProductLookup(catalogo)

    const filas = normalizeSearchRows(
      [
        { query: 'casco', count: 5 },
        { term: 'guantes', searches: 3, productId: 'p2' },
        { search: 'bota', events: 2 },
        {},
      ],
      catalogo,
      lookup,
    )

    expect(filas[0]).toMatchObject({ title: 'Casco AGV K1', hasProductMatch: true, count: 5 })
    expect(filas[1]).toMatchObject({ title: 'Guantes', hasProductMatch: true, count: 3 })
    expect(filas[2]).toMatchObject({ title: 'bota', hasProductMatch: false, count: 2 })
    expect(filas[3]).toMatchObject({ title: 'Búsqueda', count: 0 })
  })
})

describe('Dashboard · embudo de conversión', () => {
  const comportamiento = {
    sessions: 200,
    productViews: 100,
    productClicks: 50,
    addToCart: 20,
    checkoutStarts: 10,
    paymentAttempts: 6,
    purchases: 6,
  }

  test('siete pasos, cada uno medido contra el anterior', () => {
    const filas = buildFunnelChartData(comportamiento, {}, { paidOrders: 3 })

    expect(filas.map(f => f.name)).toEqual([
      'Sesiones',
      'Vistas producto',
      'Clicks producto',
      'Carrito',
      'Checkout',
      'Pago',
      'Compra',
    ])
    expect(filas[0].rate).toBe(100)
    expect(filas[1].rate).toBe(50) // 100 de 200
    expect(filas[3].rate).toBe(40) // 20 de 50
    expect(filas[1].label).toBe('100 · 50.00%')
  })

  test('la compra son las ÓRDENES PAGADAS, no los eventos: no cuenta el doble', () => {
    // Cada venta deja un evento del navegador y otro del backend: el último escalón mostraba 6
    // compras con 3 órdenes, y una conversión de pago del 200%.
    const filas = buildFunnelChartData(comportamiento, {}, { paidOrders: 3 })
    const compra = filas[filas.length - 1]

    expect(compra.value).toBe(3)
    expect(compra.rate).toBe(50) // 3 de 6 intentos de pago, no 200%
  })

  test('sin órdenes en el resumen, los eventos son el respaldo', () => {
    const filas = buildFunnelChartData(comportamiento, {}, {})

    expect(filas[filas.length - 1].value).toBe(6)
  })

  test('los intentos de pago salen de la conducta del usuario o, si no, del pago', () => {
    const sinIntentos = { ...comportamiento, paymentAttempts: undefined }

    expect(buildFunnelChartData(sinIntentos, { attempts: 8 }, {})[5].value).toBe(8)
  })

  test('un paso previo en cero no divide por cero', () => {
    const filas = buildFunnelChartData({ sessions: 0, productViews: 5 }, {}, {})

    expect(filas[1].rate).toBe(0)
    expect(Number.isFinite(filas[1].rate)).toBe(true)
  })
})

// ─── 2. La pantalla ──────────────────────────────────────────────────────────

const PAYLOAD = {
  summary: {
    revenue: 150000.5,
    paidOrders: 3,
    averageOrderValue: 50000,
    conversionRate: 2.5,
    revenueGrowth: 12.3,
    ordersGrowth: -4,
    activeCarts: 4,
    activeCartValue: 80000,
    abandonedCarts: 6,
    abandonedCartValue: 120000,
    metaRevenue: 30000,
    recoveredRevenue: 15000,
    aiInfluencedRevenue: 22000,
    totalGeneratedValue: 61000,
  },
  userBehavior: {
    sessions: 200,
    productViews: 100,
    productClicks: 50,
    addToCart: 20,
    checkoutStarts: 10,
    paymentAttempts: 6,
    topPages: [
      { path: '/product/casco-agv', views: 40, sessions: 20 },
      { path: '/cart', views: 10 },
    ],
    topSearches: [{ query: 'casco', count: 5 }],
    sources: [{ channel: 'instagram', sessions: 30, conversions: 2 }],
  },
  topProducts: [{ productId: 'p1', slug: 'casco-agv', title: 'Casco AGV', revenue: 100000 }],
  topVisitedProducts: [{ productId: 'p1', title: 'Casco AGV', views: 40, clicks: 10 }],
  topClickedProducts: [{ productId: 'p1', title: 'Casco AGV', clicks: 10 }],
  trends: { daily: [{ date: '2026-10-01', revenue: 50000, sessions: 20 }] },
  activeCarts: {
    count: 4,
    items: 9,
    value: 80000,
    latest: [
      { cartId: 'abc123456', itemCount: 2, value: 25000, updatedAt: '2026-10-16T12:00:00Z' },
    ],
  },
  abandonedCarts: { count: 6, items: 14, value: 120000 },
}

const METRICAS = {
  success: true,
  data: {
    currentPlan: 'pro',
    status: 'active',
    isActive: true,
    mrr: 42000,
    nextBillingAt: '2026-11-15T10:00:00.000Z',
  },
}

const montar = async ({ payload = PAYLOAD, metricas = METRICAS } = {}) => {
  mockGetDashboard.mockResolvedValue({ data: { data: payload } })
  mockApiGet.mockResolvedValue({ data: metricas })

  render(<Dashboard />)

  await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled())
}

beforeEach(() => {
  jest.clearAllMocks()
  estado.user = { isAuthenticated: true }
  estado.tenant = { data: { onboarding: { completed: true } }, isLoading: false }
})

describe('Dashboard · lo que muestra', () => {
  test('ventas, órdenes, ticket y conversión del período', async () => {
    await montar()

    expect(await screen.findByText('$150.000,50')).toBeTruthy()
    expect(screen.getByText('Ventas aprobadas')).toBeTruthy()
    expect(screen.getByText('Órdenes pagadas')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('$50.000,00')).toBeTruthy()
    expect(screen.getByText('2.50%')).toBeTruthy()
  })

  test('la variación contra el período anterior lleva su signo y su color', async () => {
    await montar()

    await screen.findByText('$150.000,50')

    expect(screen.getByText('+12.3%')).toBeTruthy()
    expect(screen.getByText('-4.0%')).toBeTruthy()
  })

  test('valor generado por HENKO: total, campañas, WhatsApp e IA', async () => {
    await montar()

    expect(await screen.findByText('$61.000,00')).toBeTruthy()
    expect(screen.getByText('Ingreso por campañas')).toBeTruthy()
    expect(screen.getByText('$30.000,00')).toBeTruthy()
    expect(screen.getByText('Recuperado por WhatsApp')).toBeTruthy()
    expect(screen.getByText('$15.000,00')).toBeTruthy()
    expect(screen.getByText('Influenciado por IA')).toBeTruthy()
    expect(screen.getByText('$22.000,00')).toBeTruthy()
  })

  test('carritos activos y abandonados con su valor', async () => {
    await montar()

    expect(await screen.findByText('Carritos activos')).toBeTruthy()
    expect(screen.getByText('$80.000,00')).toBeTruthy()
    expect(screen.getByText('Carritos abandonados')).toBeTruthy()
    expect(screen.getByText('$120.000,00')).toBeTruthy()
  })

  test('el último carrito activo muestra su número corto, productos y valor', async () => {
    await montar()

    expect(await screen.findByText('Carrito #123456')).toBeTruthy()
    expect(screen.getByText('$25.000,00')).toBeTruthy()
  })

  test('páginas y búsquedas: el producto con su nombre, no la ruta técnica', async () => {
    await montar()

    expect((await screen.findAllByText('Casco AGV')).length).toBeGreaterThan(0)
    expect(screen.getByText('Producto visitado')).toBeTruthy()
    expect(screen.getByText('Carrito')).toBeTruthy()
    expect(screen.getByText(/búsqueda: casco/i)).toBeTruthy()
  })

  test('los gráficos reciben los datos del período', async () => {
    await montar()

    await screen.findByText('$150.000,50')

    const filas = screen.getAllByTestId('grafico').map(g => Number(g.dataset.filas))

    // por día, activos vs abandonados, 3 de productos, embudo, tráfico
    expect(filas).toEqual([1, 2, 1, 1, 1, 7, 1])
  })

  test('sin datos, cada sección lo dice en lugar de mostrar un gráfico vacío', async () => {
    await montar({ payload: { summary: {}, userBehavior: {} } })

    expect(await screen.findByText(/todavía no hay actividad diaria suficiente/i)).toBeTruthy()
    expect(screen.getByText(/todavía no hay productos vendidos/i)).toBeTruthy()
    expect(screen.getByText(/todavía no hay visitas de productos registradas/i)).toBeTruthy()
    expect(screen.getByText(/todavía no hay clicks de productos registrados/i)).toBeTruthy()
    expect(screen.getByText(/todavía no hay fuentes de tráfico registradas/i)).toBeTruthy()
    expect(screen.getByText(/no hay carritos activos recientes/i)).toBeTruthy()
    expect(screen.getByText('Sin visitas.')).toBeTruthy()
    expect(screen.getByText('Sin búsquedas.')).toBeTruthy()
  })

  test('tiene un solo h1', async () => {
    await montar()

    await screen.findByText('$150.000,50')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('Dashboard · suscripción', () => {
  const conEstado = datos => ({ success: true, data: { ...METRICAS.data, ...datos } })

  test('muestra el plan por su nombre, el estado y el próximo pago', async () => {
    await montar()

    expect(await screen.findByText('Profesional')).toBeTruthy()
    expect(screen.getByText(/activa/i)).toBeTruthy()
    expect(screen.getByText('15/11/2026')).toBeTruthy()
  })

  test.each([
    ['trialing', /en prueba/i],
    ['past_due', /pendiente/i],
    ['cancelled', /cancelada/i],
    ['none', /ninguna/i],
  ])('el estado %s se lee en palabras', async (status, texto) => {
    await montar({ metricas: conEstado({ status, isActive: false }) })

    expect(await screen.findByText(texto)).toBeTruthy()
  })

  test('un plan desconocido no se hace pasar por Profesional', async () => {
    // Antes una cadena de ternarios mostraba «Profesional» para cualquier plan que no reconociera.
    await montar({ metricas: conEstado({ currentPlan: 'enterprise' }) })

    await screen.findByText(/próximo pago/i)

    expect(screen.queryByText('Profesional')).toBeNull()
  })

  test('sin fecha de próximo cobro lo dice, y no muestra la del último pago', async () => {
    await montar({ metricas: conEstado({ nextBillingAt: null }) })

    expect(await screen.findByText('No disponible')).toBeTruthy()
  })

  test('si las métricas de suscripción fallan, el resto del panel sigue', async () => {
    mockGetDashboard.mockResolvedValue({ data: { data: PAYLOAD } })
    mockApiGet.mockRejectedValue(new Error('500'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<Dashboard />)

    expect(await screen.findByText('$150.000,50')).toBeTruthy()
    expect(screen.queryByText(/próximo pago/i)).toBeNull()

    console.error.mockRestore()
  })
})

describe('Dashboard · consultas', () => {
  test('pide el período elegido, con comparación, y cambia al elegir otro', async () => {
    await montar()

    expect(mockGetDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ days: 30, compare: true }),
    )

    // El período vigente se ve marcado, y elegir otro vuelve a consultar.
    expect(
      screen.getByRole('button', { name: /últimos 30 días/i }).getAttribute('aria-pressed'),
    ).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: /últimos 7 días/i }))

    expect(
      screen.getByRole('button', { name: /últimos 7 días/i }).getAttribute('aria-pressed'),
    ).toBe('true')

    await waitFor(() =>
      expect(mockGetDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ days: 7 })),
    )
  })

  test('sin sesión no consulta nada', async () => {
    estado.user = { isAuthenticated: false }
    mockGetDashboard.mockResolvedValue({ data: { data: PAYLOAD } })

    render(<Dashboard />)

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(mockGetDashboard).not.toHaveBeenCalled()
    expect(mockApiGet).not.toHaveBeenCalled()
  })

  test('se actualiza sola cada 30 segundos mientras haya sesión', async () => {
    jest.useFakeTimers()

    try {
      mockGetDashboard.mockResolvedValue({ data: { data: PAYLOAD } })
      mockApiGet.mockResolvedValue({ data: METRICAS })

      render(<Dashboard />)

      await act(async () => {
        await Promise.resolve()
      })

      const iniciales = mockGetDashboard.mock.calls.length

      await act(async () => {
        jest.advanceTimersByTime(30000)
        await Promise.resolve()
      })

      expect(mockGetDashboard.mock.calls.length).toBe(iniciales + 1)
    } finally {
      jest.useRealTimers()
    }
  })

  test('el botón «Actualizar» vuelve a pedir los datos', async () => {
    await montar()
    await screen.findByText('$150.000,50')

    const antes = mockGetDashboard.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    await waitFor(() => expect(mockGetDashboard.mock.calls.length).toBe(antes + 1))
  })
})

describe('Dashboard · errores y onboarding', () => {
  test('si falla la carga, lo dice, avisa y deja reintentar', async () => {
    mockGetDashboard.mockRejectedValueOnce({
      response: { data: { message: 'Sin permiso para ver estadísticas.' } },
    })
    mockApiGet.mockResolvedValue({ data: METRICAS })

    render(<Dashboard />)

    expect(await screen.findByText('Sin permiso para ver estadísticas.')).toBeTruthy()
    expect(mockSnackbar).toHaveBeenCalledWith('Error cargando estadísticas', { variant: 'error' })

    mockGetDashboard.mockResolvedValue({ data: { data: PAYLOAD } })
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByText('$150.000,50')).toBeTruthy()
  })

  test('sin mensaje del servidor, igual explica qué pasó', async () => {
    mockGetDashboard.mockRejectedValue(new Error('red'))
    mockApiGet.mockResolvedValue({ data: METRICAS })

    render(<Dashboard />)

    expect(await screen.findByText('Error cargando analytics')).toBeTruthy()
  })

  test('un comercio que no terminó el onboarding va al asistente de configuración', async () => {
    estado.tenant = { data: { onboarding: { completed: false } }, isLoading: false }

    await montar()

    expect(mockNavigate).toHaveBeenCalledWith('/admin/onboarding', { replace: true })
  })

  test('uno que ya lo terminó se queda en el panel', async () => {
    await montar()

    await screen.findByText('$150.000,50')

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('mientras los datos del comercio cargan, no lo manda a ningún lado', async () => {
    estado.tenant = { data: { onboarding: { completed: false } }, isLoading: true }

    await montar()

    expect(mockNavigate).not.toHaveBeenCalled()
  })

  test('pide los ajustes del comercio al abrir', async () => {
    await montar()

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'tenant/fetch' })
  })
})
