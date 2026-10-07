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
