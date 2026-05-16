import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import customerService from './customerService'
import { toast } from 'react-toastify'

const initialState = {
  customers: [],
  isLoading: false,
  error: null,
}

// =====================
// THUNKS
// =====================

export const getUsers = createAsyncThunk(
  'customers/getAll',
  async (params, thunkAPI) => {
    try {
      return await customerService.getAllUsers(params, {
        signal: thunkAPI.signal,
      })
    } catch (err) {
      return thunkAPI.rejectWithValue(err.message)
    }
  }
)

export const removeUser = createAsyncThunk(
  'customers/remove',
  async (id, thunkAPI) => {
    try {
      await customerService.deleteUser(id)
      return id
    } catch (err) {
      return thunkAPI.rejectWithValue(err.message)
    }
  }
)

export const toggleBlockUser = createAsyncThunk(
  'customers/toggleBlock',
  async ({ id, block }, thunkAPI) => {
    try {
      return block
        ? await customerService.blockUser(id)
        : await customerService.unblockUser(id)
    } catch (err) {
      return thunkAPI.rejectWithValue(err.message)
    }
  }
)

// =====================
// SLICE
// =====================

const customersSlice = createSlice({
  name: 'customers',
  initialState,
  reducers: {
    clearCustomerError: state => {
      state.error = null
    },
  },
  extraReducers: builder => {
    builder

      // ---------- GET USERS ----------
      .addCase(getUsers.pending, state => {
        state.isLoading = true
        state.error = null
      })
      .addCase(getUsers.fulfilled, (state, action) => {
        state.isLoading = false
        state.customers = Array.isArray(action.payload)
          ? action.payload
          : []
      })
      .addCase(getUsers.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload
      })

      // ---------- REMOVE USER ----------
      .addCase(removeUser.pending, state => {
        state.isLoading = true
      })
      .addCase(removeUser.fulfilled, (state, action) => {
        state.isLoading = false
        state.customers = state.customers.filter(
          u => u._id !== action.payload,
        )
      })
      .addCase(removeUser.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload
      })

      // ---------- TOGGLE BLOCK ----------
      .addCase(toggleBlockUser.pending, state => {
        state.isLoading = true
      })
      .addCase(toggleBlockUser.fulfilled, (state, action) => {
        state.isLoading = false
        const updated = action.payload

        if (!updated?._id) return

        const index = state.customers.findIndex(
          u => u._id === updated._id,
        )

        if (index !== -1) {
          state.customers[index] = updated
        }
      })
      .addCase(toggleBlockUser.rejected, (state, action) => {
        state.isLoading = false
        state.error = action.payload
      })
  },
})

export const { clearCustomerError } = customersSlice.actions
export default customersSlice.reducer
