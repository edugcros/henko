// Refrescar el panel no puede mandarte al login.
//
// EL BUG, COMO SE VE EN PRODUCCIÓN
//
//   03:35:32  GET /api/user/csrf-token  200   referer .../plataforma/margen
//   03:35:33  GET /api/user/me          200   referer .../plataforma/margen
//   03:35:19  POST /api/user/admin-login 200  referer .../login
//
// /me devolvía 200 y el usuario terminaba igual en el login. Se disparaba solo
// al entrar por URL directa o con F5: navegando con clics, el usuario ya está
// en el store desde el login y nadie vuelve a leer /me.
//
// LA CAUSA: DOS FORMAS DISTINTAS PARA LA MISMA COSA
//
//   login →  { success, data: { user, token } }        usuario en data.user
//   /me   →  { success, message, data: <el usuario> }  usuario en data
//
// normalizeAuthResponse solo miraba data.user, así que con /me daba null,
// getCurrentUser lanzaba, getMe caía en rejected e isAuthenticated quedaba en
// false. Y aun salteando eso, el reducer desenvolvía un nivel de menos y
// state.user quedaba como { user: {...} }: MainLayout leía user.tenantId,
// encontraba undefined y navegaba al login por su cuenta.

import { jest } from '@jest/globals'

process.env.REACT_APP_API_BASE_URL = 'http://localhost:5000/api'

const mockApi = jest.fn()

jest.unstable_mockModule('../../utils/axiosConfig', () => ({
  default: mockApi,
  fetchCsrfToken: jest.fn().mockResolvedValue('csrf-de-prueba'),
}))

const authService = (await import('./authServices')).default

// El usuario tal como lo serializa el backend (serializeUserWithTenant).
const USUARIO = {
  _id: '64b7f0000000000000000009',
  email: 'grecoeduardo87@gmail.com',
  role: 'admin',
  firstname: 'Eduardo',
  tenantId: '6a4dcc911161615f76a8131f',
  tenant: { name: 'Henko', slug: 'henko' },
}

/** La respuesta REAL de /me: sendResponse pone el usuario en `data`. */
const respuestaDeMe = () => ({
  data: {
    success: true,
    message: 'Usuario actual obtenido',
    data: USUARIO,
  },
})

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getCurrentUser · la forma de /me', () => {
  test('encuentra al usuario donde /me lo manda, no donde lo manda el login', async () => {
    mockApi.mockResolvedValue(respuestaDeMe())

    const resultado = await authService.getCurrentUser()

    // Antes esto lanzaba 'No se pudo recuperar el perfil del usuario'.
    expect(resultado.user).toEqual(USUARIO)
    // Y el tenantId es el dato que MainLayout mira para decidir si hay sesión.
    expect(resultado.user.tenantId).toBe('6a4dcc911161615f76a8131f')
  })

  test('sigue entendiendo la forma del login, por si alguna vez se unifican', async () => {
    mockApi.mockResolvedValue({
      data: { success: true, data: { user: USUARIO, token: 'jwt' } },
    })

    expect((await authService.getCurrentUser()).user).toEqual(USUARIO)
  })

  test('un perfil sin identidad o sin comercio NO pasa por usuario', async () => {
    // Sin esto, cualquier cosa dentro de `data` arrancaría el panel como si
    // fuera un usuario.
    mockApi.mockResolvedValue({
      data: { success: true, data: { algo: 'que no es un usuario' } },
    })

    await expect(authService.getCurrentUser()).rejects.toThrow(
      /No se pudo recuperar el perfil/i,
    )

    mockApi.mockResolvedValue({
      data: { success: true, data: { _id: 'x' } },
    })

    await expect(authService.getCurrentUser()).rejects.toThrow(
      /No se pudo recuperar el perfil/i,
    )
  })
})

describe('el reducer · el usuario llega plano', () => {
  test('state.user es el usuario, no una caja con el usuario adentro', async () => {
    const { default: reducer, getMe } = await import('./authSlice')

    const estado = reducer(
      { isLoading: true, isAuthenticated: false, user: null },
      { type: getMe.fulfilled.type, payload: { user: USUARIO } },
    )

    // Antes quedaba { user: {...} } y esta línea daba undefined, que es
    // exactamente lo que MainLayout interpretaba como "no hay sesión".
    expect(estado.user.tenantId).toBe('6a4dcc911161615f76a8131f')
    expect(estado.user).toEqual(USUARIO)
    expect(estado.isAuthenticated).toBe(true)
    expect(estado.isLoading).toBe(false)
  })

  test('misma forma que después de un login, o refrescar cambiaría la sesión', async () => {
    const { default: reducer, getMe, loginUser } = await import('./authSlice')

    const base = { isLoading: true, isAuthenticated: false, user: null }

    const trasLogin = reducer(base, {
      type: loginUser.fulfilled.type,
      payload: { user: USUARIO, token: 'jwt' },
    })
    const trasRefrescar = reducer(base, {
      type: getMe.fulfilled.type,
      payload: { user: USUARIO },
    })

    expect(trasRefrescar.user).toEqual(trasLogin.user)
  })
})
