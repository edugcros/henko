// No preguntar por una sesión que nunca existió.
//
// EL CASO, COMO SE VE EN LA CONSOLA DEL PANEL
//
//   GET  https://api.henkart.com.ar/api/user/me       401 (Unauthorized)
//   POST https://api.henkart.com.ar/api/user/refresh  403 (Forbidden)
//
// A quien cae en /login sin haber entrado nunca en este navegador no hay
// sesión que restaurarle, y preguntar costaba esas dos llamadas en CADA
// carga, más dos errores que parecían una rotura y no lo eran.
//
// El access token vive en una cookie httpOnly y JS no puede leerla, así que
// la marca es la única forma de saber que NO hace falta preguntar. No prueba
// que haya sesión: eso lo sigue contestando el backend.

import { jest } from '@jest/globals'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

jest.unstable_mockModule('../../utils/axiosConfig', () => ({
  default: jest.fn(),
  fetchCsrfToken: jest.fn().mockResolvedValue('csrf-de-prueba'),
}))

const { default: reducer, getMe, marcaDeSesion, resetAuthState } = await import('./authSlice')

const CLAVE = 'henko.sesion.admin'

describe('marcaDeSesion', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('sin marca no hay nada que preguntar', () => {
    expect(marcaDeSesion.hay()).toBe(false)
  })

  test('poner y sacar', () => {
    marcaDeSesion.poner()
    expect(marcaDeSesion.hay()).toBe(true)

    marcaDeSesion.sacar()
    expect(marcaDeSesion.hay()).toBe(false)
  })

  test('una marca vencida no cuenta, y se limpia sola', () => {
    // Siete días es lo que dura el token de refresco. Pasado ese plazo la
    // cookie no sirve ni aunque esté, así que preguntar sería perder el
    // viaje igual.
    localStorage.setItem(CLAVE, String(Date.now() - 1000))

    expect(marcaDeSesion.hay()).toBe(false)
    expect(localStorage.getItem(CLAVE)).toBeNull()
  })

  test('una marca ilegible no cuenta', () => {
    localStorage.setItem(CLAVE, 'cualquier cosa')

    expect(marcaDeSesion.hay()).toBe(false)
  })

  test('no comparte clave con la tienda', () => {
    // Panel y tienda son orígenes distintos, así que no se pisan; pero si
    // alguna vez se sirvieran del mismo, una sesión de comprador no debería
    // hacer que el panel crea que hay sesión de admin.
    localStorage.setItem('henko.sesion', String(Date.now() + 100000))

    expect(marcaDeSesion.hay()).toBe(false)
  })
})

describe('marcaDeSesion · enganchada al ciclo de la sesión', () => {
  // Lo que se verifica acá no es el helper sino el CABLEADO: que cada
  // transición real de sesión la actualice. Un helper correcto que nadie
  // llama deja el problema igual.

  beforeEach(() => {
    localStorage.clear()
  })

  test('confirmar la sesión la pone', () => {
    reducer(undefined, {
      type: getMe.fulfilled.type,
      payload: { user: { _id: '1' }, sessionKey: '1:1' },
    })

    expect(marcaDeSesion.hay()).toBe(true)
  })

  test('que el backend diga que no hay sesión la saca', () => {
    marcaDeSesion.poner()

    reducer(undefined, { type: getMe.rejected.type })

    expect(marcaDeSesion.hay()).toBe(false)
  })

  test('cerrar sesión la saca', () => {
    marcaDeSesion.poner()

    reducer(undefined, resetAuthState())

    expect(marcaDeSesion.hay()).toBe(false)
  })
})
