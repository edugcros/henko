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
      // previewMode ya no se fuerza acá: cada dispatcher decide explícitamente
      // vía setPreviewMode si el origen es un preview real o un tema normal.
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
