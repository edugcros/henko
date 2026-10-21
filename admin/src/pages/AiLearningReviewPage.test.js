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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const { default: AiLearningReviewPage } = await import('./AiLearningReviewPage.jsx')

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
  screen.getByText(/seleccionada\(s\)|pendiente\(s\) visibles/).closest('.MuiPaper-root')

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

    await userEvent.click(screen.getByRole('combobox', { name: /estado/i }))
    await userEvent.click(await screen.findByRole('option', { name: /Aprobadas/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('approved'))

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))
    await waitFor(() => expect(ultimaConsulta().type).toBe('faq_suggestion'))

    escribir(screen.getByLabelText('Buscar'), 'envio')
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

  test('el estado trae cuántas sugerencias hay en cada uno, y el subtítulo cuántas esperan revisión', async () => {
    await montar()

    expect(screen.getByText(/2 pendiente\(s\) de revisión\./)).toBeTruthy()

    await userEvent.click(screen.getByRole('combobox', { name: /estado/i }))

    expect(await screen.findByRole('option', { name: 'Pendientes (2)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Aprobadas (7)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Rechazadas (1)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Archivadas (4)' })).toBeTruthy()
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
    expect(envio.getByText('Prioridad: high')).toBeTruthy()
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

  test('sin sugerencias lo dice', async () => {
    await montar({ items: [], counters: {} })

    expect(screen.getByText('No hay sugerencias para este filtro.')).toBeTruthy()
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
  test('las pendientes tienen Aprobar, Rechazar y Archivar; las demás no tienen ninguna acción', async () => {
    await montar({ ...RESPUESTA, items: [ENVIO, VIEJA, ARCHIVADA] })

    const pendiente = within(tarjeta('Cuánto tarda el envío a Córdoba'))
    expect(pendiente.getByRole('button', { name: 'Aprobar' })).toBeTruthy()
    expect(pendiente.getByRole('button', { name: 'Rechazar' })).toBeTruthy()
    expect(pendiente.getByRole('button', { name: 'Archivar' })).toBeTruthy()

    for (const titulo of ['Pedido de factura A', 'Promo vieja']) {
      expect(within(tarjeta(titulo)).queryByRole('button')).toBeNull()
    }
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

    expect(screen.queryByText(/pendiente\(s\) visibles/)).toBeNull()
  })

  test('seleccionar todas cuenta cuántas hay y muestra las acciones; cancelar las suelta', async () => {
    await montar()

    expect(screen.getByText('Seleccionar las 2 pendiente(s) visibles')).toBeTruthy()
    expect(within(barraDeLote()).queryByRole('button', { name: 'Aprobar' })).toBeNull()

    await seleccionarTodas()

    expect(screen.getByText('2 seleccionada(s)')).toBeTruthy()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('Seleccionar las 2 pendiente(s) visibles')).toBeTruthy()
  })

  test('aprobar en lote manda cada id, sin editar nada, y avisa', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Aprobar' }))

    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(2))
    expect(mockApprove).toHaveBeenCalledWith('s1')
    expect(mockApprove).toHaveBeenCalledWith('s2')
    expect(
      await screen.findByText('2 sugerencia(s) aprobada(s) y convertida(s) en conocimiento.'),
    ).toBeTruthy()
  })

  test('archivar en lote manda cada id', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Archivar' }))

    await waitFor(() => expect(mockArchive).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2 sugerencia(s) archivada(s).')).toBeTruthy()
  })

  test('rechazar en lote comparte un mismo motivo', async () => {
    await montar()
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Rechazar' }))
    const dialogo = within(screen.getByRole('dialog'))
    expect(dialogo.getByText('Rechazar 2 sugerencia(s)')).toBeTruthy()
    escribir(dialogo.getByLabelText(/Motivo/), 'Duplicadas')
    await userEvent.click(dialogo.getByRole('button', { name: 'Rechazar 2' }))

    await waitFor(() => expect(mockReject).toHaveBeenCalledTimes(2))
    expect(mockReject).toHaveBeenCalledWith('s1', 'Duplicadas')
    expect(mockReject).toHaveBeenCalledWith('s2', 'Duplicadas')
  })

  test('si una falla, el resto se aplica y avisa cuántas salieron bien y cuántas no', async () => {
    await montar()
    mockArchive.mockResolvedValueOnce({})
    mockArchive.mockRejectedValueOnce(new Error('x'))
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Archivar' }))

    expect(await screen.findByText(/1 archivada\(s\), 1 falló\(aron\)/)).toBeTruthy()
  })

  test('si fallan todas, avisa que no se pudo con ninguna', async () => {
    await montar()
    mockArchive.mockRejectedValue(new Error('x'))
    await seleccionarTodas()

    await userEvent.click(within(barraDeLote()).getByRole('button', { name: 'Archivar' }))

    expect(await screen.findByText('No se pudo completar la acción en ninguna (2).')).toBeTruthy()
  })

  test('cambiar de filtro suelta la selección', async () => {
    await montar()
    await seleccionarTodas()
    expect(screen.getByText('2 seleccionada(s)')).toBeTruthy()

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))

    await waitFor(() => expect(screen.queryByText('2 seleccionada(s)')).toBeNull())
  })
})
