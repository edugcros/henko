import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import productService from './productService'
import { resetAuthState } from '@features/user/userSlice'
import { toast } from 'react-toastify'

const initialState = {
  products: [],
  categories: [],
  singleProduct: {},
  meta: {
    total: 0,
    page: 1,
    limit: 12,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
  appliedFilters: {
    q: null,
    categoria: null,
    subcategoria: null,
    sort: null,
  },
  status: 'idle',
  isLoading: false,
  isCategoriesLoading: false,
  error: null,
  categoriesError: null,
}

const normalizeProduct = (product = {}) => ({
  ...product,
  images: Array.isArray(product.images) ? product.images : [],
  ratings: Array.isArray(product.ratings) ? product.ratings : [],
  variants: Array.isArray(product.variants) ? product.variants : [],
  variantAttributes: Array.isArray(product.variantAttributes) ? product.variantAttributes : [],
  totalrating: product.totalrating || 0,
})

const unwrapApiData = payload => {
  if (!payload || typeof payload !== 'object') return payload
  if (payload.data?.product) return payload.data.product
  if (payload.data && !Array.isArray(payload.data)) return payload.data
  if (payload.product) return payload.product
  return payload
}

const unwrapRatingPayload = payload => {
  const data = unwrapApiData(payload)
  return data && typeof data === 'object' ? data : {}
}

export const getAllProducts = createAsyncThunk(
  'product/fetchAll',
  async (params = {}, { rejectWithValue }) => {
    try {
      return await productService.getAllProducts(params)
    } catch (error) {
      return rejectWithValue(error?.message || 'Error al cargar productos')
    }
  },
)

export const getProductCategories = createAsyncThunk(
  'product/fetchCategories',
  async (_, { rejectWithValue }) => {
    try {
      return await productService.getCategories()
    } catch (error) {
      return rejectWithValue(error?.message || 'Error al cargar categorías')
    }
  },
)

export const getProduct = createAsyncThunk(
  'product/getProduct',
  async (productId, { rejectWithValue }) => {
    try {
      const response = await productService.getProduct(productId)
      return unwrapApiData(response) || {}
    } catch (error) {
      return rejectWithValue(error?.message || 'Error al cargar el producto')
    }
  },
)

export const rateProduct = createAsyncThunk(
  'product/rate',
  async ({ productId, star, rating, comment = '' }, thunkAPI) => {
    try {
      const normalizedStar = Math.trunc(Number(star ?? rating))

      console.log('⭐ productSlice.rateProduct payload:', {
        productId,
        star,
        rating,
        normalizedStar,
        comment,
      })

      if (!productId) {
        return thunkAPI.rejectWithValue('ID de producto inválido')
      }

      if (
        !Number.isInteger(normalizedStar) ||
        normalizedStar < 1 ||
        normalizedStar > 5
      ) {
        return thunkAPI.rejectWithValue(
          'La calificación debe ser un entero entre 1 y 5',
        )
      }

      const response = await productService.rateProduct({
        productId,
        star: normalizedStar,
        rating: normalizedStar,
        comment,
      })

      return response
    } catch (error) {
      if ([401, 403].includes(Number(error?.status || error?.response?.status))) {
        thunkAPI.dispatch(resetAuthState())
        return thunkAPI.rejectWithValue(
          'Tu sesión expiró. Iniciá sesión nuevamente para publicar una reseña.',
        )
      }

      return thunkAPI.rejectWithValue(
        error?.response?.data?.message ||
          error?.message ||
          'Error calificando producto',
      )
    }
  },
)

export const toggleHelpfulVote = createAsyncThunk(
  'product/toggle-helpful',
  async (data, thunkAPI) => {
    try {
      return await productService.toggleHelpfulRating(data)
    } catch (error) {
      return thunkAPI.rejectWithValue(error?.message || 'No se pudo procesar tu voto')
    }
  },
)

export const uploadProductImage = createAsyncThunk(
  'product/uploadProductImage',
  async ({ productId, images }, { rejectWithValue }) => {
    try {
      const response = await productService.uploadProductImage(productId, images)
      toast.success('Imagen subida correctamente')
      return response?.data || response || []
    } catch (error) {
      toast.error('Error al subir la imagen')
      return rejectWithValue(error?.message || 'Error al subir la imagen')
    }
  },
)

export const deleteProductImage = createAsyncThunk(
  'product/deleteImage',
  async ({ productId, public_id }, { rejectWithValue }) => {
    try {
      const response = await productService.deleteProductImage({
        productId,
        public_id,
      })
      toast.success('Imagen eliminada correctamente')
      return response?.data || response || []
    } catch (error) {
      toast.error('Error al eliminar la imagen')
      return rejectWithValue(error?.message || 'Error al eliminar la imagen')
    }
  },
)

const productSlice = createSlice({
  name: 'product',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      // All products
      .addCase(getAllProducts.pending, state => {
        state.status = 'loading'
        state.isLoading = true
        state.error = null
      })
      .addCase(getAllProducts.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.isLoading = false
        state.error = null

        const productsRaw = Array.isArray(action.payload?.data) ? action.payload.data : []

        state.products = productsRaw.map(normalizeProduct)
        state.meta = {
          total: action.payload?.meta?.total || 0,
          page: action.payload?.meta?.page || 1,
          limit: action.payload?.meta?.limit || 12,
          totalPages: action.payload?.meta?.totalPages || 1,
          hasNextPage: action.payload?.meta?.hasNextPage || false,
          hasPrevPage: action.payload?.meta?.hasPrevPage || false,
        }
        state.appliedFilters = {
          q: action.payload?.filters?.q || null,
          categoria: action.payload?.filters?.categoria || null,
          subcategoria: action.payload?.filters?.subcategoria || null,
          sort: action.payload?.filters?.sort || null,
        }
      })
      .addCase(getAllProducts.rejected, (state, action) => {
        state.status = 'failed'
        state.isLoading = false
        state.error = action.payload || 'Error al cargar productos'
      })

      // Categories / facets
      .addCase(getProductCategories.pending, state => {
        state.isCategoriesLoading = true
        state.categoriesError = null
      })
      .addCase(getProductCategories.fulfilled, (state, action) => {
        state.isCategoriesLoading = false
        state.categoriesError = null
        state.categories = Array.isArray(action.payload?.data) ? action.payload.data : []
      })
      .addCase(getProductCategories.rejected, (state, action) => {
        state.isCategoriesLoading = false
        state.categoriesError = action.payload || 'Error al cargar categorías'
      })

      // Single product
      .addCase(getProduct.pending, state => {
        state.status = 'loading'
        state.isLoading = true
        state.error = null
      })
      .addCase(getProduct.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.singleProduct = normalizeProduct(action.payload)
        state.isLoading = false
        state.error = null
      })
      .addCase(getProduct.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || 'Error al cargar el producto'
        state.isLoading = false
      })

      // Helpful vote
      .addCase(toggleHelpfulVote.fulfilled, (state, action) => {
        const { ratingId, helpfulVotes } = action.payload || {}

        if (state.singleProduct && Array.isArray(state.singleProduct.ratings)) {
          const ratingIndex = state.singleProduct.ratings.findIndex(r => r._id === ratingId)
          if (ratingIndex !== -1) {
            state.singleProduct.ratings[ratingIndex].helpfulVotes = helpfulVotes
          }
        }
      })
      .addCase(toggleHelpfulVote.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || 'No se pudo procesar tu voto'
        state.isLoading = false
        toast.error('No se pudo procesar tu voto')
      })

      // Rating
      .addCase(rateProduct.fulfilled, (state, action) => {
        const ratingPayload = unwrapRatingPayload(action.payload)

        state.singleProduct.totalrating = Number(ratingPayload.totalrating) || 0
        state.singleProduct.ratings = Array.isArray(ratingPayload.ratings)
          ? ratingPayload.ratings
          : []
      })

      // Images
      .addCase(uploadProductImage.fulfilled, (state, action) => {
        state.singleProduct.images = action.payload || []
      })
      .addCase(deleteProductImage.fulfilled, (state, action) => {
        state.singleProduct.images = action.payload || []
      })
  },
})

export default productSlice.reducer
