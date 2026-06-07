import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import orderService from './orderService.js'

/**
 * =========================
 * THUNKS
 * =========================
 */

// Crear orden (PRE pago)
export const createOrder = createAsyncThunk('order/create', async (orderData, thunkAPI) => {
  try {
    const response = await orderService.createOrder(orderData)

    if (!response?.success) {
      return thunkAPI.rejectWithValue({
        message: response?.message || 'Error creando la orden',
        code: response?.code || null,
      })
    }

    return response
  } catch (error) {
    return thunkAPI.rejectWithValue({
      message: error.message || 'Error creando la orden',
    })
  }
})

// Obtener órdenes del usuario autenticado
export const getOrdersThunk = createAsyncThunk('order/getOrders', async (params, thunkAPI) => {
  try {
    const response = await orderService.getOrders(params)

    if (!response?.success) {
      return thunkAPI.rejectWithValue(response?.message || 'Error cargando órdenes')
    }

    return response
  } catch (error) {
    return thunkAPI.rejectWithValue(error.message)
  }
})

// Obtener una orden puntual (opcional)
export const getOrderById = createAsyncThunk('order/get-by-id', async (id, thunkAPI) => {
  try {
    const response = await orderService.getOrderById(id)

    if (!response?.success) {
      return thunkAPI.rejectWithValue({
        message: response?.message || 'Error obteniendo la orden',
        code: response?.code || null,
      })
    }

    return response
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || { message: error.message })
  }
})

// Reset manual del estado
export const resetOrderState = createAction('order/reset')

/**
 * =========================
 * INITIAL STATE
 * =========================
 */

const initialState = {
  orders: [],
  currentOrder: null, // orden creada en checkout
  selectedOrder: null, // orden vista/detalle
  isLoading: false,
  isSuccess: false,
  isError: false,
  message: '',
  list: {
    data: {
      data: [],
      pagination: {},
    },
    isLoading: false,
    isError: false,
    message: null,
  },
}

/**
 * =========================
 * SLICE
 * =========================
 */

const orderSlice = createSlice({
  name: 'order',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder

      /**
       * CREATE ORDER
       */
      .addCase(createOrder.pending, state => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
      })
      .addCase(createOrder.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.currentOrder = action.payload?.data || action.payload
      })
      .addCase(createOrder.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload?.message || 'Error creando la orden'
      })

      /**
       * GET USER ORDERS
       */
      .addCase(getOrdersThunk.pending, state => {
        state.list.isLoading = true
        state.list.isError = false
        state.list.message = null
      })
      .addCase(getOrdersThunk.fulfilled, (state, action) => {
        state.list.isLoading = false
        state.list.isError = false
        state.list.message = null

        const orders = action.payload?.data || []
        const pagination = action.payload?.pagination || {}

        state.list.data = {
          data: Array.isArray(orders) ? orders : [],
          pagination,
        }
      })
      .addCase(getOrdersThunk.rejected, (state, action) => {
        state.list.isLoading = false
        state.list.isError = true
        state.list.message = action.payload || 'Error cargando órdenes'
        state.list.data = { data: [], pagination: {} } // 🔴 LIMPIAR EN ERROR
      })

      /**
       * GET ORDER BY ID
       */
      .addCase(getOrderById.pending, state => {
        state.isLoading = true
      })
      .addCase(getOrderById.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.selectedOrder = action.payload?.data || null
      })
      .addCase(getOrderById.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload?.message || 'Error obteniendo la orden'
      })

      /**
       * RESET
       */
      .addCase(resetOrderState, () => initialState)
  },
})

export default orderSlice.reducer
