// 📁 src/features/payment/paymentSlice.js
// VERSIÓN PRODUCCIÓN - ERRORES COMPLETOS / METADATA PRESERVADA

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import paymentService from './paymentService'

// =====================================================
// HELPERS
// =====================================================

const normalizePaymentError = error => {
  if (!error) {
    return {
      success: false,
      code: 'PAYMENT_ERROR',
      message: 'Error en el proceso de pago',
      details: null,
      status: null,
      debug: null,
    }
  }

  if (typeof error === 'string') {
    return {
      success: false,
      code: 'PAYMENT_ERROR',
      message: error,
      details: null,
      status: null,
      debug: null,
    }
  }

  return {
    success: false,
    code: error.code || 'PAYMENT_ERROR',
    message:
      error.message ||
      error.details ||
      'Error en el proceso de pago',
    details: error.details || null,
    status: error.status || null,
    debug: error.debug || null,
    raw: error.raw || error,
  }
}

// =====================================================
// THUNKS
// =====================================================

export const processPaymentAction = createAsyncThunk(
  'payments/process',
  async (payload, thunkAPI) => {
    try {
      const response = await paymentService.processPayment(payload)

      if (response?.success !== true) {
        return thunkAPI.rejectWithValue(
          normalizePaymentError(response),
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        normalizePaymentError(error),
      )
    }
  },
)

// =====================================================
// STATE
// =====================================================

const initialState = {
  paymentResult: null,
  paymentError: null,
  isLoading: false,
  isSuccess: false,
  isError: false,
  message: '',
  code: null,
  details: null,
  status: null,
}

// =====================================================
// SLICE
// =====================================================

const paymentSlice = createSlice({
  name: 'payment',
  initialState,
  reducers: {
    resetPayment: () => initialState,

    clearPaymentError: state => {
      state.paymentError = null
      state.isError = false
      state.message = ''
      state.code = null
      state.details = null
      state.status = null
    },
  },
  extraReducers: builder => {
    builder
      .addCase(processPaymentAction.pending, state => {
        state.paymentResult = null
        state.paymentError = null
        state.isLoading = true
        state.isSuccess = false
        state.isError = false
        state.message = ''
        state.code = null
        state.details = null
        state.status = null
      })

      .addCase(processPaymentAction.fulfilled, (state, action) => {
        state.paymentResult = action.payload
        state.paymentError = null
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''
        state.code = null
        state.details = null
        state.status = null
      })

      .addCase(processPaymentAction.rejected, (state, action) => {
        const error = normalizePaymentError(action.payload)

        state.paymentResult = null
        state.paymentError = error
        state.isLoading = false
        state.isSuccess = false
        state.isError = true
        state.message = error.message
        state.code = error.code
        state.details = error.details
        state.status = error.status
      })
  },
})

export const { resetPayment, clearPaymentError } = paymentSlice.actions

export default paymentSlice.reducer