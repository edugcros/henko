// 📁 src/features/enquiry/enquirySlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import enquiryService from './enquiryService'

// 📌 Obtener todas las consultas
export const getEnquiries = createAsyncThunk(
  'enquiry/getAll',
  async (_, thunkAPI) => {
    try {
      const res = await enquiryService.getEnquiries()
      return res.data
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error.response?.data?.message || error.message,
      )
    }
  },
)

// 📌 CORREGIDO: Nombre de función coincide con service
export const updateEnquiryStatus = createAsyncThunk(
  'enquiry/updateStatus',
  async ({ id, status }, thunkAPI) => {
    try {
      // 🔴 AHORA SÍ EXISTE: enquiryService.updateEnquiryStatus
      const res = await enquiryService.updateEnquiry(id, status)
      return res.data
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error.response?.data?.message || error.message,
      )
    }
  },
)

// 📌 Responder consulta y enviar Email
export const sendReplyEnquiry = createAsyncThunk(
  'enquiry/sendReply',
  async ({ id, message }, thunkAPI) => {
    try {
      const res = await enquiryService.sendReply(id, message)
      return res.data
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error.response?.data?.message || error.message,
      )
    }
  },
)

// 📌 Eliminar consulta
export const deleteEnquiry = createAsyncThunk(
  'enquiry/delete',
  async (id, thunkAPI) => {
    try {
      const res = await enquiryService.deleteEnquiry(id)
      return { id, message: res.message }
    } catch (error) {
      return thunkAPI.rejectWithValue(
        error.response?.data?.message || error.message,
      )
    }
  },
)

const initialState = {
  enquiries: [],
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
}

export const enquirySlice = createSlice({
  name: 'enquiry',
  initialState,
  reducers: {
    resetEnquiryState: state => {
      state.isLoading = false
      state.isError = false
      state.isSuccess = false
      state.message = ''
    },
  },
  extraReducers: builder => {
    builder
      // GET
      .addCase(getEnquiries.pending, state => {
        state.isLoading = true
      })
      .addCase(getEnquiries.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.enquiries = action.payload
      })
      .addCase(getEnquiries.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      // UPDATE STATUS
      .addCase(updateEnquiryStatus.pending, state => {
        state.isLoading = true
      })
      .addCase(updateEnquiryStatus.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        const updated = action.payload
        state.enquiries = state.enquiries.map(e =>
          e._id === updated._id ? updated : e,
        )
      })
      .addCase(updateEnquiryStatus.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      // SEND REPLY
      .addCase(sendReplyEnquiry.pending, state => {
        state.isLoading = true
      })
      .addCase(sendReplyEnquiry.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        const updatedEnq = action.payload?.data || action.payload
        if (updatedEnq && updatedEnq._id) {
          state.enquiries = state.enquiries.map(enq =>
            enq._id === updatedEnq._id ? updatedEnq : enq,
          )
          state.message = 'Respuesta enviada con éxito'
        }
      })
      .addCase(sendReplyEnquiry.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      // DELETE
      .addCase(deleteEnquiry.pending, state => {
        state.isLoading = true
      })
      .addCase(deleteEnquiry.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.enquiries = state.enquiries.filter(
          e => e._id !== action.payload.id,
        )
        state.message = action.payload.message
      })
      .addCase(deleteEnquiry.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })
  },
})

export const { resetEnquiryState } = enquirySlice.actions
export default enquirySlice.reducer
