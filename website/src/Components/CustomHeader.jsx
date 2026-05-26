// 📁 src/Components/CustomHeader.jsx
import React, { useMemo, useEffect } from 'react'
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  useTheme,
  IconButton,
  Badge,
  Tooltip,
  alpha,
  Button,
  Skeleton,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  useMediaQuery,
} from '@mui/material'
import { useSelector, useDispatch } from 'react-redux'
import { useTenant } from '../contexts/TenantContext'
import { Link, useNavigate, NavLink } from 'react-router-dom'
import {
  PersonOutline as UserIcon,
  LocalMallOutlined as CartIcon,
  FavoriteBorder as WishlistIcon,
  CompareArrows as CompareIcon,
  Menu as MenuIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import { logoutUser, clearState } from '@features/user/userSlice'
import { persistor } from '@app/store'
import Cookies from 'js-cookie'

// ==========================================
// COMPONENTE
// ==========================================

const CustomHeader = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const tenantContext = useTenant()
  const themeState = useSelector(state => state.theme)
  const userState = useSelector(state => state.user)
  const cartState = useSelector(state => state.cart)

  // Extraer configuraciones
  const tenantConfig = tenantContext?.themeConfig
  const tenantReady = tenantContext?.isReady
  const reduxConfig = themeState?.config
  const previewConfig = themeState?.previewConfig
  const previewMode = themeState?.previewMode

  // Determinar configuración activiva
  const activeConfig = useMemo(() => {
    if (previewMode && previewConfig) {
      return previewConfig
    }
    if (reduxConfig) {
      return reduxConfig
    }
    if (tenantConfig) {
      return tenantConfig
    }
    return {}
  }, [reduxConfig, tenantConfig, previewConfig, previewMode])

  const isThemePreviewRoute =
    typeof window !== 'undefined' && window.location.pathname === '/theme-preview'
  const isReady =
    tenantReady || !!reduxConfig || (previewMode && !!previewConfig) || isThemePreviewRoute

  // Datos de usuario
  const isAuthenticated = !!userState?.user
  const wishlistCount = userState?.wishlist?.length || 0
  const cartCount = cartState?.cartItems?.length || 0

  // ==========================================
  // CONFIGURACIÓN DEL HEADER - SUPER EXPLÍCITA
  // ==========================================

  const headerConfig = useMemo(() => {
    // Valores RAW de la configuración
    const headerRaw = activeConfig?.header || {}

    const config = {
      storeName: activeConfig?.general?.storeName,

      showCart: headerRaw.showCart !== false,
      showSearch: headerRaw.showSearch !== false,
      showLogo: headerRaw.showLogo !== false,
      showUserMenu: (headerRaw.showAccount ?? headerRaw.showUserMenu) !== false,
      showWishlist: headerRaw.showWishlist !== false,
      showCompare: headerRaw.showCompare === true,

      isSticky: headerRaw.sticky !== false,
      isTransparent: headerRaw.transparent === true,
      logoWidth: headerRaw.logoWidth ?? 150,
      height: headerRaw.height || 70,
    }

    return {
      ...config,
      storeName: config.storeName || 'Mi Tienda',
    }
  }, [activeConfig])

  // Colores
  const colors = useMemo(
    () => ({
      primary: activeConfig?.colors?.primary || theme.palette.primary.main,
      background:
        activeConfig?.colors?.surface ||
        activeConfig?.colors?.background ||
        theme.palette.background.default,
      text: activeConfig?.colors?.text || theme.palette.text.primary,
      icon:
        activeConfig?.colors?.mutedText ||
        activeConfig?.colors?.textSecondary ||
        activeConfig?.colors?.textMuted ||
        theme.palette.text.secondary,
      accion: activeConfig?.colors?.accent || theme.palette.primary.main,
    }),
    [activeConfig?.colors, theme.palette],
  )

  const typography = useMemo(
    () => ({
      fontFamily: activeConfig?.typography?.fontFamily || theme.typography.fontFamily,
      headingFont: activeConfig?.typography?.headingFont || theme.typography.fontFamily,
    }),
    [activeConfig?.typography, theme.typography],
  )

  // Logo
  const logoUrl = useMemo(() => {
    const logo = activeConfig?.header?.logo
    if (!logo) return null
    return typeof logo === 'string' ? logo : logo?.url || null
  }, [activeConfig?.header?.logo])

  const contrastColor = headerConfig.isTransparent ? '#ffffff' : colors.text
  const headerBackground = headerConfig.isTransparent
    ? 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)'
    : colors.background

  // ==========================================
  // LINKS - CON VISIBILIDAD FORZADA PARA DEBUG
  // ==========================================

  // 🔴 DEBUG: Crear links manualmente para ver si el problema es la config
  const quickLinks = useMemo(() => {
    const links = []

    // Wishlist
    if (headerConfig.showWishlist) {
      links.push({
        label: 'Favoritos',
        path: '/wishlist',
        icon: WishlistIcon,
        badge: isAuthenticated ? wishlistCount : null,
      })
    } else {
    }

    // Comparar
    if (headerConfig.showCompare) {
      links.push({
        label: 'Comparar',
        path: '/compare-product',
        icon: CompareIcon,
        badge: null,
      })
    }

    // Carrito
    if (headerConfig.showCart) {
      links.push({
        label: 'Carrito',
        path: '/cart',
        icon: CartIcon,
        badge: isAuthenticated ? cartCount : null,
      })
    }

    // Cuenta
    if (headerConfig.showUserMenu) {
      links.push({
        label: 'Cuenta',
        path: isAuthenticated ? '/profile' : '/login',
        icon: UserIcon,
        badge: null,
      })
    }

    return links
  }, [headerConfig, isAuthenticated, wishlistCount, cartCount])

  const displayLinks = quickLinks

  const menuLinks = [
    { label: 'Inicio', path: '/' },
    { label: 'Productos', path: '/product' },
    { label: 'Contacto', path: '/contact' },
  ]

  // ==========================================
  // HANDLERS
  // ==========================================

  const handleLogout = async () => {
    try {
      await dispatch(logoutUser()).unwrap()
      await persistor.purge()
      dispatch(clearState())
      navigate('/login')
    } catch (error) {
      dispatch(clearState())
      navigate('/login')
    }
  }

  const toggleDrawer = open => () => setDrawerOpen(open)

  // ==========================================
  // DRAWER
  // ==========================================

  const drawerContent = (
    <Box sx={{ width: 280, p: 2 }} role="presentation">
      <Typography variant="h6" fontWeight={800} sx={{ mb: 2, px: 2 }}>
        {headerConfig.storeName}
      </Typography>

      <List>
        {menuLinks.map(({ label, path }) => (
          <ListItem key={label} disablePadding>
            <ListItemButton component={Link} to={path} onClick={toggleDrawer(false)}>
              <ListItemText primary={label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Divider sx={{ my: 2 }} />

      <List>
        {displayLinks.map(({ label, path, icon: Icon, badge }) => (
          <ListItem key={label} disablePadding>
            <ListItemButton component={Link} to={path} onClick={toggleDrawer(false)}>
              <Box display="flex" alignItems="center" gap={2}>
                {badge > 0 ? (
                  <Badge badgeContent={badge} color="error">
                    <Icon sx={{ fontSize: 24 }} />
                  </Badge>
                ) : (
                  <Icon sx={{ fontSize: 24 }} />
                )}
                <Typography>{label}</Typography>
              </Box>
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {isAuthenticated && (
        <>
          <Divider sx={{ my: 2 }} />
          <List>
            <ListItem disablePadding>
              <ListItemButton
                onClick={() => {
                  handleLogout()
                  toggleDrawer(false)()
                }}
              >
                <ListItemText primary="Cerrar Sesión" sx={{ color: 'error.main' }} />
              </ListItemButton>
            </ListItem>
          </List>
        </>
      )}
    </Box>
  )

  // ==========================================
  // RENDER
  // ==========================================

  if (!isReady) {
    return (
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'grey.100' }}>
        <Toolbar sx={{ height: headerConfig.height, px: { xs: 2, md: 4 } }}>
          <Skeleton variant="text" width={120} height={40} />
          <Box sx={{ flexGrow: 1 }} />
          <Skeleton variant="circular" width={40} height={40} sx={{ mx: 1 }} />
          <Skeleton variant="circular" width={40} height={40} sx={{ mx: 1 }} />
        </Toolbar>
      </AppBar>
    )
  }

  return (
    <>
      <AppBar
        position={headerConfig.isSticky ? 'sticky' : 'static'}
        elevation={headerConfig.isTransparent ? 0 : 1}
        sx={{
          background: headerBackground,
          color: contrastColor,
          fontFamily: typography.fontFamily,
        }}
      >
        <Toolbar
          sx={{
            justifyContent: 'space-between',
            px: { xs: 2, md: 4 },
            height: headerConfig.height,
            minHeight: headerConfig.height,
          }}
        >
          {/* LOGO */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {headerConfig.showLogo && (
            <Box component={Link} to="/" sx={{ textDecoration: 'none', color: 'inherit' }}>
              {logoUrl ? (
                <Box
                  component="img"
                  src={logoUrl}
                  alt={headerConfig.storeName}
                  sx={{
                    width: `${headerConfig.logoWidth}px`,
                    maxHeight: `${headerConfig.height - 10}px`,
                    objectFit: 'contain',
                    filter: headerConfig.isTransparent ? 'brightness(0) invert(1)' : 'none',
                  }}
                />
              ) : (
                <Typography variant="h5" sx={{ fontWeight: 800, color: contrastColor }}>
                  {headerConfig.storeName}
                </Typography>
              )}
            </Box>
            )}

            {!isMobile &&
              menuLinks.map(link => (
                <Button
                  key={link.label}
                  component={NavLink}
                  to={link.path}
                  sx={{
                    color: contrastColor,
                    textTransform: 'none',
                    fontWeight: 600,
                    display: { xs: 'none', md: 'flex' },
                  }}
                >
                  {link.label}
                </Button>
              ))}
          </Box>

          {/* ACCIONES */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 0.5, md: 1 },
            }}
          >
            {displayLinks.map(({ label, path, icon: Icon, badge }) => (
              <Tooltip key={label} title={label}>
                <IconButton onClick={() => navigate(path)} sx={{ color: colors.accion }}>
                  {badge > 0 ? (
                    <Badge badgeContent={badge} color="error">
                      <Icon />
                    </Badge>
                  ) : (
                    <Icon />
                  )}
                </IconButton>
              </Tooltip>
            ))}

            {headerConfig.showSearch && (
              <Tooltip title="Buscar">
                <IconButton onClick={() => navigate('/product')} sx={{ color: colors.accion }}>
                  <SearchIcon />
                </IconButton>
              </Tooltip>
            )}

            {isAuthenticated && !isMobile && (
              <Button
                variant="outlined"
                onClick={handleLogout}
                sx={{
                  color: colors.icon,
                  borderColor: alpha(contrastColor, 0.5),
                  ml: 1,
                }}
              >
                Salir
              </Button>
            )}

            {isMobile && (
              <IconButton onClick={toggleDrawer(true)} sx={{ color: contrastColor }}>
                <MenuIcon />
              </IconButton>
            )}
          </Box>
        </Toolbar>
      </AppBar>

      <Drawer anchor="right" open={drawerOpen} onClose={toggleDrawer(false)}>
        {drawerContent}
      </Drawer>
    </>
  )
}

export default React.memo(CustomHeader)
