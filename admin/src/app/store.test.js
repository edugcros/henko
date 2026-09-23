// Un cambio de sesión vacía TODO el store, no solo el slice de auth.
//
// POR QUÉ NO ALCANZA CON LIMPIAR `user`
//
// El estado de esta pestaña vive en memoria y en sessionStorage, los dos por
// pestaña. La cookie httpOnly que decide quién sos es por ORIGEN. Cuando otra
// pestaña entra con otra cuenta, la cookie se pisa para todas — y si solo se
// limpiara el usuario, en esta pestaña quedarían cargados los productos, los
// pedidos, los clientes y los cupones del comercio anterior.
//
// Eso sería peor que el problema original: el nombre de arriba sería el
// correcto y los datos de abajo no, así que nada se vería raro.

import { jest } from '@jest/globals'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

jest.unstable_mockModule('../utils/axiosConfig', () => ({
  default: jest.fn(),
  fetchCsrfToken: jest.fn(),
}))

// redux-persist se saca del medio a propósito. Lo que se verifica acá es la
// semántica del reseteo —que TODOS los slices vuelvan a su inicial—, no la
// persistencia, que es una biblioteca de terceros ya probada. Además, importar
// el store de verdad ejecuta persistStore() al cargar el módulo y eso exige un
// storage real; mockearlo deja el reducer desnudo, que es lo que se quiere
// medir.
jest.unstable_mockModule('redux-persist', () => ({
  persistStore: () => ({}),
  persistReducer: (_config, reducer) => reducer,
}))

const { rootReducer } = await import('./store')
const { SESSION_RESET } = await import('../features/auth/authSlice')

const estadoInicial = () => rootReducer(undefined, { type: '@@INIT' })

/** El store de una pestaña que ya trabajó: datos de varios comercios cargados. */
const estadoConDatosDelComercioAnterior = () => {
  const base = estadoInicial()

  return {
    ...base,
    user: {
      ...base.user,
      user: { _id: 'usuario-viejo', tenantId: 'comercio-viejo' },
      isAuthenticated: true,
      sessionKey: 'usuario-viejo:comercio-viejo',
    },
    product: { ...base.product, products: [{ _id: 'p1', title: 'Del otro' }] },
    // La forma real del slice de pedidos, no una inventada: si se sembrara una
    // clave que el initialState no tiene, la comparación de abajo daría
    // undefined y la prueba "pasaría" sin haber medido nada.
    order: {
      ...base.order,
      list: {
        ...base.order.list,
        data: { ...base.order.list.data, data: [{ _id: 'o1' }] },
      },
    },
    customers: { ...base.customers, customers: [{ _id: 'c1' }] },
  }
}

describe('rootReducer · reseteo de sesión', () => {
  test('SESSION_RESET devuelve TODOS los slices a su estado inicial', () => {
    const sucio = estadoConDatosDelComercioAnterior()
    const limpio = rootReducer(sucio, { type: SESSION_RESET })
    const inicial = estadoInicial()

    // Se recorren todos: agregar un slice nuevo mañana no puede quedar afuera
    // del reseteo sin que esta prueba lo note.
    for (const slice of Object.keys(inicial)) {
      expect(limpio[slice]).toEqual(inicial[slice])
    }
  })

  test('no queda rastro de los datos del comercio anterior', () => {
    const limpio = rootReducer(estadoConDatosDelComercioAnterior(), {
      type: SESSION_RESET,
    })

    // La afirmación en los términos del problema, no en los de la
    // implementación: lo que no puede pasar es que sobreviva un dato ajeno.
    expect(limpio.product.products).toEqual([])
    expect(limpio.order.list.data.data).toEqual([])
    expect(limpio.customers.customers).toEqual([])
    expect(limpio.user.user).toBeNull()
    expect(limpio.user.isAuthenticated).toBe(false)
    expect(limpio.user.sessionKey).toBeNull()
  })

  test('cualquier otra acción NO vacía el store', () => {
    // Sin esto, un reseteo de más pasaría inadvertido: el panel se vaciaría
    // solo cada tanto y se leería como un bug de red.
    const sucio = estadoConDatosDelComercioAnterior()
    const despues = rootReducer(sucio, { type: 'algo/que/no/es/sesion' })

    expect(despues.product.products).toHaveLength(1)
    expect(despues.user.isAuthenticated).toBe(true)
  })
})
