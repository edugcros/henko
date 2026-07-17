// 📁 src/features/theme/themeSlice.js
import { createSlice } from '@reduxjs/toolkit'

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
})

export const {
  setPreviewMode,
  clearThemeStatus,
  updatePreviewConfig,
  updateLocalConfig,
  resetThemeState,
} = themeSlice.actions

export default themeSlice.reducer
