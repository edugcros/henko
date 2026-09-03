// 📁 src/features/auth/authSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import authService from './authServices'
import { toast } from 'react-toastify'
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
  setToken: token => {
    if (typeof window === 'undefined' || !token) return
    try {
      sessionStorage.setItem('auth_token', String(token))
    } catch {
      sessionStorage.removeItem('auth_token')
    }
  },
  getToken: () => {
    if (typeof window === 'undefined') return null
    try {
      const token = sessionStorage.getItem('auth_token')
      return token && String(token).trim() ? token : null
    } catch {
      return null
    }
  },
  removeToken: () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('auth_token')
  },
  removeUser: () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('wishlist')
    sessionStorage.removeItem('csrfToken')
    safeStorage.removeToken()
  },
  // El access token vive en una cookie httpOnly desde el backend (fase 1
  // del refactor de JWT) — JS no puede leerla ni removerla, pero también
  // se guarda en sessionStorage como fallback para cross-origin requests.
  // El logout server-side limpia la cookie; removeAuth limpia el storage local.
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
        return rejectWithValue(response?.message || 'Error al crear el comercio')
      }

      return response.data || response
    } catch (error) {
      return rejectWithValue(
        error?.response?.data?.message || error?.message || 'Error al crear el comercio',
      )
    }
  },
)

export const getMe = createAsyncThunk('auth/get-me', async (_, thunkAPI) => {
  try {
    const response = await authService.getCurrentUser()
    // Normalizamos: la data suele venir en response.data
    const data = response.data || response
    if (data.user) safeStorage.setUser(data.user)
    // Si el refresh devolvió un token, guardarlo como fallback
    if (data.token) safeStorage.setToken(data.token)
    return data
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || 'Error al obtener perfil')
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

      // Guardar el token como fallback para cross-origin requests
      // (cuando las cookies httpOnly no estén disponibles)
      if (token) {
        safeStorage.setToken(token)
      }

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

export const logoutUser = createAsyncThunk('user/logout', async (_, { rejectWithValue }) => {
  try {
    // 1. Llamada al service (que a su vez llama al backend)
    const res = await authService.logoutUser()

    // 2. Limpieza de storage local (Lo que el JS SÍ controla)
    safeStorage.removeAuth()
    sessionStorage.clear() // Borra cualquier rastro de tenant o estado temporal

    // 3. Feedback visual
    toast.success('Sesión cerrada correctamente')

    return res
  } catch (err) {
    // Aunque falle la petición (ej. el servidor está caído),
    // forzamos la limpieza local para que el usuario no quede atrapado
    safeStorage.removeAuth()
    sessionStorage.clear()

    const message = err?.message || 'Error al cerrar sesión'
    return rejectWithValue(message)
  }
})

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
        state.message = action.payload || 'Error al cerrar sesión en el servidor'

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
        state.user = action.payload?.data || action.payload
        state.isAuthenticated = true
      })
      .addCase(getMe.rejected, state => {
        state.isLoading = false
        state.user = null
        state.isAuthenticated = false
      })
  },
})

// ---------------------------
// Exports
// ---------------------------
export const { clearState, resetAuthState, setCsrfToken } = authSlice.actions
export default authSlice.reducer
