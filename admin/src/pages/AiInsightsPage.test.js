// Diagnóstico (AiInsightsPage).
//
// HENKO detecta problemas del negocio con datos reales (un producto que no vende, una caída de la
// conversión, un cliente que dejó de comprar) y propone qué hacer. Algunas acciones cambian cosas
// de verdad: mandan un mensaje a un cliente, refuerzan las reglas de recuperación o bajan un precio.
// No tenía tests. Lo que se fija:
//
//   - la consulta y los filtros;
//   - qué se muestra de cada diagnóstico según su tipo y su estado;
//   - lo que se manda en cada acción, y que nada se aplica sin confirmar.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockList = jest.fn()
const mockAck = jest.fn()
const mockDismiss = jest.fn()
const mockArchive = jest.fn()
const mockPreviewReact = jest.fn()
const mockSendReact = jest.fn()
const mockPreviewReinf = jest.fn()
const mockApplyReinf = jest.fn()
const mockPreviewPrice = jest.fn()
const mockApplyPrice = jest.fn()

jest.unstable_mockModule('../services/aiInsightService.js', () => ({
  listInsights: mockList,
  acknowledgeInsight: mockAck,
  dismissInsight: mockDismiss,
  archiveInsight: mockArchive,
  previewReactivationMessage: mockPreviewReact,
  sendReactivationMessage: mockSendReact,
  previewCartRecoveryReinforcement: mockPreviewReinf,
  applyCartRecoveryReinforcement: mockApplyReinf,
  previewPriceReduction: mockPreviewPrice,
  applyPriceReduction: mockApplyPrice,
}))

const { default: AiInsightsPage } = await import('./AiInsightsPage.jsx')

const PRODUCTO = {
  _id: 'i1',
  type: 'product_underperformance',
  status: 'pending_review',
  priority: 'high',
  entity: { label: 'Zapatillas Runner' },
  title: 'Bajo rendimiento: Zapatillas Runner',
  description: '"Zapatillas Runner" tuvo 120 visitas y solo 1 compra.',
  evidence: { views: 120, purchases: 1, conversionRate: 0.83, days: 30 },
}
const CLIENTE = {
  _id: 'i2',
  type: 'customer_inactivity',
  status: 'pending_review',
  priority: 'medium',
  entity: { label: 'Lucía Pérez' },
  title: 'Cliente inactivo: Lucía Pérez',
  description: 'Lucía Pérez hizo 4 compras antes, pero no compra hace 95 días.',
  evidence: { orderCount: 4, lastOrderAt: '2026-07-20T00:00:00.000Z', daysSinceLastOrder: 95 },
}
const RECUPERO = {
  _id: 'i3',
  type: 'cart_recovery_underperformance',
  status: 'measuring',
  priority: 'high',
  title: 'La recuperación de carritos cayó',
  description: 'La tasa de recupero bajó.',
  evidence: { currentConversionRate: 5, previousConversionRate: 12, dropPct: 58, windowDays: 14 },
  measurement: { measureAfterDate: '2026-11-10T00:00:00.000Z' },
}
const MEDIDO = {
  _id: 'i4',
  type: 'cart_conversion_drop',
  status: 'resolved',
  priority: 'medium',
  title: 'La conversión general cayó',
  description: 'Bajó la conversión.',
  measurement: { metricName: 'conversionRate', beforeValue: 1.2, afterValue: 1.9 },
}
const DESCARTADO = {
  _id: 'i5',
  type: 'campaign_underperformance',
  status: 'dismissed',
  title: 'Campaña de bajo rendimiento: verano',
  description: 'Pocas compras.',
  dismissReason: 'Ya la pausamos',
}

const RESPUESTA = {
  items: [PRODUCTO, CLIENTE, RECUPERO],
  counters: { pending_review: 2, measuring: 1, resolved: 3, dismissed: 1, archived: 0 },
  pagination: { page: 1, limit: 50, total: 3, pages: 1 },
}

const montar = async (respuesta = RESPUESTA) => {
  mockList.mockResolvedValue(respuesta)
  render(<AiInsightsPage />)
  await waitFor(() => expect(mockList).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
}

const ultimaConsulta = () => mockList.mock.calls[mockList.mock.calls.length - 1][0]
const tarjeta = titulo => screen.getByText(titulo).closest('.MuiPaper-root')
const dialogo = () => within(screen.getByRole('dialog'))
const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } })

beforeEach(() => {
  jest.clearAllMocks()
  for (const fn of [
    mockAck,
    mockDismiss,
    mockArchive,
    mockSendReact,
    mockApplyReinf,
    mockApplyPrice,
  ]) {
    fn.mockResolvedValue({})
  }
  mockPreviewReact.mockResolvedValue({ message: 'Hola Lucía, te extrañamos.' })
  mockPreviewReinf.mockResolvedValue({
    hasChanges: true,
    plans: [
      {
        ruleId: 'r1',
        channel: 'whatsapp',
        changed: true,
        before: { maxAttempts: 1, minCartAmountCents: 500000, useAiPersonalization: false },
        after: { maxAttempts: 3, minCartAmountCents: 200000, useAiPersonalization: true },
      },
    ],
  })
  mockPreviewPrice.mockResolvedValue({
    currentPrice: 50000,
    suggestedPrice: 45000,
    reductionPct: 10,
    cappedByCost: false,
    hasVariants: false,
  })
})

describe('Diagnóstico · consulta', () => {
  test('al abrir pide los pendientes, de a 50', async () => {
    await montar()

    expect(mockList).toHaveBeenCalledWith({
      status: 'pending_review',
      type: undefined,
      page: 1,
      limit: 50,
    })
  })

  test('cambiar el estado o el tipo vuelve a pedir con ese filtro', async () => {
    await montar()

    await userEvent.click(screen.getByRole('combobox', { name: 'Estado' }))
    await userEvent.click(await screen.findByRole('option', { name: /En curso/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('measuring'))

    await userEvent.click(screen.getByRole('combobox', { name: 'Tipo' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Cliente inactivo' }))
    await waitFor(() => expect(ultimaConsulta().type).toBe('customer_inactivity'))
  })

  test('el subtítulo dice cuántos esperan revisión', async () => {
    await montar()

    expect(screen.getByText(/2 pendiente\(s\) de revisión\./)).toBeTruthy()
  })

  test('sin diagnósticos lo dice', async () => {
    await montar({ items: [], counters: {} })

    expect(screen.getByText('No hay insights para este filtro.')).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValueOnce({ response: { data: { message: 'Sin permiso' } } })

    const { unmount } = render(<AiInsightsPage />)
    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    unmount()

    mockList.mockRejectedValueOnce(new Error(''))
    render(<AiInsightsPage />)
    expect(await screen.findByText('No se pudieron cargar los insights.')).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Diagnóstico · lo que se ve', () => {
  test('cada diagnóstico muestra tipo, entidad, título, descripción y evidencia', async () => {
    await montar()

    const producto = within(tarjeta('Bajo rendimiento: Zapatillas Runner'))
    expect(producto.getByText('Producto')).toBeTruthy()
    expect(producto.getByText('Zapatillas Runner')).toBeTruthy()
    expect(producto.getByText(/tuvo 120 visitas/)).toBeTruthy()
  })

  test('uno en curso dice cuándo se vuelve a medir', async () => {
    await montar()

    expect(
      within(tarjeta('La recuperación de carritos cayó')).getByText(/Se vuelve a medir el/),
    ).toBeTruthy()
  })

  test('uno medido muestra el antes y el después', async () => {
    await montar({ ...RESPUESTA, items: [MEDIDO] })

    expect(screen.getByText(/1,2|1\.2/)).toBeTruthy()
    expect(screen.getByText(/1,9|1\.9/)).toBeTruthy()
  })

  test('uno descartado muestra el motivo', async () => {
    await montar({ ...RESPUESTA, items: [DESCARTADO] })

    expect(screen.getByText(/Ya la pausamos/)).toBeTruthy()
  })
})

describe('Diagnóstico · acciones según el estado', () => {
  test('los pendientes ofrecen marcar en curso y descartar; los medidos y descartados, archivar', async () => {
    await montar({ ...RESPUESTA, items: [PRODUCTO, MEDIDO, DESCARTADO] })

    const producto = within(tarjeta('Bajo rendimiento: Zapatillas Runner'))
    expect(producto.getByRole('button', { name: 'Marcar en curso' })).toBeTruthy()
    expect(producto.getByRole('button', { name: 'Descartar' })).toBeTruthy()

    expect(
      within(tarjeta('La conversión general cayó')).getByRole('button', { name: 'Archivar' }),
    ).toBeTruthy()
    expect(
      within(tarjeta('Campaña de bajo rendimiento: verano')).getByRole('button', {
        name: 'Archivar',
      }),
    ).toBeTruthy()
  })

  test('cada tipo ofrece su acción: reducir precio, reactivar cliente, reforzar recuperación', async () => {
    await montar()

    expect(
      within(tarjeta('Bajo rendimiento: Zapatillas Runner')).getByRole('button', {
        name: 'Reducir precio',
      }),
    ).toBeTruthy()
    expect(
      within(tarjeta('Cliente inactivo: Lucía Pérez')).getByRole('button', {
        name: 'Reactivar cliente',
      }),
    ).toBeTruthy()
    expect(
      within(tarjeta('La recuperación de carritos cayó')).getByRole('button', {
        name: 'Reforzar recuperación',
      }),
    ).toBeTruthy()
  })

  test('marcar en curso manda el id y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Bajo rendimiento: Zapatillas Runner')).getByRole('button', {
        name: 'Marcar en curso',
      }),
    )

    await waitFor(() => expect(mockAck).toHaveBeenCalledWith('i1'))
    expect(await screen.findByText('Insight marcado en curso.')).toBeTruthy()
  })

  test('descartar pide un motivo opcional y lo manda', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Bajo rendimiento: Zapatillas Runner')).getByRole('button', {
        name: 'Descartar',
      }),
    )
    escribir(dialogo().getByLabelText(/Motivo/), '  Ya lo cambiamos  ')
    await userEvent.click(dialogo().getByRole('button', { name: 'Descartar' }))

    await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith('i1', 'Ya lo cambiamos'))
  })

  test('archivar manda el id', async () => {
    await montar({ ...RESPUESTA, items: [MEDIDO] })

    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }))

    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith('i4'))
  })

  test('si falla una acción muestra el mensaje del servidor', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockAck.mockRejectedValueOnce({ response: { data: { message: 'Ya está en curso' } } })

    await userEvent.click(
      within(tarjeta('Bajo rendimiento: Zapatillas Runner')).getByRole('button', {
        name: 'Marcar en curso',
      }),
    )

    expect(await screen.findByText('Ya está en curso')).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Diagnóstico · acciones que cambian cosas, siempre con confirmación', () => {
  test('reactivar arma el mensaje, deja editarlo y recién al confirmar lo manda', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cliente inactivo: Lucía Pérez')).getByRole('button', {
        name: 'Reactivar cliente',
      }),
    )

    await waitFor(() => expect(mockPreviewReact).toHaveBeenCalledWith('i2'))
    const campo = await dialogo().findByLabelText('Mensaje')
    expect(campo.value).toBe('Hola Lucía, te extrañamos.')
    expect(mockSendReact).not.toHaveBeenCalled()

    escribir(campo, 'Hola Lucía, volvé con 10% off.')
    await userEvent.click(dialogo().getByRole('button', { name: 'Enviar mensaje' }))

    await waitFor(() =>
      expect(mockSendReact).toHaveBeenCalledWith('i2', 'Hola Lucía, volvé con 10% off.'),
    )
    expect(await screen.findByText('Mensaje de reactivación enviado.')).toBeTruthy()
  })

  test('si falla el envío, el diálogo sigue abierto con el error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockSendReact.mockRejectedValueOnce(new Error('Sin canal'))

    await userEvent.click(
      within(tarjeta('Cliente inactivo: Lucía Pérez')).getByRole('button', {
        name: 'Reactivar cliente',
      }),
    )
    await dialogo().findByLabelText('Mensaje')
    await userEvent.click(dialogo().getByRole('button', { name: 'Enviar mensaje' }))

    expect(await dialogo().findByText('Sin canal')).toBeTruthy()
    console.error.mockRestore()
  })

  test('reforzar muestra el plan antes/después y lo aplica al confirmar', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('La recuperación de carritos cayó')).getByRole('button', {
        name: 'Reforzar recuperación',
      }),
    )

    expect(await dialogo().findByText('1 → 3')).toBeTruthy()
    expect(dialogo().getByText(/\$5000 → \$2000/)).toBeTruthy()
    expect(dialogo().getByText('Desactivada → Activada')).toBeTruthy()
    expect(mockApplyReinf).not.toHaveBeenCalled()

    await userEvent.click(dialogo().getByRole('button', { name: 'Aplicar refuerzo' }))

    await waitFor(() => expect(mockApplyReinf).toHaveBeenCalledWith('i3'))
  })

  test('si no hay nada para reforzar, lo dice y no deja aplicar', async () => {
    await montar()
    mockPreviewReinf.mockResolvedValueOnce({ hasChanges: false, plans: [] })

    await userEvent.click(
      within(tarjeta('La recuperación de carritos cayó')).getByRole('button', {
        name: 'Reforzar recuperación',
      }),
    )

    expect(await dialogo().findByText(/ya está al máximo/)).toBeTruthy()
    expect(dialogo().getByRole('button', { name: 'Aplicar refuerzo' }).disabled).toBe(true)
  })

  test('reducir precio propone uno, deja cambiarlo y lo aplica al confirmar', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Bajo rendimiento: Zapatillas Runner')).getByRole('button', {
        name: 'Reducir precio',
      }),
    )

    const precio = await dialogo().findByLabelText('Precio nuevo')
    expect(precio.value).toBe('45000')
    expect(mockApplyPrice).not.toHaveBeenCalled()

    escribir(precio, '42000')
    await userEvent.click(dialogo().getByRole('button', { name: 'Aplicar precio' }))

    await waitFor(() => expect(mockApplyPrice).toHaveBeenCalledWith('i1', 42000))
    expect(await screen.findByText('Precio actualizado.')).toBeTruthy()
  })

  test('no deja aplicar un precio igual o mayor al actual', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Bajo rendimiento: Zapatillas Runner')).getByRole('button', {
        name: 'Reducir precio',
      }),
    )
    const precio = await dialogo().findByLabelText('Precio nuevo')

    escribir(precio, '50000')

    expect(dialogo().getByRole('button', { name: 'Aplicar precio' }).disabled).toBe(true)
  })
})
