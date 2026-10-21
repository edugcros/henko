// Bandeja comercial del agente de IA (AiCommercialInboxPage).
//
// Acá el comercio sigue a las personas que hablaron con el asistente web: quién está caliente, a
// quién hay que volver a escribir, qué producto miraba, qué se le dijo. Es una pantalla de tres
// paneles (leads, detalle, conversación) y las acciones (ganado, perdido, eliminar) cambian datos
// comerciales de verdad. No tenía tests. Lo que se fija:
//
//   - qué se pide al servidor y cómo cambia con cada filtro y cada lead elegido;
//   - qué se ve en cada panel;
//   - qué se manda en cada acción comercial y qué pasa después;
//   - qué se avisa cuando algo falla.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockSummary = jest.fn()
const mockLeads = jest.fn()
const mockLeadById = jest.fn()
const mockStatus = jest.fn()
const mockNote = jest.fn()
const mockFollowUp = jest.fn()
const mockWon = jest.fn()
const mockLost = jest.fn()
const mockDiscard = jest.fn()
const mockDelete = jest.fn()
const mockPermanent = jest.fn()
const mockRemoveProduct = jest.fn()
const mockUpdateProducts = jest.fn()
const mockDeleteConversation = jest.fn()

jest.unstable_mockModule('../services/aiLeadService.js', () => ({
  getAiLeadSummary: mockSummary,
  getAiLeads: mockLeads,
  getAiLeadById: mockLeadById,
  updateAiLeadStatus: mockStatus,
  addAiLeadNote: mockNote,
  scheduleAiLeadFollowUp: mockFollowUp,
  markAiLeadWon: mockWon,
  markAiLeadLost: mockLost,
  discardAiLead: mockDiscard,
  deleteAiLead: mockDelete,
  permanentlyDeleteAiLead: mockPermanent,
  removeAiLeadProductOfInterest: mockRemoveProduct,
  updateAiLeadProductsOfInterest: mockUpdateProducts,
}))

jest.unstable_mockModule('../services/aiAgentAdminService.js', () => ({
  permanentlyDeleteAiConversation: mockDeleteConversation,
}))

const { default: AiCommercialInboxPage } = await import('./AiCommercialInboxPage.js')

const LUCIA = {
  id: 'l1',
  displayName: 'Lucía Pérez',
  status: 'hot',
  leadScore: 85,
  intent: 'purchase_intent',
  customer: { name: 'Lucía Pérez', email: 'lucia@mail.com', phone: '+54 9 358 513 2769' },
  productsOfInterest: [
    {
      productId: 'p1',
      title: 'Zapatillas Runner',
      slug: 'zapatillas-runner',
      price: 45000,
      lastMentionedAt: '2026-10-20T15:00:00.000Z',
    },
  ],
  notes: [
    {
      _id: 'n1',
      text: 'Pidió factura A',
      createdByName: 'Marta',
      createdAt: '2026-10-19T12:00:00Z',
    },
  ],
  lastMessage: '¿Tienen talle 40?',
  nextFollowUpAt: null,
  lastInteractionAt: '2026-10-20T15:00:00.000Z',
}
const MARCOS = {
  id: 'l2',
  displayName: 'Marcos Gil',
  status: 'new',
  leadScore: 20,
  customer: { email: 'marcos@mail.com' },
  productsOfInterest: [],
  notes: [],
  lastMessage: 'Hola, buenas',
  lastInteractionAt: '2026-10-19T10:00:00.000Z',
}

const DETALLE = {
  l1: {
    lead: LUCIA,
    conversation: {
      _id: 'c1',
      channel: 'webchat',
      status: 'open',
      messages: [
        {
          _id: 'm1',
          role: 'user',
          content: '¿Tienen talle 40?',
          createdAt: '2026-10-20T14:58:00Z',
        },
        {
          _id: 'm2',
          role: 'assistant',
          content: 'Sí, nos quedan 3.',
          createdAt: '2026-10-20T14:59:00Z',
        },
      ],
    },
    conversations: [
      { id: 'c1', messageCount: 2, lastMessageAt: '2026-10-20T14:59:00Z' },
      { id: 'c0', messageCount: 5, lastMessageAt: '2026-10-10T09:00:00Z' },
    ],
  },
  l2: {
    lead: MARCOS,
    conversation: {
      _id: 'c9',
      channel: 'webchat',
      status: 'open',
      messages: [
        { _id: 'm9', role: 'user', content: 'Hola, buenas', createdAt: '2026-10-19T10:00:00Z' },
      ],
    },
    conversations: [{ id: 'c9', messageCount: 1, lastMessageAt: '2026-10-19T10:00:00Z' }],
  },
}

const RESUMEN = {
  total: 12,
  today: 3,
  new: 5,
  qualified: 2,
  hot: 4,
  followUp: 1,
  won: 6,
  lost: 1,
  discarded: 0,
  pendingFollowUps: 2,
  averageLeadScore: 54,
}

const montar = async () => {
  render(<AiCommercialInboxPage />)

  await screen.findByText('Gestión comercial')
}

const ultimaConsulta = () => mockLeads.mock.calls[mockLeads.mock.calls.length - 1][0]

const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } })

const panelDetalle = () => screen.getByText('Gestión comercial').closest('.MuiPaper-root')
const panelConversacion = () => screen.getByText('Conversación').closest('.MuiPaper-root')
const dialogo = () => within(screen.getByRole('dialog'))

beforeEach(() => {
  jest.clearAllMocks()
  mockSummary.mockResolvedValue(RESUMEN)
  mockLeads.mockResolvedValue({
    items: [LUCIA, MARCOS],
    pagination: { page: 1, pages: 1, total: 2 },
  })
  mockLeadById.mockImplementation(async id => DETALLE[id])
  for (const fn of [
    mockStatus,
    mockNote,
    mockFollowUp,
    mockWon,
    mockLost,
    mockDiscard,
    mockDelete,
    mockPermanent,
    mockRemoveProduct,
    mockUpdateProducts,
    mockDeleteConversation,
  ]) {
    fn.mockResolvedValue({})
  }
})

describe('Bandeja comercial · consulta', () => {
  test('al abrir pide el resumen, los leads por puntaje de a 30, y abre el primero', async () => {
    await montar()

    expect(mockSummary).toHaveBeenCalled()
    expect(mockLeads).toHaveBeenCalledWith({
      page: 1,
      limit: 30,
      status: 'all',
      intent: 'all',
      q: undefined,
      sort: 'score',
    })
    expect(mockLeadById).toHaveBeenCalledWith('l1', { conversationId: undefined })
  })

  test('elegir otro lead abre su detalle', async () => {
    await montar()

    await userEvent.click(screen.getByText('Marcos Gil').closest('[role="button"]'))

    await waitFor(() =>
      expect(mockLeadById).toHaveBeenCalledWith('l2', { conversationId: undefined }),
    )
    await waitFor(() => expect(within(panelConversacion()).getByText('Hola, buenas')).toBeTruthy())
  })

  test('cambiar el estado o la intención vuelve a pedir con ese filtro', async () => {
    await montar()

    await userEvent.click(screen.getAllByRole('combobox', { name: 'Estado' })[0])
    await userEvent.click(await screen.findByRole('option', { name: 'Calientes' }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('hot'))

    await userEvent.click(screen.getByRole('combobox', { name: 'Intención' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Precio' }))
    await waitFor(() => expect(ultimaConsulta().intent).toBe('price_check'))
  })

  test('buscar manda el texto como `q`', async () => {
    await montar()

    escribir(screen.getByLabelText('Buscar'), 'zapatillas')

    await waitFor(() => expect(ultimaConsulta().q).toBe('zapatillas'))
  })

  test('«Filtrar» vuelve a pedir lo mismo', async () => {
    await montar()
    mockLeads.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }))

    await waitFor(() => expect(mockLeads).toHaveBeenCalledTimes(1))
  })

  test('«Actualizar» vuelve a pedir el resumen, los leads y el detalle', async () => {
    await montar()
    jest.clearAllMocks()
    mockSummary.mockResolvedValue(RESUMEN)
    mockLeads.mockResolvedValue({ items: [LUCIA, MARCOS] })
    mockLeadById.mockImplementation(async id => DETALLE[id])

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }))

    await waitFor(() => expect(mockSummary).toHaveBeenCalled())
    await waitFor(() => expect(mockLeads).toHaveBeenCalled())
    await waitFor(() =>
      expect(mockLeadById).toHaveBeenCalledWith('l1', { conversationId: undefined }),
    )
  })
})

describe('Bandeja comercial · lo que se ve', () => {
  test('el resumen trae total, nuevos hoy, calientes, seguimientos, ganados y puntaje promedio', async () => {
    await montar()

    for (const [etiqueta, valor] of [
      ['Total', '12'],
      ['Nuevos hoy', '3'],
      ['Calientes', '4'],
      ['Seguimientos', '2'],
      ['Ganados', '6'],
      ['Score prom.', '54'],
    ]) {
      const tarjeta = screen.getByText(etiqueta, { selector: 'span' }).closest('.MuiPaper-root')
      expect(within(tarjeta).getByText(valor)).toBeTruthy()
    }
  })

  test('cada lead muestra nombre, contacto, producto, último mensaje, estado y puntaje', async () => {
    await montar()

    const fila = within(screen.getAllByText('Lucía Pérez')[0].closest('[role="button"]'))

    expect(fila.getByText('lucia@mail.com')).toBeTruthy()
    expect(fila.getByText('Producto: Zapatillas Runner')).toBeTruthy()
    expect(fila.getByText('¿Tienen talle 40?')).toBeTruthy()
    expect(fila.getByText('Caliente')).toBeTruthy()
    expect(fila.getByText('Score 85')).toBeTruthy()
  })

  test('un lead sin producto ni contacto lo dice', async () => {
    mockLeads.mockResolvedValue({
      items: [{ ...MARCOS, customer: {}, productsOfInterest: [], lastMessage: '' }],
    })

    await montar()

    expect(screen.getByText('Sin datos de contacto')).toBeTruthy()
    expect(screen.getByText('Producto: Sin producto detectado')).toBeTruthy()
    expect(screen.getByText('Sin último mensaje registrado')).toBeTruthy()
  })

  test('sin leads lo dice', async () => {
    mockLeads.mockResolvedValue({ items: [] })

    render(<AiCommercialInboxPage />)

    expect(await screen.findByText('No hay leads para este filtro')).toBeTruthy()
    expect(screen.getByText('Seleccioná un lead para ver acciones comerciales.')).toBeTruthy()
  })

  test('el detalle muestra los datos del cliente, el próximo seguimiento, los productos y las notas', async () => {
    await montar()

    const detalle = within(panelDetalle())

    expect(detalle.getByText('Nombre: Lucía Pérez')).toBeTruthy()
    expect(detalle.getByText('Email: lucia@mail.com')).toBeTruthy()
    expect(detalle.getByText('Teléfono: +54 9 358 513 2769')).toBeTruthy()
    expect(detalle.getByText('Próximo seguimiento: Sin fecha')).toBeTruthy()
    expect(detalle.getByText('Zapatillas Runner')).toBeTruthy()
    expect(detalle.getByText(/zapatillas-runner · \$45\.000/)).toBeTruthy()
    expect(detalle.getByText('Pidió factura A')).toBeTruthy()
    expect(detalle.getByText(/Marta · /)).toBeTruthy()
  })

  test('la conversación muestra quién dijo qué y cuántos mensajes hay', async () => {
    await montar()

    const conversacion = within(panelConversacion())

    expect(conversacion.getByText('2 mensajes')).toBeTruthy()
    expect(conversacion.getByText('Cliente')).toBeTruthy()
    expect(conversacion.getByText('IA')).toBeTruthy()
    expect(conversacion.getByText('¿Tienen talle 40?')).toBeTruthy()
    expect(conversacion.getByText('Sí, nos quedan 3.')).toBeTruthy()
  })

  test('con varias conversaciones del mismo cliente se pueden abrir una por una', async () => {
    await montar()

    expect(screen.getByText('2 conversaciones de este cliente')).toBeTruthy()

    mockLeadById.mockClear()
    await userEvent.click(screen.getByText(/· 5$/))

    await waitFor(() => expect(mockLeadById).toHaveBeenCalledWith('l1', { conversationId: 'c0' }))
  })

  test('si el lead no tiene conversación lo dice', async () => {
    mockLeadById.mockResolvedValue({ lead: LUCIA, conversation: null, conversations: [] })

    await montar()

    expect(screen.getByText('Seleccioná un lead')).toBeTruthy()
  })

  test('si falla la carga de los leads muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockLeads.mockRejectedValueOnce({ response: { data: { message: 'Sin permiso' } } })

    const { unmount } = render(<AiCommercialInboxPage />)
    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    unmount()

    mockLeads.mockRejectedValueOnce(new Error(''))
    render(<AiCommercialInboxPage />)
    expect(await screen.findByText('No se pudieron cargar los leads comerciales.')).toBeTruthy()
    console.error.mockRestore()
  })

  test('si falla el detalle muestra el mensaje', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockLeadById.mockRejectedValue(new Error(''))

    render(<AiCommercialInboxPage />)

    expect(await screen.findByText('No se pudo cargar el detalle del lead.')).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Bandeja comercial · acciones comerciales', () => {
  test('cambiar el estado manda el id y el nuevo estado, y vuelve a cargar todo', async () => {
    await montar()
    mockSummary.mockClear()
    mockLeads.mockClear()

    await userEvent.click(within(panelDetalle()).getByRole('combobox', { name: 'Estado' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Calificado' }))

    await waitFor(() => expect(mockStatus).toHaveBeenCalledWith('l1', { status: 'qualified' }))
    await waitFor(() => expect(mockSummary).toHaveBeenCalled())
    await waitFor(() => expect(mockLeads).toHaveBeenCalled())
  })

  test('agregar una nota la manda y limpia el campo', async () => {
    await montar()

    const campo = within(panelDetalle()).getByPlaceholderText('Agregar nota comercial...')
    escribir(campo, '  Llamar el lunes  ')
    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Agregar nota' }))

    await waitFor(() => expect(mockNote).toHaveBeenCalledWith('l1', 'Llamar el lunes'))
    await waitFor(() => expect(campo.value).toBe(''))
  })

  test('no se puede agregar una nota vacía', async () => {
    await montar()

    expect(within(panelDetalle()).getByRole('button', { name: 'Agregar nota' }).disabled).toBe(true)
  })

  test('programar un seguimiento manda la fecha en formato ISO', async () => {
    await montar()

    await userEvent.click(
      within(panelDetalle()).getByRole('button', { name: 'Programar seguimiento' }),
    )
    escribir(dialogo().getByLabelText('Fecha y hora'), '2026-11-02T10:30')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockFollowUp).toHaveBeenCalledWith('l1', new Date('2026-11-02T10:30').toISOString()),
    )
  })

  test('marcar ganado pide confirmar y manda el id con el motivo vacío', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Ganado' }))
    expect(dialogo().getByText('Marcar lead como ganado')).toBeTruthy()
    expect(mockWon).not.toHaveBeenCalled()
    await userEvent.click(dialogo().getByRole('button', { name: 'Marcar ganado' }))

    await waitFor(() => expect(mockWon).toHaveBeenCalledWith('l1', ''))
  })

  test('marcar perdido pide un motivo, que viene sugerido', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Perdido' }))
    expect(dialogo().getByLabelText('Motivo').value).toBe(
      'Marcado como perdido desde bandeja comercial',
    )
    escribir(dialogo().getByLabelText('Motivo'), 'Compró en otro lado')
    await userEvent.click(dialogo().getByRole('button', { name: 'Marcar perdido' }))

    await waitFor(() => expect(mockLost).toHaveBeenCalledWith('l1', 'Compró en otro lado'))
  })

  test('sin motivo no se puede marcar perdido ni descartar', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Descartar' }))
    escribir(dialogo().getByLabelText('Motivo'), '   ')

    expect(dialogo().getByRole('button', { name: 'Descartar' }).disabled).toBe(true)
  })

  test('descartar manda el id con el motivo', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Descartar' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Descartar' }))

    await waitFor(() =>
      expect(mockDiscard).toHaveBeenCalledWith('l1', 'Descartado desde bandeja comercial'),
    )
  })

  test('el lead eliminado sale de la lista y se abre el siguiente', async () => {
    await montar()
    mockLeads.mockResolvedValue({ items: [MARCOS] })

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Eliminar lógico' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar' }))

    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith('l1', 'Eliminado desde bandeja comercial'),
    )
    await waitFor(() =>
      expect(mockLeadById).toHaveBeenCalledWith('l2', { conversationId: undefined }),
    )
  })

  test('eliminar de la base exige escribir ELIMINAR', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Eliminar de BD' }))
    const confirmar = dialogo().getByRole('button', { name: 'Eliminar de BD' })
    expect(confirmar.disabled).toBe(true)

    escribir(dialogo().getByLabelText('Escribí ELIMINAR'), 'ELIMINAR')
    expect(confirmar.disabled).toBe(false)
    await userEvent.click(confirmar)

    await waitFor(() => expect(mockPermanent).toHaveBeenCalledWith('l1'))
  })

  test('quitar un producto de interés pide confirmar y manda la referencia', async () => {
    await montar()

    // El botón es solo un ícono y no tiene nombre accesible: se lo busca dentro de la tarjeta del producto.
    await userEvent.click(
      screen.getByText('Zapatillas Runner').closest('.MuiPaper-root').querySelector('button'),
    )
    await userEvent.click(dialogo().getByRole('button', { name: 'Quitar producto' }))

    await waitFor(() =>
      expect(mockRemoveProduct).toHaveBeenCalledWith(
        'l1',
        'p1',
        'Producto de interés removido manualmente desde bandeja comercial',
      ),
    )
  })

  test('limpiar los productos de interés manda una lista vacía', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Limpiar' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Limpiar productos' }))

    await waitFor(() => expect(mockUpdateProducts).toHaveBeenCalledWith('l1', []))
  })

  test('eliminar una conversación exige escribir ELIMINAR y manda el id de la conversación', async () => {
    await montar()

    await userEvent.click(
      within(panelConversacion()).getByRole('button', { name: 'Eliminar conversación de BD' }),
    )
    const confirmar = dialogo().getByRole('button', { name: 'Eliminar de BD' })
    expect(confirmar.disabled).toBe(true)

    escribir(dialogo().getByLabelText('Escribí ELIMINAR'), 'ELIMINAR')
    await userEvent.click(confirmar)

    await waitFor(() => expect(mockDeleteConversation).toHaveBeenCalledWith('c1'))
  })

  test('si una acción falla muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockStatus.mockRejectedValueOnce({ response: { data: { message: 'Estado no válido' } } })
    mockStatus.mockRejectedValueOnce(new Error(''))

    const cambiar = async nombre => {
      await userEvent.click(within(panelDetalle()).getByRole('combobox', { name: 'Estado' }))
      await userEvent.click(await screen.findByRole('option', { name: nombre }))
    }

    await cambiar('Calificado')
    expect(await screen.findByText('Estado no válido')).toBeTruthy()

    await cambiar('Perdido')
    expect(await screen.findByText('No se pudo completar la acción.')).toBeTruthy()
    console.error.mockRestore()
  })
})
