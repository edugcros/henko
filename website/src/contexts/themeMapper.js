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

const extractPrimaryFont = fontString => {
  if (!fontString) return null
  return fontString.replace(/['"]/g, '').split(',')[0].trim()
}

const buildFontStack = font => {
  const base = font || 'Inter'
  return `"${base}", "Roboto", "Helvetica", "Arial", sans-serif`
}

const parseBorderRadius = value => {
  if (!value) return 8
  if (typeof value === 'number') return value
  if (value.includes('rem')) return parseFloat(value) * 16
  if (value.includes('px')) return parseInt(value)
  return parseInt(value) || 8
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
    primary: '#3b82f6',
    secondary: '#8b5cf6',
    background: '#ffffff',
    surface: '#f5f5f5',
    text: '#212121',
    textMuted: '#757575',
    error: '#ef4444',
    warning: '#f59e0b',
    success: '#10b981',
    accent: '#2196f3',
    border: '#e0e0e0',
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

  const bodyFont = extractPrimaryFont(t.fontFamily)
  const headingFont = extractPrimaryFont(t.headingFont)
  const secondaryFont = extractPrimaryFont(t.secondaryFont)

  return {
    colors: { ...DEFAULTS.colors, ...(dbTheme.colors || {}) },

    typography: {
      fontFamily: {
        body: bodyFont || 'Inter',
        heading: headingFont || bodyFont || 'Inter',
        secondary: secondaryFont || bodyFont || 'Inter',
      },

      baseSize: t.baseSize || DEFAULTS.typography.baseSize,
      scale: t.scale || DEFAULTS.typography.scale,
      lineHeight: t.lineHeight || DEFAULTS.typography.lineHeight,

      fontWeight: {
        ...DEFAULTS.typography.fontWeight,
        ...(t.fontWeight || {}),
      },

      headings: t.headings || {},
      secondary: t.secondary || {},
    },

    borderRadius: dbTheme.borderRadius || {},
    shadows: dbTheme.shadows || {},

    header: dbTheme.header || {},
    buttons: dbTheme.buttons || {},
    productCard: dbTheme.productCard || {},

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

  const modularScale = createModularScale(theme.typography.baseSize, theme.typography.scale)

  const getHeading = (key, fallbackStep) => {
    const h = theme.typography.headings?.[key]

    return {
      fontFamily: buildFontStack(theme.typography.fontFamily.heading),
      fontSize: h?.size ? `${h.size / 16}rem` : modularScale(fallbackStep),
      fontWeight: h?.weight || theme.typography.fontWeight.bold,
      lineHeight: h?.lineHeight || 1.3,
      letterSpacing: h?.letterSpacing || 0,
      textTransform: h?.transform || 'none',
    }
  }

  const muiTheme = createTheme({
    palette: {
      mode: theme.mode,
      primary: {
        main: theme.colors.primary,
        contrastText: getContrastText(theme.colors.primary),
      },
      secondary: {
        main: theme.colors.secondary,
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
        fontSize: `${(theme.typography.secondary?.size || 14) / 16}rem`,
        fontWeight: theme.typography.secondary?.weight || 400,
        lineHeight: theme.typography.secondary?.lineHeight || 1.6,
        letterSpacing: theme.typography.secondary?.letterSpacing || 0,
      },

      button: {
        fontFamily: buildFontStack(theme.typography.fontFamily.body),
        fontWeight: theme.typography.fontWeight.medium,
        textTransform: 'none',
      },
    },

    shape: {
      borderRadius: parseBorderRadius(theme.borderRadius?.md),
    },
  })

  const finalTheme = responsiveFontSizes(muiTheme)

  themeCache.set(cacheKey, finalTheme)

  return finalTheme
}

export default createStoreTheme
