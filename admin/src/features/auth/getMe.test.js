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
const { buildSessionKey, getMe, SESSION_RESET } = await import('./authSlice')

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

// =====================================================
// Identidad de la sesión: lo cacheado no puede sobrevivir a un cambio de cuenta
// =====================================================
//
// EL DESFASE, COMO SE PRODUCE
//
// La cookie httpOnly es por ORIGEN. Lo que el panel cachea es por PESTAÑA
// (sessionStorage, vía safeStorage y vía redux-persist). Entrar con otra
// cuenta en una segunda pestaña pisa la cookie de las dos, pero la primera
// sigue mostrando al usuario anterior: nombre, menú y marca de un comercio
// sobre datos del otro.

const OTRO_USUARIO = {
  _id: '64b7f0000000000000000010',
  email: 'edugcross@gmail.com',
  role: 'admin',
  tenantId: '6aadf5238a529e764cec9bae',
  tenant: { name: 'Prueba', slug: 'prueba' },
}

describe('buildSessionKey · a quién pertenece lo cacheado', () => {
  test('la clave junta usuario y comercio', () => {
    expect(buildSessionKey(USUARIO)).toBe(
      '64b7f0000000000000000009:6a4dcc911161615f76a8131f',
    )
  })

  test('dos cuentas distintas nunca comparten clave', () => {
    expect(buildSessionKey(USUARIO)).not.toBe(buildSessionKey(OTRO_USUARIO))
  })

  // El día que un usuario pertenezca a varios comercios, cambiar de comercio
  // ES un cambio de sesión aunque el usuario sea el mismo. Con el userId solo,
  // ese cambio pasaría desapercibido y los datos del comercio anterior
  // quedarían en pantalla.
  test('el mismo usuario en otro comercio da OTRA clave', () => {
    const mismoUsuarioOtroComercio = { ...USUARIO, tenantId: 'otro-comercio' }

    expect(buildSessionKey(mismoUsuarioOtroComercio)).not.toBe(
      buildSessionKey(USUARIO),
    )
  })

  test('acepta el tenantId populado, no solo el id suelto', () => {
    // getCurrentUser popula tenantId. Si la comparación no contemplara las dos
    // formas, un cambio de serialización la rompería EN SILENCIO — y el modo
    // de fallo silencioso acá es mostrar datos de otro comercio.
    const populado = {
      ...USUARIO,
      tenantId: { _id: '6a4dcc911161615f76a8131f', name: 'Henko' },
    }

    expect(buildSessionKey(populado)).toBe(buildSessionKey(USUARIO))
  })

  test('sin usuario o sin comercio la clave es null, no una cadena a medias', () => {
    // null significa "no sé de quién es esto". Una clave parcial compararía
    // igual contra otra parcial y daría un falso "no cambió nada".
    expect(buildSessionKey(null)).toBeNull()
    expect(buildSessionKey({ _id: 'x' })).toBeNull()
    expect(buildSessionKey({ tenantId: 'y' })).toBeNull()
  })
})

describe('getMe · lo cacheado no sobrevive a un cambio de cuenta', () => {
  /** Corre el thunk a mano, con el estado que tuviera la pestaña. */
  const correrGetMe = async claveCacheada => {
    const dispatch = jest.fn()
    const getState = () => ({ user: { sessionKey: claveCacheada } })

    const resultado = await getMe()(dispatch, getState, undefined)

    return {
      resultado,
      reseteo: dispatch.mock.calls.some(
        ([accion]) => accion?.type === SESSION_RESET,
      ),
    }
  }

  beforeEach(() => {
    sessionStorage.clear()
    mockApi.mockResolvedValue(respuestaDeMe())
  })

  // EL CASO. La pestaña tenía cacheada la cuenta de otro comercio porque una
  // segunda pestaña entró con otra cuenta y pisó la cookie del origen.
  test('si la cookie devuelve OTRA cuenta, se tira todo el estado', async () => {
    const { reseteo, resultado } = await correrGetMe(
      buildSessionKey(OTRO_USUARIO),
    )

    expect(reseteo).toBe(true)
    // Y lo que queda es lo que dijo la cookie, no lo que había cacheado.
    expect(resultado.payload.sessionKey).toBe(buildSessionKey(USUARIO))
  })

  test('si es la misma cuenta, no se tira nada', async () => {
    // Un reseteo en cada getMe vaciaría el store en cada recarga y haría
    // parpadear el panel entero sin motivo.
    const { reseteo } = await correrGetMe(buildSessionKey(USUARIO))

    expect(reseteo).toBe(false)
  })

  test('sin nada cacheado tampoco se resetea: no hay de qué desconfiar', async () => {
    const { reseteo } = await correrGetMe(null)

    expect(reseteo).toBe(false)
  })

  test('el cambio de cuenta también limpia la copia de sessionStorage', async () => {
    // Son DOS copias: la de safeStorage y la de redux-persist. Si sobrevive
    // cualquiera de las dos, la próxima recarga rehidrata al usuario anterior.
    sessionStorage.setItem('user', JSON.stringify(OTRO_USUARIO))
    sessionStorage.setItem('persist:user', '{"user":"viejo"}')

    await correrGetMe(buildSessionKey(OTRO_USUARIO))

    // Queda el usuario que devolvió la cookie, y la copia de persist se fue.
    expect(JSON.parse(sessionStorage.getItem('user'))._id).toBe(USUARIO._id)
    expect(sessionStorage.getItem('persist:user')).toBeNull()
  })
})
