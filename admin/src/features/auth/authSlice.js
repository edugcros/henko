// 📁 src/features/auth/authSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import authService from './authServices'
import { toast } from 'react-toastify'

// ---------------------------
// Identidad de la sesión
// ---------------------------
//
// EL PROBLEMA QUE RESUELVE
//
// La sesión viaja en una cookie httpOnly, que es por ORIGEN. Lo que el panel
// cachea —el usuario en sessionStorage, vía safeStorage y vía redux-persist—
// es por PESTAÑA. Las dos cosas se pueden desincronizar y el caso no es
// teórico: basta entrar con otra cuenta en una segunda pestaña del panel. La
// cookie se pisa para todas, pero la primera pestaña sigue mostrando al
// usuario anterior.
//
// El resultado es una pantalla con el nombre, el menú y la marca de un
// comercio sobre datos de otro. El backend no filtra nada —sirve
// correctamente a quien dice la cookie— pero para quien mira es
// indistinguible de una fuga entre comercios.
//
// LA REGLA
//
// La cookie es la única fuente de verdad sobre quién sos. Todo lo que se
// guarde local lleva estampada la identidad a la que pertenece, y se descarta
// entero apenas no coincida. Ante la duda se descarta: mostrar de menos es un
// login extra, mostrar de más es mezclar comercios.
//
// LA CLAVE INCLUYE EL COMERCIO, NO SOLO EL USUARIO
//
// En multi-tenant el mismo usuario puede existir en contextos distintos, y el
// día que un usuario pertenezca a varios comercios (allowedTenants, hoy leído
// y nunca escrito) cambiar de comercio será un cambio de sesión aunque el
// usuario sea el mismo. Con el userId solo, ese cambio pasaría desapercibido.

/** `usuario:comercio`, o null si falta alguno de los dos. */
export const buildSessionKey = user => {
  const userId = user?._id || user?.id || null
  // tenantId llega como id, pero getCurrentUser lo popula: se contemplan las
  // dos formas para que un cambio de serialización no rompa la comparación en
  // silencio — y un fallo silencioso acá es justo el que hay que evitar.
  const tenantId = user?.tenantId?._id || user?.tenantId || null

  if (!userId || !tenantId) return null

  return `${String(userId)}:${String(tenantId)}`
}

/**
 * Acción de raíz: devuelve TODOS los slices a su estado inicial.
 *
 * Resetear solo el slice de auth dejaría productos, pedidos, clientes y cupones
 * del comercio anterior cargados en la misma pestaña. Lo consume store.js; se
 * declara acá para que la dependencia vaya en un solo sentido (store → slice).
 */
export const SESSION_RESET = 'session/reset'

/** Clave de redux-persist para el slice de auth (prefijo + `key`). */
const PERSIST_KEY = 'persist:user'

/**
 * Avisa al resto de las pestañas que la sesión de este origen cambió.
 *
 * BroadcastChannel y no el evento `storage`: ese solo dispara para
 * localStorage, y acá el estado vive en sessionStorage, que es por pestaña y
 * por definición no notifica a las demás. Sin este canal, una pestaña que no
 * se recarga nunca se entera.
 */
const SESSION_CHANNEL = 'henko:session'

export const openSessionChannel = () => {
  if (
    typeof window === 'undefined' ||
    typeof BroadcastChannel === 'undefined'
  ) {
    return null
  }

  try {
    return new BroadcastChannel(SESSION_CHANNEL)
  } catch {
    // Navegador sin soporte o contexto restringido: se sigue sin aviso entre
    // pestañas. La comprobación al recargar y la de cada getMe siguen vivas.
    return null
  }
}

export const announceSession = sessionKey => {
  const canal = openSessionChannel()
  if (!canal) return

  try {
    canal.postMessage({ sessionKey: sessionKey ?? null })
  } catch {
    // Un aviso perdido degrada a lo de antes, no rompe nada.
  } finally {
    canal.close()
  }
}

// ---------------------------
// Safe Storage Helpers
// ---------------------------
const safeStorage = {
  setUser: user => {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.setItem('user', JSON.stringify(user))
    } catch {
      sessionStorage.removeItem('user')
    }
  },
  getUser: () => {
    if (typeof window === 'undefined') return null
    try {
      const raw = sessionStorage.getItem('user')
      if (!raw || raw === 'undefined') return null
      return JSON.parse(raw)
    } catch {
      sessionStorage.removeItem('user')
      return null
    }
  },
  // setToken / getToken se eliminaron: el access token ya no se guarda.
  //
  // Vivía en sessionStorage como respaldo "para cross-origin requests, cuando
  // las cookies httpOnly no estén disponibles". Ese escenario no existe: el
  // vercel.json del panel reescribe /api/* al backend, así que para el
  // navegador todas las llamadas son del mismo origen y la cookie es de primera
  // parte. Verificado contra producción — la respuesta trae
  // `HttpOnly; Secure; SameSite=None` y ningún atributo Domain, o sea que queda
  // scopeada al host del panel.
  //
  // Mientras el token estuvo en sessionStorage, cualquier XSS podía leerlo y
  // usarlo hasta que venciera. El backend sigue aceptando Bearer para otros
  // clientes; lo que se saca es que el panel lo guarde y lo mande.
  //
  // removeToken se conserva por una razón concreta: limpiar lo que dejó la
  // versión anterior en el navegador de quien ya inició sesión.
  removeToken: () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('auth_token')
  },
  removeUser: () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('wishlist')
    sessionStorage.removeItem('csrfToken')
    // La copia de redux-persist faltaba acá. Sobrevivía al logout y a
    // cualquier limpieza, así que quedaba como una segunda fuente de verdad
    // más vieja que la primera.
    sessionStorage.removeItem(PERSIST_KEY)
    safeStorage.removeToken()
  },
  // El access token vive en una cookie httpOnly. JS no puede leerla ni
  // removerla: el logout server-side la limpia, y removeAuth limpia lo local.
  removeAuth: () => {
    safeStorage.removeUser()
  },
}

// ---------------------------
// Estado inicial
// ---------------------------

const initialState = {
  user: safeStorage.getUser(),
  csrfToken: sessionStorage.getItem('csrfToken'),
  isAuthenticated: !!safeStorage.getUser(),
  // A quién pertenece lo que hay cacheado. Se persiste junto al usuario: sin
  // esto no habría contra qué comparar lo que devuelve /me.
  sessionKey: buildSessionKey(safeStorage.getUser()),
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
  // El backend rechaza el login de una cuenta sin verificar con un 401 y este
  // flag. Sin conservarlo, la pantalla no puede distinguirlo de una
  // contraseña equivocada y no sabe cuándo ofrecer reenviar el correo.
  isNotVerified: false,
  loading: { createAdmin: false },
  error: { createAdmin: null },
}

// ---------------------------
// Thunks
// ---------------------------

export const createUserAdmin = createAsyncThunk(
  'auth/createAdmin',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await authService.registerAdmin(payload)

      if (!response?.success) {
        return rejectWithValue(
          response?.message || 'Error al crear el comercio',
        )
      }

      return response.data || response
    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error al crear el comercio',
      )
    }
  },
)

export const getMe = createAsyncThunk('auth/get-me', async (_, thunkAPI) => {
  try {
    // getCurrentUser devuelve { user }, la misma forma que el login, para que
    // el reducer no tenga que adivinar en qué nivel está. Antes devolvía
    // { success, data: { user } } y acá se desenvolvía UNA vez, así que al
    // store llegaba { user: {...} } en lugar del usuario: state.user.tenantId
    // quedaba undefined y MainLayout mandaba al login creyendo que no había
    // sesión.
    const { user } = await authService.getCurrentUser()

    // LA COOKIE MANDA
    //
    // Esta respuesta dice quién sos DE VERDAD, porque el backend la resolvió
    // desde la cookie. Si lo que hay cacheado pertenece a otra sesión —otra
    // pestaña entró con otra cuenta y pisó la cookie de este origen— hay que
    // tirar TODO antes de escribir lo nuevo: no alcanza con pisar el usuario,
    // porque los otros slices siguen con los datos del comercio anterior.
    const claveVigente = buildSessionKey(user)
    const claveCacheada = thunkAPI.getState()?.user?.sessionKey || null

    if (claveCacheada && claveVigente && claveCacheada !== claveVigente) {
      safeStorage.removeAuth()
      thunkAPI.dispatch({ type: SESSION_RESET })
    }

    if (user) safeStorage.setUser(user)

    // El token que venga en el cuerpo se ignora: el que vale viaja en la cookie
    // httpOnly que el backend puso en esta misma respuesta.
    return { user, sessionKey: claveVigente }
  } catch (error) {
    return thunkAPI.rejectWithValue(
      error.response?.data || 'Error al obtener perfil',
    )
  }
})

export const loginUser = createAsyncThunk(
  'user/admin-login',
  async (userData, { dispatch, rejectWithValue }) => {
    try {
      const res = await authService.loginUser(userData)

      // 🔥 VALIDACIÓN CORRECTA
      if (!res || res.success !== true || !res.data) {
        return rejectWithValue('Respuesta inválida del servidor durante login')
      }

      const { user, token, csrfToken } = res.data

      if (csrfToken) {
        dispatch(setCsrfToken(csrfToken))
      }

      safeStorage.setUser(user)

      // Un login viejo pudo haber dejado un token acá. Se limpia al entrar para
      // que nadie quede con un JWT legible en el navegador por haber iniciado
      // sesión antes de este cambio.
      safeStorage.removeToken()

      // Este login acaba de pisar la cookie de TODO el origen. Las otras
      // pestañas siguen mostrando al usuario anterior sobre datos que a partir
      // de ahora son de éste, y no se van a enterar solas: su estado vive en
      // sessionStorage, que no notifica entre pestañas.
      announceSession(buildSessionKey(user))

      return { user, token }
    } catch (err) {
      const data = err?.response?.data

      // isNotVerified viaja aparte del mensaje: es la diferencia entre "te
      // equivocaste de contraseña" y "tu cuenta existe pero falta activarla",
      // y solo en el segundo caso tiene sentido ofrecer reenviar el correo.
      return rejectWithValue({
        message: data?.message || 'Error de autenticación',
        isNotVerified: Boolean(data?.isNotVerified),
      })
    }
  },
)

export const logoutUser = createAsyncThunk(
  'user/logout',
  async (_, { rejectWithValue }) => {
    try {
      // 1. Llamada al service (que a su vez llama al backend)
      const res = await authService.logoutUser()

      // 2. Limpieza de storage local (Lo que el JS SÍ controla)
      safeStorage.removeAuth()
      sessionStorage.clear() // Borra cualquier rastro de tenant o estado temporal

      // La cookie del origen ya no vale para nadie. Las otras pestañas tienen
      // que dejar de mostrar una sesión que no existe.
      announceSession(null)

      // 3. Feedback visual
      toast.success('Sesión cerrada correctamente')

      return res
    } catch (err) {
      // Aunque falle la petición (ej. el servidor está caído),
      // forzamos la limpieza local para que el usuario no quede atrapado
      safeStorage.removeAuth()
      sessionStorage.clear()
      announceSession(null)

      const message = err?.message || 'Error al cerrar sesión'
      return rejectWithValue(message)
    }
  },
)

// ---------------------------
// Slice
// ---------------------------
const authSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    clearState: state => {
      state.isError = false
      state.message = ''
      state.isSuccess = false
      state.isLoading = false
    },
    resetAuthState: state => {
      state.user = null
      state.csrfToken = null
      state.isAuthenticated = false
      state.sessionKey = null
      state.isSuccess = false
      state.isError = false
      state.isLoading = false
      state.message = ''
      try {
        sessionStorage.removeItem('user')
        sessionStorage.removeItem('csrfToken')
      } catch {
        // Limpieza best-effort: el navegador puede bloquear storage.
      }
    },
    setCsrfToken: (state, action) => {
      state.csrfToken = action.payload
      try {
        sessionStorage.setItem('csrfToken', action.payload)
      } catch {
        // Persistencia best-effort para entornos con storage restringido.
      }
    },
  },
  extraReducers: builder => {
    builder
      .addCase(createUserAdmin.pending, state => {
        state.loading.createAdmin = true
        state.error.createAdmin = null
        state.isLoading = true
      })

      .addCase(createUserAdmin.fulfilled, (state, action) => {
        state.loading.createAdmin = false
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.error.createAdmin = null
        state.message = ''

        // register-admin nunca devuelve un token: el admin creado tiene
        // que loguearse aparte una vez verificado el email. isAuthenticated
        // queda en false acá a propósito.
        state.user = action.payload
        state.isAuthenticated = false

        try {
          sessionStorage.setItem('user', JSON.stringify(action.payload))
        } catch {
          // Persistencia best-effort para entornos con storage restringido.
        }
      })

      .addCase(createUserAdmin.rejected, (state, action) => {
        state.loading.createAdmin = false
        state.isLoading = false
        state.isSuccess = false
        state.isError = true
        state.error.createAdmin = action.payload
        state.message = action.payload || 'Error al crear el comercio'
      })

      // login
      .addCase(loginUser.pending, state => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
        state.message = ''
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isAuthenticated = true
        state.user = action.payload.user
        state.isError = false
        state.sessionKey = buildSessionKey(action.payload.user)
      })

      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        // El payload pasó de string a objeto; se sigue guardando un string en
        // message para no romper a quien ya lo leía.
        state.message = action.payload?.message || action.payload
        state.isNotVerified = Boolean(action.payload?.isNotVerified)
      })

      // logout
      .addCase(logoutUser.pending, state => {
        state.isLoading = true
      })
      .addCase(logoutUser.fulfilled, state => {
        // 1. Resetear estados de carga y errores
        state.isLoading = false
        state.isSuccess = true // Cambiar a true indica que la acción de logout terminó bien
        state.isError = false
        state.message = ''

        // 2. Limpiar datos del usuario
        state.user = null
        state.csrfToken = null
        state.isAuthenticated = false

        // 🔥 NOTA: El try/catch con Cookies y sessionStorage NO VA AQUÍ.
        // Eso ya lo ejecutamos en el Thunk antes de llegar a este punto.
      })
      .addCase(logoutUser.rejected, (state, action) => {
        state.isLoading = false
        // Mantenemos el error para mostrar un toast de "El servidor no respondió, pero se cerró la sesión local"
        state.isError = true
        state.message =
          action.payload || 'Error al cerrar sesión en el servidor'

        // --- Limpieza de Estado ---
        state.user = null
        state.csrfToken = null
        state.isAuthenticated = false

        // 🔥 NOTA: La limpieza de Cookies y sessionStorage ya debe estar en el
        // catch del createAsyncThunk que escribimos antes. No la repitas aquí.
      })

      /* ---------- GET ME ---------- */
      .addCase(getMe.pending, state => {
        state.isLoading = true
      })
      .addCase(getMe.fulfilled, (state, action) => {
        state.isLoading = false
        // Igual que loginUser.fulfilled: el usuario, plano. El `?.data ||
        // payload` de antes tenía que adivinar el nivel, y adivinaba mal.
        state.user = action.payload.user
        state.isAuthenticated = true
        state.sessionKey = action.payload.sessionKey
      })
      .addCase(getMe.rejected, state => {
        state.isLoading = false
        state.user = null
        state.isAuthenticated = false
        // Sin sesión no hay identidad que estampar. Dejar la anterior haría
        // que la próxima comparación creyera que nada cambió.
        state.sessionKey = null
      })
  },
})

// ---------------------------
// Exports
// ---------------------------
export const { clearState, resetAuthState, setCsrfToken } = authSlice.actions
export default authSlice.reducer
