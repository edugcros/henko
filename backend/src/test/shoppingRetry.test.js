// 📁 src/test/shoppingRetry.test.js
//
// El segundo crédito de búsqueda se gasta solo cuando puede rescatar algo.
//
// LO QUE SE MIDIÓ, SOBRE 16 PRODUCTOS
//
//   ofertas de la búsqueda abierta   reintentos   ganaron algo
//   0                                    4            1  (+7 ofertas)
//   1                                    4            0
//
// Todo reintento que sirvió partía de CERO. Los cuatro que partían de una
// oferta ganaron nada, y la razón es estructural: el filtro de país no busca
// en otro lado, recorta el mismo índice. Si la consulta abierta encontró una
// sola cosa, la filtrada encuentra esa misma o ninguna.
//
// El umbral estaba en 3 —"debajo de esto la mediana describe anécdotas"—, que
// como intención está bien y como mecanismo no se cumplía: la mitad de los
// reintentos era crédito tirado y la mediana seguía sin mejorar.
//
// Con el umbral en 1 se sigue cubriendo el caso que justifica la función —una
// consulta que no devuelve NADA y el filtro de país rescata con siete
// precios— y se deja de pagar el resto.

import { jest } from '@jest/globals'

process.env.TAVILY_API_KEY = 'test-key'
process.env.SHOPPING_PROVIDER = 'tavily'

const mockSearch = jest.fn()

jest.unstable_mockModule(
  '../services/marketIntelligence/sources/tavilyClient.js',
  () => ({
    tavilySearch: mockSearch,
    tavilyExtract: jest.fn(),
    hasTavilyKey: () => true,
    // El mock tiene que exportar TODO lo que el modulo real exporta, o la
    // importacion falla antes de correr un solo test.
    TAVILY_COUNTRY: { AR: 'argentina' },
  }),
)

const { getShoppingSignals } = await import(
  '../services/marketIntelligence/sources/shoppingSource.js'
)

/** Un resultado de Tavily con precio, en un dominio argentino distinto. */
const oferta = (n, precio = 100000) => ({
  url: `https://tienda${n}.com.ar/producto-${n}`,
  title: `Casco de moto LS2 Storm $${precio.toLocaleString('es-AR')}`,
  content: `Precio: $${precio.toLocaleString('es-AR')} en stock`,
})

const analizar = () =>
  getShoppingSignals({ product: 'Casco de moto LS2 Storm', country: 'AR' })

beforeEach(() => {
  jest.clearAllMocks()
})

describe('el reintento con filtro de país', () => {
  test('NO se gasta cuando la búsqueda abierta ya trajo una oferta', async () => {
    // Este era el caso caro: 4 de 4 reintentos desde una oferta ganaron cero.
    mockSearch.mockResolvedValueOnce([oferta(1)])

    await analizar()

    expect(mockSearch).toHaveBeenCalledTimes(1)
  })

  test('tampoco con dos, que antes sí reintentaba', async () => {
    mockSearch.mockResolvedValueOnce([oferta(1, 100000), oferta(2, 120000)])

    await analizar()

    // Con el umbral viejo en 3, esto gastaba el segundo crédito.
    expect(mockSearch).toHaveBeenCalledTimes(1)
  })

  test('SÍ se gasta cuando la abierta no trajo nada', async () => {
    // El caso que justifica la función: medido, una de cada cuatro consultas
    // vacías se rescata con siete precios.
    mockSearch.mockResolvedValueOnce([])
    mockSearch.mockResolvedValueOnce([oferta(1), oferta(2), oferta(3)])

    const señales = await analizar()

    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(señales.available).toBe(true)
    expect(señales.offerCount).toBe(3)
  })

  test('el rescate usa el filtro de país, que es lo que cambia el resultado', async () => {
    mockSearch.mockResolvedValueOnce([])
    mockSearch.mockResolvedValueOnce([oferta(1)])

    await analizar()

    // La primera va abierta, con el país en la CONSULTA; la segunda usa el
    // parámetro `country`, que es lo único distinto entre las dos.
    const [primera] = mockSearch.mock.calls[0]
    const [segunda] = mockSearch.mock.calls[1]

    expect(primera.country).toBeUndefined()
    expect(segunda.country).toBeTruthy()
  })

  test('si el rescate tampoco trae nada, no rompe: 0 ofertas es un dato', async () => {
    // Medido: 3 de 4 rescates devuelven vacío. Que nadie lo venda online en
    // ese mercado es información, no una falla.
    mockSearch.mockResolvedValueOnce([])
    mockSearch.mockResolvedValueOnce([])

    const señales = await analizar()

    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(señales.available).toBe(true)
    expect(señales.offerCount).toBe(0)
  })

  test('el acumulador de créditos ve las dos llamadas, o ninguna sobra', async () => {
    // El costo del reintento tiene que ser visible: es la mitad del gasto de
    // búsqueda de un análisis que rescata.
    mockSearch.mockResolvedValueOnce([])
    mockSearch.mockResolvedValueOnce([oferta(1)])

    const toolUsage = []
    await getShoppingSignals({
      product: 'Casco de moto LS2 Storm',
      country: 'AR',
      toolUsage,
    })

    // El cliente está mockeado, así que no anota: lo que se verifica es que el
    // acumulador LLEGA hasta él en las dos llamadas.
    for (const [args] of mockSearch.mock.calls) {
      expect(args.toolUsage).toBe(toolUsage)
    }
  })
})
