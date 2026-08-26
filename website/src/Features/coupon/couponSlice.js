import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import couponPublicApi from '../../services/couponApi.public'

// Único thunk realmente usado por el storefront (CheckoutPage.js) — el resto
// (createCoupon/getAllCoupons/getCouponById/updateCoupon/deleteCoupon/
// getCouponDetails) llamaba a couponService.js, que a su vez nunca se
// dispatchea desde ningún componente: son operaciones de administración de
// cupones que no tienen motivo para estar en el bundle público, y
// createCoupon en particular apuntaba a un método que couponService.js ni
// siquiera exportaba (TypeError si alguna vez se hubiera dispatchado). Se
// eliminan junto con couponService.js.
export const applyCoupon = createAsyncThunk(
  'coupon/apply',
  async (couponData, thunkAPI) => {
    try {
      const result = await couponPublicApi.validate(couponData.code, {
        items: couponData.items,
        subtotal: couponData.subtotal,
        userId: couponData.userId,
      })

      if (!result) {
        throw new Error('No se recibió respuesta del servidor')
      }

      if (result.valid === false || result.success === false) {
        return thunkAPI.rejectWithValue(result.message || 'Cupón no válido')
      }

      return result
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error.response?.data?.message ||
          error.message ||
          'Error al aplicar cupón',
      )
    }
  },
)

export const resetCouponState = createAction('coupon/reset-state')

const initialState = {
  appliedCoupon: null,
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
