// 📁 src/features/promotionalBlocks/promotionalBlocksSlice.js
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import promotionalBlocksService from './promotionalBlocksService'

const getErrorMessage = (error, fallback = 'Ocurrió un error inesperado') => {
  if (typeof error === 'string') return error
  if (error?.message) return error.message
  return fallback
}

const normalizePublicListResponse = payload => {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.blocks)) return payload.blocks
  return []
}

const normalizeEntityResponse = payload => {
  return payload?.data || payload?.block || payload
}

const upsertBlock = (blocks, block) => {
  if (!block?._id) return blocks

  const index = blocks.findIndex(item => item._id === block._id)

  if (index === -1) {
    return [block, ...blocks]
  }

  const next = [...blocks]
  next[index] = block
  return next
}

export const fetchPublicPromotionalBlocks = createAsyncThunk(
  'promotionalBlocks/fetchPublic',
  async (params = { placement: 'home' }, { rejectWithValue }) => {
    try {
      const response = await promotionalBlocksService.getPublicPromotionalBlocks(params)
      return normalizePublicListResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al cargar bloques promocionales públicos'),
      )
    }
  },
)

export const fetchPublicPromotionalBlockBySlug = createAsyncThunk(
  'promotionalBlocks/fetchPublicBySlug',
  async (slug, { rejectWithValue }) => {
    try {
      if (!slug) {
        return rejectWithValue('Slug del bloque promocional requerido')
      }

      const response = await promotionalBlocksService.getPublicPromotionalBlockBySlug(slug)
      return normalizeEntityResponse(response)
    } catch (error) {
      return rejectWithValue(getErrorMessage(error, 'Error al cargar bloque promocional público'))
    }
  },
)

const promotionalBlocksSlice = createSlice({
  name: 'promotionalBlocks',
  initialState: {
    publicBlocks: [],
    selectedBlock: null,
    isFetchingPublic: false,
    publicError: null,
  },
  reducers: {
    clearPublicPromotionalBlocks: state => {
      state.publicBlocks = []
      state.publicError = null
    },
  },
  extraReducers: builder => {
    builder
      .addCase(fetchPublicPromotionalBlocks.pending, state => {
        state.isFetchingPublic = true
        state.publicError = null
      })
      .addCase(fetchPublicPromotionalBlocks.fulfilled, (state, action) => {
        state.isFetchingPublic = false
        state.publicBlocks = action.payload || []
      })
      .addCase(fetchPublicPromotionalBlocks.rejected, (state, action) => {
        state.isFetchingPublic = false
        state.publicError = action.payload || 'Error al cargar bloques públicos'
      })

      .addCase(fetchPublicPromotionalBlockBySlug.pending, state => {
        state.isFetchingPublic = true
        state.publicError = null
      })
      .addCase(fetchPublicPromotionalBlockBySlug.fulfilled, (state, action) => {
        const block = action.payload

        state.isFetchingPublic = false
        state.selectedBlock = block

        if (block?._id) {
          state.publicBlocks = upsertBlock(state.publicBlocks, block)
        }
      })
      .addCase(fetchPublicPromotionalBlockBySlug.rejected, (state, action) => {
        state.isFetchingPublic = false
        state.publicError = action.payload || 'Error al cargar bloque público'
      })
  },
})

export const { clearPublicPromotionalBlocks } = promotionalBlocksSlice.actions

export default promotionalBlocksSlice.reducer
