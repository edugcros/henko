import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useSearchParams } from 'react-router-dom'
import Container from '@components/Container'
import ProductCard from '@components/ProductCard'
import { getAllProducts, getProductCategories } from '@features/products/productSlice'

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
} from '@mui/material'
import { ExpandMore, ExpandLess, Search } from '@mui/icons-material'
import { fetchPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSlice'
import {
  getActiveThemeConfig,
  getSpacingThemeConfig,
  getThemeColors,
} from '@utils/themeRuntime'

import { selectPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSelectors'

const CATEGORY_PREVIEW_LIMIT = 6
const DEFAULT_LIMIT = 10
const DEFAULT_SORT = 'created-desc'

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

const findPromotionForProduct = (product, promotionalBlocks = []) => {
  if (!product?._id || !Array.isArray(promotionalBlocks)) return null

  const productId = getEntityId(product._id)

  for (const block of promotionalBlocks) {
    if (!block?.isActive) continue
    if (block?.visibility && block.visibility !== 'public') continue

    const items = Array.isArray(block.products) ? block.products : []

    const match = items.find(item => {
      if (item?.isActive === false) return false

      const promotedProduct = getProductFromPromotionalItem(item)
      const promotedProductId = promotedProduct?._id || item?.productId

      return getEntityId(promotedProductId) === productId
    })

    if (match) {
      const discountPercentage = Number(match.discountPercentage || 0)
      const originalPrice = Number(product.price || 0)
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

const OurStore = () => {
  const dispatch = useDispatch()
  const {
    products = [],
    categories = [],
    isLoading,
    isCategoriesLoading,
    meta,
  } = useSelector(state => state.product)

  const promotionalBlocks = useSelector(selectPublicPromotionalBlocks)
  const themeState = useSelector(state => state.theme) || {}
  const activeThemeConfig = useMemo(() => getActiveThemeConfig(themeState), [themeState])
  const themeColors = useMemo(() => getThemeColors(activeThemeConfig), [activeThemeConfig])
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

  useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    dispatch(fetchPublicPromotionalBlocks({ placement: 'home' }))
  }, [dispatch])

  const updateFilters = useCallback(
    (newValues, { replace = false } = {}) => {
      const params = new URLSearchParams(searchParams)

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
      }),
    )
  }, [dispatch, page, itemsPerPage, sort, selectedCategory, selectedSubcategory, searchQuery])

  const visibleCategories = useMemo(() => {
    return showAllCategories ? categories : categories.slice(0, CATEGORY_PREVIEW_LIMIT)
  }, [categories, showAllCategories])

  const totalPages = meta?.totalPages || 1
  const totalProducts = meta?.total || 0

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
      const nextCategory = selectedCategory === categoryName ? null : categoryName

      updateFilters({
        categoria: nextCategory,
        subcategoria: null,
        page: 1,
      })

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
        selectedCategory === categoryName && selectedSubcategory === subcategoryName

      updateFilters({
        categoria: categoryName,
        subcategoria: shouldClear ? null : subcategoryName,
        page: 1,
      })

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
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [updateFilters],
  )

  const handleSearchSubmit = useCallback(
    event => {
      event.preventDefault()
      updateFilters({
        q: searchInput.trim() || null,
        page: 1,
      })
    },
    [searchInput, updateFilters],
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

    return parts.join(' · ')
  }, [selectedCategory, selectedSubcategory, searchQuery])

  const productsWithPromotions = useMemo(() => {
    return products.map(product => {
      const promotion = findPromotionForProduct(product, promotionalBlocks)

      if (!promotion?.hasPromotion) return product

      return {
        ...product,
        hasPromotion: true,
        promotionId: promotion.blockId,
        promotionTitle: promotion.blockTitle,
        promotionType: promotion.blockType,
        discountPercentage: promotion.discountPercentage,
        originalPrice: promotion.originalPrice,
        finalPrice: promotion.finalPrice,
      }
    })
  }, [products, promotionalBlocks])

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
          <Box flex={{ xs: '1 1 100%', md: '0 0 25%' }} minWidth={{ xs: '100%', md: 240 }}>
            <Paper
              elevation={2}
              sx={{
                p: `${spacingTheme.cardPadding}px`,
                borderRadius: 4,
                border: '1px solid',
                borderColor: themeColors.border,
                overflow: 'hidden',
                position: { xs: 'static', md: 'sticky' },
                top: 20,
                background: themeColors.surface,
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  mb: 2,
                  fontWeight: 700,
                  color: themeColors.text,
                }}
              >
                Categorías
              </Typography>

              <Divider sx={{ mb: 2 }} />

              {isCategoriesLoading ? (
                <Stack spacing={1}>
                  {[...Array(6)].map((_, i) => (
                    <Skeleton key={i} variant="rectangular" height={38} sx={{ borderRadius: 2 }} />
                  ))}
                </Stack>
              ) : (
                <Stack spacing={0.5}>
                  {visibleCategories.map(category => {
                    const isSelectedCategory = selectedCategory === category.name
                    const isExpanded = expandedCategories[category.name] || isSelectedCategory

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
                              color: isSelectedCategory ? 'primary.contrastText' : themeColors.text,
                              bgcolor: isSelectedCategory ? themeColors.primary : 'transparent',
                              '&:hover': {
                                bgcolor: isSelectedCategory ? themeColors.primary : themeColors.background,
                                color: isSelectedCategory ? 'primary.contrastText' : themeColors.primary,
                              },
                            }}
                          >
                            <Typography
                              sx={{
                                color: isSelectedCategory ? 'primary.contrastText' : themeColors.text,
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
                                color: isSelectedCategory ? 'primary.contrastText' : themeColors.textSecondary,
                                ml: 1,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              ({category.count})
                            </Typography>
                          </Button>

                          <Button
                            onClick={() => toggleCategoryExpansion(category.name)}
                            sx={{
                              minWidth: 42,
                              px: 0,
                              borderRadius: 2,
                              color: themeColors.textSecondary,
                              bgcolor: themeColors.background,
                              '&:hover': { bgcolor: themeColors.surface },
                            }}
                          >
                            {isExpanded ? <ExpandLess /> : <ExpandMore />}
                          </Button>
                        </Box>

                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Stack spacing={0.5} sx={{ mt: 0.75, ml: 1.5 }}>
                            {category.subcategories?.map(subcategory => {
                              const isSelectedSubcategory =
                                isSelectedCategory && selectedSubcategory === subcategory.name

                              return (
                                <Button
                                  key={`${category.name}-${subcategory.name}`}
                                  fullWidth
                                  variant={isSelectedSubcategory ? 'contained' : 'text'}
                                  onClick={() =>
                                    handleSubcategoryClick(category.name, subcategory.name)
                                  }
                                  sx={{
                                    justifyContent: 'space-between',
                                    textTransform: 'none',
                                    borderRadius: 2,
                                    py: 0.85,
                                    px: `${spacingTheme.cardPadding}px`,
                                    fontSize: 13,
                                    color: isSelectedSubcategory
                                      ? 'primary.contrastText'
                                      : themeColors.textSecondary,
                                    bgcolor: isSelectedSubcategory
                                      ? themeColors.primary
                                      : 'transparent',
                                    '&:hover': {
                                      bgcolor: isSelectedSubcategory
                                        ? themeColors.primary
                                        : themeColors.background,
                                      color: isSelectedSubcategory
                                        ? 'primary.contrastText'
                                        : themeColors.primary,
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
                    color: themeColors.primary,
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

              {(selectedCategory || selectedSubcategory || searchQuery) && (
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
          <Box flex="1" width="100%">
            <Paper
              component="form"
              onSubmit={handleSearchSubmit}
              sx={{
                p: `${spacingTheme.cardPadding}px`,
                mb: 3,
                borderRadius: 3,
                border: `1px solid ${themeColors.border}`,
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
                    bgcolor: themeColors.primary,
                    '&:hover': { bgcolor: themeColors.accent },
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
                bgcolor: themeColors.surface,
                borderRadius: 3,
                border: `1px solid ${themeColors.border}`,
              }}
            >
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Mostrando <b>{totalProducts}</b> productos
                </Typography>

                {activeFilterLabel && (
                  <Typography variant="caption" sx={{ color: themeColors.textSecondary }}>
                    {activeFilterLabel}
                  </Typography>
                )}
              </Box>

              <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap">
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
                    <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 4 }} />
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
                      color="primary"
                      sx={{
                        '& .MuiPaginationItem-root': {
                          fontWeight: 700,
                          borderRadius: 2,
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
