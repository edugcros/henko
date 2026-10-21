// Bandeja de aprendizaje del agente de IA (AiLearningReviewPage).
//
// El agente detecta huecos y patrones en sus conversaciones y los propone como sugerencias; acá el
// comercio decide cuáles pasan a ser conocimiento que el agente usa con clientes reales. Aprobar es
// publicar. No tenía tests. Lo que se fija:
//
//   - la consulta al servidor y cómo cambia con cada filtro;
//   - qué se muestra de cada sugerencia y qué acciones ofrece según su estado;
//   - lo que se manda al aprobar, rechazar y archivar, una por una y en lote;
//   - qué se avisa cuando algo sale bien o mal.

import React from 'react'
import { jest } from '@jest/globals'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockList = jest.fn()
const mockApprove = jest.fn()
const mockReject = jest.fn()
const mockArchive = jest.fn()

jest.unstable_mockModule('../services/aiLearningSuggestionService.js', () => ({
  listLearningSuggestions: mockList,
  approveLearningSuggestion: mockApprove,
  rejectLearningSuggestion: mockReject,
  archiveLearningSuggestion: mockArchive,
}))

const {
  default: AiLearningReviewPage,
  bulkMessage,
  parseTags,
} = await import('./AiLearningReviewPage.jsx')

const ENVIO = {
  _id: 's1',
  type: 'faq_suggestion',
  status: 'pending_review',
  priority: 'high',
  confidence: 0.82,
  title: 'Cuánto tarda el envío a Córdoba',
  question: '¿Cuánto tarda el envío a Córdoba?',
  suggestedAnswer: 'Entre 3 y 5 días hábiles.',
  tags: ['envío', 'córdoba'],
  metadata: { intent: 'shipping_time', sampleUserText: 'cuando llega a cordoba?' },
}
const GARANTIA = {
  _id: 's2',
  type: 'policy_gap',
  status: 'pending_review',
  priority: 'medium',
  confidence: 0.6,
  title: 'Garantía de productos usados',
  suggestedAnswer: 'No tenemos una política escrita para usados.',
  tags: [],
}
const VIEJA = {
  _id: 's3',
  type: 'general',
  status: 'rejected',
  priority: 'low',
  confidence: 0.3,
  title: 'Pedido de factura A',
  suggestedAnswer: 'Emitimos factura A con CUIT.',
  reason: 'Ya está en las políticas',
}
const ARCHIVADA = { ...VIEJA, _id: 's4', status: 'archived', title: 'Promo vieja', reason: '' }

const RESPUESTA = {
  items: [ENVIO, GARANTIA],
  pagination: { page: 1, limit: 50, total: 2, pages: 1 },
  counters: { pending_review: 2, approved: 7, rejected: 1, archived: 4 },
}

const montar = async (respuesta = RESPUESTA) => {
  mockList.mockResolvedValue(respuesta)

  render(<AiLearningReviewPage />)

  await waitFor(() => expect(mockList).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
}

const ultimaConsulta = () => mockList.mock.calls[mockList.mock.calls.length - 1][0]

const tarjeta = titulo => screen.getByText(titulo).closest('.MuiPaper-root')

const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } })

const barraDeLote = () =>
  screen.getByText(/seleccionadas?$|pendientes? visibles?$/).closest('.MuiPaper-root')

beforeEach(() => {
  jest.clearAllMocks()
  mockApprove.mockResolvedValue({})
  mockReject.mockResolvedValue({})
  mockArchive.mockResolvedValue({})
})

describe('Aprendizaje · consulta', () => {
  test('al abrir pide las pendientes, de a 50', async () => {
    await montar()

    expect(mockList).toHaveBeenCalledWith({
      status: 'pending_review',
      type: undefined,
      search: undefined,
      page: 1,
      limit: 50,
    })
  })

  test('cambiar el estado, el tipo o la búsqueda vuelve a pedir con ese filtro', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /^Aprobadas/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('approved'))

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))
    await waitFor(() => expect(ultimaConsulta().type).toBe('faq_suggestion'))

    escribir(screen.getByRole('textbox', { name: 'Buscar sugerencias' }), 'envio')
    await waitFor(() => expect(ultimaConsulta().search).toBe('envio'))
  })

  test('«Todos los tipos» saca el filtro de tipo', async () => {
    await montar()

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))
    await waitFor(() => expect(ultimaConsulta().type).toBe('faq_suggestion'))

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Todos los tipos' }))
    await waitFor(() => expect(ultimaConsulta().type).toBeUndefined())
  })

  test('el resumen trae cuántas sugerencias hay en cada estado, marca el elegido, y el subtítulo dice cuántas esperan revisión', async () => {
    await montar()

    expect(screen.getByText(/2 pendientes de revisión\./)).toBeTruthy()

    const resumen = within(
      screen.getByRole('region', { name: 'Resumen del aprendizaje del agente' }),
    )

    expect(resumen.getByRole('button', { name: 'Pendientes 2' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(resumen.getByRole('button', { name: 'Aprobadas 7' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Rechazadas 1' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Archivadas 4' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Todas 14' })).toBeTruthy()
  })

  test('con una sola pendiente el subtítulo va en singular', async () => {
    await montar({ ...RESPUESTA, items: [ENVIO], counters: { pending_review: 1 } })

    expect(screen.getByText(/ 1 pendiente de revisión\./)).toBeTruthy()
  })

  test('«Actualizar» vuelve a pedir lo mismo', async () => {
    await montar()
    mockList.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
  })
})

describe('Aprendizaje · lo que se ve', () => {
  test('cada sugerencia muestra tipo, prioridad, confianza, intención, pregunta, respuesta, ejemplo y etiquetas', async () => {
    await montar()

    const envio = within(tarjeta('Cuánto tarda el envío a Córdoba'))

    expect(envio.getByText('FAQ')).toBeTruthy()
    expect(envio.getByText('Prioridad alta')).toBeTruthy()
    expect(envio.getByText('Pendiente')).toBeTruthy()
    expect(envio.getByText('Confianza 82%')).toBeTruthy()
    expect(envio.getByText('shipping_time')).toBeTruthy()
    expect(envio.getByText('¿Cuánto tarda el envío a Córdoba?')).toBeTruthy()
    expect(envio.getByText('Entre 3 y 5 días hábiles.')).toBeTruthy()
    expect(envio.getByText(/cuando llega a cordoba\?/)).toBeTruthy()
    expect(envio.getByText('córdoba')).toBeTruthy()
  })

  test('el título cae a la pregunta y, sin ninguna, dice «Sugerencia sin título»', async () => {
    await montar({
      ...RESPUESTA,
      items: [
        { ...ENVIO, _id: 'a', title: '', question: 'Solo pregunta' },
        { ...GARANTIA, _id: 'b', title: '', question: '' },
      ],
    })

    expect(screen.getAllByText('Solo pregunta').length).toBeGreaterThan(0)
    expect(screen.getByText('Sugerencia sin título')).toBeTruthy()
  })

  test('una rechazada muestra el motivo', async () => {
    await montar({ ...RESPUESTA, items: [VIEJA] })

    expect(screen.getByText('Rechazada: Ya está en las políticas')).toBeTruthy()
  })

  test('si el agente nunca propuso nada, lo explica', async () => {
    await montar({ items: [], counters: {} })

    expect(screen.getByText('Todavía no hay nada para revisar')).toBeTruthy()
  })

  test('si hay sugerencias pero no en este filtro, lo dice sin explicar de más', async () => {
    await montar({ items: [], counters: { approved: 3 } })

    expect(screen.getByText('No hay sugerencias para este filtro.')).toBeTruthy()
    expect(screen.queryByText('Todavía no hay nada para revisar')).toBeNull()
  })

  test('la prioridad crítica se distingue y se dice en español', async () => {
    await montar({
      ...RESPUESTA,
      items: [
        { ...ENVIO, _id: 'c', title: 'Urgente', priority: 'critical' },
        { ...GARANTIA, _id: 'l', title: 'Menor', priority: 'low' },
      ],
    })

    expect(within(tarjeta('Urgente')).getByText('Prioridad crítica')).toBeTruthy()
    expect(within(tarjeta('Menor')).getByText('Prioridad baja')).toBeTruthy()
  })

  test('cada sugerencia dice en qué estado está', async () => {
    await montar({ ...RESPUESTA, status: 'all', items: [ENVIO, VIEJA, ARCHIVADA] })

    expect(within(tarjeta('Cuánto tarda el envío a Córdoba')).getByText('Pendiente')).toBeTruthy()
    expect(within(tarjeta('Pedido de factura A')).getByText('Rechazada')).toBeTruthy()
    expect(within(tarjeta('Promo vieja')).getByText('Archivada')).toBeTruthy()
  })

  test('mientras carga muestra un indicador', async () => {
    mockList.mockReturnValue(new Promise(() => {}))

    render(<AiLearningReviewPage />)

    expect(await screen.findByRole('progressbar')).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValueOnce({ response: { data: { message: 'Sin permiso' } } })

    const { unmount } = render(<AiLearningReviewPage />)
    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    unmount()

    mockList.mockRejectedValueOnce(new Error(''))
    render(<AiLearningReviewPage />)
    expect(await screen.findByText('No se pudieron cargar las sugerencias.')).toBeTruthy()
    console.error.mockRestore()
  })
})

describe('Aprendizaje · acciones según el estado', () => {
  test('las pendientes tienen Aprobar, Rechazar y Archivar; las rechazadas ninguna acción; las archivadas solo Aprobar', async () => {
    await montar({ ...RESPUESTA, items: [ENVIO, VIEJA, ARCHIVADA] })

    const pendiente = within(tarjeta('Cuánto tarda el envío a Córdoba'))
    expect(pendiente.getByRole('button', { name: 'Aprobar' })).toBeTruthy()
    expect(pendiente.getByRole('button', { name: 'Rechazar' })).toBeTruthy()
    expect(pendiente.getByRole('button', { name: 'Archivar' })).toBeTruthy()

    expect(within(tarjeta('Pedido de factura A')).queryByRole('button')).toBeNull()

    const archivada = within(tarjeta('Promo vieja'))
    expect(archivada.getByRole('button', { name: 'Aprobar' })).toBeTruthy()
    expect(archivada.queryByRole('button', { name: 'Rechazar' })).toBeNull()
    expect(archivada.queryByRole('button', { name: 'Archivar' })).toBeNull()
  })

  test('una archivada se puede rescatar: Aprobar abre el mismo diálogo y manda su id', async () => {
    await montar({ ...RESPUESTA, items: [ARCHIVADA] })

    await userEvent.click(within(tarjeta('Promo vieja')).getByRole('button', { name: 'Aprobar' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }),
    )

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('s4', expect.any(Object)))
  })

  test('archivar manda el id, sin pedir confirmación, y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Archivar' }),
    )

    await waitFor(() => expect(mockArchive).toHaveBeenCalledWith('s1'))
    expect(await screen.findByText('Sugerencia archivada.')).toBeTruthy()
  })

  test('aprobar abre un diálogo con el texto de la sugerencia para editarlo', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Aprobar' }),
    )

    const dialogo = within(screen.getByRole('dialog'))
    expect(dialogo.getByText('Aprobar y convertir en conocimiento')).toBeTruthy()
    expect(dialogo.getByLabelText('Título').value).toBe('Cuánto tarda el envío a Córdoba')
    expect(dialogo.getByLabelText('Contenido').value).toBe('Entre 3 y 5 días hábiles.')
    expect(dialogo.getByLabelText(/Tags/).value).toBe('envío, córdoba')
  })

  test('aprobar manda el id con lo editado, separa las etiquetas y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Aprobar' }),
    )
    const dialogo = within(screen.getByRole('dialog'))
    escribir(dialogo.getByLabelText('Contenido'), '  Entre 2 y 4 días hábiles.  ')
    escribir(dialogo.getByLabelText(/Tags/), 'envío, , plazos ,')
    await userEvent.click(dialogo.getByRole('button', { name: 'Aprobar' }))

    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith('s1', {
        title: 'Cuánto tarda el envío a Córdoba',
        content: 'Entre 2 y 4 días hábiles.',
        tags: ['envío', 'plazos'],
      }),
    )
    expect(
      await screen.findByText('Sugerencia aprobada y convertida en conocimiento.'),
    ).toBeTruthy()
  })

  test('no se puede aprobar con el contenido vacío', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Aprobar' }),
    )
    const dialogo = within(screen.getByRole('dialog'))
    escribir(dialogo.getByLabelText('Contenido'), '   ')

    expect(dialogo.getByRole('button', { name: 'Aprobar' }).disabled).toBe(true)
  })

  test('rechazar manda el id y el motivo, y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Rechazar' }),
    )
    const dialogo = within(screen.getByRole('dialog'))
    escribir(dialogo.getByLabelText(/Motivo/), '  Ya está en las políticas  ')
    await userEvent.click(dialogo.getByRole('button', { name: 'Rechazar' }))

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('s1', 'Ya está en las políticas'))
    expect(await screen.findByText('Sugerencia rechazada.')).toBeTruthy()
  })

  test('el motivo es opcional', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Rechazar' }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Rechazar' }),
    )

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('s1', ''))
  })

  test('si falla una acción muestra el mensaje del servidor o uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockArchive.mockRejectedValueOnce({ response: { data: { message: 'Ya fue archivada' } } })
    mockArchive.mockRejectedValueOnce(new Error(''))

    const archivar = () =>
      userEvent.click(
        within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', {
          name: 'Archivar',
        }),
      )

    await archivar()
    expect(await screen.findByText('Ya fue archivada')).toBeTruthy()

    await archivar()
    expect(await screen.findByText('No se pudo completar la acción.')).toBeTruthy()
    console.error.mockRestore()
  })

  test('después de una acción vuelve a cargar la lista', async () => {
    await montar()
    mockList.mockClear()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Archivar' }),
    )

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
  })
})

describe('Aprendizaje · en lote', () => {
  const seleccionarTodas = async () => {
    await userEvent.click(within(barraDeLote()).getByRole('checkbox'))
  }

  test('la barra de lote solo aparece si hay pendientes a la vista', async () => {
    await montar({ ...RESPUESTA, items: [VIEJA] })

    expect(screen.queryByText(/pendientes? visibles?/)).toBeNull()
  })

  test('seleccionar todas cuenta cuántas hay y muestra las acciones; cancelar las suelta', async () => {
    await montar()

    expect(screen.getByText('Seleccionar las 2 pendientes visibles')).toBeTruthy()
    expect(within(barraDeLote()).queryByRole('button', { name: 'Aprobar' })).toBeNull()

    await seleccionarTodas()

    expect(screen.getByText('2 seleccionadas')).toBeTruthy()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Seleccionar las 2 pendientes visibles')).toBeTruthy()
  })

  test('con una sola pendiente el texto va en singular', async () => {
    await montar({ ...RESPUESTA, items: [ENVIO] })

    expect(screen.getByText('Seleccionar la pendiente visible')).toBeTruthy()

    await userEvent.click(within(barraDeLote()).getByRole('checkbox'))

    expect(screen.getByText('1 seleccionada')).toBeTruthy()
  })

  test('cada casilla dice de qué sugerencia es, para quien usa lector de pantalla', async () => {
    await montar()

    expect(
      screen.getByRole('checkbox', { name: 'Seleccionar «Cuánto tarda el envío a Córdoba»' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('checkbox', { name: 'Seleccionar todas las pendientes visibles' }),
    ).toBeTruthy()
  })

  test('aprobar en lote pide confirmar antes de mandar nada, porque publica sin editar', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Aprobar' }))

    const confirmacion = within(screen.getByRole('dialog'))
    expect(confirmacion.getByText('¿Aprobar 2 sugerencias?')).toBeTruthy()
    expect(confirmacion.getByText(/sin que las edites/)).toBeTruthy()
    expect(mockApprove).not.toHaveBeenCalled()

    await userEvent.click(confirmacion.getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockApprove).not.toHaveBeenCalled()
    expect(screen.getByText('2 seleccionadas')).toBeTruthy()
  })

  test('aprobar en lote, ya confirmado, manda cada id sin editar nada y avisa', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Aprobar' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }),
    )

    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(2))
    expect(mockApprove).toHaveBeenCalledWith('s1')
    expect(mockApprove).toHaveBeenCalledWith('s2')
    expect(
      await screen.findByText('2 sugerencias aprobadas y convertidas en conocimiento.'),
    ).toBeTruthy()
  })

  test('archivar en lote también pide confirmar, y después manda cada id', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Archivar' }))

    const confirmacion = within(screen.getByRole('dialog'))
    expect(confirmacion.getByText('¿Archivar 2 sugerencias?')).toBeTruthy()
    expect(mockArchive).not.toHaveBeenCalled()

    await userEvent.click(confirmacion.getByRole('button', { name: 'Archivar' }))

    await waitFor(() => expect(mockArchive).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2 sugerencias archivadas.')).toBeTruthy()
  })

  test('rechazar en lote comparte un mismo motivo', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Rechazar' }))
    const dialogo = within(screen.getByRole('dialog'))
    expect(dialogo.getByText('Rechazar 2 sugerencias')).toBeTruthy()
    escribir(dialogo.getByLabelText(/Motivo/), 'Duplicadas')
    await userEvent.click(dialogo.getByRole('button', { name: 'Rechazar 2' }))

    await waitFor(() => expect(mockReject).toHaveBeenCalledTimes(2))
    expect(mockReject).toHaveBeenCalledWith('s1', 'Duplicadas')
    expect(mockReject).toHaveBeenCalledWith('s2', 'Duplicadas')
  })

  test('si una falla, el resto se aplica, avisa cuántas salieron bien y deja seleccionada la que falló', async () => {
    await montar()
    mockArchive.mockResolvedValueOnce({})
    mockArchive.mockRejectedValueOnce(new Error('x'))
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Archivar' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archivar' }),
    )

    expect(
      await screen.findByText('1 archivada, 1 falló. Quedaron seleccionadas para reintentar.'),
    ).toBeTruthy()
    expect(await screen.findByText('1 seleccionada')).toBeTruthy()
    // El diálogo de confirmación todavía se está cerrando: hasta que termina, lo de atrás no es accesible.
    const fallida = await screen.findByRole('checkbox', {
      name: 'Seleccionar «Garantía de productos usados»',
    })
    expect(fallida.checked).toBe(true)
    expect(
      screen.getByRole('checkbox', { name: 'Seleccionar «Cuánto tarda el envío a Córdoba»' })
        .checked,
    ).toBe(false)
  })

  test('si fallan todas, avisa que no se pudo con ninguna', async () => {
    await montar()
    mockArchive.mockRejectedValue(new Error('x'))
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Archivar' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archivar' }),
    )

    expect(
      await screen.findByText('No se pudo completar la acción en ninguna de las 2 sugerencias.'),
    ).toBeTruthy()
  })

  test('cambiar de filtro suelta la selección', async () => {
    await montar()
    await seleccionarTodas()
    expect(screen.getByText('2 seleccionadas')).toBeTruthy()

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))

    await waitFor(() => expect(screen.queryByText('2 seleccionadas')).toBeNull())
  })
})

describe('Aprendizaje · los diálogos no pierden lo escrito', () => {
  const abrirAprobar = () =>
    userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Aprobar' }),
    )

  test('si falla aprobar, el diálogo sigue abierto con el motivo y con lo que se editó', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockApprove.mockRejectedValueOnce({ response: { data: { message: 'Ya fue aprobada' } } })

    await abrirAprobar()
    escribir(
      within(screen.getByRole('dialog')).getByLabelText('Contenido'),
      'Texto que costó escribir',
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }),
    )

    const dialogo = within(await screen.findByRole('dialog'))
    expect(await dialogo.findByText('Ya fue aprobada')).toBeTruthy()
    expect(dialogo.getByLabelText('Contenido').value).toBe('Texto que costó escribir')

    mockApprove.mockResolvedValueOnce({})
    await userEvent.click(dialogo.getByRole('button', { name: 'Aprobar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockApprove).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({ content: 'Texto que costó escribir' }),
    )
    console.error.mockRestore()
  })

  test('si falla rechazar, el diálogo sigue abierto con el motivo escrito', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockReject.mockRejectedValueOnce(new Error(''))

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Rechazar' }),
    )
    escribir(within(screen.getByRole('dialog')).getByLabelText(/Motivo/), 'Es una duda aparte')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Rechazar' }),
    )

    const dialogo = within(await screen.findByRole('dialog'))
    expect(await dialogo.findByText('No se pudo completar la acción.')).toBeTruthy()
    expect(dialogo.getByLabelText(/Motivo/).value).toBe('Es una duda aparte')
    console.error.mockRestore()
  })

  test('el error se quita al seguir escribiendo', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    await montar()
    mockApprove.mockRejectedValueOnce(new Error('Falló'))

    await abrirAprobar()
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }),
    )
    const dialogo = within(await screen.findByRole('dialog'))
    await dialogo.findByText('Falló')

    escribir(dialogo.getByLabelText('Título'), 'Otro título')

    expect(dialogo.queryByText('Falló')).toBeNull()
    console.error.mockRestore()
  })

  test('cancelar cierra el diálogo sin mandar nada', async () => {
    await montar()

    await abrirAprobar()
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockApprove).not.toHaveBeenCalled()
  })

  test('el título y el contenido cuentan los caracteres que van usando', async () => {
    await montar()

    await abrirAprobar()
    const dialogo = within(screen.getByRole('dialog'))

    expect(dialogo.getByText('31/200')).toBeTruthy()
    expect(dialogo.getByText('25/10000')).toBeTruthy()
  })
})

describe('Aprendizaje · búsqueda, páginas y recarga', () => {
  test('la búsqueda espera a que se deje de escribir y vuelve a la página 1', async () => {
    await montar({ ...RESPUESTA, pagination: { page: 1, limit: 50, total: 120, pages: 3 } })

    await userEvent.click(screen.getByRole('button', { name: 'Ir a la página 2' }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
    mockList.mockClear()

    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar sugerencias' }), 'envio')

    expect(mockList).not.toHaveBeenCalled()
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
    expect(ultimaConsulta()).toMatchObject({ search: 'envio', page: 1 })
  })

  test('«Limpiar filtros» solo aparece con filtros y vuelve a las pendientes, de todos los tipos, sin búsqueda', async () => {
    await montar()

    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^Aprobadas/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Limpiar filtros' }))

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({
        status: 'pending_review',
        type: undefined,
        search: undefined,
        page: 1,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()
  })

  test('«Todas» y cualquier otro estado del resumen filtran por ese estado', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /^Todas/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('all'))

    await userEvent.click(screen.getByRole('button', { name: /^Archivadas/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('archived'))
  })

  test('con varias páginas dice cuántas hay y deja pasar de página', async () => {
    await montar({ ...RESPUESTA, pagination: { page: 1, limit: 50, total: 120, pages: 3 } })

    expect(screen.getByText('Mostrando 2 de 120 (página 1 de 3)')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
  })

  test('con una sola página cuenta las sugerencias y no muestra paginación', async () => {
    await montar()

    expect(screen.getByText('2 sugerencias')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Página siguiente' })).toBeNull()
  })

  test('si la página en la que estaba quedó vacía, vuelve a la última que existe', async () => {
    await montar({ ...RESPUESTA, pagination: { page: 1, limit: 50, total: 51, pages: 2 } })

    mockList.mockResolvedValueOnce({
      items: [],
      pagination: { page: 2, limit: 50, total: 50, pages: 1 },
      counters: RESPUESTA.counters,
    })
    mockList.mockResolvedValue(RESPUESTA)
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(1))
    expect(await screen.findByText('Cuánto tarda el envío a Córdoba')).toBeTruthy()
  })

  test('una respuesta lenta de una consulta anterior no pisa a la más reciente', async () => {
    await montar()

    let responderLenta
    mockList.mockReturnValueOnce(new Promise(resolve => (responderLenta = resolve)))
    mockList.mockResolvedValueOnce({ ...RESPUESTA, items: [ENVIO] })

    await userEvent.click(screen.getByRole('button', { name: /^Aprobadas/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Archivadas/ }))
    await waitFor(() => expect(screen.queryByText('Garantía de productos usados')).toBeNull())

    await act(async () => {
      responderLenta({ ...RESPUESTA, items: [VIEJA] })
    })

    expect(screen.queryByText('Pedido de factura A')).toBeNull()
    expect(screen.getByText('Cuánto tarda el envío a Córdoba')).toBeTruthy()
  })

  test('mientras se vuelve a consultar, la lista sigue a la vista', async () => {
    await montar()

    mockList.mockReturnValueOnce(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: /^Aprobadas/ }))

    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('Cuánto tarda el envío a Córdoba')).toBeTruthy()
  })

  test('si falla la carga no dice además que no hay nada, y se puede reintentar', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValueOnce(new Error('Sin conexión'))

    render(<AiLearningReviewPage />)

    expect(await screen.findByText('Sin conexión')).toBeTruthy()
    expect(screen.queryByText('Todavía no hay nada para revisar')).toBeNull()
    expect(screen.queryByText('No hay sugerencias para este filtro.')).toBeNull()

    mockList.mockResolvedValue(RESPUESTA)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Cuánto tarda el envío a Córdoba')).toBeTruthy()
    expect(screen.queryByText('Sin conexión')).toBeNull()
    console.error.mockRestore()
  })
})

describe('Aprendizaje · armado de lo que se manda y de los avisos', () => {
  test('parseTags descarta vacías y tolera valores nulos', () => {
    expect(parseTags(' a , ,b,, ')).toEqual(['a', 'b'])
    expect(parseTags('')).toEqual([])
    expect(parseTags(null)).toEqual([])
  })

  test('el aviso de un lote va en singular o plural según corresponda', () => {
    expect(bulkMessage('approve', 1, 0).message).toBe(
      '1 sugerencia aprobada y convertida en conocimiento.',
    )
    expect(bulkMessage('reject', 3, 0).message).toBe('3 sugerencias rechazadas.')
    expect(bulkMessage('archive', 2, 1).message).toBe(
      '2 archivadas, 1 falló. Quedaron seleccionadas para reintentar.',
    )
    expect(bulkMessage('archive', 1, 3).message).toBe(
      '1 archivada, 3 fallaron. Quedaron seleccionadas para reintentar.',
    )
    expect(bulkMessage('archive', 0, 1).message).toBe(
      'No se pudo completar la acción en la sugerencia.',
    )
    expect(bulkMessage('archive', 0, 4).message).toBe(
      'No se pudo completar la acción en ninguna de las 4 sugerencias.',
    )
  })

  test('la severidad del aviso: éxito, advertencia o error', () => {
    expect(bulkMessage('archive', 2, 0).severity).toBe('success')
    expect(bulkMessage('archive', 1, 1).severity).toBe('warning')
    expect(bulkMessage('archive', 0, 2).severity).toBe('error')
  })
})

describe('Aprendizaje · en el celular', () => {
  afterEach(() => {
    delete window.matchMedia
  })

  test('los diálogos ocupan toda la pantalla', async () => {
    window.matchMedia = query => ({
      matches: query === '(max-width:600px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda el envío a Córdoba')).getByRole('button', { name: 'Aprobar' }),
    )

    expect(screen.getByRole('dialog').className).toMatch(/MuiDialog-paperFullScreen|fullScreen/)
  })
})
