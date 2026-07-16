// 📁 src/pages/CheckoutPage.jsx
// VERSIÓN GO PRODUCCIÓN - CHECKOUT / CUPONES / MERCADO PAGO / DATOS BÁSICOS DE ENTREGA / MULTI-TENANT

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Backdrop,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Fade,
  Grid,
  IconButton,
  Link as MuiLink,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import { Close } from '@mui/icons-material'
import {
  ArrowBackIos,
  AutoAwesome,
  CheckCircleOutline,
  ContentCopy,
  LocalOfferOutlined,
  LocalShipping,
  LockOutlined,
  NavigateNext,
  ShoppingBagOutlined,
} from '@mui/icons-material'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { CardPayment, initMercadoPago } from '@mercadopago/sdk-react'
import ReactGA from 'react-ga4'

import { applyCoupon, resetCouponState } from '@features/coupon/couponSlice'
import {
  processPaymentAction,
  resetPayment,
} from '@features/payment/paymentSlice'
import { createOrder, resetOrderState } from '@features/orders/orderSlice'
import { getMe } from '@features/user/userSlice'
import { useCoupon } from '@hooks/useCoupon'
import env from '../config/env'
import {
  trackUserMetric,
  USER_METRIC_EVENTS,
} from '../services/userMetricsService'
import { getActiveThemeConfig, getThemeColors } from '@utils/themeRuntime'

// ======================================================
// CONSTANTES
// ======================================================

const STEPS = ['Revisión', 'Entrega', 'Pago', 'Confirmación']
const METRIC_CURRENCY = 'ARS'
const DEBUG_CHECKOUT = process.env.REACT_APP_DEBUG_API === 'true'

const debugLog = (...args) => {
  if (DEBUG_CHECKOUT) console.log(...args)
}

const debugError = (...args) => {
  if (DEBUG_CHECKOUT) console.error(...args)
}

const scrollToTop = () => {
  if (typeof window === 'undefined') return

  window.requestAnimationFrame(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'smooth',
    })
  })
}

// ======================================================
// HELPERS GENERALES
// ======================================================

const toNumber = (value, defaultValue = 0) => {
  if (value === undefined || value === null || value === '') return defaultValue

  const num = Number(value)

  return Number.isFinite(num) ? num : defaultValue
}

const roundMoney = value => {
  const num = toNumber(value, 0)

  return Math.round((num + Number.EPSILON) * 100) / 100
}

const clampMoney = value => {
  return Math.max(0, roundMoney(value))
}

const formatMoney = value => {
  const num = roundMoney(value)

  return `$${num.toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

const sanitizeText = value => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

const pickFirst = (...values) => {
  for (const value of values) {
    const clean = sanitizeText(value)
    if (clean) return clean
  }

  return ''
}

const normalizeId = value => {
  if (!value) return ''

  if (typeof value === 'object') {
    return String(value._id || value.id || value.productId || '')
  }

  return String(value)
}

const buildShippingDataFromUser = user => {
  if (!user) return null

  const fullName = pickFirst(
    user.name,
    user.fullName,
    user.displayName,
    user.profile?.name,
    user.profile?.fullName,
  )

  const [nameFirstPart, ...nameRest] = fullName.split(' ').filter(Boolean)

  return {
    firstName: pickFirst(
      user.firstName,
      user.firstname,
      user.nombre,
      user.profile?.firstName,
      user.profile?.firstname,
      user.profile?.nombre,
      nameFirstPart,
    ),

    lastName: pickFirst(
      user.lastName,
      user.lastname,
      user.apellido,
      user.profile?.lastName,
      user.profile?.lastname,
      user.profile?.apellido,
      nameRest.join(' '),
    ),

    email: pickFirst(user.email, user.profile?.email),

    phone: pickFirst(
      user.phone,
      user.mobile,
      user.telefono,
      user.profile?.phone,
      user.profile?.mobile,
      user.profile?.telefono,
    ),
  }
}

const getItemId = item => {
  return normalizeId(item?.productId || item?._id || item?.id || item?.product)
}

const getItemTitle = item => {
  return (
    item?.title ||
    item?.name ||
    item?.titleSnapshot ||
    item?.productTitle ||
    item?.product?.title ||
    item?.product?.name ||
    'Producto'
  )
}

const getItemImage = item => {
  if (!item) return null

  if (typeof item.image === 'string') return item.image
  if (item.image?.url) return item.image.url
  if (item.imageSnapshot) return item.imageSnapshot

  if (Array.isArray(item.images) && item.images[0]) {
    if (typeof item.images[0] === 'string') return item.images[0]
    return item.images[0]?.url || item.images[0]?.secure_url || null
  }

  if (item.product?.images?.[0]) {
    if (typeof item.product.images[0] === 'string')
      return item.product.images[0]
    return (
      item.product.images[0]?.url || item.product.images[0]?.secure_url || null
    )
  }

  return null
}

const getItemUnitPrice = item => {
  const quantity = Math.max(1, toNumber(item?.quantity || item?.count, 1))

  if (item?.unitPriceCents !== undefined)
    return clampMoney(item.unitPriceCents / 100)
  if (item?.priceCents !== undefined) return clampMoney(item.priceCents / 100)
  if (item?.subtotalCents !== undefined) {
    return clampMoney(item.subtotalCents / 100 / quantity)
  }

  return clampMoney(
    item?.finalPrice ??
      item?.discountedPrice ??
      item?.priceWithDiscount ??
      item?.salePrice ??
      item?.unitPrice ??
      item?.price ??
      item?.product?.finalPrice ??
      item?.product?.discountedPrice ??
      item?.product?.price ??
      0,
  )
}

const getItemOriginalPrice = item => {
  const original = clampMoney(
    item?.originalPrice ??
      item?.regularPrice ??
      item?.compareAtPrice ??
      (item?.originalPriceCents !== undefined
        ? item.originalPriceCents / 100
        : undefined) ??
      item?.product?.originalPrice ??
      item?.product?.regularPrice ??
      item?.product?.compareAtPrice ??
      0,
  )

  const unitPrice = getItemUnitPrice(item)

  return original > unitPrice ? original : null
}

const getItemQuantity = item => {
  return Math.max(1, toNumber(item?.quantity || item?.count, 1))
}

const getPaymentErrorMessage = result => {
  if (typeof result === 'string') return result

  const code = result?.code
  const message = result?.message || result?.error || result?.status_detail

  if (
    code === 'MP_CREDENTIALS_INVALID' ||
    code === 'MP_CREDENTIALS_NOT_FOUND' ||
    code === 'MP_ACCESS_TOKEN_INVALID'
  ) {
    return 'Mercado Pago no está configurado correctamente para este comercio.'
  }

  if (code === 'CARD_TOKEN_INVALID') {
    return 'El token de la tarjeta expiró o no es válido. Reintentá ingresando la tarjeta nuevamente.'
  }

  if (result?.status === 'rejected') {
    return message || 'Pago rechazado por Mercado Pago.'
  }

  return message || 'No se pudo procesar el pago.'
}

// ======================================================
// HELPERS CUPÓN
// ======================================================

const normalizeCouponPayload = raw => {
  if (!raw) return null
  console.log(raw)
  const data = raw.data || raw.payload || raw
  const coupon = data.coupon || data.appliedCoupon || data

  const discountType = String(
    coupon.discountType ||
      coupon.type ||
      data.discountType ||
      data.type ||
      'fixed',
  ).toLowerCase()

  const discountValue =
    coupon.discountValue ??
    coupon.value ??
    coupon.amount ??
    coupon.percentage ??
    data.discountValue ??
    data.value ??
    data.amount ??
    data.percentage ??
    0

  const backendAppliedDiscount =
    data.discountAmount ??
    data.calculatedDiscount ??
    coupon.calculatedDiscount ??
    coupon.discountAmount ??
    null

  const applicableProducts =
    coupon.applicableProducts || data.applicableProducts || []

  return {
    ...coupon,
    code: String(coupon.code || data.code || '').toUpperCase(),
    discountType,
    discountValue: clampMoney(discountValue),
    backendAppliedDiscount:
      backendAppliedDiscount !== null && backendAppliedDiscount !== undefined
        ? clampMoney(backendAppliedDiscount)
        : null,
    minPurchaseAmount: clampMoney(
      coupon.minPurchaseAmount ?? data.minPurchaseAmount ?? 0,
    ),
    maxDiscountAmount:
      coupon.maxDiscountAmount !== undefined ||
      data.maxDiscountAmount !== undefined
        ? clampMoney(coupon.maxDiscountAmount ?? data.maxDiscountAmount ?? 0)
        : null,
    applicableProducts: Array.isArray(applicableProducts)
      ? applicableProducts.map(normalizeId).filter(Boolean)
      : [],
    isSpecific: Boolean(
      coupon.isSpecific ||
      data.isSpecific ||
      (Array.isArray(applicableProducts) && applicableProducts.length > 0),
    ),
    specificProductId: normalizeId(
      coupon.specificProductId ||
        data.specificProductId ||
        applicableProducts?.[0],
    ),
    specificProductName:
      coupon.specificProductName || data.specificProductName || null,
  }
}

const validateCouponProducts = (coupon, cartItems) => {
  const restrictions = Array.isArray(coupon?.applicableProducts)
    ? coupon.applicableProducts.map(normalizeId).filter(Boolean)
    : []

  if (restrictions.length === 0) {
    return {
      valid: true,
      applicableItems: cartItems,
      reason: 'Sin restricciones',
      hasProductRestriction: false,
    }
  }

  const applicableItems = cartItems.filter(item => {
    return restrictions.includes(getItemId(item))
  })

  if (applicableItems.length === 0) {
    return {
      valid: false,
      applicableItems: [],
      reason: 'Este cupón no aplica a ningún producto de tu carrito',
      hasProductRestriction: true,
    }
  }

  return {
    valid: true,
    applicableItems,
    reason: 'Aplica a productos seleccionados',
    hasProductRestriction: true,
  }
}

const calculateNominalCouponDiscount = ({ coupon, applicableSubtotal }) => {
  if (!coupon || coupon.discountValue <= 0) return 0

  if (coupon.discountType === 'percentage') {
    return clampMoney(applicableSubtotal * (coupon.discountValue / 100))
  }

  return clampMoney(coupon.discountValue)
}

const normalizeOrderPayload = result => {
  const data = result?.data || result?.payload || result

  return (
    data?.order ||
    data?.data?.order ||
    data?.payload?.order ||
    data?.data ||
    data
  )
}

const normalizePaymentPayload = result => {
  const data = result?.data || result?.payload || result

  return (
    data?.payment ||
    data?.data?.payment ||
    data?.payload?.payment ||
    data?.data ||
    data
  )
}

const getOrderDisplayId = order => {
  return normalizeId(
    order?.orderNumber ||
      order?.number ||
      order?.code ||
      order?._id ||
      order?.id ||
      order?.orderId,
  )
}

const getPaymentDisplayId = payment => {
  return normalizeId(
    payment?.id || payment?.paymentId || payment?.transactionId,
  )
}

const getPaymentStatusValue = payment => {
  return String(
    payment?.status || payment?.paymentStatus || payment?.state || '',
  ).toLowerCase()
}

const getPaymentStatusDetailValue = payment => {
  return String(
    payment?.status_detail || payment?.statusDetail || payment?.detail || '',
  ).toLowerCase()
}

const isApprovedPayment = payment => {
  const status = getPaymentStatusValue(payment)
  const statusDetail = getPaymentStatusDetailValue(payment)

  return (
    payment?.success === true ||
    payment?.approved === true ||
    status === 'approved' ||
    status === 'accredited' ||
    statusDetail === 'approved' ||
    statusDetail === 'accredited'
  )
}

const isPendingPayment = payment => {
  const status = getPaymentStatusValue(payment)

  return ['pending', 'in_process', 'in_process_payment'].includes(status)
}

const normalizeVariantLabel = item => {
  const variant =
    item?.variant || item?.selectedVariant || item?.product?.variant

  if (!variant) return ''
  if (typeof variant === 'string') return variant

  const attributes =
    variant.attributes || variant.combinacion || variant.options

  if (
    attributes &&
    typeof attributes === 'object' &&
    !Array.isArray(attributes)
  ) {
    return Object.entries(attributes)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ')
  }

  return pickFirst(variant.name, variant.title, variant.sku, variant.key)
}

const buildConfirmationItems = items => {
  return (Array.isArray(items) ? items : []).map(item => {
    const quantity = getItemQuantity(item)
    const unitPrice = getItemUnitPrice(item)

    return {
      productId: getItemId(item),
      title: getItemTitle(item),
      image: getItemImage(item),
      quantity,
      unitPrice,
      originalPrice: getItemOriginalPrice(item),
      subtotal: clampMoney(unitPrice * quantity),
      sku: pickFirst(
        item?.sku,
        item?.variantSku,
        item?.selectedVariant?.sku,
        item?.product?.sku,
      ),
      variantLabel: normalizeVariantLabel(item),
    }
  })
}

const buildConfirmationSnapshot = ({
  order,
  payment,
  cartItems,
  shippingData,
  subtotal,
  discount,
  total,
  appliedCoupon,
  user,
}) => {
  const normalizedOrder = normalizeOrderPayload(order) || {}
  const normalizedPayment = normalizePaymentPayload(payment) || {}
  const orderItems = Array.isArray(normalizedOrder.items)
    ? normalizedOrder.items
    : Array.isArray(normalizedOrder.products)
      ? normalizedOrder.products
      : []
  const sourceItems =
    Array.isArray(cartItems) && cartItems.length > 0 ? cartItems : orderItems
  const items = buildConfirmationItems(sourceItems)

  const customer = {
    firstName: pickFirst(
      shippingData?.firstName,
      user?.firstName,
      user?.nombre,
    ),
    lastName: pickFirst(shippingData?.lastName, user?.lastName, user?.apellido),
    email: pickFirst(shippingData?.email, user?.email),
    phone: pickFirst(shippingData?.phone, user?.phone, user?.telefono),
  }

  return {
    order: normalizedOrder,
    payment: normalizedPayment,
    customer,
    items,
    totals: {
      subtotal: clampMoney(subtotal ?? normalizedOrder.subtotal ?? 0),
      discount: clampMoney(
        discount ??
          normalizedOrder.discount ??
          normalizedOrder.discountAmount ??
          0,
      ),
      total: clampMoney(
        total ?? normalizedOrder.total ?? normalizedOrder.totalAmount ?? 0,
      ),
    },
    coupon: appliedCoupon
      ? {
          code: appliedCoupon.code,
          discountType: appliedCoupon.discountType,
          discountValue: appliedCoupon.discountValue,
        }
      : null,
    createdAt: new Date().toISOString(),
  }
}

const buildMetricItems = cartItems => {
  return cartItems.map(item => {
    const quantity = getItemQuantity(item)
    const price = getItemUnitPrice(item)

    return {
      productId: getItemId(item),
      title: getItemTitle(item),
      sku: item?.sku || item?.variantSku || item?.selectedVariant?.sku || '',
      quantity,
      price,
      subtotal: clampMoney(price * quantity),
    }
  })
}

// ======================================================
// COMPONENTE PRINCIPAL
// ======================================================

const CheckoutPage = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const purchaseTrackedRef = useRef(false)
  const gaPurchaseTrackedRef = useRef(false)

  const [activeStep, setActiveStep] = useState(0)
  const [availableCoupons, setAvailableCoupons] = useState([])
  const [couponInput, setCouponInput] = useState('')
  const [formErrors, setFormErrors] = useState({})
  const [localCouponError, setLocalCouponError] = useState(null)
  const [showAllCoupons, setShowAllCoupons] = useState(false)
  const [checkoutOrder, setCheckoutOrder] = useState(null)
  const [confirmationData, setConfirmationData] = useState(null)

  const [mpReady, setMpReady] = useState(false)
  const [mpInitError, setMpInitError] = useState(null)

  const [profileBootstrapLoading, setProfileBootstrapLoading] = useState(false)
  const [profileBootstrapDone, setProfileBootstrapDone] = useState(false)
  const [shippingAutoFilled, setShippingAutoFilled] = useState(false)

  const [paymentStatus, setPaymentStatus] = useState({
    completed: false,
    data: null,
    timestamp: null,
  })

  const [shippingData, setShippingData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
  })

  // ======================================================
  // SELECTORES REDUX
  // ======================================================

  const cartState = useSelector(state => state.cart)
  const couponState = useSelector(state => state.coupon)
  const authState = useSelector(state => state.auth || {})
  const userState = useSelector(state => state.user || {})
  const orderState = useSelector(state => state.order || {})
  const paymentState = useSelector(state => state.payment || {})
  const themeState = useSelector(state => state.theme) || {}

  const activeThemeConfig = useMemo(
    () => getActiveThemeConfig(themeState),
    [themeState],
  )
  const themeColors = useMemo(
    () => getThemeColors(activeThemeConfig),
    [activeThemeConfig],
  )

  const { currentOrder, isLoading: orderLoading } = orderState

  const {
    isLoading: paymentLoading,
    isSuccess: paymentSuccess,
    isError: paymentError,
    message: paymentMessage,
    paymentResult: reduxPaymentResult,
  } = paymentState

  const user = useMemo(() => {
    return (
      authState.user ||
      authState.currentUser ||
      userState.user ||
      userState.currentUser ||
      userState.profile ||
      userState.userInfo ||
      null
    )
  }, [authState, userState])

  const isUserProfileLoading = profileBootstrapLoading

  const { fetchProductCoupons } = useCoupon()

  // ======================================================
  // CARGAR DATOS BÁSICOS DESDE USUARIO
  // ======================================================

  useEffect(() => {
    let isMounted = true

    const hydrateShippingFromProfile = async () => {
      if (profileBootstrapDone) return

      setProfileBootstrapLoading(true)

      try {
        let resolvedUser = user

        if (!resolvedUser?.email && typeof getMe === 'function') {
          const promise = dispatch(getMe())

          if (typeof promise?.unwrap === 'function') {
            const payload = await promise.unwrap()

            resolvedUser =
              payload?.data?.user ||
              payload?.data ||
              payload?.user ||
              payload ||
              resolvedUser
          } else {
            const action = await promise

            resolvedUser =
              action?.payload?.data?.user ||
              action?.payload?.data ||
              action?.payload?.user ||
              action?.payload ||
              resolvedUser
          }
        }

        if (!isMounted) return

        if (!resolvedUser) {
          setShippingAutoFilled(false)
          return
        }

        const nextShippingData = buildShippingDataFromUser(resolvedUser)

        setShippingData(prev => ({
          ...prev,
          ...nextShippingData,
        }))

        setShippingAutoFilled(true)

        debugLog('✅ Datos básicos cargados desde perfil:', {
          resolvedUser,
          nextShippingData,
        })
      } catch (error) {
        debugError('❌ No se pudo cargar el perfil del usuario:', error)

        if (!isMounted) return

        setShippingAutoFilled(false)
      } finally {
        if (isMounted) {
          setProfileBootstrapLoading(false)
          setProfileBootstrapDone(true)
        }
      }
    }

    hydrateShippingFromProfile()

    return () => {
      isMounted = false
    }
  }, [dispatch, user, profileBootstrapDone])

  // ======================================================
  // CARRITO NORMALIZADO
  // ======================================================

  const { cartItems, isLoading, subtotal, productIds, itemCount } =
    useMemo(() => {
      const items = cartState?.items || cartState?.cartItems || []

      const ids = items.map(getItemId).filter(Boolean)

      const calculatedSubtotal = items.reduce((acc, item) => {
        return acc + getItemUnitPrice(item) * getItemQuantity(item)
      }, 0)

      const count = items.reduce((acc, item) => {
        return acc + getItemQuantity(item)
      }, 0)

      return {
        cartItems: items,
        isLoading: cartState?.isLoading || false,
        productIds: ids,
        subtotal: clampMoney(calculatedSubtotal),
        itemCount: count,
      }
    }, [cartState])

  // ======================================================
  // CUPÓN NORMALIZADO
  // ======================================================

  const rawAppliedCoupon = couponState?.appliedCoupon

  const appliedCoupon = useMemo(() => {
    return normalizeCouponPayload(rawAppliedCoupon)
  }, [rawAppliedCoupon])

  const couponsByProduct = useMemo(() => {
    const map = new Map()

    if (!Array.isArray(availableCoupons)) return map

    availableCoupons.forEach(coupon => {
      const normalized = normalizeCouponPayload(coupon)

      if (normalized?.isSpecific && normalized.specificProductId) {
        map.set(normalized.specificProductId, normalized)
      }
    })

    return map
  }, [availableCoupons])

  const couponCalculation = useMemo(() => {
    if (!appliedCoupon) {
      return {
        valid: false,
        discount: 0,
        nominalDiscount: 0,
        clampedDiscount: false,
        applicableItems: [],
        reason: null,
        hasProductRestriction: false,
        savingsPercentage: 0,
        applicableSubtotal: 0,
      }
    }

    if (
      appliedCoupon.minPurchaseAmount > 0 &&
      subtotal < appliedCoupon.minPurchaseAmount
    ) {
      return {
        valid: false,
        discount: 0,
        nominalDiscount: 0,
        clampedDiscount: false,
        applicableItems: [],
        reason: `Monto mínimo de compra: ${formatMoney(appliedCoupon.minPurchaseAmount)}`,
        hasProductRestriction: false,
        savingsPercentage: 0,
        applicableSubtotal: 0,
      }
    }

    const productValidation = validateCouponProducts(appliedCoupon, cartItems)

    if (!productValidation.valid) {
      return {
        valid: false,
        discount: 0,
        nominalDiscount: 0,
        clampedDiscount: false,
        applicableItems: [],
        reason: productValidation.reason,
        hasProductRestriction: true,
        savingsPercentage: 0,
        applicableSubtotal: 0,
      }
    }

    const applicableItems = productValidation.applicableItems || []

    const applicableSubtotal = clampMoney(
      applicableItems.reduce((acc, item) => {
        return acc + getItemUnitPrice(item) * getItemQuantity(item)
      }, 0),
    )

    const nominalDiscount = calculateNominalCouponDiscount({
      coupon: appliedCoupon,
      applicableSubtotal,
    })

    const backendAppliedDiscount = appliedCoupon.backendAppliedDiscount

    let discount =
      backendAppliedDiscount !== null &&
      backendAppliedDiscount > 0 &&
      backendAppliedDiscount <= applicableSubtotal
        ? backendAppliedDiscount
        : nominalDiscount

    if (
      appliedCoupon.maxDiscountAmount &&
      appliedCoupon.maxDiscountAmount > 0 &&
      discount > appliedCoupon.maxDiscountAmount
    ) {
      discount = appliedCoupon.maxDiscountAmount
    }

    const unclampedDiscount = clampMoney(discount)
    discount = Math.min(unclampedDiscount, applicableSubtotal)
    discount = clampMoney(discount)

    const clampedDiscount = nominalDiscount > discount

    return {
      valid: discount > 0,
      discount,
      nominalDiscount,
      clampedDiscount,
      applicableItems,
      reason: productValidation.reason,
      hasProductRestriction: productValidation.hasProductRestriction,
      applicableSubtotal,
      savingsPercentage:
        subtotal > 0 ? clampMoney((discount / subtotal) * 100) : 0,
    }
  }, [appliedCoupon, cartItems, subtotal])

  const {
    valid: isCouponValid,
    discount: validDiscount,
    nominalDiscount = 0,
    clampedDiscount = false,
    applicableItems = [],
    reason: couponReason,
    hasProductRestriction,
    savingsPercentage = 0,
  } = couponCalculation || {}

  const total = useMemo(() => {
    return clampMoney(subtotal - validDiscount)
  }, [subtotal, validDiscount])

  const coupons = availableCoupons || []
  const activeOrder = checkoutOrder || currentOrder

  // ======================================================
  // MERCADO PAGO INIT
  // ======================================================

  useEffect(() => {
    const publicKey = String(
      env?.mercadoPagoPublicKey || process.env.REACT_APP_MP_PUBLIC_KEY || '',
    ).trim()

    if (!publicKey) {
      setMpReady(false)
      setMpInitError('Falta configurar la Public Key de Mercado Pago.')
      return
    }

    const validFormat =
      publicKey.startsWith('TEST-') || publicKey.startsWith('APP_USR-')

    if (!validFormat) {
      setMpReady(false)
      setMpInitError('La Public Key de Mercado Pago tiene formato inválido.')
      return
    }

    try {
      initMercadoPago(publicKey, {
        locale: 'es-AR',
      })

      setMpReady(true)
      setMpInitError(null)
    } catch (error) {
      debugError('Error inicializando Mercado Pago:', error)
      setMpReady(false)
      setMpInitError('No se pudo inicializar Mercado Pago.')
    }
  }, [])

  // ======================================================
  // DETECTAR CUPONES DISPONIBLES
  // ======================================================

  useEffect(() => {
    let isMounted = true

    const detectCouponsForCart = async () => {
      if (cartItems.length === 0 || appliedCoupon) {
        setAvailableCoupons([])
        return
      }

      try {
        const productSpecificCoupons = new Map()
        const generalCoupons = new Map()

        const requests = cartItems
          .map(item => {
            const productId = getItemId(item)

            if (!productId) return null

            return fetchProductCoupons(productId, user?._id)
              .then(result => ({
                result,
                productId,
                item,
              }))
              .catch(() => null)
          })
          .filter(Boolean)

        const responses = await Promise.all(requests)

        responses.filter(Boolean).forEach(({ result, productId, item }) => {
          const rawCoupons =
            result?.coupons ||
            result?.data?.coupons ||
            result?.data?.data?.coupons ||
            []

          if (!Array.isArray(rawCoupons) || rawCoupons.length === 0) return

          rawCoupons.forEach(rawCoupon => {
            const coupon = normalizeCouponPayload(rawCoupon)

            if (!coupon?.code) return

            const restrictions = coupon.applicableProducts || []
            const hasProductRestrictions = restrictions.length > 0

            const appliesToThisProduct =
              !hasProductRestrictions || restrictions.includes(productId)

            if (!appliesToThisProduct) return
            if (coupon.userCanUse === false) return

            const couponCode = coupon.code

            if (hasProductRestrictions) {
              if (!productSpecificCoupons.has(couponCode)) {
                productSpecificCoupons.set(couponCode, {
                  ...coupon,
                  specificProductId: productId,
                  specificProductName: getItemTitle(item),
                  isSpecific: true,
                })
              }
            } else if (!generalCoupons.has(couponCode)) {
              generalCoupons.set(couponCode, {
                ...coupon,
                isSpecific: false,
              })
            }
          })
        })

        const allCoupons = [
          ...productSpecificCoupons.values(),
          ...generalCoupons.values(),
        ].sort((a, b) => {
          const getValue = coupon => {
            if (coupon.discountType === 'percentage') {
              return subtotal * (coupon.discountValue / 100)
            }

            return coupon.discountValue
          }

          if (a.isSpecific && !b.isSpecific) return -1
          if (!a.isSpecific && b.isSpecific) return 1

          return getValue(b) - getValue(a)
        })

        if (isMounted) {
          setAvailableCoupons(allCoupons)
        }
      } catch (error) {
        debugError('Error detectando cupones:', error)
      }
    }

    if (activeStep === 0) {
      detectCouponsForCart()
    }

    return () => {
      isMounted = false
    }
  }, [
    cartItems,
    appliedCoupon,
    user?._id,
    activeStep,
    subtotal,
    fetchProductCoupons,
  ])

  useEffect(() => {
    if (appliedCoupon && !isCouponValid && !couponState.isLoading) {
      dispatch(resetCouponState())
      setLocalCouponError(
        couponReason || 'Este cupón no es válido para tu carrito',
      )
    }
  }, [
    appliedCoupon,
    isCouponValid,
    couponState.isLoading,
    dispatch,
    couponReason,
  ])

  useEffect(() => {
    if (couponInput) setLocalCouponError(null)
  }, [couponInput])

  useEffect(() => {
    const normalizedReduxPayment = normalizePaymentPayload(reduxPaymentResult)

    if (
      paymentSuccess &&
      isApprovedPayment(normalizedReduxPayment) &&
      !paymentStatus.completed
    ) {
      if (gaPurchaseTrackedRef.current) return
      gaPurchaseTrackedRef.current = true

      const confirmationSnapshot = buildConfirmationSnapshot({
        order: activeOrder,
        payment: normalizedReduxPayment,
        cartItems,
        shippingData,
        subtotal,
        discount: isCouponValid ? validDiscount : 0,
        total,
        appliedCoupon: isCouponValid ? appliedCoupon : null,
        user,
      })

      setConfirmationData(confirmationSnapshot)
      setPaymentStatus({
        completed: true,
        data: normalizedReduxPayment,
        timestamp: Date.now(),
      })

      setActiveStep(3)
      scrollToTop()

      ReactGA.event('purchase', {
        transaction_id: getPaymentDisplayId(normalizedReduxPayment),
        value: toNumber(confirmationSnapshot.totals.total, 0),
        currency: 'ARS',
        coupon: confirmationSnapshot.coupon?.code || null,
        items: confirmationSnapshot.items.map(item => ({
          item_id: item.productId,
          item_name: item.title,
          price: item.unitPrice,
          quantity: item.quantity,
        })),
      })
    }
  }, [
    paymentSuccess,
    reduxPaymentResult,
    paymentStatus.completed,
    activeOrder,
    total,
    subtotal,
    validDiscount,
    isCouponValid,
    appliedCoupon,
    cartItems,
    shippingData,
    user,
  ])

  // ======================================================
  // HANDLERS
  // ======================================================

  const applyCouponCode = useCallback(
    async rawCode => {
      const code = String(rawCode || '')
        .trim()
        .toUpperCase()

      if (!code) {
        setLocalCouponError('Ingresa un código de cupón')
        return
      }

      setLocalCouponError(null)

      try {
        const result = await dispatch(
          applyCoupon({
            code,
            items: cartItems.map(item => ({
              productId: getItemId(item),
              quantity: getItemQuantity(item),
              price: getItemUnitPrice(item),
            })),
            subtotal,
            productIds,
            userId: user?._id || null,
          }),
        ).unwrap()

        const normalized = normalizeCouponPayload(result)

        if (!normalized?.code) {
          setLocalCouponError('El cupón no tiene información válida')
          dispatch(resetCouponState())
          return
        }

        const productValidation = validateCouponProducts(normalized, cartItems)

        if (!productValidation.valid) {
          dispatch(resetCouponState())
          setLocalCouponError(productValidation.reason)
          return
        }

        setCouponInput('')
        setAvailableCoupons([])
      } catch (error) {
        debugError('❌ Error aplicando cupón:', error)

        setLocalCouponError(
          typeof error === 'string'
            ? error
            : error?.message ||
                error?.response?.data?.message ||
                'Error al aplicar cupón',
        )
      }
    },
    [dispatch, cartItems, subtotal, productIds, user?._id],
  )

  const handleApplyCoupon = useCallback(() => {
    return applyCouponCode(couponInput)
  }, [applyCouponCode, couponInput])

  const handleApplySpecificCoupon = useCallback(
    coupon => {
      return applyCouponCode(coupon?.code)
    },
    [applyCouponCode],
  )

  const handleRemoveCoupon = useCallback(() => {
    dispatch(resetCouponState())
    setCouponInput('')
    setLocalCouponError(null)
    setAvailableCoupons([])
  }, [dispatch])

  const handleCopyCode = async code => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      debugError('Error copiando cupón')
    }
  }

  const handleShippingFieldChange = useCallback(
    (field, value) => {
      setShippingData(prev => ({
        ...prev,
        [field]: value,
      }))

      if (formErrors[field]) {
        setFormErrors(prev => ({
          ...prev,
          [field]: null,
        }))
      }
    },
    [formErrors],
  )

  const validateShippingForm = useCallback(() => {
    const errors = {}

    const required = ['firstName', 'lastName', 'phone', 'email']

    required.forEach(field => {
      if (!sanitizeText(shippingData[field])) {
        errors[field] = 'Este dato es obligatorio'
      }
    })

    if (
      shippingData.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shippingData.email)
    ) {
      errors.email = 'Email inválido'
    }

    if (
      shippingData.phone &&
      shippingData.phone.replace(/\D/g, '').length < 8
    ) {
      errors.phone = 'Teléfono inválido'
    }

    setFormErrors(errors)

    return Object.keys(errors).length === 0
  }, [shippingData])

  const handleGoToPayment = async () => {
    if (!validateShippingForm()) {
      const firstError = document.querySelector('[data-error="true"]')
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    const metricItems = buildMetricItems(cartItems)

    trackUserMetric({
      eventType: USER_METRIC_EVENTS.CHECKOUT_STEP,
      value: toNumber(total, 0),
      currency: METRIC_CURRENCY,
      quantity: itemCount,
      items: metricItems,
      commerce: {
        cartValue: toNumber(subtotal, 0),
        orderValue: toNumber(total, 0),
        discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
        itemsCount: itemCount,
      },
      metadata: {
        step: 'shipping_submitted',
        coupon: isCouponValid ? appliedCoupon?.code : '',
      },
    })

    try {
      const result = await dispatch(
        createOrder({
          shippingAddress: shippingData,
          items: cartItems.map(item => ({
            productId: getItemId(item),
            title: getItemTitle(item),
            price: getItemUnitPrice(item),
            originalPrice: getItemOriginalPrice(item),
            quantity: getItemQuantity(item),
            image: getItemImage(item),
            variantId:
              item.variantId ||
              item.selectedVariant?.id ||
              item.selectedVariant?._id ||
              null,
            variantSku:
              item.variantSku ||
              item.variantSKU ||
              item.selectedVariant?.sku ||
              '',
            selectedVariant: item.selectedVariant || null,
            selectedAttributes:
              item.selectedAttributes || item.variantAttributes || {},
            variantAttributes:
              item.variantAttributes || item.selectedAttributes || {},
            cartKey: item.cartKey || null,
            variant: item.variant || item.selectedVariant || null,
          })),
          subtotal: toNumber(subtotal, 0),
          discount: isCouponValid ? toNumber(validDiscount, 0) : 0,
          total: toNumber(total, 0),
          coupon: isCouponValid ? appliedCoupon?.code : null,
          couponDetails:
            isCouponValid && appliedCoupon
              ? {
                  code: appliedCoupon.code,
                  discountType: appliedCoupon.discountType,
                  discountValue: appliedCoupon.discountValue,
                  nominalDiscount: toNumber(nominalDiscount, 0),
                  discountApplied: toNumber(validDiscount, 0),
                  clampedDiscount,
                  applicableProducts: appliedCoupon.applicableProducts,
                  applicableItems: applicableItems.map(getItemId),
                }
              : null,
        }),
      ).unwrap()

      const order = normalizeOrderPayload(result)

      if (order?._id || order?.id) {
        setCheckoutOrder(order)
        trackUserMetric({
          eventType: USER_METRIC_EVENTS.CHECKOUT_STEP,
          orderId: order._id || order.id,
          value: toNumber(total, 0),
          currency: METRIC_CURRENCY,
          quantity: itemCount,
          items: metricItems,
          commerce: {
            cartValue: toNumber(subtotal, 0),
            orderValue: toNumber(total, 0),
            discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
            itemsCount: itemCount,
          },
          metadata: {
            step: 'order_created',
            coupon: isCouponValid ? appliedCoupon?.code : '',
          },
        })
        setActiveStep(2)
        scrollToTop()
      } else {
        throw new Error('La orden no devolvió un ID válido')
      }
    } catch (error) {
      debugError('Error al crear orden:', error)
      alert(
        `Error al crear la orden: ${
          error?.message ||
          error?.response?.data?.message ||
          'Intente nuevamente'
        }`,
      )
    }
  }

  const onPaymentSubmit = useCallback(
    async formData => {
      const order = activeOrder

      if (!order?._id && !order?.id) {
        alert('Error: No se encontró la orden de compra')
        return
      }

      const paymentPayload = {
        orderId: order._id || order.id,
        token: formData.token,
        payment_method_id: formData.payment_method_id,
        installments: formData.installments,
        issuer_id: formData.issuer_id,
        payer: {
          email: formData.payer?.email || shippingData.email,
          identification: {
            type: formData.payer?.identification?.type || 'DNI',
            number: formData.payer?.identification?.number,
          },
        },
      }

      const metricItems = buildMetricItems(cartItems)
      const orderId = order._id || order.id

      trackUserMetric({
        eventType: USER_METRIC_EVENTS.PAYMENT_ATTEMPT,
        orderId,
        value: toNumber(total, 0),
        currency: METRIC_CURRENCY,
        quantity: itemCount,
        items: metricItems,
        commerce: {
          orderValue: toNumber(total, 0),
          discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
          itemsCount: itemCount,
        },
        metadata: {
          paymentMethod: formData.payment_method_id || '',
          installments: formData.installments || '',
        },
      })

      try {
        const result = await dispatch(
          processPaymentAction(paymentPayload),
        ).unwrap()
        const payment = normalizePaymentPayload(result)

        if (isApprovedPayment(payment)) {
          const paymentId = getPaymentDisplayId(payment)
          const confirmationSnapshot = buildConfirmationSnapshot({
            order,
            payment,
            cartItems,
            shippingData,
            subtotal,
            discount: isCouponValid ? validDiscount : 0,
            total,
            appliedCoupon: isCouponValid ? appliedCoupon : null,
            user,
          })

          setConfirmationData(confirmationSnapshot)

          if (!purchaseTrackedRef.current) {
            purchaseTrackedRef.current = true

            trackUserMetric({
              eventType: USER_METRIC_EVENTS.PAYMENT_APPROVED,
              orderId,
              paymentId,
              value: toNumber(total, 0),
              currency: METRIC_CURRENCY,
              quantity: itemCount,
              items: metricItems,
              commerce: {
                orderValue: toNumber(total, 0),
                discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
                itemsCount: itemCount,
              },
              metadata: {
                paymentMethod: formData.payment_method_id || '',
                status: payment.status,
              },
            })

            trackUserMetric({
              eventType: USER_METRIC_EVENTS.PURCHASE,
              orderId,
              paymentId,
              value: toNumber(total, 0),
              currency: METRIC_CURRENCY,
              quantity: itemCount,
              items: metricItems,
              commerce: {
                orderValue: toNumber(total, 0),
                discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
                itemsCount: itemCount,
              },
              metadata: {
                coupon: isCouponValid ? appliedCoupon?.code : '',
              },
            })
          }

          setPaymentStatus({
            completed: true,
            data: payment,
            timestamp: Date.now(),
          })

          setActiveStep(3)
          scrollToTop()
          return
        }

        if (isPendingPayment(payment)) {
          trackUserMetric({
            eventType: USER_METRIC_EVENTS.CHECKOUT_STEP,
            orderId,
            value: toNumber(total, 0),
            currency: METRIC_CURRENCY,
            quantity: itemCount,
            items: metricItems,
            commerce: {
              orderValue: toNumber(total, 0),
              discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
              itemsCount: itemCount,
            },
            metadata: {
              step: 'payment_pending',
              status: payment.status,
            },
          })
          alert(payment?.message || 'Pago pendiente de confirmación.')
          return
        }

        trackUserMetric({
          eventType: USER_METRIC_EVENTS.PAYMENT_REJECTED,
          orderId,
          value: toNumber(total, 0),
          currency: METRIC_CURRENCY,
          quantity: itemCount,
          items: metricItems,
          commerce: {
            orderValue: toNumber(total, 0),
            discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
            itemsCount: itemCount,
          },
          metadata: {
            paymentMethod: formData.payment_method_id || '',
            status: payment?.status || 'rejected',
          },
        })

        alert(getPaymentErrorMessage(payment))
      } catch (error) {
        debugError('Error procesando pago:', error)
        trackUserMetric({
          eventType: USER_METRIC_EVENTS.PAYMENT_REJECTED,
          orderId,
          value: toNumber(total, 0),
          currency: METRIC_CURRENCY,
          quantity: itemCount,
          items: metricItems,
          commerce: {
            orderValue: toNumber(total, 0),
            discountValue: isCouponValid ? toNumber(validDiscount, 0) : 0,
            itemsCount: itemCount,
          },
          metadata: {
            paymentMethod: formData.payment_method_id || '',
            status: 'error',
          },
        })
        alert(getPaymentErrorMessage(error))
      }
    },
    [
      activeOrder,
      dispatch,
      shippingData,
      cartItems,
      subtotal,
      total,
      itemCount,
      isCouponValid,
      validDiscount,
      appliedCoupon,
      user,
    ],
  )

  const handleNextStep = () => {
    if (activeStep === 0 && cartItems.length > 0) {
      setActiveStep(1)
      scrollToTop()
    }
  }

  const handleBackStep = () => {
    if (activeStep === 0) {
      navigate('/cart')
    } else {
      setActiveStep(prev => prev - 1)
      scrollToTop()
    }
  }

  const handleResetAndGoHome = useCallback(() => {
    dispatch(resetPayment())
    dispatch(resetOrderState())
    dispatch(resetCouponState())
    purchaseTrackedRef.current = false
    gaPurchaseTrackedRef.current = false
    setPaymentStatus({ completed: false, data: null, timestamp: null })
    setActiveStep(0)
    setAvailableCoupons([])
    setCheckoutOrder(null)
    setConfirmationData(null)
    navigate('/')
  }, [dispatch, navigate])

  // ======================================================
  // RENDER HELPERS
  // ======================================================

  const displayError =
    localCouponError ||
    (couponState.isError ? couponState.message : null) ||
    (paymentError ? paymentMessage : null)

  const renderCouponValueLabel = coupon => {
    if (!coupon) return ''

    if (coupon.discountType === 'percentage') {
      return `${coupon.discountValue}% OFF`
    }

    return `${formatMoney(coupon.discountValue)} OFF`
  }

  const renderAppliedCouponDetail = () => {
    if (!appliedCoupon) return null

    const nominalLabel = renderCouponValueLabel(appliedCoupon)

    if (!clampedDiscount) {
      return (
        <>
          {nominalLabel}
          {validDiscount > 0 && (
            <span style={{ color: themeColors.success, fontWeight: 600 }}>
              {' '}
              → Ahorro: {formatMoney(validDiscount)}
            </span>
          )}
        </>
      )
    }

    return (
      <>
        {nominalLabel}
        <span style={{ color: themeColors.success, fontWeight: 600 }}>
          {' '}
          → Aplicado: {formatMoney(validDiscount)}
        </span>
        <span
          style={{
            display: 'block',
            color: themeColors.mutedText,
            marginTop: 2,
          }}
        >
          Se aplicó hasta cubrir el subtotal del producto.
        </span>
      </>
    )
  }

  // ======================================================
  // SUCCESS / CONFIRMACIÓN
  // ======================================================

  if (
    paymentStatus.completed ||
    (paymentSuccess &&
      isApprovedPayment(normalizePaymentPayload(reduxPaymentResult)))
  ) {
    const successData =
      paymentStatus.data || normalizePaymentPayload(reduxPaymentResult)
    const confirmation =
      confirmationData ||
      buildConfirmationSnapshot({
        order: activeOrder,
        payment: successData,
        cartItems,
        shippingData,
        subtotal,
        discount: isCouponValid ? validDiscount : 0,
        total,
        appliedCoupon: isCouponValid ? appliedCoupon : null,
        user,
      })

    const orderId = getOrderDisplayId(confirmation.order)
    const paymentId = getPaymentDisplayId(confirmation.payment)
    const paymentStatusLabel =
      getPaymentStatusValue(confirmation.payment) || 'approved'

    return (
      <Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
        <Fade in timeout={500}>
          <Paper
            elevation={0}
            sx={{
              p: { xs: 2.5, md: 5 },
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 4,
            }}
          >
            <Stack
              alignItems="center"
              spacing={1.5}
              sx={{ textAlign: 'center', mb: 4 }}
            >
              <CheckCircleOutline
                sx={{ fontSize: { xs: 72, md: 96 }, color: 'success.main' }}
              />

              <Typography variant="h4" fontWeight={800} gutterBottom>
                ¡Gracias por tu compra!
              </Typography>

              <Typography color="text.secondary">
                Tu pago fue procesado exitosamente. Abajo tenés el detalle de la
                orden, los productos comprados y tus datos de contacto.
              </Typography>
            </Stack>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Paper
                  variant="outlined"
                  sx={{ p: 2, borderRadius: 2, height: '100%' }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Orden
                  </Typography>
                  <Typography variant="h6" fontWeight={800}>
                    {orderId ? `#${orderId}` : 'Orden generada'}
                  </Typography>
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper
                  variant="outlined"
                  sx={{ p: 2, borderRadius: 2, height: '100%' }}
                >
                  <Typography variant="body2" color="text.secondary">
                    ID de pago
                  </Typography>
                  <Typography
                    variant="h6"
                    fontWeight={800}
                    sx={{ wordBreak: 'break-all' }}
                  >
                    {paymentId ? `#${paymentId}` : 'Pago aprobado'}
                  </Typography>
                  <Chip
                    label={paymentStatusLabel}
                    size="small"
                    color="success"
                    sx={{ mt: 1, textTransform: 'capitalize' }}
                  />
                </Paper>
              </Grid>
            </Grid>

            <Paper sx={{ bgcolor: 'grey.50', p: 2.5, borderRadius: 3, mb: 3 }}>
              <Typography variant="subtitle1" fontWeight={800} gutterBottom>
                Productos comprados
              </Typography>

              <Stack spacing={1.5}>
                {confirmation.items.map((item, index) => (
                  <Paper
                    key={`${item.productId || item.title}-${index}`}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: 'background.paper',
                    }}
                  >
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar
                        src={item.image}
                        variant="rounded"
                        sx={{
                          width: 56,
                          height: 56,
                          border: '1px solid',
                          borderColor: 'divider',
                        }}
                      />

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={800} noWrap>
                          {item.title}
                        </Typography>

                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          Cantidad: {item.quantity} ·{' '}
                          {formatMoney(item.unitPrice)} c/u
                        </Typography>

                        {item.variantLabel && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                          >
                            Variante: {item.variantLabel}
                          </Typography>
                        )}

                        {item.sku && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                          >
                            SKU: {item.sku}
                          </Typography>
                        )}
                      </Box>

                      <Typography variant="body2" fontWeight={800}>
                        {formatMoney(item.subtotal)}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Paper>

            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <Paper
                  variant="outlined"
                  sx={{ p: 2.5, borderRadius: 3, height: '100%' }}
                >
                  <Typography variant="subtitle1" fontWeight={800} gutterBottom>
                    Datos del comprador
                  </Typography>

                  <Typography variant="body2" fontWeight={700}>
                    {[
                      confirmation.customer.firstName,
                      confirmation.customer.lastName,
                    ]
                      .filter(Boolean)
                      .join(' ') || 'Cliente'}
                  </Typography>

                  {confirmation.customer.email && (
                    <Typography variant="body2" color="text.secondary">
                      {confirmation.customer.email}
                    </Typography>
                  )}

                  {confirmation.customer.phone && (
                    <Typography variant="body2" color="text.secondary">
                      {confirmation.customer.phone}
                    </Typography>
                  )}
                </Paper>
              </Grid>

              <Grid item xs={12} md={6}>
                <Paper
                  variant="outlined"
                  sx={{ p: 2.5, borderRadius: 3, height: '100%' }}
                >
                  <Typography variant="subtitle1" fontWeight={800} gutterBottom>
                    Resumen de pago
                  </Typography>

                  <Stack spacing={1}>
                    <Box
                      sx={{ display: 'flex', justifyContent: 'space-between' }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        Subtotal
                      </Typography>
                      <Typography variant="body2" fontWeight={700}>
                        {formatMoney(confirmation.totals.subtotal)}
                      </Typography>
                    </Box>

                    {confirmation.totals.discount > 0 && (
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Typography variant="body2" color="success.main">
                          Descuento
                        </Typography>
                        <Typography
                          variant="body2"
                          color="success.main"
                          fontWeight={700}
                        >
                          -{formatMoney(confirmation.totals.discount)}
                        </Typography>
                      </Box>
                    )}

                    {confirmation.coupon?.code && (
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          Cupón
                        </Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {confirmation.coupon.code}
                        </Typography>
                      </Box>
                    )}

                    <Divider sx={{ my: 0.5 }} />

                    <Box
                      sx={{ display: 'flex', justifyContent: 'space-between' }}
                    >
                      <Typography variant="body1" fontWeight={800}>
                        Total pagado
                      </Typography>
                      <Typography variant="body1" fontWeight={900}>
                        {formatMoney(confirmation.totals.total)}
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>

            <Alert severity="success" sx={{ borderRadius: 2, mb: 3 }}>
              Guardamos tu orden. El comercio coordinará la entrega usando los
              datos de contacto indicados.
            </Alert>

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleResetAndGoHome}
              sx={{
                bgcolor: themeColors.actionPrimary,
                color: themeColors.actionPrimaryText,
                fontWeight: 800,
                '&:hover': {
                  bgcolor: themeColors.actionPrimary,
                  filter: 'brightness(0.92)',
                },
              }}
            >
              Volver al inicio
            </Button>
          </Paper>
        </Fade>
      </Container>
    )
  }

  // ======================================================
  // EMPTY CART
  // ======================================================

  if (!isLoading && cartItems.length === 0) {
    return (
      <Container maxWidth="md" sx={{ py: 10, textAlign: 'center' }}>
        <ShoppingBagOutlined
          sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }}
        />

        <Typography variant="h5" gutterBottom fontWeight={700}>
          Tu carrito está vacío
        </Typography>

        <Button
          variant="contained"
          component={Link}
          to="/product"
          size="large"
          sx={{
            bgcolor: themeColors.actionPrimary,
            color: themeColors.actionPrimaryText,
            fontWeight: 700,
            '&:hover': {
              bgcolor: themeColors.actionPrimary,
              filter: 'brightness(0.92)',
            },
          }}
        >
          Explorar productos
        </Button>
      </Container>
    )
  }

  // ======================================================
  // MAIN RENDER
  // ======================================================

  return (
    <Box sx={{ bgcolor: themeColors.background, minHeight: '100vh' }}>
      <Backdrop
        open={orderLoading || paymentLoading || isLoading}
        sx={{ color: '#fff', zIndex: theme => theme.zIndex.drawer + 1 }}
      >
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography fontWeight={600}>
            {paymentLoading ? 'Procesando pago seguro...' : 'Cargando...'}
          </Typography>
        </Stack>
      </Backdrop>

      <Container maxWidth="xl" sx={{ py: { xs: 2, md: 4 } }}>
        <Stack spacing={3} sx={{ mb: 4 }}>
          <Breadcrumbs separator={<NavigateNext fontSize="small" />}>
            <MuiLink
              component={Link}
              to="/cart"
              color="inherit"
              underline="hover"
            >
              Carrito
            </MuiLink>
            <Typography
              color={activeStep === 0 ? 'primary' : 'inherit'}
              fontWeight={activeStep === 0 ? 700 : 400}
            >
              Revisión
            </Typography>
            <Typography
              color={activeStep === 1 ? 'primary' : 'inherit'}
              fontWeight={activeStep === 1 ? 700 : 400}
            >
              Entrega
            </Typography>
            <Typography
              color={activeStep >= 2 ? 'primary' : 'inherit'}
              fontWeight={activeStep >= 2 ? 700 : 400}
            >
              Pago
            </Typography>
          </Breadcrumbs>

          <Stepper
            activeStep={activeStep}
            alternativeLabel
            sx={{ display: { xs: 'none', md: 'flex' } }}
          >
            {STEPS.map(label => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Button
            onClick={handleBackStep}
            startIcon={<ArrowBackIos fontSize="small" />}
            sx={{
              alignSelf: 'flex-start',
              color: themeColors.actionPrimaryText,
            }}
          >
            {activeStep === 0 ? 'Volver al carrito' : 'Paso anterior'}
          </Button>
        </Stack>

        <Grid container spacing={4}>
          {/* COLUMNA IZQUIERDA */}
          <Grid item xs={12} md={8}>
            <Paper
              elevation={0}
              sx={{
                p: { xs: 2, md: 4 },
                borderRadius: 4,
                border: '1px solid',
                borderColor: 'divider',
                minHeight: 600,
              }}
            >
              {displayError && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                  {displayError}
                </Alert>
              )}

              {/* PASO 0 */}
              {activeStep === 0 && (
                <Box>
                  <Typography variant="h5" fontWeight={700} mb={3}>
                    Revisa tus productos ({itemCount} items)
                  </Typography>

                  {!appliedCoupon && coupons.length > 0 && (
                    <Box sx={{ mb: 4 }}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        mb={2}
                      >
                        <AutoAwesome color="primary" />
                        <Typography
                          variant="subtitle1"
                          fontWeight={700}
                          sx={{ color: 'brand.main' }}
                        >
                          Cupones disponibles
                        </Typography>
                      </Stack>

                      <Stack spacing={2}>
                        {(showAllCoupons
                          ? availableCoupons
                          : availableCoupons.slice(0, 3)
                        ).map(rawCoupon => {
                          const coupon = normalizeCouponPayload(rawCoupon)
                          if (!coupon?.code) return null

                          return (
                            <Paper
                              key={coupon.code}
                              elevation={0}
                              sx={{
                                p: 2.5,
                                border: '2px dashed',
                                borderColor: coupon.isSpecific
                                  ? 'warning.main'
                                  : 'brand.main',
                                borderRadius: 3,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                bgcolor: coupon.isSpecific
                                  ? 'warning.50'
                                  : 'background.paper',
                                '&:hover': {
                                  bgcolor: coupon.isSpecific
                                    ? 'warning.100'
                                    : 'action.hover',
                                  transform: 'translateY(-2px)',
                                  boxShadow: 1,
                                },
                              }}
                              onClick={() => handleApplySpecificCoupon(coupon)}
                            >
                              <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={2}
                                alignItems={{ sm: 'center' }}
                              >
                                <Box
                                  sx={{
                                    bgcolor: coupon.isSpecific
                                      ? 'warning.main'
                                      : 'brand.main',
                                    color: 'white',
                                    px: 2,
                                    py: 1,
                                    borderRadius: 2,
                                    fontWeight: 800,
                                    fontSize: '1rem',
                                    letterSpacing: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                  }}
                                >
                                  {coupon.code}
                                  <IconButton
                                    size="small"
                                    sx={{ color: 'white', p: 0.3 }}
                                    onClick={event => {
                                      event.stopPropagation()
                                      handleCopyCode(coupon.code)
                                    }}
                                  >
                                    <ContentCopy fontSize="small" />
                                  </IconButton>
                                </Box>

                                <Box flex={1}>
                                  <Typography variant="body1" fontWeight={700}>
                                    {renderCouponValueLabel(coupon)}
                                  </Typography>

                                  {coupon.isSpecific ? (
                                    <Typography
                                      variant="caption"
                                      color="warning.dark"
                                      display="block"
                                      fontWeight={600}
                                    >
                                      🔒 Solo válido para:{' '}
                                      <strong>
                                        {coupon.specificProductName ||
                                          'producto seleccionado'}
                                      </strong>
                                    </Typography>
                                  ) : (
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      display="block"
                                    >
                                      Válido para todos los productos
                                    </Typography>
                                  )}
                                </Box>

                                <Button
                                  variant="contained"
                                  size="small"
                                  onClick={event => {
                                    event.stopPropagation()
                                    handleApplySpecificCoupon(coupon)
                                  }}
                                >
                                  Aplicar
                                </Button>
                              </Stack>
                            </Paper>
                          )
                        })}

                        {coupons.length > 3 && !showAllCoupons && (
                          <Button
                            fullWidth
                            onClick={() => setShowAllCoupons(true)}
                            sx={{ textTransform: 'none', color: 'brand.main' }}
                          >
                            Ver {coupons.length - 3} cupones más
                          </Button>
                        )}
                      </Stack>
                    </Box>
                  )}

                  <Stack spacing={2} sx={{ mb: 4 }}>
                    {cartItems.map((item, index) => {
                      const itemId = getItemId(item)
                      const unitPrice = getItemUnitPrice(item)
                      const originalPrice = getItemOriginalPrice(item)
                      const quantity = getItemQuantity(item)
                      const specificCoupon = couponsByProduct.get(itemId)

                      const isAffectedByCoupon =
                        appliedCoupon &&
                        Array.isArray(applicableItems) &&
                        applicableItems.some(
                          candidate => getItemId(candidate) === itemId,
                        )

                      return (
                        <Paper
                          key={`${itemId}-${index}`}
                          variant="outlined"
                          sx={{
                            p: 2,
                            borderRadius: 3,
                            position: 'relative',
                            borderColor: isAffectedByCoupon
                              ? 'success.main'
                              : 'divider',
                            bgcolor: isAffectedByCoupon
                              ? 'success.50'
                              : 'background.paper',
                          }}
                        >
                          <Stack
                            direction="row"
                            spacing={2}
                            alignItems="center"
                          >
                            <Badge badgeContent={quantity} color="primary">
                              <Avatar
                                src={getItemImage(item)}
                                variant="rounded"
                                sx={{
                                  width: 80,
                                  height: 80,
                                  border: '1px solid',
                                  borderColor: 'divider',
                                }}
                              />
                            </Badge>

                            <Box flex={1} minWidth={0}>
                              <Typography
                                variant="body1"
                                fontWeight={600}
                                noWrap
                              >
                                {getItemTitle(item)}
                              </Typography>

                              {item.variant && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  display="block"
                                >
                                  {item.variant}
                                </Typography>
                              )}

                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                                mt={0.5}
                              >
                                {originalPrice && (
                                  <Typography
                                    variant="body2"
                                    color="text.disabled"
                                    sx={{ textDecoration: 'line-through' }}
                                  >
                                    {formatMoney(originalPrice)}
                                  </Typography>
                                )}
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  {formatMoney(unitPrice)} c/u
                                </Typography>
                              </Stack>

                              {originalPrice && (
                                <Chip
                                  label={`Producto con descuento: ahorrás ${formatMoney(
                                    originalPrice - unitPrice,
                                  )} c/u`}
                                  size="small"
                                  color="success"
                                  variant="outlined"
                                  sx={{ mt: 1, fontSize: '0.7rem' }}
                                />
                              )}

                              {specificCoupon && !appliedCoupon && (
                                <Chip
                                  icon={<LocalOfferOutlined fontSize="small" />}
                                  label={`${specificCoupon.code} - ${renderCouponValueLabel(
                                    specificCoupon,
                                  )}`}
                                  size="small"
                                  color="warning"
                                  variant="filled"
                                  sx={{
                                    mt: 1,
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                  onClick={() =>
                                    handleApplySpecificCoupon(specificCoupon)
                                  }
                                />
                              )}
                            </Box>

                            <Box textAlign="right">
                              <Typography variant="body1" fontWeight={700}>
                                {formatMoney(unitPrice * quantity)}
                              </Typography>

                              {isAffectedByCoupon && appliedCoupon && (
                                <Chip
                                  icon={<CheckCircleOutline fontSize="small" />}
                                  label="Cupón aplicado"
                                  size="small"
                                  color="success"
                                  sx={{ mt: 1, fontSize: '0.7rem' }}
                                />
                              )}
                            </Box>
                          </Stack>
                        </Paper>
                      )
                    })}
                  </Stack>

                  <Alert severity="info" sx={{ borderRadius: 2, mb: 3 }}>
                    <Typography variant="body2">
                      Verificá tus productos antes de continuar al pago.
                    </Typography>
                  </Alert>

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      variant="contained"
                      size="large"
                      onClick={handleNextStep}
                      disabled={cartItems.length === 0}
                      sx={{
                        py: 1.5,
                        px: 4,
                        bgcolor: themeColors.actionPrimary,
                        color: themeColors.actionPrimaryText,
                        fontWeight: 700,
                        '&:hover': {
                          bgcolor: themeColors.actionPrimary,
                          filter: 'brightness(0.92)',
                        },
                      }}
                    >
                      Continuar a Entrega
                    </Button>
                  </Box>
                </Box>
              )}

              {/* PASO 1 */}
              {activeStep === 1 && (
                <Box component="form" noValidate>
                  <Typography
                    variant="h5"
                    fontWeight={700}
                    mb={3}
                    display="flex"
                    alignItems="center"
                  >
                    <LocalShipping sx={{ mr: 1 }} /> Datos de Entrega
                  </Typography>

                  {isUserProfileLoading && (
                    <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
                      Cargando tus datos de contacto...
                    </Alert>
                  )}

                  {!isUserProfileLoading && shippingAutoFilled && (
                    <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
                      Cargamos tus datos desde tu cuenta. Podés corregirlos
                      antes de continuar.
                    </Alert>
                  )}

                  <Grid container spacing={3}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Nombre"
                        required
                        value={shippingData.firstName}
                        onChange={event =>
                          handleShippingFieldChange(
                            'firstName',
                            event.target.value,
                          )
                        }
                        error={Boolean(formErrors.firstName)}
                        helperText={formErrors.firstName || ''}
                        data-error={Boolean(formErrors.firstName)}
                        autoComplete="given-name"
                        inputProps={{ maxLength: 80 }}
                      />
                    </Grid>

                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Apellido"
                        required
                        value={shippingData.lastName}
                        onChange={event =>
                          handleShippingFieldChange(
                            'lastName',
                            event.target.value,
                          )
                        }
                        error={Boolean(formErrors.lastName)}
                        helperText={formErrors.lastName || ''}
                        data-error={Boolean(formErrors.lastName)}
                        autoComplete="family-name"
                        inputProps={{ maxLength: 80 }}
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Email"
                        type="email"
                        required
                        value={shippingData.email}
                        onChange={event =>
                          handleShippingFieldChange('email', event.target.value)
                        }
                        error={Boolean(formErrors.email)}
                        helperText={formErrors.email || ''}
                        data-error={Boolean(formErrors.email)}
                        autoComplete="email"
                        inputProps={{
                          maxLength: 160,
                          inputMode: 'email',
                        }}
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        fullWidth
                        label="Teléfono"
                        required
                        value={shippingData.phone}
                        onChange={event =>
                          handleShippingFieldChange('phone', event.target.value)
                        }
                        error={Boolean(formErrors.phone)}
                        helperText={formErrors.phone || ''}
                        data-error={Boolean(formErrors.phone)}
                        placeholder="11 1234-5678"
                        autoComplete="tel"
                        inputProps={{
                          maxLength: 30,
                          inputMode: 'tel',
                        }}
                      />
                    </Grid>
                  </Grid>

                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    onClick={handleGoToPayment}
                    disabled={profileBootstrapLoading}
                    sx={{
                      mt: 4,
                      py: 2,
                      bgcolor: themeColors.actionPrimary,
                      color: themeColors.actionPrimaryText,
                      fontWeight: 700,
                      '&:hover': {
                        bgcolor: themeColors.actionPrimary,
                        filter: 'brightness(0.92)',
                      },
                      '&.Mui-disabled': {
                        bgcolor: 'grey.300',
                        color: 'grey.600',
                      },
                    }}
                  >
                    {profileBootstrapLoading
                      ? 'Cargando datos...'
                      : 'Continuar al Pago'}
                  </Button>
                </Box>
              )}

              {/* PASO 2 */}
              {activeStep === 2 && (
                <Box>
                  <Button
                    onClick={() => setActiveStep(1)}
                    startIcon={<ArrowBackIos fontSize="small" />}
                    sx={{
                      mb: 3,
                      color: 'text.secondary',
                    }}
                  >
                    Volver a datos de entrega
                  </Button>

                  <Typography
                    variant="h5"
                    fontWeight={700}
                    mb={3}
                    display="flex"
                    alignItems="center"
                  >
                    <LockOutlined sx={{ mr: 1 }} /> Pago Seguro con Mercado Pago
                  </Typography>

                  {activeOrder ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        p: { xs: 2, md: 4 },
                        borderRadius: 3,
                        bgcolor: themeColors.surface,
                      }}
                    >
                      {mpInitError ? (
                        <Alert severity="error" sx={{ borderRadius: 2 }}>
                          {mpInitError}
                        </Alert>
                      ) : !mpReady ? (
                        <Box display="flex" justifyContent="center" py={5}>
                          <CircularProgress />
                        </Box>
                      ) : (
                        <CardPayment
                          initialization={{
                            amount: Number(total.toFixed(2)),
                          }}
                          onSubmit={onPaymentSubmit}
                          onReady={() => debugLog('✅ Mercado Pago listo')}
                          onError={error => {
                            debugError('❌ Error MP:', error)
                            alert(
                              `Error en el formulario de pago: ${
                                error?.message || 'Error desconocido'
                              }`,
                            )
                          }}
                          customization={{
                            visual: {
                              style: { theme: 'flat' },
                              texts: {
                                formTitle: 'Ingresa los datos de tu tarjeta',
                                formSubmit: `Pagar ${formatMoney(total)}`,
                              },
                            },
                          }}
                        />
                      )}
                    </Paper>
                  ) : (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      No se encontró la orden de compra. Por favor, vuelve al
                      paso anterior.
                    </Alert>
                  )}

                  <Alert severity="info" sx={{ mt: 3, borderRadius: 2 }}>
                    <Typography variant="body2">
                      🔒 Tu pago está protegido por Mercado Pago. No almacenamos
                      los datos de tu tarjeta.
                    </Typography>
                  </Alert>
                </Box>
              )}
            </Paper>
          </Grid>

          {/* COLUMNA DERECHA */}
          <Grid item xs={12} md={4}>
            <Box sx={{ position: 'sticky', top: 24 }}>
              <Paper
                sx={{
                  p: 3,
                  mb: 2,
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="subtitle1" fontWeight={700} mb={2}>
                  Resumen ({itemCount}{' '}
                  {itemCount === 1 ? 'producto' : 'productos'})
                </Typography>

                <Stack
                  spacing={2}
                  sx={{ maxHeight: 300, overflow: 'auto', mb: 2 }}
                >
                  {cartItems.map(item => {
                    const unitPrice = getItemUnitPrice(item)
                    const originalPrice = getItemOriginalPrice(item)
                    const quantity = getItemQuantity(item)

                    return (
                      <Box
                        key={getItemId(item)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                        }}
                      >
                        <Badge
                          badgeContent={quantity}
                          color="primary"
                          sx={{
                            '& .MuiBadge-badge': {
                              fontSize: '0.65rem',
                              height: 18,
                              minWidth: 18,
                            },
                          }}
                        >
                          <Avatar
                            src={getItemImage(item)}
                            variant="rounded"
                            sx={{
                              width: 48,
                              height: 48,
                              border: '1px solid',
                              borderColor: 'divider',
                            }}
                          />
                        </Badge>

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            noWrap
                            sx={{ fontSize: '0.875rem' }}
                          >
                            {getItemTitle(item)}
                          </Typography>

                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            {originalPrice && (
                              <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ textDecoration: 'line-through' }}
                              >
                                {formatMoney(originalPrice)}
                              </Typography>
                            )}
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {formatMoney(unitPrice)} c/u
                            </Typography>
                          </Stack>
                        </Box>

                        <Typography variant="body2" fontWeight={700}>
                          {formatMoney(unitPrice * quantity)}
                        </Typography>
                      </Box>
                    )
                  })}
                </Stack>

                <Divider sx={{ my: 2 }} />

                <Stack spacing={1.5}>
                  <Box
                    sx={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Subtotal
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {formatMoney(subtotal)}
                    </Typography>
                  </Box>

                  {appliedCoupon && isCouponValid && validDiscount > 0 && (
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        color: 'success.main',
                        bgcolor: 'success.50',
                        p: 1,
                        borderRadius: 1,
                        mx: -1,
                      }}
                    >
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          Descuento
                        </Typography>

                        <Typography
                          variant="caption"
                          display="block"
                          color="success.dark"
                        >
                          {hasProductRestriction && applicableItems.length > 0
                            ? `En ${applicableItems.length} producto(s)`
                            : 'En todos los productos'}
                          {savingsPercentage > 0 &&
                            ` (-${savingsPercentage.toFixed(0)}%)`}
                        </Typography>

                        {clampedDiscount && (
                          <Typography
                            variant="caption"
                            display="block"
                            color="text.secondary"
                          >
                            Cupón nominal: {formatMoney(nominalDiscount)}
                          </Typography>
                        )}
                      </Box>

                      <Typography variant="body2" fontWeight={700}>
                        -{formatMoney(validDiscount)}
                      </Typography>
                    </Box>
                  )}

                  {appliedCoupon && !isCouponValid && (
                    <Alert severity="error" sx={{ py: 0.5 }}>
                      <Typography variant="body2">
                        <strong>{appliedCoupon.code}</strong>: {couponReason}
                      </Typography>
                    </Alert>
                  )}

                  <Box
                    sx={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Envío
                    </Typography>
                    <Chip
                      label="A coordinar"
                      size="small"
                      color="success"
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.75rem' }}
                    />
                  </Box>

                  <Divider sx={{ my: 1 }} />

                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="h6" fontWeight={800}>
                      Total
                    </Typography>
                    <Typography
                      variant="h5"
                      fontWeight={800}
                      color={themeColors.price}
                    >
                      {formatMoney(total)}
                    </Typography>
                  </Box>

                  {isCouponValid && validDiscount > 0 && (
                    <Typography
                      variant="caption"
                      color="success.main"
                      textAlign="right"
                    >
                      ¡Ahorrás {formatMoney(validDiscount)}!
                    </Typography>
                  )}
                </Stack>
              </Paper>

              {activeStep <= 1 && (
                <Paper
                  sx={{
                    p: 3,
                    mb: 2,
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    fontWeight={700}
                    mb={2}
                    display="flex"
                    alignItems="center"
                  >
                    <LocalOfferOutlined sx={{ mr: 1, fontSize: 20 }} />
                    ¿Tienes un cupón?
                  </Typography>

                  {appliedCoupon && isCouponValid ? (
                    <Alert
                      severity="success"
                      icon={<CheckCircleOutline />}
                      sx={{
                        borderRadius: 2,
                        '& .MuiAlert-message': { width: '100%' },
                      }}
                    >
                      <Stack spacing={1}>
                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                          }}
                        >
                          <Box>
                            <Typography variant="body2" fontWeight={700}>
                              {appliedCoupon.code}
                            </Typography>

                            <Typography variant="caption" display="block">
                              {renderAppliedCouponDetail()}
                            </Typography>

                            {hasProductRestriction &&
                              applicableItems.length > 0 && (
                                <Typography
                                  variant="caption"
                                  display="block"
                                  sx={{ mt: 0.5, color: 'text.secondary' }}
                                >
                                  Solo en {applicableItems.length} producto(s)
                                </Typography>
                              )}
                          </Box>

                          <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            onClick={handleRemoveCoupon}
                            startIcon={<Close />}
                            sx={{
                              textTransform: 'none',
                              minWidth: 'auto',
                              ml: 1,
                            }}
                          >
                            Quitar
                          </Button>
                        </Box>
                      </Stack>
                    </Alert>
                  ) : appliedCoupon && !isCouponValid ? (
                    <Alert severity="error" sx={{ borderRadius: 2 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <Box>
                          <Typography variant="body2">
                            <strong>{appliedCoupon.code}</strong> no aplica
                          </Typography>
                          <Typography variant="caption" display="block">
                            {couponReason}
                          </Typography>
                        </Box>

                        <Button
                          size="small"
                          onClick={handleRemoveCoupon}
                          color="inherit"
                        >
                          Quitar
                        </Button>
                      </Box>
                    </Alert>
                  ) : (
                    <Stack spacing={2}>
                      <TextField
                        fullWidth
                        size="small"
                        placeholder="Ingresa tu código"
                        value={couponInput}
                        onChange={event =>
                          setCouponInput(event.target.value.toUpperCase())
                        }
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            handleApplyCoupon()
                          }
                        }}
                        disabled={couponState.isLoading}
                        error={Boolean(displayError)}
                        helperText={displayError || ' '}
                        InputProps={{
                          sx: { textTransform: 'uppercase' },
                        }}
                      />

                      <Button
                        variant="contained"
                        fullWidth
                        onClick={handleApplyCoupon}
                        disabled={!couponInput.trim() || couponState.isLoading}
                        sx={{
                          bgcolor: themeColors.actionPrimary,
                          color: themeColors.actionPrimaryText,
                          fontWeight: 700,
                          py: 1,
                          '&:hover': {
                            bgcolor: themeColors.actionPrimary,
                            filter: 'brightness(0.92)',
                          },
                        }}
                      >
                        {couponState.isLoading ? (
                          <CircularProgress
                            size={20}
                            sx={{ color: themeColors.actionPrimaryText }}
                          />
                        ) : (
                          'Aplicar Cupón'
                        )}
                      </Button>

                      {coupons.length > 0 && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          textAlign="center"
                        >
                          💡 Selecciona un cupón de la lista arriba
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Paper>
              )}

              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  bgcolor: 'grey.50',
                  borderRadius: 3,
                  border: '1px dashed',
                  borderColor: 'grey.300',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <LockOutlined color="success" />
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    fontWeight={500}
                  >
                    Pago 100% seguro por Mercado Pago
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    SSL 256-bit • Datos encriptados
                  </Typography>
                </Box>
              </Paper>
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  )
}

export default CheckoutPage
