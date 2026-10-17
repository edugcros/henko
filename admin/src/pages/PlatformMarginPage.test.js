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
import { render, screen, within } from '@testing-library/react'

const mockGetReport = jest.fn()

jest.unstable_mockModule('../services/platformService', () => ({
  getPlatformMarginReport: mockGetReport,
}))

const { default: PlatformMarginPage } = await import('./PlatformMarginPage.jsx')

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

const montar = async (informe = INFORME) => {
  mockGetReport.mockResolvedValue(informe)

  render(<PlatformMarginPage />)

  await screen.findByText('Margen de HENKO por comercio')
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

    expect(screen.getByText(/2026-10/)).toBeTruthy()

    const total = nombre => screen.getByText(nombre, { selector: 'span' }).parentElement

    expect(within(total('Comercios')).getByText('3')).toBeTruthy()
    expect(within(total('Ingreso por planes')).getByText(/32,000\.00/)).toBeTruthy()
    expect(within(total('Costo de IA')).getByText(/22,600\.50/)).toBeTruthy()
    expect(within(total('Comunicaciones')).getByText(/1,300\.00/)).toBeTruthy()
    expect(within(total('Infra + storage (plataforma)')).getByText(/6,000\.00/)).toBeTruthy()
    expect(within(total('Margen estimado')).getByText(/2,199\.50/)).toBeTruthy()
  })

  test('cuenta los comercios que pierden plata y cuánto pierden', async () => {
    await montar()

    const tarjeta = screen.getByText('Pierden plata').parentElement

    expect(within(tarjeta).getByText('1')).toBeTruthy()
    expect(within(tarjeta).getByText(/4,000\.00 en total/)).toBeTruthy()
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

    expect(lucia.getByText('starter')).toBeTruthy()
    expect(lucia.getByText('active')).toBeTruthy()
    expect(lucia.getByText(/15,000\.00/)).toBeTruthy()
    expect(lucia.getByText(/2,500\.50/)).toBeTruthy()
    expect(lucia.getByText(/300\.00/)).toBeTruthy()
    expect(lucia.getByText(/12,199\.50/)).toBeTruthy()
    expect(lucia.getByText('81.3%')).toBeTruthy()
  })

  test('un margen negativo se muestra con su porcentaje negativo', async () => {
    await montar()

    const moto = within(fila('Moto Repuestos Sur'))

    expect(moto.getByText('suspended')).toBeTruthy()
    expect(moto.getByText('-23.5%')).toBeTruthy()
  })

  test('un plan sin precio no inventa un porcentaje: «A medida» y un guion', async () => {
    await montar()

    const norte = within(fila('Distribuidora Norte'))

    expect(norte.getAllByText('A medida').length).toBeGreaterThan(0)
    expect(norte.getByText('—')).toBeTruthy()
    expect(norte.queryByText('0%')).toBeNull()
  })

  test('las notas del servidor se muestran al final', async () => {
    await montar()

    expect(screen.getByText('El margen por comercio no incluye infraestructura.')).toBeTruthy()
    expect(screen.getByText('El costo de IA sale del libro.')).toBeTruthy()
  })
})
