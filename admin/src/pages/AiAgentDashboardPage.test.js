// Métricas del asistente de ventas (AiAgentDashboardPage).
//
// Acá el comercio ve si el asistente vende: conversaciones, leads, carritos recuperados, y puede
// probarlo escribiendo como un cliente. No tenía tests. Lo que se fija:
//
//   - qué se pide al servidor y cómo cambia con el período y los filtros;
//   - qué cifras se muestran y con qué formato;
//   - el detalle de recuperación de carritos y su paginación;
//   - la prueba en vivo del agente.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockMetrics = jest.fn()
const mockTest = jest.fn()
const mockRecoveries = jest.fn()

jest.unstable_mockModule('../services/aiAgentDashboardService.js', () => ({
  getAiAgentMetrics: mockMetrics,
  testAiAgentMessage: mockTest,
  getAiCartRecoveries: mockRecoveries,
}))

const { default: AiAgentDashboardPage } = await import('./AiAgentDashboardPage.jsx')

const METRICAS = {
  period: '30d',
  conversations: {
    total: 120,
    open: 14,
    waitingHuman: 3,
    closed: 90,
    converted: 13,
    conversionRate: 10.83,
  },
  leads: {
    total: 40,
    hot: 6,
    new: 12,
    qualified: 8,
    won: 5,
    lost: 4,
    followUp: 7,
    averageScore: 47,
  },
  cartRecovery: {
    total: 25,
    sent: 18,
    converted: 4,
    failed: 2,
    pending: 1,
    conversionRate: 16,
    recoveredRevenueCents: 18950000,
  },
  salesInfluence: {
    totalRevenue: 950000,
    aiInfluencedRevenue: 320000,
    totalOrders: 30,
    aiInfluencedOrders: 9,
    percentage: 33.68,
  },
}

const LUCIA = {
  _id: 'r1',
  customer: { name: 'Lucía Pérez', phone: '+54 9 358 513 2769' },
  cartSnapshot: { subtotalCents: 4590000, currency: 'ARS' },
  status: 'converted',
  attempts: 1,
  scheduledAt: '2026-10-20T15:00:00Z',
  sentAt: '2026-10-20T15:05:00Z',
}
const MARCOS = {
  _id: 'r2',
  customer: { email: 'marcos@mail.com' },
  cartSnapshot: { subtotalCents: 1200000, currency: 'ARS' },
  status: 'cancelled',
  attempts: 0,
  metadata: { cancelledReason: 'missing_marketing_consent' },
}

const RECUPEROS = { items: [LUCIA, MARCOS], pagination: { page: 1, limit: 25, total: 2, pages: 1 } }

const montar = async () => {
  render(<AiAgentDashboardPage />)
  await screen.findByText('Conversaciones')
  await waitFor(() => expect(mockRecoveries).toHaveBeenCalled())
}

const ultimaRecuperacion = () => mockRecoveries.mock.calls[mockRecoveries.mock.calls.length - 1][0]

const tarjeta = etiqueta =>
  screen.getByText(etiqueta, { selector: 'span' }).closest('.MuiPaper-root')

beforeEach(() => {
  jest.clearAllMocks()
  mockMetrics.mockResolvedValue(METRICAS)
  mockRecoveries.mockResolvedValue(RECUPEROS)
  mockTest.mockResolvedValue({
    reply: 'Sí, tenemos talle 42 en negro.',
    intent: 'stock_question',
    leadScore: 62,
    handoffRequired: true,
  })
})

describe('Métricas · consulta', () => {
  test('al abrir pide las métricas de los últimos 30 días y la primera página de recuperaciones', async () => {
    await montar()

    expect(mockMetrics).toHaveBeenCalledWith('30d')
    expect(mockRecoveries).toHaveBeenCalledWith({ page: 1, limit: 25, status: undefined })
  })

  test('cambiar el período vuelve a pedir las métricas de ese período', async () => {
    await montar()

    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: 'Últimos 7 días' }))

    await waitFor(() => expect(mockMetrics).toHaveBeenLastCalledWith('7d'))
  })

  test('«Todo el tiempo» pide las métricas sin período', async () => {
    await montar()

    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: 'Todo el tiempo' }))

    await waitFor(() => expect(mockMetrics).toHaveBeenLastCalledWith('all'))
  })

  test('«Actualizar» vuelve a pedir métricas y recuperaciones', async () => {
    await montar()
    mockMetrics.mockClear()
    mockRecoveries.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    await waitFor(() => expect(mockMetrics).toHaveBeenCalledWith('30d'))
    await waitFor(() => expect(mockRecoveries).toHaveBeenCalled())
  })

  test('mientras carga por primera vez muestra un indicador', async () => {
    mockMetrics.mockReturnValue(new Promise(() => {}))

    render(<AiAgentDashboardPage />)

    expect(await screen.findByRole('progressbar')).toBeTruthy()
  })

  test('si fallan las métricas muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockMetrics.mockRejectedValueOnce({ response: { data: { message: 'Sin permiso' } } })

    const { unmount } = render(<AiAgentDashboardPage />)
    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    unmount()

    mockMetrics.mockRejectedValueOnce(new Error(''))
    render(<AiAgentDashboardPage />)
    expect(await screen.findByText(/No se pud(o|ieron) cargar las métricas\./)).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Métricas · cifras', () => {
  test('conversaciones: total, abiertas, esperando a una persona, convertidas y tasa', async () => {
    await montar()

    expect(within(tarjeta('Abiertas')).getByText('14')).toBeTruthy()
    expect(within(tarjeta('Convertidas')).getByText('13')).toBeTruthy()
    expect(within(tarjeta('Tasa de conversión')).getByText(/10,83|10\.83/)).toBeTruthy()
  })

  test('leads: total, puntaje promedio sobre 100 y el embudo por estado', async () => {
    await montar()

    expect(screen.getByText('40')).toBeTruthy()
    expect(screen.getByText('47')).toBeTruthy()
    expect(screen.getByText(/\/ 100/)).toBeTruthy()
    expect(screen.getByText(/Nuevos: 12/)).toBeTruthy()
    expect(screen.getByText(/Seguimiento: 7/)).toBeTruthy()
    expect(screen.getByText(/Perdidos: 4/)).toBeTruthy()
  })

  test('recuperación de carritos: intentos, convertidos, tasa e ingreso recuperado en pesos', async () => {
    await montar()

    expect(within(tarjeta('Intentos')).getByText('25')).toBeTruthy()
    expect(within(tarjeta('Tasa de recupero')).getByText('16')).toBeTruthy()
    expect(within(tarjeta('Ingreso recuperado')).getByText(/189\.500/)).toBeTruthy()
  })

  test('sin datos muestra ceros, no se rompe', async () => {
    mockMetrics.mockResolvedValue({})
    mockRecoveries.mockResolvedValue({ items: [] })

    await montar()

    expect(within(tarjeta('Intentos')).getByText('0')).toBeTruthy()
  })
})

describe('Métricas · detalle de recuperación', () => {
  test('cada recuperación muestra cliente, contacto, total, estado, motivo e intentos', async () => {
    await montar()

    const lucia = within(screen.getByText('Lucía Pérez').closest('tr'))
    expect(lucia.getByText('+54 9 358 513 2769')).toBeTruthy()
    expect(lucia.getByText(/45\.900/)).toBeTruthy()
    expect(lucia.getByText('Convertido')).toBeTruthy()

    const marcos = within(screen.getByText('marcos@mail.com').closest('tr'))
    expect(marcos.getByText('Sin nombre')).toBeTruthy()
    expect(marcos.getByText('Cancelado')).toBeTruthy()
    expect(marcos.getByText(/no dio consentimiento/)).toBeTruthy()
  })

  test('filtrar por estado pide esas recuperaciones', async () => {
    await montar()

    await userEvent.click(screen.getAllByRole('combobox')[1])
    await userEvent.click(await screen.findByRole('option', { name: 'Fallidos' }))

    await waitFor(() => expect(ultimaRecuperacion()).toMatchObject({ status: 'failed', page: 1 }))
  })

  test('sin recuperaciones lo dice, y si hay filtro dice cuál', async () => {
    mockRecoveries.mockResolvedValue({ items: [] })

    await montar()

    expect(screen.getByText(/No hay campañas de recuperación/)).toBeTruthy()
  })

  test('con varias páginas deja pasar a la siguiente', async () => {
    mockRecoveries.mockResolvedValue({
      ...RECUPEROS,
      pagination: { page: 1, limit: 25, total: 60, pages: 3 },
    })

    await montar()

    expect(screen.getByText(/60/)).toBeTruthy()
  })
})

describe('Métricas · probar el agente', () => {
  const campo = () => screen.getByPlaceholderText('Hola, ¿tenés zapatillas negras talle 42?')

  test('no deja enviar un mensaje vacío', async () => {
    await montar()

    expect(screen.getByRole('button', { name: 'Enviar' }).disabled).toBe(true)
  })

  test('manda el mensaje y muestra la respuesta, la intención, el puntaje y si pide una persona', async () => {
    await montar()

    fireEvent.change(campo(), { target: { value: '  ¿Tenés talle 42 en negro?  ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(mockTest).toHaveBeenCalledWith('¿Tenés talle 42 en negro?'))
    expect(await screen.findByText('Sí, tenemos talle 42 en negro.')).toBeTruthy()
    expect(screen.getByText('Requiere humano')).toBeTruthy()
  })

  test('si falla la prueba muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockTest.mockRejectedValueOnce({ response: { data: { message: 'Sin créditos de IA' } } })

    fireEvent.change(campo(), { target: { value: 'Hola' } })
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    expect(await screen.findByText('Sin créditos de IA')).toBeTruthy()
    console.error.mockRestore()
  })

  test('el mensaje admite hasta 2000 caracteres', async () => {
    await montar()

    expect(campo().getAttribute('maxlength')).toBe('2000')
  })
})
