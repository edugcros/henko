// 📁 src/pages/Home.jsx
import React, {
  Suspense,
  useEffect,
  useState,
  memo,
  useMemo,
  useCallback,
} from 'react'

import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { getAllProducts } from '@features/products/productSlice'
import { useUserMetrics } from '../Hooks/useUserMetrics'

// Componentes
import HomeProductCard from '@components/HomeProductCard'
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
  alpha,
} from '@mui/material'

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

const DEFAULT_IMAGES = {
  hero: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=1200&h=800&fit=crop',
  special:
    'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&h=600&fit=crop',
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

const SafeImage = memo(
  ({ src, alt, fallbackSrc = DEFAULT_IMAGES.product, sx = {}, ...props }) => {
    const [imgSrc, setImgSrc] = useState(src || fallbackSrc)
    const [hasError, setHasError] = useState(false)

    useEffect(() => {
      setImgSrc(src || fallbackSrc)
      setHasError(false)
    }, [src, fallbackSrc])

    const handleError = () => {
      if (!hasError && imgSrc !== fallbackSrc) {
        if (process.env.REACT_APP_DEBUG_API === 'true') {
          console.warn(`Image failed to load: ${src}, using fallback`)
        }
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
        loading={props.loading || 'lazy'}
        onError={handleError}
        sx={{ objectFit: 'cover', ...sx }}
        {...props}
      />
    )
  },
)

SafeImage.displayName = 'SafeImage'

const PromotionalSpecialProduct = ({
  item,
  formatPrice,
  themeColors,
  isDark = false,
  onProductClick,
}) => {
  const theme = useTheme()
  const product = getProductFromPromotionalItem(item)

  if (!product) return null

  const productRouteId = getProductRouteId(product)

  if (!productRouteId) return null

  const discountPercentage = Number(item.discountPercentage || 0)
  const price = Number(product.price || 0)
  const finalPrice = getFinalPrice(price, discountPercentage)

  const cardBackground = isDark
    ? alpha(theme.palette.common.white, 0.08)
    : alpha(themeColors.cardBackground, 0.9)

  const cardBorder = isDark
    ? alpha(theme.palette.common.white, 0.12)
    : alpha(themeColors.cardBorder, 0.58)

  const cardHoverBackground = isDark
    ? alpha(theme.palette.common.white, 0.12)
    : alpha(themeColors.actionPrimary, 0.06)

  const contentColor = isDark ? theme.palette.common.white : themeColors.text

  const secondaryTextColor = isDark
    ? alpha(theme.palette.common.white, 0.7)
    : themeColors.cardMutedText

  const currentPriceColor = themeColors.cardPrice

  return (
    <Paper
      component={Link}
      to={`/product/${productRouteId}`}
      onClick={() => onProductClick?.(product, 'weekly_offer_card')}
      elevation={0}
      sx={{
        display: 'flex',
        gap: 1.35,
        p: { xs: 1.35, md: 1.55 },
        borderRadius: 2.75,
        bgcolor: cardBackground,
        color: contentColor,
        textDecoration: 'none',
        border: `1px solid ${cardBorder}`,
        boxShadow: 'none',
        backdropFilter: 'blur(10px)',
        transition:
          'background-color .18s ease, transform .18s ease, border-color .18s ease',
        '&:hover': {
          bgcolor: cardHoverBackground,
          borderColor: alpha(themeColors.actionPrimary, 0.25),
          transform: 'translateY(-1px)',
        },
      }}
    >
      <SafeImage
        src={getProductImage(product)}
        alt={product.title}
        fallbackSrc={DEFAULT_IMAGES.product}
        sx={{
          width: { xs: 74, sm: 84 },
          height: { xs: 74, sm: 84 },
          borderRadius: 2.25,
          flexShrink: 0,
          objectFit: 'cover',
          bgcolor: alpha('#000', 0.04),
        }}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} mb={0.65} flexWrap="wrap">
          {item.customLabel && (
            <Chip
              size="small"
              label={item.customLabel}
              sx={{
                height: 21,
                bgcolor: themeColors.actionPrimary,
                color: themeColors.actionPrimaryText,
                fontWeight: 800,
                fontSize: 10.5,
              }}
            />
          )}

          {discountPercentage > 0 && (
            <Chip
              size="small"
              label={`${discountPercentage}% OFF`}
              sx={{
                height: 21,
                bgcolor: theme.palette.error.main,
                color: theme.palette.error.contrastText,
                fontWeight: 800,
                fontSize: 10.5,
              }}
            />
          )}
        </Stack>

        <Typography
          fontWeight={850}
          noWrap
          sx={{ fontSize: 14.25, lineHeight: 1.22 }}
        >
          {item.customTitle || product.title}
        </Typography>

        <Typography
          variant="caption"
          sx={{ color: secondaryTextColor, mt: 0.15 }}
          display="block"
          noWrap
        >
          {product.categoria || product.category || product.marca || ''}
        </Typography>

        <Stack direction="row" spacing={0.85} alignItems="center" mt={0.65}>
          {discountPercentage > 0 && (
            <Typography
              variant="body2"
              sx={{
                color: secondaryTextColor,
                textDecoration: 'line-through',
                fontSize: 12.5,
              }}
            >
              {formatPrice(price)}
            </Typography>
          )}

          <Typography
            fontWeight={900}
            sx={{ color: currentPriceColor, fontSize: 14.5 }}
          >
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

  const themeColors = useMemo(
    () => getThemeColors(activeConfig),
    [activeConfig],
  )

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

  const promotionalBlocks = useSelector(selectPublicPromotionalBlocks) || []
  const promotionalBlocksLoading = useSelector(
    selectPublicPromotionalBlocksLoading,
  )

  const SKELETON_ARRAY = Array.from({ length: 4 }, (_, i) => i)

  const [searchValue, setSearchValue] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const { track, events } = useUserMetrics({ trackPageViews: false })

  const { user } = useSelector(state => state.user)
  const tenantId =
    tenantContext?.tenantId || tenantConfig?.tenantId || user?.tenantId

  const heroConfig = useMemo(() => {
    const isValidUrl = url => {
      if (!url) return false
      return (
        typeof url === 'string' &&
        (url.startsWith('http') || url.startsWith('/'))
      )
    }

    const hero = activeConfig?.hero || {}
    const general = activeConfig?.general || {}
    const colors = activeConfig?.colors || {}
    const heroImage = getAssetUrl(hero.backgroundImage)

    return {
      enabled: hero.enabled !== false,
      title: hero.title || general.storeName,
      subtitle: hero.subtitle || general.tagline,
      primaryColor: colors.primary || themeColors.primary,
      secondaryColor: colors.secondary || themeColors.secondary,
      accentColor: colors.accent || themeColors.accent,
      textColor: hero.textColor || '#ffffff',
      overlayOpacity: hero.overlayOpacity ?? 0.3,
      alignment: hero.alignment || 'left',
      height: hero.height || 'medium',
      ctaText: hero.ctaText || 'Ver productos',
      ctaLink: hero.ctaLink || '/product',
      showCta: hero.showCta !== false,
      bannerImage: isValidUrl(heroImage) ? heroImage : DEFAULT_IMAGES.hero,
      specialBanner: isValidUrl(activeConfig?.specialBanner)
        ? activeConfig.specialBanner
        : DEFAULT_IMAGES.special,
      showSpecialSection: activeConfig?.showSpecialSection !== false,
    }
  }, [activeConfig, themeColors])

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

  const getVisiblePromotionalItems = useCallback(block => {
    if (!Array.isArray(block?.products)) return []

    return block.products
      .filter(
        item => item?.isActive !== false && getProductFromPromotionalItem(item),
      )
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

    const query = searchValue.trim().toLowerCase()

    const results = allProducts.filter(product => {
      const title = product.title || ''
      const category = product.category || product.categoria || ''
      const brand = product.brand || product.marca || ''

      return [title, category, brand].some(value =>
        String(value || '')
          .toLowerCase()
          .includes(query),
      )
    })

    setSearchResults(results.slice(0, 10))
  }, [searchValue, allProducts])

  const featuredProducts = allProducts?.slice(0, 4) || []

  const handleSearchSubmit = useCallback(
    event => {
      event.preventDefault()

      if (searchValue.trim()) {
        const query = searchValue.trim()

        track(events.SEARCH, {
          searchQuery: query,
          metadata: {
            resultCount: searchResults.length,
            source: 'home',
          },
        })

        navigate(`/product?q=${encodeURIComponent(query)}`)
      }
    },
    [events.SEARCH, navigate, searchResults.length, searchValue, track],
  )

  const handlePromotionalProductClick = useCallback(
    (product, placement = 'home_promotional_product') => {
      if (!product) return

      track(events.PRODUCT_CLICK, {
        productId:
          product._id || product.id || product.productId || product.slug || '',
        value: Number(product.finalPrice ?? product.price ?? 0) || 0,
        category:
          product.category || product.categoria || product.categoryName || '',
        metadata: {
          title: product.title || product.name || '',
          brand: product.brand || product.marca || '',
          routeId: getProductRouteId(product) || '',
          placement,
        },
      })
    },
    [events.PRODUCT_CLICK, track],
  )

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

  const surfaceColor = themeColors.cardBackground
  const backgroundColor = themeColors.background

  const primaryAction = themeColors.actionPrimary
  const primaryActionText = themeColors.actionPrimaryText

  const textPrimary = themeColors.text
  const textSecondary = themeColors.textSecondary

  const pageBackgroundTop = alpha(backgroundColor, 1)
  const pageBackgroundMiddle = alpha(primaryAction, 0.035)
  const pageBackgroundBottom = alpha(primaryAction, 0.16)

  const pageBackground = `
    linear-gradient(
      180deg,
      ${pageBackgroundTop} 0%,
      ${pageBackgroundTop} 24%,
      ${pageBackgroundMiddle} 66%,
      ${pageBackgroundBottom} 100%
    )
  `

  const borderColor = alpha(themeColors.cardBorder, 0.58)
  const mutedSurface = alpha(surfaceColor, 0.88)
  const elevatedSurface = alpha(surfaceColor, 0.92)
  const highlightSurface = alpha(primaryAction, 0.08)
  const interactiveHover = alpha(primaryAction, 0.06)

  const sectionSx = {
    maxWidth: layoutConfig.maxWidth,
    px: `${layoutConfig.containerPadding}px`,
  }

  const documentTitle = `Inicio | ${activeConfig?.general?.storeName || 'Tu Tienda'}`

  const compactSectionSx = {
    py: {
      xs: 2.5,
      md: 3.5,
    },
  }

  return (
    <Box
      sx={{
        background: pageBackground,
        color: textPrimary,
        minHeight: '100vh',
      }}
    >
      <Meta title={documentTitle} />

      {/* --- SECCIÓN 1: HERO + BÚSQUEDA --- */}
      {heroConfig.enabled && (
        <Box
          sx={{
            bgcolor: 'transparent',
            pt: { xs: 1.5, md: 2 },
            pb: { xs: 1.5, md: 2 },
            borderBottom: `1px solid ${alpha(borderColor, 0.48)}`,
          }}
        >
          <Container maxWidth={false} disableGutters sx={sectionSx}>
            <Paper
              elevation={0}
              sx={{
                overflow: 'hidden',
                borderRadius: { xs: 3, md: 4 },
                bgcolor: elevatedSurface,
                backdropFilter: 'blur(10px)',
                border: `1px solid ${borderColor}`,
                boxShadow: '0 10px 28px rgba(15, 23, 42, 0.045)',
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  height: {
                    xs: 250,
                    sm: 330,
                    md: {
                      small: 340,
                      medium: 440,
                      large: 540,
                      fullscreen: 'calc(100vh - 190px)',
                    }[heroConfig.height],
                  },
                  minHeight: { xs: 230, md: 340 },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: alpha(primaryAction, 0.018),
                }}
              >
                <SafeImage
                  src={heroConfig.bannerImage}
                  alt={heroConfig.title || 'Imagen principal'}
                  fallbackSrc={DEFAULT_IMAGES.hero}
                  sx={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    objectPosition: 'center',
                    display: 'block',
                  }}
                />

                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    bgcolor: `rgba(0, 0, 0, ${heroConfig.overlayOpacity})`,
                    pointerEvents: 'none',
                  }}
                />

                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems:
                      heroConfig.alignment === 'center'
                        ? 'center'
                        : heroConfig.alignment === 'right'
                          ? 'flex-end'
                          : 'flex-start',
                    textAlign: heroConfig.alignment,
                    px: { xs: 2.5, md: 5 },
                    gap: { xs: 0.5, md: 1 },
                  }}
                >
                  <Typography
                    component="h1"
                    sx={{
                      color: heroConfig.textColor,
                      fontWeight: 800,
                      fontSize: { xs: '1.5rem', sm: '2rem', md: '2.75rem' },
                      lineHeight: 1.15,
                      textShadow: '0 2px 12px rgba(0, 0, 0, 0.35)',
                    }}
                  >
                    {heroConfig.title}
                  </Typography>

                  {heroConfig.subtitle && (
                    <Typography
                      component="h2"
                      sx={{
                        color: heroConfig.textColor,
                        fontWeight: 500,
                        fontSize: { xs: '0.9rem', sm: '1.05rem', md: '1.25rem' },
                        opacity: 0.92,
                        textShadow: '0 2px 10px rgba(0, 0, 0, 0.35)',
                      }}
                    >
                      {heroConfig.subtitle}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Paper>

            <Box
              sx={{
                width: '100%',
                maxWidth: 720,
                mx: 'auto',
                mt: { xs: 1.25, md: 1.75 },
                position: 'relative',
              }}
            >
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 0.85, sm: 1 },
                  borderRadius: { xs: 3, sm: 999 },
                  bgcolor: mutedSurface,
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${borderColor}`,
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.05)',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: 'center',
                    gap: 0.85,
                  }}
                >
                  <Box
                    component="form"
                    onSubmit={handleSearchSubmit}
                    sx={{
                      width: '100%',
                      flex: 1,
                    }}
                  >
                    <TextField
                      fullWidth
                      placeholder="¿Qué estás buscando?"
                      value={searchValue}
                      onChange={e => setSearchValue(e.target.value)}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          height: { xs: 48, md: 50 },
                          borderRadius: 999,
                          bgcolor: 'transparent',
                          fontWeight: 600,
                          '& fieldset': {
                            border: 'none',
                          },
                        },
                        '& .MuiInputBase-input': {
                          fontSize: 15,
                        },
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start" sx={{ ml: 1 }}>
                            <BsSearch color={primaryAction} />
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
                        width: { xs: '100%', sm: 'auto' },
                        minWidth: { sm: 140 },
                        height: { xs: 46, md: 48 },
                        borderRadius: 999,
                        px: 2.4,
                        bgcolor: primaryAction,
                        color: primaryActionText,
                        fontWeight: 850,
                        textTransform: 'none',
                        boxShadow: 'none',
                        '&:hover': {
                          bgcolor: primaryAction,
                          filter: 'brightness(0.94)',
                          boxShadow: '0 10px 22px rgba(15, 23, 42, 0.13)',
                        },
                      }}
                    >
                      {heroConfig.ctaText}
                    </Button>
                  )}
                </Box>
              </Paper>

              {searchResults.length > 0 && (
                <Paper
                  sx={{
                    position: 'absolute',
                    top: 'calc(100% + 7px)',
                    left: 0,
                    right: 0,
                    maxHeight: 360,
                    overflowY: 'auto',
                    zIndex: 100,
                    borderRadius: 3,
                    border: `1px solid ${borderColor}`,
                    boxShadow: '0 16px 44px rgba(15, 23, 42, 0.13)',
                    p: 0.85,
                    bgcolor: alpha(surfaceColor, 0.96),
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  {searchResults.map(product => {
                    const productRouteId = getProductRouteId(product)

                    if (!productRouteId) return null

                    return (
                      <Box
                        key={product._id || product.id || productRouteId}
                        component={Link}
                        to={`/product/${productRouteId}`}
                        onClick={() => {
                          handlePromotionalProductClick(
                            product,
                            'home_search_result',
                          )
                          setSearchResults([])
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.4,
                          p: 1.1,
                          borderRadius: 2.5,
                          textDecoration: 'none',
                          color: 'inherit',
                          transition: 'background-color .18s ease',
                          '&:hover': {
                            bgcolor: interactiveHover,
                          },
                        }}
                      >
                        <SafeImage
                          src={getProductImage(product)}
                          fallbackSrc={DEFAULT_IMAGES.product}
                          alt={product.title}
                          sx={{
                            width: 42,
                            height: 42,
                            borderRadius: 2,
                            flexShrink: 0,
                            objectFit: 'cover',
                          }}
                        />

                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 750 }}
                            noWrap
                          >
                            {product.title}
                          </Typography>

                          <Typography
                            variant="caption"
                            sx={{ color: textSecondary }}
                            noWrap
                          >
                            {product.category || product.categoria}
                          </Typography>
                        </Box>

                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 850,
                            whiteSpace: 'nowrap',
                            color: textPrimary,
                          }}
                        >
                          {formatPrice(product.finalPrice ?? product.price)}
                        </Typography>
                      </Box>
                    )
                  })}
                </Paper>
              )}
            </Box>
          </Container>
        </Box>
      )}

      {/* --- SECCIÓN 2: TRUST BADGES --- */}
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          ...sectionSx,
          py: { xs: 1.5, md: 2 },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: { xs: 1.1, md: 1.4 },
            borderRadius: { xs: 3, md: 4 },
            bgcolor: elevatedSurface,
            backdropFilter: 'blur(10px)',
            border: `1px solid ${borderColor}`,
            boxShadow: 'none',
          }}
        >
          <Grid container spacing={{ xs: 1.25, md: 1.5 }}>
            {services.map((service, index) => (
              <Grid item xs={12} sm={6} md={3} key={index}>
                <Stack
                  direction="row"
                  spacing={1.35}
                  alignItems="center"
                  sx={{
                    p: 0.75,
                    borderRadius: 2.5,
                    transition: 'background-color .18s ease',
                    '&:hover': {
                      bgcolor: interactiveHover,
                    },
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      fontSize: 20,
                      color: primaryAction,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: highlightSurface,
                      borderRadius: 999,
                      flexShrink: 0,
                    }}
                  >
                    {service.icon}
                  </Box>

                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        fontWeight: 850,
                        lineHeight: 1.12,
                        color: textPrimary,
                      }}
                    >
                      {service.title}
                    </Typography>

                    <Typography variant="caption" sx={{ color: textSecondary }}>
                      {service.desc}
                    </Typography>
                  </Box>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Container>

      {/* --- SECCIÓN 3: PRODUCTOS RECOMENDADOS --- */}
      <Container
        maxWidth={false}
        disableGutters
        sx={{
          ...sectionSx,
          ...compactSectionSx,
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="flex-end"
          sx={{ mb: { xs: 1.75, md: 2.25 } }}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{
                display: 'block',
                mb: 0.25,
                color: themeColors.text,
                fontWeight: 900,
                fontSize: 21,
                letterSpacing: 1.6,
                lineHeight: 1,
              }}
            >
              Selección destacada
            </Typography>
          </Box>

          <Button
            component={Link}
            to="/product"
            endIcon={<BsArrowRight />}
            sx={{
              fontWeight: 850,
              textTransform: 'none',
              color: themeColors.actionPrimary,
              borderRadius: 999,
              px: 1.5,
              minWidth: 'auto',
              '&:hover': {
                bgcolor: themeColors.actionPrimary,
                color: themeColors.actionPrimaryText,
              },
            }}
          >
            Ver todo
          </Button>
        </Stack>

        <Grid
          container
          spacing={Math.max(0, Math.round((productConfig.gap ?? 24) / 8))}
        >
          {isLoading
            ? [...Array(4)].map((_, index) => (
                <Grid
                  item
                  xs={12}
                  sm={6}
                  md={12 / Math.min(productConfig.columns ?? 4, 6)}
                  key={index}
                >
                  <Skeleton
                    variant="rectangular"
                    height={310}
                    sx={{
                      borderRadius: 4,
                      bgcolor: alpha('#000', 0.06),
                    }}
                  />
                </Grid>
              ))
            : featuredProducts.map(product => (
                <Grid
                  item
                  xs={12}
                  sm={6}
                  md={12 / Math.min(productConfig.columns ?? 4, 6)}
                  key={product._id}
                >
                  <HomeProductCard data={product} placement="home_featured" />
                </Grid>
              ))}
        </Grid>
      </Container>

      {/* --- SECCIÓN 4: OFERTAS DESDE PROMOTIONAL BLOCKS --- */}
      {heroConfig.showSpecialSection && (
        <>
          {promotionalBlocksLoading ? (
            <Box
              sx={{
                bgcolor: 'transparent',
                py: { xs: 2.5, md: 3.5 },
              }}
            >
              <Container maxWidth={false} disableGutters sx={sectionSx}>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 1.75, md: 2.5 },
                    borderRadius: { xs: 3, md: 4 },
                    bgcolor: elevatedSurface,
                    backdropFilter: 'blur(10px)',
                    border: `1px solid ${borderColor}`,
                    boxShadow: 'none',
                  }}
                >
                  <Grid container spacing={3} alignItems="center">
                    <Grid item xs={12} md={5}>
                      <Skeleton width={170} height={22} sx={{ mb: 1.5 }} />
                      <Skeleton width="80%" height={48} sx={{ mb: 2 }} />

                      <Stack spacing={1.5}>
                        {SKELETON_ARRAY.slice(0, 3).map(index => (
                          <Skeleton
                            key={index}
                            variant="rectangular"
                            height={98}
                            sx={{ borderRadius: 3 }}
                          />
                        ))}
                      </Stack>
                    </Grid>

                    <Grid item xs={12} md={7}>
                      <Skeleton
                        variant="rectangular"
                        height={330}
                        sx={{ borderRadius: 4 }}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Container>
            </Box>
          ) : weeklyOffersBlock.length > 0 ? (
            weeklyOffersBlock.map((block, blockIndex) => {
              const items = getVisiblePromotionalItems(block)

              if (items.length === 0) return null

              return (
                <Box
                  key={block._id}
                  sx={{
                    bgcolor: 'transparent',
                    py: { xs: 2.5, md: 3.5 },
                  }}
                >
                  <Container maxWidth={false} disableGutters sx={sectionSx}>
                    <Paper
                      elevation={0}
                      sx={{
                        overflow: 'hidden',
                        borderRadius: { xs: 3, md: 4 },
                        bgcolor: elevatedSurface,
                        backdropFilter: 'blur(10px)',
                        border: `1px solid ${borderColor}`,
                        boxShadow: '0 10px 28px rgba(15, 23, 42, 0.035)',
                      }}
                    >
                      <Grid
                        container
                        spacing={0}
                        alignItems="stretch"
                        direction={blockIndex % 2 === 0 ? 'row' : 'row-reverse'}
                      >
                        <Grid item xs={12} md={5}>
                          <Box
                            sx={{
                              height: '100%',
                              p: { xs: 2, md: 3 },
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'center',
                            }}
                          >
                            <Typography
                              variant="overline"
                              sx={{
                                color: primaryAction,
                                letterSpacing: 1.7,
                                fontWeight: 900,
                                fontSize: 11,
                              }}
                            >
                              OFERTAS LIMITADAS
                            </Typography>

                            <Typography
                              variant="h2"
                              sx={{
                                fontWeight: 950,
                                mb: 1.25,
                                fontSize: { xs: '1.7rem', md: '2.25rem' },
                                lineHeight: 1,
                                letterSpacing: '-0.045em',
                                color: textPrimary,
                              }}
                            >
                              {block.title || 'Ofertas de la Semana'}
                            </Typography>

                            {block.description && (
                              <Typography
                                sx={{
                                  mb: 2,
                                  color: textSecondary,
                                  lineHeight: 1.6,
                                }}
                              >
                                {block.description}
                              </Typography>
                            )}

                            <Stack spacing={1.35}>
                              {items.map(item => {
                                const product =
                                  getProductFromPromotionalItem(item)

                                return (
                                  <Suspense
                                    key={`${block._id}-${product?._id || item.productId}`}
                                    fallback={
                                      <Skeleton
                                        height={98}
                                        sx={{
                                          borderRadius: 3,
                                        }}
                                      />
                                    }
                                  >
                                    <PromotionalSpecialProduct
                                      item={item}
                                      formatPrice={formatPrice}
                                      themeColors={themeColors}
                                      isDark={false}
                                      onProductClick={
                                        handlePromotionalProductClick
                                      }
                                    />
                                  </Suspense>
                                )
                              })}
                            </Stack>
                          </Box>
                        </Grid>

                        <Grid item xs={12} md={7}>
                          <Box
                            sx={{
                              height: '100%',
                              minHeight: { xs: 260, md: 440 },
                              p: { xs: 1.75, md: 2.5 },
                              bgcolor: alpha(primaryAction, 0.018),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <SafeImage
                              src={heroConfig.specialBanner}
                              alt={block.title || 'Ofertas especiales'}
                              fallbackSrc={DEFAULT_IMAGES.special}
                              sx={{
                                width: '100%',
                                height: '100%',
                                maxHeight: 470,
                                objectFit: 'contain',
                                objectPosition: 'center',
                                borderRadius: { xs: 2.5, md: 3.5 },
                                boxShadow: 'none',
                                transition: 'transform 0.22s ease',
                                '&:hover': {
                                  transform: 'scale(1.008)',
                                },
                              }}
                            />
                          </Box>
                        </Grid>
                      </Grid>
                    </Paper>
                  </Container>
                </Box>
              )
            })
          ) : (
            <Box
              sx={{
                bgcolor: 'transparent',
                py: { xs: 2.5, md: 3.5 },
              }}
            >
              <Container maxWidth={false} disableGutters sx={sectionSx}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 2.5,
                    borderRadius: 3,
                    bgcolor: elevatedSurface,
                    backdropFilter: 'blur(10px)',
                    border: `1px solid ${borderColor}`,
                    boxShadow: 'none',
                  }}
                >
                  <Typography sx={{ color: textSecondary }}>
                    No hay ofertas especiales activas
                  </Typography>
                </Paper>
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
            ...sectionSx,
            py: { xs: 2.5, md: 3.5 },
          }}
        >
          {featuredPromotionalBlocks.map(block => {
            const items = Array.isArray(block.products)
              ? block.products
                  .filter(
                    item =>
                      item?.isActive !== false &&
                      getProductFromPromotionalItem(item),
                  )
                  .sort(
                    (a, b) => Number(a.priority || 1) - Number(b.priority || 1),
                  )
                  .slice(0, block.maxItems || 4)
              : []

            if (items.length === 0) return null

            return (
              <Box key={block._id} sx={{ mb: { xs: 2.5, md: 3.5 } }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: { xs: 1.75, md: 2.5 },
                    borderRadius: { xs: 3, md: 4 },
                    bgcolor: elevatedSurface,
                    backdropFilter: 'blur(10px)',
                    border: `1px solid ${borderColor}`,
                    boxShadow: 'none',
                  }}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ mb: { xs: 1.75, md: 2.25 } }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: { xs: '1.35rem', md: '1.75rem' },
                          lineHeight: 1.08,
                          letterSpacing: '-0.035em',
                          fontWeight: 950,
                          color: textPrimary,
                        }}
                      >
                        {block.title}
                      </Typography>

                      {block.description && (
                        <Typography sx={{ color: textSecondary, mt: 0.35 }}>
                          {block.description}
                        </Typography>
                      )}
                    </Box>

                    <Button
                      component={Link}
                      to="/product"
                      endIcon={<BsArrowRight />}
                      sx={{
                        fontWeight: 800,
                        color: textPrimary,
                        textTransform: 'none',
                        borderRadius: 999,
                        px: 1.5,
                        flexShrink: 0,
                        '&:hover': {
                          bgcolor: interactiveHover,
                        },
                      }}
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
                              finalPrice: item.discountPercentage
                                ? getFinalPrice(
                                    product.price,
                                    item.discountPercentage,
                                  )
                                : product.finalPrice || product.price,
                              discountPercentage: item.discountPercentage,
                              hasPromotion:
                                Number(item.discountPercentage || 0) > 0,
                              promotionId: item.promotionId || block._id,
                              promotionTitle: block.title,
                              promotionType: block.type,
                            }}
                            placement={`home_promotional_${block.type || 'block'}`}
                          />
                        </Grid>
                      )
                    })}
                  </Grid>
                </Paper>
              </Box>
            )
          })}
        </Container>
      )}
    </Box>
  )
}

export default Home
