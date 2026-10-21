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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const {
  default: AiKnowledgeBasePage,
  parseTags,
  toPayload,
} = await import('./AiKnowledgeBasePage.jsx')

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

    await userEvent.click(screen.getByRole('button', { name: /^Pendientes/ }))
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

  test('el resumen trae cuántas entradas hay en cada estado, y el estado elegido queda marcado', async () => {
    await montar()

    const resumen = within(
      screen.getByRole('region', { name: 'Resumen de la base de conocimiento' }),
    )

    expect(resumen.getByRole('button', { name: 'Aprobadas 5' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(resumen.getByRole('button', { name: 'Pendientes 2' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Borradores 1' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Rechazadas 0' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Archivadas 3' })).toBeTruthy()
    expect(resumen.getByRole('button', { name: 'Todas 11' })).toBeTruthy()
  })

  test('«Todas» y cualquier otro estado del resumen filtran por ese estado', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: /^Todas/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('all'))

    await userEvent.click(screen.getByRole('button', { name: /^Archivadas/ }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('archived'))
  })

  test('la búsqueda espera a que se deje de escribir y vuelve a la página 1', async () => {
    await montar({ ...RESPUESTA, meta: { ...RESPUESTA.meta, total: 120, totalPages: 3 } })

    await userEvent.click(screen.getByRole('button', { name: 'Ir a la página 2' }))
    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
    mockList.mockClear()

    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar conocimiento' }), 'envio')

    expect(mockList).not.toHaveBeenCalled()
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1))
    expect(ultimaConsulta()).toMatchObject({ search: 'envio', page: 1 })
  })

  test('«Limpiar filtros» solo aparece con filtros y vuelve a lo aprobado, de todos los tipos, sin búsqueda', async () => {
    await montar()

    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^Pendientes/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Limpiar filtros' }))

    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({
        status: 'approved',
        type: undefined,
        search: undefined,
        page: 1,
      }),
    )
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull()
  })

  test('una respuesta lenta de una consulta anterior no pisa a la más reciente', async () => {
    await montar()

    let responderLenta
    mockList.mockReturnValueOnce(new Promise(resolve => (responderLenta = resolve)))
    mockList.mockResolvedValueOnce({ items: [ENVIOS], meta: { total: 1, counters: {} } })

    await userEvent.click(screen.getByRole('button', { name: /^Pendientes/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Archivadas/ }))
    await screen.findByText('Cuánto tarda un envío')

    await act(async () => {
      responderLenta({ items: [VIEJA], meta: { total: 1, counters: {} } })
    })

    expect(screen.queryByText('Promo vieja')).toBeNull()
    expect(screen.getByText('Cuánto tarda un envío')).toBeTruthy()
  })

  test('mientras se vuelve a consultar, la lista sigue a la vista', async () => {
    await montar()

    mockList.mockReturnValueOnce(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: /actualizar/i }))

    expect(await screen.findByRole('progressbar')).toBeTruthy()
    expect(screen.getByText('Cuánto tarda un envío')).toBeTruthy()
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

  test('si no hay nada cargado en ningún estado, invita a crear la primera entrada', async () => {
    await montar({ items: [], meta: { total: 0, counters: {} } })

    expect(await screen.findByText('Todavía no cargaste conocimiento')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Crear la primera entrada' }))

    expect(screen.getByText('Nuevo conocimiento')).toBeTruthy()
  })

  test('si hay entradas pero no en este filtro, lo dice sin invitar a crear', async () => {
    await montar({ items: [], meta: { total: 0, counters: { pending_approval: 2 } } })

    expect(await screen.findByText('No se encontró conocimiento con estos filtros.')).toBeTruthy()
    expect(screen.queryByText('Todavía no cargaste conocimiento')).toBeNull()
  })

  test('si falla la carga no dice además que no hay nada, y se puede reintentar', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockList.mockRejectedValueOnce(new Error('Sin conexión'))

    render(<AiKnowledgeBasePage />)

    expect(await screen.findByText('Sin conexión')).toBeTruthy()
    expect(screen.queryByText('Todavía no cargaste conocimiento')).toBeNull()
    expect(screen.queryByText('No se encontró conocimiento con estos filtros.')).toBeNull()

    mockList.mockResolvedValue(RESPUESTA)
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Cuánto tarda un envío')).toBeTruthy()
    expect(screen.queryByText('Sin conexión')).toBeNull()
    console.error.mockRestore()
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

  test('con varias páginas dice cuántas hay y deja pasar de página', async () => {
    await montar({ ...RESPUESTA, meta: { ...RESPUESTA.meta, total: 120, totalPages: 3 } })

    expect(screen.getByText('Mostrando 2 de 120 (página 1 de 3)')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
  })

  test('con una sola página cuenta las entradas y no muestra paginación', async () => {
    await montar()

    expect(screen.getByText('2 entradas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Página siguiente' })).toBeNull()
  })

  test('si la página en la que estaba quedó vacía, vuelve a la última que existe', async () => {
    await montar({ ...RESPUESTA, meta: { ...RESPUESTA.meta, total: 51, totalPages: 2 } })

    mockList.mockResolvedValueOnce({
      items: [],
      meta: { total: 50, totalPages: 1, counters: RESPUESTA.meta.counters },
    })
    mockList.mockResolvedValue(RESPUESTA)
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(1))
    expect(await screen.findByText('Cuánto tarda un envío')).toBeTruthy()
  })
})

describe('Conocimiento · acciones según el estado', () => {
  test('«Aprobar» está en todo lo que no está aprobado, y en las archivadas dice «Reactivar»', async () => {
    const BORRADOR = { ...ENVIOS, _id: 'k4', title: 'Borrador de envíos', status: 'draft' }
    await montar({ ...RESPUESTA, items: [ENVIOS, DEVOLUCION, BORRADOR, VIEJA] })

    expect(
      within(tarjeta('Política de devolución')).getByRole('button', { name: 'Aprobar' }),
    ).toBeTruthy()
    expect(
      within(tarjeta('Borrador de envíos')).getByRole('button', { name: 'Aprobar' }),
    ).toBeTruthy()
    expect(
      within(tarjeta('Cuánto tarda un envío')).queryByRole('button', { name: 'Aprobar' }),
    ).toBeNull()
    expect(within(tarjeta('Promo vieja')).getByRole('button', { name: 'Reactivar' })).toBeTruthy()
    expect(within(tarjeta('Promo vieja')).queryByRole('button', { name: 'Aprobar' })).toBeNull()
  })

  test('reactivar una archivada la aprueba y avisa que se reactivó', async () => {
    await montar({ ...RESPUESTA, items: [VIEJA] })

    await userEvent.click(within(tarjeta('Promo vieja')).getByRole('button', { name: 'Reactivar' }))

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('k3'))
    expect(await screen.findByText('Conocimiento reactivado.')).toBeTruthy()
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

  test('archivar pide confirmar antes de mandar nada', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Archivar' }),
    )

    const confirmacion = within(screen.getByRole('dialog'))
    expect(confirmacion.getByText('¿Archivar esta entrada?')).toBeTruthy()
    expect(confirmacion.getByText(/Cuánto tarda un envío/)).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()

    await userEvent.click(confirmacion.getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('archivar, ya confirmado, manda el id y avisa', async () => {
    await montar()

    await userEvent.click(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Archivar' }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archivar' }),
    )

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('k1'))
    expect(await screen.findByText('Conocimiento archivado.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Archivar' }),
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

  test('los campos cuentan los caracteres que van usando', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    const dialogo = within(screen.getByRole('dialog'))

    expect(dialogo.getByText('0/200')).toBeTruthy()
    expect(dialogo.getByText('0/10000')).toBeTruthy()

    escribir(campo('Título'), 'Envíos')

    expect(dialogo.getByText('6/200')).toBeTruthy()
  })

  test('los errores del formulario se ven dentro del diálogo y se quitan al seguir escribiendo', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    const aviso = await within(screen.getByRole('dialog')).findByText(
      'Título y contenido son obligatorios.',
    )
    expect(aviso).toBeTruthy()

    escribir(campo('Título'), 'Algo')

    expect(
      within(screen.getByRole('dialog')).queryByText('Título y contenido son obligatorios.'),
    ).toBeNull()
  })

  test('el error de una vez no queda cuando se abre otra entrada', async () => {
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )
    await screen.findByText('Título y contenido son obligatorios.')
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))

    expect(screen.queryByText('Título y contenido son obligatorios.')).toBeNull()
  })

  test('editar una entrada con confianza 0 no la sube a 100%', async () => {
    await montar({ ...RESPUESTA, items: [{ ...ENVIOS, confidence: 0 }] })

    await userEvent.click(
      within(tarjeta('Cuánto tarda un envío')).getByRole('button', { name: 'Editar' }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }),
    )

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('k1', expect.objectContaining({ confidence: 0 })),
    )
  })
})

describe('Conocimiento · armado de lo que se manda', () => {
  const FORM = { title: ' T ', content: ' C ', type: 'faq', tags: 'a, b', confidence: 0.4 }

  test('limpia espacios y separa las etiquetas', () => {
    expect(toPayload(FORM)).toEqual({
      title: 'T',
      content: 'C',
      type: 'faq',
      tags: ['a', 'b'],
      confidence: 0.4,
    })
  })

  test('la confianza 0 se respeta; sin confianza o inválida vale 1', () => {
    expect(toPayload({ ...FORM, confidence: 0 }).confidence).toBe(0)
    expect(toPayload({ ...FORM, confidence: '' }).confidence).toBe(1)
    expect(toPayload({ ...FORM, confidence: undefined }).confidence).toBe(1)
    expect(toPayload({ ...FORM, confidence: 'abc' }).confidence).toBe(1)
  })

  test('parseTags descarta vacías y tolera valores nulos', () => {
    expect(parseTags(' a , ,b,, ')).toEqual(['a', 'b'])
    expect(parseTags('')).toEqual([])
    expect(parseTags(null)).toEqual([])
  })
})

describe('Conocimiento · en el celular', () => {
  afterEach(() => {
    delete window.matchMedia
  })

  test('el formulario ocupa toda la pantalla', async () => {
    window.matchMedia = query => ({
      matches: query === '(max-width:600px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
    await montar()

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }))

    expect(screen.getByRole('dialog').className).toMatch(/MuiDialog-paperFullScreen|fullScreen/)
  })
})
