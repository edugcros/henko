// Consultas (Enquiries).
//
// Pantalla donde el comercio lee lo que le escriben sus clientes, cambia el estado de cada consulta,
// la responde por correo o la borra. No tenía tests. Lo que se fija acá:
//
//   - qué se muestra de cada consulta y los totales;
//   - cada acción con el dato exacto que manda (estado, borrar, responder) y sus confirmaciones;
//   - qué se le avisa a quien opera cuando algo sale bien o mal;
//   - qué se ve cuando no hay consultas o cuando no se pudieron cargar.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const mockGetEnquiries = jest.fn(() => ({ type: 'getEnquiries' }))
const mockUpdateStatus = jest.fn(args => ({ type: 'updateStatus', args }))
const mockDeleteEnquiry = jest.fn(id => ({ type: 'deleteEnquiry', id }))
const mockSendReply = jest.fn(args => ({ type: 'sendReply', args }))
const mockReset = jest.fn(() => ({ type: 'reset' }))
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()
const mockToastLoading = jest.fn(() => 'toast-1')

const estado = {
  enquiry: { enquiries: [], isLoading: false, isError: false, isSuccess: false, message: '' },
}

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/enquiry/enquirySlice', () => ({
  getEnquiries: mockGetEnquiries,
  updateEnquiryStatus: mockUpdateStatus,
  deleteEnquiry: mockDeleteEnquiry,
  resetEnquiryState: mockReset,
  sendReplyEnquiry: mockSendReply,
}))

jest.unstable_mockModule('react-hot-toast', () => {
  const toast = () => {}
  toast.success = mockToastSuccess
  toast.error = mockToastError
  toast.loading = mockToastLoading

  return { default: toast, Toaster: () => null }
})

const {
  default: Enquiries,
  STATUS_META,
  getStatus,
  getEnquiryList,
  normalizeText,
  filterEnquiries,
} = await import('./Enquiries.js')

const ANA = {
  _id: 'q1',
  name: 'Ana Pérez',
  email: 'ana@mail.com',
  mobile: '3585132769',
  comment: '¿Tienen el casco en talle M?',
  status: 'Submitted',
  createdAt: '2026-10-10T12:00:00.000Z',
}
const BETO = {
  _id: 'q2',
  name: 'Beto Gómez',
  email: 'beto@mail.com',
  mobile: '1155550000',
  comment: 'Quiero saber si hacen envíos a Salta',
  status: 'In Progress',
  createdAt: '2026-10-11T12:00:00.000Z',
}
const CAMI = {
  _id: 'q3',
  name: 'Cami Ruiz',
  email: 'cami@mail.com',
  mobile: '3515550101',
  comment: 'Gracias, ya me llegó',
  status: 'Resolved',
  createdAt: '2026-10-12T12:00:00.000Z',
}

const montar = (enquiries = [ANA, BETO, CAMI], resto = {}) => {
  estado.enquiry = {
    enquiries,
    isLoading: false,
    isError: false,
    isSuccess: false,
    message: '',
    ...resto,
  }

  return render(<Enquiries />)
}

// Tarjeta de una consulta: el ancestro más chico que contiene el correo y los botones.
const deConsulta = email => {
  let nodo = screen.getByText(email)

  while (nodo && !nodo.querySelector('button')) nodo = nodo.parentElement

  return within(nodo)
}

const tile = nombre =>
  within(screen.getByRole('region', { name: /resumen de consultas/i }))
    .getByText(nombre, { selector: 'span' })
    .closest('button')

const boton = (email, icono) => deConsulta(email).getByTestId(icono).closest('button')

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
})

describe('Consultas · lo que se ve', () => {
  test('al abrir pide las consultas', () => {
    montar()

    expect(mockGetEnquiries).toHaveBeenCalledTimes(1)
  })

  test('muestra el nombre, el correo, el teléfono y el mensaje de cada consulta', () => {
    montar()

    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByText('ana@mail.com')).toBeTruthy()
    expect(screen.getByText('3585132769')).toBeTruthy()
    expect(screen.getByText(/¿Tienen el casco en talle M\?/)).toBeTruthy()
  })

  test('una consulta sin atender se marca como nueva', () => {
    montar()

    expect(deConsulta('ana@mail.com').getByText('Nueva')).toBeTruthy()
  })

  test('el encabezado cuenta el total, las que están en proceso y las resueltas', () => {
    montar()

    expect(within(tile('Total')).getByText('3')).toBeTruthy()
    expect(within(tile('Nuevas')).getByText('1')).toBeTruthy()
    expect(within(tile('En proceso')).getByText('1')).toBeTruthy()
    expect(within(tile('Resueltas')).getByText('1')).toBeTruthy()
  })

  test('acepta la lista envuelta en {data: [...]}', () => {
    montar({ data: [ANA, BETO] })

    expect(within(tile('Total')).getByText('2')).toBeTruthy()
    expect(screen.getByText('beto@mail.com')).toBeTruthy()
  })

  test('sin consultas lo dice', () => {
    montar([])

    expect(screen.getByText('No hay consultas nuevas.')).toBeTruthy()
    expect(within(tile('Total')).getByText('0')).toBeTruthy()
  })

  test('mientras carga muestra el aviso de carga', () => {
    montar([], { isLoading: true })

    expect(screen.getByText('Cargando consultas...')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  test('un mensaje de éxito del servidor se avisa y se limpia', () => {
    montar([ANA], { isSuccess: true, message: 'Consulta eliminada' })

    expect(mockToastSuccess).toHaveBeenCalledWith('Consulta eliminada')
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'reset' })
  })
})

describe('Consultas · cambiar el estado', () => {
  test('elegir otro estado manda el id y el estado en inglés que espera el servidor', async () => {
    montar()

    const combo = deConsulta('ana@mail.com').getByRole('combobox')

    await userEvent.click(combo)
    await userEvent.click(await screen.findByRole('option', { name: 'En proceso' }))

    expect(mockUpdateStatus).toHaveBeenCalledWith({ id: 'q1', status: 'In Progress' })
  })

  test('el selector arranca en el estado actual de la consulta', () => {
    montar()

    expect(deConsulta('ana@mail.com').getByRole('combobox').textContent).toBe('Nueva')
    expect(deConsulta('beto@mail.com').getByRole('combobox').textContent).toBe('En proceso')
    expect(deConsulta('cami@mail.com').getByRole('combobox').textContent).toBe('Resuelta')
  })

  test.each([
    ['Nueva', 'Submitted'],
    ['Resuelta', 'Resolved'],
  ])('«%s» manda %s', async (opcion, valor) => {
    montar([BETO])

    await userEvent.click(deConsulta('beto@mail.com').getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: opcion }))

    expect(mockUpdateStatus).toHaveBeenCalledWith({ id: 'q2', status: valor })
  })
})

describe('Consultas · eliminar', () => {
  test('pide confirmación con el nombre de quien escribió, y recién al confirmar manda el id', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('¿Eliminar consulta?')).toBeTruthy()
    expect(within(dialogo).getByText('Ana Pérez')).toBeTruthy()
    expect(mockDeleteEnquiry).not.toHaveBeenCalled()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    expect(mockDeleteEnquiry).toHaveBeenCalledWith('q1')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('cancelar no borra nada', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDeleteEnquiry).not.toHaveBeenCalled()
  })
})

describe('Consultas · responder', () => {
  const abrirRespuesta = async email => {
    await userEvent.click(boton(email, 'ReplyIcon'))

    return screen.findByRole('dialog')
  }

  test('muestra la consulta original y a quién se responde', async () => {
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    expect(within(dialogo).getByText(/Responder a Ana Pérez/)).toBeTruthy()
    expect(within(dialogo).getByText(/¿Tienen el casco en talle M\?/)).toBeTruthy()
  })

  test('sin escribir nada avisa y no manda', async () => {
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    await userEvent.click(within(dialogo).getByRole('button', { name: /enviar respuesta/i }))

    expect(mockToastError).toHaveBeenCalledWith('Escribe un mensaje')
    expect(mockSendReply).not.toHaveBeenCalled()
  })

  test('un mensaje de solo espacios cuenta como vacío', async () => {
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    await userEvent.type(within(dialogo).getByRole('textbox'), '   ')
    await userEvent.click(within(dialogo).getByRole('button', { name: /enviar respuesta/i }))

    expect(mockSendReply).not.toHaveBeenCalled()
  })

  test('manda el id y el mensaje, avisa que se envió y cierra la ventana', async () => {
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    await userEvent.type(within(dialogo).getByRole('textbox'), 'Sí, tenemos talle M')
    await userEvent.click(within(dialogo).getByRole('button', { name: /enviar respuesta/i }))

    await waitFor(() =>
      expect(mockSendReply).toHaveBeenCalledWith({ id: 'q1', message: 'Sí, tenemos talle M' }),
    )
    expect(mockToastLoading).toHaveBeenCalledWith('Enviando respuesta...')
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('¡Email enviado con éxito!', { id: 'toast-1' }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('si falla, avisa con el mensaje del servidor y la ventana sigue abierta', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'sendReply' ? Promise.reject('El correo rebotó') : Promise.resolve({}),
    }))
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    await userEvent.type(within(dialogo).getByRole('textbox'), 'Hola')
    await userEvent.click(within(dialogo).getByRole('button', { name: /enviar respuesta/i }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Error: El correo rebotó', { id: 'toast-1' }),
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    console.error.mockRestore()
  })

  test('sin mensaje del servidor avisa que no se pudo conectar', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'sendReply' ? Promise.reject('') : Promise.resolve({})),
    }))
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    await userEvent.type(within(dialogo).getByRole('textbox'), 'Hola')
    await userEvent.click(within(dialogo).getByRole('button', { name: /enviar respuesta/i }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Error: No se pudo conectar con el servidor', {
        id: 'toast-1',
      }),
    )
    console.error.mockRestore()
  })

  test('cancelar cierra la ventana sin mandar nada', async () => {
    montar()

    const dialogo = await abrirRespuesta('ana@mail.com')

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockSendReply).not.toHaveBeenCalled()
  })
})

describe('Consultas · funciones de búsqueda y estado', () => {
  test('getStatus trata la consulta sin estado, o con uno desconocido, como nueva', () => {
    expect(getStatus({ status: 'Resolved' })).toBe('Resolved')
    expect(getStatus({ status: 'In Progress' })).toBe('In Progress')
    expect(getStatus({})).toBe('Submitted')
    expect(getStatus({ status: 'Otro' })).toBe('Submitted')
    expect(getStatus(undefined)).toBe('Submitted')
  })

  test('cada estado se muestra en español', () => {
    expect(STATUS_META.Submitted.label).toBe('Nueva')
    expect(STATUS_META['In Progress'].label).toBe('En proceso')
    expect(STATUS_META.Resolved.label).toBe('Resuelta')
  })

  test('getEnquiryList acepta una lista, un objeto con data o nada', () => {
    expect(getEnquiryList([ANA])).toEqual([ANA])
    expect(getEnquiryList({ data: [BETO] })).toEqual([BETO])
    expect(getEnquiryList(undefined)).toEqual([])
    expect(getEnquiryList({})).toEqual([])
  })

  test('normalizeText ignora mayúsculas y acentos', () => {
    expect(normalizeText('  GÓMEZ ')).toBe('gomez')
    expect(normalizeText(null)).toBe('')
  })

  test('filterEnquiries combina estado y búsqueda en nombre, correo, teléfono y mensaje', () => {
    const todas = [ANA, BETO, CAMI]

    expect(filterEnquiries(todas)).toHaveLength(3)
    expect(filterEnquiries(todas, { status: 'Submitted' }).map(e => e._id)).toEqual(['q1'])
    expect(filterEnquiries(todas, { status: 'Resolved' }).map(e => e._id)).toEqual(['q3'])
    expect(filterEnquiries(todas, { search: 'gomez' }).map(e => e._id)).toEqual(['q2'])
    expect(filterEnquiries(todas, { search: 'SALTA' }).map(e => e._id)).toEqual(['q2'])
    expect(filterEnquiries(todas, { search: '3515550101' }).map(e => e._id)).toEqual(['q3'])
    expect(filterEnquiries(todas, { search: 'cami@' }).map(e => e._id)).toEqual(['q3'])
    expect(filterEnquiries(todas, { status: 'Resolved', search: 'ana' })).toEqual([])
    expect(filterEnquiries(undefined)).toEqual([])
  })
})

describe('Consultas · buscar y filtrar', () => {
  const visibles = () =>
    ['ana@mail.com', 'beto@mail.com', 'cami@mail.com'].filter(correo => screen.queryByText(correo))

  test('buscar deja solo las consultas que coinciden, en cualquier parte del texto', async () => {
    montar()

    await userEvent.type(screen.getByRole('textbox', { name: /buscar consultas/i }), 'SALTA')

    expect(visibles()).toEqual(['beto@mail.com'])
  })

  test('tocar una cifra del resumen filtra, y tocarla de nuevo lo quita', async () => {
    montar()

    await userEvent.click(tile('Resueltas'))
    expect(visibles()).toEqual(['cami@mail.com'])
    expect(tile('Resueltas').getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(tile('Nuevas'))
    expect(visibles()).toEqual(['ana@mail.com'])

    await userEvent.click(tile('Nuevas'))
    expect(visibles()).toHaveLength(3)
  })

  test('«Limpiar filtros» aparece solo con filtros y los saca juntos', async () => {
    montar()

    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).toBeNull()

    await userEvent.type(screen.getByRole('textbox', { name: /buscar consultas/i }), 'ana')
    await userEvent.click(tile('Resueltas'))

    expect(screen.getByText('Ninguna consulta coincide con la búsqueda.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    expect(visibles()).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: /buscar consultas/i }).value).toBe('')
  })

  test('las cifras cuentan todas las consultas, no solo las que se ven', async () => {
    montar()

    await userEvent.type(screen.getByRole('textbox', { name: /buscar consultas/i }), 'ana')

    expect(within(tile('Total')).getByText('3')).toBeTruthy()
  })

  test('sin consultas no se ofrece buscar', () => {
    montar([])

    expect(screen.queryByRole('textbox', { name: /buscar consultas/i })).toBeNull()
  })
})

describe('Consultas · lo que se mejoró', () => {
  test('el estado nunca se muestra en inglés', () => {
    montar()

    expect(screen.queryByText('In Progress')).toBeNull()
    expect(screen.queryByText('Resolved')).toBeNull()
    expect(screen.queryByText('Submitted')).toBeNull()
  })

  test('los botones y el selector de cada consulta tienen nombre', () => {
    montar()

    expect(screen.getByRole('button', { name: 'Responder a Ana Pérez' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Eliminar la consulta de Ana Pérez' })).toBeTruthy()
    expect(
      screen.getByRole('combobox', { name: 'Estado de la consulta de Ana Pérez' }),
    ).toBeTruthy()
  })

  test('la fecha sale como día/mes/año argentino', () => {
    montar([ANA])

    expect(screen.getByText('10/10/2026')).toBeTruthy()
  })

  test('una fecha inválida se muestra con un guion y no como «Invalid Date»', () => {
    montar([{ ...ANA, createdAt: 'no es fecha' }])

    expect(screen.queryByText('Invalid Date')).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  test('una consulta sin teléfono no muestra una línea vacía', () => {
    montar([{ ...ANA, mobile: undefined }])

    expect(deConsulta('ana@mail.com').queryByTestId('PhoneIcon')).toBeNull()
  })

  test('si no se pudieron cargar las consultas lo dice, en vez de «no hay consultas»', () => {
    montar([], { isError: true, message: 'Sin conexión con el servidor' })

    expect(screen.getByText('Sin conexión con el servidor')).toBeTruthy()
    expect(screen.queryByText('No hay consultas nuevas.')).toBeNull()
  })

  test('«Reintentar» limpia el error y vuelve a pedir las consultas', async () => {
    montar([], { isError: true, message: 'Sin conexión con el servidor' })
    mockGetEnquiries.mockClear()
    mockDispatch.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(mockReset).toHaveBeenCalled()
    expect(mockGetEnquiries).toHaveBeenCalledTimes(1)
  })

  test('un error de una acción no tapa las consultas que ya estaban cargadas', () => {
    montar([ANA], { isError: true, message: 'No se pudo cambiar el estado' })

    expect(screen.getByText('ana@mail.com')).toBeTruthy()
  })

  test('si falla cambiar el estado, avisa con el mensaje del servidor', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'updateStatus' ? Promise.reject('Sin permiso') : Promise.resolve({}),
    }))
    montar()

    await userEvent.click(deConsulta('ana@mail.com').getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'Resuelta' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Sin permiso'))
  })

  test('si falla eliminar sin mensaje, avisa con uno genérico', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'deleteEnquiry' ? Promise.reject('') : Promise.resolve({})),
    }))
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Eliminar' }),
    )

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('No se pudo eliminar la consulta.'),
    )
  })

  test('el borrador de una respuesta no pasa a la consulta siguiente', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'ReplyIcon'))
    const primera = await screen.findByRole('dialog')

    await userEvent.type(within(primera).getByRole('textbox'), 'Borrador para Ana')
    await userEvent.click(within(primera).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(boton('beto@mail.com', 'ReplyIcon'))

    expect((await screen.findByRole('textbox')).value).toBe('')
  })

  test('el borrador de la misma consulta se conserva si se cierra y se vuelve a abrir', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'ReplyIcon'))
    await userEvent.type(
      within(await screen.findByRole('dialog')).getByRole('textbox'),
      'Sigo mañana',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await userEvent.click(boton('ana@mail.com', 'ReplyIcon'))

    expect((await screen.findByRole('textbox')).value).toBe('Sigo mañana')
  })

  test('mientras se envía la respuesta no se puede mandar dos veces', async () => {
    let terminar
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'sendReply'
          ? new Promise(resolve => {
              terminar = resolve
            })
          : Promise.resolve({}),
    }))
    montar()

    await userEvent.click(boton('ana@mail.com', 'ReplyIcon'))
    const dialogo = await screen.findByRole('dialog')

    await userEvent.type(within(dialogo).getByRole('textbox'), 'Hola')
    const enviar = within(dialogo).getByRole('button', { name: /enviar respuesta/i })

    await userEvent.click(enviar)

    await waitFor(() => expect(enviar.disabled).toBe(true))
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' }).disabled).toBe(true)
    expect(mockSendReply).toHaveBeenCalledTimes(1)

    terminar({})
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('Consultas · tarjetas', () => {
  test('cada consulta es una tarjeta con todo a la vista', () => {
    montar()

    const tarjetas = screen.getAllByRole('article')

    expect(tarjetas).toHaveLength(3)

    const ana = within(tarjetas[0])

    expect(ana.getByText('Ana Pérez')).toBeTruthy()
    expect(ana.getByText('ana@mail.com')).toBeTruthy()
    expect(ana.getByText(/¿Tienen el casco en talle M\?/)).toBeTruthy()
    expect(ana.getByRole('combobox').textContent).toBe('Nueva')
  })
})
