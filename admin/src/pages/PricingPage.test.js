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

    expect(await screen.findByText(/Qué encontramos en este producto/i)).toBeDefined()
    expect(screen.getByText(/menos de lo que definiste como piso/i)).toBeDefined()
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

    await userEvent.click(await screen.findByRole('button', { name: /Aplicar/i }))

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
    await userEvent.click(await screen.findByRole('option', { name: /Casco AGV/i }))
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    await waitFor(() => expect(mockRecommend).toHaveBeenCalled())
    expect(await screen.findByText(/Nada que corregir/i)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: /Analizar igual/i }))

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
    await userEvent.click(await screen.findByRole('option', { name: /Casco AGV/i }))
    await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

    expect(await screen.findByText(/dejar el precio como está/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Aplicar/i })).toBeNull()
  })
})

// ─── Rediseño: lo que la pantalla muestra y los caminos que no cubría nadie ───

const analizarProducto = async () => {
  render(<PricingPage />)

  await waitFor(() => expect(mockGetProducts).toHaveBeenCalled())
  await userEvent.type(screen.getByLabelText(/producto/i), 'Casco')
  await userEvent.click(await screen.findByRole('option', { name: /Casco AGV/i }))
  await userEvent.click(screen.getByRole('button', { name: /^Analizar$/i }))

  await waitFor(() => expect(mockRecommend).toHaveBeenCalled())
}

const conCosto = {
  unitCost: 60000,
  totalUnitCost: 66000,
  deductionRate: 0.12,
  breakEvenPrice: 75000,
  sources: { unitCost: 'stored', paymentFeePercent: 'measured' },
}

describe('PricingPage · estructura', () => {
  test('tiene un solo h1 y explica el recorrido en cuatro pasos ordenados', async () => {
    render(<PricingPage />)

    await screen.findByText('Pricing Intelligence')

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2, name: /cómo funciona/i })).toBeDefined()

    const pasos = screen.getAllByRole('listitem')
    expect(pasos).toHaveLength(4)
    expect(pasos[0].textContent).toMatch(/no gasta consumo de IA/i)
    expect(pasos[3].textContent).toMatch(/tu política/i)
  })
})

describe('PricingPage · indicadores', () => {
  beforeEach(() => {
    mockGetProducts.mockResolvedValue({ data: [PRODUCTO] })
  })

  test('con costo cargado muestra de dónde sale cada número', async () => {
    // Un margen sobre una comisión medida y uno sobre un porcentaje tipeado a ojo no valen lo mismo.
    mockRecommend.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        signals: { ...RESULTADO.signals, cost: conCosto, marginPercent: 9.1 },
      },
    })

    await analizarProducto()

    expect(await screen.findByText('Costo unitario')).toBeDefined()
    expect(screen.getByText('de la ficha')).toBeDefined()
    expect(screen.getByText('medido')).toBeDefined()
    expect(screen.getByText('Margen actual')).toBeDefined()
    expect(screen.getByText('9.1%')).toBeDefined()
  })

  test('sin costo cargado avisa y no inventa un margen', async () => {
    mockRecommend.mockResolvedValue({ success: true, data: RESULTADO })

    await analizarProducto()

    expect(await screen.findByText(/no tiene costo cargado/i)).toBeDefined()
    expect(screen.queryByText('Costo unitario')).toBeNull()
  })

  test('una unidad de stock no se escribe en plural', async () => {
    mockRecommend.mockResolvedValue({
      success: true,
      data: { ...RESULTADO, signals: { ...RESULTADO.signals, stock: 1 } },
    })

    await analizarProducto()

    expect(await screen.findByText('1 unidad')).toBeDefined()
    expect(screen.queryByText('1 unidades')).toBeNull()
  })

  test('sin ventas en el período lo dice, en vez de mostrar «null días»', async () => {
    mockRecommend.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        signals: {
          ...RESULTADO.signals,
          demand: { ...RESULTADO.signals.demand, stockCoverageDays: null },
        },
      },
    })

    await analizarProducto()

    expect(await screen.findByText(/sin ventas en el período/i)).toBeDefined()
    expect(screen.queryByText(/null días/i)).toBeNull()
  })
})

describe('PricingPage · la recomendación', () => {
  beforeEach(() => {
    mockGetProducts.mockResolvedValue({ data: [PRODUCTO] })
  })

  test('muestra el cambio, la confianza y el motivo de la IA', async () => {
    mockRecommend.mockResolvedValue({ success: true, data: RESULTADO })

    await analizarProducto()

    expect(await screen.findByText(/\$100\.000 → \$129\.000/)).toBeDefined()
    expect(screen.getByText('+29.00%')).toBeDefined()
    expect(screen.getByText('confianza 80%')).toBeDefined()
    expect(screen.getByText('El margen quedó abajo del mínimo')).toBeDefined()
  })

  test('si la política recortó la propuesta, lo dice y recuerda qué había propuesto la IA', async () => {
    mockRecommend.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        decision: {
          ...RESULTADO.decision,
          finalPrice: 110000,
          changePercent: 10,
          adjustments: ['clamped_by_max_change', 'rounded'],
        },
      },
    })

    await analizarProducto()

    expect(await screen.findByText(/tu política ajustó la propuesta/i)).toBeDefined()
    expect(screen.getByText(/recortado por el tope de variación/i)).toBeDefined()
    expect(screen.getByText('redondeado')).toBeDefined()
    expect(screen.getByText(/la IA había propuesto \$129\.000/i)).toBeDefined()
  })

  test('si la política no permite el cambio, lo dice y no ofrece aplicarlo', async () => {
    mockRecommend.mockResolvedValue({
      success: true,
      data: {
        ...RESULTADO,
        decision: {
          ...RESULTADO.decision,
          allowed: false,
          reason: 'Ningún precio alcanza el margen mínimo.',
        },
      },
    })

    await analizarProducto()

    expect(await screen.findByText('Ningún precio alcanza el margen mínimo.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Aplicar/i })).toBeNull()
  })

  test('un cambio fuera de lo que la política aplica sin revisar pide mirar el número', async () => {
    mockRecommend.mockResolvedValue({ success: true, data: RESULTADO })

    await analizarProducto()

    expect(await screen.findByText(/mirá el número antes de confirmarlo/i)).toBeDefined()
  })

  test('aplicar con variantes lo dice', async () => {
    mockRecommend.mockResolvedValue({ success: true, data: RESULTADO })
    mockApplyPrice.mockResolvedValue({
      success: true,
      data: { previousPrice: 100000, newPrice: 129000, changePercent: 29, variantsUpdated: 3 },
    })

    await analizarProducto()
    await userEvent.click(await screen.findByRole('button', { name: /Aplicar/i }))

    expect(await screen.findByText(/y 3 variantes en la misma proporción/i)).toBeDefined()
  })

  test('si aplicar falla, lo dice con el motivo', async () => {
    mockRecommend.mockResolvedValue({ success: true, data: RESULTADO })
    mockApplyPrice.mockRejectedValue({ response: { data: { message: 'El producto cambió.' } } })

    await analizarProducto()
    await userEvent.click(await screen.findByRole('button', { name: /Aplicar/i }))

    expect(await screen.findByText('El producto cambió.')).toBeDefined()
  })

  test('con la cuota de IA agotada avisa, pero los indicadores siguen a la vista', async () => {
    // Con cuota agotada el backend igual manda los indicadores: valen sin la explicación de la IA.
    mockRecommend.mockRejectedValue({
      response: {
        status: 429,
        data: {
          message: 'Se agotó la cuota de análisis de este mes.',
          data: { ...RESULTADO, analyzed: false, recommendation: null, decision: null },
        },
      },
    })

    await analizarProducto()

    expect(await screen.findByText(/se agotó la cuota de análisis/i)).toBeDefined()
    expect(screen.getByText('Precio actual')).toBeDefined()
  })

  test('si el análisis falla sin datos, lo dice', async () => {
    mockRecommend.mockRejectedValue(new Error('500'))

    await analizarProducto()

    expect(await screen.findByText(/no se pudo analizar el producto/i)).toBeDefined()
  })
})

describe('PricingPage · tus reglas de precio', () => {
  const abrirReglas = async () => {
    render(<PricingPage />)
    await screen.findByText(/valores de fábrica/i)
    await userEvent.click(screen.getByRole('button', { name: /tus reglas de precio/i }))
  }

  test('guarda lo que se cambió y lo confirma', async () => {
    mockUpdatePolicy.mockResolvedValue({
      success: true,
      data: { ...POLICY, minMarginPercent: 40, isDefault: false },
    })

    await abrirReglas()

    const margen = screen.getByLabelText('Margen mínimo (%)')
    await userEvent.clear(margen)
    await userEvent.type(margen, '40')
    await userEvent.click(screen.getByRole('button', { name: /guardar reglas/i }))

    await waitFor(() =>
      expect(mockUpdatePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ minMarginPercent: 40, strategy: 'margin', mode: 'manual' }),
      ),
    )
    expect(await screen.findByText('Política guardada.')).toBeDefined()
  })

  test('si no se puede guardar, lo dice con el motivo', async () => {
    mockUpdatePolicy.mockRejectedValue({
      response: { data: { message: 'El margen mínimo no puede superar al objetivo.' } },
    })

    await abrirReglas()
    await userEvent.click(screen.getByRole('button', { name: /guardar reglas/i }))

    expect(await screen.findByText('El margen mínimo no puede superar al objetivo.')).toBeDefined()
  })

  test('el redondeo se enciende y apaga', async () => {
    await abrirReglas()

    const interruptor = screen.getByRole('switch', { name: /terminados en 990/i })

    expect(interruptor.checked).toBe(true)

    await userEvent.click(interruptor)

    expect(interruptor.checked).toBe(false)
  })

  test('en modo automático avisa que los precios se mueven solos', async () => {
    mockGetPolicy.mockResolvedValue({ success: true, data: { ...POLICY, mode: 'autopilot' } })

    await abrirReglas()

    expect(screen.getByText(/los precios se van a mover solos/i)).toBeDefined()
  })

  test('sin política cargada, lo dice', async () => {
    mockGetPolicy.mockResolvedValue({ success: true, data: null })

    render(<PricingPage />)
    await userEvent.click(await screen.findByRole('button', { name: /tus reglas de precio/i }))

    expect(await screen.findByText(/no se pudo cargar la política/i)).toBeDefined()
  })
})
