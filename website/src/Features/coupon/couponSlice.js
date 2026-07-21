import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import couponService from './couponService'
import couponPublicApi from '../../services/couponApi.public'

// Thunks
export const createCoupon = createAsyncThunk('coupon/create', async (couponData, thunkAPI) => {
  try {
    return await couponService.createCoupon(couponData)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getAllCoupons = createAsyncThunk('coupon/get-all', async (_, thunkAPI) => {
  try {
    return await couponService.getAllCoupons()
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getCouponById = createAsyncThunk('coupon/get-single', async (id, thunkAPI) => {
  try {
    return await couponService.getCouponById(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const updateCoupon = createAsyncThunk(
  'coupon/update',
  async ({ id, couponData }, thunkAPI) => {
    try {
      return await couponService.updateCoupon(id, couponData)
    } catch (error) {
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const deleteCoupon = createAsyncThunk('coupon/delete', async (id, thunkAPI) => {
  try {
    return await couponService.deleteCoupon(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

// ✅ CORREGIDO: Usar couponPublicApi.validate en lugar de applyCoupon recursivo
export const applyCoupon = createAsyncThunk('coupon/apply', async (couponData, thunkAPI) => {
  try {
    console.log('🎯 [Thunk] Aplicando cupón:', couponData)

    // ✅ LLAMAR AL MÉTODO CORRECTO DE LA API
    const result = await couponPublicApi.validate(couponData.code, {
      items: couponData.items,
      subtotal: couponData.subtotal,
      userId: couponData.userId,
    })

    console.log('✅ [Thunk] Respuesta API:', result)

    // Validar que tenemos una respuesta válida
    if (!result) {
      throw new Error('No se recibió respuesta del servidor')
    }

    // Si la respuesta indica que no es válido
    if (result.valid === false || result.success === false) {
      return thunkAPI.rejectWithValue(result.message || 'Cupón no válido')
    }

    return result
  } catch (error) {
    console.error('❌ [Thunk] Error:', error)
    return thunkAPI.rejectWithValue(
      error.response?.data?.message || error.message || 'Error al aplicar cupón',
    )
  }
})

export const getCouponDetails = createAsyncThunk('coupon/get-details', async (id, thunkAPI) => {
  try {
    return await couponService.getCouponDetails(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const resetCouponState = createAction('coupon/reset-state')

const initialState = {
  coupons: [],
  singleCoupon: {},
  couponDetails: {},
  appliedCoupon: null,
  createdCoupon: null,
  updatedCoupon: null,
  deletedCoupon: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
}

const couponSlice = createSlice({
  name: 'coupon',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(createCoupon.pending, state => {
        state.isLoading = true
      })
      .addCase(createCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.createdCoupon = action.payload
      })
      .addCase(createCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(getAllCoupons.pending, state => {
        state.isLoading = true
      })
      .addCase(getAllCoupons.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.coupons = action.payload
      })
      .addCase(getAllCoupons.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(getCouponById.pending, state => {
        state.isLoading = true
      })
      .addCase(getCouponById.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.singleCoupon = action.payload
      })
      .addCase(getCouponById.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(getCouponDetails.pending, state => {
        state.isLoading = true
      })
      .addCase(getCouponDetails.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.couponDetails = action.payload
      })
      .addCase(getCouponDetails.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(updateCoupon.pending, state => {
        state.isLoading = true
      })
      .addCase(updateCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.updatedCoupon = action.payload
      })
      .addCase(updateCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(deleteCoupon.pending, state => {
        state.isLoading = true
      })
      .addCase(deleteCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.deletedCoupon = action.payload
      })
      .addCase(deleteCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(applyCoupon.pending, state => {
        state.isLoading = true
      })
      .addCase(applyCoupon.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        // ✅ Guardar el cupón de la respuesta (puede venir en action.payload.coupon o action.payload)
        state.appliedCoupon = action.payload.coupon || action.payload
        state.message = action.payload.message || 'Cupón aplicado correctamente'
      })
      .addCase(applyCoupon.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(resetCouponState, () => initialState)
  },
})

export default couponSlice.reducer
