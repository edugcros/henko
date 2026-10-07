// src/features/user/userSlice.js
import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit'
import userService from '@features/user/userService'
import { toast } from 'react-toastify'

/**
 * userSlice.js
 * - Manejo robusto de sesión, csrf y wishlist
 * - Thunks defensivos que interpretan distintas formas de respuesta del backend
 * - Persistencia mínima y segura en sessionStorage
 */

/* ---------------------------
   Helpers de storage seguros
   --------------------------- */
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
  removeUser: () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('wishlist')
    sessionStorage.removeItem('csrfToken')
  },
}

/**
 * Marca de "acá alguien inició sesión alguna vez", para no preguntar al
 * pedo.
 *
 * POR QUÉ EXISTE
 *
 * El access token vive en una cookie httpOnly: JS no puede leerla, así que
 * la app arrancaba preguntándole siempre al backend si había sesión. Para un
 * visitante que nunca se logueó eso son dos llamadas garantizadas —
 * /user/me da 401 y /user/refresh da 403— en CADA carga, más dos errores en
 * la consola que parecen una rotura y no lo son.
 *
 * Esta marca no reemplaza a la cookie ni prueba nada: la verdad sigue siendo
 * lo que conteste el backend. Lo único que decide es si vale la pena
 * preguntar.
 *
 * POR QUÉ localStorage Y NO sessionStorage
 *
 * sessionStorage se borra al cerrar la pestaña. Usarlo acá haría que alguien
 * con sesión viva que abre una pestaña nueva apareciera deslogueado — un
 * problema peor que el que se viene a resolver. localStorage sobrevive, y se
 * pierde junto con las cookies cuando se borran los datos del sitio, que es
 * el caso en que además no hay sesión que recordar.
 *
 * QUÉ PASA SI SE EQUIVOCA, EN CADA DIRECCIÓN
 *
 * Si hay marca y la sesión ya murió: se pregunta, da 401, se borra la marca.
 * Una carga con el comportamiento de antes, y ninguna más.
 *
 * Si no hay marca pero la cookie sigue viva: la persona se ve deslogueada
 * hasta que entre de nuevo. Por eso la marca se escribe en cada confirmación
 * de sesión, no sólo al entrar — para que se renueve sola mientras la usen.
 */
const CLAVE_DE_MARCA = 'henko.sesion'

// Siete días, que es lo que dura el token de refresco (JWT_REFRESH_EXPIRES
// en el backend). Pasado ese plazo la cookie ya no sirve ni aunque esté, así
// que preguntar sería perder el viaje igual.
const DURACION_DE_MARCA_MS = 7 * 24 * 60 * 60 * 1000

export const marcaDeSesion = {
  poner: () => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(CLAVE_DE_MARCA, String(Date.now() + DURACION_DE_MARCA_MS))
    } catch {
      // Modo privado o almacenamiento bloqueado. Sin marca se vuelve al
      // comportamiento de antes —preguntar siempre—, que funciona.
    }
  },

  sacar: () => {
    if (typeof window === 'undefined') return
    try {
      localStorage.removeItem(CLAVE_DE_MARCA)
    } catch {
      /* ídem */
    }
  },

  hay: () => {
    if (typeof window === 'undefined') return false
    try {
      const vence = Number(localStorage.getItem(CLAVE_DE_MARCA))

      if (!Number.isFinite(vence) || vence <= 0) return false

      if (Date.now() > vence) {
        localStorage.removeItem(CLAVE_DE_MARCA)
        return false
      }

      return true
    } catch {
      // Si no se puede leer, se asume que puede haber sesión y se pregunta:
      // ante la duda conviene el error que cuesta una llamada, no el que
      // deja a alguien afuera de su cuenta.
      return true
    }
  },
}

/* ---------------------------
   Estado inicial
   --------------------------- */
const initialUser = safeStorage.getUser()
const initialWishlist = (() => {
  try {
    const raw = sessionStorage.getItem('wishlist')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
})()

const initialState = {
  user: safeStorage.getUser(),
  csrfToken: sessionStorage.getItem('csrfToken'),
  // El access token vive en una cookie httpOnly desde el backend — JS no
  // puede leerla para saber si hay sesión viva. Un user cacheado en
  // sessionStorage no es prueba de sesión (puede ser viejo/stale);
  // isAuthenticated arranca en false y getMe() (dispatchado por
  // useAuth.js al montar la app) es la única fuente de verdad real.
  isAuthenticated: false,
  wishlist: initialWishlist,
  admin: null,

  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',

  loading: {
    createAdmin: false,
    orders: false,
  },
  error: {
    createAdmin: null,
    orders: null,
  },

  orders: {
    data: [],
    pagination: null,
    inFlightKey: null,
  },
}

/* ---------------------------
   Selectors útiles
   --------------------------- */
export const selectWishlistIds = createSelector(
  state => state.user.wishlist,
  wishlist => (Array.isArray(wishlist) ? wishlist.map(item => item._id || item) : []),
)

export const selectIsAuthenticated = state => !!state.user?.isAuthenticated
export const selectUser = state => state.user?.user

/* ---------------------------
   Async Thunks
   --------------------------- */

/**
 * loginUser
 * - userService.loginUser devuelve { success, data: { user } } — el access
 *   token va en una cookie httpOnly que setea el backend, nunca en el body.
 * - Guardamos solo el usuario en sessionStorage (cache de display, no de
 *   sesión: getMe() sigue siendo quien confirma si la sesión es real).
 */
export const loginUser = createAsyncThunk(
  'user/login',
  async (userData, { rejectWithValue, dispatch }) => {
    try {
      const res = await userService.loginUser(userData)

      // Auditoría: Verificamos estructura del backend
      if (!res || !res.success) {
        return rejectWithValue(res?.message || 'Credenciales incorrectas')
      }

      const { user, csrfToken } = res.data

      if (csrfToken) {
        dispatch(setCsrfToken(csrfToken))
      }

      safeStorage.setUser(user)
      return { user }
    } catch (err) {
      // Evitamos el "error is not defined" asegurando que usamos 'err'
      const message = err.response?.data?.message || err.message || 'Error de conexión'
      return rejectWithValue(message)
    }
  },
)

export const refreshSession = createAsyncThunk(
  'user/refreshSession',
  async (_, { rejectWithValue, dispatch }) => {
    try {
      const res = await userService.refreshToken()
      if (!res?.success) throw new Error('Sesión expirada')

      const { csrfToken } = res.data || {}

      // Sincronizamos el nuevo CSRF que suele venir con el refresh
      if (csrfToken) dispatch(setCsrfToken(csrfToken))

      return {}
    } catch (err) {
      return rejectWithValue(err.response?.data?.message || 'Sesión expirada')
    }
  },
)

/**
 * logoutUser
 */
export const logoutUser = createAsyncThunk('user/logout', async (_, { rejectWithValue }) => {
  try {
    const res = await userService.logoutUser()
    safeStorage.removeUser()
    toast.success('Sesión cerrada correctamente')
    return res
  } catch (err) {
    const message = err?.response?.data?.message || err?.message || 'Error al cerrar sesión'
    return rejectWithValue(message)
  }
})

/**
 * registerUser
 */
export const registerUser = createAsyncThunk(
  'user/register',
  async (userData, { rejectWithValue }) => {
    try {
      const res = await userService.register(userData)

      if (!res || res.success !== true) {
        return rejectWithValue(res?.message || 'Respuesta inválida del servidor en registro')
      }

      return res.data
    } catch (err) {
      return rejectWithValue(
        err?.response?.data?.message || err?.message || 'Error al registrar usuario',
      )
    }
  },
)

/**
 * getUserProductWishlist
 * - Acepta: respuesta en forma { success, data: [...] } o directamente array
 */
export const getUserProductWishlist = createAsyncThunk(
  'user/getWishlist',
  async (_, { rejectWithValue }) => {
    try {
      const res = await userService.getUserWishlist()
      // Normalizar: puede venir { success:true, data: [...] } o { data: [...] } o directamente [...]
      const wishlistData =
        res && res.data && Array.isArray(res.data)
          ? res.data
          : res && res.data && Array.isArray(res.data.wishlist)
            ? res.data.wishlist
            : Array.isArray(res)
              ? res
              : []

      // Persistir copia local para UX offline
      sessionStorage.setItem('wishlist', JSON.stringify(wishlistData || []))
      return wishlistData
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Error obteniendo wishlist'
      return rejectWithValue(message)
    }
  },
)

// 📌 Request para enviar email de recuperación
export const requestPasswordReset = createAsyncThunk(
  'user/requestPasswordReset',
  async (email, thunkAPI) => {
    try {
      const response = await userService.requestPasswordReset(email)
      return response
    } catch (error) {
      const msg = error?.response?.data?.message || 'Error enviando email de recuperación'
      return thunkAPI.rejectWithValue(msg)
    }
  },
)

// 📌 Reset final con token
export const resetPassword = createAsyncThunk(
  'user/reset-password',
  async ({ token, password }, thunkAPI) => {
    try {
      const response = await userService.resetPassword({
        token,
        password,
        confirmPassword: password,
      })
      return response
    } catch (error) {
      const msg = error?.response?.data?.message || 'Error restableciendo contraseña'
      return thunkAPI.rejectWithValue(msg)
    }
  },
)

export const getMe = createAsyncThunk('auth/get-me', async (_, thunkAPI) => {
  try {
    const response = await userService.getCurrentUser()

    if (!response?.success || !response?.data?.user) {
      return thunkAPI.rejectWithValue(response?.message || 'Error al obtener perfil')
    }

    const { user } = response.data
    safeStorage.setUser(user)
    return { user }
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || 'Error al obtener perfil')
  }
})

export const updateProfile = createAsyncThunk(
  'user/update-profile',
  async (profileData, thunkAPI) => {
    try {
      const response = await userService.updateUser(profileData)

      if (!response?.success || !response?.data) {
        return thunkAPI.rejectWithValue(response?.message || 'No se pudo actualizar el perfil')
      }

      safeStorage.setUser(response.data)

      return {
        user: response.data,
        message: response.message || 'Perfil actualizado correctamente',
      }
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message || error?.message || 'No se pudo actualizar el perfil',
      )
    }
  },
)

/**
 * toggleWishlist
 * - Recibe productId
 * - Backend devuelve { success, data: updatedWishlistArray, message }
 */
export const toggleWishlist = createAsyncThunk(
  'user/toggleWishlist',
  async (productId, { rejectWithValue, dispatch }) => {
    try {
      const res = await userService.toggleWishlist(productId)

      if (res?.success === false) {
        if ([401, 403].includes(Number(res.status))) {
          dispatch(resetAuthState())
          return rejectWithValue(
            'Tu sesión expiró. Iniciá sesión nuevamente para guardar favoritos.',
          )
        }

        return rejectWithValue(res.message || 'Error al actualizar wishlist')
      }

      // Normalizar el resultado
      const updatedWishlist =
        res && res.data && Array.isArray(res.data)
          ? res.data
          : res && Array.isArray(res)
            ? res
            : res && res.data && Array.isArray(res.data.wishlist)
              ? res.data.wishlist
              : null

      if (!Array.isArray(updatedWishlist)) {
        // Puede ser que backend haya devuelto user completo con wishlist dentro
        const alt = res?.data?.wishlist || res?.data || null
        if (Array.isArray(alt)) {
          sessionStorage.setItem('wishlist', JSON.stringify(alt))
          return { data: alt, message: res?.message || 'Operación completada' }
        }
        return rejectWithValue('Respuesta inválida al actualizar wishlist')
      }

      sessionStorage.setItem('wishlist', JSON.stringify(updatedWishlist))
      return {
        data: updatedWishlist,
        message: res?.message || 'Lista de deseos actualizada',
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Error al actualizar wishlist'
      return rejectWithValue(message)
    }
  },
)

/* ---------------------------
   Slice
   --------------------------- */
const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    // Set CSRF token (desde login inicial o inicialización)
    setCsrfToken: (state, action) => {
      state.csrfToken = action.payload
      sessionStorage.setItem('csrfToken', action.payload)
      try {
        sessionStorage.setItem('csrfToken', action.payload)
      } catch {
        state.csrfToken = null
        sessionStorage.removeItem('csrfToken')
      }
    },
    // Limpiar flags de error / mensaje
    clearState: state => {
      state.isError = false
      state.isSuccess = false
      state.isLoading = false
      state.message = ''
    },
    // Reset completo de auth (logout forzado)
    resetAuthState: state => {
      state.user = null
      state.csrfToken = null
      state.isAuthenticated = false
      state.isSuccess = false
      state.isError = false
      state.isLoading = false
      state.message = ''
      state.wishlist = []
      safeStorage.removeUser()
      marcaDeSesion.sacar()
    },
    // Reemplazar wishlist manualmente (útil para sync)
    setWishlist: (state, action) => {
      state.wishlist = Array.isArray(action.payload) ? action.payload : []
      try {
        sessionStorage.setItem('wishlist', JSON.stringify(state.wishlist))
      } catch {
        state.wishlist = []
        sessionStorage.removeItem('wishlist')
      }
    },
  },
  extraReducers: builder => {
    builder
      // LOGIN
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
        state.message = ''
        marcaDeSesion.poner()
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.isAuthenticated = false
        state.message = action.payload || 'Error en login'
      })

      // GET ME
      .addCase(getMe.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(getMe.fulfilled, (state, action) => {
        state.isLoading = false
        state.user = action.payload?.user || null
        state.isAuthenticated = Boolean(action.payload?.user)
        state.isError = false

        // Se renueva en cada confirmación, no sólo al entrar: así la marca
        // acompaña a quien usa la tienda seguido y no vence por calendario
        // mientras la sesión sigue viva.
        if (action.payload?.user) marcaDeSesion.poner()
        else marcaDeSesion.sacar()
      })
      .addCase(getMe.rejected, (state, action) => {
        state.isLoading = false
        state.user = null
        state.isAuthenticated = false
        state.isError = true
        state.message =
          typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'Error al obtener perfil'

        // El backend ya dijo que no hay sesión: la marca quedó vieja y
        // mantenerla haría repetir la pregunta en cada carga.
        marcaDeSesion.sacar()
      })

      .addCase(updateProfile.pending, state => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
        state.message = ''
      })
      .addCase(updateProfile.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.user = action.payload.user
        state.message = action.payload.message
      })
      .addCase(updateProfile.rejected, (state, action) => {
        state.isLoading = false
        state.isSuccess = false
        state.isError = true
        state.message =
          typeof action.payload === 'string'
            ? action.payload
            : action.payload?.message || 'No se pudo actualizar el perfil'
      })

      // --- REQUEST PASSWORD RESET ---
      .addCase(requestPasswordReset.pending, state => {
        state.isLoading = true
        state.isError = null
      })
      .addCase(requestPasswordReset.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
      })
      .addCase(requestPasswordReset.rejected, (state, action) => {
        state.isLoading = false
        state.isError = action.payload
      })

      // --- RESET PASSWORD ---
      .addCase(resetPassword.pending, state => {
        state.isLoading = true
        state.isError = null
      })
      .addCase(resetPassword.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
      })
      .addCase(resetPassword.rejected, (state, action) => {
        state.isLoading = false
        state.isError = action.payload
      })

      // REFRESH SESSION — rota la cookie httpOnly server-side; no trae user
      // (nunca lo trajo: userService.refreshToken() solo devuelve
      // {success, data:{csrfToken}}), así que no toca isAuthenticated/user
      // acá. getMe() sigue siendo la única fuente de verdad de sesión.
      .addCase(refreshSession.rejected, state => {
        state.user = null
        state.isAuthenticated = false
        safeStorage.removeUser()
      })

      // LOGOUT
      .addCase(logoutUser.pending, state => {
        state.isLoading = true
      })
      .addCase(logoutUser.fulfilled, state => {
        state.isLoading = false
        state.isSuccess = true // Cambiar a true indica que la acción de logout terminó bien
        state.isError = false
        state.user = null
        state.isAuthenticated = false
        state.csrfToken = null
        state.wishlist = []
        safeStorage.removeUser()
        marcaDeSesion.sacar()
      })
      .addCase(logoutUser.rejected, (state, action) => {
        state.isLoading = false
        // Mantenemos el error para mostrar un toast de "El servidor no respondió, pero se cerró la sesión local"
        state.isError = true
        state.message = action.payload || 'Error al cerrar sesión en el servidor'

        // --- Limpieza de Estado ---
        state.user = null
        state.csrfToken = null
        state.isAuthenticated = false
        state.wishlist = []
        state.message = action.payload || 'Error al cerrar sesión'
      })

      // REGISTER
      .addCase(registerUser.pending, state => {
        state.isLoading = true
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        toast.success('Usuario registrado correctamente')

        const user = action.payload?.user || action.payload
        if (user) {
          state.user = user
          safeStorage.setUser(user)
        }
      })

      .addCase(registerUser.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error al registrar usuario'
      })

      // GET WISHLIST
      .addCase(getUserProductWishlist.pending, state => {
        state.isLoading = true
        state.isError = false
      })
      .addCase(getUserProductWishlist.fulfilled, (state, action) => {
        state.isLoading = false
        state.isError = false
        state.wishlist = Array.isArray(action.payload) ? action.payload : []
      })
      .addCase(getUserProductWishlist.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error obteniendo wishlist'
      })

      // TOGGLE WISHLIST
      .addCase(toggleWishlist.pending, state => {
        state.isLoading = true
        state.isError = false
      })
      .addCase(toggleWishlist.fulfilled, (state, action) => {
        state.isLoading = false
        state.isError = false
        state.wishlist = Array.isArray(action.payload?.data) ? action.payload.data : []
        state.message = action.payload?.message || ''
      })
      .addCase(toggleWishlist.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error actualizando wishlist'
      })
  },
})

/* ---------------------------
   Exports
   --------------------------- */
export const { clearState, setCsrfToken, resetAuthState, setWishlist } = userSlice.actions

export default userSlice.reducer
