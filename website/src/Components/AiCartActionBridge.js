// 📁 website/src/components/ai/AiCartActionBridge.jsx
import { useCallback, useEffect } from 'react'
import { useDispatch } from 'react-redux'
import {
  clearPendingAiCartAction,
  dispatchAiCartActionResultEvent,
  getAiAddToCartEventName,
  normalizeAiCartAction,
  readPendingAiCartAction,
  savePendingAiCartAction,
} from '@utils/aiCartActionUtils'
import { addOrUpdateCartItem, getCart } from '@features/cart/cartSlice'

const AI_EVENT_NAMESPACE =
  process.env.REACT_APP_AI_EVENT_NAMESPACE || 'commerce:ai'

const AI_ADD_TO_CART_EVENT = `${AI_EVENT_NAMESPACE}:add-to-cart`
const AI_CART_ACTION_RESULT_EVENT = `${AI_EVENT_NAMESPACE}:cart-action-result`

const clean = value => String(value || '').trim()

const notifyResult = detail => {
  if (typeof window === 'undefined') return
  dispatchAiCartActionResultEvent(detail)
}

const isSafeUrl = url => {
  const cleanUrl = clean(url)

  if (!cleanUrl) return false

  // Permitimos rutas internas relativas.
  if (cleanUrl.startsWith('/')) return true

  try {
    const parsed = new window.URL(cleanUrl)
    return parsed.origin === window.location.origin
  } catch {
    return false
  }
}

const AiCartActionBridge = () => {
  const dispatch = useDispatch()

  const processAction = useCallback(
    async rawAction => {
      const action = normalizeAiCartAction(rawAction)

      if (!action?.productId) {
        notifyResult({
          success: false,
          code: 'AI_CART_PRODUCT_MISSING',
          message:
            'No se pudo identificar el producto para agregar al carrito.',
          action,
        })

        return false
      }

      try {
        await dispatch(
          addOrUpdateCartItem({
            productId: action.productId,
            variantId: action.variantId || undefined,
            variantSku: action.variantSku || undefined,
            variantSKU: action.variantSku || undefined,
            quantity: Number(action.quantity || 1),
            selectedAttributes: action.selectedAttributes || {},
            variantAttributes: action.selectedAttributes || {},
            source: 'ai_agent',
          }),
        ).unwrap()

        try {
          await dispatch(getCart()).unwrap()
        } catch {
          // No bloqueamos la experiencia si falla el refresh.
        }

        clearPendingAiCartAction()

        notifyResult({
          success: true,
          code: 'AI_CART_ITEM_ADDED',
          message: 'Producto agregado al carrito.',
          action,
        })

        return true
      } catch (error) {
        console.error('[AI_CART_ACTION_BRIDGE_ERROR]', {
          message: error?.message,
          action,
        })

        savePendingAiCartAction(action)

        notifyResult({
          success: false,
          code: 'AI_CART_ADD_FAILED',
          message:
            error?.message ||
            'No se pudo agregar automáticamente. Podés continuar desde el producto.',
          action,
        })

        if (action.url && isSafeUrl(action.url)) {
          window.setTimeout(() => {
            window.location.href = action.url
          }, 900)
        }

        return false
      }
    },
    [dispatch],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const pendingAction = readPendingAiCartAction()

    if (pendingAction) {
      processAction(pendingAction)
    }

    const handleAiAddToCart = event => {
      processAction(event.detail)
    }

    const eventName = getAiAddToCartEventName()

    window.addEventListener(eventName, handleAiAddToCart)

    return () => {
      window.removeEventListener(eventName, handleAiAddToCart)
    }
  }, [processAction])

  return null
}

export default AiCartActionBridge
