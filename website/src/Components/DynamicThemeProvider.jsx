// 📁 src/Components/DynamicThemeProvider.jsx
import React, { useMemo, useEffect, useRef, useCallback } from 'react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { useSelector } from 'react-redux'
import { useTenant } from '../contexts/TenantContext'

// ==========================================
// CONSTANTES
// ==========================================

const DEFAULT_THEME = {
  colors: {
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#ffffff',
    surface: '#f5f5f5',
    text: '#212121',
    mutedText: '#757575',
    border: '#e0e0e0',
    accent: '#ff9800',
    actionPrimary: '#1976d2',
    actionPrimaryText: '#ffffff',
    actionSecondary: '#dc004e',
    actionSecondaryText: '#ffffff',
    link: '#1976d2',
    price: '#1976d2',
    salePrice: '#f44336',
    badgeBackground: '#dc004e',
    badgeText: '#ffffff',
    error: '#f44336',
    warning: '#ff9800',
    info: '#2196f3',
    success: '#4caf50',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    headingFont: '"Inter", sans-serif',
    baseSize: 16,
    lineHeight: 1.5,
    letterSpacing: 0,
    scale: 1.2,
  },
  layout: {
    maxWidth: 'lg',
    paddingX: 24,
    borderRadius: 8,
    spacing: 8,
    shadows: true,
  },
  buttons: {
    radius: 8,
    uppercase: false,
    elevation: 2,
    size: 'medium',
    variant: 'contained',
  },
  animations: {
    preset: 'smooth',
    pageTransitions: 'fade',
    respectPrefersReducedMotion: true,
  },
}

// ==========================================
// UTILIDADES
// ==========================================

const sanitizeColor = (color, fallback) => {
  if (!color || typeof color !== 'string') return fallback
  const validPattern = /^(#[0-9A-Fa-f]{3,8}|rgb\(|rgba\(|hsl\(|hsla\(|[\w-]+)$/
  return validPattern.test(color.trim()) ? color.trim() : fallback
}

const parseNumber = (value, min, max, defaultValue) => {
  const parsed = parseFloat(value)
  if (isNaN(parsed)) return defaultValue
  return Math.max(min, Math.min(max, parsed))
}

const buildFontFamily = config => {
  if (!config?.fontFamily) return DEFAULT_THEME.typography.fontFamily

  const fonts = config.fontFamily
    .split(',')
    .map(f => f.trim())
    .filter(f => f)

  if (fonts.length === 0) return DEFAULT_THEME.typography.fontFamily

  // Asegurar que cada fuente tenga comillas si tiene espacios
  const formatted = fonts.map(f =>
    f.includes(' ') && !f.startsWith('"') ? `"${f}"` : f,
  )

  return formatted.join(', ')
}

const resolveSemanticColors = colors => ({
  ...colors,
  textSecondary:
    colors.mutedText ||
    colors.textSecondary ||
    colors.textMuted ||
    DEFAULT_THEME.colors.mutedText,
  actionPrimary: colors.actionPrimary || DEFAULT_THEME.colors.actionPrimary,
  actionPrimaryText: colors.actionPrimaryText || '#ffffff',
  actionSecondary:
    colors.actionSecondary || DEFAULT_THEME.colors.actionSecondary,
  actionSecondaryText: colors.actionSecondaryText || '#ffffff',
  link: colors.link || DEFAULT_THEME.colors.link,
  price: colors.price || DEFAULT_THEME.colors.price,
  salePrice: colors.salePrice || DEFAULT_THEME.colors.salePrice,
  badgeBackground:
    colors.badgeBackground || DEFAULT_THEME.colors.badgeBackground,
  badgeText: colors.badgeText || '#ffffff',
})

// ==========================================
// COMPONENTE
// ==========================================

const DynamicThemeProvider = ({ children }) => {
  // ==========================================
  // HOOKS
  // ==========================================

  const {
    themeConfig: tenantConfig,
    isReady: tenantReady,
    isLoading: tenantLoading,
  } = useTenant()

  const reduxState = useSelector(state => state.theme) || {}
  const {
    config: reduxConfig,
    previewMode,
    previewConfig,
    isLoading: reduxLoading,
  } = reduxState

  const styleTagRef = useRef(null)
  const prevConfigRef = useRef(null)

  // ==========================================
  // CONFIGURACIÓN ACTIVA (UNIFICADA)
  // ==========================================

  const activeConfig = useMemo(() => {
    // Cadena de prioridad: Preview > Redux > Tenant > Default
    const source =
      previewMode && previewConfig
        ? previewConfig
        : reduxConfig || tenantConfig || {}

    // Merge profundo con defaults
    return {
      colors: resolveSemanticColors({
        ...DEFAULT_THEME.colors,
        ...source.colors,
      }),
      typography: { ...DEFAULT_THEME.typography, ...source.typography },
      layout: { ...DEFAULT_THEME.layout, ...source.layout },
      buttons: { ...DEFAULT_THEME.buttons, ...source.buttons },
      animations: { ...DEFAULT_THEME.animations, ...source.animations },
      storeName: source.storeName || DEFAULT_THEME.storeName,
      favicon: source.favicon,
      customCSS: source.customCSS,
      darkMode: source.darkMode || false,
      _source: previewMode
        ? 'preview'
        : reduxConfig
          ? 'redux'
          : tenantConfig
            ? 'tenant'
            : 'default',
      _timestamp: Date.now(),
    }
  }, [previewMode, previewConfig, reduxConfig, tenantConfig])

  // ==========================================
  // TEMA MUI
  // ==========================================

  const theme = useMemo(() => {
    const { colors, typography, layout, buttons, darkMode } = activeConfig

    const palette = {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: sanitizeColor(colors.primary, DEFAULT_THEME.colors.primary),
        contrastText: '#ffffff',
      },
      secondary: {
        main: sanitizeColor(colors.secondary, DEFAULT_THEME.colors.secondary),
        contrastText: '#ffffff',
      },
      brand: {
        main: sanitizeColor(colors.primary, DEFAULT_THEME.colors.primary),
        contrastText: '#ffffff',
      },
      ctaPrimary: {
        main: sanitizeColor(
          colors.actionPrimary,
          DEFAULT_THEME.colors.actionPrimary,
        ),
        contrastText: sanitizeColor(
          colors.actionPrimaryText,
          DEFAULT_THEME.colors.actionPrimaryText,
        ),
      },
      ctaSecondary: {
        main: sanitizeColor(
          colors.actionSecondary,
          DEFAULT_THEME.colors.actionSecondary,
        ),
        contrastText: sanitizeColor(
          colors.actionSecondaryText,
          DEFAULT_THEME.colors.actionSecondaryText,
        ),
      },
      error: { main: sanitizeColor(colors.error, DEFAULT_THEME.colors.error) },
      warning: {
        main: sanitizeColor(colors.warning, DEFAULT_THEME.colors.warning),
      },
      info: { main: sanitizeColor(colors.info, DEFAULT_THEME.colors.info) },
      success: {
        main: sanitizeColor(colors.success, DEFAULT_THEME.colors.success),
      },
      background: {
        default: darkMode
          ? '#121212'
          : sanitizeColor(colors.background, DEFAULT_THEME.colors.background),
        paper: darkMode
          ? '#1e1e1e'
          : sanitizeColor(colors.surface, DEFAULT_THEME.colors.surface),
      },
      text: {
        primary: darkMode
          ? '#ffffff'
          : sanitizeColor(colors.text, DEFAULT_THEME.colors.text),
        secondary: darkMode
          ? '#b0b0b0'
          : sanitizeColor(colors.textSecondary, DEFAULT_THEME.colors.mutedText),
      },
      divider: sanitizeColor(colors.border, DEFAULT_THEME.colors.border),
    }

    const fontFamily = buildFontFamily(typography)
    const baseSize = parseNumber(
      typography.baseSize,
      12,
      24,
      DEFAULT_THEME.typography.baseSize,
    )
    const borderRadius = parseNumber(
      layout.borderRadius,
      0,
      32,
      DEFAULT_THEME.layout.borderRadius,
    )

    return createTheme({
      palette,
      typography: {
        fontFamily,
        fontSize: baseSize,
        h1: {
          fontFamily: typography.headingFont || fontFamily,
          fontWeight: 700,
          fontSize: `${baseSize * 2.5}px`,
        },
        h2: {
          fontFamily: typography.headingFont || fontFamily,
          fontWeight: 700,
          fontSize: `${baseSize * 2}px`,
        },
        h3: {
          fontFamily: typography.headingFont || fontFamily,
          fontWeight: 600,
          fontSize: `${baseSize * 1.75}px`,
        },
        h4: {
          fontFamily: typography.headingFont || fontFamily,
          fontWeight: 600,
          fontSize: `${baseSize * 1.5}px`,
        },
        h5: {
          fontFamily: typography.headingFont || fontFamily,
          fontWeight: 500,
          fontSize: `${baseSize * 1.25}px`,
        },
        h6: {
          fontFamily: typography.headingFont || fontFamily,
          fontWeight: 500,
          fontSize: `${baseSize * 1.1}px`,
        },
        body1: {
          fontSize: `${baseSize}px`,
          lineHeight: typography.lineHeight || 1.5,
        },
        body2: {
          fontSize: `${baseSize * 0.875}px`,
          lineHeight: typography.lineHeight || 1.5,
        },
        button: { textTransform: 'none', fontWeight: 600 },
      },
      shape: { borderRadius },
      spacing: factor => {
        const unit = parseNumber(
          layout.spacing,
          4,
          32,
          DEFAULT_THEME.layout.spacing,
        )
        return unit * factor
      },
      breakpoints: {
        values: {
          xs: 0,
          sm: 600,
          md: 900,
          lg: layout.maxWidth === 'xl' ? 1536 : 1200,
          xl: 1536,
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              scrollbarWidth: 'thin',
              '&::-webkit-scrollbar': {
                width: '8px',
                height: '8px',
              },
              '&::-webkit-scrollbar-track': {
                background: darkMode ? '#1e1e1e' : '#f1f1f1',
              },
              '&::-webkit-scrollbar-thumb': {
                background: palette.brand.main,
                borderRadius: '4px',
              },
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: parseNumber(
                buttons.radius,
                0,
                50,
                DEFAULT_THEME.buttons.radius,
              ),
              textTransform: buttons.uppercase ? 'uppercase' : 'none',
              fontWeight: 600,
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              borderRadius: borderRadius * 1.5,
              boxShadow:
                layout.shadows !== false
                  ? darkMode
                    ? '0 4px 12px rgba(0,0,0,0.5)'
                    : '0 4px 12px rgba(0,0,0,0.1)'
                  : 'none',
            },
          },
        },
        MuiAppBar: {
          styleOverrides: {
            root: {
              backgroundImage: 'none',
            },
          },
        },
      },
    })
  }, [activeConfig])

  // ==========================================
  // EFECTOS
  // ==========================================

  // Actualizar DOM (título, favicon, meta)
  const updateDOM = useCallback(() => {
    const { storeName, favicon, colors } = activeConfig

    // Título
    if (storeName && document.title !== storeName) {
      document.title = storeName
    }

    // Favicon
    const faviconUrl =
      favicon?.url || (typeof favicon === 'string' ? favicon : null)
    if (faviconUrl) {
      let link = document.querySelector("link[rel~='icon']")
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      if (link.href !== faviconUrl) {
        link.type = 'image/x-icon'
        link.href = faviconUrl
      }
    }

    // Theme color para móvil
    let metaThemeColor = document.querySelector("meta[name='theme-color']")
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta')
      metaThemeColor.name = 'theme-color'
      document.head.appendChild(metaThemeColor)
    }
    metaThemeColor.content = colors?.primary || DEFAULT_THEME.colors.primary

    prevConfigRef.current = activeConfig
  }, [activeConfig])

  // Dentro de DynamicThemeProvider, junto a los otros useEffects:

  useEffect(() => {
    const { typography } = activeConfig
    if (!typography?.fontFamily) return

    const fontName = typography.fontFamily.split(',')[0].replace(/"/g, '')
    const linkId = `google-font-${fontName.replace(/\s+/g, '-').toLowerCase()}`

    if (!document.getElementById(linkId)) {
      const link = document.createElement('link')
      link.id = linkId
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@300;400;500;700&display=swap`
      document.head.appendChild(link)
    }
  }, [activeConfig?.typography?.fontFamily])

  useEffect(() => {
    if (prevConfigRef.current === activeConfig) return
    updateDOM()
  }, [activeConfig, updateDOM])

  // CSS personalizado
  useEffect(() => {
    const { customCSS } = activeConfig

    if (!customCSS && styleTagRef.current) {
      styleTagRef.current.remove()
      styleTagRef.current = null
      return
    }

    if (!customCSS) return

    if (!styleTagRef.current) {
      styleTagRef.current = document.createElement('style')
      styleTagRef.current.id = 'dynamic-custom-css'
      document.head.appendChild(styleTagRef.current)
    }

    styleTagRef.current.textContent = customCSS

    return () => {
      if (styleTagRef.current) {
        styleTagRef.current.remove()
        styleTagRef.current = null
      }
    }
  }, [activeConfig?.customCSS])

  // ==========================================
  // RENDER
  // ==========================================

  const isLoading = tenantLoading || reduxLoading
  const hasConfig = tenantReady || !!reduxConfig

  // Skeleton mientras carga inicial
  if (isLoading && !hasConfig) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          bgcolor: 'grey.100',
        }}
      >
        <CircularProgress size={60} />
      </Box>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}

// Importar Box y CircularProgress para el loader
import { Box, CircularProgress } from '@mui/material'

export default React.memo(DynamicThemeProvider)
