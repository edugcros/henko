import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useSearchParams } from 'react-router-dom'
import Container from '@components/Container'
import ProductCard from '@components/ProductCard'
import {
  getAllProducts,
  getProductCategories,
} from '@features/products/productSlice'

import {
  Box,
  Typography,
  Grid,
  Button,
  Pagination,
  Select,
  MenuItem,
  Paper,
  Divider,
  Stack,
  Skeleton,
  Collapse,
  TextField,
  InputAdornment,
  Radio,
  RadioGroup,
  FormControlLabel,
  Chip,
} from '@mui/material'
import { ExpandMore, ExpandLess, Search } from '@mui/icons-material'
import { fetchPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSlice'
import { useUserMetrics } from '../Hooks/useUserMetrics'
import {
  getActiveThemeConfig,
  getSpacingThemeConfig,
  getThemeColors,
} from '@utils/themeRuntime'

import { selectPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSelectors'
import { Newprimary } from '../theme/colors'

const CATEGORY_PREVIEW_LIMIT = 6
const DEFAULT_LIMIT = 10
const DEFAULT_SORT = 'created-desc'
const VARIANT_FILTER_PREFIX = 'attr.'

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.trunc(parsed)
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

const PUBLIC_PROMOTION_VISIBILITIES = new Set([
  'public',
  'visible',
  'published',
])

const isPublicPromotionBlock = block => {
  if (!block || block.isActive === false) return false

  const visibility = String(block.visibility || 'public')
    .trim()
    .toLowerCase()

  return PUBLIC_PROMOTION_VISIBILITIES.has(visibility)
}

const findPromotionForProduct = (product, promotionalBlocks = []) => {
  if (!product?._id || !Array.isArray(promotionalBlocks)) return null

  const productId = getEntityId(product._id)

  for (const block of promotionalBlocks) {
    if (!isPublicPromotionBlock(block)) continue

    const items = Array.isArray(block.products) ? block.products : []

    const match = items.find(item => {
      if (item?.isActive === false) return false

      const promotedProduct = getProductFromPromotionalItem(item)
      const promotedProductId = promotedProduct?._id || item?.productId

      return getEntityId(promotedProductId) === productId
    })

    if (match) {
      const discountPercentage = Number(match.discountPercentage || 0)
      const originalPrice = Number(product.finalPrice ?? product.price ?? 0)
      const finalPrice = getDiscountedPrice(originalPrice, discountPercentage)

      return {
        ...match,
        blockId: block._id,
        blockTitle: block.title,
        blockType: block.type,
        discountPercentage,
        originalPrice,
        finalPrice,
        hasPromotion: discountPercentage > 0,
      }
    }
  }

  return null
}

const formatAttributeLabel = value => {
  const normalized = String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Característica'
}

const getMatchingVariantContext = (product, filters) => {
  const entries = Object.entries(filters || {}).filter(
    ([, values]) => Array.isArray(values) && values.length > 0,
  )

  if (entries.length === 0 || !Array.isArray(product?.variants)) return null

  const availableVariants = product.variants
    .filter(
      variant => variant?.isActive !== false && Number(variant?.stock || 0) > 0,
    )
    .map(variant => ({
      variant,
      attributes:
        variant?.attributes && typeof variant.attributes === 'object'
          ? variant.attributes
          : variant?.combinacion && typeof variant.combinacion === 'object'
            ? variant.combinacion
            : {},
    }))

  const exactMatches = availableVariants.filter(({ attributes }) =>
    entries.every(([attributeKey, acceptedValues]) =>
      acceptedValues.includes(String(attributes[attributeKey] ?? '')),
    ),
  )
  const exactVariant = exactMatches[0]?.variant || null
  const exactVariantWithImage = exactMatches.find(
    ({ variant }) => variant?.image?.url || variant?.image,
  )?.variant

  if (exactVariantWithImage) {
    return {
      variant: exactVariant,
      image: exactVariantWithImage.image,
    }
  }

  const closestVariantWithImage = availableVariants
    .map(candidate => ({
      ...candidate,
      matchScore: entries.reduce(
        (score, [attributeKey, acceptedValues]) =>
          score +
          (acceptedValues.includes(
            String(candidate.attributes[attributeKey] ?? ''),
          )
            ? 1
            : 0),
        0,
      ),
    }))
    .filter(
      ({ variant, matchScore }) =>
        matchScore > 0 && Boolean(variant?.image?.url || variant?.image),
    )
    .sort((left, right) => right.matchScore - left.matchScore)[0]?.variant

  return exactVariant
    ? {
        variant: exactVariant,
        image: closestVariantWithImage?.image || exactVariant.image || null,
      }
    : null
}

const removeVariantFilterParams = params => {
  const variantKeys = [...params.keys()]

  variantKeys
    .filter(key => key.startsWith(VARIANT_FILTER_PREFIX))
    .forEach(key => params.delete(key))
}

const OurStore = () => {
  const dispatch = useDispatch()
  const {
    products: rawProducts = [],
    categories: rawCategories = [],
    facets: rawFacets = [],
    isLoading = false,
    isCategoriesLoading = false,
    meta = {},
  } = useSelector(state => state.product || {})

  const products = useMemo(
    () => (Array.isArray(rawProducts) ? rawProducts : []),
    [rawProducts],
  )
  const categories = useMemo(
    () => (Array.isArray(rawCategories) ? rawCategories : []),
    [rawCategories],
  )
  const facets = useMemo(
    () => (Array.isArray(rawFacets) ? rawFacets : []),
    [rawFacets],
  )

  const rawPromotionalBlocks = useSelector(selectPublicPromotionalBlocks)
  const promotionalBlocks = useMemo(
    () => (Array.isArray(rawPromotionalBlocks) ? rawPromotionalBlocks : []),
    [rawPromotionalBlocks],
  )
  const themeState = useSelector(state => state.theme) || {}
  const activeThemeConfig = useMemo(
    () => getActiveThemeConfig(themeState),
    [themeState],
  )
  const themeColors = useMemo(
    () => getThemeColors(activeThemeConfig),
    [activeThemeConfig],
  )
  const spacingTheme = useMemo(
    () => getSpacingThemeConfig(activeThemeConfig),
    [activeThemeConfig],
  )

  const [searchParams, setSearchParams] = useSearchParams()
  const [expandedCategories, setExpandedCategories] = useState({})
  const [showAllCategories, setShowAllCategories] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '')

  const selectedCategory = searchParams.get('categoria') || null
  const selectedSubcategory = searchParams.get('subcategoria') || null
  const page = toPositiveInt(searchParams.get('page'), 1)
  const itemsPerPage = toPositiveInt(searchParams.get('limit'), DEFAULT_LIMIT)
  const sort = searchParams.get('sort') || DEFAULT_SORT
  const searchQuery = searchParams.get('q') || ''
  const selectedVariantFilters = useMemo(() => {
    const filters = {}

    for (const [paramKey] of searchParams.entries()) {
      if (!paramKey.startsWith(VARIANT_FILTER_PREFIX)) continue

      const attributeKey = paramKey.slice(VARIANT_FILTER_PREFIX.length)
      if (!attributeKey || filters[attributeKey]) continue

      const values = searchParams
        .getAll(paramKey)
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .slice(-1)

      if (values.length > 0) filters[attributeKey] = values
    }

    return filters
  }, [searchParams])
  const serializedVariantFilters = useMemo(
    () =>
      Object.keys(selectedVariantFilters).length > 0
        ? JSON.stringify(selectedVariantFilters)
        : undefined,
    [selectedVariantFilters],
  )
  const { track, events } = useUserMetrics({ trackPageViews: true })

  useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    dispatch(fetchPublicPromotionalBlocks({ placement: 'home' }))
  }, [dispatch])

  const updateFilters = useCallback(
    (newValues, { replace = false, clearVariantFilters = false } = {}) => {
      const params = new URLSearchParams(searchParams)

      if (clearVariantFilters) {
        removeVariantFilterParams(params)
      }

      Object.entries(newValues).forEach(([key, value]) => {
        if (
          value === null ||
          value === undefined ||
          value === '' ||
          (key === 'page' && Number(value) === 1) ||
          (key === 'limit' && Number(value) === DEFAULT_LIMIT) ||
          (key === 'sort' && value === DEFAULT_SORT)
        ) {
          params.delete(key)
        } else {
          params.set(key, String(value))
        }
      })

      setSearchParams(params, { replace })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    dispatch(getProductCategories())
  }, [dispatch])

  useEffect(() => {
    dispatch(
      getAllProducts({
        page,
        limit: itemsPerPage,
        sort,
        categoria: selectedCategory || undefined,
        subcategoria: selectedSubcategory || undefined,
        q: searchQuery || undefined,
        attributes: serializedVariantFilters,
        includeFacets: Boolean(selectedCategory && selectedSubcategory),
      }),
    )
  }, [
    dispatch,
    page,
    itemsPerPage,
    sort,
    selectedCategory,
    selectedSubcategory,
    searchQuery,
    serializedVariantFilters,
  ])

  const visibleCategories = useMemo(() => {
    return showAllCategories
      ? categories
      : categories.slice(0, CATEGORY_PREVIEW_LIMIT)
  }, [categories, showAllCategories])

  const totalPages = meta?.totalPages || 1
  useEffect(() => {
    if (selectedCategory) {
      setExpandedCategories(prev => ({
        ...prev,
        [selectedCategory]: true,
      }))
    }
  }, [selectedCategory])

  const toggleCategoryExpansion = useCallback(categoryName => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryName]: !prev[categoryName],
    }))
  }, [])

  const handleCategoryClick = useCallback(
    categoryName => {
      const nextCategory =
        selectedCategory === categoryName ? null : categoryName

      updateFilters(
        {
          categoria: nextCategory,
          subcategoria: null,
          page: 1,
        },
        { clearVariantFilters: true },
      )

      if (nextCategory) {
        setExpandedCategories(prev => ({
          ...prev,
          [categoryName]: true,
        }))
      }
    },
    [selectedCategory, updateFilters],
  )

  const handleSubcategoryClick = useCallback(
    (categoryName, subcategoryName) => {
      const shouldClear =
        selectedCategory === categoryName &&
        selectedSubcategory === subcategoryName

      updateFilters(
        {
          categoria: categoryName,
          subcategoria: shouldClear ? null : subcategoryName,
          page: 1,
        },
        { clearVariantFilters: true },
      )

      setExpandedCategories(prev => ({
        ...prev,
        [categoryName]: true,
      }))
    },
    [selectedCategory, selectedSubcategory, updateFilters],
  )

  const handleClearFilters = useCallback(() => {
    setSearchInput('')
    setSearchParams({})
  }, [setSearchParams])

  const handleVariantFilterChange = useCallback(
    (attributeKey, value) => {
      const paramKey = `${VARIANT_FILTER_PREFIX}${attributeKey}`
      const params = new URLSearchParams(searchParams)

      params.delete(paramKey)
      if (value) params.set(paramKey, value)
      params.delete('page')
      setSearchParams(params)
    },
    [searchParams, setSearchParams],
  )

  const handleRemoveVariantFilter = useCallback(
    (attributeKey, value) => {
      const selectedValue = selectedVariantFilters[attributeKey]?.[0]
      if (selectedValue === value) {
        handleVariantFilterChange(attributeKey, null)
      }
    },
    [handleVariantFilterChange, selectedVariantFilters],
  )

  const handleItemsPerPageChange = useCallback(
    event => {
      updateFilters({
        limit: Number(event.target.value),
        page: 1,
      })
    },
    [updateFilters],
  )

  const handleSortChange = useCallback(
    event => {
      updateFilters({
        sort: event.target.value,
        page: 1,
      })
    },
    [updateFilters],
  )

  const handlePageChange = useCallback(
    (_, value) => {
      updateFilters({ page: value })
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    },
    [updateFilters],
  )

  const handleSearchSubmit = useCallback(
    event => {
      event.preventDefault()
      const query = searchInput.trim()

      if (query) {
        track(events.SEARCH, {
          searchQuery: query,
          category: selectedCategory || '',
          metadata: {
            source: 'our-store',
            selectedSubcategory: selectedSubcategory || '',
          },
        })
      }

      updateFilters({
        q: query || null,
        page: 1,
      })
    },
    [
      events.SEARCH,
      searchInput,
      selectedCategory,
      selectedSubcategory,
      track,
      updateFilters,
    ],
  )

  const handleSearchClear = useCallback(() => {
    setSearchInput('')
    updateFilters({
      q: null,
      page: 1,
    })
  }, [updateFilters])

  const activeFilterLabel = useMemo(() => {
    const parts = []

    if (selectedCategory) parts.push(`Categoría: ${selectedCategory}`)
    if (selectedSubcategory) parts.push(`Subcategoría: ${selectedSubcategory}`)
    if (searchQuery) parts.push(`Búsqueda: "${searchQuery}"`)
    const selectedVariantCount = Object.values(selectedVariantFilters).reduce(
      (total, values) => total + values.length,
      0,
    )
    if (selectedVariantCount > 0) {
      parts.push(`${selectedVariantCount} filtros de variantes`)
    }

    return parts.join(' · ')
  }, [
    selectedCategory,
    selectedSubcategory,
    searchQuery,
    selectedVariantFilters,
  ])

  const selectedCategoryData = useMemo(
    () =>
      categories.find(category => category.name === selectedCategory) || null,
    [categories, selectedCategory],
  )

  const selectedSubcategoryData = useMemo(
    () =>
      selectedCategoryData?.subcategories?.find(
        subcategory => subcategory.name === selectedSubcategory,
      ) || null,
    [selectedCategoryData, selectedSubcategory],
  )

  const variantAttributeLabels = useMemo(() => {
    const labelMap = new Map()

    for (const attribute of selectedSubcategoryData?.variantAttributes || []) {
      if (attribute?.name) {
        labelMap.set(
          attribute.name,
          attribute.label || formatAttributeLabel(attribute.name),
        )
      }
    }

    return labelMap
  }, [selectedSubcategoryData])

  const visibleFacets = useMemo(() => {
    if (!selectedCategory || !selectedSubcategory) return []

    return facets
      .filter(facet => Array.isArray(facet.options) && facet.options.length > 0)
      .map(facet => ({
        ...facet,
        label:
          variantAttributeLabels.get(facet.key) ||
          formatAttributeLabel(facet.key),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'es'))
  }, [facets, selectedCategory, selectedSubcategory, variantAttributeLabels])

  const selectedVariantChips = useMemo(
    () =>
      Object.entries(selectedVariantFilters).flatMap(([attributeKey, values]) =>
        values.map(value => ({
          attributeKey,
          label:
            variantAttributeLabels.get(attributeKey) ||
            formatAttributeLabel(attributeKey),
          value,
        })),
      ),
    [selectedVariantFilters, variantAttributeLabels],
  )

  const productsWithPromotions = useMemo(() => {
    return products.map(product => {
      const promotion = findPromotionForProduct(product, promotionalBlocks)
      const matchingVariantContext = getMatchingVariantContext(
        product,
        selectedVariantFilters,
      )
      const productWithFilterContext = matchingVariantContext
        ? {
            ...product,
            filterMatchedVariant: matchingVariantContext.variant,
            displayImage: matchingVariantContext.image,
          }
        : product

      if (!promotion?.hasPromotion) return productWithFilterContext

      return {
        ...productWithFilterContext,
        hasPromotion: true,
        promotionId: promotion.blockId,
        promotionTitle: promotion.blockTitle,
        promotionType: promotion.blockType,
        discountPercentage: promotion.discountPercentage,
        originalPrice: promotion.originalPrice,
        finalPrice: promotion.finalPrice,
      }
    })
  }, [products, promotionalBlocks, selectedVariantFilters])

  return (
    <Box sx={{ bgcolor: themeColors.background, minHeight: '100vh' }}>
      <Container class1="py-5">
        <Box
          display="flex"
          gap={4}
          alignItems="flex-start"
          flexDirection={{ xs: 'column', md: 'row' }}
        >
          {/* Sidebar */}
          <Box
            flex={{ xs: '1 1 100%', md: '0 0 25%' }}
            minWidth={{ xs: '100%', md: 240 }}
          >
            <Paper
              elevation={3}
              sx={{
                p: `${spacingTheme.cardPadding}px`,
                mr: { xs: 0, md: 5 },
                borderRadius: 4,
                border: '1px solid',
                borderColor: themeColors.cardBorder,
                overflow: 'hidden',
                position: { xs: 'static', md: 'sticky' },
                top: 20,
                background: themeColors.cardBackground,
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  mb: 2,
                  fontWeight: 700,
                  color: themeColors.text,
                  textAlign: 'center',
                }}
              >
                Categorías y subcategorías
              </Typography>

              <Divider sx={{ mb: 2 }} />

              {isCategoriesLoading ? (
                <Stack spacing={1}>
                  {[...Array(6)].map((_, i) => (
                    <Skeleton
                      key={i}
                      variant="rectangular"
                      height={38}
                      sx={{ borderRadius: 2 }}
                    />
                  ))}
                </Stack>
              ) : (
                <Stack spacing={0.5}>
                  {visibleCategories.map(category => {
                    const isSelectedCategory =
                      selectedCategory === category.name
                    const isExpanded =
                      expandedCategories[category.name] || isSelectedCategory

                    return (
                      <Box key={category.name}>
                        <Box display="flex" gap={1}>
                          <Button
                            fullWidth
                            variant={isSelectedCategory ? 'contained' : 'text'}
                            onClick={() => handleCategoryClick(category.name)}
                            sx={{
                              justifyContent: 'space-between',
                              textTransform: 'none',
                              borderRadius: 2,
                              py: 1,
                              px: `${spacingTheme.cardPadding}px`,
                              color: isSelectedCategory
                                ? themeColors.actionPrimaryText
                                : themeColors.text,
                            }}
                          >
                            <Typography
                              sx={{
                                color: isSelectedCategory
                                  ? themeColors.actionPrimaryText
                                  : themeColors.text,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                fontSize: 12,
                                textAlign: 'left',
                              }}
                            >
                              {category.name}
                            </Typography>

                            <Typography
                              variant="caption"
                              sx={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: isSelectedCategory
                                  ? themeColors.actionPrimaryText
                                  : themeColors.cardMutedText,
                                ml: 1,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              ({category.count})
                            </Typography>
                          </Button>

                          <Button
                            onClick={() =>
                              toggleCategoryExpansion(category.name)
                            }
                            sx={{
                              minWidth: 42,
                              px: 0,
                              borderRadius: 2,
                              color: themeColors.cardMutedText,
                              bgcolor: Newprimary.gainsGray,
                              '&:hover': {
                                bgcolor: themeColors.cardBackground,
                              },
                            }}
                          >
                            {isExpanded ? <ExpandLess /> : <ExpandMore />}
                          </Button>
                        </Box>

                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Stack spacing={0.5} sx={{ mt: 0.75, ml: 1.5 }}>
                            {category.subcategories?.map(subcategory => {
                              const isSelectedSubcategory =
                                isSelectedCategory &&
                                selectedSubcategory === subcategory.name

                              return (
                                <Button
                                  key={`${category.name}-${subcategory.name}`}
                                  fullWidth
                                  variant={
                                    isSelectedSubcategory ? 'contained' : 'text'
                                  }
                                  onClick={() =>
                                    handleSubcategoryClick(
                                      category.name,
                                      subcategory.name,
                                    )
                                  }
                                  sx={{
                                    justifyContent: 'space-between',
                                    textTransform: 'none',
                                    borderRadius: 2,
                                    py: 0.85,
                                    px: `${spacingTheme.cardPadding}px`,
                                    fontSize: 13,
                                    color: isSelectedSubcategory
                                      ? themeColors.actionPrimaryText
                                      : themeColors.cardMutedText,
                                    bgcolor: isSelectedSubcategory
                                      ? themeColors.actionPrimary
                                      : 'transparent',
                                    '&:hover': {
                                      bgcolor: isSelectedSubcategory
                                        ? Newprimary.gainsGray
                                        : themeColors.background,
                                      color: isSelectedSubcategory
                                        ? themeColors.actionPrimaryText
                                        : themeColors.link,
                                    },
                                  }}
                                >
                                  <Typography
                                    sx={{
                                      fontWeight: 500,
                                      fontSize: 12,
                                      textAlign: 'left',
                                    }}
                                  >
                                    {subcategory.name}
                                  </Typography>

                                  <Typography
                                    variant="caption"
                                    sx={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      ml: 1,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    ({subcategory.count})
                                  </Typography>
                                </Button>
                              )
                            })}
                          </Stack>
                        </Collapse>
                      </Box>
                    )
                  })}
                </Stack>
              )}

              {categories.length > CATEGORY_PREVIEW_LIMIT && (
                <Button
                  size="small"
                  fullWidth
                  onClick={() => setShowAllCategories(prev => !prev)}
                  sx={{
                    mt: 1.5,
                    color: themeColors.textOnActionPrimary,
                    textTransform: 'none',
                    fontWeight: 700,
                    fontSize: 16,
                    borderRadius: 2,
                  }}
                  endIcon={showAllCategories ? <ExpandLess /> : <ExpandMore />}
                >
                  {showAllCategories ? 'Ver menos' : 'Ver más'}
                </Button>
              )}

              {visibleFacets.length > 0 && (
                <>
                  <Divider sx={{ my: 2.5 }} />
                  <Typography
                    variant="subtitle2"
                    sx={{ mb: 1.5, fontWeight: 800, color: themeColors.text }}
                  >
                    Filtrar por características
                  </Typography>

                  <Stack spacing={2}>
                    {visibleFacets.map(facet => (
                      <Box key={facet.key}>
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            mb: 0.5,
                            color: themeColors.text,
                            fontWeight: 800,
                          }}
                        >
                          {facet.label}
                        </Typography>

                        <RadioGroup
                          value={selectedVariantFilters[facet.key]?.[0] || ''}
                          onChange={event =>
                            handleVariantFilterChange(
                              facet.key,
                              event.target.value,
                            )
                          }
                        >
                          {facet.options.map(option => {
                            return (
                              <FormControlLabel
                                key={`${facet.key}-${option.value}`}
                                value={option.value}
                                control={<Radio size="small" />}
                                label={
                                  <Box
                                    component="span"
                                    sx={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      gap: 1,
                                      width: '100%',
                                      fontSize: 13,
                                    }}
                                  >
                                    <span>{option.value}</span>
                                    <Typography
                                      component="span"
                                      variant="caption"
                                      sx={{ color: themeColors.cardMutedText }}
                                    >
                                      {option.count}
                                    </Typography>
                                  </Box>
                                }
                                sx={{
                                  m: 0,
                                  width: '100%',
                                  '& .MuiFormControlLabel-label': {
                                    flex: 1,
                                  },
                                }}
                              />
                            )
                          })}
                        </RadioGroup>
                      </Box>
                    ))}
                  </Stack>
                </>
              )}

              {(selectedCategory ||
                selectedSubcategory ||
                searchQuery ||
                selectedVariantChips.length > 0) && (
                <Button
                  fullWidth
                  size="small"
                  color="error"
                  variant="outlined"
                  onClick={handleClearFilters}
                  sx={{ mt: 3, borderRadius: 2 }}
                >
                  Limpiar filtros
                </Button>
              )}
            </Paper>
          </Box>

          {/* Contenido */}
          <Box flex="1" width="100%" sx={{ ml: { xs: 0, md: 4 } }}>
            <Paper
              component="form"
              onSubmit={handleSearchSubmit}
              sx={{
                p: `${spacingTheme.cardPadding}px`,
                mb: 3,
                borderRadius: 4,
                border: '1px solid',
                borderColor: themeColors.cardBorder,
                color: themeColors.cardMutedText,
                bgcolor: themeColors.cardBackground,
                display: 'flex',
                gap: 2,
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'stretch', md: 'center' },
              }}
            >
              <TextField
                fullWidth
                size="small"
                placeholder="Buscar productos..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    bgcolor: themeColors.background,
                    color: themeColors.text,
                    '& fieldset': {
                      borderColor: themeColors.border,
                    },
                    '&:hover fieldset': {
                      borderColor: themeColors.link,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: themeColors.link,
                      boxShadow: `0 0 0 2px ${themeColors.link}33`,
                    },
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />

              <Stack direction="row" spacing={1.5}>
                <Button
                  type="submit"
                  variant="contained"
                  sx={{
                    textTransform: 'none',
                    borderRadius: 2,
                    minWidth: 120,
                    bgcolor: themeColors.actionPrimary,
                    color: themeColors.actionPrimaryText,
                    '&:hover': {
                      bgcolor: themeColors.actionSecondary,
                      color: themeColors.actionSecondaryText,
                    },
                  }}
                >
                  Buscar
                </Button>

                <Button
                  type="button"
                  variant="outlined"
                  onClick={handleSearchClear}
                  sx={{
                    textTransform: 'none',
                    borderRadius: 2,
                    minWidth: 120,
                    borderColor: themeColors.border,
                    bgcolor: themeColors.actionPrimary,
                    color: themeColors.actionPrimaryText,
                    '&:hover': {
                      bgcolor: themeColors.actionSecondary,
                      color: themeColors.actionSecondaryText,
                    },
                  }}
                >
                  Limpiar
                </Button>
              </Stack>
            </Paper>

            <Box
              mb={4}
              display="flex"
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              flexDirection={{ xs: 'column', sm: 'row' }}
              gap={2}
              sx={{
                p: `${spacingTheme.cardPadding}px`,
                bgcolor: themeColors.cardBackground,
                borderRadius: 3,
                border: `1px solid ${themeColors.cardBorder}`,
              }}
            >
              <Box>
                {/*{<Typography variant="body2" color="text.secondary">
                  Mostrando <b>{totalProducts}</b> productos
                </Typography>}*/}

                {activeFilterLabel && (
                  <Typography
                    variant="caption"
                    sx={{ color: themeColors.cardMutedText }}
                  >
                    {activeFilterLabel}
                  </Typography>
                )}

                {selectedVariantChips.length > 0 && (
                  <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
                    {selectedVariantChips.map(chip => (
                      <Chip
                        key={`${chip.attributeKey}-${chip.value}`}
                        size="small"
                        label={`${chip.label}: ${chip.value}`}
                        onDelete={() =>
                          handleRemoveVariantFilter(
                            chip.attributeKey,
                            chip.value,
                          )
                        }
                        sx={{
                          bgcolor: themeColors.background,
                          color: themeColors.text,
                          border: `1px solid ${themeColors.border}`,
                        }}
                      />
                    ))}
                  </Stack>
                )}
              </Box>

              <Stack
                direction="row"
                alignItems="center"
                spacing={2}
                flexWrap="wrap"
              >
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  ORDENAR:
                </Typography>

                <Select
                  size="small"
                  value={sort}
                  onChange={handleSortChange}
                  sx={{ height: 35, borderRadius: 2, minWidth: 170 }}
                >
                  <MenuItem value="created-desc">Más recientes</MenuItem>
                  <MenuItem value="created-asc">Más antiguos</MenuItem>
                  <MenuItem value="price-asc">Precio: menor a mayor</MenuItem>
                  <MenuItem value="price-desc">Precio: mayor a menor</MenuItem>
                  <MenuItem value="title-asc">Nombre: A-Z</MenuItem>
                  <MenuItem value="title-desc">Nombre: Z-A</MenuItem>
                </Select>

                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  VER:
                </Typography>

                <Select
                  size="small"
                  value={itemsPerPage}
                  onChange={handleItemsPerPageChange}
                  sx={{ height: 35, borderRadius: 2, minWidth: 80 }}
                >
                  {[10, 24].map(opt => (
                    <MenuItem key={opt} value={opt}>
                      {opt}
                    </MenuItem>
                  ))}
                </Select>
              </Stack>
            </Box>

            {isLoading ? (
              <Grid container spacing={3}>
                {[...Array(6)].map((_, i) => (
                  <Grid item xs={12} sm={6} lg={4} key={i}>
                    <Skeleton
                      variant="rectangular"
                      height={280}
                      sx={{ borderRadius: 4 }}
                    />
                    <Skeleton width="80%" sx={{ mt: 1 }} />
                    <Skeleton width="40%" />
                  </Grid>
                ))}
              </Grid>
            ) : products.length === 0 ? (
              <Box textAlign="center" py={10}>
                <Typography variant="h6" color="text.secondary">
                  No se encontraron productos.
                </Typography>
              </Box>
            ) : (
              <>
                <Grid container spacing={3}>
                  {productsWithPromotions.map(product => (
                    <Grid item xs={12} sm={6} lg={4} key={product._id}>
                      <ProductCard item={product} />
                    </Grid>
                  ))}
                </Grid>

                {totalPages > 1 && (
                  <Box mt={6} display="flex" justifyContent="center">
                    <Pagination
                      count={totalPages}
                      page={page}
                      onChange={handlePageChange}
                      sx={{
                        '& .MuiPaginationItem-root': {
                          fontWeight: 700,
                          borderRadius: 2,
                          color: themeColors.text,
                        },
                        '& .MuiPaginationItem-root.Mui-selected': {
                          bgcolor: themeColors.actionPrimary,
                          color: themeColors.actionPrimaryText,
                        },
                        '& .MuiPaginationItem-root.Mui-selected:hover': {
                          bgcolor: themeColors.actionPrimary,
                        },
                      }}
                    />
                  </Box>
                )}
              </>
            )}
          </Box>
        </Box>
      </Container>
    </Box>
  )
}

export default OurStore
