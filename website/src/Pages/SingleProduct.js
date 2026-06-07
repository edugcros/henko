import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import {
  Box,
  Grid,
  Typography,
  Paper,
  Stack,
  Button,
  Divider,
  TextField,
  Skeleton,
  Container,
  IconButton,
  Avatar,
  useMediaQuery,
  Chip,
  Collapse,
  FormControl,
  Select,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
} from '@mui/material'
import { styled, useTheme, alpha  } from '@mui/material/styles'
import {
  ShoppingCartOutlined as CartIcon,
  Favorite as FavIcon,
  FavoriteBorder as FavBorderIcon,
  AutoAwesome as AIIcon,
  VerifiedUserOutlined as VerifiedIcon,
  RateReviewOutlined as ReviewIcon,
  Person as PersonIcon,
  Inventory2Outlined as StockIcon,
} from '@mui/icons-material'
import { fetchPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSlice'

import { selectPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSelectors'
import ReactStars from 'react-stars'
import toast, { Toaster } from 'react-hot-toast'

import { getProduct, rateProduct } from '@features/products/productSlice'
import { addOrUpdateCartItem } from '@features/cart/cartSlice'
import {
  getUserProductWishlist,
  selectIsAuthenticated,
  toggleWishlist,
} from '@features/user/userSlice'
import { createEnquiry } from '@features/enquiries/enquirySlice'
import placeholder from '@assets/images/placeholder.png'
import {
  formatCurrency,
  getActiveThemeConfig,
  getLayoutThemeConfig,
  getSpacingThemeConfig,
  getThemeColors,
} from '@utils/themeRuntime'
import { Newprimary } from '../theme/colors'

const IMG_BOX_SIZE = 520

const MainImageWindow = styled(Paper)(({ theme }) => ({
  position: 'relative',
  borderRadius: 16,
  height: IMG_BOX_SIZE,
  width: IMG_BOX_SIZE,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.background.paper,
  cursor: 'zoom-in',
  border: `1px solid ${theme.palette.divider}`,
  flexShrink: 0,
  '& img': {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    transition: 'transform 0.15s ease-out',
  },
}))

const ThumbButton = styled(Box, {
  shouldForwardProp: prop => prop !== 'active',
})(({ active, theme }) => ({
  width: 70,
  height: 70,
  borderRadius: 10,
  cursor: 'pointer',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `2px solid ${active ? theme.palette.ctaPrimary.main : theme.palette.divider}`,
  transition: '0.2s',
  '&:hover': { transform: 'scale(1.05)' },
  '& img': {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
}))

const normalizeAttributes = variant => {
  if (!variant) return {}
  return variant.attributes || variant.combinacion || {}
}

const buildVariantIdentifier = variant => {
  if (!variant) return null
  return variant._id || variant.id || variant.key || variant.sku || null
}

const buildVariantCartKey = (productId, variant, attributes = {}) => {
  const variantId = buildVariantIdentifier(variant)
  if (variantId) return `${productId}::${variantId}`

  const attrsKey = Object.entries(attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|')

  return `${productId}::${attrsKey || 'base'}`
}

const normalizeImageUrl = img => {
  if (!img) return null

  if (typeof img === 'string' && img.trim()) {
    return img.trim()
  }

  if (typeof img === 'object') {
    if (typeof img.url === 'string' && img.url.trim()) {
      return img.url.trim()
    }

    if (typeof img.secure_url === 'string' && img.secure_url.trim()) {
      return img.secure_url.trim()
    }

    if (typeof img.src === 'string' && img.src.trim()) {
      return img.src.trim()
    }
  }

  return null
}

const getVariantImageUrl = variant => {
  if (!variant) return null

  const directCandidates = [
    variant.image,
    variant.imageUrl,
    variant.imageURL,
    variant.secure_url,
    variant.src,
    variant.previewUrl,
  ]

  for (const candidate of directCandidates) {
    const normalized = normalizeImageUrl(candidate)
    if (normalized) return normalized
  }

  if (variant.selectedImage && typeof variant.selectedImage === 'object') {
    const normalized = normalizeImageUrl(variant.selectedImage)
    if (normalized) return normalized
  }

  if (variant.images) {
    if (Array.isArray(variant.images) && variant.images.length > 0) {
      for (const imageCandidate of variant.images) {
        const normalized = normalizeImageUrl(imageCandidate)
        if (normalized) return normalized
      }
    } else {
      const normalized = normalizeImageUrl(variant.images)
      if (normalized) return normalized
    }
  }

  return null
}

const normalizeVariantForCart = (variant, selectedAttrs = {}) => {
  if (!variant) return null

  const attrs = normalizeAttributes(variant)
  const mergedAttributes = {
    ...attrs,
    ...selectedAttrs,
  }

  return {
    raw: variant,
    id: buildVariantIdentifier(variant),
    sku: variant.sku || variant.SKU || null,
    price: Number(variant.price || 0),
    stock: Number(variant.stock || 0),
    attributes: mergedAttributes,
    image: getVariantImageUrl(variant),
  }
}

const ProductVariantSelector = ({ product, onVariantSelect, selectedVariant }) => {
  const theme = useTheme()

  const variantAttributes = useMemo(
    () => (Array.isArray(product?.variantAttributes) ? product.variantAttributes : []),
    [product?.variantAttributes],
  )

  const variants = useMemo(
    () => (Array.isArray(product?.variants) ? product.variants : []),
    [product?.variants],
  )

  const [selections, setSelections] = useState({})

  const ctaMain =
    theme.palette.ctaPrimary?.main ||
    theme.palette.primary.main

  const ctaContrast =
    theme.palette.ctaPrimary?.contrastText ||
    theme.palette.primary.contrastText

  useEffect(() => {
    setSelections({})
  }, [product?._id])

  useEffect(() => {
    const requiredKeys = variantAttributes
      .map(attr => attr?.name)
      .filter(Boolean)

    const hasAllSelections =
      requiredKeys.length > 0 &&
      requiredKeys.every(key => Boolean(selections[key]))

    if (!hasAllSelections) {
      onVariantSelect?.(null, selections)
      return
    }

    const matchedVariant = variants.find(variant => {
      const variantAttrs = normalizeAttributes(variant)

      return requiredKeys.every(key => {
        return String(variantAttrs[key] || '') === String(selections[key] || '')
      })
    })

    onVariantSelect?.(matchedVariant || null, selections)
  }, [selections, variants, variantAttributes, onVariantSelect])

  const getAvailableValues = useCallback(
    (attrName, currentSelections) => {
      const otherSelections = { ...currentSelections }
      delete otherSelections[attrName]

      const compatibleVariants = variants.filter(variant => {
        if (variant?.isActive === false) return false

        const attrs = normalizeAttributes(variant)

        return Object.entries(otherSelections).every(([key, value]) => {
          if (!value) return true
          return String(attrs[key] || '') === String(value || '')
        })
      })

      const values = new Set()

      compatibleVariants.forEach(variant => {
        const attrs = normalizeAttributes(variant)
        const value = attrs[attrName]

        if (value) {
          values.add(String(value))
        }
      })

      return Array.from(values).sort((a, b) => a.localeCompare(b))
    },
    [variants],
  )

  const handleSelectionChange = useCallback(
    (attrName, value) => {
      setSelections(prev => {
        const updated = { ...prev }

        if (!value) {
          delete updated[attrName]
        } else {
          updated[attrName] = value
        }

        const changedIndex = variantAttributes.findIndex(attr => attr.name === attrName)

        variantAttributes.forEach((attr, index) => {
          if (index > changedIndex) {
            delete updated[attr.name]
          }
        })

        return updated
      })
    },
    [variantAttributes],
  )

  const handleClearAttribute = useCallback(
    attrName => {
      setSelections(prev => {
        const updated = { ...prev }
        const changedIndex = variantAttributes.findIndex(attr => attr.name === attrName)

        delete updated[attrName]

        variantAttributes.forEach((attr, index) => {
          if (index > changedIndex) {
            delete updated[attr.name]
          }
        })

        return updated
      })
    },
    [variantAttributes],
  )

  const handleClearAll = useCallback(() => {
    setSelections({})
    onVariantSelect?.(null, {})
  }, [onVariantSelect])

  if (!variantAttributes.length || !variants.length) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        No hay opciones de variante disponibles para este producto.
      </Alert>
    )
  }

  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        bgcolor: theme.palette.background.paper,
        border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
        borderRadius: 2,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1.5 }}
      >
        <Typography variant="subtitle2" fontWeight={800}>
          Seleccioná tus opciones
        </Typography>

        <Button
          size="small"
          variant="text"
          onClick={handleClearAll}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          Limpiar selección
        </Button>
      </Stack>

      {variantAttributes.map((attr, index) => {
        const attrName = attr?.name
        const attrLabel = attr?.label || attrName

        if (!attrName) return null

        const availableValues = getAvailableValues(attrName, selections)
        const isDisabled = index > 0 && !selections[variantAttributes[index - 1]?.name]
        const currentValue = selections[attrName] || ''

        return (
          <Box key={attrName} sx={{ mb: 2 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 0.75 }}
            >
              <Typography variant="caption" color="text.secondary" display="block">
                {attrLabel} {currentValue ? '✓' : ''}
              </Typography>

              {currentValue && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => handleClearAttribute(attrName)}
                  sx={{
                    minWidth: 'auto',
                    p: 0,
                    textTransform: 'none',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Quitar
                </Button>
              )}
            </Stack>

            {attr.type === 'color' ? (
              <ToggleButtonGroup
                value={currentValue}
                exclusive
                onChange={(_, val) => {
                  if (val === currentValue) {
                    handleSelectionChange(attr.name, null)
                    return
                  }
                  handleSelectionChange(attr.name, val)
                }}
                size="small"
                disabled={isDisabled}
              >
                {availableValues.map(value => (
                  <ToggleButton
                    key={value}
                    value={value}
                    sx={{
                      minWidth: 40,
                      bgcolor: currentValue === value ? 'primary.main' : 'transparent',
                      color: currentValue === value ? 'white' : 'inherit',
                    }}
                  >
                    {value}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            ) : (
              <FormControl fullWidth size="small" disabled={isDisabled}>
                <Select
                  value={currentValue}
                  onChange={event =>
                    handleSelectionChange(attrName, event.target.value || null)
                  }
                  displayEmpty
                  renderValue={selected =>
                    selected || `Seleccionar ${attrLabel}`
                  }
                >
                  <MenuItem value="">
                    <em>Quitar selección</em>
                  </MenuItem>

                  {availableValues.map(value => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        )
      })}

      {selectedVariant ? (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            bgcolor: alpha(theme.palette.success.main, 0.12),
            border: `1px solid ${alpha(theme.palette.success.main, 0.24)}`,
            borderRadius: 1.5,
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Typography variant="body2" fontWeight={700} color='black'>
              Disponible: {Number(selectedVariant.stock || 0)} unidades
            </Typography>

            <Chip
              label={selectedVariant.sku || 'Variante seleccionada'}
              size="small"
              color="success"
              variant="outlined"
            />
          </Stack>
        </Box>
      ) : (
        <Alert severity="warning" sx={{ mt: 2 }} icon={<StockIcon />}>
          Seleccioná todas las opciones para ver precio y disponibilidad exactos.
        </Alert>
      )}
    </Box>
  )
}

const getEntityId = value => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value._id) return value._id
  return String(value)
}

const getProductFromPromotionalItem = item => {
  if (!item) return null

  if (item.productId && typeof item.productId === 'object') {
    return item.productId
  }

  if (item.product && typeof item.product === 'object') {
    return item.product
  }

  return null
}

const getDiscountedPrice = (price, discountPercentage) => {
  const basePrice = Number(price || 0)
  const discount = Number(discountPercentage || 0)

  if (discount <= 0) return basePrice

  return Math.max(0, basePrice - basePrice * (discount / 100))
}

const getReviewerName = review => {
  if (!review) return 'Cliente'

  const directName =
    review.postedByName ||
    review.userName ||
    review.name ||
    review.reviewerName

  if (directName && String(directName).trim()) {
    return String(directName).trim()
  }

  const postedBy = review.postedBy

  if (postedBy && typeof postedBy === 'object') {
    const fullName = [
      postedBy.firstname || postedBy.firstName || postedBy.nombre,
      postedBy.lastname || postedBy.lastName || postedBy.apellido,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()

    if (fullName) return fullName

    if (postedBy.name) return postedBy.name
    if (postedBy.email) return postedBy.email
  }

  return 'Cliente'
}

const getReviewerInitial = review => {
  const name = getReviewerName(review)
  return name.charAt(0).toUpperCase()
}

const hasClientAuthToken = () => {
  if (typeof window === 'undefined') return false

  const token = window.localStorage.getItem('token')
  return Boolean(token && token !== 'null' && token !== 'undefined')
}

const SingleProduct = () => {
  const { id } = useParams()
  const dispatch = useDispatch()

  const { singleProduct: product, isLoading } = useSelector(s => s.product)
  const { wishlist, user } = useSelector(s => s.user)
  const isAuthenticated = useSelector(selectIsAuthenticated)
  const themeState = useSelector(state => state.theme) || {}
  const activeThemeConfig = useMemo(() => getActiveThemeConfig(themeState), [themeState])
  const layoutConfig = useMemo(
    () => getLayoutThemeConfig(activeThemeConfig),
    [activeThemeConfig],
  )
  const spacingConfig = useMemo(
    () => getSpacingThemeConfig(activeThemeConfig),
    [activeThemeConfig],
  )
  const themeColors = useMemo(
    () => getThemeColors(activeThemeConfig),
    [activeThemeConfig],
  )
  const formatPrice = useCallback(
    value => formatCurrency(value, activeThemeConfig),
    [activeThemeConfig],
  )
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const promotionalBlocks = useSelector(selectPublicPromotionalBlocks)

  const [question, setQuestion] = useState('')
  const [activeImg, setActiveImg] = useState(0)
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 })
  const [isZooming, setIsZooming] = useState(false)

  const [selectedVariant, setSelectedVariant] = useState(null)
  const [selectedAttributes, setSelectedAttributes] = useState({})

  const [showRatingForm, setShowRatingForm] = useState(false)
  const [userStar, setUserStar] = useState(0)
  const [userComment, setUserComment] = useState('')
  const [isSubmittingRating, setIsSubmittingRating] = useState(false)
  const [guestData, setGuestData] = useState({
    name: '',
    email: '',
    mobile: '',
  })

  useEffect(() => {
    if (id) {
      dispatch(getProduct(id))
      if (user) dispatch(getUserProductWishlist())
    }
  }, [id, dispatch, user])

  useEffect(() => {
    dispatch(fetchPublicPromotionalBlocks({ placement: 'home' }))
  }, [dispatch])

  useEffect(() => {
    setSelectedVariant(null)
    setSelectedAttributes({})
    setActiveImg(0)
  }, [product?._id])

  const hasVariants = useMemo(() => {
    return Boolean(product?.hasVariants || product?.variants?.length > 0)
  }, [product])

  const normalizedSelectedVariant = useMemo(() => {
    return normalizeVariantForCart(selectedVariant, selectedAttributes)
  }, [selectedVariant, selectedAttributes])

  const activePromotionItem = useMemo(() => {
    if (!product?._id || !Array.isArray(promotionalBlocks)) return null

    const productId = getEntityId(product._id)

    for (const block of promotionalBlocks) {
      if (!block?.isActive) continue
      if (block?.visibility && block.visibility !== 'public') continue

      const products = Array.isArray(block.products) ? block.products : []

      const match = products.find(item => {
        if (item?.isActive === false) return false

        const promotedProduct = getProductFromPromotionalItem(item)
        const promotedProductId = promotedProduct?._id || item?.productId

        return getEntityId(promotedProductId) === productId
      })

      if (match) {
        return {
          ...match,
          blockId: block._id,
          blockTitle: block.title,
          blockType: block.type,
        }
      }
    }

    return null
  }, [product?._id, promotionalBlocks])

  const promotionDiscount = useMemo(() => {
    return Number(activePromotionItem?.discountPercentage || 0)
  }, [activePromotionItem])

  const hasActivePromotion = promotionDiscount > 0

  const productImages = useMemo(() => {
    if (Array.isArray(product?.images) && product.images.length > 0) {
      return product.images
    }
    return [{ url: placeholder }]
  }, [product])

  const variantImageUrl = useMemo(() => {
    return normalizedSelectedVariant?.image || null
  }, [normalizedSelectedVariant])

  const activeImageUrl = useMemo(() => {
    if (variantImageUrl) {
      return variantImageUrl
    }

    return productImages?.[activeImg]?.url || productImages?.[0]?.url || placeholder
  }, [variantImageUrl, productImages, activeImg])

  useEffect(() => {
    setActiveImg(0)
  }, [normalizedSelectedVariant?.id])

  const iaAnalysis = useMemo(() => {
    if (!product) return { score: 'N/A', count: 0, avg: 0 }

    const ratingsArray = Array.isArray(product.ratings)
      ? product.ratings.filter(review => {
        const star = Number(review?.star)
        return star >= 1 && star <= 5
      })
      : []
    const count = ratingsArray.length
    const persistedAverage = Number(product.totalrating) || 0
    const avg =
      count > 0
        ? ratingsArray.reduce((acc, curr) => acc + (Number(curr.star) || 0), 0) / count
        : persistedAverage

    return {
      score: avg > 0 ? avg.toFixed(1) : 'N/A',
      count,
      avg,
      summary: avg >= 4.2 ? 'Alta Confianza' : 'Calidad Estándar',
      reason:
        count > 0
          ? `Basado en ${count} opiniones.`
          : avg > 0
            ? 'Basado en la calificación guardada.'
            : 'Sin suficientes datos.',
    }
  }, [product])

  const displayPrice = useMemo(() => {
    const applyDiscount = price => {
      return hasActivePromotion ? getDiscountedPrice(price, promotionDiscount) : Number(price || 0)
    }

    if (normalizedSelectedVariant?.price > 0) {
      const original = Number(normalizedSelectedVariant.price || 0)

      return {
        original,
        final: applyDiscount(original),
        hasDiscount: hasActivePromotion,
        discountPercentage: promotionDiscount,
        isRange: false,
      }
    }

    if (hasVariants && product?.variants?.length > 0) {
      const prices = product.variants
        .filter(variant => variant.isActive !== false)
        .map(variant => Number(variant.price || 0))
        .filter(price => price > 0)

      if (prices.length) {
        const min = Math.min(...prices)
        const max = Math.max(...prices)

        if (min === max) {
          return {
            original: min,
            final: applyDiscount(min),
            hasDiscount: hasActivePromotion,
            discountPercentage: promotionDiscount,
            isRange: false,
          }
        }

        return {
          min,
          max,
          finalMin: applyDiscount(min),
          finalMax: applyDiscount(max),
          hasDiscount: hasActivePromotion,
          discountPercentage: promotionDiscount,
          isRange: true,
        }
      }
    }

    const original = Number(product?.price || 0)

    return {
      original,
      final: applyDiscount(original),
      hasDiscount: hasActivePromotion,
      discountPercentage: promotionDiscount,
      isRange: false,
    }
  }, [normalizedSelectedVariant, hasVariants, product, hasActivePromotion, promotionDiscount])
  const displayStock = useMemo(() => {
    if (normalizedSelectedVariant) return normalizedSelectedVariant.stock

    if (hasVariants) {
      return (
        product?.variants
          ?.filter(v => v.isActive !== false)
          ?.reduce((sum, v) => sum + Number(v.stock || 0), 0) || 0
      )
    }

    return Number(product?.stock || 0)
  }, [normalizedSelectedVariant, hasVariants, product])

  const isAvailable = useMemo(() => {
    if (hasVariants) {
      if (!normalizedSelectedVariant) return false
      return normalizedSelectedVariant.stock > 0
    }

    return Number(product?.stock || 0) > 0
  }, [hasVariants, normalizedSelectedVariant, product])

  const isFavorite = useMemo(
    () => wishlist?.some(item => item._id === product?._id),
    [wishlist, product],
  )

  const handleVariantSelect = useCallback((variant, attributes) => {
    setSelectedVariant(variant || null)
    setSelectedAttributes(attributes || {})

    if (!variant) {
      setActiveImg(0)
    }
  }, [])

  const resolveCartPricing = ({
    displayPrice,
    hasVariants,
    normalizedSelectedVariant,
    product,
    hasActivePromotion,
    promotionDiscount,
  }) => {
    const basePrice = hasVariants
      ? Number(normalizedSelectedVariant?.price || 0)
      : Number(product?.price || 0)

    if (displayPrice?.isRange) {
      return {
        originalPrice: basePrice,
        finalPrice: hasActivePromotion
          ? getDiscountedPrice(basePrice, promotionDiscount)
          : basePrice,
        discountPercentage: hasActivePromotion ? promotionDiscount : 0,
        hasPromotion: hasActivePromotion,
      }
    }

    return {
      originalPrice: Number(displayPrice?.original ?? basePrice),
      finalPrice: Number(displayPrice?.final ?? basePrice),
      discountPercentage: hasActivePromotion ? promotionDiscount : 0,
      hasPromotion: hasActivePromotion,
    }
  }

  const handleAddToCart = useCallback(async () => {
    if (!product?._id) {
      toast.error('Producto inválido')
      return
    }

    if (hasVariants) {
      if (!normalizedSelectedVariant) {
        toast.error('Selecciona todas las opciones disponibles')
        return
      }

      if (!normalizedSelectedVariant.id) {
        toast.error('La variante seleccionada no tiene identificador válido')
        return
      }

      if (normalizedSelectedVariant.stock <= 0) {
        toast.error('Esta combinación está agotada')
        return
      }
    } else if (Number(product?.stock || 0) <= 0) {
      toast.error('Producto agotado')
      return
    }

    try {
      const { originalPrice, finalPrice, discountPercentage, hasPromotion } = resolveCartPricing({
        displayPrice,
        hasVariants,
        normalizedSelectedVariant,
        product,
        hasActivePromotion,
        promotionDiscount,
      })

      const resolvedImage = hasVariants
        ? normalizedSelectedVariant?.image || activeImageUrl || placeholder
        : activeImageUrl || placeholder

      const promotionPayload = {
        originalPrice,
        discountPercentage,
        promotionId: activePromotionItem?.blockId || null,
        promotionTitle: activePromotionItem?.blockTitle || null,
        promotionType: activePromotionItem?.blockType || null,
        hasPromotion,
      }

      const cartItem = {
        productId: product._id,
        tenantId: product.tenantId,
        quantity: 1,

        title: product.title,
        image: resolvedImage,

        // Precio final que debe usar el carrito
        price: finalPrice,

        // Metadata de promoción
        ...promotionPayload,

        hasVariants,

        ...(hasVariants && normalizedSelectedVariant
          ? {
              variantId: normalizedSelectedVariant.id,
              variantSku: normalizedSelectedVariant.sku,
              variantSKU: normalizedSelectedVariant.sku,

              selectedAttributes: normalizedSelectedVariant.attributes,
              variantAttributes: normalizedSelectedVariant.attributes,

              selectedVariant: {
                id: normalizedSelectedVariant.id,
                sku: normalizedSelectedVariant.sku,

                // También dentro de la variante
                price: finalPrice,
                originalPrice,
                discountPercentage,
                hasPromotion,

                stock: normalizedSelectedVariant.stock,
                image: normalizedSelectedVariant.image || resolvedImage,
                attributes: normalizedSelectedVariant.attributes,
                promotionId: activePromotionItem?.blockId || null,
                promotionTitle: activePromotionItem?.blockTitle || null,
                promotionType: activePromotionItem?.blockType || null,
              },

              cartKey: buildVariantCartKey(
                product._id,
                normalizedSelectedVariant.raw,
                normalizedSelectedVariant.attributes,
              ),
            }
          : {
              cartKey: `${product._id}::base`,
            }),
      }

      console.log('[SingleProduct] Cart item enviado:', cartItem)

      await dispatch(addOrUpdateCartItem(cartItem)).unwrap()

      toast.success(
        hasPromotion ? '¡Producto en oferta añadido al carrito!' : '¡Añadido al carrito!',
      )
    } catch (err) {
      console.error('INICIE SESION PARA COMPRAR:', err)
      toast.error(err?.message || 'INICIE SESION PARA COMPRAR')
    }
  }, [
    product,
    dispatch,
    hasVariants,
    normalizedSelectedVariant,
    activeImageUrl,
    displayPrice,
    hasActivePromotion,
    promotionDiscount,
    activePromotionItem,
  ])

  const handleRateSubmit = async () => {
    const canRate = Boolean(user && (isAuthenticated || hasClientAuthToken()))

    if (!canRate) {
      toast.error('Inicia sesión para calificar')
      return
    }

    const normalizedStar = Math.trunc(Number(userStar))
    const productId = product?._id || product?.id

    if (
      !Number.isInteger(normalizedStar) ||
      normalizedStar < 1 ||
      normalizedStar > 5
    ) {
      toast.error('Seleccioná una calificación válida entre 1 y 5 estrellas')
      return
    }

    if (!productId) {
      toast.error('Producto inválido')
      return
    }

    try {
      setIsSubmittingRating(true)

      await dispatch(
        rateProduct({
          productId,
          star: normalizedStar,
          rating: normalizedStar,
          comment: userComment || '',
        }),
      ).unwrap()

      toast.success('¡Reseña publicada!')
      setShowRatingForm(false)
      setUserStar(0)
      setUserComment('')
      dispatch(getProduct(id))
    } catch (err) {
      toast.error(
        typeof err === 'string'
          ? err
          : err?.message || 'Error al publicar reseña',
      )
    } finally {
      setIsSubmittingRating(false)
    }
  }

  const handleSendQuestion = () => {
    if (!question.trim()) return toast.error('Escribe tu pregunta')

    if (!user) {
      if (!guestData.name || !guestData.email || !guestData.mobile) {
        return toast.error('Completa tus datos de contacto')
      }

      const emailRegex = /\S+@\S+\.\S+/
      if (!emailRegex.test(guestData.email)) {
        return toast.error('Email no válido')
      }
    }

    const payload = {
      name: user ? `${user.firstname} ${user.lastname || ''}` : guestData.name,
      email: user ? user.email : guestData.email,
      mobile: user ? user.mobile : guestData.mobile,
      comment: `Consulta sobre: ${product.title}${
        normalizedSelectedVariant?.sku ? ` (Variante: ${normalizedSelectedVariant.sku})` : ''
      } - Mensaje: ${question}`,
      tenantId: product.tenantId,
    }

    dispatch(createEnquiry(payload))
      .unwrap()
      .then(() => {
        toast.success('¡Pregunta enviada!')
        setQuestion('')
        if (!user) setGuestData({ name: '', email: '', mobile: '' })
      })
      .catch(err => toast.error(err || 'Error al enviar'))
  }

  if (isLoading || !product) {
    return (
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          py: `${spacingConfig.section}px`,
          maxWidth: layoutConfig.maxWidth,
          px: `${layoutConfig.containerPadding}px`,
        }}
      >
        <Skeleton variant="rectangular" height={500} />
      </Container>
    )
  }

  return (
    <Container
      maxWidth={false}
      disableGutters
      sx={{
        py: `${spacingConfig.section}px`,
        maxWidth: layoutConfig.maxWidth,
        px: `${layoutConfig.containerPadding}px`,
      }}
    >
      <Toaster position="bottom-right" />

      <Grid container spacing={8} justifyContent="center">
        <Grid item xs={12} md={6}>
          <Stack spacing={3} alignItems="flex-end">
            <Typography
              variant="h5"
              fontWeight={700}
              sx={{ color: themeColors.text, width: IMG_BOX_SIZE }}
            >
              {product.title}
            </Typography>

            <Stack direction="row" spacing={2}>
              <Stack spacing={1.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
                {variantImageUrl ? (
                  <ThumbButton active>
                    <img
                      src={variantImageUrl}
                      alt="variant-thumb"
                      onError={e => {
                        e.currentTarget.src = placeholder
                      }}
                    />
                  </ThumbButton>
                ) : (
                  productImages.slice(0, 6).map((img, i) => (
                    <ThumbButton
                      key={img?._id || img?.url || i}
                      active={activeImg === i}
                      onMouseEnter={() => setActiveImg(i)}
                    >
                      <img
                        src={img?.url || placeholder}
                        alt={`thumb-${i}`}
                        onError={e => {
                          e.currentTarget.src = placeholder
                        }}
                      />
                    </ThumbButton>
                  ))
                )}
              </Stack>

              <MainImageWindow
                onMouseMove={e => {
                  const { left, top, width, height } = e.currentTarget.getBoundingClientRect()
                  setZoomPos({
                    x: ((e.pageX - window.scrollX - left) / width) * 100,
                    y: ((e.pageY - window.scrollY - top) / height) * 100,
                  })
                }}
                onMouseEnter={() => setIsZooming(true)}
                onMouseLeave={() => setIsZooming(false)}
              >
                <img
                  src={activeImageUrl}
                  style={{
                    transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                    transform: isZooming ? 'scale(2.2)' : 'scale(1)',
                  }}
                  alt={product.title}
                  onError={e => {
                    e.currentTarget.src = placeholder
                  }}
                />

                {normalizedSelectedVariant?.sku && (
                  <Chip
                    label={normalizedSelectedVariant.sku}
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      bgcolor: 'rgba(255,255,255,0.9)',
                    }}
                  />
                )}
              </MainImageWindow>
            </Stack>

            <Stack direction="row" spacing={2} sx={{ width: IMG_BOX_SIZE }}>
              <Button
                fullWidth
                variant="contained"
                onClick={handleAddToCart}
                disabled={!isAvailable}
                startIcon={<CartIcon />}
                sx={{
                  height: 60,
                  borderRadius: 3,
                  bgcolor: isAvailable ? themeColors.actionPrimary : 'action.disabledBackground',
                  color: isAvailable ? themeColors.actionPrimaryText : 'text.disabled',
                  fontWeight: 800,
                  '&:hover': {
                    bgcolor: isAvailable ? themeColors.actionPrimary : 'action.disabledBackground',
                  },
                }}
              >
                {!isAvailable
                  ? hasVariants && !normalizedSelectedVariant
                    ? 'Selecciona opciones'
                    : 'Agotado'
                  : 'Añadir al carrito'}
              </Button>

              <IconButton
                onClick={() =>
                  user ? dispatch(toggleWishlist(product._id)) : toast.error('Inicia sesión')
                }
                sx={{
                  borderRadius: 3,
                  width: 60,
                  height: 60,
                  border: '1px solid',
                  borderColor: 'divider',
                  color: isFavorite ? 'error.main' : 'text.secondary',
                }}
              >
                {isFavorite ? <FavIcon /> : <FavBorderIcon />}
              </IconButton>
            </Stack>
          </Stack>
        </Grid>

        <Grid item xs={12} md={6}>
          <Stack spacing={4} sx={{ maxWidth: 450 }}>
            <Box>
              {displayPrice?.isRange ? (
                <Box>
                  {displayPrice.hasDiscount && (
                    <Typography
                      variant="body1"
                      sx={{ color: themeColors.cardMutedText, textDecoration: 'line-through', fontWeight: 600 }}
                    >
                      {formatPrice(displayPrice.min)} - {formatPrice(displayPrice.max)}
                    </Typography>
                  )}

                  <Typography variant="h4" fontWeight={800} sx={{ color: themeColors.cardPrice }}>
                    {formatPrice(displayPrice.finalMin)} - {formatPrice(displayPrice.finalMax)}
                  </Typography>

                  {displayPrice.hasDiscount && (
                    <Chip
                      label={`${displayPrice.discountPercentage}% OFF`}
                      color="secondary"
                      size="small"
                      sx={{ mt: 1, fontWeight: 800 }}
                    />
                  )}
                </Box>
              ) : (
                <Box>
                  {displayPrice?.hasDiscount && (
                    <Typography
                      variant="body1"
                      sx={{ color: themeColors.cardMutedText, textDecoration: 'line-through', fontWeight: 600 }}
                    >
                      {formatPrice(displayPrice.original)}
                    </Typography>
                  )}

                  <Typography variant="h4" fontWeight={800} sx={{ color: themeColors.cardPrice }}>
                    {formatPrice(displayPrice.final)}
                  </Typography>

                  {displayPrice?.hasDiscount && (
                    <Stack direction="row" spacing={1} mt={1} flexWrap="wrap">
                      <Chip
                        label={`${displayPrice.discountPercentage}% OFF`}
                        size="small"
                        sx={{
                          fontWeight: 800,
                          bgcolor: themeColors.badgeBackground,
                          color: themeColors.badgeText,
                        }}
                      />

                      {activePromotionItem?.blockTitle && (
                        <Chip
                          label={activePromotionItem.blockTitle}
                          variant="outlined"
                          size="small"
                          sx={{
                            fontWeight: 700,
                            borderColor: themeColors.cardBorder,
                            color: themeColors.cardText,
                            bgcolor: themeColors.cardBackground,
                          }}
                        />
                      )}
                    </Stack>
                  )}
                </Box>
              )}

              {hasVariants && !normalizedSelectedVariant && (
                <Typography variant="body2" sx={{ color: themeColors.cardMutedText }}>
                  Selecciona opciones para ver precio exacto
                </Typography>
              )}

            </Box>

            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: 4,
                bgcolor: 'background.paper',
                borderColor: 'info.main',
              }}
            >
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="h3" sx={{ color: themeColors.cardPrice }} fontWeight={900}>
                  {iaAnalysis.score}
                </Typography>
                <Box>
                  <Typography
                    variant="subtitle2"
                    fontWeight={800}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                  >
                    <AIIcon fontSize="small" /> IA ANALYTICS: {iaAnalysis.summary}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {iaAnalysis.reason}
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {hasVariants ? (
              <ProductVariantSelector
                product={product}
                onVariantSelect={handleVariantSelect}
                selectedVariant={normalizedSelectedVariant}
              />
            ) : (
              <Chip
                icon={<StockIcon />}
                label={`${displayStock} unidades disponibles`}
                color={displayStock > 0 ? 'success' : 'error'}
                variant="outlined"
              />
            )}

            <Divider />

            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="h6" fontWeight={800} color= {Newprimary.darkBlueGray}>
                  Calificación general
                </Typography>
                <Button
                  size="small"
                  startIcon={<ReviewIcon />}
                  onClick={() => setShowRatingForm(!showRatingForm)}
                  sx={{ textTransform: 'none', fontWeight: 700, color: themeColors.text}}
                >
                  {showRatingForm ? 'Cerrar' : 'Opinar'}
                </Button>
              </Stack>

              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography variant="h3" fontWeight={900} color= {themeColors.text}>
                  {iaAnalysis.avg > 0 ? iaAnalysis.avg.toFixed(1) : '0.0'}
                </Typography>
                <Box>
                  <ReactStars
                    count={5}
                    size={28}
                    value={Number(iaAnalysis.avg) || 0}
                    edit={false}
                    half
                    color1={themeColors.border}
                    color2={themeColors.warning}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {iaAnalysis.count} opiniones
                  </Typography>
                </Box>
              </Stack>

              <Collapse in={showRatingForm} sx={{ mt: 2 }}>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: 'background.paper',
                    borderRadius: 2,
                    border: '1px dashed',
                    borderColor: 'divider',
                  }}
                >
                  {normalizedSelectedVariant?.attributes && (
                    <Typography
                      variant="caption"
                      display="block"
                      mb={1}
                      sx={{ color: theme.palette.ctaPrimary.main }}
                    >
                      Opinando sobre:{' '}
                      {Object.values(normalizedSelectedVariant.attributes).join(' / ')}
                    </Typography>
                  )}
                  <ReactStars
                    count={5}
                    size={28}
                    value={userStar}
                    onChange={value => setUserStar(Math.trunc(Number(value)) || 0)}
                    color2={themeColors.warning}
                  />
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    size="small"
                    placeholder="Tu opinión..."
                    value={userComment}
                    onChange={e => setUserComment(e.target.value)}
                    sx={{ my: 1.5, bgcolor: 'background.paper' }}
                  />
                  <Button
                    type="button"
                    variant="contained"
                    size="small"
                    fullWidth
                    disabled={isSubmittingRating}
                    onClick={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      handleRateSubmit()
                    }}
                  >
                    {isSubmittingRating ? 'Enviando...' : 'Enviar'}
                  </Button>
                </Paper>
              </Collapse>
            </Box>

            <Divider />

            <Box>
              <Typography variant="h6" fontWeight={900} mb={2} color="text.primary">
                Reseñas recientes
              </Typography>
              <Stack spacing={2.5}>
                {product.ratings?.length > 0 ? (
                  product.ratings.map((rev, i) => (
                    <Box key={rev._id || i}>
                      <Stack direction="row" spacing={1} alignItems="center">
                      <Avatar
                        sx={{
                          width: 28,
                          height: 28,
                          fontSize: 13,
                          bgcolor: theme.palette.brand.main,
                          color: theme.palette.brand.contrastText,
                          fontWeight: 800,
                        }}
                      >
                        {getReviewerInitial(rev)}
                      </Avatar>
                        <Typography variant="caption" fontWeight={800}>
                          {getReviewerName(rev)}
                        </Typography>
                        {rev.variantId && (
                          <Chip
                            label="Variante"
                            size="small"
                            variant="outlined"
                            sx={{
                              color: theme.palette.brand.main,
                              borderColor: theme.palette.brand.main,
                            }}
                          />
                        )}
                        <ReactStars
                          count={5}
                          size={15}
                          value={Number(rev.star) || 0}
                          edit={false}
                          color2={themeColors.warning}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.primary" sx={{ mt: 0.5, pl: 4 }}>
                        {rev.comment || 'Calificó sin comentar.'}
                      </Typography>
                    </Box>
                  ))
                ) : (
                  <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary' }}>
                    Sé el primero en opinar.
                  </Typography>
                )}
              </Stack>
            </Box>

            <Divider />
          </Stack>
        </Grid>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center', 
            mt:4
          }}
        >
          <Typography
            variant="subtitle1"
            fontWeight={800}
            display="flex"
            alignItems="center"
            gap={1}
            color="text.primary"
            sx={{ fontSize: 24 }}
          >
            <VerifiedIcon color="success" fontSize="small" /> Especificaciones
          </Typography>
          <Typography
            sx={{
              mt: 2,
              fontSize: 18,
              whiteSpace: 'pre-line',
              justifyContent: 'start',
              color: 'text.primary',
              fontWeight: 600,
            }}
          >
            {product.description}
          </Typography>
        </Box>
      </Grid>

      <Box sx={{ mt: 10, maxWidth: 800, mx: 'auto' }}>
        <Typography
          fontWeight={900}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 3,
            fontSize: 24,
            color: 'text.primary',
          }}
        >
          <ChatBubbleOutlineIcon fontSize="small" color="primary" />
          Preguntas al vendedor
        </Typography>

        <Paper sx={{ p: 3, borderRadius: 4, bgcolor: 'background.paper' }} variant="outlined">
          <Stack spacing={2.5}>
            {!user && (
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Nombre"
                    name="name"
                    size="small"
                    value={guestData.name}
                    onChange={e => setGuestData({ ...guestData, name: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Email"
                    name="email"
                    size="small"
                    value={guestData.email}
                    onChange={e => setGuestData({ ...guestData, email: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Teléfono"
                    name="mobile"
                    size="small"
                    value={guestData.mobile}
                    onChange={e => setGuestData({ ...guestData, mobile: e.target.value })}
                  />
                </Grid>
              </Grid>
            )}

            <Stack direction={isMobile ? 'column' : 'row'} spacing={1.5}>
              <TextField
                fullWidth
                placeholder="Escribí tu pregunta aquí..."
                value={question}
                onChange={e => setQuestion(e.target.value)}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: theme.palette.background.paper,
                  },
                }}
              />
              <Button
                variant="contained"
                onClick={handleSendQuestion}
                sx={{
                  px: 5,
                  borderRadius: 2,
                  textTransform: 'none',
                  fontWeight: 600,
                  height: 56,
                }}
              >
                Preguntar
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>
    </Container>
  )
}

export default SingleProduct
