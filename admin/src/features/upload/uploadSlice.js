// 📁 src/features/upload/uploadSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import uploadService from './uploadService'

export const uploadProductImage = createAsyncThunk('upload/images', async (files, thunkAPI) => {
  try {
    const response = await uploadService.uploadProductImage(files)
    return response // array de imágenes { url, public_id }
  } catch (error) {
    return thunkAPI.rejectWithValue(error?.message || 'Error subiendo imagen')
  }
})

export const delImg = createAsyncThunk('upload/deleteImg', async (public_id, thunkAPI) => {
  try {
    await uploadService.deleteImg(public_id)
    return public_id
  } catch (error) {
    return thunkAPI.rejectWithValue(error?.message || 'Error eliminando imagen')
  }
})

const initialState = {
  images: [],
  isLoading: false,
  isSuccess: false,
  isError: false,
  message: '',
}

const uploadSlice = createSlice({
  name: 'upload',
  initialState,
  reducers: {
    resetUploadState: state => Object.assign(state, initialState),
  },
  extraReducers: builder => {
    builder
      .addCase(uploadProductImage.pending, state => {
        state.isLoading = true
      })
      .addCase(uploadProductImage.fulfilled, (state, action) => {
        state.images = [...state.images, ...action.payload]
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
      })
      .addCase(uploadProductImage.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })
      .addCase(delImg.pending, state => {
        state.isLoading = true
      })
      .addCase(delImg.fulfilled, (state, action) => {
        state.images = state.images.filter(img => img.public_id !== action.payload)
        state.isLoading = false
        state.isSuccess = true
      })
      .addCase(delImg.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })
  },
})

export const { resetUploadState } = uploadSlice.actions
export default uploadSlice.reducer
