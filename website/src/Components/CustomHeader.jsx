// 📁 src/Components/CustomHeader.jsx
import React, { useMemo } from 'react'
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
import { getThemeColors } from '@utils/themeRuntime'

// ==========================================
// HELPERS DE COLOR
// ==========================================

const normalizeAlpha = value => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0.72
  return Math.min(1, Math.max(0, number))
}

const makeColorTranslucent = (value, opacity = 0.72) => {
  const alphaValue = normalizeAlpha(opacity)
  const raw = String(value || '').trim()

  if (!raw) {
    return `rgba(255, 255, 255, ${alphaValue})`
  }

  if (raw.startsWith('rgba(')) {
    return raw.replace(/rgba\(([^)]+),\s*[\d.]+\)/, `rgba($1, ${alphaValue})`)
  }

  if (raw.startsWith('rgb(')) {
    return raw.replace('rgb(', 'rgba(').replace(')', `, ${alphaValue})`)
  }

  if (raw.startsWith('#')) {
    const cleanHex = raw.replace('#', '')

    const normalizedHex =
      cleanHex.length === 3
        ? cleanHex
            .split('')
            .map(char => char + char)
            .join('')
        : cleanHex

    if (/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
      const red = parseInt(normalizedHex.slice(0, 2), 16)
      const green = parseInt(normalizedHex.slice(2, 4), 16)
      const blue = parseInt(normalizedHex.slice(4, 6), 16)

      return `rgba(${red}, ${green}, ${blue}, ${alphaValue})`
    }
  }

  return raw
}

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
    typeof window !== 'undefined' &&
    window.location.pathname === '/theme-preview'
  const isReady =
    tenantReady ||
    !!reduxConfig ||
    (previewMode && !!previewConfig) ||
    isThemePreviewRoute

  const themeColors = useMemo(
    () => getThemeColors(activeConfig),
    [activeConfig],
  )

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
      primary: themeColors.primary,
      background: themeColors.headerBackground,
      text: themeColors.headerText,
      icon: themeColors.headerIcon,
      link: themeColors.headerLink,
    }),
    [themeColors],
  )

  const typography = useMemo(
    () => ({
      fontFamily:
        activeConfig?.typography?.fontFamily || theme.typography.fontFamily,
      headingFont:
        activeConfig?.typography?.headingFont || theme.typography.fontFamily,
    }),
    [activeConfig?.typography, theme.typography],
  )

  // Logo
  const logoUrl = useMemo(() => {
    const logo = activeConfig?.header?.logo
    if (!logo) return null
    return typeof logo === 'string' ? logo : logo?.url || null
  }, [activeConfig?.header?.logo])

  const contrastColor = colors.text

  const configuredHeaderBackground =
    colors.background || theme.palette.background.paper

  const headerBackground = headerConfig.isTransparent
    ? `linear-gradient(
        to bottom,
        ${makeColorTranslucent(configuredHeaderBackground, 0.78)} 0%,
        ${makeColorTranslucent(configuredHeaderBackground, 0.52)} 100%
      )`
    : configuredHeaderBackground

  const headerBackdropFilter = headerConfig.isTransparent
    ? 'blur(14px) saturate(160%)'
    : 'none'

  const headerBoxShadow = headerConfig.isTransparent
    ? '0 8px 28px rgba(15, 23, 42, 0.08)'
    : undefined

  const headerBorderBottom = headerConfig.isTransparent
    ? `1px solid ${makeColorTranslucent(contrastColor, 0.12)}`
    : 'none'

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
    } catch {
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
            <ListItemButton
              component={Link}
              to={path}
              onClick={toggleDrawer(false)}
            >
              <ListItemText primary={label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Divider sx={{ my: 2 }} />

      <List>
        {displayLinks.map(({ label, path, icon: Icon, badge }) => (
          <ListItem key={label} disablePadding>
            <ListItemButton
              component={Link}
              to={path}
              onClick={toggleDrawer(false)}
            >
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
                <ListItemText
                  primary="Cerrar Sesión"
                  sx={{ color: 'error.main' }}
                />
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
          backdropFilter: headerBackdropFilter,
          WebkitBackdropFilter: headerBackdropFilter,
          boxShadow: headerBoxShadow,
          borderBottom: headerBorderBottom,
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
              <Box
                component={Link}
                to="/"
                sx={{ textDecoration: 'none', color: 'inherit' }}
              >
                {logoUrl ? (
                  <Box
                    component="img"
                    src={logoUrl}
                    alt={headerConfig.storeName}
                    sx={{
                      width: `${headerConfig.logoWidth}px`,
                      maxHeight: `${headerConfig.height - 10}px`,
                      objectFit: 'contain',
                      filter: 'none',
                    }}
                  />
                ) : (
                  <Typography
                    variant="h5"
                    sx={{
                      color: contrastColor,
                      fontFamily: typography.headingFont,
                    }}
                  >
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
                  variant="text"
                  color="inherit"
                  sx={{
                    color: colors.link,
                    textTransform: 'none',
                    fontFamily: typography.fontFamily,
                    display: { xs: 'none', md: 'flex' },
                    '&.active': {
                      color: colors.text,
                    },
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
                <IconButton
                  onClick={() => navigate(path)}
                  sx={{ color: colors.icon }}
                >
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
                <IconButton
                  onClick={() => navigate('/product')}
                  sx={{ color: colors.icon }}
                >
                  <SearchIcon />
                </IconButton>
              </Tooltip>
            )}

            {isAuthenticated && !isMobile && (
              <Button
                variant="outlined"
                onClick={handleLogout}
                sx={{
                  color: colors.link,
                  borderColor: alpha(colors.link, 0.5),
                  ml: 1,
                }}
              >
                Salir
              </Button>
            )}

            {isMobile && (
              <IconButton
                onClick={toggleDrawer(true)}
                sx={{ color: colors.icon }}
              >
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
