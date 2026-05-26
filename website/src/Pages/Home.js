import React, { Suspense, useEffect, useState, memo, useMemo, useCallback } from 'react'

import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { getAllProducts } from '@features/products/productSlice'

// Componentes
import HomeProductCard from '@components/HomeProductCard'
import SpecialProduct from '@components/SpecialProduct'
import Meta from '@components/Meta'

// Promotional Blocks
import { fetchPublicPromotionalBlocks } from '@features/promotionalBlocks/promotionalBlocksSlice'

import {
  selectPublicPromotionalBlocks,
  selectPublicPromotionalBlocksLoading,
} from '@features/promotionalBlocks/promotionalBlocksSelectors'

// Iconos y UI
import {
  BsSearch,
  BsArrowRight,
  BsShieldCheck,
  BsTruck,
  BsArrowRepeat,
  BsHeadset,
  BsImageAlt,
} from 'react-icons/bs'

import {
  Box,
  Grid,
  Typography,
  TextField,
  InputAdornment,
  Paper,
  Button,
  Container,
  Skeleton,
  Stack,
  useTheme,
  Chip,
} from '@mui/material'

import Marquee from 'react-fast-marquee'

// Assets
import brand1 from '@assets/images/brand-01.png'
import brand2 from '@assets/images/brand-02.png'
import brand3 from '@assets/images/brand-03.png'
import brand4 from '@assets/images/brand-04.png'

import { useTenant } from '../contexts/TenantContext'
import {
  formatCurrency,
  getAssetUrl,
  getLayoutThemeConfig,
  getProductImage,
  getProductRouteId,
  getProductThemeConfig,
  getSpacingThemeConfig,
  getThemeColors,
} from '@utils/themeRuntime'

// URLs de imágenes por defecto
const DEFAULT_IMAGES = {
  hero: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=1200&h=800&fit=crop',
  special: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&h=600&fit=crop',
  product: '/assets/images/placeholder.png',
  brand: '/assets/images/brand-placeholder.png',
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

const getFinalPrice = (price, discountPercentage) => {
  const numericPrice = Number(price || 0)
  const discount = Number(discountPercentage || 0)

  if (discount <= 0) return numericPrice

  return numericPrice - numericPrice * (discount / 100)
}

const SafeImage = memo(({ src, alt, fallbackSrc = DEFAULT_IMAGES.product, sx = {}, ...props }) => {
  const [imgSrc, setImgSrc] = useState(src || fallbackSrc)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setImgSrc(src || fallbackSrc)
    setHasError(false)
  }, [src, fallbackSrc])

  const handleError = () => {
    if (!hasError && imgSrc !== fallbackSrc) {
      console.warn(`Image failed to load: ${src}, using fallback`)
      setImgSrc(fallbackSrc)
      setHasError(true)
    }
  }

  if (hasError && !fallbackSrc) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.100',
          color: 'grey.400',
          ...sx,
        }}
      >
        <BsImageAlt size={32} />
      </Box>
    )
  }

  return (
    <Box
      component="img"
      src={imgSrc}
      alt={alt || 'Imagen'}
      onError={handleError}
      sx={{ objectFit: 'cover', ...sx }}
      {...props}
    />
  )
})

SafeImage.displayName = 'SafeImage'

const PromotionalSpecialProduct = ({ item, formatPrice }) => {
  const product = getProductFromPromotionalItem(item)

  if (!product) return null

  const discountPercentage = Number(item.discountPercentage || 0)
  const price = Number(product.price || 0)
  const finalPrice = getFinalPrice(price, discountPercentage)

  return (
    <Paper
      component={Link}
      to={`/product/${product.productId || product._id}`}
      sx={{
        display: 'flex',
        gap: 2,
        p: 2,
        borderRadius: 3,
        bgcolor: 'rgba(255,255,255,0.06)',
        color: '#fff',
        textDecoration: 'none',
        border: '1px solid rgba(255,255,255,0.08)',
        transition: 'all .2s ease',
        '&:hover': {
          bgcolor: 'rgba(255,255,255,0.1)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      <SafeImage
        src={getProductImage(product)}
        alt={product.title}
        fallbackSrc={DEFAULT_IMAGES.product}
        sx={{
          width: 92,
          height: 92,
          borderRadius: 2,
          flexShrink: 0,
        }}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} mb={1} flexWrap="wrap">
          {item.customLabel && (
            <Chip
              size="small"
              label={item.customLabel}
              sx={{
                bgcolor: 'primary.main',
                color: '#fff',
                fontWeight: 700,
              }}
            />
          )}

          {discountPercentage > 0 && (
            <Chip
              size="small"
              label={`${discountPercentage}% OFF`}
              sx={{
                bgcolor: 'error.main',
                color: '#fff',
                fontWeight: 700,
              }}
            />
          )}
        </Stack>

        <Typography fontWeight={800} noWrap>
          {item.customTitle || product.title}
        </Typography>

        <Typography variant="caption" color="grey.400" display="block" noWrap>
          {product.categoria || product.category || product.marca || ''}
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center" mt={1}>
          {discountPercentage > 0 && (
            <Typography
              variant="body2"
              sx={{
                color: 'grey.500',
                textDecoration: 'line-through',
              }}
            >
              {formatPrice(price)}
            </Typography>
          )}

          <Typography fontWeight={900} color="primary.light">
            {formatPrice(finalPrice)}
          </Typography>
        </Stack>
      </Box>
    </Paper>
  )
}

const Home = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const theme = useTheme()

  const tenantContext = useTenant()
  const themeState = useSelector(state => state.theme)

  const tenantConfig = tenantContext?.themeConfig
  const reduxConfig = themeState?.config
  const previewConfig = themeState?.previewConfig
  const previewMode = themeState?.previewMode

  const activeConfig = useMemo(() => {
    if (previewMode && previewConfig) return previewConfig
    if (reduxConfig) return reduxConfig
    if (tenantConfig) return tenantConfig
    return {}
  }, [reduxConfig, tenantConfig, previewConfig, previewMode])
  const themeColors = useMemo(() => getThemeColors(activeConfig), [activeConfig])
  const spacingConfig = useMemo(
    () => getSpacingThemeConfig(activeConfig),
    [activeConfig],
  )
  const layoutConfig = useMemo(
    () => getLayoutThemeConfig(activeConfig),
    [activeConfig],
  )
  const productConfig = useMemo(
    () => getProductThemeConfig(activeConfig),
    [activeConfig],
  )
  const formatPrice = useCallback(
    value => formatCurrency(value, activeConfig),
    [activeConfig],
  )

  const allProducts = useSelector(state => state.product?.products) || []
  const { isLoading } = useSelector(state => state.product)

  const promotionalBlocks = useSelector(selectPublicPromotionalBlocks)
  const promotionalBlocksLoading = useSelector(selectPublicPromotionalBlocksLoading)

  const SKELETON_ARRAY = Array.from({ length: 4 }, (_, i) => i)

  const [searchValue, setSearchValue] = useState('')
  const [searchResults, setSearchResults] = useState([])

  const { user } = useSelector(state => state.user)
  const tenantId = tenantContext?.tenantId || tenantConfig?.tenantId || user?.tenantId

  const heroConfig = useMemo(() => {
    const isValidUrl = url => {
      if (!url) return false
      return typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))
    }

    const hero = activeConfig?.hero || {}
    const general = activeConfig?.general || {}
    const colors = activeConfig?.colors || {}
    const heroImage = getAssetUrl(hero.backgroundImage)

    return {
      enabled: hero.enabled !== false,
      title: hero.title || general.storeName || 'Tu tienda online',
      subtitle: hero.subtitle || general.tagline || 'Nuevas oportunidades',
      primaryColor: colors.primary || themeColors.primary || theme.palette.primary.main,
      secondaryColor: colors.secondary || themeColors.secondary || theme.palette.secondary.main,
      accentColor: colors.accent || themeColors.accent || theme.palette.primary.main,
      textColor: hero.textColor || '#ffffff',
      overlayOpacity: hero.overlayOpacity ?? 0.3,
      alignment: hero.alignment || 'left',
      height: hero.height || 'medium',
      ctaText: hero.ctaText || 'Ver productos',
      ctaLink: hero.ctaLink || '/product',
      showCta: hero.showCta !== false,
      bannerImage: isValidUrl(heroImage)
        ? heroImage
        : DEFAULT_IMAGES.hero,
      specialBanner: isValidUrl(activeConfig?.specialBanner)
        ? activeConfig.specialBanner
        : DEFAULT_IMAGES.special,
      showSpecialSection: activeConfig?.showSpecialSection !== false,
    }
  }, [activeConfig, themeColors, theme.palette.primary.main, theme.palette.secondary.main])

  const weeklyOffersBlock = useMemo(() => {
    return promotionalBlocks
      .filter(block => block.type === 'weekly_offers')
      .sort((a, b) => Number(a.priority || 1) - Number(b.priority || 1))
  }, [promotionalBlocks])

  const featuredPromotionalBlocks = useMemo(() => {
    return promotionalBlocks
      .filter(block => block.type !== 'weekly_offers')
      .sort((a, b) => Number(a.priority || 1) - Number(b.priority || 1))
  }, [promotionalBlocks])

  const weeklyOfferItems = useMemo(() => {
    if (!weeklyOffersBlock?.products) return []

    return weeklyOffersBlock.products
      .filter(item => item?.isActive !== false && getProductFromPromotionalItem(item))
      .sort((a, b) => Number(a.priority || 1) - Number(b.priority || 1))
      .slice(0, weeklyOffersBlock.maxItems || 5)
  }, [weeklyOffersBlock])

  const getVisiblePromotionalItems = useCallback(block => {
    if (!Array.isArray(block?.products)) return []

    return block.products
      .filter(item => item?.isActive !== false && getProductFromPromotionalItem(item))
      .sort((a, b) => Number(a.priority || 1) - Number(b.priority || 1))
      .slice(0, block.maxItems || 5)
  }, [])

  useEffect(() => {
    if (tenantId) {
      dispatch(getAllProducts({ tenantId, limit: 100 }))
    }
  }, [tenantId, dispatch])

  useEffect(() => {
    dispatch(fetchPublicPromotionalBlocks({ placement: 'home' }))
  }, [dispatch])

  useEffect(() => {
    if (!searchValue.trim()) {
      setSearchResults([])
      return
    }

    const query = searchValue.toLowerCase()

    const results = allProducts.filter(product => {
      const title = product.title || ''
      const category = product.category || product.categoria || ''

      return title.toLowerCase().includes(query) || category.toLowerCase().includes(query)
    })

    setSearchResults(results.slice(0, 10))
  }, [searchValue, allProducts])

  const featuredProducts = allProducts?.slice(0, 4) || []

  const handleSearchSubmit = event => {
    event.preventDefault()

    if (searchValue.trim()) {
      navigate(`/product?q=${encodeURIComponent(searchValue.trim())}`)
    }
  }

  const services = [
    { title: 'Envío Veloz', desc: 'Gratis desde $50', icon: <BsTruck /> },
    { title: 'Pago Seguro', desc: '100% Protegido', icon: <BsShieldCheck /> },
    { title: 'Soporte Real', desc: 'Expertos 24/7', icon: <BsHeadset /> },
    {
      title: 'Devoluciones',
      desc: '30 días de garantía',
      icon: <BsArrowRepeat />,
    },
  ]

  return (
    <Box sx={{ bgcolor: '#F5F5F7' }}>
      <Meta title="Inicio | Tu Tienda" />

      {/* --- SECCIÓN 1: HERO & BÚSQUEDA --- */}
      {heroConfig.enabled && (
      <Box
        sx={{
          position: 'relative',
          bgcolor: '#fff',
          pt: { xs: 4, md: 8 },
          pb: { xs: 6, md: 10 },
          borderBottom: '1px solid #e0e0e0',
          minHeight: {
            small: 360,
            medium: 520,
            large: 680,
            fullscreen: 'calc(100vh - 70px)',
          }[heroConfig.height],
          py: `${spacingConfig.section}px`,
          backgroundImage: `linear-gradient(rgba(0,0,0,${heroConfig.overlayOpacity}), rgba(0,0,0,${heroConfig.overlayOpacity})), url(${heroConfig.bannerImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          color: heroConfig.textColor,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Container
          maxWidth={false}
          disableGutters
          sx={{
            maxWidth: layoutConfig.maxWidth,
            px: `${layoutConfig.containerPadding}px`,
          }}
        >
          <Grid container spacing={6} alignItems="center">
            <Grid item xs={12} md={6}>
              <Box sx={{ textAlign: { xs: 'center', md: heroConfig.alignment } }}>
                <Typography
                  variant="overline"
                  sx={{
                    color: heroConfig.accentColor,
                    fontWeight: 800,
                    letterSpacing: 3,
                    fontSize: 14,
                  }}
                >
                  {heroConfig.subtitle}
                </Typography>

                <Typography
                  sx={{
                    fontWeight: 900,
                    mt: 1,
                    mb: 5,
                    fontSize: { xs: '2.5rem', md: '3rem' },
                    color: heroConfig.textColor,
                    textShadow: '0 2px 12px rgba(0,0,0,0.35)',
                  }}
                >
                  {heroConfig.title}
                </Typography>

                <Box
                  sx={{
                    position: 'relative',
                    maxWidth: 500,
                    mx: { xs: 'auto', md: 0 },
                  }}
                >
                  <Box component="form" onSubmit={handleSearchSubmit}>
                    <TextField
                      fullWidth
                      placeholder="¿Qué estás buscando hoy?"
                      value={searchValue}
                      onChange={e => setSearchValue(e.target.value)}
                      sx={{
                        bgcolor: '#f1f1f1',
                        borderRadius: '50px',
                        '& .MuiOutlinedInput-root': {
                          borderRadius: '50px',
                          '& fieldset': { border: 'none' },
                        },
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start" sx={{ ml: 1 }}>
                            <BsSearch color={heroConfig.primaryColor} />
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Box>

                  {heroConfig.showCta && (
                    <Button
                      component={Link}
                      to={heroConfig.ctaLink}
                      variant="contained"
                      sx={{
                        mt: 2,
                        bgcolor: heroConfig.accentColor,
                        fontWeight: 800,
                        '&:hover': { bgcolor: heroConfig.primaryColor },
                      }}
                    >
                      {heroConfig.ctaText}
                    </Button>
                  )}

                  {searchResults.length > 0 && (
                    <Paper
                      sx={{
                        position: 'absolute',
                        top: '105%',
                        left: 0,
                        right: 0,
                        maxHeight: 400,
                        overflowY: 'auto',
                        zIndex: 100,
                        borderRadius: 3,
                        boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
                        p: 1,
                        mt: 1,
                      }}
                    >
                      {searchResults.map(product => (
                        <Box
                          key={product._id}
                          component={Link}
                          to={`/product/${getProductRouteId(product)}`}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            p: 1.5,
                            borderRadius: 2,
                            textDecoration: 'none',
                            color: 'inherit',
                            '&:hover': { bgcolor: '#f5f5f5' },
                          }}
                        >
                          <SafeImage
                            src={getProductImage(product)}
                            fallbackSrc={DEFAULT_IMAGES.product}
                            alt={product.title}
                            sx={{
                              width: 45,
                              height: 45,
                              borderRadius: 1,
                            }}
                          />

                          <Box sx={{ flex: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                              {product.title}
                            </Typography>

                            <Typography variant="caption" color="text.secondary">
                              {product.category || product.categoria}
                            </Typography>
                          </Box>

                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {formatPrice(product.price)}
                          </Typography>
                        </Box>
                      ))}
                    </Paper>
                  )}
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>
      )}

      {/* --- SECCIÓN 2: TRUST BADGES --- */}
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          mt: -5,
          position: 'relative',
          zIndex: 2,
          maxWidth: layoutConfig.maxWidth,
          px: `${layoutConfig.containerPadding}px`,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: `${spacingConfig.cardPadding}px`,
            borderRadius: `${spacingConfig.radius}px`,
            border: '1px solid #eee',
            boxShadow: '0 10px 40px rgba(0,0,0,0.04)',
          }}
        >
          <Grid container spacing={4}>
            {services.map((service, index) => (
              <Grid item xs={12} sm={6} md={3} key={index}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box
                    sx={{
                      fontSize: 32,
                      color: 'primary.main',
                      display: 'flex',
                      p: 1.5,
                      bgcolor: '#f0f7ff',
                      borderRadius: 3,
                    }}
                  >
                    {service.icon}
                  </Box>

                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                      {service.title}
                    </Typography>

                    <Typography variant="caption" color="text.secondary">
                      {service.desc}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Container>

      {/* --- SECCIÓN 3: DESTACADOS --- */}
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          my: `${spacingConfig.section}px`,
          maxWidth: layoutConfig.maxWidth,
          px: `${layoutConfig.containerPadding}px`,
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 5 }}>
          <Typography
            sx={{
              fontFamily: 'sans-serif',
              fontSize: { xs: '1.5rem', md: '2rem' },
              fontWeight: 900,
            }}
          >
            Destacados
          </Typography>

          <Button
            component={Link}
            to="/product"
            endIcon={<BsArrowRight />}
            sx={{ fontWeight: 700 }}
          >
            Ver todo
          </Button>
        </Stack>

        <Grid container spacing={Math.max(0, Math.round((productConfig.gap ?? 24) / 8))}>
          {isLoading
            ? [...Array(4)].map((_, index) => (
                <Grid item xs={12} sm={6} md={12 / Math.min(productConfig.columns ?? 4, 6)} key={index}>
                  <Skeleton variant="rectangular" height={320} sx={{ borderRadius: 5 }} />
                </Grid>
              ))
            : featuredProducts.map(product => (
                <Grid item xs={12} sm={6} md={12 / Math.min(productConfig.columns ?? 4, 6)} key={product._id}>
                  <HomeProductCard data={product} />
                </Grid>
              ))}
        </Grid>
      </Container>

      {/* --- SECCIÓN 4: OFERTAS DESDE PROMOTIONAL BLOCKS --- */}
      {heroConfig.showSpecialSection && (
        <>
          {promotionalBlocksLoading ? (
            <Box sx={{ bgcolor: '#131921', py: `${spacingConfig.section}px`, color: '#fff' }}>
              <Container
                maxWidth={false}
                disableGutters
                sx={{
                  maxWidth: layoutConfig.maxWidth,
                  px: `${layoutConfig.containerPadding}px`,
                }}
              >
                <Grid container spacing={8} alignItems="center">
                  <Grid item xs={12} md={5}>
                    <Skeleton width={180} height={24} sx={{ bgcolor: 'grey.800', mb: 2 }} />
                    <Skeleton width="80%" height={64} sx={{ bgcolor: 'grey.800', mb: 3 }} />

                    <Stack spacing={3}>
                      {SKELETON_ARRAY.slice(0, 3).map(index => (
                        <Skeleton
                          key={index}
                          variant="rectangular"
                          height={120}
                          sx={{ bgcolor: 'grey.800', borderRadius: 2 }}
                        />
                      ))}
                    </Stack>
                  </Grid>

                  <Grid item xs={12} md={7}>
                    <Skeleton
                      variant="rectangular"
                      height={420}
                      sx={{ bgcolor: 'grey.800', borderRadius: 4 }}
                    />
                  </Grid>
                </Grid>
              </Container>
            </Box>
          ) : weeklyOffersBlock.length > 0 ? (
            weeklyOffersBlock.map((block, blockIndex) => {
              const items = getVisiblePromotionalItems(block)

              if (items.length === 0) return null

              const isDark = blockIndex % 2 === 0

              return (
                <Box
                  key={block._id}
                  sx={{
                    bgcolor: isDark ? '#131921' : '#fff',
                    py: `${spacingConfig.section}px`,
                    color: isDark ? '#fff' : 'text.primary',
                  }}
                >
                  <Container
                    maxWidth={false}
                    disableGutters
                    sx={{
                      position: 'relative',
                      zIndex: 1,
                      maxWidth: layoutConfig.maxWidth,
                      px: `${layoutConfig.containerPadding}px`,
                    }}
                  >
                    <Grid
                      container
                      spacing={8}
                      alignItems="center"
                      direction={blockIndex % 2 === 0 ? 'row' : 'row-reverse'}
                    >
                      <Grid item xs={12} md={5}>
                        <Typography
                          variant="overline"
                          sx={{
                            color: isDark ? 'primary.light' : 'primary.main',
                            letterSpacing: 2,
                            fontWeight: 800,
                          }}
                        >
                          OFERTAS LIMITADAS
                        </Typography>

                        <Typography
                          variant="h2"
                          sx={{
                            fontWeight: 900,
                            mb: 3,
                            fontSize: { xs: '2rem', md: '3rem' },
                          }}
                        >
                          {block.title || 'Ofertas de la Semana'}
                        </Typography>

                        {block.description && (
                          <Typography
                            sx={{
                              mb: 3,
                              color: isDark ? 'grey.400' : 'text.secondary',
                            }}
                          >
                            {block.description}
                          </Typography>
                        )}

                        <Stack spacing={3}>
                          {items.map(item => {
                            const product = getProductFromPromotionalItem(item)

                            return (
                              <Suspense
                                key={`${block._id}-${product?._id || item.productId}`}
                                fallback={
                                  <Skeleton
                                    height={120}
                                    sx={{
                                      bgcolor: isDark ? 'grey.800' : 'grey.200',
                                    }}
                                  />
                                }
                              >
                                <PromotionalSpecialProduct
                                  item={item}
                                  formatPrice={formatPrice}
                                />
                              </Suspense>
                            )
                          })}
                        </Stack>
                      </Grid>

                      <Grid item xs={12} md={7}>
                        <SafeImage
                          src={heroConfig.specialBanner}
                          alt={block.title || 'Ofertas especiales'}
                          fallbackSrc={DEFAULT_IMAGES.special}
                          sx={{
                            width: '100%',
                            borderRadius: 4,
                            transform: {
                              md: blockIndex % 2 === 0 ? 'rotate(2deg)' : 'rotate(-2deg)',
                            },
                            boxShadow: isDark
                              ? '0 20px 60px rgba(0,0,0,0.3)'
                              : '0 20px 60px rgba(0,0,0,0.12)',
                            transition: 'transform 0.3s ease',
                            '&:hover': {
                              transform: { md: 'rotate(0deg) scale(1.02)' },
                            },
                          }}
                        />
                      </Grid>
                    </Grid>
                  </Container>
                </Box>
              )
            })
          ) : (
            <Box sx={{ bgcolor: '#131921', py: `${spacingConfig.section}px`, color: '#fff' }}>
              <Container
                maxWidth={false}
                disableGutters
                sx={{
                  maxWidth: layoutConfig.maxWidth,
                  px: `${layoutConfig.containerPadding}px`,
                }}
              >
                <Typography color="grey.400">No hay ofertas especiales activas</Typography>
              </Container>
            </Box>
          )}
        </>
      )}

      {/* --- SECCIÓN 4.5: OTROS BLOQUES PROMOCIONALES --- */}
      {featuredPromotionalBlocks.length > 0 && (
        <Container
          maxWidth={false}
          disableGutters
          sx={{
            my: `${spacingConfig.section}px`,
            maxWidth: layoutConfig.maxWidth,
            px: `${layoutConfig.containerPadding}px`,
          }}
        >
          {featuredPromotionalBlocks.map(block => {
            const items = Array.isArray(block.products)
              ? block.products
                  .filter(item => item?.isActive !== false && getProductFromPromotionalItem(item))
                  .sort((a, b) => Number(a.priority || 1) - Number(b.priority || 1))
                  .slice(0, block.maxItems || 4)
              : []

            if (items.length === 0) return null

            return (
              <Box key={block._id} sx={{ mb: 8 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 4 }}
                >
                  <Box>
                    <Typography
                      sx={{
                        fontSize: { xs: '1.5rem', md: '2rem' },
                        fontWeight: 900,
                      }}
                    >
                      {block.title}
                    </Typography>

                    {block.description && (
                      <Typography color="text.secondary">{block.description}</Typography>
                    )}
                  </Box>

                  <Button
                    component={Link}
                    to="/product"
                    endIcon={<BsArrowRight />}
                    sx={{ fontWeight: 700 }}
                  >
                    Ver todo
                  </Button>
                </Stack>

                <Grid container spacing={3}>
                  {items.map(item => {
                    const product = getProductFromPromotionalItem(item)

                    return (
                      <Grid item xs={12} sm={6} md={3} key={product._id}>
                        <HomeProductCard
                          data={{
                            ...product,
                            title: item.customTitle || product.title,
                          }}
                        />
                      </Grid>
                    )
                  })}
                </Grid>
              </Box>
            )
          })}
        </Container>
      )}
    </Box>
  )
}

export default Home
