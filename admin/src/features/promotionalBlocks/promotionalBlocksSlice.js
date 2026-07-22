// 📁 src/features/promotionalBlocks/promotionalBlocksSlice.js
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import promotionalBlocksService from './promotionalBlocksService'

// =====================================================
// Estado base
// =====================================================

const DEFAULT_META = {
  total: 0,
  page: 1,
  pages: 1,
  limit: 10,
}

const getInitialState = () => ({
  blocks: [],
  publicBlocks: [],
  selectedBlock: null,

  meta: { ...DEFAULT_META },

  isFetching: false,
  isFetchingPublic: false,
  isFetchingOne: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  isToggling: false,

  error: null,
  publicError: null,
  successMessage: null,
})

const initialState = getInitialState()

// =====================================================
// Helpers
// =====================================================

const getErrorMessage = (error, fallback = 'Ocurrió un error inesperado') => {
  if (typeof error === 'string') return error
  if (error?.message) return error.message
  return fallback
}

const normalizeListResponse = payload => {
  if (Array.isArray(payload)) {
    return {
      data: payload,
      meta: {
        ...DEFAULT_META,
        total: payload.length,
      },
    }
  }

  const data = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.blocks)
      ? payload.blocks
      : []

  return {
    data,
    meta: {
      ...DEFAULT_META,
      ...(payload?.meta || {}),
      total: payload?.meta?.total ?? data.length,
    },
  }
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

// =====================================================
// Thunks ADMIN
// =====================================================

export const fetchPromotionalBlocks = createAsyncThunk(
  'promotionalBlocks/fetchAll',
  async (params = {}, { rejectWithValue }) => {
    try {
      return await promotionalBlocksService.getPromotionalBlocks(params)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al cargar bloques promocionales'),
      )
    }
  },
)

export const fetchPromotionalBlock = createAsyncThunk(
  'promotionalBlocks/fetchOne',
  async (blockId, { rejectWithValue }) => {
    try {
      if (!blockId) {
        return rejectWithValue('ID del bloque promocional requerido')
      }

      const response =
        await promotionalBlocksService.getPromotionalBlock(blockId)
      return normalizeEntityResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al cargar el bloque promocional'),
      )
    }
  },
)

export const createPromotionalBlock = createAsyncThunk(
  'promotionalBlocks/create',
  async (blockData, { rejectWithValue }) => {
    try {
      if (!blockData || typeof blockData !== 'object') {
        return rejectWithValue('Payload del bloque promocional inválido')
      }

      const response =
        await promotionalBlocksService.createPromotionalBlock(blockData)
      return normalizeEntityResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al crear bloque promocional'),
      )
    }
  },
)

export const updatePromotionalBlock = createAsyncThunk(
  'promotionalBlocks/update',
  async ({ id, blockId, data }, { rejectWithValue }) => {
    try {
      const finalId = id || blockId

      if (!finalId) {
        return rejectWithValue('ID del bloque promocional requerido')
      }

      if (!data || typeof data !== 'object') {
        return rejectWithValue('Payload de actualización inválido')
      }

      const response = await promotionalBlocksService.updatePromotionalBlock(
        finalId,
        data,
      )

      return normalizeEntityResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al actualizar bloque promocional'),
      )
    }
  },
)

export const togglePromotionalBlockStatus = createAsyncThunk(
  'promotionalBlocks/toggleStatus',
  async ({ id, blockId, isActive }, { rejectWithValue }) => {
    try {
      const finalId = id || blockId

      if (!finalId) {
        return rejectWithValue('ID del bloque promocional requerido')
      }

      if (typeof isActive !== 'boolean') {
        return rejectWithValue('El estado del bloque debe ser booleano')
      }

      const response =
        await promotionalBlocksService.togglePromotionalBlockStatus(
          finalId,
          isActive,
        )

      return normalizeEntityResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(
          error,
          'Error al cambiar estado del bloque promocional',
        ),
      )
    }
  },
)

export const deletePromotionalBlock = createAsyncThunk(
  'promotionalBlocks/delete',
  async (payload, { rejectWithValue }) => {
    try {
      const finalId =
        typeof payload === 'string' ? payload : payload?.id || payload?.blockId

      const hard = typeof payload === 'object' ? Boolean(payload?.hard) : false

      if (!finalId) {
        return rejectWithValue('ID del bloque promocional requerido')
      }

      const response = await promotionalBlocksService.deletePromotionalBlock(
        finalId,
        { hard },
      )

      const normalized = normalizeEntityResponse(response)

      return {
        id: normalized?.id || normalized?._id || finalId,
        hardDeleted: Boolean(normalized?.hardDeleted || hard),
      }
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al eliminar bloque promocional'),
      )
    }
  },
)

// =====================================================
// Thunks PUBLIC WEBSITE
// =====================================================

export const fetchPublicPromotionalBlocks = createAsyncThunk(
  'promotionalBlocks/fetchPublic',
  async (params = { placement: 'home' }, { rejectWithValue }) => {
    try {
      const response =
        await promotionalBlocksService.getPublicPromotionalBlocks(params)
      return normalizePublicListResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(
          error,
          'Error al cargar bloques promocionales públicos',
        ),
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

      const response =
        await promotionalBlocksService.getPublicPromotionalBlockBySlug(slug)

      return normalizeEntityResponse(response)
    } catch (error) {
      return rejectWithValue(
        getErrorMessage(error, 'Error al cargar bloque promocional público'),
      )
    }
  },
)

// =====================================================
// Slice
// =====================================================

const promotionalBlocksSlice = createSlice({
  name: 'promotionalBlocks',
  initialState,
  reducers: {
    clearPromotionalBlocksError: state => {
      state.error = null
      state.publicError = null
    },

    clearPromotionalBlocksSuccess: state => {
      state.successMessage = null
    },

    setSelectedPromotionalBlock: (state, action) => {
      state.selectedBlock = action.payload
    },

    clearSelectedPromotionalBlock: state => {
      state.selectedBlock = null
    },

    clearPublicPromotionalBlocks: state => {
      state.publicBlocks = []
      state.publicError = null
    },

    resetPromotionalBlocksState: () => getInitialState(),
  },
  extraReducers: builder => {
    builder

      // =====================================================
      // ADMIN: Fetch all
      // =====================================================
      .addCase(fetchPromotionalBlocks.pending, state => {
        state.isFetching = true
        state.error = null
      })
      .addCase(fetchPromotionalBlocks.fulfilled, (state, action) => {
        const { data, meta } = normalizeListResponse(action.payload)

        state.isFetching = false
        state.blocks = data
        state.meta = meta
      })
      .addCase(fetchPromotionalBlocks.rejected, (state, action) => {
        state.isFetching = false
        state.error = action.payload || 'Error al cargar bloques promocionales'
      })

      // =====================================================
      // ADMIN: Fetch one
      // =====================================================
      .addCase(fetchPromotionalBlock.pending, state => {
        state.isFetchingOne = true
        state.error = null
      })
      .addCase(fetchPromotionalBlock.fulfilled, (state, action) => {
        const block = action.payload

        state.isFetchingOne = false
        state.selectedBlock = block

        if (block?._id) {
          state.blocks = upsertBlock(state.blocks, block)
        }
      })
      .addCase(fetchPromotionalBlock.rejected, (state, action) => {
        state.isFetchingOne = false
        state.error = action.payload || 'Error al cargar bloque promocional'
      })

      // =====================================================
      // ADMIN: Create
      // =====================================================
      .addCase(createPromotionalBlock.pending, state => {
        state.isCreating = true
        state.error = null
        state.successMessage = null
      })
      .addCase(createPromotionalBlock.fulfilled, (state, action) => {
        const block = action.payload

        state.isCreating = false

        if (block?._id) {
          state.blocks = upsertBlock(state.blocks, block)
          state.meta.total = Number(state.meta.total || 0) + 1
        }

        state.successMessage = 'Bloque promocional creado correctamente'
      })
      .addCase(createPromotionalBlock.rejected, (state, action) => {
        state.isCreating = false
        state.error = action.payload || 'Error al crear bloque promocional'
      })

      // =====================================================
      // ADMIN: Update
      // =====================================================
      .addCase(updatePromotionalBlock.pending, state => {
        state.isUpdating = true
        state.error = null
        state.successMessage = null
      })
      .addCase(updatePromotionalBlock.fulfilled, (state, action) => {
        const block = action.payload

        state.isUpdating = false

        if (block?._id) {
          state.blocks = upsertBlock(state.blocks, block)

          if (state.selectedBlock?._id === block._id) {
            state.selectedBlock = block
          }
        }

        state.successMessage = 'Bloque promocional actualizado correctamente'
      })
      .addCase(updatePromotionalBlock.rejected, (state, action) => {
        state.isUpdating = false
        state.error = action.payload || 'Error al actualizar bloque promocional'
      })

      // =====================================================
      // ADMIN: Toggle status
      // =====================================================
      .addCase(togglePromotionalBlockStatus.pending, state => {
        state.isToggling = true
        state.error = null
        state.successMessage = null
      })
      .addCase(togglePromotionalBlockStatus.fulfilled, (state, action) => {
        const block = action.payload

        state.isToggling = false

        if (block?._id) {
          state.blocks = upsertBlock(state.blocks, block)

          if (state.selectedBlock?._id === block._id) {
            state.selectedBlock = block
          }
        }

        state.successMessage = 'Estado del bloque actualizado correctamente'
      })
      .addCase(togglePromotionalBlockStatus.rejected, (state, action) => {
        state.isToggling = false
        state.error = action.payload || 'Error al cambiar estado del bloque'
      })

      // =====================================================
      // ADMIN: Delete
      // =====================================================
      .addCase(deletePromotionalBlock.pending, state => {
        state.isDeleting = true
        state.error = null
        state.successMessage = null
      })
      .addCase(deletePromotionalBlock.fulfilled, (state, action) => {
        const deletedId =
          typeof action.payload === 'string'
            ? String(action.payload)
            : String(action.payload?.id || '')

        state.isDeleting = false

        state.blocks = state.blocks.filter(
          block => String(block._id) !== deletedId,
        )
        state.publicBlocks = state.publicBlocks.filter(
          block => String(block._id) !== deletedId,
        )

        state.meta.total = Math.max(0, Number(state.meta.total || 0) - 1)

        if (String(state.selectedBlock?._id || '') === deletedId) {
          state.selectedBlock = null
        }

        state.successMessage = 'Bloque promocional eliminado correctamente'
      })
      .addCase(deletePromotionalBlock.rejected, (state, action) => {
        state.isDeleting = false
        state.error = action.payload || 'Error al eliminar bloque promocional'
      })

      // =====================================================
      // PUBLIC: Fetch blocks
      // =====================================================
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

      // =====================================================
      // PUBLIC: Fetch by slug
      // =====================================================
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

export const {
  clearPromotionalBlocksError,
  clearPromotionalBlocksSuccess,
  setSelectedPromotionalBlock,
  clearSelectedPromotionalBlock,
  clearPublicPromotionalBlocks,
  resetPromotionalBlocksState,
} = promotionalBlocksSlice.actions

export default promotionalBlocksSlice.reducer
