// 📁 src/features/theme/themeSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import themeService from './themeService.js'

// ==========================================
// HELPERS
// ==========================================

const getToken = getState => {
  const token = getState().auth?.user?.token || localStorage.getItem('token')
  if (!token) throw new Error('No autenticado')
  return token
}

// ==========================================
// ASYNC THUNKS
// ==========================================

export const getThemeConfig = createAsyncThunk(
  'theme/getConfig',
  async (_, { getState, rejectWithValue }) => {
    try {
      const token = getToken(getState)
      const response = await themeService.getThemeConfig(token)

      if (!response.success) {
        return rejectWithValue(response.error || 'Error al cargar configuración')
      }

      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const updateThemeConfig = createAsyncThunk(
  'theme/updateConfig',
  async (themeData, { getState, rejectWithValue }) => {
    try {
      const token = getToken(getState)
      const response = await themeService.updateThemeConfig(token, themeData)

      if (!response.success) {
        return rejectWithValue(response.error || 'Error al actualizar')
      }

      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const resetThemeConfig = createAsyncThunk(
  'theme/resetConfig',
  async (_, { getState, rejectWithValue }) => {
    try {
      const token = getToken(getState)
      const response = await themeService.resetThemeConfig(token)

      if (!response.success) {
        return rejectWithValue(response.error || 'Error al restaurar')
      }

      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const uploadThemeAsset = createAsyncThunk(
  'theme/uploadAsset',
  async ({ file, assetType }, { getState, rejectWithValue }) => {
    try {
      const token = getToken(getState)
      const response = await themeService.uploadThemeAsset(token, file, assetType)

      if (!response.success) {
        return rejectWithValue(response.error || 'Error al subir imagen')
      }

      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

export const previewThemeConfig = createAsyncThunk(
  'theme/previewConfig',
  async (themeData, { getState, rejectWithValue }) => {
    try {
      const token = getToken(getState)
      const response = await themeService.previewThemeConfig(token, themeData)

      if (!response.success) {
        return rejectWithValue(response.error || 'Error en preview')
      }

      return response
    } catch (error) {
      return rejectWithValue(error.message)
    }
  },
)

// ==========================================
// SLICE
// ==========================================

const initialState = {
  config: null,
  previewConfig: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
  previewMode: false,
  lastSaved: null,
}

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setPreviewMode: (state, action) => {
      state.previewMode = action.payload
    },
    updatePreviewConfig: (state, action) => {
      state.previewConfig = { ...state.previewConfig, ...action.payload }
      state.previewMode = true // Forzamos el modo preview al actualizar
    },
    clearThemeStatus: state => {
      state.isError = false
      state.isSuccess = false
      state.message = ''
    },

    updateLocalConfig: (state, action) => {
      state.config = { ...state.config, ...action.payload }
      state.hasChanges = false
    },

    resetThemeState: () => initialState,
  },

  extraReducers: builder => {
    builder
      // ==========================================
      // GET THEME CONFIG
      // ==========================================
      .addCase(getThemeConfig.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(getThemeConfig.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.config = action.payload.data
        state.message = ''
      })
      .addCase(getThemeConfig.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error al cargar configuración'
      })

      // ==========================================
      // UPDATE THEME CONFIG
      // ==========================================
      .addCase(updateThemeConfig.pending, state => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
      })
      .addCase(updateThemeConfig.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.config = action.payload.data
        state.lastSaved = new Date().toISOString()
        state.message = action.payload.message || 'Configuración guardada'
      })
      .addCase(updateThemeConfig.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error al guardar configuración'
      })

      // ==========================================
      // RESET THEME CONFIG
      // ==========================================
      .addCase(resetThemeConfig.pending, state => {
        state.isLoading = true
      })
      .addCase(resetThemeConfig.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.config = action.payload.data
        state.message = action.payload.message || 'Configuración restaurada'
        state.lastSaved = new Date().toISOString()
      })
      .addCase(resetThemeConfig.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error al restaurar'
      })

      // ==========================================
      // UPLOAD THEME ASSET
      // ==========================================
      .addCase(uploadThemeAsset.pending, state => {
        state.isLoading = true
        state.isError = false
      })
      .addCase(uploadThemeAsset.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        // Actualizar config si el backend la devuelve
        if (action.payload.data?.config) {
          state.config = action.payload.data.config
        }
        state.message = action.payload.message || 'Imagen subida correctamente'
      })
      .addCase(uploadThemeAsset.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error al subir imagen'
      })

      // ==========================================
      // PREVIEW THEME CONFIG
      // ==========================================
      .addCase(previewThemeConfig.pending, state => {
        state.isLoading = true
      })
      .addCase(previewThemeConfig.fulfilled, (state, action) => {
        state.isLoading = false
        state.previewConfig = action.payload.data?.data || action.payload.data
        state.previewMode = true
      })
      .addCase(previewThemeConfig.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error en preview'
      })
  },
})

export const {
  setPreviewMode,
  clearThemeStatus,
  updatePreviewConfig,
  updateLocalConfig,
  resetThemeState,
} = themeSlice.actions

export default themeSlice.reducer
