import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import enquiryService from './enquiryService'

// Thunks
export const createEnquiry = createAsyncThunk('enquiry/create', async (enquiryData, thunkAPI) => {
  try {
    const response = await enquiryService.createEnquiry(enquiryData)
    // Si el backend responde { success: false, message: "..." } con status 200
    if (response.success === false) {
      return thunkAPI.rejectWithValue(response)
    }
    return response
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getEnquiries = createAsyncThunk('enquiry/getAll', async (_, thunkAPI) => {
  try {
    return await enquiryService.getEnquiries()
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getEnquiry = createAsyncThunk('enquiry/get', async (id, thunkAPI) => {
  try {
    return await enquiryService.getEnquiry(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const updateEnquiryStatus = createAsyncThunk(
  'enquiry/update-status',
  async ({ id, status }, thunkAPI) => {
    try {
      // Ajustado para enviar el objeto correcto al servicio
      return await enquiryService.updateEnquiry(id, { status })
    } catch (error) {
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const deleteEnquiry = createAsyncThunk('enquiry/delete', async (id, thunkAPI) => {
  try {
    const response = await enquiryService.deleteEnquiry(id)
    // Devolvemos el ID para poder filtrar el estado localmente
    return { id, ...response }
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const resetEnquiryState = createAction('enquiry/reset-state')

const initialState = {
  enquiries: [],
  enquiry: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
}

const enquirySlice = createSlice({
  name: 'enquiry',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      /* --- CREATE --- */
      .addCase(createEnquiry.pending, state => {
        state.isLoading = true
      })
      .addCase(createEnquiry.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        // Extraemos 'data' porque el backend devuelve { success: true, data: {...} }
        const newEnq = action.payload.data || action.payload
        state.enquiries.push(newEnq)
      })
      .addCase(createEnquiry.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      /* --- GET ALL --- */
      .addCase(getEnquiries.pending, state => {
        state.isLoading = true
      })
      .addCase(getEnquiries.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        // RELEVANTE: Tu backend envía las consultas dentro de action.payload.data
        state.enquiries = action.payload.data || action.payload
      })
      .addCase(getEnquiries.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      /* --- UPDATE --- */
      .addCase(updateEnquiryStatus.pending, state => {
        state.isLoading = true
      })
      .addCase(updateEnquiryStatus.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        const updatedEnq = action.payload.data || action.payload
        const index = state.enquiries.findIndex(el => el._id === updatedEnq._id)
        if (index !== -1) {
          state.enquiries[index] = updatedEnq
        }
      })

      /* --- DELETE --- */
      .addCase(deleteEnquiry.pending, state => {
        state.isLoading = true
      })
      .addCase(deleteEnquiry.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        // Filtramos usando el ID que inyectamos en el thunk
        state.enquiries = state.enquiries.filter(el => el._id !== action.payload.id)
      })

      .addCase(resetEnquiryState, () => initialState)
  },
})

export default enquirySlice.reducer
