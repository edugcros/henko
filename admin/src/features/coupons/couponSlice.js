// src/features/coupons/couponSlice.js
import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import { couponService, ValidationError, DuplicateError } from './couponService'

const getCouponId = coupon => coupon?.id || coupon?._id

// ======================================================
// HELPERS
// ======================================================

// Manejo centralizado de errores
const handleError = (error) => {
  // Si es nuestro error personalizado, extraer información útil
  if (error instanceof couponService.DuplicateError) {
    return {
      message: error.message,
      code: error.code,
      field: error.field,
      isValidation: true
    }
  }
  
  if (error instanceof couponService.ValidationError) {
    return {
      message: error.message,
      code: error.code,
      isValidation: true
    }
  }

  // Error genérico
  return {
    message: error.message || 'Error inesperado',
    code: error.code || 'UNKNOWN_ERROR',
    isValidation: false
  }
}

// ======================================================
// ASYNC THUNKS
// ======================================================

// Listar cupones (con filtros opcionales)
export const getAllCoupons = createAsyncThunk(
  'coupon/getAll',
  async (filters = {}, thunkAPI) => {
    try {
      const response = await couponService.getCoupons(filters)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Permanent Delete
export const permanentDeleteCoupon = createAsyncThunk(
  'coupon/permanentDeleteCoupon',
  async ({ id, force = false }, thunkAPI) => {
    try {
      const response = await couponService.permanentDeleteCoupon(id, { force })
      return { id, ...response }
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Restore Coupon
export const restoreCoupon = createAsyncThunk(
  'coupon/restore',
  async (id, thunkAPI) => {
    try {
      const response = await couponService.restore(id)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Get Deleted Coupons
export const getDeletedCoupons = createAsyncThunk(
  'coupon/getDeleted',
  async (filters = {}, thunkAPI) => {
    try {
      const response = await couponService.getDeleted(filters)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Crear cupón
export const createCoupon = createAsyncThunk(
  'coupon/create',
  async (couponData, thunkAPI) => {
    try {
      const response = await couponService.create(couponData)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Eliminar cupón
export const deleteCoupon = createAsyncThunk(
  'coupon/delete',
  async (id, thunkAPI) => {
    try {
      const response = await couponService.delete(id)
      return response.id
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Obtener un cupón
export const getCouponById = createAsyncThunk(
  'coupon/getById',
  async (id, thunkAPI) => {
    try {
      const response = await couponService.getById(id)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Actualizar cupón
export const updateCoupon = createAsyncThunk(
  'coupon/update',
  async ({ id, data }, thunkAPI) => {
    try {
      const response = await couponService.update(id, data)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Clonar cupón
export const cloneCoupon = createAsyncThunk(
  'coupon/clone',
  async (id, thunkAPI) => {
    try {
      const response = await couponService.clone(id)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Generar cupones masivos
export const generateBulkCoupons = createAsyncThunk(
  'coupon/generateBulk',
  async (config, thunkAPI) => {
    try {
      const response = await couponService.generateBulk(config)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Validar cupón (para checkout)
export const validateCoupon = createAsyncThunk(
  'coupon/validate',
  async ({ code, cartItems, subtotal, userId }, thunkAPI) => {
    try {
      const response = await couponService.validate(code, { cartItems, subtotal, userId })
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Asignar productos a cupón
export const assignProductsToCoupon = createAsyncThunk(
  'coupon/assignProducts',
  async ({ couponId, productIds, mode = 'add' }, thunkAPI) => {
    try {
      const response = await couponService.assignProducts(couponId, productIds, mode)
      return response
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Obtener estadísticas
export const getCouponStats = createAsyncThunk(
  'coupon/getStats',
  async (id, thunkAPI) => {
    try {
      const response = await couponService.getStats(id)
      return { id, stats: response }
    } catch (error) {
      const processedError = handleError(error)
      return thunkAPI.rejectWithValue(processedError)
    }
  }
)

// Reset state
export const resetCouponState = createAction('coupon/reset')

// ======================================================
// STATE INICIAL
// ======================================================
const initialState = {
  // Listado
  coupons: [],
  pagination: {
    total: 0,
    page: 1,
    pages: 1,
    limit: 20,
    hasNext: false,
    hasPrev: false
  },

    // Papelera
  deletedCoupons: [],
  deletedPagination: {
    total: 0,
    page: 1,
    pages: 1,
    limit: 20
  },
  isLoadingDeleted: false,
  
  // Single coupon
  currentCoupon: null,
  
  // Estados UI globales
  isLoading: false,
  isSuccess: false,
  isError: false,
  message: '',
  
  // Error estructurado
  error: {
    message: '',
    code: null,
    field: null,
    isValidation: false
  },
  
  // Estados específicos por operación
  createdCoupon: null,
  updatedCoupon: null,
  deletedCouponId: null,
  clonedCoupon: null,
  bulkResult: null,
  validationResult: null,
  assignmentResult: null,
  stats: {},
  
  // Cache
  lastFilters: {}
}

// ======================================================
// SLICE
// ======================================================
export const couponSlice = createSlice({
  name: 'coupon',
  initialState,
  reducers: {
    clearCurrentCoupon: (state) => {
      state.currentCoupon = null
    },
    clearMessages: (state) => {
      state.isError = false
      state.isSuccess = false
      state.message = ''
      state.error = initialState.error
    },
    clearError: (state) => {
      state.isError = false
      state.error = initialState.error
    },
    setFilters: (state, action) => {
      state.lastFilters = action.payload
    },
    clearValidationResult: (state) => {
      state.validationResult = null
    },
    clearBulkResult: (state) => {
      state.bulkResult = null
    }
  },
  extraReducers: (builder) => {
    builder
      // ---------- GET ALL ----------
      .addCase(getAllCoupons.pending, (state) => {
        state.isLoading = true
        state.isError = false
        state.error = initialState.error
        state.message = ''
      })
      .addCase(getAllCoupons.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.coupons = action.payload?.items || []
        state.pagination = action.payload?.pagination || initialState.pagination
      })
      .addCase(getAllCoupons.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al cargar cupones' }
        state.message = action.payload?.message || 'Error al cargar cupones'
      })

      // ---------- CREATE ----------
      .addCase(createCoupon.pending, (state) => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
        state.error = initialState.error
        state.createdCoupon = null
      })
      .addCase(createCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.createdCoupon = action.payload
        if (action.payload) {
          const createdId = getCouponId(action.payload)
          const exists = state.coupons.some(c => getCouponId(c) === createdId)

          if (!exists) {
            state.coupons.unshift(action.payload)
            state.pagination.total += 1
          }
        }
      })
      .addCase(createCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al crear cupón' }
        state.message = action.payload?.message || 'Error al crear cupón'
      })

      // ---------- PERMANENT DELETE ----------
      .addCase(permanentDeleteCoupon.pending, (state) => {
        state.isLoading = true
      })
      .addCase(permanentDeleteCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        // Eliminar de ambas listas (activos y eliminados)
        state.coupons = state.coupons.filter(c => 
          c.id !== action.payload.id && c._id !== action.payload.id
        )
        state.deletedCoupons = (state.deletedCoupons || []).filter(c => 
          c.id !== action.payload.id && c._id !== action.payload.id
        )
        state.pagination.total = Math.max(0, state.pagination.total - 1)
        state.message = 'Cupón eliminado permanentemente'
      })
      .addCase(permanentDeleteCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload
        state.message = action.payload?.message || 'Error al eliminar permanentemente'
      })

      // ---------- RESTORE ----------
      .addCase(restoreCoupon.pending, (state) => {
        state.isLoading = true
      })
      .addCase(restoreCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        // Mover de eliminados a activos
        state.deletedCoupons = state.deletedCoupons.filter(c => c.id !== action.payload.data.id);
          // Lo añadimos o actualizamos en la lista principal
          const index = state.coupons.findIndex(c => c.id === action.payload.data.id);
          if (index !== -1) {
            state.coupons[index] = action.payload.data;
          } else {
            state.coupons.unshift(action.payload.data);
          }
        })
      .addCase(restoreCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload
        state.message = action.payload?.message || 'Error al restaurar'
      })

      // ---------- GET DELETED ----------
      .addCase(getDeletedCoupons.pending, (state) => {
        state.isLoadingDeleted = true
      })
      .addCase(getDeletedCoupons.fulfilled, (state, action) => {
        state.isLoadingDeleted = false
        state.deletedCoupons = action.payload?.items || []
        state.deletedPagination = action.payload?.pagination
      })
      .addCase(getDeletedCoupons.rejected, (state, action) => {
        state.isLoadingDeleted = false
        state.error = action.payload
      })

      // ---------- DELETE ----------
      .addCase(deleteCoupon.pending, (state) => {
        state.isLoading = true
      })
      .addCase(deleteCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.deletedCouponId = action.payload
        state.coupons = state.coupons.filter(c => c.id !== action.payload && c._id !== action.payload)
        state.pagination.total = Math.max(0, state.pagination.total - 1)
      })
      .addCase(deleteCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al eliminar cupón' }
        state.message = action.payload?.message || 'Error al eliminar cupón'
      })

      // ---------- GET BY ID ----------
      .addCase(getCouponById.pending, (state) => {
        state.isLoading = true
        state.currentCoupon = null
      })
      .addCase(getCouponById.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.currentCoupon = action.payload
      })
      .addCase(getCouponById.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al cargar cupón' }
        state.message = action.payload?.message || 'Error al cargar cupón'
      })

      // ---------- UPDATE ----------
      .addCase(updateCoupon.pending, (state) => {
        state.isLoading = true
      })
      .addCase(updateCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.updatedCoupon = action.payload
        const updatedId = getCouponId(action.payload)
        const index = state.coupons.findIndex(c => getCouponId(c) === updatedId)

        if (index !== -1) {
          state.coupons[index] = action.payload
        } else if (action.payload) {
          state.coupons.unshift(action.payload)
        }

        if (getCouponId(state.currentCoupon) === updatedId) {
          state.currentCoupon = action.payload
        }
      })
      .addCase(updateCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al actualizar cupón' }
        state.message = action.payload?.message || 'Error al actualizar cupón'
      })

      // ---------- CLONE ----------
      .addCase(cloneCoupon.pending, (state) => {
        state.isLoading = true
      })
      .addCase(cloneCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.clonedCoupon = action.payload
        if (action.payload) {
          state.coupons.unshift(action.payload)
          state.pagination.total += 1
        }
      })
      .addCase(cloneCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al clonar cupón' }
        state.message = action.payload?.message || 'Error al clonar cupón'
      })

      // ---------- GENERATE BULK ----------
      .addCase(generateBulkCoupons.pending, (state) => {
        state.isLoading = true
      })
      .addCase(generateBulkCoupons.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.bulkResult = action.payload
        if (action.payload?.coupons?.length > 0) {
          state.coupons.unshift(...action.payload.coupons)
          state.pagination.total += action.payload.created || 0
        }
      })
      .addCase(generateBulkCoupons.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al generar cupones' }
        state.message = action.payload?.message || 'Error al generar cupones'
      })

      // ---------- VALIDATE ----------
      .addCase(validateCoupon.pending, (state) => {
        state.validationResult = null
      })
      .addCase(validateCoupon.fulfilled, (state, action) => {
        state.validationResult = action.payload
      })
      .addCase(validateCoupon.rejected, (state, action) => {
        state.validationResult = { 
          valid: false, 
          message: action.payload?.message || 'Cupón inválido',
          error: action.payload
        }
      })

      // ---------- ASSIGN PRODUCTS ----------
      .addCase(assignProductsToCoupon.pending, (state) => {
        state.isLoading = true
      })
      .addCase(assignProductsToCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.assignmentResult = action.payload
        // Actualizar en lista si existe
        const index = state.coupons.findIndex(c => 
          c.id === action.payload?.id || c._id === action.payload?._id
        )
        if (index !== -1) {
          state.coupons[index] = action.payload
        }
        if (state.currentCoupon?.id === action.payload?.id || 
            state.currentCoupon?._id === action.payload?._id) {
          state.currentCoupon = action.payload
        }
      })
      .addCase(assignProductsToCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.error = action.payload || { message: 'Error al asignar productos' }
        state.message = action.payload?.message || 'Error al asignar productos'
      })

      // ---------- GET STATS ----------
      .addCase(getCouponStats.pending, (state) => {
        // No bloquear UI
      })
      .addCase(getCouponStats.fulfilled, (state, action) => {
        state.stats[action.payload.id] = action.payload.stats
      })
      .addCase(getCouponStats.rejected, (state, action) => {
        state.stats[action.payload?.id] = { error: action.payload?.message }
      })

      // ---------- RESET ----------
      .addCase(resetCouponState, () => initialState)
  }
})

// Exportar actions síncronos
export const { 
  clearCurrentCoupon, 
  clearMessages, 
  clearError,
  setFilters,
  clearValidationResult,
  clearBulkResult
} = couponSlice.actions

// Exportar selectors útiles
export const selectCouponError = (state) => state.coupon.error
export const selectIsDuplicateError = (state) => 
  state.coupon.error?.code === 'DUPLICATE_CODE'
export const selectErrorField = (state) => state.coupon.error?.field

export default couponSlice.reducer
