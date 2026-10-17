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

const {
  default: Customers,
  getRoleLabel,
  normalizeText,
  matchesSearch,
  filterCustomers,
} = await import('./Customers.js')

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

const tile = nombre =>
  within(screen.getByRole('region', { name: /resumen de clientes/i }))
    .getByText(nombre, {
      selector: 'span',
    })
    .closest('button')

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

    expect(deCliente('ana@mail.com').getByText('Activo')).toBeTruthy()
    expect(deCliente('ana@mail.com').queryByText('Sin verificar')).toBeNull()
    expect(deCliente('beto@mail.com').getByText('Bloqueado')).toBeTruthy()
    expect(deCliente('cami@mail.com').getByText('Sin verificar')).toBeTruthy()
  })

  test('el encabezado cuenta el total y los bloqueados', () => {
    montar()

    expect(within(tile('Total')).getByText('3')).toBeTruthy()
    expect(within(tile('Activos')).getByText('2')).toBeTruthy()
    expect(within(tile('Bloqueados')).getByText('1')).toBeTruthy()
    expect(within(tile('Sin verificar')).getByText('1')).toBeTruthy()
  })

  test('sin clientes lo dice', () => {
    montar([])

    expect(screen.getByText('No hay clientes registrados en tu comercio.')).toBeTruthy()
    expect(within(tile('Total')).getByText('0')).toBeTruthy()
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

describe('Clientes · funciones de búsqueda y filtro', () => {
  test('getRoleLabel traduce el rol y deja los que no conoce', () => {
    expect(getRoleLabel('user')).toBe('Cliente')
    expect(getRoleLabel('admin')).toBe('Administrador')
    expect(getRoleLabel('vendedor')).toBe('vendedor')
    expect(getRoleLabel(undefined)).toBe('Cliente')
  })

  test('normalizeText ignora mayúsculas, acentos y espacios de los costados', () => {
    expect(normalizeText('  PÉREZ ')).toBe('perez')
    expect(normalizeText('Ñandú')).toBe('nandu')
    expect(normalizeText(null)).toBe('')
  })

  test('matchesSearch busca en el nombre, el apellido, el correo y el teléfono', () => {
    expect(matchesSearch(ANA, 'perez')).toBe(true)
    expect(matchesSearch(ANA, 'ana pérez')).toBe(true)
    expect(matchesSearch(ANA, 'ANA@MAIL')).toBe(true)
    expect(matchesSearch(ANA, '3585')).toBe(true)
    expect(matchesSearch(ANA, 'gomez')).toBe(false)
    expect(matchesSearch(ANA, '')).toBe(true)
    expect(matchesSearch(BETO, '3585')).toBe(false)
  })

  test('filterCustomers combina estado y búsqueda', () => {
    const todos = [ANA, BETO, CAMI]

    expect(filterCustomers(todos)).toHaveLength(3)
    expect(filterCustomers(todos, { status: 'active' }).map(u => u._id)).toEqual(['c1', 'c3'])
    expect(filterCustomers(todos, { status: 'blocked' }).map(u => u._id)).toEqual(['c2'])
    expect(filterCustomers(todos, { status: 'unverified' }).map(u => u._id)).toEqual(['c3'])
    expect(filterCustomers(todos, { status: 'active', search: 'cami' }).map(u => u._id)).toEqual([
      'c3',
    ])
    expect(filterCustomers(todos, { status: 'blocked', search: 'ana' })).toEqual([])
    expect(filterCustomers(undefined)).toEqual([])
  })
})

describe('Clientes · buscar y filtrar', () => {
  const visibles = () =>
    ['ana@mail.com', 'beto@mail.com', 'cami@mail.com'].filter(correo => screen.queryByText(correo))

  test('buscar deja solo a quienes coinciden, sin importar mayúsculas ni acentos', async () => {
    montar()

    await userEvent.type(screen.getByRole('textbox', { name: /buscar clientes/i }), 'GOMEZ')

    expect(visibles()).toEqual(['beto@mail.com'])
  })

  test('tocar una cifra del resumen filtra, y tocarla de nuevo lo quita', async () => {
    montar()

    await userEvent.click(tile('Bloqueados'))
    expect(visibles()).toEqual(['beto@mail.com'])
    expect(tile('Bloqueados').getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(tile('Sin verificar'))
    expect(visibles()).toEqual(['cami@mail.com'])

    await userEvent.click(tile('Sin verificar'))
    expect(visibles()).toHaveLength(3)
  })

  test('«Limpiar filtros» aparece solo con filtros y los saca juntos', async () => {
    montar()

    expect(screen.queryByRole('button', { name: /limpiar filtros/i })).toBeNull()

    await userEvent.type(screen.getByRole('textbox', { name: /buscar clientes/i }), 'ana')
    await userEvent.click(tile('Bloqueados'))

    expect(screen.getByText('Ningún cliente coincide con la búsqueda.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    expect(visibles()).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: /buscar clientes/i }).value).toBe('')
  })

  test('la cifra «Total» también limpia los filtros', async () => {
    montar()

    await userEvent.click(tile('Activos'))
    expect(visibles()).toEqual(['ana@mail.com', 'cami@mail.com'])

    await userEvent.click(tile('Total'))
    expect(visibles()).toHaveLength(3)
  })

  test('las cifras cuentan a todos los clientes, no solo a los que se ven', async () => {
    montar()

    await userEvent.type(screen.getByRole('textbox', { name: /buscar clientes/i }), 'ana')

    expect(within(tile('Total')).getByText('3')).toBeTruthy()
  })

  test('sin clientes no se ofrece buscar', () => {
    montar([])

    expect(screen.queryByRole('textbox', { name: /buscar clientes/i })).toBeNull()
  })
})

describe('Clientes · acceso y errores de carga', () => {
  test('los botones de cada cliente tienen nombre, con el nombre del cliente', () => {
    montar()

    expect(screen.getByRole('button', { name: 'Eliminar a Ana' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bloquear a Ana' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Desbloquear a Beto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verificar manualmente a Cami' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Verificar manualmente a Ana' })).toBeNull()
  })

  test('el rol se muestra traducido', () => {
    montar()

    expect(deCliente('ana@mail.com').getByText('Cliente')).toBeTruthy()
  })

  test('si no se pudo cargar la lista lo dice, en vez de «no hay clientes»', () => {
    montar([], { error: 'Sin conexión con el servidor' })

    expect(screen.getByText('Sin conexión con el servidor')).toBeTruthy()
    expect(screen.queryByText('No hay clientes registrados en tu comercio.')).toBeNull()
  })

  test('«Reintentar» vuelve a pedir la lista', async () => {
    montar([], { error: 'Sin conexión con el servidor' })
    mockGetUsers.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(mockGetUsers).toHaveBeenCalledTimes(1)
  })

  test('un error de una acción no tapa la lista que ya está cargada', () => {
    montar([ANA], { error: 'No se pudo bloquear' })

    expect(screen.getByText('ana@mail.com')).toBeTruthy()
    expect(screen.queryByText('No se pudo bloquear')).toBeNull()
  })

  test('mientras se hace la acción no se puede confirmar dos veces', async () => {
    let terminar
    mockDispatch.mockImplementation(() => ({
      unwrap: () =>
        new Promise(resolve => {
          terminar = resolve
        }),
    }))
    montar()

    await userEvent.click(boton('ana@mail.com', 'DeleteIcon'))
    const dialogo = await screen.findByRole('dialog')
    const confirmar = within(dialogo).getByRole('button', { name: 'Confirmar' })

    await userEvent.click(confirmar)

    // Con la acción en curso los dos botones quedan bloqueados: no hay un segundo clic posible.
    await waitFor(() => expect(confirmar.disabled).toBe(true))
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' }).disabled).toBe(true)
    expect(mockRemoveUser).toHaveBeenCalledTimes(1)

    terminar({})
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('cada acción titula su ventana', async () => {
    montar()

    await userEvent.click(boton('ana@mail.com', 'BlockIcon'))

    expect(await screen.findByText('Bloquear cliente')).toBeTruthy()
  })
})

describe('Clientes · en el celular', () => {
  const estrecha = () => {
    window.matchMedia = query => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })
  }

  afterEach(() => {
    delete window.matchMedia
  })

  test('no hay tabla: cada cliente es una tarjeta con todo a la vista', () => {
    estrecha()
    montar()

    expect(screen.queryByRole('table')).toBeNull()

    const tarjetas = screen.getAllByRole('article')

    expect(tarjetas).toHaveLength(3)

    const ana = within(tarjetas[0])

    expect(ana.getByText('Ana Pérez')).toBeTruthy()
    expect(ana.getByText('ana@mail.com')).toBeTruthy()
    expect(ana.getByText('3585132769')).toBeTruthy()
    expect(ana.getByText('Activo')).toBeTruthy()
    expect(ana.getByText('Cliente')).toBeTruthy()
  })

  test('las acciones funcionan igual que en la tabla', async () => {
    estrecha()
    montar()

    await userEvent.click(
      within(screen.getAllByRole('article')[2]).getByRole('button', {
        name: 'Verificar manualmente a Cami',
      }),
    )
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }),
    )

    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith('c3'))
  })

  test('sin clientes muestra el mismo aviso que en escritorio', () => {
    estrecha()
    montar([])

    expect(screen.getByText('No hay clientes registrados en tu comercio.')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
