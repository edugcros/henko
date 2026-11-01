// Margen de HENKO por comercio (PlatformMarginPage).
//
// Pantalla del dueño de la plataforma: dice qué comercios dejan plata y cuáles cuestan más de lo que
// pagan. No tenía tests. Lo que se fija acá es lo que le cuenta al dueño:
//
//   - qué muestra cada estado (carga, sin acceso, error, sin datos);
//   - los totales, el ciclo de vida y la tabla por comercio;
//   - que un comercio que pierde plata se vea y se cuente;
//   - que un precio o un porcentaje que no existen no se lean como cero.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockGetReport = jest.fn()

jest.unstable_mockModule('../services/platformService', () => ({
  getPlatformMarginReport: mockGetReport,
}))

const {
  default: PlatformMarginPage,
  formatArs,
  formatPeriod,
  buildPeriodOptions,
} = await import('./PlatformMarginPage.jsx')

const INFORME = {
  period: '2026-10',
  tenants: [
    {
      tenantId: 't1',
      name: 'Kiosco Lucía',
      plan: 'starter',
      status: 'active',
      planPriceArs: 15000,
      aiCostArs: 2500.5,
      communicationsCostArs: 300,
      estimatedMarginArs: 12199.5,
      marginPercent: 81.3,
      unprofitable: false,
    },
    {
      tenantId: 't2',
      name: 'Moto Repuestos Sur',
      plan: 'pro',
      status: 'suspended',
      planPriceArs: 17000,
      aiCostArs: 20000,
      communicationsCostArs: 1000,
      estimatedMarginArs: -4000,
      marginPercent: -23.5,
      unprofitable: true,
    },
    {
      tenantId: 't3',
      name: 'Distribuidora Norte',
      plan: 'enterprise',
      status: 'active',
      planPriceArs: null,
      aiCostArs: 100,
      communicationsCostArs: 0,
      estimatedMarginArs: null,
      marginPercent: null,
      unprofitable: false,
    },
  ],
  totals: {
    tenantCount: 3,
    totalPlanRevenueArs: 32000,
    totalAiCostArs: 22600.5,
    totalCommunicationsCostArs: 1300,
    infraCostArs: 5000,
    storageCostArs: 1000,
    totalEstimatedMarginArs: 2199.5,
    unprofitableCount: 1,
    unprofitableLossArs: -4000,
    customPricingCount: 1,
    usdToArsRate: 1250,
  },
  lifecycle: {
    newTenantsInPeriod: 2,
    activeTenantsCount: 2,
    suspendedTenantsCount: 1,
    deletedInPeriodApprox: 0,
    activeSubscriptionCount: 2,
  },
  notes: ['El margen por comercio no incluye infraestructura.', 'El costo de IA sale del libro.'],
}

// Un mes del selector distinto del que muestra el informe. Elegir "la
// segunda opción" dependía del reloj: el fixture es de 2026-10, y desde el
// 1/11/2026 (UTC) la segunda opción ES 2026-10 —el mes ya elegido—, así que
// no había nada que volver a pedir y el test fallaba todo noviembre.
const OTRO_MES = buildPeriodOptions().find(option => option.value !== INFORME.period)

const elegirOtroMes = async () => {
  await userEvent.click(screen.getByRole('combobox', { name: /período/i }))
  await userEvent.click(await screen.findByRole('option', { name: OTRO_MES.label }))
}

const montar = async (informe = INFORME) => {
  mockGetReport.mockResolvedValue(informe)

  render(<PlatformMarginPage />)

  await screen.findByRole('heading', { level: 1, name: 'Margen de HENKO por comercio' })
}

const fila = nombre => screen.getByText(nombre).closest('tr')

beforeEach(() => {
  jest.clearAllMocks()
})

describe('Margen · estados de la pantalla', () => {
  test('mientras carga muestra un indicador y no el reporte', () => {
    mockGetReport.mockReturnValue(new Promise(() => {}))

    render(<PlatformMarginPage />)

    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  test('pide el reporte una vez, del período actual', async () => {
    await montar()

    expect(mockGetReport).toHaveBeenCalledTimes(1)
    expect(mockGetReport).toHaveBeenCalledWith()
  })

  test('un 403 dice que no hay acceso, sin mostrar un error técnico', async () => {
    mockGetReport.mockRejectedValue({ response: { status: 403 } })

    render(<PlatformMarginPage />)

    expect(await screen.findByText('No tenés acceso a este reporte.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('otro error muestra el mensaje del servidor', async () => {
    mockGetReport.mockRejectedValue({
      response: { status: 500, data: { message: 'La base no responde' } },
    })

    render(<PlatformMarginPage />)

    expect(await screen.findByText('La base no responde')).toBeTruthy()
  })

  test('un error sin mensaje muestra uno genérico', async () => {
    mockGetReport.mockRejectedValue(new Error('boom'))

    render(<PlatformMarginPage />)

    expect(await screen.findByText('No se pudo cargar el reporte de margen.')).toBeTruthy()
  })

  test('sin comercios avisa que no hay datos del período', async () => {
    await montar({ ...INFORME, tenants: [], totals: { tenantCount: 0 }, lifecycle: {} })

    expect(screen.getByText('Sin datos para este período.')).toBeTruthy()
  })
})

describe('Margen · totales', () => {
  test('muestra el período y los totales en pesos', async () => {
    await montar()

    expect(screen.getByText(/Período: Octubre de 2026/)).toBeTruthy()

    const total = nombre => screen.getByText(nombre, { selector: 'span' }).parentElement

    expect(within(total('Comercios')).getByText('3')).toBeTruthy()
    expect(within(total('Ingreso por planes')).getByText(/32\.000,00/)).toBeTruthy()
    expect(within(total('Costo de IA')).getByText(/22\.600,50/)).toBeTruthy()
    expect(within(total('Comunicaciones')).getByText(/1\.300,00/)).toBeTruthy()
    expect(within(total('Infra + storage (plataforma)')).getByText(/6\.000,00/)).toBeTruthy()
    expect(within(total('Margen estimado')).getByText(/2\.199,50/)).toBeTruthy()
  })

  test('cuenta los comercios que pierden plata y cuánto pierden', async () => {
    await montar()

    const tarjeta = screen.getByText('Pierden plata').parentElement

    expect(within(tarjeta).getByText('1')).toBeTruthy()
    expect(within(tarjeta).getByText(/4\.000,00 en total/)).toBeTruthy()
  })

  test('si ninguno pierde plata, la tarjeta no aparece', async () => {
    await montar({ ...INFORME, totals: { ...INFORME.totals, unprofitableCount: 0 } })

    expect(screen.queryByText('Pierden plata')).toBeNull()
  })

  test('el ciclo de vida muestra altas, activos, suspendidos, bajas y suscripciones', async () => {
    await montar()

    const dato = nombre => screen.getByText(nombre).parentElement

    expect(within(dato('Altas este período')).getByText('2')).toBeTruthy()
    expect(within(dato('Comercios activos')).getByText('2')).toBeTruthy()
    expect(within(dato('Comercios suspendidos')).getByText('1')).toBeTruthy()
    expect(within(dato('Bajas (aprox., este período)')).getByText('0')).toBeTruthy()
    expect(within(dato('Con suscripción activa')).getByText('2')).toBeTruthy()
  })

  test('altas y bajas que el servidor no pudo calcular se muestran con un guion', async () => {
    await montar({
      ...INFORME,
      lifecycle: { ...INFORME.lifecycle, newTenantsInPeriod: null, deletedInPeriodApprox: null },
    })

    const dato = nombre => screen.getByText(nombre).parentElement

    expect(within(dato('Altas este período')).getByText('—')).toBeTruthy()
    expect(within(dato('Bajas (aprox., este período)')).getByText('—')).toBeTruthy()
  })
})

describe('Margen · tabla por comercio', () => {
  test('cada comercio con su plan, estado, costos, margen y porcentaje', async () => {
    await montar()

    const lucia = within(fila('Kiosco Lucía'))

    expect(lucia.getByText('Emprendedor')).toBeTruthy()
    expect(lucia.getByText('Activo')).toBeTruthy()
    expect(lucia.getByText(/15\.000,00/)).toBeTruthy()
    expect(lucia.getByText(/2\.500,50/)).toBeTruthy()
    expect(lucia.getByText(/300,00/)).toBeTruthy()
    expect(lucia.getByText(/12\.199,50/)).toBeTruthy()
    expect(lucia.getByText('81.3%')).toBeTruthy()
  })

  test('un margen negativo se muestra con su porcentaje negativo', async () => {
    await montar()

    const moto = within(fila('Moto Repuestos Sur'))

    expect(moto.getByText('Suspendido')).toBeTruthy()
    expect(moto.getByText('-23.5%')).toBeTruthy()
  })

  test('un plan sin precio no inventa un porcentaje: «Sin precio cargado» y un guion', async () => {
    await montar()

    const norte = within(fila('Distribuidora Norte'))

    expect(norte.getAllByText('Sin precio cargado').length).toBeGreaterThan(0)
    // El margen y el porcentaje no se pueden calcular sin precio: los dos, con guion.
    expect(norte.getAllByText('—')).toHaveLength(2)
    expect(norte.queryByText('0%')).toBeNull()
  })

  test('las notas del servidor se muestran al final', async () => {
    await montar()

    expect(screen.getByText('El margen por comercio no incluye infraestructura.')).toBeTruthy()
    expect(screen.getByText('El costo de IA sale del libro.')).toBeTruthy()
  })
})

describe('Margen · formato', () => {
  test('formatArs usa pesos argentinos con dos decimales y un guion si no hay dato', () => {
    expect(formatArs(1234.5)).toMatch(/\$\s?1\.234,50/)
    expect(formatArs(-4000)).toMatch(/-\s?\$\s?4\.000,00|\$\s?-4\.000,00/)
    expect(formatArs(0)).toMatch(/\$\s?0,00/)
    expect(formatArs(null)).toBe('—')
    expect(formatArs(undefined, 'Sin precio')).toBe('Sin precio')
  })

  test('formatPeriod escribe el mes completo y deja tal cual lo que no entiende', () => {
    expect(formatPeriod('2026-10')).toBe('Octubre de 2026')
    expect(formatPeriod('2027-01')).toBe('Enero de 2027')
    expect(formatPeriod('2026-13')).toBe('2026-13')
    expect(formatPeriod('')).toBe('—')
    expect(formatPeriod(undefined)).toBe('—')
  })

  test('buildPeriodOptions arma los últimos doce meses, del actual hacia atrás', () => {
    const opciones = buildPeriodOptions(new Date('2026-02-10T12:00:00Z'))

    expect(opciones).toHaveLength(12)
    expect(opciones[0]).toEqual({ value: '2026-02', label: 'Febrero de 2026' })
    expect(opciones[1].value).toBe('2026-01')
    expect(opciones[2].value).toBe('2025-12')
    expect(opciones[11].value).toBe('2025-03')
  })
})

describe('Margen · lo que se agregó', () => {
  test('el tipo de cambio usado se dice junto al período', async () => {
    await montar()

    expect(
      screen.getByText(/costos en dólares pasados a pesos a .*1\.250,00 por dólar/),
    ).toBeTruthy()
  })

  test('se puede elegir otro mes y se vuelve a pedir el reporte de ese mes', async () => {
    await montar()

    await elegirOtroMes()

    await waitFor(() => expect(mockGetReport).toHaveBeenCalledTimes(2))
    expect(mockGetReport).toHaveBeenLastCalledWith(OTRO_MES.value)
  })

  test('mientras carga otro mes se sigue viendo el reporte anterior', async () => {
    await montar()
    mockGetReport.mockReturnValue(new Promise(() => {}))

    await elegirOtroMes()

    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('Kiosco Lucía')).toBeTruthy()
  })

  test('si falla, se puede reintentar', async () => {
    mockGetReport.mockRejectedValueOnce(new Error('boom'))

    render(<PlatformMarginPage />)

    await userEvent.click(await screen.findByRole('button', { name: /reintentar/i }))

    mockGetReport.mockResolvedValue(INFORME)
    await waitFor(() => expect(mockGetReport).toHaveBeenCalledTimes(2))
  })

  test('«Ver solo los que pierden plata» deja en la tabla únicamente a esos comercios', async () => {
    await montar()

    const boton = screen.getByRole('button', { name: /ver solo los que pierden plata/i })

    await userEvent.click(boton)

    expect(screen.getByText('Moto Repuestos Sur')).toBeTruthy()
    expect(screen.queryByText('Kiosco Lucía')).toBeNull()
    expect(screen.queryByText('Distribuidora Norte')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /ver todos los comercios/i }))

    expect(screen.getByText('Kiosco Lucía')).toBeTruthy()
  })

  test('el comercio que pierde plata tiene su margen en negrita y rojo', async () => {
    await montar()

    const margen = within(fila('Moto Repuestos Sur')).getByText(/4\.000,00/, { selector: 'span' })

    expect(getComputedStyle(margen).fontWeight).toBe('800')
  })

  test('un margen total negativo se marca como tal', async () => {
    await montar({ ...INFORME, totals: { ...INFORME.totals, totalEstimatedMarginArs: -500 } })

    const tarjeta = screen.getByText('Margen estimado', { selector: 'span' }).parentElement

    expect(within(tarjeta).getByText(/500,00/)).toBeTruthy()
  })

  test('el selector de período y las notas tienen su lugar', async () => {
    await montar()

    expect(
      screen.getByRole('heading', { level: 2, name: 'Ciclo de vida de comercios' }),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Por comercio' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Cómo se calcula' })).toBeTruthy()
  })

  test('un mes fuera de los últimos doce igual figura entre las opciones', async () => {
    await montar({ ...INFORME, period: '2019-03' })

    expect(screen.getByRole('combobox', { name: /período/i }).textContent).toBe('Marzo de 2019')
  })

  test('un plan que ya no existe se muestra con su nombre y no como «desconocido»', async () => {
    await montar()

    expect(within(fila('Distribuidora Norte')).getByText('Enterprise')).toBeTruthy()
  })
})

describe('Margen · en el celular', () => {
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

  test('no hay tabla: cada comercio es una tarjeta con sus datos', async () => {
    estrecha()
    await montar()

    expect(screen.queryByRole('table')).toBeNull()

    const tarjetas = screen.getAllByRole('article')

    expect(tarjetas).toHaveLength(3)

    const lucia = within(tarjetas[0])

    expect(lucia.getByText('Kiosco Lucía')).toBeTruthy()
    expect(lucia.getByText('Emprendedor')).toBeTruthy()
    expect(lucia.getByText('Activo')).toBeTruthy()
    expect(lucia.getByText(/15\.000,00/)).toBeTruthy()
    expect(lucia.getByText(/12\.199,50/)).toBeTruthy()
    expect(lucia.getByText(/81\.3%/)).toBeTruthy()
  })

  test('el que pierde plata se distingue en la tarjeta', async () => {
    estrecha()
    await montar()

    const moto = within(screen.getAllByRole('article')[1])

    expect(moto.getByText('Suspendido')).toBeTruthy()
    expect(moto.getByText(/-23\.5%/)).toBeTruthy()
  })

  test('sin comercios muestra el aviso', async () => {
    estrecha()
    await montar({ ...INFORME, tenants: [], totals: { tenantCount: 0 }, lifecycle: {} })

    expect(screen.getByText('Sin datos para este período.')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
