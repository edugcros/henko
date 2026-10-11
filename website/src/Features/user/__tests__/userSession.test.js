/* eslint-env jest */
// 📁 src/Features/user/__tests__/userService.test.js
//
// Cuándo apiRequest reintenta una petición, y cuándo no.
//
// EL CASO QUE ORIGINÓ ESTE ARCHIVO
//
// apiRequest reintenta la petición entera cuando el servidor contesta 403 por
// un CSRF vencido, y eso está bien: el token se renueva y se vuelve a
// intentar. Pero la condición era `/csrf|token/i`, y el backend contesta el
// refresco sin sesión con 403 "No hay token de refresco" — una frase que
// contiene "token" y nada que ver con CSRF.
//
// Medido en producción el 07/10/2026, en una visita anónima a la tienda:
//
//   /api/user/me       401
//   /api/user/refresh  403   ← el interceptor intenta refrescar
//   /api/user/me       401   ← el reintento, por el falso positivo
//   /api/user/refresh  403
//
// El doble no rompía nada visible, y ésa es justamente la razón por la que
// sobrevivió: cuatro llamadas donde iban dos, en cada carga de cada visitante
// sin sesión, contra un backend que las paga todas.

import api from '@utils/axiosConfig'
import userService from '../userService.js'
import reducer, { getMe, loginUser, marcaDeSesion, resetAuthState } from '../userSlice.js'

jest.mock('@utils/axiosConfig', () => ({
  __esModule: true,
  default: jest.fn(),
  fetchCsrfToken: jest.fn(() => Promise.resolve('csrf-de-prueba')),
}))

const llamadas = []

// Siempre falla con la respuesta que se le pase, y deja registrada cada
// llamada: lo que se mide es CUÁNTAS veces se salió a la red.
const rechazarCon = respuesta => {
  llamadas.length = 0

  api.mockImplementation(config => {
    llamadas.push(config.url)

    const error = new Error('fallo simulado')
    error.response = respuesta

    return Promise.reject(error)
  })
}

describe('apiRequest · qué 403 merece un reintento', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('un 403 de CSRF sí se reintenta', async () => {
    // El mensaje real del backend es "CSRF token inválido o ausente"
    // (csrfMiddleware.js). Para ese caso existe el reintento.
    rechazarCon({
      status: 403,
      data: { success: false, message: 'CSRF token inválido o ausente' },
    })

    await userService.getCurrentUser()

    expect(llamadas).toHaveLength(2)
  })

  test('un 403 por falta de sesión NO se reintenta, aunque diga "token"', async () => {
    // Éste es el bug: "No hay token de refresco" contenía la palabra "token"
    // y entraba al reintento como si fuera un CSRF vencido.
    rechazarCon({
      status: 403,
      data: { success: false, message: 'No hay token de refresco' },
    })

    await userService.getCurrentUser()

    expect(llamadas).toHaveLength(1)
  })

  test('el código EBADCSRFTOKEN alcanza, sin mirar el mensaje', async () => {
    // Se reconoce por código además de por texto: si alguien reescribe el
    // mensaje del middleware, el reintento tiene que seguir funcionando.
    rechazarCon({
      status: 403,
      data: { success: false, code: 'EBADCSRFTOKEN', message: 'Solicitud rechazada' },
    })

    await userService.getCurrentUser()

    expect(llamadas).toHaveLength(2)
  })

  test('un 401 tampoco se reintenta acá', async () => {
    // De la sesión expirada se ocupa el interceptor de axiosConfig, no este
    // camino. Reintentar en los dos lugares multiplica las llamadas.
    rechazarCon({
      status: 401,
      data: { success: false, message: 'Token de acceso ausente' },
    })

    await userService.getCurrentUser()

    expect(llamadas).toHaveLength(1)
  })
})

// =====================================================
// La marca de sesión
// =====================================================
//
// Decide si vale la pena preguntarle al backend por la sesión. No la prueba:
// la verdad sigue siendo la cookie httpOnly, que JS no puede leer.
//
// Sin esto, un visitante que nunca inició sesión se comía dos llamadas
// garantizadas en cada carga (401 + 403) para enterarse de algo que ya se
// sabía, multiplicado por cada tienda de la plataforma.

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
    localStorage.setItem('henko.sesion', String(Date.now() - 1000))

    expect(marcaDeSesion.hay()).toBe(false)
    expect(localStorage.getItem('henko.sesion')).toBeNull()
  })

  test('una marca ilegible no cuenta', () => {
    localStorage.setItem('henko.sesion', 'cualquier cosa')

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
    reducer(undefined, { type: getMe.fulfilled.type, payload: { user: { _id: '1' } } })

    expect(marcaDeSesion.hay()).toBe(true)
  })

  test('que el backend diga que no hay sesión la saca', () => {
    marcaDeSesion.poner()

    reducer(undefined, { type: getMe.rejected.type, payload: 'sin sesión' })

    expect(marcaDeSesion.hay()).toBe(false)
  })

  test('cerrar sesión la saca', () => {
    marcaDeSesion.poner()

    reducer(undefined, resetAuthState())

    expect(marcaDeSesion.hay()).toBe(false)
  })
})

// Qué pasa cuando el navegador tiene el almacenamiento bloqueado.
//
// EL BUG
//
// safeStorage.setUser envolvía el setItem en try/catch pero llamaba a
// removeItem DENTRO del catch. Con los datos del sitio bloqueados,
// sessionStorage no falla sólo al escribir: falla al tocarlo. Así que setItem
// tiraba, entraba al catch, y removeItem tiraba otra vez — y ese segundo throw
// no lo capturaba nadie: salía del try del thunk de login y caía en su catch,
// que rechaza el login.
//
// Visto en producción el 11/10/2026 desde un celular: el backend devolvía 200 y
// escribía "Login exitoso", el usuario veía un error, y la app no hacía un solo
// request más. Al recargar aparecía logueado, porque la cookie estaba perfecta.
// Lo único roto era el intento de guardar una copia del usuario — una
// conveniencia que no tiene derecho a hacer fallar el login.
describe('safeStorage · un almacenamiento bloqueado no puede hacer fallar el login', () => {
  const USUARIO = { _id: 'u1', email: 'persona@ejemplo.com', role: 'user' }

  const bloquearStorage = () => {
    const tirar = () => {
      throw new Error('Access is denied for this document.')
    }

    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(tirar)
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(tirar)
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(tirar)
  }

  const loginQueFunciona = () => {
    api.mockImplementation(() =>
      Promise.resolve({ data: { success: true, data: { user: USUARIO } } }),
    )
  }

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  test('el login se cumple aunque sessionStorage tire en todas sus operaciones', async () => {
    loginQueFunciona()
    bloquearStorage()

    const accion = await loginUser({ email: USUARIO.email, password: 'x' })(
      jest.fn(),
      () => ({}),
      undefined,
    )

    // Lo que importa: fulfilled, no rejected. Antes acá llegaba rejected y el
    // usuario quedaba en la pantalla de login con un error, ya logueado.
    expect(accion.type).toBe('user/login/fulfilled')
    expect(accion.payload.user).toEqual(USUARIO)
  })

  test('el reducer de salida no tira con el almacenamiento bloqueado', async () => {
    bloquearStorage()

    // removeUser no tenía try/catch y se la llama desde un reducer: un throw
    // acá rompe el dispatch entero.
    expect(() => reducer(undefined, resetAuthState())).not.toThrow()
  })
})

// Qué merece un reporte de falla del cliente y qué no.
//
// El criterio original era "el login falló sin status HTTP", porque apiRequest
// sólo llena status desde error.response.status. Pero la ausencia de status
// cubre dos situaciones que no tienen nada que ver: el servidor contestó bien y
// la falla ocurrió después en el navegador, o el servidor NUNCA contestó (sin
// señal, timeout, DNS, CORS). Reportar la segunda como si fuera la primera
// manda a buscar un bug del cliente donde hay un problema de red, y encima
// gasta uno de los tres cupos de reporte por carga, tapando una falla real
// posterior.
describe('userService · distingue "no contestó" de "contestó y falló después"', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('un fallo de transporte queda marcado como sinRespuesta', async () => {
    // Axios sin respuesta: sin señal, timeout, DNS, CORS.
    api.mockImplementation(() => Promise.reject(new Error('Network Error')))

    const res = await userService.loginUser({ email: 'a@b.c', password: 'x' })

    expect(res.success).toBe(false)
    expect(res.status).toBeUndefined()
    expect(res.sinRespuesta).toBe(true)
  })

  test('un 401 trae status y no se confunde con nada', async () => {
    const error = new Error('Credenciales inválidas')
    error.response = { status: 401, data: { message: 'Credenciales inválidas' } }
    api.mockImplementation(() => Promise.reject(error))

    const res = await userService.loginUser({ email: 'a@b.c', password: 'x' })

    expect(res.status).toBe(401)
    expect(res.sinRespuesta).toBe(false)
  })
})
