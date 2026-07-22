// src/hooks/useCoupon.js
import { useState, useCallback, useRef } from 'react'
import couponPublicApi from '../services/couponApi.public'

/**
 * Hook profesional para manejo de cupones
 * Integra validación manual, cupones por producto y tracking de aplicabilidad
 */
export const useCoupon = () => {
  // ============ ESTADOS PRINCIPALES ============
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [discount, setDiscount] = useState(0)
  const [validating, setValidating] = useState(false)
  const [error, setError] = useState(null)

  // Estados para product coupons (vista de producto individual)
  const [productCoupons, setProductCoupons] = useState([])
  const [bestDeal, setBestDeal] = useState(null)
  const [loadingProductCoupons, setLoadingProductCoupons] = useState(false)

  // Cache con TTL
  const couponsCache = useRef(new Map())
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

  // ============ HELPERS INTERNOS ============

  /**
   * Extrae y normaliza applicableProducts de la respuesta del backend
   */
  const extractApplicableProducts = result => {
    // Opción 1: Viene en applicableItems.items (estructura nueva del controller)
    if (result.applicableItems?.items?.length > 0) {
      return result.applicableItems.items.map(item => ({
        productId: item.productId || item.id || item._id,
        name: item.name || item.title,
        price: item.price,
        quantity: item.quantity,
      }))
    }

    // Opción 2: Viene directo en applicableProducts (estructura alternativa)
    if (result.applicableProducts?.length > 0) {
      return result.applicableProducts.map(id => ({ productId: id }))
    }

    // Opción 3: Viene en coupon.applicableProducts
    if (result.coupon?.applicableProducts?.length > 0) {
      return result.coupon.applicableProducts.map(id => ({ productId: id }))
    }

    return [] // Sin restricciones = aplica a todo
  }

  /**
   * Verifica si un producto específico es aplicable al cupón actual
   */
  const isProductApplicable = useCallback(
    productId => {
      if (!appliedCoupon?.applicableProducts?.length) return true // Sin restricciones
      return appliedCoupon.applicableProducts.some(
        p => p.productId === productId || p === productId,
      )
    },
    [appliedCoupon],
  )

  // ============ VALIDACIÓN MANUAL ============

  const validateCoupon = useCallback(async (code, cart) => {
    setError(null)

    if (!code?.trim()) {
      setError('Ingresa un código de cupón')
      return { valid: false, error: 'MISSING_CODE' }
    }

    if (!cart?.items?.length) {
      setError('Agrega productos al carrito primero')
      return { valid: false, error: 'EMPTY_CART' }
    }

    setValidating(true)

    try {
      const subtotal = cart.items.reduce(
        (sum, item) => sum + (item.price || 0) * (item.quantity || 1),
        0,
      )

      const result = await couponPublicApi.validate(code, {
        items: cart.items,
        subtotal,
        userId: cart.userId,
      })

      // Manejar respuesta no válida
      if (!result.valid) {
        setError(result.message || 'Cupón no válido')
        setAppliedCoupon(null)
        setDiscount(0)
        return {
          valid: false,
          error: result.code || 'INVALID_COUPON',
          message: result.message,
        }
      }

      // Verificar que aplique a algo
      const hasApplicableItems = (result.applicableItems?.count || 0) > 0

      if (!hasApplicableItems) {
        setError('Este cupón no aplica a ningún producto de tu carrito')
        return { valid: false, error: 'NOT_APPLICABLE' }
      }

      // ✅ EXTRAER applicableProducts AQUÍ
      const applicableProducts = extractApplicableProducts(result)

      // Construir objeto completo del cupón aplicado
      const couponData = {
        // Identificación
        code: result.coupon?.code || result.code || code,
        id: result.coupon?.id || result.couponId,

        // Datos del descuento
        discountType: result.coupon?.discountType || result.discountType,
        discountValue: result.coupon?.discountValue || result.discountValue,
        discountAmount: result.discountAmount,
        description: result.coupon?.description || result.description,

        // ✅ CRÍTICO: Productos a los que aplica
        applicableProducts, // ← Array de { productId, name, price, quantity }
        applicableItemsCount:
          result.applicableItems?.count || applicableProducts.length,

        // Totales
        originalTotal: result.originalTotal || subtotal,
        newTotal:
          result.newTotal || Math.max(0, subtotal - result.discountAmount),
        savings: result.savings || result.discountAmount,

        // Metadata
        valid: true,
        appliedAt: new Date().toISOString(),
      }

      setAppliedCoupon(couponData)
      setDiscount(result.discountAmount)

      return { valid: true, data: couponData }
    } catch (err) {
      const errorMsg = err.message || 'Error al validar cupón'
      setError(errorMsg)
      setAppliedCoupon(null)
      setDiscount(0)
      return { valid: false, error: 'SERVER_ERROR', message: errorMsg }
    } finally {
      setValidating(false)
    }
  }, [])

  // ============ CUPONES POR PRODUCTO ============

  const fetchProductCoupons = useCallback(
    async (productId, userId = null, options = {}) => {
      const {
        autoApplyBest = false,
        cart = null,
        cacheTime = CACHE_TTL,
        onSuccess,
        onError,
      } = options

      if (!productId) {
        setProductCoupons([])
        setBestDeal(null)
        return { success: false, coupons: [], bestDeal: null }
      }

      const cacheKey = `${productId}-${userId || 'guest'}`
      const now = Date.now()

      // Verificar cache
      const cached = couponsCache.current.get(cacheKey)
      if (cached && now - cached.timestamp < cacheTime) {
        const { coupons, bestDeal: cachedBest } = cached.data
        setProductCoupons(coupons)
        setBestDeal(cachedBest)

        if (autoApplyBest && cachedBest?.userCanUse && cart) {
          await applyBestDeal(cachedBest, cart)
        }

        onSuccess?.(cached.data)
        return { success: true, ...cached.data, fromCache: true }
      }

      setLoadingProductCoupons(true)
      setError(null)

      try {
        const response = await couponPublicApi.getProductCoupons(
          productId,
          userId,
        )

        // Normalizar respuesta
        const coupons = Array.isArray(response)
          ? response
          : response.data || response.coupons || []

        const bestDealData =
          response.bestDeal || (coupons.length > 0 ? coupons[0] : null)

        // Enriquecer coupons con flag isSpecific
        const enrichedCoupons = coupons.map(c => ({
          ...c,
          isSpecific:
            c.applicableProducts?.length > 0 ||
            c.applicableCategories?.length > 0,
        }))

        setProductCoupons(enrichedCoupons)
        setBestDeal(bestDealData)

        // Guardar en cache
        couponsCache.current.set(cacheKey, {
          data: { coupons: enrichedCoupons, bestDeal: bestDealData },
          timestamp: now,
        })

        if (
          autoApplyBest &&
          bestDealData?.userCanUse &&
          cart?.items?.length > 0
        ) {
          await applyBestDeal(bestDealData, cart)
        }

        const result = {
          success: true,
          coupons: enrichedCoupons,
          bestDeal: bestDealData,
        }
        onSuccess?.(result)
        return result
      } catch (err) {
        const errorMsg = err.message || 'Error al cargar cupones'
        setError(errorMsg)
        setProductCoupons([])
        setBestDeal(null)
        onError?.(err)
        return { success: false, error: errorMsg, coupons: [], bestDeal: null }
      } finally {
        setLoadingProductCoupons(false)
      }
    },
    [],
  )

  const applyBestDeal = useCallback(
    async (bestDealData, cart) => {
      if (!bestDealData?.userCanUse) return false
      const result = await validateCoupon(bestDealData.code, cart)
      return result.valid
    },
    [validateCoupon],
  )

  // ============ GESTIÓN Y UTILIDADES ============

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null)
    setDiscount(0)
    setError(null)
  }, [])

  const calculateTotal = useCallback(
    subtotal => {
      return Math.max(0, (subtotal || 0) - discount)
    },
    [discount],
  )

  const clearProductCoupons = useCallback(() => {
    setProductCoupons([])
    setBestDeal(null)
  }, [])

  const invalidateCache = useCallback((productId, userId = null) => {
    const cacheKey = `${productId}-${userId || 'guest'}`
    couponsCache.current.delete(cacheKey)
  }, [])

  // ============ SELECTORES DERIVADOS ============

  const applicableCoupons = productCoupons.filter(c => c.userCanUse !== false)
  const expiredCoupons = productCoupons.filter(c => c.userCanUse === false)

  // Productos específicos vs generales
  const specificCoupons = productCoupons.filter(c => c.isSpecific)
  const generalCoupons = productCoupons.filter(c => !c.isSpecific)

  // Verificar si el cupón actual es específico
  const isCurrentCouponSpecific = appliedCoupon?.applicableProducts?.length > 0

  return {
    // Estados principales
    appliedCoupon,
    discount,
    validating,
    error,

    // Estados de producto
    productCoupons,
    bestDeal,
    loadingProductCoupons,

    // Acciones
    validateCoupon,
    fetchProductCoupons,
    removeCoupon,
    calculateTotal,
    clearProductCoupons,
    invalidateCache,
    applyBestDeal,
    isProductApplicable, // ← NUEVO: función para verificar producto específico
    setError,

    // Flags
    hasCoupon: !!appliedCoupon,
    hasProductCoupons: productCoupons.length > 0,
    hasApplicableCoupons: applicableCoupons.length > 0,
    canUseBestDeal: bestDeal?.userCanUse !== false,
    isAutoApplied: appliedCoupon?.autoApplied || false,
    isCurrentCouponSpecific, // ← NUEVO: si el cupón aplicado es específico

    // Listas filtradas
    applicableCoupons,
    expiredCoupons,
    specificCoupons,
    generalCoupons,
  }
}

export default useCoupon
