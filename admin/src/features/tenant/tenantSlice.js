import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import tenantService from './tenantService'

export const fetchTenantSettings = createAsyncThunk(
  'tenant/fetchSettings',
  async (_, thunkAPI) => {
    try {
      const response = await tenantService.getTenantSettings()
      if (!response?.success) {
        return thunkAPI.rejectWithValue(response?.message || 'Error cargando configuración')
      }
      return response.data
    } catch (error) {
      return thunkAPI.rejectWithValue(error?.message || 'Error inesperado')
    }
  },
)

export const saveTenantSettings = createAsyncThunk(
  'tenant/saveSettings',
  async (settings, thunkAPI) => {
    try {
      const response = await tenantService.updateTenantSettings(settings)
      if (!response?.success) {
        return thunkAPI.rejectWithValue(response?.message || 'Error guardando configuración')
      }
      return response.data
    } catch (error) {
      return thunkAPI.rejectWithValue(error?.message || 'Error inesperado')
    }
  },
)

export const advanceOnboarding = createAsyncThunk(
  'tenant/advanceOnboarding',
  async (step, thunkAPI) => {
    try {
      const response = await tenantService.updateOnboardingStep(step)
      if (!response?.success) {
        return thunkAPI.rejectWithValue(response?.message || 'Error actualizando onboarding')
      }
      return response.data
    } catch (error) {
      return thunkAPI.rejectWithValue(error?.message || 'Error inesperado')
    }
  },
)

const initialState = {
  data: null,
  isLoading: false,
  isSaving: false,
  isError: false,
  message: null,
}

const tenantSlice = createSlice({
  name: 'tenant',
  initialState,
  reducers: {
    clearTenantState: () => initialState,
  },
  extraReducers: builder => {
    builder
      .addCase(fetchTenantSettings.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = null
      })
      .addCase(fetchTenantSettings.fulfilled, (state, action) => {
        state.isLoading = false
        state.data = action.payload
      })
      .addCase(fetchTenantSettings.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload || 'Error cargando configuración'
      })

      .addCase(saveTenantSettings.pending, state => {
        state.isSaving = true
        state.isError = false
        state.message = null
      })
      .addCase(saveTenantSettings.fulfilled, (state, action) => {
        state.isSaving = false
        if (action.payload) {
          state.data = { ...state.data, ...action.payload }
        }
      })
      .addCase(saveTenantSettings.rejected, (state, action) => {
        state.isSaving = false
        state.isError = true
        state.message = action.payload || 'Error guardando'
      })

      .addCase(advanceOnboarding.fulfilled, (state, action) => {
        if (action.payload?.onboarding && state.data) {
          state.data.onboarding = action.payload.onboarding
        }
      })
  },
})

export const { clearTenantState } = tenantSlice.actions
export default tenantSlice.reducer
