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

const { default: Enquiries } = await import('./Enquiries.js')

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

    expect(screen.getByText('Total: 3')).toBeTruthy()
    expect(screen.getByText('En Proceso: 1')).toBeTruthy()
    expect(screen.getByText('Resueltas: 1')).toBeTruthy()
  })

  test('acepta la lista envuelta en {data: [...]}', () => {
    montar({ data: [ANA, BETO] })

    expect(screen.getByText('Total: 2')).toBeTruthy()
    expect(screen.getByText('beto@mail.com')).toBeTruthy()
  })

  test('sin consultas lo dice', () => {
    montar([])

    expect(screen.getByText('No hay consultas nuevas.')).toBeTruthy()
    expect(screen.getByText('Total: 0')).toBeTruthy()
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
    await userEvent.click(await screen.findByRole('option', { name: 'En Proceso' }))

    expect(mockUpdateStatus).toHaveBeenCalledWith({ id: 'q1', status: 'In Progress' })
  })

  test('el selector arranca en el estado actual de la consulta', () => {
    montar()

    expect(deConsulta('ana@mail.com').getByRole('combobox').textContent).toBe('Recibida')
    expect(deConsulta('beto@mail.com').getByRole('combobox').textContent).toBe('En Proceso')
    expect(deConsulta('cami@mail.com').getByRole('combobox').textContent).toBe('Resuelta')
  })

  test.each([
    ['Recibida', 'Submitted'],
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
