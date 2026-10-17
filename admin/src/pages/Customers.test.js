// Clientes (Customers).
//
// Pantalla donde el comercio ve a quienes se registraron en su tienda y puede verificarlos a mano,
// bloquearlos o eliminarlos. No tenía tests. Lo que se fija acá:
//
//   - qué se muestra de cada cliente y los totales;
//   - cada acción con el dato exacto que manda (eliminar, bloquear, desbloquear, verificar) y que
//     todas piden confirmación antes de hacer algo;
//   - qué se le avisa a quien opera cuando algo falla;
//   - qué se ve cuando todavía no hay clientes o no se pudo cargar la lista.

import React from 'react'
import { jest } from '@jest/globals'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const mockGetUsers = jest.fn(() => ({ type: 'getUsers' }))
const mockRemoveUser = jest.fn(id => ({ type: 'removeUser', id }))
const mockToggleBlock = jest.fn(args => ({ type: 'toggleBlock', args }))
const mockVerify = jest.fn(id => ({ type: 'verify', id }))
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()

const estado = { customers: { customers: [], isLoading: false, error: null } }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/customers/customerSlice', () => ({
  getUsers: mockGetUsers,
  removeUser: mockRemoveUser,
  toggleBlockUser: mockToggleBlock,
  verifyUserManually: mockVerify,
}))

jest.unstable_mockModule('react-toastify', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}))

const { default: Customers } = await import('./Customers.js')

const ANA = {
  _id: 'c1',
  firstname: 'Ana',
  lastname: 'Pérez',
  email: 'ana@mail.com',
  mobile: '3585132769',
  role: 'user',
  isBlocked: false,
  isEmailVerified: true,
}
const BETO = {
  _id: 'c2',
  firstname: 'Beto',
  lastname: 'Gómez',
  email: 'beto@mail.com',
  role: 'user',
  isBlocked: true,
  isEmailVerified: true,
}
const CAMI = {
  _id: 'c3',
  firstname: 'Cami',
  lastname: 'Ruiz',
  email: 'cami@mail.com',
  mobile: '1155550000',
  role: 'user',
  isBlocked: false,
  isEmailVerified: false,
}

const montar = (customers = [ANA, BETO, CAMI], resto = {}) => {
  estado.customers = { customers, isLoading: false, error: null, ...resto }

  return render(<Customers />)
}

// Tarjeta o fila de un cliente: el ancestro más chico que contiene su correo y sus botones.
const deCliente = email => {
  let nodo = screen.getByText(email)

  while (nodo && !nodo.querySelector('button')) nodo = nodo.parentElement

  return within(nodo)
}

const boton = (email, icono) => deCliente(email).getByTestId(icono).closest('button')

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }))
})

describe('Clientes · lo que se ve', () => {
  test('al abrir pide la lista de clientes del comercio', () => {
    montar()

    expect(mockGetUsers).toHaveBeenCalledTimes(1)
  })

  test('muestra el nombre, el correo y el teléfono de cada cliente', () => {
    montar()

    expect(screen.getByText('Ana Pérez')).toBeTruthy()
    expect(screen.getByText('ana@mail.com')).toBeTruthy()
    expect(screen.getByText('3585132769')).toBeTruthy()
    expect(screen.getByText('Cami Ruiz')).toBeTruthy()
  })

  test('un cliente sin teléfono dice que no lo registró', () => {
    montar()

    expect(deCliente('beto@mail.com').getByText('No registrado')).toBeTruthy()
  })

  test('cada cliente dice si está activo o bloqueado, y si falta verificar su correo', () => {
    montar()

    expect(deCliente('ana@mail.com').getByText('ACTIVO')).toBeTruthy()
    expect(deCliente('ana@mail.com').queryByText('SIN VERIFICAR')).toBeNull()
    expect(deCliente('beto@mail.com').getByText('BLOQUEADO')).toBeTruthy()
    expect(deCliente('cami@mail.com').getByText('SIN VERIFICAR')).toBeTruthy()
  })

  test('el encabezado cuenta el total y los bloqueados', () => {
    montar()

    expect(screen.getByText('Total: 3')).toBeTruthy()
    expect(screen.getByText('Bloqueados: 1')).toBeTruthy()
  })

  test('sin clientes lo dice', () => {
    montar([])

    expect(screen.getByText('No hay clientes registrados en tu comercio.')).toBeTruthy()
    expect(screen.getByText('Total: 0')).toBeTruthy()
  })

  test('mientras carga por primera vez muestra un indicador y no el aviso de vacío', () => {
    montar([], { isLoading: true })

    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByText('No hay clientes registrados en tu comercio.')).toBeNull()
  })
})

describe('Clientes · acciones', () => {
  test('eliminar pide confirmación y recién al confirmar manda el id', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))

    const dialogo = await screen.findByRole('dialog')

    expect(
      within(dialogo).getByText('¿Estás seguro de eliminar permanentemente a Ana?'),
    ).toBeTruthy()
    expect(mockRemoveUser).not.toHaveBeenCalled()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mockRemoveUser).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('cancelar la confirmación no hace nada', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockRemoveUser).not.toHaveBeenCalled()
  })

  test('bloquear manda block: true', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'BlockIcon'))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('¿Deseas restringir el acceso a Ana?')).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mockToggleBlock).toHaveBeenCalledWith({ id: 'c1', block: true }))
  })

  test('desbloquear manda block: false', async () => {
    montar()

    await userEvent.click(boton('beto@mail.com', 'CheckCircleIcon'))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText('¿Deseas restaurar el acceso a Beto?')).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mockToggleBlock).toHaveBeenCalledWith({ id: 'c2', block: false }))
  })

  test('verificar a mano aclara qué significa, manda el id y avisa que quedó verificado', async () => {
    montar()

    await userEvent.click(boton('cami@mail.com', 'MarkEmailReadIcon'))

    const dialogo = await screen.findByRole('dialog')

    expect(within(dialogo).getByText(/sin pasar por el correo de confirmación/)).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar' }))

    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('c3'))
    expect(mockToastSuccess).toHaveBeenCalledWith('cami@mail.com verificado correctamente.')
  })

  test('solo se ofrece verificar a quien tiene el correo sin verificar', () => {
    montar()

    expect(deCliente('ana@mail.com').queryByTestId('MarkEmailReadIcon')).toBeNull()
    expect(deCliente('cami@mail.com').getByTestId('MarkEmailReadIcon')).toBeTruthy()
  })

  test('el botón de bloquear cambia a desbloquear según el estado del cliente', () => {
    montar()

    expect(deCliente('ana@mail.com').getByTestId('BlockIcon')).toBeTruthy()
    expect(deCliente('ana@mail.com').queryByTestId('CheckCircleIcon')).toBeNull()
    expect(deCliente('beto@mail.com').getByTestId('CheckCircleIcon')).toBeTruthy()
    expect(deCliente('beto@mail.com').queryByTestId('BlockIcon')).toBeNull()
  })
})

describe('Clientes · cuando algo falla', () => {
  const fallar = mensaje => {
    mockDispatch.mockImplementation(() => ({ unwrap: () => Promise.reject(mensaje) }))
  }

  const confirmar = async () => {
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }),
    )
  }

  test('muestra el mensaje del servidor y cierra la ventana', async () => {
    fallar('El cliente tiene pedidos abiertos')
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))
    await confirmar()

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('El cliente tiene pedidos abiertos'),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test.each([
    ['DeleteIcon', 'ana@mail.com', 'No se pudo eliminar al cliente.'],
    ['BlockIcon', 'ana@mail.com', 'No se pudo bloquear al cliente.'],
    ['CheckCircleIcon', 'beto@mail.com', 'No se pudo desbloquear al cliente.'],
    ['MarkEmailReadIcon', 'cami@mail.com', 'No se pudo verificar al usuario.'],
  ])('sin mensaje del servidor, con %s avisa «%s»', async (icono, correo, esperado) => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    fallar(undefined)
    montar()

    await userEvent.click(boton(correo, icono))
    await confirmar()

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(esperado))
    console.error.mockRestore()
  })
})
