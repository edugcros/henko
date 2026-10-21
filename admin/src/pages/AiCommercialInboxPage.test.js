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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const { getIntentLabel } = await import('../components/aiLeads/LeadDetailPanel.jsx')
const { getChannelLabel, getConversationStatusLabel } =
  await import('../components/aiLeads/LeadConversationPanel.jsx')

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

  test('elegir un estado en el resumen o una intención vuelve a pedir con ese filtro', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /^Calientes/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('hot'))

    await userEvent.click(screen.getByRole('combobox', { name: 'Intención' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Precio' }))
    await waitFor(() => expect(ultimaConsulta().intent).toBe('price_check'))
  })

  test('los seguimientos vencidos se piden con su propio filtro', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: '2 seguimientos vencidos' }))

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ status: 'all', followUp: 'pending' }),
    )
  })

  test('buscar manda el texto como `q`', async () => {
    await montar()

    escribir(screen.getByRole('textbox', { name: 'Buscar leads' }), 'zapatillas')

    await waitFor(() => expect(ultimaConsulta().q).toBe('zapatillas'))
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
  test('el resumen trae cuántos leads hay en cada estado y marca «Todos»', async () => {
    await montar()

    const resumen = within(screen.getByRole('region', { name: 'Resumen de leads' }))

    expect(resumen.getByRole('button', { name: 'Todos 12' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    for (const nombre of [
      'Nuevos 5',
      'Calificados 2',
      'Calientes 4',
      'En seguimiento 1',
      'Ganados 6',
      'Perdidos 1',
      'Descartados 0',
    ]) {
      expect(resumen.getByRole('button', { name: nombre })).toBeTruthy()
    }
  })

  test('debajo del resumen dice cuántos leads llegaron hoy y el puntaje promedio', async () => {
    await montar()

    expect(screen.getByText(/3 leads nuevos hoy/)).toBeTruthy()
    expect(screen.getByText(/Score promedio 54/)).toBeTruthy()
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
    expect(detalle.getByText('Próximo seguimiento: Sin programar')).toBeTruthy()
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
    await userEvent.click(screen.getByText(/· 5 mensajes$/))

    await waitFor(() => expect(mockLeadById).toHaveBeenCalledWith('l1', { conversationId: 'c0' }))
  })

  test('si el lead no tiene conversación lo dice', async () => {
    mockLeadById.mockResolvedValue({ lead: LUCIA, conversation: null, conversations: [] })

    await montar()

    expect(screen.getByText('Este lead no tiene una conversación guardada')).toBeTruthy()
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

    await userEvent.click(
      within(panelDetalle()).getByRole('button', { name: 'Eliminar de la bandeja' }),
    )
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

    await userEvent.click(
      within(panelDetalle()).getByRole('button', { name: 'Eliminar definitivamente' }),
    )
    const confirmar = dialogo().getByRole('button', { name: 'Eliminar definitivamente' })
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
      within(panelConversacion()).getByRole('button', { name: 'Eliminar conversación' }),
    )
    const confirmar = dialogo().getByRole('button', { name: 'Eliminar definitivamente' })
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

describe('Bandeja comercial · consultas que no sobran ni se pisan', () => {
  test('elegir un lead no vuelve a pedir la lista de leads', async () => {
    await montar()
    mockLeads.mockClear()
    mockSummary.mockClear()

    await userEvent.click(screen.getByText('Marcos Gil').closest('[role="button"]'))
    await waitFor(() =>
      expect(mockLeadById).toHaveBeenCalledWith('l2', { conversationId: undefined }),
    )

    expect(mockLeads).not.toHaveBeenCalled()
    expect(mockSummary).not.toHaveBeenCalled()
  })

  test('la búsqueda espera a que se deje de escribir y vuelve a la página 1', async () => {
    mockLeads.mockResolvedValue({
      items: [LUCIA, MARCOS],
      pagination: { page: 1, pages: 3, total: 70 },
    })
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Ir a la página 2' }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
    mockLeads.mockClear()

    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar leads' }), 'runner')

    expect(mockLeads).not.toHaveBeenCalled()
    await waitFor(() => expect(mockLeads).toHaveBeenCalledTimes(1))
    expect(ultimaConsulta()).toMatchObject({ q: 'runner', page: 1 })
  })

  test('con más de una página dice cuántos leads se ven de cuántos y deja pasar de página', async () => {
    mockLeads.mockResolvedValue({
      items: [LUCIA, MARCOS],
      pagination: { page: 1, pages: 3, total: 70 },
    })
    await montar()

    expect(screen.getByText('2 de 70')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
  })

  test('«Limpiar filtros» solo aparece con filtros y vuelve a todos, de cualquier intención, sin búsqueda', async () => {
    await montar()

    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^Ganados/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Limpiar filtros' }))

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({
        status: 'all',
        intent: 'all',
        q: undefined,
        followUp: undefined,
        page: 1,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()
  })

  test('una respuesta lenta del detalle de otro lead no pisa al lead que se está mirando', async () => {
    await montar()

    let responderLenta
    mockLeadById.mockImplementationOnce(
      () => new Promise(resolve => (responderLenta = () => resolve(DETALLE.l2))),
    )
    mockLeadById.mockImplementationOnce(async () => DETALLE.l1)

    await userEvent.click(screen.getByText('Marcos Gil').closest('[role="button"]'))
    await userEvent.click(screen.getAllByText('Lucía Pérez')[0].closest('[role="button"]'))
    await waitFor(() => expect(mockLeadById).toHaveBeenCalledTimes(3))

    await act(async () => {
      responderLenta()
    })

    expect(within(panelDetalle()).getByText('Nombre: Lucía Pérez')).toBeTruthy()
    expect(within(panelDetalle()).queryByText('Nombre: Sin nombre')).toBeNull()
  })

  test('después de una acción se sigue leyendo la misma conversación, no vuelve a la última', async () => {
    await montar()

    await userEvent.click(screen.getByText(/· 5 mensajes$/))
    await waitFor(() => expect(mockLeadById).toHaveBeenCalledWith('l1', { conversationId: 'c0' }))
    mockLeadById.mockClear()

    escribir(within(panelDetalle()).getByRole('textbox', { name: 'Nota comercial' }), 'Una nota')
    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Agregar nota' }))

    await waitFor(() => expect(mockNote).toHaveBeenCalled())
    await waitFor(() => expect(mockLeadById).toHaveBeenCalledWith('l1', { conversationId: 'c0' }))
  })

  test('al actualizar, el detalle no se reemplaza por un indicador: lo que se estaba escribiendo se queda', async () => {
    await montar()

    const campo = within(panelDetalle()).getByRole('textbox', { name: 'Nota comercial' })
    escribir(campo, 'Nota a medio escribir')
    mockLeadById.mockClear()
    // Un servidor real tarda: con una respuesta instantánea React nunca llega a dibujar el «cargando».
    mockLeadById.mockImplementation(async id => {
      await new Promise(resolve => setTimeout(resolve, 40))
      return DETALLE[id]
    })

    await userEvent.click(within(panelDetalle()).getByRole('combobox', { name: 'Estado' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Calificado' }))
    await waitFor(() => expect(mockStatus).toHaveBeenCalled())
    // Se espera a que termine de volver a leer al lead: recién ahí se vería si el panel se desmontó.
    await waitFor(() => expect(mockLeadById).toHaveBeenCalled())
    // Que React termine de redibujar: si el panel se hubiera reemplazado por el indicador, ya habría vuelto.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())

    expect(within(panelDetalle()).getByRole('textbox', { name: 'Nota comercial' }).value).toBe(
      'Nota a medio escribir',
    )
  })

  test('mientras se vuelve a pedir la lista, los leads siguen a la vista', async () => {
    await montar()

    mockLeads.mockReturnValueOnce(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: /^Ganados/ }))

    expect(await screen.findAllByRole('progressbar')).toBeTruthy()
    expect(screen.getAllByText('Lucía Pérez').length).toBeGreaterThan(0)
  })

  test('si falla la carga ofrece «Reintentar» y no deja el panel diciendo que no hay leads', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockLeads.mockRejectedValueOnce(new Error('Sin conexión'))

    render(<AiCommercialInboxPage />)

    expect(await screen.findByText('Sin conexión')).toBeTruthy()

    mockLeads.mockResolvedValue({ items: [LUCIA, MARCOS] })
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Gestión comercial')).toBeTruthy()
    expect(screen.queryByText('Sin conexión')).toBeNull()
    console.error.mockRestore()
  })

  test('si todavía no hay ningún lead, lo explica distinto que cuando un filtro no encuentra nada', async () => {
    mockSummary.mockResolvedValue({ ...RESUMEN, total: 0 })
    mockLeads.mockResolvedValue({ items: [] })

    render(<AiCommercialInboxPage />)

    expect(await screen.findByText('Todavía no hay leads')).toBeTruthy()
  })
})

describe('Bandeja comercial · lo que falla no pierde lo escrito', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    console.error.mockRestore()
  })

  test('si falla agregar una nota, la nota sigue escrita y se avisa al lado', async () => {
    await montar()
    mockNote.mockRejectedValueOnce({ response: { data: { message: 'No se pudo guardar' } } })

    const campo = within(panelDetalle()).getByRole('textbox', { name: 'Nota comercial' })
    escribir(campo, 'Llamar el lunes')
    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Agregar nota' }))

    expect(
      (await within(panelDetalle()).findAllByText('No se pudo guardar')).length,
    ).toBeGreaterThan(0)
    expect(campo.value).toBe('Llamar el lunes')
  })

  test('si falla marcar ganado, el diálogo sigue abierto con el motivo adentro', async () => {
    await montar()
    mockWon.mockRejectedValueOnce(new Error('Ya está ganado'))

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Ganado' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Marcar ganado' }))

    expect(await dialogo().findByText('Ya está ganado')).toBeTruthy()

    mockWon.mockResolvedValueOnce({})
    await userEvent.click(dialogo().getByRole('button', { name: 'Marcar ganado' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('el error de un intento anterior no aparece en un diálogo nuevo', async () => {
    await montar()
    mockWon.mockRejectedValueOnce(new Error('Falló antes'))

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Ganado' }))
    await userEvent.click(dialogo().getByRole('button', { name: 'Marcar ganado' }))
    await dialogo().findByText('Falló antes')
    await userEvent.click(dialogo().getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Perdido' }))

    expect(dialogo().queryByText('Falló antes')).toBeNull()
  })

  test('si falla programar el seguimiento, el diálogo sigue abierto con el error', async () => {
    await montar()
    mockFollowUp.mockRejectedValueOnce(new Error('Fecha inválida'))

    await userEvent.click(
      within(panelDetalle()).getByRole('button', { name: 'Programar seguimiento' }),
    )
    escribir(dialogo().getByLabelText('Fecha y hora'), '2026-11-02T10:30')
    await userEvent.click(dialogo().getByRole('button', { name: 'Guardar' }))

    expect(await dialogo().findByText('Fecha inválida')).toBeTruthy()
    expect(dialogo().getByLabelText('Fecha y hora').value).toBe('2026-11-02T10:30')
  })

  test('si falla eliminar una conversación, el diálogo sigue abierto con el error', async () => {
    await montar()
    mockDeleteConversation.mockRejectedValueOnce(new Error('No existe'))

    await userEvent.click(
      within(panelConversacion()).getByRole('button', { name: 'Eliminar conversación' }),
    )
    escribir(dialogo().getByLabelText('Escribí ELIMINAR'), 'ELIMINAR')
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar definitivamente' }))

    expect(await dialogo().findByText('No existe')).toBeTruthy()
  })

  test('eliminar una conversación, si sale bien, cierra el diálogo y vuelve a leer al lead', async () => {
    await montar()
    mockLeadById.mockClear()

    await userEvent.click(
      within(panelConversacion()).getByRole('button', { name: 'Eliminar conversación' }),
    )
    escribir(dialogo().getByLabelText('Escribí ELIMINAR'), 'ELIMINAR')
    await userEvent.click(dialogo().getByRole('button', { name: 'Eliminar definitivamente' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockLeadById).toHaveBeenCalled()
  })
})

describe('Bandeja comercial · lo que se dice', () => {
  test('la intención y el canal se dicen en español', async () => {
    await montar()

    expect(within(panelDetalle()).getByText('Intención de compra')).toBeTruthy()
    expect(within(panelConversacion()).getByText(/Chat web · Abierta/)).toBeTruthy()
  })

  test('los botones de solo ícono tienen nombre, para quien usa lector de pantalla', async () => {
    await montar()

    expect(within(panelDetalle()).getByRole('button', { name: 'Copiar email' })).toBeTruthy()
    expect(within(panelDetalle()).getByRole('button', { name: 'Copiar teléfono' })).toBeTruthy()
    expect(within(panelDetalle()).getByRole('button', { name: 'Abrir WhatsApp' })).toBeTruthy()
    expect(
      within(panelDetalle()).getByRole('button', {
        name: 'Quitar «Zapatillas Runner» de los intereses',
      }),
    ).toBeTruthy()
  })

  test('el motivo que ya viene sugerido no se pisa con su etiqueta', async () => {
    await montar()

    await userEvent.click(within(panelDetalle()).getByRole('button', { name: 'Perdido' }))

    const campo = dialogo().getByLabelText('Motivo')
    const etiqueta = document.querySelector(`label[for="${campo.id}"]`)

    expect(campo.value).not.toBe('')
    expect(etiqueta.getAttribute('data-shrink')).toBe('true')
  })

  test('los borrados dicen lo que de verdad hacen', async () => {
    await montar()

    await userEvent.click(
      within(panelDetalle()).getByRole('button', { name: 'Eliminar de la bandeja' }),
    )
    expect(
      dialogo().getByText(/salen de la bandeja .* Se conservan en la base de datos/),
    ).toBeTruthy()
    await userEvent.click(dialogo().getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(
      within(panelDetalle()).getByRole('button', { name: 'Eliminar definitivamente' }),
    )
    expect(
      dialogo().getByText(/no se puede deshacer\. Sus conversaciones quedan guardadas/),
    ).toBeTruthy()
  })

  test('un seguimiento que ya pasó de fecha en un lead abierto se marca como vencido', async () => {
    mockLeadById.mockImplementation(async id =>
      id === 'l1'
        ? { ...DETALLE.l1, lead: { ...LUCIA, nextFollowUpAt: '2020-01-01T10:00:00Z' } }
        : DETALLE[id],
    )

    await montar()

    expect(within(panelDetalle()).getByText('Vencido')).toBeTruthy()
  })

  test('un seguimiento a futuro no se marca como vencido', async () => {
    mockLeadById.mockImplementation(async id =>
      id === 'l1'
        ? { ...DETALLE.l1, lead: { ...LUCIA, nextFollowUpAt: '2999-01-01T10:00:00Z' } }
        : DETALLE[id],
    )

    await montar()

    expect(within(panelDetalle()).queryByText('Vencido')).toBeNull()
  })

  test('si hay más productos o notas de los que se muestran, lo dice', async () => {
    const productos = Array.from({ length: 10 }, (_, i) => ({
      productId: `p${i}`,
      title: `Producto ${i}`,
      price: 100,
    }))
    const notas = Array.from({ length: 7 }, (_, i) => ({
      _id: `n${i}`,
      text: `Nota ${i}`,
      createdAt: '2026-10-19T12:00:00Z',
    }))
    mockLeadById.mockImplementation(async id =>
      id === 'l1'
        ? { ...DETALLE.l1, lead: { ...LUCIA, productsOfInterest: productos, notes: notas } }
        : DETALLE[id],
    )

    await montar()

    expect(within(panelDetalle()).getByText('y 2 más')).toBeTruthy()
    expect(within(panelDetalle()).getByText('Mostrando las últimas 5 de 7 notas.')).toBeTruthy()
  })
})

describe('Bandeja comercial · armado de etiquetas', () => {
  test('la intención, el canal y el estado de la conversación se traducen y, si no se conocen, se muestran tal cual', () => {
    expect(getIntentLabel('price_check')).toBe('Precio')
    expect(getIntentLabel('algo_nuevo')).toBe('algo_nuevo')
    expect(getIntentLabel(undefined)).toBe('Sin clasificar')

    expect(getChannelLabel('whatsapp')).toBe('WhatsApp')
    expect(getChannelLabel('otro')).toBe('otro')

    expect(getConversationStatusLabel('waiting_human')).toBe('Esperando a una persona')
    expect(getConversationStatusLabel('quizas')).toBe('quizas')
  })
})

describe('Bandeja comercial · en el celular', () => {
  beforeEach(() => {
    window.matchMedia = query => ({
      matches: query === '(max-width:899.95px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
  })

  afterEach(() => {
    delete window.matchMedia
  })

  test('se abre en la lista, sin los tres paneles a la vez', async () => {
    render(<AiCommercialInboxPage />)

    expect(await screen.findByText('Marcos Gil')).toBeTruthy()
    expect(screen.queryByText('Gestión comercial')).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Detalle' })).toBeNull()
  })

  test('elegir un lead abre su detalle con pestañas; «Conversación» muestra los mensajes y se puede volver', async () => {
    render(<AiCommercialInboxPage />)

    await userEvent.click((await screen.findByText('Marcos Gil')).closest('[role="button"]'))

    expect(await screen.findByText('Gestión comercial')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Detalle' }).getAttribute('aria-selected')).toBe('true')

    await userEvent.click(screen.getByRole('tab', { name: 'Conversación' }))

    expect(await screen.findByText('Hola, buenas')).toBeTruthy()
    expect(screen.queryByText('Gestión comercial')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }))

    expect(await screen.findByText('Marcos Gil')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Detalle' })).toBeNull()
  })

  test('con un lead abierto no se muestran el resumen ni los filtros; al volver a la lista sí', async () => {
    render(<AiCommercialInboxPage />)

    expect(await screen.findByRole('region', { name: 'Resumen de leads' })).toBeTruthy()

    await userEvent.click((await screen.findByText('Marcos Gil')).closest('[role="button"]'))
    await screen.findByText('Gestión comercial')

    expect(screen.queryByRole('region', { name: 'Resumen de leads' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Buscar leads' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Volver a la lista' }))

    expect(await screen.findByRole('region', { name: 'Resumen de leads' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Buscar leads' })).toBeTruthy()
  })

  test('eliminar el lead vuelve a la lista', async () => {
    render(<AiCommercialInboxPage />)

    await userEvent.click((await screen.findByText('Marcos Gil')).closest('[role="button"]'))
    await screen.findByText('Gestión comercial')
    mockLeads.mockResolvedValue({ items: [LUCIA] })

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar de la bandeja' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }),
    )

    await waitFor(() => expect(mockDelete).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Detalle' })).toBeNull())
  })
})
