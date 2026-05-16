// 📄 src/hooks/useCart.js
import { useDispatch, useSelector } from 'react-redux'
import { useCallback, useMemo } from 'react'
import { toast } from 'react-toastify'
import {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
  emptyCart,
} from '@features/cart/cartSlice'

export const useCart = () => {
  const dispatch = useDispatch()
  const { cartItems, cartTotal, isLoading } = useSelector(state => state.cart || {})
  const user = useSelector(state => state.user?.user || null)

  // === Agregar producto ===
  const addItem = useCallback(
    async product => {
      const itemData = {
        productId: product._id,
        title: product.title,
        price: product.price,
        quantity: 1,
        image: product?.images?.[0]?.url || '/assets/images/placeholder.png',
      }

      try {
        if (user) {
          await dispatch(addToCart(itemData)).unwrap()
          toast.success('Producto agregado al carrito 🛒')
        } else {
          toast.info('Debes iniciar sesión para guardar tu carrito.')
        }
      } catch (err) {
        console.error('Error al agregar al carrito:', err)
        toast.error('No se pudo agregar el producto.')
      }
    },
    [dispatch, user],
  )

  // === Otros métodos intactos ===
  const updateQuantity = useCallback(
    async (productId, quantity) => {
      if (quantity < 1) return
      await dispatch(updateCartItem({ productId, cartData: { quantity } }))
    },
    [dispatch],
  )

  const removeItem = useCallback(
    async productId => {
      await dispatch(removeCartItem(productId))
      toast.info('Producto eliminado del carrito.')
    },
    [dispatch],
  )

  const clearCart = useCallback(async () => {
    await dispatch(emptyCart())
    toast.info('Carrito vaciado.')
  }, [dispatch])

  const totalAmount = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.price * item.quantity, 0),
    [cartItems],
  )

  return {
    cartItems,
    cartTotal: totalAmount,
    isLoading,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
  }
}

export default useCart
