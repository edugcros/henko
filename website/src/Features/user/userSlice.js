// src/features/user/userSlice.js
import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit'
import userService from '@features/user/userService'
import { toast } from 'react-toastify'
import Cookies from 'js-cookie'

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

/* ---------------------------
   Estado inicial
   --------------------------- */
const initialUser = safeStorage.getUser()
const initialToken =
  Cookies.get('token') ||
  (typeof window !== 'undefined' ? localStorage.getItem('token') : null) ||
  null
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
  token: initialToken,
  csrfToken: sessionStorage.getItem('csrfToken'),
  isAuthenticated: !!safeStorage.getUser() && !!initialToken,
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
 * - userService.loginUser devuelve { success, data: { user, token } }
 * - Guardamos usuario y token (si vienen) en sessionStorage + cookie
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

      const { user, token, csrfToken } = res.data

      // 🔥 CRÍTICO: Si el login nos da un token nuevo, lo inyectamos en el estado inmediatamente
      if (csrfToken) {
        dispatch(setCsrfToken(csrfToken))
      }

      safeStorage.setUser(user)
      return { user, token }
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

      const { user, token, csrfToken } = res.data

      // Sincronizamos el nuevo CSRF que suele venir con el refresh
      if (csrfToken) dispatch(setCsrfToken(csrfToken))

      safeStorage.setUser(user)
      return { user, token }
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
    Cookies.remove('token')
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
      console.log(res)
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
    // Normalizamos: la data suele venir en response.data
    const data = response.data || response
    if (data.user) safeStorage.setUser(data.user)
    return data
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || 'Error al obtener perfil')
  }
})

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
          return rejectWithValue('Tu sesión expiró. Iniciá sesión nuevamente para guardar favoritos.')
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
      } catch {}
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
      state.token = null
      state.csrfToken = null
      state.isAuthenticated = false
      state.isSuccess = false
      state.isError = false
      state.isLoading = false
      state.message = ''
      state.wishlist = []
      safeStorage.removeUser()
      localStorage.removeItem('token')
      Cookies.remove('token')
    },
    // Tomar token desde cookie (por ejemplo SSR/hydration)
    setTokenFromCookie(state, action) {
      state.token = action.payload
      sessionStorage.setItem('token', action.payload)
    },

    // Reemplazar wishlist manualmente (útil para sync)
    setWishlist: (state, action) => {
      state.wishlist = Array.isArray(action.payload) ? action.payload : []
      try {
        sessionStorage.setItem('wishlist', JSON.stringify(state.wishlist))
      } catch {}
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
        state.token = action.payload.token
        state.isError = false
        state.message = ''
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.isAuthenticated = false
        state.message = action.payload || 'Error en login'
      })

      // GET ME
      .addCase(getMe.fulfilled, (state, action) => {
        state.user = action.payload?.data || action.payload
        state.token = action.payload?.token || null
        state.isAuthenticated = true
      })
      .addCase(getMe.rejected, state => {
        state.user = null
        state.token = null
        state.isAuthenticated = false
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

      // REFRESH SESSION
      .addCase(refreshSession.fulfilled, (state, action) => {
        state.user = action.payload.user
        state.token = action.payload.token
        state.isAuthenticated = true
        safeStorage.setUser(action.payload.user)
      })
      .addCase(refreshSession.rejected, state => {
        state.user = null
        state.token = null
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
        state.token = null
        state.isAuthenticated = false
        state.csrfToken = null
        state.wishlist = []
        safeStorage.removeUser()
      })
      .addCase(logoutUser.rejected, (state, action) => {
        state.isLoading = false
        // Mantenemos el error para mostrar un toast de "El servidor no respondió, pero se cerró la sesión local"
        state.isError = true
        state.message = action.payload || 'Error al cerrar sesión en el servidor'

        // --- Limpieza de Estado ---
        state.user = null
        state.token = null
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
export const { clearState, setCsrfToken, resetAuthState, setTokenFromCookie, setWishlist } =
  userSlice.actions

export default userSlice.reducer
