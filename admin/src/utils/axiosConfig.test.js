// Interceptor de autenticación.
//
// Existe por un 401 duro en producción que costó encontrar: el access token
// dura 15 minutos, y al vencer el reintento posterior al refresh volvía a
// fallar con el mismo token vencido.
//
// La cadena era esta:
//
//   1. el interceptor de request pone Authorization con el token de
//      sessionStorage;
//   2. el token vence y el backend responde 401;
//   3. el interceptor de response refresca — cookie httpOnly nueva y token
//      nuevo guardado;
//   4. reintenta con api(originalRequest), que YA trae el header con el token
//      viejo, y el interceptor no lo reemplaza porque solo lo completa cuando
//      falta;
//   5. el backend lee Bearer antes que la cookie, así que ve el vencido y
//      responde 401 otra vez, con una cookie válida al lado que queda tapada;
//   6. _retry ya está marcado: no hay tercer intento.
//
// Se prueba contra el interceptor real, con un adapter falso, porque el fallo
// vivía justo en el acoplamiento entre los dos interceptores.

import { jest } from '@jest/globals'

process.env.REACT_APP_API_BASE_URL = '/api'
process.env.REACT_APP_NODE_ENV = 'test'

const { default: api } = await import('./axiosConfig.js')

const VIEJO = 'token-vencido'
const NUEVO = 'token-fresco'

let calls

const makeAdapter = ({ failFirst = true } = {}) => {
  let protectedHits = 0

  return async config => {
    const url = String(config.url || '')
    calls.push({
      url,
      authorization:
        config.headers?.Authorization || config.headers?.authorization || null,
    })

    if (url.includes('/user/refresh')) {
      return {
        status: 200,
        data: { token: NUEVO },
        headers: {},
        config,
      }
    }

    if (url.includes('/user/csrf-token')) {
      return { status: 200, data: { csrfToken: 'csrf' }, headers: {}, config }
    }

    protectedHits += 1

    if (failFirst && protectedHits === 1) {
      const error = new Error('Token inválido o expirado')
      error.config = config
      error.response = {
        status: 401,
        data: {
          success: false,
          message: 'Token inválido o expirado',
          expired: true,
        },
        headers: {},
        config,
      }
      throw error
    }

    return { status: 200, data: { ok: true }, headers: {}, config }
  }
}

beforeEach(() => {
  calls = []
  window.sessionStorage.setItem('auth_token', VIEJO)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  window.sessionStorage.clear()
  jest.restoreAllMocks()
})

describe('interceptor de auth · reintento tras refrescar', () => {
  test('el reintento NO manda el token vencido', async () => {
    api.defaults.adapter = makeAdapter()

    await api.get('/protected')

    const aProtegido = calls.filter(c => c.url.includes('/protected'))

    expect(aProtegido).toHaveLength(2)
    expect(aProtegido[0].authorization).toBe(`Bearer ${VIEJO}`)
    // El corazón del arreglo: sin soltar el header, acá volvía el vencido y el
    // backend —que lee Bearer antes que la cookie— respondía 401 de nuevo.
    expect(aProtegido[1].authorization).not.toBe(`Bearer ${VIEJO}`)
  })

  test('el reintento usa el token que dejó el refresh', async () => {
    api.defaults.adapter = makeAdapter()

    await api.get('/protected')

    const aProtegido = calls.filter(c => c.url.includes('/protected'))

    expect(aProtegido[1].authorization).toBe(`Bearer ${NUEVO}`)
  })

  test('sin token guardado el reintento viaja solo con la cookie', async () => {
    // Es el camino que funcionaba antes del fallback por header: la cookie
    // httpOnly alcanza, y un header ausente no la tapa.
    window.sessionStorage.clear()
    api.defaults.adapter = async config => {
      calls.push({
        url: String(config.url || ''),
        authorization: config.headers?.Authorization || null,
      })

      if (String(config.url).includes('/user/refresh')) {
        return { status: 200, data: {}, headers: {}, config }
      }

      if (calls.filter(c => c.url.includes('/protected')).length === 1) {
        const error = new Error('401')
        error.config = config
        error.response = { status: 401, data: {}, headers: {}, config }
        throw error
      }

      return { status: 200, data: { ok: true }, headers: {}, config }
    }

    await api.get('/protected')

    const aProtegido = calls.filter(c => c.url.includes('/protected'))

    expect(aProtegido).toHaveLength(2)
    expect(aProtegido[1].authorization).toBeFalsy()
  })

  test('una request que anda no dispara refresh', async () => {
    api.defaults.adapter = makeAdapter({ failFirst: false })

    await api.get('/protected')

    expect(calls.filter(c => c.url.includes('/user/refresh'))).toHaveLength(0)
    expect(calls.filter(c => c.url.includes('/protected'))).toHaveLength(1)
  })
})
