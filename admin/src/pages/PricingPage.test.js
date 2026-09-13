// Pantalla de Pricing Intelligence.
//
// El primer test del panel, y existe por un motivo concreto: esta pantalla se
// desplegó compilando y rompía al abrirla. `renderInput` del Autocomplete leía
// params.InputProps.endAdornment, que en MUI v9 no existe — un TypeError en
// pleno render. webpack no ejecuta componentes, así que el build verde no dijo
// nada.
//
// Lo que se prueba acá no es el diseño: es que la página monte y que las ramas
// que dependen de la forma de la respuesta del backend se rendericen sin
// romperse.

import { jest } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockGetPolicy = jest.fn()
const mockRecommend = jest.fn()
const mockApplyPrice = jest.fn()
const mockUpdatePolicy = jest.fn()
const mockGetProducts = jest.fn()

// Se mockea la capa de red y no fetch: pricingApi importa axiosConfig, que
// valida REACT_APP_API_BASE_URL al cargar el módulo y aborta sin ella.
jest.unstable_mockModule('../utils/pricingApi', () => ({
  getPricingPolicy: mockGetPolicy,
  updatePricingPolicy: mockUpdatePolicy,
  recommendPrice: mockRecommend,
  applyRecommendedPrice: mockApplyPrice,
  default: {},
}))

jest.unstable_mockModule('../features/product/productService', () => ({
  default: { getAdminProducts: mockGetProducts },
}))

const { default: PricingPage } = await import('./PricingPage.js')

const POLICY = {
  strategy: 'margin',
  mode: 'manual',
  minMarginPercent: 35,
  targetMarginPercent: 50,
  maxChangePercent: 10,
  autoApplyMaxPercent: 5,
  priceFloor: null,
  priceCeiling: null,
  rounding: { enabled: true, endings: [990] },
  isDefault: true,
}

beforeEach(() => {
  mockGetPolicy.mockResolvedValue({ success: true, data: POLICY })
  mockGetProducts.mockResolvedValue({ data: [] })
  mockRecommend.mockResolvedValue({ success: true, data: null })
})

describe('PricingPage · monta', () => {
  test('renderiza sin romperse', async () => {
    render(<PricingPage />)

    expect(await screen.findByText('Pricing Intelligence')).toBeDefined()
  })

  test('muestra el buscador de productos', async () => {
    render(<PricingPage />)

    await waitFor(() => expect(mockGetProducts).toHaveBeenCalled())
    expect(screen.getByLabelText(/producto/i)).toBeDefined()
  })

  test('carga la política y avisa que son los valores de fábrica', async () => {
    render(<PricingPage />)

    expect(await screen.findByText(/valores de fábrica/i)).toBeDefined()
  })

  test('no rompe si la política no carga', async () => {
    // El comerciante tiene que poder ver los indicadores aunque la
    // configuración falle.
    mockGetPolicy.mockRejectedValue(new Error('500'))

    render(<PricingPage />)

    expect(await screen.findByText('Pricing Intelligence')).toBeDefined()
  })

  test('no rompe si el catálogo no carga', async () => {
    mockGetProducts.mockRejectedValue(new Error('500'))

    render(<PricingPage />)

    expect(await screen.findByText('Pricing Intelligence')).toBeDefined()
  })
})

// ─── Aplicar la recomendación ────────────────────────────────────────────────
//
// El motor recomendaba, la pantalla mostraba el número y no había forma de
// ejecutarlo: había que ir a Editar producto y tipearlo a mano. Este es el
// paso que hace que la función se cumpla.

const PRODUCTO = { _id: 'p1', title: 'Casco AGV', price: 100000 }

const RESULTADO = {
  found: true,
  analyzed: true,
  // Misma forma que devuelve buildPricingSignals.
  signals: {
    productId: 'p1',
    title: 'Casco AGV',
    price: 100000,
    stock: 5,
    cost: null,
    marginPercent: 12,
    demand: {
      unitsLast30: 2,
      unitsPrior30: 6,
      changePercent: -66.7,
      stockCoverageDays: 75,
    },
    costChangePercent: null,
    lastPriceChange: null,
    flags: ['margin_below_min'],
    warrantsAnalysis: true,
  },
  policy: { strategy: 'margin', mode: 'manual' },
  recommendation: {
    recommendedPrice: 129000,
    reason: 'El margen quedó abajo del mínimo',
    confidence: 0.8,
  },
  decision: {
    action: 'increase',
    finalPrice: 129000,
    changePercent: 29,
    requiresApproval: true,
    allowed: true,
    adjustments: [],
  },
}

describe('PricingPage · aplicar el precio', () => {
  beforeEach(() => {
    mockGetProducts.mockResolvedValue({ data: [PRODUCTO] })
    mockRecommend.mockResolvedValue({ success: true, data: RESULTADO })
    mockApplyPrice.mockResolvedValue({
      success: true,
      data: {
        previousPrice: 100000,
        newPrice: 129000,
        changePercent: 29,
        variantsUpdated: 0,
      },
    })
  })

  const elegirProductoYAnalizar = async () => {
    render(<PricingPage />)

    await waitFor(() => expect(mockGetProducts).toHaveBeenCalled())

    // El Autocomplete de MUI abre la lista al escribir, no al hacer foco.
    const buscador = screen.getByLabelText(/producto/i)
    await userEvent.type(buscador, 'Casco')

    const opcion = await screen.findByRole('option', { name: /Casco AGV/i })
    await userEvent.click(opcion)

    // El análisis no se dispara solo al elegir: lo pide el comerciante, porque
    // puede costar una llamada de IA.
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    await waitFor(() => expect(mockRecommend).toHaveBeenCalled())
    // Espera a que el resultado esté pintado antes de que el test asevere.
    await screen.findByText(/Precio actual/i, {}, { timeout: 5000 })
  }

  test('cada señal explica qué significa, no solo su nombre', async () => {
    // Antes eran etiquetas sueltas: "Margen bajo el mínimo" no le dice a nadie
    // qué hacer con eso.
    await elegirProductoYAnalizar()

    expect(
      await screen.findByText(/Qué encontramos en este producto/i),
    ).toBeDefined()
    expect(
      screen.getByText(/menos de lo que definiste como piso/i),
    ).toBeDefined()
  })

  test('el botón aplica el precio que dejó la política', async () => {
    await elegirProductoYAnalizar()

    const boton = await screen.findByRole('button', { name: /Aplicar/i })
    await userEvent.click(boton)

    await waitFor(() => expect(mockApplyPrice).toHaveBeenCalled())

    expect(mockApplyPrice).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'p1', price: 129000 }),
    )
  })

  test('después de aplicar dice qué cambió', async () => {
    await elegirProductoYAnalizar()

    await userEvent.click(
      await screen.findByRole('button', { name: /Aplicar/i }),
    )

    expect(await screen.findByText(/Precio actualizado/i)).toBeDefined()
  })
})

// Un producto sano también tiene que dejar pedir el análisis. Antes la
// pantalla terminaba en un cartel verde sin nada que tocar, y el backend ya
// aceptaba force.
describe('PricingPage · producto sin senales', () => {
  beforeEach(() => {
    mockGetProducts.mockResolvedValue({ data: [PRODUCTO] })
    mockRecommend.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        analyzed: false,
        recommendation: null,
        decision: null,
        signals: { ...RESULTADO.signals, flags: [], warrantsAnalysis: false },
      },
    })
  })

  test('deja pedir el analisis igual', async () => {
    render(<PricingPage />)

    await waitFor(() => expect(mockGetProducts).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText(/producto/i), 'Casco')
    await userEvent.click(
      await screen.findByRole('option', { name: /Casco AGV/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    await waitFor(() => expect(mockRecommend).toHaveBeenCalled())
    expect(await screen.findByText(/Nada que corregir/i)).toBeDefined()

    await userEvent.click(
      screen.getByRole('button', { name: /Analizar igual/i }),
    )

    expect(mockRecommend).toHaveBeenLastCalledWith(
      expect.objectContaining({ productId: 'p1', force: true }),
    )
  })
})

// Cuando la IA recomienda el precio que el producto ya tiene, eso es un
// resultado —"no lo toques"— y no un cambio a aplicar. Salía "$300 → $300",
// un 0.00% y un botón apagado debajo de un texto que prometía cambiar el
// precio.
describe('PricingPage · la recomendacion no cambia nada', () => {
  beforeEach(() => {
    mockGetProducts.mockResolvedValue({ data: [PRODUCTO] })
    mockRecommend.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        recommendation: {
          recommendedPrice: 100000,
          reason: 'No hay datos suficientes',
          confidence: 0.2,
        },
        decision: {
          action: 'hold',
          finalPrice: 100000,
          changePercent: 0,
          requiresApproval: false,
          allowed: true,
          adjustments: [],
        },
      },
    })
  })

  test('lo dice en palabras y no ofrece aplicar nada', async () => {
    render(<PricingPage />)

    await waitFor(() => expect(mockGetProducts).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText(/producto/i), 'Casco')
    await userEvent.click(
      await screen.findByRole('option', { name: /Casco AGV/i }),
    )
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    expect(await screen.findByText(/dejar el precio como está/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Aplicar/i })).toBeNull()
  })
})
