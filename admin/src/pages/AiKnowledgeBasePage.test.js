// Base de conocimiento del agente de IA (AiKnowledgeBasePage).
//
// Acá el comercio escribe lo que el agente de ventas usa para responder: preguntas frecuentes,
// políticas, guías de producto. Lo que se carga acá termina dicho a los clientes. No tenía tests.
// Lo que se fija:
//
//   - la consulta al servidor y cómo cambia con cada filtro;
//   - qué se muestra de cada entrada y qué acciones ofrece según su estado;
//   - lo que se manda al crear, editar, aprobar y archivar;
//   - qué se avisa cuando algo sale bien o mal.

import React from 'react'
import { jest } from '@jest/globals'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockList = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockApprove = jest.fn()
const mockDelete = jest.fn()

jest.unstable_mockModule('../services/aiKnowledgeService.js', () => ({
  listKnowledge: mockList,
  createKnowledgeItem: mockCreate,
  updateKnowledgeItem: mockUpdate,
  approveKnowledgeItem: mockApprove,
  deleteKnowledgeItem: mockDelete,
}))

const { default: AiKnowledgeBasePage } = await import('./AiKnowledgeBasePage.jsx')

const ENVIOS = {
  _id: 'k1',
  title: 'Cuánto tarda un envío',
  content: 'Los envíos tardan entre 3 y 5 días hábiles.',
  type: 'faq',
  status: 'approved',
  confidence: 0.8,
  tags: ['envío', 'plazos'],
}
const DEVOLUCION = {
  _id: 'k2',
  title: 'Política de devolución',
  content: 'Se acepta la devolución dentro de los 10 días.',
  type: 'policy',
  status: 'pending_approval',
  confidence: 1,
  tags: [],
}
const VIEJA = {
  _id: 'k3',
  title: 'Promo vieja',
  content: 'Ya no vale.',
  type: 'custom',
  status: 'archived',
  confidence: 0.5,
}

const RESPUESTA = {
  items: [ENVIOS, DEVOLUCION],
  meta: {
    total: 2,
    page: 1,
    totalPages: 1,
    counters: { approved: 5, pending_approval: 2, draft: 1, rejected: 0, archived: 3 },
  },
}

const montar = async (respuesta = RESPUESTA) => {
  mockList.mockResolvedValue(respuesta)

  render(<AiKnowledgeBasePage />)

  await waitFor(() => expect(mockList).toHaveBeenCalled())
}

const ultimaConsulta = () => mockList.mock.calls[mockList.mock.calls.length - 1][0]

// Tipear letra por letra re-renderiza toda la lista en cada tecla: para textos largos alcanza con fijar el valor.
const escribir = (input, valor) => fireEvent.change(input, { target: { value: valor } })

const tarjeta = titulo => screen.getByText(titulo).closest('.MuiPaper-root')

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue({})
  mockUpdate.mockResolvedValue({})
  mockApprove.mockResolvedValue({})
  mockDelete.mockResolvedValue({})
})

describe('Conocimiento · consulta', () => {
  test('al abrir pide las entradas aprobadas, de a 50', async () => {
    await montar()

    expect(mockList).toHaveBeenCalledWith({
      status: 'approved',
      type: undefined,
      search: undefined,
      page: 1,
      limit: 50,
    })
  })

  test('cambiar el estado o el tipo vuelve a pedir con ese filtro', async () => {
    await montar()

    await userEvent.click(screen.getByRole('combobox', { name: /estado/i }))
    await userEvent.click(await screen.findByRole('option', { name: /Pendientes/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('pending_approval'))

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ type: 'faq' }))
  })

  test('«Todos los tipos» saca el filtro de tipo', async () => {
    await montar()

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'FAQ' }))
    await waitFor(() => expect(ultimaConsulta().type).toBe('faq'))

    await userEvent.click(screen.getByRole('combobox', { name: /tipo/i }))
    await userEvent.click(await screen.findByRole('option', { name: 'Todos los tipos' }))
    await waitFor(() => expect(ultimaConsulta().type).toBeUndefined())
  })

  test('las opciones de estado traen cuántas entradas hay en cada uno', async () => {
    await montar()

    await userEvent.click(screen.getByRole('combobox', { name: /estado/i }))

    expect(await screen.findByRole('option', { name: 'Aprobadas (5)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Pendientes (2)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Archivadas (3)' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Todas' })).toBeTruthy()
  })

  test('«Actualizar» vuelve a pedir lo mismo', async () => {
    await montar()
    mockList.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
  })
})

describe('Conocimiento · lo que se ve', () => {
  test('cada entrada muestra su título, su contenido, su tipo, su estado y su confianza', async () => {
    await montar()

    const envios = within(tarjeta('Cuánto tarda un envío'))

    expect(envios.getByText('Los envíos tardan entre 3 y 5 días hábiles.')).toBeTruthy()
    expect(envios.getByText('FAQ')).toBeTruthy()
    expect(envios.getByText('Aprobada')).toBeTruthy()
    expect(envios.getByText('Confianza 80%')).toBeTruthy()
    expect(envios.getByText('envío')).toBeTruthy()
    expect(envios.getByText('plazos')).toBeTruthy()
  })

  test('una entrada sin título dice «Sin título»', async () => {
    await montar({ ...RESPUESTA, items: [{ ...ENVIOS, title: '' }] })

    expect(screen.getByText('Sin título')).toBeTruthy()
  })

  test('sin entradas lo dice', async () => {
    await montar({ items: [], meta: {} })

    expect(await screen.findByText('No se encontró conocimiento con estos filtros.')).toBeTruthy()
  })

  test('mientras carga muestra un indicador', async () => {
    mockList.mockReturnValue(new Promise(() => {}))

    render(<AiKnowledgeBasePage />)

    expect(await screen.findByRole('progressbar')).toBeTruthy()
  })

  test('si falla la carga muestra el mensaje del servidor', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValue({ response: { data: { message: 'Sin permiso' } } })

    render(<AiKnowledgeBasePage />)

    expect(await screen.findByText('Sin permiso')).toBeTruthy()
    console.error.mockRestore()
  })

  test('un error sin mensaje muestra uno genérico', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValue(new Error(''))

    render(<AiKnowledgeBasePage />)

    expect(await screen.findByText('No se pudo cargar la base de conocimiento.')).toBeTruthy()
    console.error.mockRestore()
  })

  test('con varias páginas dice cuántas hay, pero no deja pasar de página', async () => {
    await montar({ ...RESPUESTA, meta: { ...RESPUESTA.meta, total: 120, totalPages: 3 } })

    expect(screen.getByText('Mostrando 2 de 120 (página 1 de 3)')).toBeTruthy()
  })
})

describe('Conocimiento · acciones según el estado', () => {
  test('«Aprobar» solo está en las pendientes', async () => {
    await montar()

    expect(
      within(tarjeta('Política de devolución')).getByRole('button', { name: 'Aprobar' }),
    ).toBeTruthy()
    expect(
      within(tarjeta('Cuánto tarda un envío')).queryByRole('button', { name: 'Aprobar' }),
    ).toBeNull()
  })

  test('«Archivar» no está en las que ya están archivadas', async () => {
    await montar({ ...RESPUESTA, items: [ENVIOS, VIEJA] })

    expect(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Archivar' }),
    ).toBeTruthy()
    expect(within(tarjeta('Promo vieja')).queryByRole('button', { name: 'Archivar' })).toBeNull()
  })

  test('aprobar manda el id y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Política de devolución')).getByRole('button', { name: 'Aprobar' }),
    )

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('k2'))
    expect(await screen.findByText('Conocimiento aprobado.')).toBeTruthy()
  })

  test('archivar manda el id y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Archivar' }),
    )

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('k1'))
    expect(await screen.findByText('Conocimiento archivado.')).toBeTruthy()
  })

  test('si falla aprobar o archivar, avisa con el mensaje del servidor o uno genérico', async () => {
    await montar()
    mockApprove.mockRejectedValue({ response: { data: { message: 'Ya fue aprobada' } } })
    mockDelete.mockRejectedValue(new Error(''))

    await userEvent.click(
      within(tarjeta('Política de devolución')).getByRole('button', { name: 'Aprobar' }),
    )
    expect(await screen.findByText('Ya fue aprobada')).toBeTruthy()

    await userEvent.click(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Archivar' }),
    )
    expect(await screen.findByText('Error al archivar.')).toBeTruthy()
  })
})

describe('Conocimiento · crear y editar', () => {
  const campo = nombre =>
    within(screen.getByRole('dialog')).getByLabelText(nombre, { exact: false })

  test('crear sin título o sin contenido no manda nada y avisa', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    await userEvent.type(campo('Título'), 'Solo título')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    expect(await screen.findByText('Título y contenido son obligatorios.')).toBeTruthy()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('crear manda título, contenido, tipo, etiquetas y confianza, y vuelve a cargar', async () => {
    await montar()
    mockList.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))

    expect(screen.getByText('Nuevo conocimiento')).toBeTruthy()

    escribir(campo('Título'), '  Medios de pago  ')
    escribir(campo('Contenido'), 'Aceptamos tarjeta y transferencia.')
    escribir(campo('Tags'), 'pagos, , tarjeta ,')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        title: 'Medios de pago',
        content: 'Aceptamos tarjeta y transferencia.',
        type: 'custom',
        tags: ['pagos', 'tarjeta'],
        confidence: 1,
      }),
    )
    expect(await screen.findByText('Conocimiento creado.')).toBeTruthy()
    await waitFor(() => expect(mockList).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('editar abre la entrada con sus datos y manda su id y los cambios', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Editar' }),
    )

    expect(screen.getByText('Editar conocimiento')).toBeTruthy()
    expect(campo('Título').value).toBe('Cuánto tarda un envío')
    expect(campo('Tags').value).toBe('envío, plazos')

    await userEvent.clear(campo('Título'))
    await userEvent.type(campo('Título'), 'Plazos de envío')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('k1', {
        title: 'Plazos de envío',
        content: 'Los envíos tardan entre 3 y 5 días hábiles.',
        type: 'faq',
        tags: ['envío', 'plazos'],
        confidence: 0.8,
      }),
    )
    expect(await screen.findByText('Conocimiento actualizado.')).toBeTruthy()
  })

  test('si falla guardar, avisa con el mensaje del servidor o uno genérico y el diálogo sigue abierto', async () => {
    await montar()
    mockCreate.mockRejectedValue({ response: { data: { message: 'Contenido demasiado largo' } } })

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    await userEvent.type(campo('Título'), 'Algo')
    await userEvent.type(campo('Contenido'), 'Algo más')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    expect(await screen.findByText('Contenido demasiado largo')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()

    mockCreate.mockRejectedValue(new Error(''))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    expect(await screen.findByText('Error al guardar.')).toBeTruthy()
  })

  test('cancelar cierra el diálogo sin mandar nada', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('el título admite hasta 200 caracteres y el contenido hasta 10.000', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))

    expect(campo('Título').getAttribute('maxlength')).toBe('200')
    expect(campo('Contenido').getAttribute('maxlength')).toBe('10000')
  })
})
