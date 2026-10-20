// Cupones (CouponsPage).
//
// La pantalla donde el comercio crea, edita, clona, elimina y restaura cupones. No tenía tests.
// Lo que se fija acá es lo que decide la pantalla (el formulario y el generador masivo se reemplazan
// por cajas mínimas: son otros componentes, con su propia lógica):
//
//   - la consulta al servidor: búsqueda con espera, filtros y paginación;
//   - cada operación con el dato exacto que manda y lo que avisa;
//   - los errores del servidor al crear (código repetido, campos inválidos);
//   - la confirmación antes de eliminar, en la papelera y de forma permanente.

import React from 'react'
import { jest } from '@jest/globals'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockDispatch = jest.fn()
const thunk = tipo => jest.fn(args => ({ type: tipo, args }))
const mockGetAll = thunk('getAll')
const mockCreate = thunk('create')
const mockUpdate = thunk('update')
const mockDelete = thunk('delete')
const mockClone = thunk('clone')
const mockClearMessages = thunk('clearMessages')
const mockClearError = thunk('clearError')
const mockSetFilters = thunk('setFilters')
const mockPermanentDelete = thunk('permanentDelete')
const mockRestore = thunk('restore')
const mockToastSuccess = jest.fn()
const mockToastError = jest.fn()

const estado = { coupon: {} }

jest.unstable_mockModule('react-redux', () => ({
  useSelector: selector => selector(estado),
  useDispatch: () => mockDispatch,
}))

jest.unstable_mockModule('../features/coupons/couponSlice', () => ({
  getAllCoupons: mockGetAll,
  createCoupon: mockCreate,
  updateCoupon: mockUpdate,
  deleteCoupon: mockDelete,
  cloneCoupon: mockClone,
  clearMessages: mockClearMessages,
  clearError: mockClearError,
  setFilters: mockSetFilters,
  permanentDeleteCoupon: mockPermanentDelete,
  restoreCoupon: mockRestore,
  selectCouponError: state => state.coupon.error,
}))

jest.unstable_mockModule('react-toastify', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}))

// El formulario real tiene 700 líneas: acá es una caja que manda lo que se le pida.
jest.unstable_mockModule('../components/coupons/CouponForm.jsx', () => ({
  default: ({ initialData, onSubmit, onCancel, isSubmitting, serverErrors }) => (
    <div data-testid="formulario">
      <span>{initialData ? `editando ${initialData.code}` : 'cupón nuevo'}</span>
      <span data-testid="errores">{serverErrors ? JSON.stringify(serverErrors) : ''}</span>
      <button onClick={() => onSubmit({ code: 'NUEVO10', discountValue: 10 })}>enviar</button>
      <button onClick={onCancel}>cancelar formulario</button>
      {isSubmitting && <span>guardando</span>}
    </div>
  ),
}))

jest.unstable_mockModule('../components/coupons/BulkGenerator.jsx', () => ({
  default: ({ onSuccess, onCancel }) => (
    <div data-testid="masivo">
      <button onClick={() => onSuccess({ count: 5 })}>generar listo</button>
      <button onClick={onCancel}>cancelar masivo</button>
    </div>
  ),
}))

jest.unstable_mockModule('../components/common/Modal.jsx', () => ({
  default: ({ isOpen, title, children }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}))

const { default: CouponsPage } = await import('./CouponsPage.js')

const CUPON_ACTIVO = {
  _id: 'k1',
  code: 'VERANO10',
  description: 'Descuento de verano',
  discountType: 'percentage',
  discountValue: 10,
  isActive: true,
  usageCount: 3,
  usageLimit: 10,
  startDate: '2020-01-01T00:00:00.000Z',
  endDate: '2099-01-01T00:00:00.000Z',
}
const CUPON_FIJO = {
  _id: 'k2',
  code: 'MENOS500',
  discountType: 'fixed_amount',
  discountValue: 500,
  isActive: true,
  usageCount: 0,
  startDate: '2020-01-01T00:00:00.000Z',
}
const CUPON_ELIMINADO = {
  _id: 'k3',
  code: 'VIEJO20',
  discountType: 'percentage',
  discountValue: 20,
  isActive: true,
  isDeleted: true,
  usageCount: 0,
}

const montar = (coupon = {}) => {
  estado.coupon = {
    coupons: [CUPON_ACTIVO, CUPON_FIJO],
    pagination: { total: 2, page: 1, pages: 1 },
    isLoading: false,
    isSuccess: false,
    isError: false,
    message: '',
    error: null,
    lastFilters: undefined,
    ...coupon,
  }

  return render(<CouponsPage />)
}

const ultimaConsulta = () => mockGetAll.mock.calls[mockGetAll.mock.calls.length - 1][0]

const menuDe = async codigo => {
  let nodo = screen.getByText(codigo)

  while (nodo && !nodo.closest('tr')) nodo = nodo.parentElement

  await userEvent.click(within(nodo.closest('tr')).getByTestId('MoreVertIcon').closest('button'))
}

const resultados = { create: { code: 'NUEVO10' }, clone: { code: 'COPIA' } }

beforeEach(() => {
  jest.clearAllMocks()
  mockDispatch.mockImplementation(action => ({
    unwrap: () => Promise.resolve(resultados[action?.type] || {}),
  }))
  window.confirm = jest.fn(() => true)
})

describe('Cupones · consulta al servidor', () => {
  test('al abrir pide la primera página de todos los estados, de a 20', async () => {
    montar()

    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    expect(ultimaConsulta()).toEqual({
      status: 'all',
      page: 1,
      limit: 20,
      search: '',
      discountType: '',
    })
    expect(mockSetFilters).toHaveBeenCalled()
  })

  test('arranca con los últimos filtros que se usaron', async () => {
    montar({ lastFilters: { status: 'expired', search: 'oferta' } })

    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    expect(mockGetAll.mock.calls[0][0]).toMatchObject({ status: 'expired', search: 'oferta' })
  })

  test('buscar espera a que termine de escribir y vuelve a la página 1', async () => {
    montar({ lastFilters: { page: 3 } })
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    await userEvent.type(screen.getByRole('textbox', { name: /buscar cupones/i }), 'verano')

    await waitFor(() => expect(ultimaConsulta().search).toBe('verano'), { timeout: 2000 })
    expect(ultimaConsulta().page).toBe(1)
  })

  test('cambiar el estado o el tipo vuelve a la página 1 y manda el valor', async () => {
    montar({ lastFilters: { page: 3 } })
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    const [estadoCombo, tipoCombo] = screen.getAllByRole('combobox')

    await userEvent.click(estadoCombo)
    await userEvent.click(await screen.findByRole('option', { name: /^expirados$/i }))
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: 'expired', page: 1 }))

    await userEvent.click(tipoCombo)
    await userEvent.click(await screen.findByRole('option', { name: /monto fijo/i }))
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ status: 'expired', discountType: 'fixed_amount' }),
    )
  })

  test('«Limpiar» aparece con filtros y los saca', async () => {
    montar()
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: /^limpiar filtros/i })).toBeNull()

    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(await screen.findByRole('option', { name: /^activos$/i }))
    await waitFor(() => expect(ultimaConsulta().status).toBe('active'))

    await userEvent.click(screen.getByRole('button', { name: /^limpiar filtros/i }))

    await waitFor(() => expect(ultimaConsulta().status).toBe('all'))
  })

  test('«Recargar» vuelve a pedir con los mismos filtros', async () => {
    montar()
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())
    const antes = mockGetAll.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }))

    expect(mockGetAll.mock.calls.length).toBe(antes + 1)
  })

  test('con varias páginas, cambiar de página pide esa página', async () => {
    montar({ pagination: { total: 45, page: 1, pages: 3 } })
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: /page 2|página 2/i }))

    await waitFor(() => expect(ultimaConsulta().page).toBe(2))
  })
})

describe('Cupones · lo que se ve', () => {
  test('dice cuántos cupones se encontraron', () => {
    montar({ pagination: { total: 7, page: 1, pages: 1 } })

    expect(screen.getByText(/7 cupones encontrados/)).toBeTruthy()
  })

  test('muestra el código, el descuento y la vigencia de cada cupón', () => {
    montar()

    expect(screen.getByText('VERANO10')).toBeTruthy()
    expect(screen.getByText('10%')).toBeTruthy()
    expect(screen.getByText(/\$\s?500/)).toBeTruthy()
    expect(screen.getByText('Descuento de verano')).toBeTruthy()
  })

  test('muestra cuántas veces se usó contra el límite', () => {
    montar()

    expect(screen.getByText('3 / 10')).toBeTruthy()
    expect(screen.getByText('0 usos')).toBeTruthy()
  })

  test('un cupón sin productos asignados vale para todos', () => {
    montar()

    expect(screen.getAllByText('Todos los productos').length).toBe(2)
  })

  test('cada cupón dice su estado', () => {
    montar({
      coupons: [
        CUPON_ACTIVO,
        { ...CUPON_FIJO, isActive: false },
        { ...CUPON_FIJO, _id: 'k4', code: 'VENCIDO', endDate: '2020-02-01T00:00:00.000Z' },
        { ...CUPON_FIJO, _id: 'k5', code: 'FUTURO', startDate: '2099-01-01T00:00:00.000Z' },
        { ...CUPON_FIJO, _id: 'k6', code: 'AGOTADO', usageLimit: 2, usageCount: 2 },
      ],
    })

    for (const estadoDelCupon of ['Activo', 'Inactivo', 'Expirado', 'Programado', 'Agotado']) {
      expect(screen.getByText(estadoDelCupon)).toBeTruthy()
    }
  })

  test('sin cupones lo dice', () => {
    montar({ coupons: [], pagination: { total: 0, page: 1, pages: 1 } })

    expect(screen.getByText('No se encontraron cupones')).toBeTruthy()
  })

  test('mientras carga por primera vez muestra el aviso de carga', () => {
    montar({ coupons: [], isLoading: true })

    expect(screen.getByText('Cargando cupones...')).toBeTruthy()
  })

  test('un mensaje de éxito o de error del servidor se avisa y se limpia', async () => {
    montar({ isSuccess: true, message: 'Cupón actualizado' })

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Cupón actualizado'))
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'clearMessages', args: undefined })
  })
})

describe('Cupones · crear', () => {
  const abrirNuevo = async () => {
    await userEvent.click(screen.getByRole('button', { name: /nuevo cupón/i }))

    return screen.findByRole('dialog', { name: 'Crear Nuevo Cupón' })
  }

  test('abre el formulario vacío y, al enviar, manda los datos y avisa', async () => {
    montar()

    const dialogo = await abrirNuevo()

    expect(within(dialogo).getByText('cupón nuevo')).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'enviar' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ code: 'NUEVO10', discountValue: 10 }),
    )
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Cupón NUEVO10 creado exitosamente'),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('un código repetido se marca en el campo y se avisa', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'create' ? Promise.reject({ code: 'DUPLICATE_CODE' }) : Promise.resolve({}),
    }))
    montar()

    const dialogo = await abrirNuevo()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'enviar' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('El código de cupón ya existe'))
    expect(within(dialogo).getByTestId('errores').textContent).toContain('Este código ya existe')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  test('los errores de validación se marcan campo por campo', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'create'
          ? Promise.reject({ errors: [{ field: 'discountValue', message: 'Debe ser mayor a 0' }] })
          : Promise.resolve({}),
    }))
    montar()

    const dialogo = await abrirNuevo()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'enviar' }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Corrige los errores del formulario'),
    )
    expect(within(dialogo).getByTestId('errores').textContent).toContain('Debe ser mayor a 0')
  })

  test('cualquier otro error muestra su mensaje', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'create'
          ? Promise.reject({ message: 'Sin conexión' })
          : Promise.resolve({}),
    }))
    montar()

    const dialogo = await abrirNuevo()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'enviar' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Sin conexión'))
  })

  test('cancelar cierra el formulario sin mandar nada', async () => {
    montar()

    const dialogo = await abrirNuevo()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'cancelar formulario' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('un error de validación que llega del estado se marca en el campo', async () => {
    montar({ error: { isValidation: true, field: 'code', message: 'Código inválido' } })

    const dialogo = await abrirNuevo()

    await waitFor(() =>
      expect(within(dialogo).getByTestId('errores').textContent).toContain('Código inválido'),
    )
  })
})

describe('Cupones · editar', () => {
  test('abre el cupón en el formulario y, al enviar, manda su id y los datos', async () => {
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /editar/i }))

    const dialogo = await screen.findByRole('dialog', { name: 'Editar Cupón: VERANO10' })

    expect(within(dialogo).getByText('editando VERANO10')).toBeTruthy()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'enviar' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: 'k1',
        data: { code: 'NUEVO10', discountValue: 10 },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('Cupones · clonar, eliminar y restaurar', () => {
  test('clonar manda el id y avisa el código de la copia', async () => {
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /clonar/i }))

    await waitFor(() => expect(mockClone).toHaveBeenCalledWith('k1'))
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Clonado: COPIA'))
  })

  test('eliminar pide confirmación con el código y recién al confirmar manda el id', async () => {
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /^eliminar$/i }))

    const dialogo = await screen.findByRole('dialog', { name: 'Eliminar cupón' })

    expect(within(dialogo).getByText(/VERANO10/)).toBeTruthy()
    expect(within(dialogo).getByText(/restaurarlo desde el filtro "Eliminados"/)).toBeTruthy()
    expect(mockDelete).not.toHaveBeenCalled()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('k1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('si se cancela la confirmación, no se elimina', async () => {
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /^eliminar$/i }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockDelete).not.toHaveBeenCalled()
  })

  test('no se usa el cuadro de confirmación del navegador', async () => {
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /^eliminar$/i }))

    expect(window.confirm).not.toHaveBeenCalled()
  })

  test('en la papelera se puede restaurar', async () => {
    montar({ coupons: [CUPON_ELIMINADO] })

    await menuDe('VIEJO20')
    await userEvent.click(await screen.findByRole('menuitem', { name: /restaurar/i }))

    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('k3'))
  })

  test('el borrado permanente pide una confirmación aparte y manda el id', async () => {
    montar({ coupons: [CUPON_ELIMINADO] })

    await menuDe('VIEJO20')
    await userEvent.click(await screen.findByRole('menuitem', { name: /eliminar permanente/i }))

    const dialogo = await screen.findByRole('dialog', { name: 'Eliminación permanente' })

    expect(within(dialogo).getByText(/no se puede deshacer/)).toBeTruthy()
    expect(mockPermanentDelete).not.toHaveBeenCalled()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar para siempre' }))

    await waitFor(() => expect(mockPermanentDelete).toHaveBeenCalledWith({ id: 'k3' }))
  })

  test('un cupón que ya se usó no se puede borrar de forma permanente', async () => {
    montar({ coupons: [{ ...CUPON_ELIMINADO, usageCount: 4 }] })

    await menuDe('VIEJO20')

    const opcion = await screen.findByRole('menuitem', { name: /eliminar permanente/i })

    expect(opcion.getAttribute('aria-disabled')).toBe('true')
  })

  test('si falla clonar sin mensaje, avisa «Error al clonar»', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'clone' ? Promise.reject({}) : Promise.resolve({})),
    }))
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /clonar/i }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Error al clonar'))
  })

  test.each([
    ['delete', 'VERANO10', /^eliminar$/i, 'Eliminar', 'Error al eliminar'],
    [
      'permanentDelete',
      'VIEJO20',
      /eliminar permanente/i,
      'Eliminar para siempre',
      'Error en borrado permanente',
    ],
  ])('si falla %s sin mensaje, avisa «%s»', async (tipo, codigo, opcion, boton, esperado) => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === tipo ? Promise.reject({}) : Promise.resolve({})),
    }))
    montar({ coupons: [CUPON_ACTIVO, CUPON_ELIMINADO] })

    await menuDe(codigo)
    await userEvent.click(await screen.findByRole('menuitem', { name: opcion }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: boton }),
    )

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(esperado))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('si falla restaurar sin mensaje, avisa «Error al restaurar»', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'restore' ? Promise.reject({}) : Promise.resolve({})),
    }))
    montar({ coupons: [CUPON_ELIMINADO] })

    await menuDe('VIEJO20')
    await userEvent.click(await screen.findByRole('menuitem', { name: /restaurar/i }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Error al restaurar'))
  })
})

describe('Cupones · generar en masa', () => {
  test('abre el generador y, al terminar, lo cierra y vuelve a pedir la lista', async () => {
    montar()
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())
    const antes = mockGetAll.mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: /generar masivo/i }))

    const dialogo = await screen.findByRole('dialog', { name: 'Generador de Cupones' })

    await userEvent.click(within(dialogo).getByRole('button', { name: 'generar listo' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mockGetAll.mock.calls.length).toBeGreaterThan(antes)
  })

  test('cancelar lo cierra', async () => {
    montar()

    await userEvent.click(screen.getByRole('button', { name: /generar masivo/i }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'cancelar masivo' }),
    )

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('Cupones · lo que se mejoró', () => {
  test('al abrir se pide la lista una sola vez, y la espera de la búsqueda no suma otra', async () => {
    montar()
    await waitFor(() => expect(mockGetAll).toHaveBeenCalled())

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 700))
    })

    expect(mockGetAll).toHaveBeenCalledTimes(1)
  })

  test('si no se pudo cargar la lista lo dice, en vez de «no se encontraron cupones»', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'getAll' ? Promise.reject({}) : Promise.resolve({})),
    }))
    montar({ coupons: [], pagination: { total: 0, page: 1, pages: 1 } })

    expect(await screen.findByText('No se pudieron cargar los cupones.')).toBeTruthy()
    expect(screen.queryByText('No se encontraron cupones')).toBeNull()
  })

  test('«Reintentar» vuelve a pedir la lista y, si anda, muestra los cupones', async () => {
    let fallar = true
    mockDispatch.mockImplementation(action => ({
      unwrap: () => (action.type === 'getAll' && fallar ? Promise.reject({}) : Promise.resolve({})),
    }))
    montar({ coupons: [], pagination: { total: 0, page: 1, pages: 1 } })

    await screen.findByText('No se pudieron cargar los cupones.')
    fallar = false
    mockGetAll.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(mockGetAll).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('No se pudieron cargar los cupones.')).toBeNull())
  })

  test('si falla editar, el formulario sigue abierto para corregir', async () => {
    mockDispatch.mockImplementation(action => ({
      unwrap: () =>
        action.type === 'update' ? Promise.reject({ message: 'Inválido' }) : Promise.resolve({}),
    }))
    montar()

    await menuDe('VERANO10')
    await userEvent.click(await screen.findByRole('menuitem', { name: /editar/i }))
    const dialogo = await screen.findByRole('dialog', { name: 'Editar Cupón: VERANO10' })

    await userEvent.click(within(dialogo).getByRole('button', { name: 'enviar' }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Editar Cupón: VERANO10' })).toBeTruthy()
  })

  test('el estado y el tipo tienen nombre, y las opciones no llevan símbolos', async () => {
    montar()

    expect(screen.getByRole('combobox', { name: /estado/i })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /tipo/i })).toBeTruthy()

    await userEvent.click(screen.getByRole('combobox', { name: /estado/i }))

    expect(await screen.findByRole('option', { name: 'Programados' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Eliminados' })).toBeTruthy()
  })

  test('un solo uso se escribe en singular', () => {
    montar({ coupons: [{ ...CUPON_FIJO, usageCount: 1 }] })

    expect(screen.getByText('1 uso')).toBeTruthy()
    expect(screen.queryByText('1 usos')).toBeNull()
  })

  test('el menú de cada cupón tiene nombre con el código', () => {
    montar()

    expect(screen.getByRole('button', { name: 'Acciones del cupón VERANO10' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Acciones del cupón MENOS500' })).toBeTruthy()
  })

  test('los montos salen en pesos argentinos', () => {
    montar({
      coupons: [{ ...CUPON_FIJO, discountValue: 15000, maxDiscountAmount: 2500 }],
    })

    expect(screen.getByText(/\$\s?15\.000/)).toBeTruthy()
    expect(screen.getByText(/Máx: \$\s?2\.500/)).toBeTruthy()
  })

  test('las fechas salen en formato argentino', () => {
    montar({ coupons: [{ ...CUPON_ACTIVO, startDate: '2026-03-05T12:00:00.000Z' }] })

    expect(screen.getByText('Desde: 5/3/2026')).toBeTruthy()
  })
})

describe('Cupones · en el celular', () => {
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

  test('no hay tabla: cada cupón es una tarjeta con todo a la vista', () => {
    estrecha()
    montar()

    expect(screen.queryByRole('table')).toBeNull()

    const tarjetas = screen.getAllByRole('article')

    expect(tarjetas).toHaveLength(2)

    const verano = within(tarjetas[0])

    expect(verano.getByText('VERANO10')).toBeTruthy()
    expect(verano.getByText('10%')).toBeTruthy()
    expect(verano.getByText('Activo')).toBeTruthy()
    expect(verano.getByText('3 / 10')).toBeTruthy()
    expect(verano.getByText('Todos los productos')).toBeTruthy()
  })

  test('las acciones funcionan igual que en la tabla', async () => {
    estrecha()
    montar()

    await userEvent.click(screen.getByRole('button', { name: 'Acciones del cupón VERANO10' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /clonar/i }))

    await waitFor(() => expect(mockClone).toHaveBeenCalledWith('k1'))
  })

  test('sin cupones muestra el mismo aviso que en escritorio', () => {
    estrecha()
    montar({ coupons: [], pagination: { total: 0, page: 1, pages: 1 } })

    expect(screen.getByText('No se encontraron cupones')).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
