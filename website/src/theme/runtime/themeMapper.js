import { createTheme, responsiveFontSizes } from '@mui/material/styles'

// ==========================================
// CACHE
// ==========================================

const themeCache = new Map()
const loadedFonts = new Set()

// ==========================================
// FONT LOADER
// ==========================================

const loadGoogleFont = font => {
  if (!font) return

  const fontName = font.replace(/['"]/g, '').split(',')[0].trim()
  const fontId = `font-${fontName.replace(/\s+/g, '-')}`

  if (loadedFonts.has(fontId) || document.getElementById(fontId)) return

  const link = document.createElement('link')
  link.id = fontId
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@300;400;500;600;700&display=swap`

  document.head.appendChild(link)
  loadedFonts.add(fontId)
}

const loadFonts = typography => {
  loadGoogleFont(typography?.fontFamily?.body)
  loadGoogleFont(typography?.fontFamily?.heading)
  loadGoogleFont(typography?.fontFamily?.secondary)
}

// ==========================================
// HELPERS
// ==========================================

const sanitizeFontName = value => {
  const font = String(value || '')
    .replace(/['"]/g, '')
    .split(',')[0]
    .trim()

  if (!font) return null

  // Evita valores raros o inyectados desde configuración tenant.
  const safeFont = font.replace(/[^a-zA-Z0-9\s-]/g, '').trim()

  return safeFont || null
}

const extractPrimaryFont = fontString => {
  return sanitizeFontName(fontString)
}

const quoteFont = font => {
  if (!font) return null

  // Las familias genéricas CSS no van entre comillas.
  const genericFamilies = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
  ])

  if (genericFamilies.has(font.toLowerCase())) {
    return font
  }

  return `"${font}"`
}

const buildFontStack = font => {
  const base = sanitizeFontName(font) || 'Inter'

  const stack = [
    base,
    'Roboto',
    'Helvetica',
    'Arial',
    'sans-serif',
  ]

  const uniqueStack = [...new Set(stack.filter(Boolean))]

  return uniqueStack.map(quoteFont).join(', ')
}

const parseBorderRadius = value => {
  if (value === undefined || value === null || value === '') return 8
  if (typeof value === 'number') return value
  if (value.includes('rem')) return parseFloat(value) * 16
  if (value.includes('px')) return parseInt(value)
  return parseInt(value) || 8
}

const createElevationShadow = elevation => {
  const level = Number(elevation ?? 2)
  if (!Number.isFinite(level) || level <= 0) return 'none'

  const y = Math.min(level * 3, 24)
  const blur = Math.min(level * 8, 48)
  const alpha = Math.min(0.06 + level * 0.015, 0.18)

  return `0 ${y}px ${blur}px rgba(15, 23, 42, ${alpha})`
}

const isLightBackground = color => {
  if (!color || !color.startsWith('#')) return true

  const hex = color.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16) || 0
  const g = parseInt(hex.substr(2, 2), 16) || 0
  const b = parseInt(hex.substr(4, 2), 16) || 0

  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 128
}

const getContrastText = bg => (isLightBackground(bg) ? '#000000' : '#ffffff')

const createModularScale = (base = 16, ratio = 1.25) => {
  return step => `${(base * Math.pow(ratio, step)) / 16}rem`
}

// ==========================================
// DEFAULTS
// ==========================================

const DEFAULTS = {
  colors: {
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#ffffff',
    surface: '#f5f5f5',
    headerBackground: '#ffffff',
    headerText: '#1a1a1a',
    headerLink: '#1976d2',
    headerIcon: '#666666',
    cardBackground: '#f5f5f5',
    cardText: '#1a1a1a',
    cardMutedText: '#666666',
    cardBorder: '#e0e0e0',
    cardPrice: '#1976d2',
    text: '#1a1a1a',
    mutedText: '#666666',
    textMuted: '#666666',
    border: '#e0e0e0',
    actionPrimary: '#1976d2',
    actionPrimaryText: '#ffffff',
    actionSecondary: '#dc004e',
    actionSecondaryText: '#ffffff',
    link: '#1976d2',
    price: '#1976d2',
    salePrice: '#d32f2f',
    badgeBackground: '#dc004e',
    badgeText: '#ffffff',
    error: '#d32f2f',
    warning: '#ed6c02',
    success: '#2e7d32',
    accent: '#ff9800',
  },

  typography: {
    baseSize: 16,
    scale: 1.25,
    lineHeight: 1.6,
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
}

// ==========================================
// NORMALIZADOR (ADAPTADO A TU BACKEND)
// ==========================================

const normalizeTheme = (dbTheme = {}) => {
  const t = dbTheme.typography || {}
  const colors = dbTheme.colors || {}
  const spacing = dbTheme.spacing || {}
  const layout = dbTheme.layout || {}
  const buttons = dbTheme.buttons || {}

  const bodyFont = extractPrimaryFont(t.fontFamily)
  const headingFont = extractPrimaryFont(t.headingFont)
  const secondaryFont = extractPrimaryFont(t.secondaryFont)

  return {
    colors: {
      ...DEFAULTS.colors,
      ...colors,
      headerBackground:
        colors.headerBackground || DEFAULTS.colors.headerBackground,
      headerText: colors.headerText || DEFAULTS.colors.headerText,
      headerLink: colors.headerLink || DEFAULTS.colors.headerLink,
      headerIcon: colors.headerIcon || DEFAULTS.colors.headerIcon,
      cardBackground: colors.cardBackground || DEFAULTS.colors.cardBackground,
      cardText: colors.cardText || DEFAULTS.colors.cardText,
      cardMutedText: colors.cardMutedText || DEFAULTS.colors.cardMutedText,
      cardBorder: colors.cardBorder || DEFAULTS.colors.cardBorder,
      cardPrice: colors.cardPrice || DEFAULTS.colors.cardPrice,
      textMuted:
        colors.mutedText ||
        colors.textMuted ||
        colors.textSecondary ||
        DEFAULTS.colors.textMuted,
      actionPrimary: colors.actionPrimary || DEFAULTS.colors.actionPrimary,
      actionPrimaryText:
        colors.actionPrimaryText || DEFAULTS.colors.actionPrimaryText,
      actionSecondary:
        colors.actionSecondary || DEFAULTS.colors.actionSecondary,
      actionSecondaryText:
        colors.actionSecondaryText || DEFAULTS.colors.actionSecondaryText,
      link: colors.link || DEFAULTS.colors.link,
      price: colors.price || DEFAULTS.colors.price,
      salePrice: colors.salePrice || DEFAULTS.colors.salePrice,
      badgeBackground:
        colors.badgeBackground || DEFAULTS.colors.badgeBackground,
      badgeText: colors.badgeText || DEFAULTS.colors.badgeText,
    },

    typography: {
      fontFamily: {
        body: bodyFont || 'Inter',
        heading: headingFont || bodyFont || 'Inter',
        secondary: secondaryFont || bodyFont || 'Inter',
      },

      baseSize: t.baseSize ?? DEFAULTS.typography.baseSize,
      scale: t.scale ?? DEFAULTS.typography.scale,
      lineHeight: t.lineHeight ?? DEFAULTS.typography.lineHeight,

      fontWeight: {
        ...DEFAULTS.typography.fontWeight,
        ...(t.fontWeight || {}),
      },

      headings: t.headings || {},
      secondary: t.secondary || {},
    },

    spacing: {
      section: 64,
      container: 24,
      radius: 8,
      cardPadding: 16,
      ...spacing,
    },
    layout: {
      maxWidth: 1200,
      containerPadding: layout.containerPadding ?? spacing.container ?? 24,
      ...layout,
    },
    buttons: {
      radius: 8,
      uppercase: false,
      elevation: 2,
      size: 'medium',
      variant: 'contained',
      ...buttons,
    },
    borderRadius: {
      md: spacing.radius ?? layout.borderRadius ?? dbTheme.borderRadius?.md,
      ...(dbTheme.borderRadius || {}),
    },
    shadows: dbTheme.shadows || {},

    header: dbTheme.header || {},
    productCard: {
      ...(dbTheme.productCard || {}),
      ...(dbTheme.products || {}),
    },

    mode: dbTheme.mode || 'light',
  }
}

// ==========================================
// FACTORY
// ==========================================

export const createStoreTheme = (dbTheme = {}, tenantId = 'default') => {
  const cacheKey = `${tenantId}:${JSON.stringify(dbTheme)}`

  if (themeCache.has(cacheKey)) {
    return themeCache.get(cacheKey)
  }

  const theme = normalizeTheme(dbTheme)

  loadFonts(theme.typography)

  const modularScale = createModularScale(
    theme.typography.baseSize,
    theme.typography.scale,
  )

  const getHeading = (key, fallbackStep) => {
    const h = theme.typography.headings?.[key]

    return {
      fontFamily: buildFontStack(theme.typography.fontFamily.heading),
      fontSize: h?.size ? `${h.size / 16}rem` : modularScale(fallbackStep),
      fontWeight: h?.weight ?? theme.typography.fontWeight.bold,
      lineHeight: h?.lineHeight ?? 1.3,
      letterSpacing: h?.letterSpacing ?? 0,
      textTransform: h?.transform || 'none',
    }
  }

  const muiTheme = createTheme({
    storeTheme: theme,
    palette: {
      mode: theme.mode,
      primary: {
        main: theme.colors.primary,
        contrastText: getContrastText(theme.colors.primary),
      },
      secondary: {
        main: theme.colors.secondary,
        contrastText: getContrastText(theme.colors.secondary),
      },
      brand: {
        main: theme.colors.primary,
        contrastText: getContrastText(theme.colors.primary),
      },
      accent: {
        main: theme.colors.accent,
        contrastText: getContrastText(theme.colors.accent),
      },
      ctaPrimary: {
        main: theme.colors.actionPrimary,
        dark: theme.colors.actionPrimary,
        contrastText:
          theme.colors.actionPrimaryText ||
          getContrastText(theme.colors.actionPrimary),
      },
      ctaSecondary: {
        main: theme.colors.actionSecondary,
        dark: theme.colors.actionSecondary,
        contrastText:
          theme.colors.actionSecondaryText ||
          getContrastText(theme.colors.actionSecondary),
      },
      commercePrice: {
        main: theme.colors.price,
        contrastText: getContrastText(theme.colors.price),
      },
      commerceSalePrice: {
        main: theme.colors.salePrice,
        contrastText: getContrastText(theme.colors.salePrice),
      },
      header: {
        background: theme.colors.headerBackground,
        text: theme.colors.headerText,
        link: theme.colors.headerLink,
        icon: theme.colors.headerIcon,
      },
      card: {
        background: theme.colors.cardBackground,
        text: theme.colors.cardText,
        mutedText: theme.colors.cardMutedText,
        border: theme.colors.cardBorder,
        price: theme.colors.cardPrice,
      },
      error: { main: theme.colors.error },
      warning: { main: theme.colors.warning },
      success: { main: theme.colors.success },
      info: { main: theme.colors.accent },

      background: {
        default: theme.colors.background,
        paper: theme.colors.surface,
      },

      text: {
        primary: theme.colors.text,
        secondary: theme.colors.textMuted,
      },

      divider: theme.colors.border,
    },

    typography: {
      fontFamily: buildFontStack(theme.typography.fontFamily.body),

      h1: getHeading('h1', 5),
      h2: getHeading('h2', 4),
      h3: getHeading('h3', 3),
      h4: getHeading('h4', 2),
      h5: getHeading('h5', 1),
      h6: getHeading('h6', 0),

      body1: {
        fontSize: `${theme.typography.baseSize / 16}rem`,
        lineHeight: theme.typography.lineHeight,
      },

      body2: {
        fontFamily: buildFontStack(theme.typography.fontFamily.secondary),
        fontSize: `${(theme.typography.secondary?.size ?? 14) / 16}rem`,
        fontWeight: theme.typography.secondary?.weight ?? 400,
        lineHeight: theme.typography.secondary?.lineHeight ?? 1.6,
        letterSpacing: theme.typography.secondary?.letterSpacing ?? 0,
      },

      button: {
        fontFamily: buildFontStack(theme.typography.fontFamily.body),
        fontWeight: theme.typography.fontWeight.medium,
        textTransform: 'none',
      },
    },

    shape: {
      borderRadius: parseBorderRadius(
        theme.spacing.radius ?? theme.borderRadius?.md,
      ),
    },

    spacing: factor => (theme.spacing.unit ?? theme.spacing.base ?? 8) * factor,

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            fontFamily: buildFontStack(theme.typography.fontFamily.body),
            fontSize: `${theme.typography.baseSize}px`,
            lineHeight: theme.typography.lineHeight,
          },
          button: {
            fontFamily: buildFontStack(theme.typography.fontFamily.body),
          },
          input: {
            fontFamily: buildFontStack(theme.typography.fontFamily.body),
          },
        },
      },
      MuiButton: {
        defaultProps: {
          variant: theme.buttons.variant ?? 'contained',
          size: theme.buttons.size ?? 'medium',
        },
        styleOverrides: {
          root: ({ ownerState }) => {
            const isPrimaryAction =
              !ownerState?.color || ownerState.color === 'primary'
            const isSecondaryAction = ownerState?.color === 'secondary'

            return {
              borderRadius: `${theme.buttons.radius ?? theme.spacing.radius ?? 8}px`,
              boxShadow: createElevationShadow(theme.buttons.elevation),
              textTransform: theme.buttons.uppercase ? 'uppercase' : 'none',
              ...(ownerState?.variant === 'contained' && isPrimaryAction
                ? {
                    backgroundColor: theme.colors.actionPrimary,
                    color:
                      theme.colors.actionPrimaryText ||
                      getContrastText(theme.colors.actionPrimary),
                    '&:hover': {
                      backgroundColor: theme.colors.actionPrimary,
                      filter: 'brightness(0.92)',
                    },
                  }
                : {}),
              ...(ownerState?.variant === 'contained' && isSecondaryAction
                ? {
                    backgroundColor: theme.colors.actionSecondary,
                    color:
                      theme.colors.actionSecondaryText ||
                      getContrastText(theme.colors.actionSecondary),
                    '&:hover': {
                      backgroundColor: theme.colors.actionSecondary,
                      filter: 'brightness(0.92)',
                    },
                  }
                : {}),
              ...(ownerState?.variant === 'outlined' && isPrimaryAction
                ? {
                    borderColor: theme.colors.actionPrimary,
                    color: theme.colors.actionPrimary,
                  }
                : {}),
              ...(ownerState?.variant === 'outlined' && isSecondaryAction
                ? {
                    borderColor: theme.colors.actionSecondary,
                    color: theme.colors.actionSecondary,
                  }
                : {}),
              ...(ownerState?.variant === 'text' && isPrimaryAction
                ? {
                    color: theme.colors.actionPrimary,
                  }
                : {}),
              ...(ownerState?.variant === 'text' && isSecondaryAction
                ? {
                    color: theme.colors.actionSecondary,
                  }
                : {}),
            }
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: `${theme.spacing.radius ?? theme.layout.borderRadius ?? 8}px`,
            boxShadow: createElevationShadow(theme.layout.shadowIntensity),
            backgroundColor: theme.colors.cardBackground,
            border: `1px solid ${theme.colors.cardBorder}`,
            color: theme.colors.cardText,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: {
            borderRadius: `${theme.spacing.radius ?? theme.layout.borderRadius ?? 8}px`,
          },
        },
      },
    },
  })

  const finalTheme = responsiveFontSizes(muiTheme)

  themeCache.set(cacheKey, finalTheme)

  return finalTheme
}

export default createStoreTheme
