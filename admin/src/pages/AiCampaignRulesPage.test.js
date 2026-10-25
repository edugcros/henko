// Campañas del asistente (AiCampaignRulesPage).
//
// Acá el comercio arma las reglas con las que el asistente escribe solo a sus clientes: carrito
// abandonado, seguimiento, post-compra, winback. Lo que se configura acá le llega a gente real
// por WhatsApp o correo. No tenía tests. Lo que se fija:
//
//   - qué se muestra de cada regla y el aviso de por qué la recuperación no corre;
//   - lo que se manda al crear, editar y eliminar;
//   - las conversiones del formulario (el monto se pide en pesos y se guarda en centavos);
//   - qué se avisa cuando algo sale bien o mal.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockList = jest.fn()
const mockUpsert = jest.fn()
const mockDelete = jest.fn()

jest.unstable_mockModule('../services/aiCampaignRuleService.js', () => ({
  listCampaignRules: mockList,
  upsertCampaignRule: mockUpsert,
  deleteCampaignRule: mockDelete,
}))

const { default: AiCampaignRulesPage } = await import('./AiCampaignRulesPage.jsx')

const CARRITO = {
  _id: 'r1',
  name: 'Recuperar carrito por WhatsApp',
  type: 'abandoned_cart',
  enabled: true,
  channel: 'whatsapp',
  messageTemplate: 'Hola {{customerName}}, te quedó {{productName}} en el carrito.',
  useAiPersonalization: true,
  trigger: {
    delayMinutes: 45,
    minCartAmountCents: 500000,
    maxAttempts: 3,
    onlyBusinessHours: true,
    businessHours: { start: '10:00', end: '19:00' },
    minHoursBetweenContacts: 8,
  },
  whatsappTemplate: { enabled: true, name: 'carrito_v1', languageCode: 'es_AR' },
  offer: { enabled: true, couponCode: 'VUELVE10' },
  stats: { sent: 12, conversions: 3 },
}
const WINBACK = {
  _id: 'r2',
  name: 'Volver a comprar',
  type: 'winback',
  enabled: false,
  channel: 'email',
  messageTemplate: 'Te extrañamos',
  trigger: {},
}

const montar = async (respuesta = { items: [CARRITO, WINBACK], readiness: { ready: true } }) => {
  mockList.mockResolvedValue(respuesta)
  render(<AiCampaignRulesPage />)
  await waitFor(() => expect(mockList).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
}

const tarjeta = nombre => screen.getByText(nombre).closest('.MuiPaper-root')
const dialogo = () => within(screen.getByRole('dialog'))
const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } })

beforeEach(() => {
  jest.clearAllMocks()
  mockUpsert.mockResolvedValue({})
  mockDelete.mockResolvedValue({})
})

describe('Campañas · lo que se ve', () => {
  test('cada regla muestra tipo, canal, estado, cupón, mensaje y su disparador', async () => {
    await montar()

    const carrito = within(tarjeta('Recuperar carrito por WhatsApp'))
    expect(carrito.getByText('Carrito abandonado')).toBeTruthy()
    expect(carrito.getByText('WhatsApp')).toBeTruthy()
    expect(carrito.getByText('Activa')).toBeTruthy()
    expect(carrito.getByText('Cupón: VUELVE10')).toBeTruthy()
    expect(carrito.getByText(/te quedó \{\{productName\}\}/)).toBeTruthy()
    expect(carrito.getByText(/45 min/)).toBeTruthy()
    expect(carrito.getByText(/10:00/)).toBeTruthy()
    expect(carrito.getByText(/Enviados: 12/)).toBeTruthy()

    const winback = within(tarjeta('Volver a comprar'))
    expect(winback.getByText('Inactiva')).toBeTruthy()
    expect(winback.getByText('Email')).toBeTruthy()
  })

  test('sin reglas lo dice', async () => {
    await montar({ items: [], readiness: null })

    expect(screen.getByText('No hay reglas de campaña configuradas.')).toBeTruthy()
  })

  test('si la recuperación no puede correr, explica por qué', async () => {
    await montar({ items: [CARRITO], readiness: { ready: false, reason: 'agent_disabled' } })

    expect(screen.getByText(/El asistente de IA está apagado/)).toBeTruthy()
  })

  test('un motivo desconocido muestra un aviso genérico', async () => {
    await montar({ items: [CARRITO], readiness: { ready: false, reason: 'otro' } })

    expect(screen.getByText(/no puede ejecutarse con la configuración actual/)).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValueOnce({ response: { data: { message: 'Sin permiso' } } })

    const { unmount } = render(<AiCampaignRulesPage />)
    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    unmount()

    mockList.mockRejectedValueOnce(new Error(''))
    render(<AiCampaignRulesPage />)
    expect(await screen.findByText('No se pudieron cargar las reglas de campaña.')).toBeTruthy()
    console.error.mockRestore()
  })

  test('«Actualizar» vuelve a pedir las reglas', async () => {
    await montar()
    mockList.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
  })
})

describe('Campañas · crear y editar', () => {
  test('crear sin nombre o sin mensaje no manda nada y avisa', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Solo nombre')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Nombre y plantilla de mensaje son obligatorios.')).toBeTruthy()
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  test('crear manda la regla con los valores por omisión y sin id', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Carrito')
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Hola {{customerName}}')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1))
    const [payload, id] = mockUpsert.mock.calls[0]
    expect(id).toBeUndefined()
    expect(payload).toMatchObject({
      name: 'Carrito',
      type: 'abandoned_cart',
      channel: 'whatsapp',
      enabled: true,
      messageTemplate: 'Hola {{customerName}}',
      trigger: {
        delayMinutes: 30,
        maxAttempts: 2,
        minHoursBetweenContacts: 6,
        minCartAmountCents: 0,
        onlyBusinessHours: true,
        businessHours: { start: '09:00', end: '20:00' },
      },
      offer: { enabled: false },
      whatsappTemplate: { enabled: false, languageCode: 'es_AR' },
    })
    expect(await screen.findByText('Regla creada.')).toBeTruthy()
  })

  test('editar abre la regla con sus datos y manda su id', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Recuperar carrito por WhatsApp')).getByRole('button', { name: 'Editar' }),
    )

    expect(dialogo().getByText('Editar regla')).toBeTruthy()
    expect(dialogo().getByLabelText('Nombre').value).toBe('Recuperar carrito por WhatsApp')
    expect(dialogo().getByLabelText('Código de cupón').value).toBe('VUELVE10')

    escribir(dialogo().getByLabelText('Nombre'), 'Carrito v2')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Carrito v2', type: 'abandoned_cart' }),
        'r1',
      ),
    )
    expect(mockUpsert.mock.calls[0][0]._id).toBeUndefined()
    expect(await screen.findByText('Regla actualizada.')).toBeTruthy()
  })

  test('el monto mínimo se pide en pesos y se manda en centavos', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Recuperar carrito por WhatsApp')).getByRole('button', { name: 'Editar' }),
    )
    const monto = dialogo().getByLabelText(/Monto mín\. carrito/)
    expect(monto.value).toBe('5000')

    escribir(monto, '12000')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockUpsert.mock.calls[0][0].trigger.minCartAmountCents).toBe(1200000),
    )
  })

  test('los campos del cupón y de la plantilla de WhatsApp solo aparecen si están activados', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))

    expect(dialogo().queryByLabelText('Código de cupón')).toBeNull()
    expect(dialogo().queryByLabelText('Nombre del template')).toBeNull()

    await userEvent.click(dialogo().getByRole('switch', { name: 'Incluir cupón de descuento' }))

    expect(dialogo().getByLabelText('Código de cupón')).toBeTruthy()
  })

  test('si falla guardar avisa y el diálogo sigue abierto', async () => {
    await montar()
    mockUpsert.mockRejectedValueOnce({
      response: { data: { message: 'Horario comercial inválido. Use HH:mm' } },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Nueva regla' }))
    escribir(dialogo().getByLabelText('Nombre'), 'Carrito')
    escribir(dialogo().getByLabelText('Plantilla de mensaje'), 'Hola')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Horario comercial inválido. Use HH:mm')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('Campañas · eliminar', () => {
  test('pide confirmar, manda el id y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    expect(dialogo().getByText(/¿Eliminar la regla "Volver a comprar"\?/)).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()

    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('r2'))
    expect(await screen.findByText('Regla eliminada.')).toBeTruthy()
  })

  test('cancelar no elimina', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('si falla eliminar avisa con el mensaje del servidor o uno genérico', async () => {
    await montar()
    mockDelete.mockRejectedValueOnce(new Error(''))

    await userEvent.click(
      within(tarjeta('Volver a comprar')).getByRole('button', { name: 'Eliminar' }),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    expect(await screen.findByText('Error al eliminar.')).toBeTruthy()
  })
})
