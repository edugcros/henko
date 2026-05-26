import React, { 
  useEffect, 
  useState, 
  useMemo, 
  useCallback, 
  Suspense,
  memo 
} from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { getAllProducts } from '@features/products/productSlice'

// Componentes
import Meta from '@components/Meta'
import ErrorBoundary from '@components/ErrorBoundary/ErrorBoundary'

// Lazy loading para componentes pesados
const HomeProductCard = React.lazy(() => import('@components/HomeProductCard'))
const SpecialProduct = React.lazy(() => import('@components/SpecialProduct'))
const Marquee = React.lazy(() => import('react-fast-marquee'))

// Iconos y UI
import {
  BsSearch,
  BsArrowRight,
  BsShieldCheck,
  BsTruck,
  BsArrowRepeat,
  BsHeadset,
  BsImageAlt
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
  Fade,
  Alert,
  Chip,
} from '@mui/material'
import { useDebounce } from '../Hooks/useDebounce'

import brand1 from '@assets/images/brand-01.png'
import brand2 from '@assets/images/brand-02.png'
import brand3 from '@assets/images/brand-03.png'
import brand4 from '@assets/images/brand-04.png'

// Constantes
const SERVICES = [
  { title: 'Envío Veloz', desc: 'Gratis desde $50', icon: <BsTruck /> },
  { title: 'Pago Seguro', desc: '100% Protegido', icon: <BsShieldCheck /> },
  { title: 'Soporte Real', desc: 'Expertos 24/7', icon: <BsHeadset /> },
  { title: 'Devoluciones', desc: '30 días de garantía', icon: <BsArrowRepeat /> },
]

const SKELETON_ARRAY = Array.from({ length: 4 }, (_, i) => i)

// URLs de imágenes por defecto (usando placeholders confiables)
const DEFAULT_IMAGES = {
  hero: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=1200&h=800&fit=crop',
  special: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&h=600&fit=crop',
  product: '/assets/images/placeholder.png',
  brand: '/assets/images/brand-placeholder.png'
}

// Helper para normalizar tags
const normalizeTags = (tags) => {
  if (!tags) return []
  return Array.isArray(tags) ? tags : [tags]
}

// Componente de imagen segura con fallback
const SafeImage = memo(({ 
  src, 
  alt, 
  fallbackSrc = DEFAULT_IMAGES.product,
  sx = {},
  ...props 
}) => {
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
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        bgcolor: 'grey.100',
        color: 'grey.400',
        ...sx 
      }}>
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

// Componente memoizado para item de búsqueda
const SearchResultItem = memo(({ product }) => {
  const imageUrl = product.images?.[0]?.url
  const category = product.category || product.categoria || 'Sin categoría'
  
  return (
    <Box 
      component={Link} 
      to={`/product/${product._id}`}
      sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: 2, 
        p: 1.5, 
        borderRadius: 2, 
        textDecoration: 'none', 
        color: 'inherit',
        transition: 'all 0.2s ease',
        '&:hover': { 
          bgcolor: 'action.hover',
          transform: 'translateX(4px)'
        } 
      }}
    >
      <SafeImage 
        src={imageUrl}
        alt={product.title}
        fallbackSrc={DEFAULT_IMAGES.product}
        sx={{ 
          width: 45, 
          height: 45, 
          borderRadius: 1,
          bgcolor: 'grey.100'
        }} 
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {product.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {category}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main' }}>
        ${product.price?.toLocaleString()}
      </Typography>
    </Box>
  )
})

SearchResultItem.displayName = 'SearchResultItem'

// Componente memoizado para Service Card
const ServiceCard = memo(({ service }) => (
  <Stack direction="row" spacing={2} alignItems="center">
    <Box sx={{ 
      fontSize: 32, 
      color: 'primary.main', 
      display: 'flex', 
      p: 1.5, 
      bgcolor: 'primary.light', 
      borderRadius: 3,
      opacity: 0.9
    }}>
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
))

ServiceCard.displayName = 'ServiceCard'

// Hook local robusto para config (no bloquea si falla)
const useHomeConfig = () => {
  const [config, setConfig] = useState(null)
  const [isLoading, setIsLoading] = useState(false) // Cambiado a false por defecto
  const [error, setError] = useState(null)
  
  const { user } = useSelector((state) => state.user)
  const tenantId = user?.tenantId

  useEffect(() => {
    // Si no hay tenantId, usar config por defecto sin error
    if (!tenantId) {
      setIsLoading(false)
      setError(null)
      return
    }

    const fetchConfig = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        // Intentar cargar config, pero no es crítico
        const response = await fetch(`/api/tenants/${tenantId}/config`)
        if (!response.ok) {
          // Si falla, no es error crítico - usar defaults
          console.warn('Config no disponible, usando defaults')
          setConfig(null)
          return
        }
        const data = await response.json()
        setConfig(data)
      } catch (err) {
        // Error no crítico - loguear pero no bloquear
        console.warn('Error cargando config:', err.message)
        setConfig(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchConfig()
  }, [tenantId])

  // Siempre retornar config (null es válido, usará defaults)
  return { config, isLoading, error: null } // Forzamos error a null siempre
}

const Home = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const theme = useTheme()
  
  // Usar hook local que no bloquea
  const { config, isLoading: configLoading } = useHomeConfig()

  const [searchValue, setSearchValue] = useState('')
  const debouncedSearch = useDebounce(searchValue, 300)
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  // Redux selectors
  const { 
    products: allProducts = [], 
    isLoading: productsLoading,
    error: productsError 
  } = useSelector((state) => state.product)

  const { user } = useSelector((state) => state.user)
  const tenantId = user?.tenantId

  // Carga multi-tenant - SIEMPRE intentar cargar
  useEffect(() => {
    // Cargar productos aunque no haya tenantId (mostrará vacío o defaults)
    dispatch(getAllProducts({ tenantId: tenantId || 'default', limit: 100 }))
      .unwrap()
      .catch((err) => {
        console.error('Error cargando productos:', err)
      })
  }, [tenantId, dispatch])

  // Memoización de filtros
  const { featuredProducts, specialProducts, searchResults } = useMemo(() => {
    if (!allProducts?.length) {
      return { featuredProducts: [], specialProducts: [], searchResults: [] }
    }

    const featured = allProducts.slice(0, 4)
    
    const special = allProducts.filter((p) => {
      const tags = normalizeTags(p.tags)
      return tags.includes('special')
    }).slice(0, 3)

    let search = []
    if (debouncedSearch.trim()) {
      const query = debouncedSearch.toLowerCase().trim()
      search = allProducts.filter((p) => {
        const title = p.title?.toLowerCase() || ''
        const category = (p.category || p.categoria || '').toLowerCase()
        return title.includes(query) || category.includes(query)
      }).slice(0, 8)
    }

    return { featuredProducts: featured, specialProducts: special, searchResults: search }
  }, [allProducts, debouncedSearch])

  // Handlers memoizados
  const handleSearchSubmit = useCallback((e) => {
    e.preventDefault()
    if (searchValue.trim()) {
      navigate(`/product?q=${encodeURIComponent(searchValue.trim())}`)
    }
  }, [searchValue, navigate])

  const handleSearchChange = useCallback((e) => {
    setSearchValue(e.target.value)
  }, [])

  // Configuración con defaults seguros (nunca falla)
  const heroConfig = useMemo(() => {
    const isValidUrl = (url) => {
      if (!url) return false
      return typeof url === 'string' && (url.startsWith('http') || url.startsWith('/'))
    }

    return {
      title: config?.heroTitle || 'Lo mejor en Tecnología.',
      subtitle: config?.heroSubtitle || 'BIENVENIDO A LA EXPERIENCIA PRO',
      primaryColor: config?.primaryColor || theme.palette.primary.main,
      bannerImage: isValidUrl(config?.heroBanner) ? config.heroBanner : DEFAULT_IMAGES.hero,
      specialBanner: isValidUrl(config?.specialBanner) ? config.specialBanner : DEFAULT_IMAGES.special,
      showSpecialSection: config?.showSpecialSection !== false,
    }
  }, [config, theme.palette.primary.main])

  // Solo mostrar error si es CRÍTICO (productos fallaron y no hay nada que mostrar)
  const isLoading = productsLoading || configLoading
  const showCriticalError = productsError && !allProducts.length

  // Si hay error crítico, mostrar alerta pero con opción de continuar
  if (showCriticalError) {
    return (
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            ⚠️ Problema de conexión
          </Typography>
          <Typography variant="body2">
            No pudimos cargar los productos. Esto puede deberse a:
          </Typography>
          <ul>
            <li>Problemas de red</li>
            <li>Servidor no disponible</li>
            <li>Sesión expirada</li>
          </ul>
        </Alert>
        <Stack direction="row" spacing={2}>
          <Button 
            variant="contained" 
            onClick={() => window.location.reload()}
          >
            🔄 Recargar página
          </Button>
          <Button 
            variant="outlined"
            onClick={() => {
              // Forzar renderizado con datos vacíos
              dispatch({ type: 'product/clearError' })
            }}
          >
            Continuar sin datos
          </Button>
        </Stack>
      </Container>
    )
  }

  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: '100vh' }}>
      <Meta 
        title={config?.seoTitle || 'Inicio | Tu Tienda'}
        description={config?.seoDescription || 'Encuentra los mejores productos tecnológicos'}
        keywords={config?.seoKeywords || 'tecnología, productos, tienda online'}
      />

      {/* --- SECCIÓN 1: HERO & BÚSQUEDA --- */}
      <Box sx={{ 
        bgcolor: 'background.paper', 
        pt: { xs: 4, md: 8 }, 
        pb: { xs: 6, md: 10 }, 
        borderBottom: 1,
        borderColor: 'divider',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Background decorativo */}
        <SafeImage
          src={heroConfig.bannerImage}
          alt="Hero background"
          fallbackSrc={DEFAULT_IMAGES.hero}
          sx={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: { md: '50%' },
            height: '100%',
            opacity: 0.1,
            display: { xs: 'none', md: 'block' }
          }}
        />
        
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Grid container spacing={6} alignItems="center">
            <Grid item xs={12} md={7}>
              <Box sx={{ textAlign: { xs: 'center', md: 'left' } }}>
                <Typography 
                  variant="overline" 
                  sx={{ 
                    color: 'primary.main', 
                    fontWeight: 800, 
                    letterSpacing: 3,
                    fontSize: '0.85rem'
                  }}
                >
                  {heroConfig.subtitle}
                </Typography>
                
                <Typography 
                  variant="h1" 
                  sx={{ 
                    fontWeight: 900, 
                    mt: 1, 
                    mb: 3, 
                    fontSize: { xs: '2.5rem', md: '4rem' },
                    lineHeight: 1.1
                  }}
                >
                  <Box component="span" sx={{ color: heroConfig.primaryColor }}>
                    {heroConfig.title.split(' ').slice(0, -1).join(' ')}
                    <br />
                    {heroConfig.title.split(' ').slice(-1)}
                  </Box>
                </Typography>

                {/* Buscador */}
                <Box sx={{ position: 'relative', maxWidth: 560, mx: { xs: 'auto', md: 0 } }}>
                  <Box component="form" onSubmit={handleSearchSubmit}>
                    <TextField
                      fullWidth
                      placeholder="¿Qué estás buscando hoy?"
                      value={searchValue}
                      onChange={handleSearchChange}
                      onFocus={() => setIsSearchFocused(true)}
                      onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                      sx={{ 
                        '& .MuiOutlinedInput-root': { 
                          borderRadius: '50px',
                          bgcolor: 'grey.50',
                          transition: 'all 0.3s ease',
                          '& fieldset': { border: 'none' },
                          '&:hover': { bgcolor: 'grey.100' },
                          '&.Mui-focused': { 
                            bgcolor: 'background.paper',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
                          }
                        } 
                      }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start" sx={{ ml: 1 }}>
                            <BsSearch color={theme.palette.primary.main} size={20} />
                          </InputAdornment>
                        ),
                        endAdornment: searchValue && (
                          <InputAdornment position="end">
                            <Chip 
                              label="Enter ↵" 
                              size="small" 
                              color="primary" 
                              variant="outlined"
                              sx={{ mr: 1 }}
                            />
                          </InputAdornment>
                        )
                      }}
                    />
                  </Box>

                  {/* Dropdown de resultados */}
                  <Fade in={isSearchFocused && searchResults.length > 0}>
                    <Paper 
                      sx={{ 
                        position: 'absolute', 
                        top: 'calc(100% + 8px)', 
                        left: 0, 
                        right: 0, 
                        maxHeight: 450, 
                        overflowY: 'auto', 
                        zIndex: 1300, 
                        borderRadius: 3, 
                        boxShadow: '0 20px 40px rgba(0,0,0,0.15)', 
                        p: 1
                      }}
                    >
                      {searchResults.length > 0 ? (
                        searchResults.map((product) => (
                          <SearchResultItem key={product._id} product={product} />
                        ))
                      ) : debouncedSearch && !isLoading ? (
                        <Box sx={{ p: 3, textAlign: 'center' }}>
                          <Typography color="text.secondary">
                            No se encontraron productos
                          </Typography>
                        </Box>
                      ) : null}
                      
                      {searchResults.length > 0 && (
                        <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider', mt: 1 }}>
                          <Button 
                            fullWidth 
                            component={Link}
                            to={`/product?q=${encodeURIComponent(debouncedSearch)}`}
                            endIcon={<BsArrowRight />}
                          >
                            Ver todos los resultados
                          </Button>
                        </Box>
                      )}
                    </Paper>
                  </Fade>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* --- SECCIÓN 2: TRUST BADGES --- */}
      <Container maxWidth="lg" sx={{ mt: -5, position: 'relative', zIndex: 2 }}>
        <Paper 
          elevation={0} 
          sx={{ 
            p: { xs: 3, md: 4 }, 
            borderRadius: 5, 
            border: 1,
            borderColor: 'divider',
            boxShadow: '0 10px 40px rgba(0,0,0,0.04)',
            bgcolor: 'background.paper'
          }}
        >
          <Grid container spacing={{ xs: 3, md: 4 }}>
            {SERVICES.map((service, index) => (
              <Grid item xs={12} sm={6} md={3} key={index}>
                <ServiceCard service={service} />
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Container>

      {/* --- SECCIÓN 3: DESTACADOS --- */}
      <ErrorBoundary fallback={<Alert severity="error">Error al cargar productos destacados</Alert>}>
        <Container maxWidth="lg" sx={{ my: 10 }}>
          <Stack 
            direction="row" 
            justifyContent="space-between" 
            alignItems="center" 
            sx={{ mb: 5 }}
          >
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
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

          <Grid container spacing={3}>
            {isLoading ? (
              SKELETON_ARRAY.map((i) => (
                <Grid item xs={12} sm={6} md={3} key={i}>
                  <Skeleton 
                    variant="rectangular" 
                    height={380} 
                    sx={{ borderRadius: 5 }} 
                  />
                </Grid>
              ))
            ) : featuredProducts.length > 0 ? (
              featuredProducts.map((product) => (
                <Grid item xs={12} sm={6} md={3} key={product._id}>
                  <Suspense fallback={<Skeleton height={380} sx={{ borderRadius: 5 }} />}>
                    <HomeProductCard data={product} />
                  </Suspense>
                </Grid>
              ))
            ) : (
              <Grid item xs={12}>
                <Alert severity="info" sx={{ textAlign: 'center', py: 4 }}>
                  <Typography variant="h6" gutterBottom>
                    🛍️ No hay productos disponibles
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Vuelve pronto para descubrir nuestras novedades
                  </Typography>
                  <Button 
                    component={Link} 
                    to="/product" 
                    variant="contained" 
                    sx={{ mt: 2 }}
                  >
                    Explorar catálogo
                  </Button>
                </Alert>
              </Grid>
            )}
          </Grid>
        </Container>
      </ErrorBoundary>

      {/* --- SECCIÓN 4: OFERTAS ESPECIALES --- */}
      {heroConfig.showSpecialSection && (
        <ErrorBoundary>
          <Box sx={{ 
            bgcolor: 'grey.900', 
            py: 12, 
            color: 'common.white',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Patrón decorativo */}
            <Box sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              opacity: 0.05,
              backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
              backgroundSize: '40px 40px'
            }} />
            
            <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
              <Grid container spacing={8} alignItems="center">
                <Grid item xs={12} md={5}>
                  <Typography 
                    variant="overline" 
                    sx={{ color: 'primary.light', letterSpacing: 2 }}
                  >
                    OFERTAS LIMITADAS
                  </Typography>
                  <Typography 
                    variant="h2" 
                    sx={{ 
                      fontWeight: 900, 
                      mb: 3,
                      fontSize: { xs: '2rem', md: '3rem' }
                    }}
                  >
                    Ofertas de la Semana
                  </Typography>
                  
                  <Stack spacing={3}>
                    {isLoading ? (
                      SKELETON_ARRAY.slice(0, 3).map((i) => (
                        <Skeleton 
                          key={i} 
                          variant="rectangular" 
                          height={120} 
                          sx={{ bgcolor: 'grey.800', borderRadius: 2 }} 
                        />
                      ))
                    ) : specialProducts.length > 0 ? (
                      specialProducts.map((product) => (
                        <Suspense 
                          key={product._id} 
                          fallback={<Skeleton height={120} sx={{ bgcolor: 'grey.800' }} />}
                        >
                          <SpecialProduct item={product} />
                        </Suspense>
                      ))
                    ) : (
                      <Typography color="grey.400">
                        No hay ofertas especiales activas
                      </Typography>
                    )}
                  </Stack>
                </Grid>
                
                <Grid item xs={12} md={7}>
                  <SafeImage 
                    src={heroConfig.specialBanner}
                    alt="Ofertas especiales"
                    fallbackSrc={DEFAULT_IMAGES.special}
                    sx={{ 
                      width: '100%', 
                      borderRadius: 4, 
                      transform: { md: 'rotate(2deg)' },
                      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                      transition: 'transform 0.3s ease',
                      '&:hover': {
                        transform: { md: 'rotate(0deg) scale(1.02)' }
                      }
                    }} 
                  />
                </Grid>
              </Grid>
            </Container>
          </Box>
        </ErrorBoundary>
      )}

      {/* --- SECCIÓN 5: BRANDS --- */}
      {heroConfig.showBrands && (
        <Box sx={{ py: 10, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
          <Container maxWidth="lg">
            <Typography 
              variant="h6" 
              textAlign="center" 
              sx={{ mb: 4, color: 'text.secondary', fontWeight: 600 }}
            >
              Marcas que confían en nosotros
            </Typography>
            
            <Suspense fallback={<Skeleton height={60} />}>
              <Marquee gradient={true} speed={50}>
                {[brand1, brand2, brand3, brand4].map((b, i) => (
                  <Box key={i} component="img" src={b} sx={{ mx: 6, height: 45, filter: 'grayscale(100%)', opacity: 0.4 }} />
                ))}
              </Marquee>
            </Suspense>
          </Container>
        </Box>
      )}
    </Box>
  )
}

export default memo(Home)