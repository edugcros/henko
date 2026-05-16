import { createSlice, createAsyncThunk, createAction, createSelector } from '@reduxjs/toolkit'
import cartService from './cartService'

const PLACEHOLDER_IMAGE = '/assets/images/placeholder.png'

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizeAttributes = (item = {}) => {
  return (
    item.selectedAttributes ||
    item.variantAttributes ||
    item.selectedVariant?.attributes ||
    item.attributes ||
    {}
  )
}

const normalizeVariantId = (item = {}) => {
  return (
    item.variantId ||
    item.selectedVariant?.id ||
    item.selectedVariant?._id ||
    item.variant?._id ||
    item.variant?.id ||
    null
  )
}

const normalizeVariantSku = (item = {}) => {
  return (
    item.variantSku || item.variantSKU || item.selectedVariant?.sku || item.variant?.sku || null
  )
}

const buildCartKey = (item = {}, productId, variantId, selectedAttributes) => {
  if (item.cartKey) return item.cartKey
  if (variantId) return `${productId}::${variantId}`

  const attrsKey = Object.entries(selectedAttributes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|')

  return `${productId}::${attrsKey || 'base'}`
}

const normalizeCartItems = data => {
  const products = Array.isArray(data)
    ? data
    : Array.isArray(data?.products)
      ? data.products
      : Array.isArray(data?.data?.products)
        ? data.data.products
        : []

  return products.map(item => {
    const populatedProduct =
      item.productId && typeof item.productId === 'object' ? item.productId : null

    const productId =
      populatedProduct?._id || item.productId || item.product?._id || item.product || null

    const selectedAttributes = normalizeAttributes(item)
    const variantId = normalizeVariantId(item)
    const variantSku = normalizeVariantSku(item)

    const fallbackImage =
      populatedProduct?.image ||
      (Array.isArray(populatedProduct?.images) && populatedProduct.images.length > 0
        ? populatedProduct.images[0]?.url
        : PLACEHOLDER_IMAGE)

    const selectedVariantImage =
      item.selectedVariant?.image || item.variant?.image?.url || item.variant?.image || null

    const normalizedImage = item.image || selectedVariantImage || fallbackImage

    const price = toNumber(
      item.price ?? item.selectedVariant?.price ?? item.variant?.price ?? populatedProduct?.price,
      0,
    )

    const quantity = toNumber(item.quantity, 1)
    const subtotal = toNumber(item.subtotal, price * quantity)

    const stock = toNumber(
      item.stock ?? item.selectedVariant?.stock ?? item.variant?.stock ?? populatedProduct?.stock,
      0,
    )

    const cartKey = buildCartKey(item, productId, variantId, selectedAttributes)

    return {
      _id: item._id || cartKey,
      rowId: item._id || null,
      cartKey,

      tenantId: item.tenantId || populatedProduct?.tenantId || null,

      productId,
      title: item.title || populatedProduct?.title || 'Producto sin título',
      price,
      quantity,
      subtotal,
      stock,
      image: normalizedImage,

      variantId,
      variantSku,
      variantSKU: variantSku,
      selectedAttributes,
      variantAttributes: selectedAttributes,
      hasVariants: Boolean(
        item.hasVariants || variantId || Object.keys(selectedAttributes).length > 0,
      ),

      selectedVariant: item.selectedVariant
        ? {
            id: item.selectedVariant.id || item.selectedVariant._id || variantId || null,
            sku: item.selectedVariant.sku || variantSku || null,
            price: toNumber(item.selectedVariant.price, price),
            stock: toNumber(item.selectedVariant.stock, stock),
            image: item.selectedVariant.image || normalizedImage,
            attributes: item.selectedVariant.attributes || selectedAttributes,
          }
        : variantId || Object.keys(selectedAttributes).length > 0
          ? {
              id: variantId,
              sku: variantSku,
              price,
              stock,
              image: normalizedImage,
              attributes: selectedAttributes,
            }
          : null,

      product: populatedProduct || null,
    }
  })
}

const calculateTotal = items =>
  items.reduce((acc, item) => acc + toNumber(item.price) * toNumber(item.quantity), 0)

const initialState = {
  cartItems: [],
  cartTotal: 0,
  isLoading: false,
  isError: false,
  isSuccess: false,
  message: '',
}

export const getCart = createAsyncThunk('cart/getCart', async (_, thunkAPI) => {
  try {
    const response = await cartService.getCart()
    return response
  } catch (error) {
    return thunkAPI.rejectWithValue(error?.message || 'No se pudo obtener el carrito')
  }
})

export const addOrUpdateCartItem = createAsyncThunk(
  'cart/addOrUpdate',
  async (cartData, thunkAPI) => {
    try {
      const response = await cartService.addOrUpdateCartItem(cartData)
      return response.data || response
    } catch (error) {
      return thunkAPI.rejectWithValue(error?.message || 'No se pudo actualizar el carrito')
    }
  },
)

export const removeCartItem = createAsyncThunk('cart/removeItem', async (payload, thunkAPI) => {
  try {
    const response = await cartService.removeCartItem(payload)
    return response.data || response
  } catch (error) {
    return thunkAPI.rejectWithValue(error?.message || 'No se pudo eliminar el item')
  }
})

export const emptyCart = createAsyncThunk('cart/empty', async (_, thunkAPI) => {
  try {
    const response = await cartService.emptyCart()
    return response.data || response
  } catch (error) {
    return thunkAPI.rejectWithValue(error?.message || 'No se pudo vaciar el carrito')
  }
})

export const resetCartState = createAction('cart/reset')

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {},
  extraReducers: builder => {
    builder
      .addCase(getCart.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(getCart.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''
        state.cartItems = normalizeCartItems(action.payload)
        state.cartTotal = calculateTotal(state.cartItems)
      })
      .addCase(getCart.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.isSuccess = false
        state.message = action.payload
      })

      .addCase(addOrUpdateCartItem.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(addOrUpdateCartItem.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''
        state.cartItems = normalizeCartItems(action.payload)
        state.cartTotal = calculateTotal(state.cartItems)
      })
      .addCase(addOrUpdateCartItem.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.isSuccess = false
        state.message = action.payload
      })

      .addCase(removeCartItem.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(removeCartItem.fulfilled, (state, action) => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''
        state.cartItems = normalizeCartItems(action.payload)
        state.cartTotal = calculateTotal(state.cartItems)
      })
      .addCase(removeCartItem.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.isSuccess = false
        state.message = action.payload
      })

      .addCase(emptyCart.pending, state => {
        state.isLoading = true
        state.isError = false
        state.message = ''
      })
      .addCase(emptyCart.fulfilled, state => {
        state.isLoading = false
        state.isSuccess = true
        state.isError = false
        state.message = ''
        state.cartItems = []
        state.cartTotal = 0
      })
      .addCase(emptyCart.rejected, (state, action) => {
        state.isLoading = false
        state.isError = true
        state.isSuccess = false
        state.message = action.payload
      })

      .addCase(resetCartState, () => initialState)
  },
})

export const selectCartItems = createSelector(
  state => state.cart.cartItems,
  items => items,
)

export const selectCartTotal = createSelector(
  state => state.cart.cartTotal,
  total => total,
)

export const selectCartCount = createSelector(
  state => state.cart.cartItems,
  items => items.reduce((acc, item) => acc + toNumber(item.quantity, 0), 0),
)

export default cartSlice.reducer
