import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import contactService from './contactService'
import { toast } from 'react-toastify'

// Async Thunks
export const createQuery = createAsyncThunk(
  'contact/post',
  async (contactData, thunkAPI) => {
    try {
      const response = await contactService.postQuery(contactData)
      toast.success('Contact form submitted successfully')
      return response
    } catch (error) {
      toast.error('Failed to submit contact form')
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const fetchQueries = createAsyncThunk(
  'contact/fetchAll',
  async (_, thunkAPI) => {
    try {
      return await contactService.getQueries()
    } catch (error) {
      toast.error('Failed to load contact queries')
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const updateQueryStatus = createAsyncThunk(
  'contact/updateStatus',
  async ({ id, status }, thunkAPI) => {
    try {
      const response = await contactService.updateQueryStatus(id, status)
      toast.success('Query status updated successfully')
      return response
    } catch (error) {
      toast.error('Failed to update query status')
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const deleteQuery = createAsyncThunk(
  'contact/delete',
  async (id, thunkAPI) => {
    try {
      const response = await contactService.deleteQuery(id)
      toast.success('Query deleted successfully')
      return response
    } catch (error) {
      toast.error('Failed to delete query')
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

// Initial State
const initialState = {
  contacts: [],
  singleContact: {},
  isError: false,
  isLoading: false,
  isSuccess: false,
  message: '',
}

// Contact Slice
export const contactSlice = createSlice({
  name: 'contact',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      // Create Query
      .addCase(createQuery.pending, state => {
        state.isLoading = true
      })
      .addCase(createQuery.fulfilled, (state, action) => {
        state.isLoading = false
        state.isError = false
        state.isSuccess = true
        state.contacts.push(action.payload)
      })
      .addCase(createQuery.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      // Fetch All Queries
      .addCase(fetchQueries.pending, state => {
        state.isLoading = true
      })
      .addCase(fetchQueries.fulfilled, (state, action) => {
        state.isLoading = false
        state.contacts = action.payload
      })
      .addCase(fetchQueries.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      // Update Query Status
      .addCase(updateQueryStatus.fulfilled, (state, action) => {
        state.contacts = state.contacts.map(contact =>
          contact._id === action.payload._id ? action.payload : contact,
        )
      })
      .addCase(updateQueryStatus.rejected, (state, action) => {
        state.isError = true
        state.message = action.payload
      })

      // Delete Query
      .addCase(deleteQuery.fulfilled, (state, action) => {
        state.contacts = state.contacts.filter(
          contact => contact._id !== action.payload._id,
        )
      })
      .addCase(deleteQuery.rejected, (state, action) => {
        state.isError = true
        state.message = action.payload
      })
  },
})

export default contactSlice.reducer
