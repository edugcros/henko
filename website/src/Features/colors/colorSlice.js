import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import colorService from './colorService'

// Thunks
export const createColor = createAsyncThunk('color/create', async (colorData, thunkAPI) => {
  try {
    return await colorService.createColor(colorData)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getColors = createAsyncThunk('color/getAll', async (_, thunkAPI) => {
  try {
    return await colorService.getColors()
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getColor = createAsyncThunk('color/get', async (id, thunkAPI) => {
  try {
    return await colorService.getColor(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const updateColor = createAsyncThunk('color/update', async ({ id, colorData }, thunkAPI) => {
  try {
    return await colorService.updateColor(id, colorData)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const deleteColor = createAsyncThunk('color/delete', async (id, thunkAPI) => {
  try {
    return await colorService.deleteColor(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const resetColorState = createAction('color/reset-state')

const initialState = {
  colors: [],
  color: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
}

const colorSlice = createSlice({
  name: 'color',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(createColor.pending, state => {
        state.isLoading = true
      })
      .addCase(createColor.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.colors.push(action.payload)
      })
      .addCase(createColor.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(getColors.pending, state => {
        state.isLoading = true
      })
      .addCase(getColors.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.colors = action.payload
      })
      .addCase(getColors.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(getColor.pending, state => {
        state.isLoading = true
      })
      .addCase(getColor.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.color = action.payload
      })
      .addCase(getColor.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(updateColor.pending, state => {
        state.isLoading = true
      })
      .addCase(updateColor.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        const index = state.colors.findIndex(color => color._id === action.payload._id)
        if (index !== -1) {
          state.colors[index] = action.payload
        }
      })
      .addCase(updateColor.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(deleteColor.pending, state => {
        state.isLoading = true
      })
      .addCase(deleteColor.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.colors = state.colors.filter(color => color._id !== action.payload._id)
      })
      .addCase(deleteColor.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(resetColorState, () => initialState)
  },
})

export default colorSlice.reducer
