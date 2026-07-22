// 📄 website/src/hooks/useCart.js
import { useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'

import {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  emptyCart,
} from '@features/cart/cartSlice'

import {
  trackUserMetric,
  USER_METRIC_EVENTS,
} from '../services/userMetricsService'

const FALLBACK_IMAGE = '/assets/images/placeholder.png'

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

const toPositiveQuantity = value => {
  const quantity = Math.trunc(toNumber(value, 1))

  return quantity > 0 ? quantity : 1
}

const getProductId = product => {
  return product?._id || product?.id || product?.productId || ''
}

const getProductTitle = product => {
  return product?.title || product?.name || 'Producto'
}

const getProductImage = product => {
  return (
    product?.image ||
    product?.imageUrl ||
    product?.images?.[0]?.url ||
    product?.images?.[0]?.secure_url ||
    FALLBACK_IMAGE
  )
}

const getProductPrice = product => {
  return toNumber(product?.finalPrice ?? product?.price ?? product?.precio, 0)
}

const getOriginalPrice = product => {
  return toNumber(
    product?.originalPrice ??
      product?.compareAtPrice ??
      product?.price ??
      product?.precio,
    getProductPrice(product),
  )
}

const getProductCurrency = product => {
  return String(product?.currency || 'ARS')
    .trim()
    .toUpperCase()
}

const getProductCategory = product => {
  return product?.category || product?.categoryName || product?.categoria || ''
}

const getProductBrand = product => {
  return product?.brand || product?.marca || ''
}

const buildMetricItem = ({ product, quantity, price }) => {
  return {
    productId: getProductId(product),
    title: getProductTitle(product),
    sku: product?.sku || '',
    quantity,
    price,
    subtotal: price * quantity,
  }
}

export const useCart = () => {
  const dispatch = useDispatch()

  const {
    cartItems = [],
    cartTotal = 0,
    totalAfterDiscount = 0,
    isLoading = false,
    appliedCoupon = null,
  } = useSelector(state => state.cart || {})

  const user = useSelector(state => state.user?.user || null)

  const normalizedCartItems = useMemo(() => {
    return Array.isArray(cartItems) ? cartItems : []
  }, [cartItems])

  const reloadCart = useCallback(async () => {
    if (!user) return null

    try {
      return await dispatch(getCart()).unwrap()
    } catch {
      return null
    }
  }, [dispatch, user])

  const addItem = useCallback(
    async (product, options = {}) => {
      const productId = getProductId(product)

      if (!productId) {
        toast.error('Producto inválido.')
        return null
      }

      if (!user) {
        toast.info('Debes iniciar sesión para guardar tu carrito.')
        return null
      }

      const quantity = toPositiveQuantity(options.quantity || 1)
      const price = toNumber(options.price ?? getProductPrice(product), 0)
      const originalPrice = toNumber(
        options.originalPrice ?? getOriginalPrice(product),
        price,
      )
      const currency = options.currency || getProductCurrency(product)
      const hasPromotion = Boolean(
        options.hasPromotion ?? product?.hasPromotion ?? price < originalPrice,
      )

      const itemData = {
        productId,
        tenantId: product?.tenantId || options.tenantId || null,
        title: getProductTitle(product),
        price,
        originalPrice,
        discountPercentage: toNumber(
          options.discountPercentage ?? product?.discountPercentage,
          0,
        ),
        promotionId: options.promotionId || product?.promotionId || null,
        promotionTitle:
          options.promotionTitle || product?.promotionTitle || null,
        promotionType: options.promotionType || product?.promotionType || null,
        hasPromotion,
        quantity,
        image: options.image || getProductImage(product),

        variantId: options.variantId || product?.variantId || null,
        variantSku:
          options.variantSku || product?.variantSku || product?.sku || '',
        variantSKU:
          options.variantSku || product?.variantSku || product?.sku || '',
        selectedAttributes:
          options.selectedAttributes ||
          options.variantAttributes ||
          product?.selectedAttributes ||
          product?.variantAttributes ||
          {},
        variantAttributes:
          options.variantAttributes ||
          options.selectedAttributes ||
          product?.variantAttributes ||
          product?.selectedAttributes ||
          {},
      }

      try {
        const result = await dispatch(addToCart(itemData)).unwrap()

        trackUserMetric({
          eventType: USER_METRIC_EVENTS.ADD_TO_CART,
          productId,
          value: price * quantity,
          quantity,
          currency,
          category: getProductCategory(product),
          items: [
            buildMetricItem({
              product,
              quantity,
              price,
            }),
          ],
          metadata: {
            title: getProductTitle(product),
            brand: getProductBrand(product),
            placement: options.placement || 'use_cart',
            variantId: itemData.variantId || '',
            variantSku: itemData.variantSku || '',
          },
        })

        toast.success('Producto agregado al carrito 🛒')
        return result
      } catch (error) {
        if (process.env.REACT_APP_DEBUG_API === 'true') {
          console.warn('[useCart] Error al agregar al carrito', error)
        }

        toast.error(
          error?.message ||
            error?.response?.data?.message ||
            'No se pudo agregar el producto.',
        )

        return null
      }
    },
    [dispatch, user],
  )

  const updateQuantity = useCallback(
    async (productId, quantity, options = {}) => {
      const normalizedQuantity = Math.trunc(toNumber(quantity, 0))

      if (!productId || normalizedQuantity < 1) return null

      try {
        return await dispatch(
          updateCartItem({
            productId,
            cartData: {
              quantity: normalizedQuantity,
              variantId: options.variantId || null,
              cartKey: options.cartKey || null,
            },
          }),
        ).unwrap()
      } catch (error) {
        toast.error(
          error?.message ||
            error?.response?.data?.message ||
            'No se pudo actualizar la cantidad.',
        )

        return null
      }
    },
    [dispatch],
  )

  const removeItem = useCallback(
    async (productId, options = {}) => {
      if (!productId) return null

      try {
        const payload =
          options.variantId || options.cartKey
            ? {
                productId,
                variantId: options.variantId || null,
                cartKey: options.cartKey || null,
              }
            : productId

        const result = await dispatch(removeCartItem(payload)).unwrap()

        trackUserMetric({
          eventType: USER_METRIC_EVENTS.REMOVE_FROM_CART,
          productId,
          quantity: toPositiveQuantity(options.quantity || 1),
          value: toNumber(options.value, 0),
          currency: options.currency || 'ARS',
          metadata: {
            title: options.title || '',
            placement: options.placement || 'use_cart',
            variantId: options.variantId || '',
            cartKey: options.cartKey || '',
          },
        })

        toast.info('Producto eliminado del carrito.')
        return result
      } catch (error) {
        toast.error(
          error?.message ||
            error?.response?.data?.message ||
            'No se pudo eliminar el producto.',
        )

        return null
      }
    },
    [dispatch],
  )

  const clearCart = useCallback(async () => {
    try {
      const result = await dispatch(emptyCart()).unwrap()

      toast.info('Carrito vaciado.')
      return result
    } catch (error) {
      toast.error(
        error?.message ||
          error?.response?.data?.message ||
          'No se pudo vaciar el carrito.',
      )

      return null
    }
  }, [dispatch])

  const totalAmount = useMemo(() => {
    if (toNumber(totalAfterDiscount, 0) > 0)
      return toNumber(totalAfterDiscount, 0)
    if (toNumber(cartTotal, 0) > 0) return toNumber(cartTotal, 0)

    return normalizedCartItems.reduce((acc, item) => {
      const price = toNumber(
        item?.price ??
          item?.selectedVariant?.price ??
          item?.productId?.price ??
          item?.product?.price,
        0,
      )

      const quantity = toPositiveQuantity(item?.quantity || item?.count || 1)

      return acc + price * quantity
    }, 0)
  }, [normalizedCartItems, cartTotal, totalAfterDiscount])

  return {
    cartItems: normalizedCartItems,
    cartTotal: totalAmount,
    rawCartTotal: cartTotal,
    totalAfterDiscount,
    appliedCoupon,
    isLoading,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    reloadCart,
  }
}

export default useCart
