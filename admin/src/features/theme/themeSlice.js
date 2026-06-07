// src/features/theme/themeSlice.js - VERSIÓN PRODUCCIÓN REFACTORIZADA
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import {
  getTheme,
  updateTheme as apiUpdateTheme,
  patchTheme as apiPatchTheme,
  resetTheme as apiResetTheme,
  uploadImage,
  exportTheme as apiExportTheme,
  importTheme as apiImportTheme,
  createPreview as apiCreatePreview,
  activatePreview as apiActivatePreview,
  getThemeHistory,
  rollbackTheme,
  toggleMaintenance,
  validateTheme,
  normalizeImageAsset as normalizeUploadedImageAsset,
} from './themeApi.js'

// ==========================================
// ESTADO INICIAL
// ==========================================

const initialState = {
  // Datos
  config: null,
  originalConfig: null,
  previewConfig: null, // Para modo preview sin guardar
  
  // Estados UI
  isLoading: false,
  isSaving: false,
  isSuccess: false,
  isError: false,
  error: null,
  
  // Auto-save
  hasUnsavedChanges: false,
  lastSaved: null,
  autoSaveEnabled: true,
  autoSaveError: null,
  
  // Preview system
  previewMode: false,
  previewId: null,
  activeSection: 'general',
  
  // Versionado
  history: [],
  isHistoryLoading: false,
  
  // Cache
  lastFetched: null,
}

// ==========================================
// HELPERS
// ==========================================

const deepClone = (obj) => JSON.parse(JSON.stringify(obj))
const isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const isImageField = key => ['backgroundImage', 'logo', 'favicon'].includes(key)

const normalizeImageAsset = value => {
  const image =
    value?.image ||
    value?.data?.image ||
    value?.data ||
    value?.payload?.image ||
    value?.payload?.data ||
    value?.payload ||
    value

  if (!image) return null
  if (typeof image === 'string') return image.trim() ? { url: image.trim(), public_id: '' } : null
  if (typeof image !== 'object') return null

  const url = typeof image.url === 'string' ? image.url.trim() : ''
  if (!url) return null

  return {
    url,
    public_id: image.public_id || image.publicId || '',
  }
}

const sanitizeThemeValue = (value, key = '') => {
  if (isImageField(key)) return normalizeImageAsset(value)

  if (!value || typeof value !== 'object') return value
  if (typeof File !== 'undefined' && value instanceof File) return undefined
  if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined
  if (Array.isArray(value)) {
    return value
      .map(item => sanitizeThemeValue(item))
      .filter(item => item !== undefined)
  }

  return Object.entries(value).reduce((acc, [childKey, childValue]) => {
    if (['meta', 'error'].includes(childKey)) return acc
    const sanitized = sanitizeThemeValue(childValue, childKey)
    if (sanitized !== undefined) acc[childKey] = sanitized
    return acc
  }, {})
}

const unwrapApiData = value => {
  if (
    value &&
    typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'success') &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return value.data
  }

  return value
}

// ==========================================
// THUNKS
// ==========================================

export const fetchTheme = createAsyncThunk(
  'theme/fetch',
  async (_, { rejectWithValue }) => {
    try {
      return await getTheme()
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const saveTheme = createAsyncThunk(
  'theme/save',
  async (themeData, { rejectWithValue }) => {
    try {
      return await apiUpdateTheme(themeData)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const autoSaveTheme = createAsyncThunk(
  'theme/autoSave',
  async (partialData, { rejectWithValue, dispatch }) => {
    try {
      const response = await apiPatchTheme(partialData)
      // Silencioso - no muestra loading global
      return response
    } catch (error) {
      const errorPayload = {
        message: error.message,
        status: error.status || null,
      }

      // Auto-save fallido no es crítico
      dispatch(setAutoSaveError(errorPayload))
      return rejectWithValue(errorPayload)
    }
  }
)

export const resetThemeToDefault = createAsyncThunk(
  'theme/reset',
  async (_, { rejectWithValue }) => {
    try {
      return await apiResetTheme()
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const uploadThemeImage = createAsyncThunk(
  'theme/uploadImage',
  async ({ file, type, fieldPath }, { rejectWithValue }) => {
    try {
      const uploadResponse = await uploadImage(file, type)
      const imageData = normalizeUploadedImageAsset(uploadResponse)
      
      if (!imageData?.url) throw new Error('Respuesta de upload inválida')
      
      // Construir update nested por fieldPath
      const keys = fieldPath.split('.')
      const updateData = {}
      let current = updateData
      
      keys.forEach((key, index) => {
        if (index === keys.length - 1) {
          current[key] = {
            url: imageData.url,
            public_id: imageData.public_id || null,
          }
        } else {
          current[key] = {}
          current = current[key]
        }
      })
      
      const themeResponse = await apiPatchTheme(updateData)
      return { image: imageData, theme: themeResponse }
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const createThemePreview = createAsyncThunk(
  'theme/createPreview',
  async (previewData, { rejectWithValue }) => {
    try {
      return await apiCreatePreview(previewData)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const activateThemePreview = createAsyncThunk(
  'theme/activatePreview',
  async (previewId, { rejectWithValue }) => {
    try {
      return await apiActivatePreview(previewId)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const fetchThemeHistory = createAsyncThunk(
  'theme/fetchHistory',
  async (limit = 10, { rejectWithValue }) => {
    try {
      return await getThemeHistory(limit)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const rollbackToVersion = createAsyncThunk(
  'theme/rollback',
  async (version, { rejectWithValue }) => {
    try {
      return await rollbackTheme(version)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const exportThemeToFile = createAsyncThunk(
  'theme/export',
  async (filename, { rejectWithValue }) => {
    try {
      await apiExportTheme(filename)
      return true
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const importThemeFromFile = createAsyncThunk(
  'theme/import',
  async (themeData, { rejectWithValue }) => {
    try {
      return await apiImportTheme(themeData)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const toggleMaintenanceMode = createAsyncThunk(
  'theme/toggleMaintenance',
  async (enabled, { rejectWithValue }) => {
    try {
      return await toggleMaintenance(enabled)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

export const validateThemeConfig = createAsyncThunk(
  'theme/validate',
  async (config, { rejectWithValue }) => {
    try {
      return await validateTheme(config)
    } catch (error) {
      return rejectWithValue(error.message)
    }
  }
)

// ==========================================
// SLICE
// ==========================================

const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    // Updates inmutables con path
    updateField: (state, action) => {
      const { path, value } = action.payload
      const keys = path.split('.')
      
      // Crear copia y actualizar
      const newConfig = deepClone(state.config)
      let target = newConfig
      
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {}
        }
        target = target[key]
      }
      
      target[keys[keys.length - 1]] = sanitizeThemeValue(value, keys[keys.length - 1])
      state.config = newConfig
      state.hasUnsavedChanges = !isEqual(newConfig, state.originalConfig)
    },
    
    updateSection: (state, action) => {
      const { section, data } = action.payload
      state.config = {
        ...state.config,
        [section]: { ...state.config[section], ...sanitizeThemeValue(data, section) },
      }
      state.hasUnsavedChanges = !isEqual(state.config, state.originalConfig)
    },
    
    setPreviewData: (state, action) => {
      state.previewConfig = sanitizeThemeValue(action.payload)
    },
    
    clearPreview: (state) => {
      state.previewConfig = null
      state.previewId = null
    },
    
    setActiveSection: (state, action) => {
      state.activeSection = action.payload
    },
    
    togglePreviewMode: (state) => {
      state.previewMode = !state.previewMode
    },
    
    toggleAutoSave: (state) => {
      state.autoSaveEnabled = !state.autoSaveEnabled
    },
    
    setAutoSaveError: (state, action) => {
      state.autoSaveError = action.payload
    },
    
    clearAutoSaveError: (state) => {
      state.autoSaveError = null
    },
    
    discardChanges: (state) => {
      state.config = deepClone(state.originalConfig)
      state.hasUnsavedChanges = false
      state.previewConfig = null
    },
    
    clearError: (state) => {
      state.isError = false
      state.error = null
    },
    
    resetState: () => initialState,
  },
  
  extraReducers: (builder) => {
    // Fetch
    builder
      .addCase(fetchTheme.pending, (state) => {
        state.isLoading = true
        state.isError = false
        state.error = null
      })
      .addCase(fetchTheme.fulfilled, (state, action) => {
        state.isLoading = false
        state.config = sanitizeThemeValue(unwrapApiData(action.payload))
        state.originalConfig = deepClone(state.config)
        state.hasUnsavedChanges = false
        state.lastFetched = new Date().toISOString()
      })
      .addCase(fetchTheme.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload
      })
    
    // Save (manual)
      .addCase(saveTheme.pending, (state) => {
        state.isSaving = true
        state.isError = false
      })
      .addCase(saveTheme.fulfilled, (state, action) => {
        state.isSaving = false
        state.isSuccess = true
        state.config = sanitizeThemeValue(unwrapApiData(action.payload))
        state.originalConfig = deepClone(state.config)
        state.hasUnsavedChanges = false
        state.lastSaved = new Date().toISOString()
      })
      .addCase(saveTheme.rejected, (state, action) => {
        state.isSaving = false
        state.isError = true
        state.error = action.payload
      })
    
    // Auto-save (silencioso)
      .addCase(autoSaveTheme.fulfilled, (state, action) => {
        const savedConfig = sanitizeThemeValue(unwrapApiData(action.payload))
        state.config = savedConfig
        state.originalConfig = deepClone(savedConfig)
        state.hasUnsavedChanges = false
        state.lastSaved = new Date().toISOString()
        state.autoSaveError = null
      })
    
    // Reset
      .addCase(resetThemeToDefault.pending, (state) => {
        state.isLoading = true
      })
      .addCase(resetThemeToDefault.fulfilled, (state, action) => {
        state.isLoading = false
        state.config = sanitizeThemeValue(unwrapApiData(action.payload))
        state.originalConfig = deepClone(state.config)
        state.hasUnsavedChanges = false
      })
      .addCase(resetThemeToDefault.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload
      })
    
    // Upload
      .addCase(uploadThemeImage.pending, (state) => {
        state.isSaving = true
      })
      .addCase(uploadThemeImage.fulfilled, (state, action) => {
        state.isSaving = false
        state.config = sanitizeThemeValue(unwrapApiData(action.payload.theme))
        state.originalConfig = deepClone(state.config)
        state.hasUnsavedChanges = false
      })
      .addCase(uploadThemeImage.rejected, (state, action) => {
        state.isSaving = false
        state.isError = true
        state.error = action.payload
      })
    
    // Preview system
      .addCase(createThemePreview.fulfilled, (state, action) => {
        const previewPayload = unwrapApiData(action.payload)
        state.previewId = previewPayload?.previewId
        state.previewConfig = sanitizeThemeValue(previewPayload?.data || state.previewConfig)
      })
      .addCase(activateThemePreview.fulfilled, (state, action) => {
        state.config = sanitizeThemeValue(unwrapApiData(action.payload))
        state.originalConfig = deepClone(state.config)
        state.previewId = null
        state.previewConfig = null
        state.previewMode = false
        state.hasUnsavedChanges = false
      })
    
    // History
      .addCase(fetchThemeHistory.pending, (state) => {
        state.isHistoryLoading = true
      })
      .addCase(fetchThemeHistory.fulfilled, (state, action) => {
        state.isHistoryLoading = false
        state.history = action.payload
      })
      .addCase(fetchThemeHistory.rejected, (state) => {
        state.isHistoryLoading = false
      })
    
    // Rollback
      .addCase(rollbackToVersion.fulfilled, (state, action) => {
        state.config = sanitizeThemeValue(unwrapApiData(action.payload))
        state.originalConfig = deepClone(state.config)
        state.hasUnsavedChanges = false
      })
    
    // Import
      .addCase(importThemeFromFile.fulfilled, (state, action) => {
        state.config = sanitizeThemeValue(unwrapApiData(action.payload))
        state.originalConfig = deepClone(state.config)
        state.hasUnsavedChanges = false
      })
  },
})

// ==========================================
// SELECTORS
// ==========================================

export const selectTheme = (state) => state.theme.config
export const selectOriginalTheme = (state) => state.theme.originalConfig
export const selectPreviewTheme = (state) => state.theme.previewConfig
export const selectActiveTheme = (state) => 
  state.theme.previewMode ? state.theme.previewConfig : state.theme.config

export const selectThemeSection = (section) => (state) => 
  state.theme.config?.[section]

export const selectHasUnsavedChanges = (state) => state.theme.hasUnsavedChanges
export const selectIsLoading = (state) => state.theme.isLoading
export const selectIsSaving = (state) => state.theme.isSaving
export const selectThemeError = (state) => state.theme.error

export const selectAutoSaveStatus = (state) => ({
  enabled: state.theme.autoSaveEnabled,
  lastSaved: state.theme.lastSaved,
  error: state.theme.autoSaveError,
})

export const selectPreviewStatus = (state) => ({
  active: state.theme.previewMode,
  previewId: state.theme.previewId,
})

export const selectThemeHistory = (state) => state.theme.history

export const selectActiveSection = (state) => state.theme.activeSection

// Selector compuesto para UI
export const selectThemeStatus = (state) => ({
  loading: state.theme.isLoading,
  saving: state.theme.isSaving,
  hasChanges: state.theme.hasUnsavedChanges,
  error: state.theme.error,
  lastSaved: state.theme.lastSaved,
})

// ==========================================
// EXPORTS
// ==========================================

export const {
  updateField,
  updateSection,
  setPreviewData,
  clearPreview,
  setActiveSection,
  togglePreviewMode,
  toggleAutoSave,
  setAutoSaveError,
  clearAutoSaveError,
  discardChanges,
  clearError,
  resetState,
} = themeSlice.actions

export default themeSlice.reducer
