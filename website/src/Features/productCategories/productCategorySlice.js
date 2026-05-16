import { createSlice, createAsyncThunk, createAction } from '@reduxjs/toolkit'
import prodCategoryService from './prodCategoryService'

// Thunks
export const getAllCategories = createAsyncThunk('prodCategory/get-all', async (_, thunkAPI) => {
  try {
    return await prodCategoryService.getAllCategories()
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const getCategory = createAsyncThunk('prodCategory/get-single', async (id, thunkAPI) => {
  try {
    return await prodCategoryService.getCategory(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const createCategory = createAsyncThunk(
  'prodCategory/create',
  async (categoryData, thunkAPI) => {
    try {
      return await prodCategoryService.createCategory(categoryData)
    } catch (error) {
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const updateCategory = createAsyncThunk(
  'prodCategory/update',
  async ({ id, categoryData }, thunkAPI) => {
    try {
      return await prodCategoryService.updateCategory(id, categoryData)
    } catch (error) {
      return thunkAPI.rejectWithValue(error.response?.data || error.message)
    }
  },
)

export const deleteCategory = createAsyncThunk('prodCategory/delete', async (id, thunkAPI) => {
  try {
    return await prodCategoryService.deleteCategory(id)
  } catch (error) {
    return thunkAPI.rejectWithValue(error.response?.data || error.message)
  }
})

export const resetCategoryState = createAction('prodCategory/reset-state')

const initialState = {
  categories: [],
  singleCategory: {},
  createdCategory: null,
  updatedCategory: null,
  deletedCategory: null,
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
}

const prodCategorySlice = createSlice({
  name: 'prodCategory',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(getAllCategories.pending, state => {
        state.isLoading = true
      })
      .addCase(getAllCategories.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.categories = action.payload
      })
      .addCase(getAllCategories.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(getCategory.pending, state => {
        state.isLoading = true
      })
      .addCase(getCategory.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.singleCategory = action.payload
      })
      .addCase(getCategory.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(createCategory.pending, state => {
        state.isLoading = true
      })
      .addCase(createCategory.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.createdCategory = action.payload
      })
      .addCase(createCategory.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(updateCategory.pending, state => {
        state.isLoading = true
      })
      .addCase(updateCategory.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.updatedCategory = action.payload
      })
      .addCase(updateCategory.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(deleteCategory.pending, state => {
        state.isLoading = true
      })
      .addCase(deleteCategory.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.deletedCategory = action.payload
      })
      .addCase(deleteCategory.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.message = action.payload
      })

      .addCase(resetCategoryState, () => initialState)
  },
})

export default prodCategorySlice.reducer
