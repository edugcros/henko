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

const {
  default: reducer,
  getMe,
  marcaDeSesion,
  hayUsuarioCacheado,
  resetAuthState,
} = await import('./authSlice')

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

// Dos fuentes de verdad que se contradicen y ninguna capaz de corregir a la otra.
//
// EL LAZO, medido en la consola del panel el 11/10/2026
//
//   GET /api/dash/stats?days=30&compare=true&t=...  401
//   GET /api/dash/subscription-metrics              401
//   ... repetidos para siempre, espaciados ~15 min
//
// initialState arranca `isAuthenticated: !!safeStorage.getUser()`, optimista
// desde la copia en sessionStorage. Cuando la sesión moría del lado del
// servidor, getMe.rejected limpiaba Redux y la marca pero NO esa copia. En la
// carga siguiente la copia seguía ahí —isAuthenticated arrancaba en true— y la
// marca ya no estaba, así que useAuth se salteaba getMe y nada corregía el
// estado nunca.
//
// El intervalo de 30s del Dashboard pollea condicionado a ese flag, así que
// cobraba 401 en cada vuelta contra una sesión muerta. En una pestaña de fondo
// Chrome estrangula el timer, y por eso los 401 aparecían cada ~15 minutos en
// lugar de cada 30 segundos, lo que lo disfrazaba de otra cosa.
describe('authSlice · la copia cacheada no puede sobrevivir al veredicto del backend', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  test('getMe.rejected borra el usuario cacheado, no solo el estado de Redux', () => {
    sessionStorage.setItem('user', JSON.stringify({ _id: 'u1', role: 'admin' }))

    expect(hayUsuarioCacheado()).toBe(true)

    const estado = reducer(undefined, getMe.rejected(null, '', undefined, 'sin sesion'))

    expect(estado.isAuthenticated).toBe(false)
    expect(estado.user).toBeNull()
    // Esto es lo que faltaba: sin borrar la copia, el próximo initialState
    // volvía a arrancar en true y el lazo se cerraba.
    expect(hayUsuarioCacheado()).toBe(false)
  })

  test('un usuario cacheado es razón suficiente para preguntar por la sesión', () => {
    // useAuth se saltea getMe solo cuando NO hay marca Y NO hay nada cacheado.
    // Una copia cacheada es evidencia de que alguien entró en este navegador,
    // así que hay a quién preguntarle aunque la marca ya no esté.
    marcaDeSesion.sacar()
    sessionStorage.setItem('user', JSON.stringify({ _id: 'u1', role: 'admin' }))

    expect(marcaDeSesion.hay()).toBe(false)
    expect(hayUsuarioCacheado()).toBe(true)
  })

  test('sin marca y sin caché no hay a quién preguntarle', () => {
    // El caso para el que se creó la marca: un visitante que nunca entró. Acá
    // sí hay que saltearse getMe, que es lo que ahorra el 401 + 403.
    marcaDeSesion.sacar()

    expect(marcaDeSesion.hay()).toBe(false)
    expect(hayUsuarioCacheado()).toBe(false)
  })
})
