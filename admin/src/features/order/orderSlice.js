// 📁 src/features/order/orderSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import orderService from './orderService'

const getErrorMessage = (payload, fallback) => {
  if (typeof payload === 'string') return payload
  if (payload?.message && typeof payload.message === 'string')
    return payload.message
  return fallback
}

const replaceOrderInList = (state, updatedOrder) => {
  if (!updatedOrder || !Array.isArray(state.list?.data?.data)) return

  state.list.data.data = state.list.data.data.map(order =>
    order._id === updatedOrder._id ? updatedOrder : order,
  )
}

const removeOrderFromList = (state, orderId) => {
  if (!orderId || !Array.isArray(state.list?.data?.data)) return

  const beforeLength = state.list.data.data.length

  state.list.data.data = state.list.data.data.filter(
    order => order._id !== orderId,
  )

  const wasRemoved = beforeLength !== state.list.data.data.length

  if (wasRemoved && state.list?.data?.pagination?.total > 0) {
    state.list.data.pagination.total -= 1
  }

  if (
    wasRemoved &&
    state.list?.data?.pagination?.pages > 1 &&
    state.list.data.data.length === 0 &&
    state.list.data.pagination.page > 1
  ) {
    state.list.data.pagination.page -= 1
  }
}

export const getOrdersThunk = createAsyncThunk(
  'order/getOrders',
  async (params, thunkAPI) => {
    try {
      const response = await orderService.getOrders(params)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error cargando órdenes',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.message || 'Error inesperado cargando órdenes',
      )
    }
  },
)

export const createOrderThunk = createAsyncThunk(
  'order/createOrder',
  async (orderData, thunkAPI) => {
    try {
      const response = await orderService.createOrder(orderData)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error creando orden',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error creando orden',
      )
    }
  },
)

export const updateOrderStatusThunk = createAsyncThunk(
  'order/updateStatus',
  async (payload, thunkAPI) => {
    try {
      const response = await orderService.updateOrderStatus(payload)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error actualizando orden',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error actualizando orden',
      )
    }
  },
)

export const updateOrderPaymentStatusThunk = createAsyncThunk(
  'order/updatePaymentStatus',
  async (payload, thunkAPI) => {
    try {
      const response = await orderService.updateOrderPaymentStatus(payload)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error actualizando pago',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error actualizando pago',
      )
    }
  },
)

export const updateOrderFulfillmentStatusThunk = createAsyncThunk(
  'order/updateFulfillmentStatus',
  async (payload, thunkAPI) => {
    try {
      const response = await orderService.updateOrderFulfillmentStatus(payload)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error actualizando estado logístico',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error actualizando estado logístico',
      )
    }
  },
)

export const cancelOrderThunk = createAsyncThunk(
  'order/cancelOrder',
  async (payload, thunkAPI) => {
    try {
      const response = await orderService.cancelOrder(payload)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error cancelando orden',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error cancelando orden',
      )
    }
  },
)

export const refundOrderThunk = createAsyncThunk(
  'order/refundOrder',
  async (payload, thunkAPI) => {
    try {
      const response = await orderService.refundOrder(payload)

      if (!response?.success) {
        return thunkAPI.rejectWithValue(
          response?.message || 'Error reembolsando orden',
        )
      }

      return response
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error reembolsando orden',
      )
    }
  },
)

export const deleteOrderThunk = createAsyncThunk(
  'order/deleteOrder',
  async (payload, thunkAPI) => {
    try {
      const response = await orderService.deleteOrder(payload)

      if (!response?.success) {
        return thunkAPI.rejectWithValue({
          message: response?.message || 'Error eliminando orden',
          code: response?.code || null,
          status: response?.status || null,
          data: response?.data || null,
          originalPayload: payload,
        })
      }

      return {
        ...response,
        deletedId: payload?.id,
      }
    } catch (error) {
      return thunkAPI.rejectWithValue({
        message:
          error?.response?.data?.message ||
          error?.message ||
          'Error eliminando orden',
        code: error?.response?.data?.code || null,
        status: error?.response?.status || null,
        data: error?.response?.data?.data || null,
        originalPayload: payload,
      })
    }
  },
)

const initialState = {
  list: {
    data: {
      data: [],
      pagination: {
        total: 0,
        page: 1,
        pages: 1,
        limit: 10,
      },
      meta: {},
    },
    isLoading: false,
    isError: false,
    message: null,
  },
  created: {
    data: null,
    isLoading: false,
    isError: false,
    message: null,
  },
  updated: {
    data: null,
    isLoading: false,
    isError: false,
    message: null,
  },
  deleted: {
    data: null,
    isLoading: false,
    isError: false,
    message: null,
    id: null,
  },
  isLoading: false,
  isError: false,
  message: null,
  isUpdating: false,
}

const setPendingUpdate = state => {
  state.updated.isLoading = true
  state.updated.isError = false
  state.updated.message = null

  state.isUpdating = true
  state.isError = false
  state.message = null
}

const setFulfilledUpdate = (state, action) => {
  state.updated.isLoading = false
  state.updated.isError = false
  state.updated.message = null
  state.updated.data = action.payload?.data || null

  state.isUpdating = false
  state.isError = false
  state.message = action.payload?.message || null

  replaceOrderInList(state, action.payload?.data)
}

const setRejectedUpdate = (state, action, fallback) => {
  const errorMessage = getErrorMessage(action.payload, fallback)

  state.updated.isLoading = false
  state.updated.isError = true
  state.updated.message = errorMessage

  state.isUpdating = false
  state.isError = true
  state.message = errorMessage
}

const setPendingDelete = state => {
  state.deleted.isLoading = true
  state.deleted.isError = false
  state.deleted.message = null
  state.deleted.data = null
  state.deleted.id = null

  state.isUpdating = true
  state.isError = false
  state.message = null
}

const setFulfilledDelete = (state, action) => {
  const deletedId =
    action.payload?.deletedId ||
    action.payload?.data?.data?.id ||
    action.payload?.data?.id ||
    action.meta?.arg?.id

  state.deleted.isLoading = false
  state.deleted.isError = false
  state.deleted.message =
    action.payload?.message ||
    action.payload?.data?.message ||
    'Orden eliminada correctamente'
  state.deleted.data = action.payload?.data || null
  state.deleted.id = deletedId || null

  state.isUpdating = false
  state.isError = false
  state.message = state.deleted.message

  removeOrderFromList(state, deletedId)
}

const setRejectedDelete = (state, action) => {
  const errorMessage = getErrorMessage(action.payload, 'Error eliminando orden')

  state.deleted.isLoading = false
  state.deleted.isError = true
  state.deleted.message = errorMessage

  state.isUpdating = false
  state.isError = true
  state.message = errorMessage
}

const orderSlice = createSlice({
  name: 'order',
  initialState,
  reducers: {
    clearOrders: state => {
      state.list = initialState.list
      state.isLoading = false
      state.isError = false
      state.message = null
    },

    resetOrderState: () => initialState,

    clearOrderMessages: state => {
      state.list.message = null
      state.created.message = null
      state.updated.message = null
      state.deleted.message = null
      state.message = null

      state.list.isError = false
      state.created.isError = false
      state.updated.isError = false
      state.deleted.isError = false
      state.isError = false
    },

    clearDeletedOrderState: state => {
      state.deleted = initialState.deleted
    },
  },
  extraReducers: builder => {
    builder
      .addCase(getOrdersThunk.pending, state => {
        state.list.isLoading = true
        state.list.isError = false
        state.list.message = null

        state.isLoading = true
        state.isError = false
        state.message = null
      })
      .addCase(getOrdersThunk.fulfilled, (state, action) => {
        state.list.isLoading = false
        state.list.isError = false
        state.list.message = null

        state.isLoading = false
        state.isError = false
        state.message = null

        const payload = action.payload?.data || {}
        const orders = Array.isArray(payload?.data) ? payload.data : []
        const pagination = payload?.pagination || {
          total: 0,
          page: 1,
          pages: 1,
          limit: 10,
        }
        const meta = payload?.meta || {}

        state.list.data = {
          data: orders,
          pagination,
          meta,
        }
      })
      .addCase(getOrdersThunk.rejected, (state, action) => {
        const errorMessage = getErrorMessage(
          action.payload,
          'Error cargando órdenes',
        )

        state.list.isLoading = false
        state.list.isError = true
        state.list.message = errorMessage
        state.list.data = {
          data: [],
          pagination: {
            total: 0,
            page: 1,
            pages: 1,
            limit: 10,
          },
          meta: {},
        }

        state.isLoading = false
        state.isError = true
        state.message = errorMessage
      })

      .addCase(createOrderThunk.pending, state => {
        state.created.isLoading = true
        state.created.isError = false
        state.created.message = null

        state.isLoading = true
        state.isError = false
        state.message = null
      })
      .addCase(createOrderThunk.fulfilled, (state, action) => {
        state.created.isLoading = false
        state.created.isError = false
        state.created.message = null
        state.created.data = action.payload?.data || null

        state.isLoading = false
        state.isError = false
        state.message = action.payload?.message || null
      })
      .addCase(createOrderThunk.rejected, (state, action) => {
        const errorMessage = getErrorMessage(
          action.payload,
          'Error creando orden',
        )

        state.created.isLoading = false
        state.created.isError = true
        state.created.message = errorMessage

        state.isLoading = false
        state.isError = true
        state.message = errorMessage
      })

      .addCase(updateOrderStatusThunk.pending, setPendingUpdate)
      .addCase(updateOrderStatusThunk.fulfilled, setFulfilledUpdate)
      .addCase(updateOrderStatusThunk.rejected, (state, action) =>
        setRejectedUpdate(
          state,
          action,
          'Error actualizando estado de la orden',
        ),
      )

      .addCase(updateOrderPaymentStatusThunk.pending, setPendingUpdate)
      .addCase(updateOrderPaymentStatusThunk.fulfilled, setFulfilledUpdate)
      .addCase(updateOrderPaymentStatusThunk.rejected, (state, action) =>
        setRejectedUpdate(state, action, 'Error actualizando estado de pago'),
      )

      .addCase(updateOrderFulfillmentStatusThunk.pending, setPendingUpdate)
      .addCase(updateOrderFulfillmentStatusThunk.fulfilled, setFulfilledUpdate)
      .addCase(updateOrderFulfillmentStatusThunk.rejected, (state, action) =>
        setRejectedUpdate(state, action, 'Error actualizando estado logístico'),
      )

      .addCase(cancelOrderThunk.pending, setPendingUpdate)
      .addCase(cancelOrderThunk.fulfilled, setFulfilledUpdate)
      .addCase(cancelOrderThunk.rejected, (state, action) =>
        setRejectedUpdate(state, action, 'Error cancelando orden'),
      )

      .addCase(refundOrderThunk.pending, setPendingUpdate)
      .addCase(refundOrderThunk.fulfilled, setFulfilledUpdate)
      .addCase(refundOrderThunk.rejected, (state, action) =>
        setRejectedUpdate(state, action, 'Error reembolsando orden'),
      )

      .addCase(deleteOrderThunk.pending, setPendingDelete)
      .addCase(deleteOrderThunk.fulfilled, setFulfilledDelete)
      .addCase(deleteOrderThunk.rejected, setRejectedDelete)
  },
})

export const {
  clearOrders,
  resetOrderState,
  clearOrderMessages,
  clearDeletedOrderState,
} = orderSlice.actions

export default orderSlice.reducer
