// 📁 src/features/product/productSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { toast } from 'react-toastify'
import productService from './productService.js'

const normalizeErrorMessage = (error, fallback) => {
  if (typeof error === 'string') return error
  return error?.message || error?.error || fallback
}

const normalizeImages = images => {
  return Array.isArray(images) ? images : []
}

const normalizeVariants = variants => {
  return Array.isArray(variants) ? variants : []
}

const normalizeRatings = ratings => {
  return Array.isArray(ratings) ? ratings : []
}

const normalizeProduct = product => {
  if (!product || typeof product !== 'object') return null

  return {
    ...product,

    images: normalizeImages(product.images),
    variants: normalizeVariants(product.variants),
    ratings: normalizeRatings(product.ratings),
    tags: Array.isArray(product.tags) ? product.tags : [],

    totalrating: Number(product.totalrating || 0),

    // =====================================================
    // 🧠 AI METADATA NORMALIZATION
    // =====================================================
    iaGenerated: Boolean(product.iaGenerated),
    aiOriginalOutput: product.aiOriginalOutput ?? null,
    aiConfidence:
      product.aiConfidence !== undefined && product.aiConfidence !== null
        ? Number(product.aiConfidence)
        : null,
    aiSource: product.aiSource || null,
    aiImageHash: product.aiImageHash || null,
    aiNeedsReview: Boolean(product.aiNeedsReview),
  }
}

const normalizeProductList = payload => {
  const rawProducts = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : []

  return rawProducts
    .map(normalizeProduct)
    .filter(Boolean)
}

const normalizeSingleProduct = payload => {
  const product = payload?.data || payload || null
  return normalizeProduct(product)
}

const replaceProductInList = (products, updatedProduct) => {
  if (!updatedProduct?._id) return products

  const index = products.findIndex(item => item._id === updatedProduct._id)

  if (index === -1) {
    return [updatedProduct, ...products]
  }

  const cloned = [...products]
  cloned[index] = updatedProduct
  return cloned
}

const extractImagesArray = payload => {
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload)) return payload
  return []
}

const setRejectedState = (state, action, fallbackMessage) => {
  state.isLoading = false
  state.isError = true
  state.isSuccess = false
  state.message = action.payload?.message || fallbackMessage
}

// ==========================================
// THUNKS
// ==========================================

export const getProducts = createAsyncThunk(
  'product/fetchAll',
  async (params = {}, thunkAPI) => {
    try {
      return await productService.getProducts(params)
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al obtener productos')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const createProducts = createAsyncThunk(
  'product/create',
  async (productData, thunkAPI) => {
    try {
      const response = await productService.createProduct(productData)
      toast.success('Producto creado correctamente')
      return response
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al crear producto')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const getAProduct = createAsyncThunk(
  'product/getProduct',
  async (productId, thunkAPI) => {
    try {
      return await productService.getProduct(productId)
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al obtener producto')
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const updateAProduct = createAsyncThunk(
  'product/update',
  async (payload, thunkAPI) => {
    try {
      const response = await productService.updateAProduct(payload)
      toast.success('Producto actualizado correctamente')
      return response
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al actualizar producto')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const uploadProductImage = createAsyncThunk(
  'product/uploadImage',
  async ({ productId, imageFile }, thunkAPI) => {
    try {
      const response = await productService.uploadProductImage(productId, imageFile)
      toast.success('Imagen subida correctamente')
      return response
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al subir imagen')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const deleteProduct = createAsyncThunk(
  'product/delete',
  async (productId, thunkAPI) => {
    try {
      const response = await productService.deleteProduct(productId)
      toast.success('Producto eliminado permanentemente')
      return { ...response, productId }
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al eliminar producto')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const deleteProductImage = createAsyncThunk(
  'product/deleteImage',
  async ({ productId, publicId }, thunkAPI) => {
    try {
      const response = await productService.deleteProductImage(productId, publicId)
      toast.success('Imagen eliminada correctamente')
      return response
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error al eliminar imagen')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

export const assignVariantImage = createAsyncThunk(
  'product/assignVariantImage',
  async ({ productId, variantId, image }, thunkAPI) => {
    try {
      if (!productId) throw new Error('productId requerido')
      if (!variantId) throw new Error('variantId requerido')
      if (!image?.public_id || !image?.url) {
        throw new Error('La imagen de variante es inválida')
      }

      const response = await productService.assignVariantImage({
        productId,
        variantId,
        image: {
          public_id: image.public_id,
          url: image.url,
        },
      })

      return response
    } catch (error) {
      const message = normalizeErrorMessage(error, 'Error asignando imagen a variante')
      toast.error(message)
      return thunkAPI.rejectWithValue({ message })
    }
  },
)

// ==========================================
// ESTADO INICIAL
// ==========================================

const initialState = {
  products: [],
  singleProduct: null,
  images: [],

  isLoading: false,
  isSuccess: false,
  isError: false,
  message: '',

  createdProduct: null,
  updatedProduct: null,
  deletedProduct: null,

  meta: null,
}

// ==========================================
// SLICE
// ==========================================

const productSlice = createSlice({
  name: 'product',
  initialState,
  reducers: {
    resetState: () => initialState,
    clearProductMessage: state => {
      state.message = ''
      state.isError = false
      state.isSuccess = false
    },
  },
  extraReducers: builder => {
    builder

      // ==========================================
      // GET PRODUCTS
      // ==========================================
      .addCase(getProducts.pending, state => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
        state.message = ''
      })
      .addCase(getProducts.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        state.products = normalizeProductList(action.payload)
        state.meta = action.payload?.meta || null
      })
      .addCase(getProducts.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al obtener productos')
      })

      // ==========================================
      // CREATE PRODUCT
      // ==========================================
      .addCase(createProducts.pending, state => {
        state.isLoading = true
        state.isError = false
        state.isSuccess = false
        state.message = ''
        state.createdProduct = null
      })
      .addCase(createProducts.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        state.createdProduct = normalizeSingleProduct(action.payload)

        if (state.createdProduct) {
          state.products = replaceProductInList(state.products, state.createdProduct)
        }
      })
      .addCase(createProducts.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al crear producto')
      })

      // ==========================================
      // GET SINGLE PRODUCT
      // ==========================================
      .addCase(getAProduct.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(getAProduct.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        state.singleProduct = normalizeSingleProduct(action.payload)
        state.images = normalizeImages(state.singleProduct?.images)
      })
      .addCase(getAProduct.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al obtener producto')
      })

      // ==========================================
      // UPDATE PRODUCT
      // ==========================================
      .addCase(updateAProduct.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
        state.updatedProduct = null
      })
      .addCase(updateAProduct.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        state.updatedProduct = normalizeSingleProduct(action.payload)

        if (state.updatedProduct) {
          state.products = replaceProductInList(state.products, state.updatedProduct)

          if (state.singleProduct?._id === state.updatedProduct._id) {
            state.singleProduct = state.updatedProduct
            state.images = normalizeImages(state.updatedProduct.images)
          }
        }
      })
      .addCase(updateAProduct.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al actualizar producto')
      })

      // ==========================================
      // DELETE PRODUCT
      // ==========================================
      .addCase(deleteProduct.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(deleteProduct.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        const deletedId = action.payload?.productId
        state.deletedProduct = deletedId || null
        state.products = state.products.filter(product => product._id !== deletedId)

        if (state.singleProduct?._id === deletedId) {
          state.singleProduct = null
          state.images = []
        }
      })
      .addCase(deleteProduct.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al eliminar producto')
      })

      // ==========================================
      // UPLOAD IMAGE
      // ==========================================
      .addCase(uploadProductImage.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(uploadProductImage.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        const uploadedImages = extractImagesArray(action.payload)
        state.images = uploadedImages

        if (state.singleProduct) {
          state.singleProduct.images = uploadedImages
          state.products = replaceProductInList(state.products, state.singleProduct)
        }
      })
      .addCase(uploadProductImage.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al subir imagen')
      })

      // ==========================================
      // DELETE IMAGE
      // ==========================================
      .addCase(deleteProductImage.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(deleteProductImage.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        const remainingImages = extractImagesArray(action.payload)
        state.images = remainingImages

        if (state.singleProduct) {
          state.singleProduct.images = remainingImages
          state.products = replaceProductInList(state.products, state.singleProduct)
        }
      })
      .addCase(deleteProductImage.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al eliminar imagen')
      })

      // ==========================================
      // ASSIGN VARIANT IMAGE
      // ==========================================
      .addCase(assignVariantImage.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(assignVariantImage.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''

        const updatedProduct = normalizeSingleProduct(action.payload)

        if (updatedProduct) {
          state.singleProduct = updatedProduct
          state.images = normalizeImages(updatedProduct.images)
          state.products = replaceProductInList(state.products, updatedProduct)
        }
      })
      .addCase(assignVariantImage.rejected, (state, action) => {
        setRejectedState(state, action, 'Error al asignar imagen a la variante')
      })
  },
})

export const { resetState, clearProductMessage } = productSlice.actions

export default productSlice.reducer
