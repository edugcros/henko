// 📁 src/features/auth/authSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import Cookies from 'js-cookie'
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
  removeUser: () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('wishlist')
    sessionStorage.removeItem('csrfToken')
  },
}


// ---------------------------
// Estado inicial
// ---------------------------

const initialState = {
  user: safeStorage.getUser(),
  token: null, 
  csrfToken: sessionStorage.getItem('csrfToken'),
  isAuthenticated: !!safeStorage.getUser(),
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
  loading: { createAdmin: false, orders: false },
  error: { createAdmin: null, orders: null },
  orders: { data: [], pagination: null, inFlightKey: null }
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
        error?.response?.data?.message ||
          error?.message ||
          'Error al crear el comercio'
      )
    }
  }
)

export const getMe = createAsyncThunk('auth/get-me', async (_, thunkAPI) => {
  try {
    const response = await authService.getCurrentUser();
    // Normalizamos: la data suele venir en response.data
    const data = response.data || response;
    if (data.user) safeStorage.setUser(data.user);
    return data;
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || 'Error al obtener perfil');
  }
});

export const refreshSession = createAsyncThunk('auth/refreshSession', async (_, thunkAPI) => {
  try {
    const res = await authService.refreshToken()
    if (!res?.success || !res.data) return thunkAPI.rejectWithValue('Refresh inválido')
    
    const { user, token } = res.data
    safeStorage.setUser(user) // Sincronizamos storage
    return { user, token } 
  } catch (error) {
    safeStorage.removeAuth()
    return thunkAPI.rejectWithValue(error?.response?.data || 'Refresh failed')
  }
})

export const loginUser = createAsyncThunk(
  'user/admin-login',
  async (userData, { rejectWithValue }) => {
    try {
      const res = await authService.loginUser(userData)

      // 🔥 VALIDACIÓN CORRECTA
    if (!res || res.success !== true || !res.data) {
      return rejectWithValue('Respuesta inválida del servidor durante login')
    }

      const { user, token, csrfToken } = res.data

      // 🔥 CRÍTICO: Si el login nos da un token nuevo, lo inyectamos en el estado inmediatamente
      if (csrfToken) {
        dispatch(setCsrfToken(csrfToken))
      }

      const isProd = process.env.NODE_ENV === 'production'

      safeStorage.setUser(user)

      Cookies.set('token', token, {
        path: '/',
        secure: isProd,
        sameSite: 'Lax',
      })
      console.log('Login exitoso:', { user, token })
      return { user, token }
    } catch (err) {
      return rejectWithValue(
        err?.response?.data?.message || 'Error de autenticación'
      )
    }
  }
)


// params: { page, limit, status, q, from, to }
let loadingOrders = false;

const makeKey = (p={}) => JSON.stringify({
  page: p.page ?? 1, limit: p.limit ?? 20,
  status: p.status || null, q: p.q || null, from: p.from || null, to: p.to || null
})

export const getOrders = createAsyncThunk(
  'orders/getAll',
  async (params, { rejectWithValue }) => {
    try {
      const res = await authService.getOrders(params)   // debe devolver { success, data, pagination }
      if (!res?.success) throw new Error(res?.message || 'Error al obtener órdenes')
      return { data: res.data || [], pagination: res.pagination || null, _qk: makeKey(params) }
    } catch (e) {
      return rejectWithValue(e?.message || 'Error al obtener órdenes')
    }
  },
  {
    condition: (params, { getState }) => {
      const s = getState().user // ← usa el nombre real del slice en tu store
      const key = makeKey(params)
      if (s?.orders?.inFlightKey && s.orders.inFlightKey === key) return false
      return true
    }
  }
)

// Actualizar estado de una orden (Admin)
export const updateOrderStatus = createAsyncThunk(
  'orders/updateStatus',
  async ({ id, status }, { rejectWithValue }) => {
    try {
      const res = await authService.updateOrderStatus(id, status)
      if (!res?.success) throw new Error(res?.message || 'No se pudo actualizar el estado')
      return res.data // orden actualizada
    } catch (error) {
      return rejectWithValue(error?.message || 'No se pudo actualizar el estado')
    }
  }
)

export const logoutUser = createAsyncThunk(
  'user/logout', 
  async (_, { rejectWithValue }) => {
    try {
      // 1. Llamada al service (que a su vez llama al backend)
      const res = await authService.logoutUser();

      // 2. Limpieza de storage local (Lo que el JS SÍ controla)
      safeStorage.removeAuth();
      sessionStorage.clear(); // Borra cualquier rastro de tenant o estado temporal

      // 3. Feedback visual
      toast.success('Sesión cerrada correctamente');

      return res; 
    } catch (err) {
      // Aunque falle la petición (ej. el servidor está caído),
      // forzamos la limpieza local para que el usuario no quede atrapado
      safeStorage.removeAuth();
      sessionStorage.clear();
      
      const message = err?.message || 'Error al cerrar sesión';
      return rejectWithValue(message);
    }
  }
);

// ---------------------------
// Slice
// ---------------------------
const authSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    clearState: (state) => {
      state.isError = false
      state.message = ''
      state.isSuccess = false
      state.isLoading = false
    },
    resetAuthState: (state) => {
      state.user = null
      state.token = null
      state.csrfToken = null
      state.isAuthenticated = false
      state.isSuccess = false
      state.isError = false
      state.isLoading = false
      state.message = ''
      state.orders = { data: [], pagination: null }
      try {
        Cookies.remove('token', { path: '/' })
        sessionStorage.removeItem('user')
        sessionStorage.removeItem('csrfToken')
      } catch {}
    },
    setCsrfToken: (state, action) => {
      state.csrfToken = action.payload
      try { sessionStorage.setItem('csrfToken', action.payload) } catch {}
    },
  },
  extraReducers: (builder) => {
    builder
    .addCase(createUserAdmin.pending, (state) => {
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

      state.user = action.payload
      state.isAuthenticated = Boolean(action.payload?.token)
      state.token = action.payload?.token || null

      if (action.payload?.token) {
        try {
          Cookies.set('token', action.payload.token, {
            path: '/',
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
          })
        } catch {}
      }

      try {
        sessionStorage.setItem('user', JSON.stringify(action.payload))
      } catch {}
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
        console.log('Login exitoso:', action.payload)
        state.isLoading = false
        state.isSuccess = true
        state.isAuthenticated = true
        state.user = action.payload.user
        state.token = action.payload.token
        state.isError = false
      })

      .addCase(loginUser.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      // get orders (admin)
      .addCase(getOrders.pending, (state, action) => {
        state.isLoading = true
        state.orders.inFlightKey = makeKey(action.meta.arg || {})
      })
      .addCase(getOrders.fulfilled, (state, action) => {
        state.isLoading = false
        state.orders = {
          data: action.payload?.data || [],
          pagination: action.payload?.pagination || { total: 0, page: 1, pages: 1 },
          inFlightKey: null,
        }
        state.isSuccess = true
        state.isError = false
      })
      .addCase(getOrders.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || action.error?.message
        state.orders.inFlightKey = null
      })
      // update order status (admin)
      .addCase(updateOrderStatus.pending, (state) => {})
      .addCase(updateOrderStatus.fulfilled, (state, action) => {
        const updated = action.payload
        const idx = state.orders.data.findIndex((o) => o._id === updated._id)
        if (idx >= 0) state.orders.data[idx] = updated
        state.isSuccess = true
      })
      .addCase(updateOrderStatus.rejected, (state, action) => {
        state.isError = true
        state.message = action.payload || action.error?.message
      })

      // logout
      .addCase(logoutUser.pending, (state) => { state.isLoading = true })
      .addCase(logoutUser.fulfilled, (state) => {
        // 1. Resetear estados de carga y errores
        state.isLoading = false;
        state.isSuccess = true; // Cambiar a true indica que la acción de logout terminó bien
        state.isError = false;
        state.message = '';

        // 2. Limpiar datos del usuario
        state.user = null;
        state.token = null;
        state.csrfToken = null;
        state.isAuthenticated = false;

        // 3. Limpiar datos de negocio (importante para multi-tenant)
        state.orders = { data: [], pagination: null };

        // 🔥 NOTA: El try/catch con Cookies y sessionStorage NO VA AQUÍ.
        // Eso ya lo ejecutamos en el Thunk antes de llegar a este punto.
      })
     .addCase(logoutUser.rejected, (state, action) => {
        state.isLoading = false;
        // Mantenemos el error para mostrar un toast de "El servidor no respondió, pero se cerró la sesión local"
        state.isError = true;
        state.message = action.payload || "Error al cerrar sesión en el servidor";

        // --- Limpieza de Estado ---
        state.user = null;
        state.token = null;
        state.csrfToken = null;
        state.isAuthenticated = false;
        state.orders = { data: [], pagination: null };

        // 🔥 NOTA: La limpieza de Cookies y sessionStorage ya debe estar en el 
        // catch del createAsyncThunk que escribimos antes. No la repitas aquí.
      })

            /* ---------- GET ME ---------- */
      .addCase(getMe.fulfilled, (state, action) => {
        state.user = action.payload?.data || action.payload;
        state.token = action.payload?.token || null;
        state.isAuthenticated = true
      })
      .addCase(getMe.rejected, (state) => {
        state.user = null
        state.token = null
        state.isAuthenticated = false
      })
      
      .addCase(refreshSession.fulfilled, (state, action) => {
        const { user, token } = action.payload
        state.user = user
        state.token = token
        state.isAuthenticated = true
      })

      .addCase(refreshSession.rejected, state => {
        state.user = null
        state.token = null
      })
  },
})

// ---------------------------
// Exports
// ---------------------------
export const { clearState, resetAuthState, setCsrfToken } = authSlice.actions
export default authSlice.reducer
