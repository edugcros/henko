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
import { styled, useTheme, alpha } from '@mui/material/styles'
import {
  ShoppingCartOutlined as CartIcon,
  Favorite as FavIcon,
  FavoriteBorder as FavBorderIcon,
  AutoAwesome as AIIcon,
  VerifiedUserOutlined as VerifiedIcon,
  RateReviewOutlined as ReviewIcon,
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

const MAX_VISIBLE_THUMBS = 7

const MainImageWindow = styled(Paper)(({ theme }) => ({
  position: 'relative',
  borderRadius: 20,
  width: '100%',
  maxWidth: 580,
  aspectRatio: '1 / 1',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.background.paper,
  cursor: 'zoom-in',
  border: `1px solid ${theme.palette.divider}`,
  boxShadow: '0 22px 55px rgba(15, 23, 42, 0.09)',
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
  width: 74,
  height: 74,
  borderRadius: 14,
  cursor: 'pointer',
  padding: 5,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.background.paper,
  border: `2px solid ${active ? theme.palette.primary.main : theme.palette.divider}`,
  transition: '0.2s ease',
  boxShadow: active ? '0 10px 24px rgba(15, 23, 42, 0.12)' : 'none',
  '&:hover': { transform: 'translateY(-2px)' },
  '& img': {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
}))

const clean = value => String(value || '').trim()

const normalizeImageUrl = img => {
  if (!img) return null
  if (typeof img === 'string' && img.trim()) return img.trim()

  if (typeof img === 'object') {
    const candidates = [
      img.url,
      img.secure_url,
      img.src,
      img.imageUrl,
      img.imageURL,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim())
        return candidate.trim()
    }
  }

  return null
}

const toObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const safeArray = value => (Array.isArray(value) ? value : [])

const safeJsonParse = value => {
  if (!value) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const humanizeKey = value => {
  const cleanValue = clean(value)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()

  if (!cleanValue) return ''

  return cleanValue.replace(/\b\w/g, char => char.toUpperCase())
}

const normalizeAttributes = variant => {
  if (!variant) return {}
  return toObject(
    variant.attributes || variant.combinacion || variant.attributeValues,
  )
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

const getVariantImageUrl = variant => {
  if (!variant) return null

  const directCandidates = [
    variant.image,
    variant.imageUrl,
    variant.imageURL,
    variant.secure_url,
    variant.src,
    variant.previewUrl,
    variant.selectedImage,
  ]

  for (const candidate of directCandidates) {
    const normalized = normalizeImageUrl(candidate)
    if (normalized) return normalized
  }

  if (variant.images) {
    if (Array.isArray(variant.images)) {
      for (const imageCandidate of variant.images) {
        const normalized = normalizeImageUrl(imageCandidate)
        if (normalized) return normalized
      }
    }

    const normalized = normalizeImageUrl(variant.images)
    if (normalized) return normalized
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

const inferVariantAttributesFromVariants = variants => {
  const map = new Map()

  safeArray(variants).forEach(variant => {
    const attrs = normalizeAttributes(variant)

    Object.entries(attrs).forEach(([key, value]) => {
      if (!key || value === undefined || value === null || value === '') return

      const normalizedKey = clean(key)
      if (!map.has(normalizedKey)) {
        map.set(normalizedKey, {
          name: normalizedKey,
          label: humanizeKey(normalizedKey),
          type: /color|colour/i.test(normalizedKey) ? 'color' : 'select',
          values: [],
        })
      }

      const row = map.get(normalizedKey)
      row.values = [...new Set([...safeArray(row.values), String(value)])]
    })
  })

  return Array.from(map.values())
}

const ProductVariantSelector = ({
  product,
  onVariantSelect,
  selectedVariant,
}) => {
  const theme = useTheme()

  const variants = useMemo(
    () =>
      safeArray(product?.variants).filter(
        variant => variant?.isActive !== false,
      ),
    [product?.variants],
  )

  const variantAttributes = useMemo(() => {
    const configured = safeArray(product?.variantAttributes).filter(
      attr => attr?.name,
    )
    if (configured.length) return configured
    return inferVariantAttributesFromVariants(variants)
  }, [product?.variantAttributes, variants])

  const [selections, setSelections] = useState({})

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
        if (value) values.add(String(value))
      })

      const declaredValues = safeArray(
        variantAttributes.find(attr => attr.name === attrName)?.values,
      )

      return [...new Set([...declaredValues, ...values])].sort((a, b) =>
        String(a).localeCompare(String(b)),
      )
    },
    [variants, variantAttributes],
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

        const changedIndex = variantAttributes.findIndex(
          attr => attr.name === attrName,
        )
        variantAttributes.forEach((attr, index) => {
          if (index > changedIndex) delete updated[attr.name]
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
        const changedIndex = variantAttributes.findIndex(
          attr => attr.name === attrName,
        )

        delete updated[attrName]

        variantAttributes.forEach((attr, index) => {
          if (index > changedIndex) delete updated[attr.name]
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
    <Paper
      variant="outlined"
      sx={{
        mt: 2,
        p: 2,
        bgcolor: theme.palette.background.paper,
        borderColor: alpha(theme.palette.primary.main, 0.28),
        borderRadius: 3,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={900} color="text.primary">
            Elegí las opciones disponibles
          </Typography>
          <Typography variant="caption" color="text.secondary">
            El precio, stock e imagen pueden cambiar según la combinación.
          </Typography>
        </Box>

        <Button
          size="small"
          variant="text"
          onClick={handleClearAll}
          sx={{ textTransform: 'none', fontWeight: 800 }}
        >
          Limpiar
        </Button>
      </Stack>

      {variantAttributes.map((attr, index) => {
        const attrName = attr?.name
        const attrLabel = attr?.label || humanizeKey(attrName)
        if (!attrName) return null

        const availableValues = getAvailableValues(attrName, selections)
        const isDisabled =
          index > 0 && !selections[variantAttributes[index - 1]?.name]
        const currentValue = selections[attrName] || ''

        return (
          <Box key={attrName} sx={{ mb: 2 }}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 0.75 }}
            >
              <Typography
                variant="caption"
                color="text.primary"
                fontWeight={800}
                display="block"
              >
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
                    fontWeight: 800,
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
                sx={{ flexWrap: 'wrap', gap: 0.75 }}
              >
                {availableValues.map(value => (
                  <ToggleButton
                    key={value}
                    value={value}
                    sx={{
                      minWidth: 44,
                      borderRadius: '999px !important',
                      px: 1.2,
                      bgcolor:
                        currentValue === value ? 'primary.main' : 'transparent',
                      color:
                        currentValue === value
                          ? 'primary.contrastText'
                          : 'inherit',
                      border: '1px solid !important',
                      borderColor:
                        currentValue === value ? 'primary.main' : 'divider',
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
            borderRadius: 2,
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            gap={1}
          >
            <Typography variant="caption" fontWeight={800} color="text.primary">
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
          Seleccioná todas las opciones para ver precio, imagen y disponibilidad
          exactas.
        </Alert>
      )}
    </Paper>
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
  if (item.productId && typeof item.productId === 'object')
    return item.productId
  if (item.product && typeof item.product === 'object') return item.product
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
    review.postedByName || review.userName || review.name || review.reviewerName
  if (directName && String(directName).trim()) return String(directName).trim()

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

const getReviewerInitial = review =>
  getReviewerName(review).charAt(0).toUpperCase()

const formatSpecificationValue = value => {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ')
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(
        ([, itemValue]) =>
          itemValue !== undefined && itemValue !== null && itemValue !== '',
      )
      .map(
        ([key, itemValue]) =>
          `${humanizeKey(key)}: ${formatSpecificationValue(itemValue)}`,
      )
      .join(' · ')
  }
  return String(value)
}

const normalizeSpecificationArray = explicitSpecifications => {
  return explicitSpecifications
    .filter(spec => spec?.visible !== false)
    .map((spec, index) => {
      const key = spec.key || spec.name || spec.code || `spec-${index}`
      const rawValue = spec.value ?? spec.valor ?? spec.content ?? spec.text

      return {
        key,
        label:
          spec.label ||
          spec.title ||
          spec.name ||
          humanizeKey(key) ||
          `Dato ${index + 1}`,
        value: formatSpecificationValue(rawValue),
        unit: spec.unit || spec.suffix || '',
        group: spec.group || spec.section || 'Ficha técnica',
        sortOrder: Number(spec.sortOrder ?? spec.order ?? index),
        filterable: spec.filterable === true,
        searchable: spec.searchable !== false,
        source: spec.source || 'specification',
      }
    })
    .filter(spec => spec.value)
}

const normalizeSpecificationRows = product => {
  const explicitSpecifications = product?.specifications

  if (Array.isArray(explicitSpecifications) && explicitSpecifications.length) {
    return normalizeSpecificationArray(explicitSpecifications).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
    )
  }

  const baseObjects = [
    toObject(product?.productAttributes),
    toObject(product?.categoryAttributes),
    toObject(product?.dynamicFields),
    toObject(product?.atributos),
    !Array.isArray(product?.specifications)
      ? toObject(product?.specifications)
      : {},
  ]

  const merged = Object.assign({}, ...baseObjects)

  if (product?.material && !merged.material) merged.material = product.material
  if (product?.color && !merged.color) merged.color = product.color

  return Object.entries(merged)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    )
    .map(([key, value], index) => ({
      key,
      label: humanizeKey(key),
      value: formatSpecificationValue(value),
      unit: '',
      group: 'Ficha técnica',
      sortOrder: index,
      source: 'attributes',
    }))
    .filter(spec => spec.value)
}

const groupSpecifications = specifications => {
  return specifications.reduce((acc, spec) => {
    const group = spec.group || 'Ficha técnica'
    if (!acc[group]) acc[group] = []
    acc[group].push(spec)
    return acc
  }, {})
}

const normalizeLogisticsRows = product => {
  const logistics = product?.logistics || {}
  const rows = []

  const weight = Number(
    logistics.weightKg ?? logistics.weight ?? product?.weightKg ?? 0,
  )
  if (weight > 0) rows.push({ label: 'Peso', value: `${weight} kg` })

  const dimensions =
    logistics.dimensionsCm ||
    logistics.dimensions ||
    logistics.package ||
    product?.dimensions ||
    product?.package ||
    {}

  const length = Number(dimensions.length ?? dimensions.largo ?? 0)
  const width = Number(dimensions.width ?? dimensions.ancho ?? 0)
  const height = Number(dimensions.height ?? dimensions.alto ?? 0)

  if (length || width || height) {
    rows.push({
      label: 'Dimensiones',
      value: `${length || '-'} × ${width || '-'} × ${height || '-'} cm`,
    })
  }

  const shippingLabels = {
    standard: 'Envío estándar',
    fragile: 'Producto frágil',
    refrigerated: 'Requiere refrigeración',
    digital: 'Entrega digital',
    pickup_only: 'Solo retiro',
    custom: 'Envío personalizado',
  }

  const shippingType =
    logistics.shippingType ||
    logistics.shipping?.type ||
    product?.shippingType ||
    product?.shipping?.type

  if (shippingType)
    rows.push({
      label: 'Tipo de envío',
      value: shippingLabels[shippingType] || shippingType,
    })

  const warranty = logistics.warranty || product?.warranty
  if (warranty) rows.push({ label: 'Garantía', value: warranty })

  const originCountry =
    logistics.originCountry ||
    logistics.countryOfOrigin ||
    product?.originCountry ||
    product?.countryOfOrigin
  if (originCountry) rows.push({ label: 'Origen', value: originCountry })

  return rows
}

const getTechnicalDescription = product => {
  const direct =
    product?.technicalDescription ||
    product?.descripcionTecnica ||
    product?.descripcion_tecnica ||
    product?.technical_description ||
    product?.seo?.technicalDescription

  if (clean(direct)) return clean(direct)

  const aiOriginal = safeJsonParse(product?.aiOriginalOutput)
  return clean(
    aiOriginal?.descripcion_tecnica ||
      aiOriginal?.technicalDescription ||
      aiOriginal?.technical_description ||
      aiOriginal?.analysis?.descripcion_tecnica,
  )
}

const getCommercialDescription = product =>
  clean(product?.description || product?.descripcion || '')

const getShortDescription = product => {
  return clean(
    product?.seo?.shortDescription ||
      product?.shortDescription ||
      product?.summary ||
      product?.resumen ||
      '',
  )
}

const getCatalogTags = product => {
  const tagValues = [
    ...safeArray(product?.tags),
    ...safeArray(product?.seo?.keywords),
    ...safeArray(product?.filterAttributes).map(
      item => item?.value || item?.label,
    ),
  ]

  return [
    ...new Set(
      tagValues
        .map(clean)
        .filter(Boolean)
        .map(item => item.toLowerCase()),
    ),
  ].slice(0, 14)
}

const hasClientAuthToken = () => {
  if (typeof window === 'undefined') return false
  const token = window.localStorage.getItem('token')
  return Boolean(token && token !== 'null' && token !== 'undefined')
}

const SectionTitle = ({ label, eyebrow }) => (
  <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2.5 }}>
    <Divider sx={{ flex: 1, opacity: 0.8 }} />
    <Box
      sx={{
        px: 2.5,
        py: 0.75,
        borderRadius: 999,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
      }}
    >
      {eyebrow && (
        <Typography
          variant="caption"
          display="block"
          color="text.secondary"
          fontWeight={800}
          textAlign="center"
        >
          {eyebrow}
        </Typography>
      )}
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          color: 'text.primary',
          fontWeight: 900,
          letterSpacing: 1.4,
          lineHeight: 1,
          textAlign: 'center',
        }}
      >
        {label}
      </Typography>
    </Box>
    <Divider sx={{ flex: 1, opacity: 0.8 }} />
  </Stack>
)

const SpecCard = ({ spec, themeColors }) => (
  <Box
    sx={{
      p: 1.5,
      borderRadius: 2,
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: 'divider',
      height: '100%',
      boxShadow: '0 10px 28px rgba(15, 23, 42, 0.035)',
    }}
  >
    <Typography variant="caption" color="text.secondary" fontWeight={900}>
      {spec.label}
    </Typography>
    <Typography
      variant="body2"
      fontWeight={800}
      sx={{ color: themeColors.text, mt: 0.35 }}
    >
      {spec.value}
      {spec.unit ? ` ${spec.unit}` : ''}
    </Typography>
  </Box>
)

const SingleProduct = () => {
  const { id } = useParams()
  const dispatch = useDispatch()

  const rawProduct = useSelector(s => s.product.singleProduct)
  const product = useMemo(() => {
    if (!rawProduct || typeof rawProduct !== 'object') return rawProduct
    return rawProduct?.data && typeof rawProduct.data === 'object'
      ? rawProduct.data
      : rawProduct
  }, [rawProduct])

  const { isLoading } = useSelector(s => s.product)
  const { wishlist, user } = useSelector(s => s.user)
  const isAuthenticated = useSelector(selectIsAuthenticated)
  const themeState = useSelector(state => state.theme) || {}
  const promotionalBlocks = useSelector(selectPublicPromotionalBlocks)

  const activeThemeConfig = useMemo(
    () => getActiveThemeConfig(themeState),
    [themeState],
  )
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

  const hasVariants = useMemo(
    () => Boolean(product?.hasVariants || product?.variants?.length > 0),
    [product],
  )

  const normalizedSelectedVariant = useMemo(
    () => normalizeVariantForCart(selectedVariant, selectedAttributes),
    [selectedVariant, selectedAttributes],
  )

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

  const promotionDiscount = useMemo(
    () => Number(activePromotionItem?.discountPercentage || 0),
    [activePromotionItem],
  )
  const hasActivePromotion = promotionDiscount > 0

  const productImages = useMemo(() => {
    if (Array.isArray(product?.images) && product.images.length > 0)
      return product.images
    return [{ url: placeholder }]
  }, [product])

  const variantImageUrl = useMemo(
    () => normalizedSelectedVariant?.image || null,
    [normalizedSelectedVariant],
  )

  const activeImageUrl = useMemo(() => {
    if (variantImageUrl) return variantImageUrl
    return (
      productImages?.[activeImg]?.url || productImages?.[0]?.url || placeholder
    )
  }, [variantImageUrl, productImages, activeImg])

  useEffect(() => {
    setActiveImg(0)
  }, [normalizedSelectedVariant?.id])

  const iaAnalysis = useMemo(() => {
    if (!product)
      return {
        score: 'N/A',
        count: 0,
        avg: 0,
        summary: 'Sin datos',
        reason: '',
      }

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
        ? ratingsArray.reduce(
            (acc, curr) => acc + (Number(curr.star) || 0),
            0,
          ) / count
        : persistedAverage

    return {
      score: avg > 0 ? avg.toFixed(1) : 'N/A',
      count,
      avg,
      summary:
        avg >= 4.2
          ? 'Alta confianza'
          : avg > 0
            ? 'Calidad evaluada'
            : 'Sin reseñas',
      reason:
        count > 0
          ? `Basado en ${count} opiniones.`
          : avg > 0
            ? 'Basado en la calificación guardada.'
            : 'Todavía no hay suficientes opiniones.',
    }
  }, [product])

  const displayPrice = useMemo(() => {
    const applyDiscount = price => {
      return hasActivePromotion
        ? getDiscountedPrice(price, promotionDiscount)
        : Number(price || 0)
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
  }, [
    normalizedSelectedVariant,
    hasVariants,
    product,
    hasActivePromotion,
    promotionDiscount,
  ])

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
    () =>
      wishlist?.some(
        item =>
          String(item._id || item.id) === String(product?._id || product?.id),
      ),
    [wishlist, product],
  )

  const commercialDescription = useMemo(
    () => getCommercialDescription(product),
    [product],
  )
  const technicalDescription = useMemo(
    () => getTechnicalDescription(product),
    [product],
  )
  const shortDescription = useMemo(
    () => getShortDescription(product),
    [product],
  )
  const catalogTags = useMemo(() => getCatalogTags(product), [product])

  const descriptionParagraphs = useMemo(
    () =>
      commercialDescription
        .split(/\n+/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean),
    [commercialDescription],
  )

  const technicalParagraphs = useMemo(
    () =>
      technicalDescription
        .split(/\n+/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean),
    [technicalDescription],
  )

  const productSpecifications = useMemo(
    () => normalizeSpecificationRows(product),
    [product],
  )
  const specificationGroups = useMemo(
    () => groupSpecifications(productSpecifications),
    [productSpecifications],
  )
  const logisticsRows = useMemo(
    () => normalizeLogisticsRows(product),
    [product],
  )

  const handleVariantSelect = useCallback((variant, attributes) => {
    setSelectedVariant(variant || null)
    setSelectedAttributes(attributes || {})
    if (!variant) setActiveImg(0)
  }, [])

  const resolveCartPricing = useCallback(
    ({ priceInfo, variantsEnabled, normalizedVariant, productData }) => {
      const basePrice = variantsEnabled
        ? Number(normalizedVariant?.price || 0)
        : Number(productData?.price || 0)

      if (priceInfo?.isRange) {
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
        originalPrice: Number(priceInfo?.original ?? basePrice),
        finalPrice: Number(priceInfo?.final ?? basePrice),
        discountPercentage: hasActivePromotion ? promotionDiscount : 0,
        hasPromotion: hasActivePromotion,
      }
    },
    [hasActivePromotion, promotionDiscount],
  )

  const handleAddToCart = useCallback(async () => {
    if (!product?._id) {
      toast.error('Producto inválido')
      return
    }

    if (hasVariants) {
      if (!normalizedSelectedVariant) {
        toast.error('Seleccioná todas las opciones disponibles')
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
      const { originalPrice, finalPrice, discountPercentage, hasPromotion } =
        resolveCartPricing({
          priceInfo: displayPrice,
          variantsEnabled: hasVariants,
          normalizedVariant: normalizedSelectedVariant,
          productData: product,
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
        price: finalPrice,
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

      if (process.env.REACT_APP_DEBUG_API === 'true') {
        console.log('[SingleProduct] Cart item enviado:', cartItem)
      }

      await dispatch(addOrUpdateCartItem(cartItem)).unwrap()
      toast.success(
        hasPromotion
          ? '¡Producto en oferta añadido al carrito!'
          : '¡Añadido al carrito!',
      )
    } catch (err) {
      if (process.env.REACT_APP_DEBUG_API === 'true') {
        console.error('[SingleProduct] Error agregando al carrito:', err)
      }
      toast.error(err?.message || 'Iniciá sesión para comprar')
    }
  }, [
    product,
    dispatch,
    hasVariants,
    normalizedSelectedVariant,
    activeImageUrl,
    displayPrice,
    activePromotionItem,
    resolveCartPricing,
  ])

  const handleRateSubmit = async () => {
    const canRate = Boolean(user && (isAuthenticated || hasClientAuthToken()))

    if (!canRate) {
      toast.error('Iniciá sesión para calificar')
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
    if (!question.trim()) return toast.error('Escribí tu pregunta')

    if (!user) {
      if (!guestData.name || !guestData.email || !guestData.mobile) {
        return toast.error('Completá tus datos de contacto')
      }

      const emailRegex = /\S+@\S+\.\S+/
      if (!emailRegex.test(guestData.email))
        return toast.error('Email no válido')
    }

    const payload = {
      name: user
        ? `${user.firstname || user.firstName || ''} ${user.lastname || user.lastName || ''}`.trim()
        : guestData.name,
      email: user ? user.email : guestData.email,
      mobile: user ? user.mobile : guestData.mobile,
      comment: `Consulta sobre: ${product.title}${
        normalizedSelectedVariant?.sku
          ? ` (Variante: ${normalizedSelectedVariant.sku})`
          : ''
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
        <Skeleton variant="rectangular" height={500} sx={{ borderRadius: 4 }} />
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

      <Grid
        container
        spacing={{ xs: 4, md: 7 }}
        justifyContent="center"
        alignItems="flex-start"
      >
        <Grid item xs={12} md={6}>
          <Stack spacing={2.5} alignItems={{ xs: 'stretch', md: 'flex-end' }}>
            <Box sx={{ width: '100%', maxWidth: 580 }}>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 1.5 }}>
                {product?.categoria && (
                  <Chip
                    size="small"
                    label={product.categoria}
                    variant="outlined"
                  />
                )}
                {product?.subcategoria && (
                  <Chip
                    size="small"
                    label={product.subcategoria}
                    variant="outlined"
                  />
                )}
                {product?.marca && (
                  <Chip size="small" label={product.marca} variant="outlined" />
                )}
              </Stack>

              <Typography
                variant="h4"
                fontWeight={900}
                sx={{ color: themeColors.text, lineHeight: 1.12 }}
              >
                {product.title}
              </Typography>

              {shortDescription && (
                <Typography
                  variant="subtitle1"
                  sx={{
                    mt: 1,
                    color: themeColors.cardMutedText,
                    lineHeight: 1.65,
                  }}
                >
                  {shortDescription}
                </Typography>
              )}
            </Box>

            <Stack
              direction={{ xs: 'column-reverse', md: 'row' }}
              spacing={2}
              sx={{ width: '100%', maxWidth: 680 }}
            >
              <Stack
                direction={{ xs: 'row', md: 'column' }}
                spacing={1.25}
                sx={{
                  overflowX: { xs: 'auto', md: 'visible' },
                  pb: { xs: 1, md: 0 },
                }}
              >
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
                  productImages.slice(0, MAX_VISIBLE_THUMBS).map((img, i) => (
                    <ThumbButton
                      key={img?._id || img?.url || i}
                      active={activeImg === i}
                      onMouseEnter={() => setActiveImg(i)}
                      onClick={() => setActiveImg(i)}
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
                  const { left, top, width, height } =
                    e.currentTarget.getBoundingClientRect()
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
                      top: 12,
                      right: 12,
                      bgcolor: 'rgba(255,255,255,0.92)',
                      fontWeight: 800,
                    }}
                  />
                )}
              </MainImageWindow>
            </Stack>
          </Stack>
        </Grid>

        <Grid item xs={12} md={6}>
          <Stack spacing={3.25} sx={{ maxWidth: 480 }}>
            <Box>
              {displayPrice?.isRange ? (
                <Box>
                  {displayPrice.hasDiscount && (
                    <Typography
                      variant="body1"
                      sx={{
                        color: themeColors.cardMutedText,
                        textDecoration: 'line-through',
                        fontWeight: 700,
                      }}
                    >
                      {formatPrice(displayPrice.min)} -{' '}
                      {formatPrice(displayPrice.max)}
                    </Typography>
                  )}

                  <Typography
                    variant="h5"
                    fontWeight={900}
                    sx={{ color: themeColors.cardPrice }}
                  >
                    Desde {formatPrice(displayPrice.finalMin)} hasta{' '}
                    {formatPrice(displayPrice.finalMax)}
                  </Typography>
                </Box>
              ) : (
                <Box>
                  {displayPrice?.hasDiscount && (
                    <Typography
                      variant="body1"
                      sx={{
                        color: themeColors.cardMutedText,
                        textDecoration: 'line-through',
                        fontWeight: 700,
                      }}
                    >
                      {formatPrice(displayPrice.original)}
                    </Typography>
                  )}

                  <Typography
                    variant="h4"
                    fontWeight={950}
                    sx={{ color: themeColors.cardPrice }}
                  >
                    {formatPrice(displayPrice.final)}
                  </Typography>
                </Box>
              )}

              {displayPrice?.hasDiscount && (
                <Stack direction="row" spacing={1} mt={1} flexWrap="wrap">
                  <Chip
                    label={`${displayPrice.discountPercentage}% OFF`}
                    size="small"
                    sx={{
                      fontWeight: 900,
                      bgcolor: themeColors.badgeBackground,
                      color: themeColors.badgeText,
                    }}
                  />
                  {activePromotionItem?.blockTitle && (
                    <Chip
                      label={activePromotionItem.blockTitle}
                      variant="outlined"
                      size="small"
                      sx={{ fontWeight: 800 }}
                    />
                  )}
                </Stack>
              )}

              {hasVariants && !normalizedSelectedVariant && (
                <Typography
                  variant="body2"
                  sx={{ color: themeColors.cardMutedText, mt: 0.75 }}
                >
                  Seleccioná opciones para ver precio exacto.
                </Typography>
              )}
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip
                icon={<StockIcon />}
                label={
                  hasVariants && !normalizedSelectedVariant
                    ? 'Stock según variante'
                    : `${displayStock} disponibles`
                }
                color={displayStock > 0 ? 'success' : 'error'}
                variant="outlined"
              />
              {logisticsRows.slice(0, 2).map(row => (
                <Chip
                  key={row.label}
                  icon={<VerifiedIcon />}
                  label={`${row.label}: ${row.value}`}
                  variant="outlined"
                />
              ))}
            </Stack>

            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: 4,
                bgcolor: 'background.paper',
                borderColor: alpha(theme.palette.primary.main, 0.24),
              }}
            >
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography
                  variant="h3"
                  sx={{ color: themeColors.cardPrice }}
                  fontWeight={950}
                >
                  {iaAnalysis.score}
                </Typography>
                <Box>
                  <Typography
                    variant="subtitle2"
                    fontWeight={900}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                  >
                    <AIIcon fontSize="small" /> {iaAnalysis.summary}
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
            ) : null}

            <Stack direction="row" spacing={2}>
              <Button
                fullWidth
                variant="contained"
                onClick={handleAddToCart}
                disabled={!isAvailable}
                startIcon={<CartIcon />}
                sx={{
                  height: 58,
                  borderRadius: 3,
                  bgcolor: isAvailable
                    ? themeColors.actionPrimary
                    : 'action.disabledBackground',
                  color: isAvailable
                    ? themeColors.actionPrimaryText
                    : 'text.disabled',
                  fontWeight: 900,
                  '&:hover': {
                    bgcolor: isAvailable
                      ? themeColors.actionPrimary
                      : 'action.disabledBackground',
                  },
                }}
              >
                {!isAvailable
                  ? hasVariants && !normalizedSelectedVariant
                    ? 'Seleccioná opciones'
                    : 'Agotado'
                  : 'Añadir al carrito'}
              </Button>

              <IconButton
                onClick={() =>
                  user
                    ? dispatch(toggleWishlist(product._id))
                    : toast.error('Iniciá sesión')
                }
                sx={{
                  borderRadius: 3,
                  width: 58,
                  height: 58,
                  border: '1px solid',
                  borderColor: 'divider',
                  color: isFavorite ? 'error.main' : 'text.secondary',
                }}
              >
                {isFavorite ? <FavIcon /> : <FavBorderIcon />}
              </IconButton>
            </Stack>

            <Divider />

            <Box>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                mb={1}
              >
                <Typography variant="h6" fontWeight={900} color="text.primary">
                  Calificación general
                </Typography>
                <Button
                  size="small"
                  startIcon={<ReviewIcon />}
                  onClick={() => setShowRatingForm(!showRatingForm)}
                  sx={{ textTransform: 'none', fontWeight: 800 }}
                >
                  {showRatingForm ? 'Cerrar' : 'Opinar'}
                </Button>
              </Stack>

              <Stack direction="row" alignItems="center" spacing={2}>
                <Typography variant="h3" fontWeight={950} color="text.primary">
                  {iaAnalysis.avg > 0 ? iaAnalysis.avg.toFixed(1) : '0.0'}
                </Typography>
                <Box>
                  <ReactStars
                    count={5}
                    size={22}
                    value={Number(iaAnalysis.avg) || 0}
                    edit={false}
                    half
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
                      sx={{ color: theme.palette.primary.main }}
                    >
                      Opinando sobre:{' '}
                      {Object.values(normalizedSelectedVariant.attributes).join(
                        ' / ',
                      )}
                    </Typography>
                  )}
                  <ReactStars
                    count={5}
                    size={28}
                    value={userStar}
                    onChange={value =>
                      setUserStar(Math.trunc(Number(value)) || 0)
                    }
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
                    onClick={handleRateSubmit}
                  >
                    {isSubmittingRating ? 'Enviando...' : 'Enviar'}
                  </Button>
                </Paper>
              </Collapse>
            </Box>
          </Stack>
        </Grid>
      </Grid>

      <Box
        component="section"
        sx={{ mt: { xs: 5, md: 7 }, mx: 'auto', maxWidth: 1060, width: '100%' }}
      >
        <SectionTitle label="Descripción" eyebrow="Información del producto" />

        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2.25, md: 3.5 },
            borderRadius: 4,
            bgcolor: 'background.paper',
            borderColor: 'divider',
            boxShadow: '0 18px 45px rgba(15, 23, 42, 0.07)',
          }}
        >
          {shortDescription && (
            <Typography
              variant="subtitle1"
              sx={{
                color: themeColors.text,
                fontWeight: 900,
                lineHeight: 1.7,
                mb: 2,
              }}
            >
              {shortDescription}
            </Typography>
          )}

          {descriptionParagraphs.length > 0 ? (
            <Stack spacing={1.6}>
              {descriptionParagraphs.map((paragraph, index) => (
                <Typography
                  key={`product-description-${index}`}
                  variant="body1"
                  sx={{
                    color: themeColors.text,
                    fontSize: { xs: 15.5, md: 16.5 },
                    lineHeight: 1.95,
                    fontWeight: 400,
                    letterSpacing: 0.12,
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                    opacity: 0.93,
                  }}
                >
                  {paragraph}
                </Typography>
              ))}
            </Stack>
          ) : (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                fontStyle: 'italic',
                textAlign: 'center',
                py: 1,
              }}
            >
              Este producto todavía no tiene una descripción disponible.
            </Typography>
          )}
        </Paper>
      </Box>

      {(technicalParagraphs.length > 0 ||
        productSpecifications.length > 0 ||
        logisticsRows.length > 0) && (
        <Box
          component="section"
          sx={{
            mt: { xs: 4, md: 6 },
            mx: 'auto',
            maxWidth: 1120,
            width: '100%',
          }}
        >
          <SectionTitle
            label="Ficha técnica"
            eyebrow="Detalle y especificaciones"
          />

          <Grid container spacing={3}>
            {technicalParagraphs.length > 0 && (
              <Grid
                item
                xs={12}
                md={
                  productSpecifications.length || logisticsRows.length ? 5 : 12
                }
              >
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 2.25, md: 3 },
                    borderRadius: 4,
                    bgcolor: 'background.paper',
                    height: '100%',
                  }}
                >
                  <Typography
                    variant="h6"
                    fontWeight={950}
                    sx={{ mb: 1.5, color: themeColors.text }}
                  >
                    Descripción técnica
                  </Typography>
                  <Stack spacing={1.4}>
                    {technicalParagraphs.map((paragraph, index) => (
                      <Typography
                        key={`technical-description-${index}`}
                        variant="body2"
                        sx={{ color: themeColors.text, lineHeight: 1.9 }}
                      >
                        {paragraph}
                      </Typography>
                    ))}
                  </Stack>
                </Paper>
              </Grid>
            )}

            {productSpecifications.length > 0 && (
              <Grid
                item
                xs={12}
                md={technicalParagraphs.length || logisticsRows.length ? 7 : 12}
              >
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 2.25, md: 3 },
                    borderRadius: 4,
                    bgcolor: 'background.paper',
                    height: '100%',
                  }}
                >
                  <Stack spacing={2.5}>
                    {Object.entries(specificationGroups).map(
                      ([group, specs]) => (
                        <Box key={group}>
                          <Typography
                            variant="subtitle2"
                            fontWeight={950}
                            sx={{ mb: 1, color: themeColors.cardMutedText }}
                          >
                            {group}
                          </Typography>
                          <Grid container spacing={1.5}>
                            {specs.map(spec => (
                              <Grid
                                item
                                xs={12}
                                sm={6}
                                key={`${group}-${spec.key}`}
                              >
                                <SpecCard
                                  spec={spec}
                                  themeColors={themeColors}
                                />
                              </Grid>
                            ))}
                          </Grid>
                        </Box>
                      ),
                    )}
                  </Stack>
                </Paper>
              </Grid>
            )}

            {logisticsRows.length > 0 && (
              <Grid item xs={12}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: { xs: 2.25, md: 3 },
                    borderRadius: 4,
                    bgcolor: 'background.paper',
                  }}
                >
                  <Typography
                    variant="h6"
                    fontWeight={950}
                    sx={{ mb: 2, color: themeColors.text }}
                  >
                    Envío, garantía y origen
                  </Typography>
                  <Grid container spacing={1.5}>
                    {logisticsRows.map(row => (
                      <Grid item xs={12} sm={6} md={3} key={row.label}>
                        <Box
                          sx={{
                            p: 1.5,
                            borderRadius: 2,
                            bgcolor: alpha(theme.palette.success.main, 0.045),
                            border: '1px solid',
                            borderColor: 'divider',
                            height: '100%',
                          }}
                        >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            fontWeight={900}
                          >
                            {row.label}
                          </Typography>
                          <Typography
                            variant="body2"
                            fontWeight={900}
                            sx={{ color: themeColors.text, mt: 0.35 }}
                          >
                            {row.value}
                          </Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </Paper>
              </Grid>
            )}
          </Grid>
        </Box>
      )}

      <Box sx={{ mt: 8, maxWidth: 900, mx: 'auto' }}>
        <Typography
          fontWeight={950}
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

        <Paper
          sx={{ p: 3, borderRadius: 4, bgcolor: 'background.paper' }}
          variant="outlined"
        >
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
                    onChange={e =>
                      setGuestData({ ...guestData, name: e.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Email"
                    name="email"
                    size="small"
                    value={guestData.email}
                    onChange={e =>
                      setGuestData({ ...guestData, email: e.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Teléfono"
                    name="mobile"
                    size="small"
                    value={guestData.mobile}
                    onChange={e =>
                      setGuestData({ ...guestData, mobile: e.target.value })
                    }
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
                    fontWeight: 600,
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
                  fontWeight: 800,
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
