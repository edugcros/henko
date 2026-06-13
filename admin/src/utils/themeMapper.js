import { createTheme } from '@mui/material/styles'
import { DEFAULT_THEME_COLORS } from '../features/theme/colorSystem'

/**
 * Mapper robusto config → MUI Theme
 */
export const mapConfigToMuiTheme = config => {
  if (!config) return createTheme()

  const {
    colors = {},
    typography = {},
    spacing = {},
    layout = {},
    buttons = {},
  } = config

  const primary = safeHex(colors.primary, DEFAULT_THEME_COLORS.primary)
  const secondary = safeHex(colors.secondary, DEFAULT_THEME_COLORS.secondary)
  const background = safeHex(colors.background, DEFAULT_THEME_COLORS.background)
  const surface = safeHex(colors.surface, DEFAULT_THEME_COLORS.surface)
  const cardSurface = safeHex(
    colors.cardBackground,
    DEFAULT_THEME_COLORS.cardBackground,
  )
  const cardBorder = safeHex(colors.cardBorder, DEFAULT_THEME_COLORS.cardBorder)
  const cardText = safeHex(colors.cardText, DEFAULT_THEME_COLORS.cardText)
  const actionPrimary = safeHex(
    colors.actionPrimary,
    DEFAULT_THEME_COLORS.actionPrimary,
  )
  const actionSecondary = safeHex(
    colors.actionSecondary,
    DEFAULT_THEME_COLORS.actionSecondary,
  )

  // 🎯 PALETTE CORREGIDO
  const palette = {
    mode: getLuminance(background) > 0.5 ? 'light' : 'dark',

    primary: {
      main: primary,
      light: lighten(primary, 0.2),
      dark: darken(primary, 0.2),
      contrastText: getContrastText(primary),
    },

    secondary: {
      main: secondary,
      light: lighten(secondary, 0.2),
      dark: darken(secondary, 0.2),
      contrastText: getContrastText(secondary),
    },

    background: {
      default: background,
      paper: surface,
    },

    brand: {
      main: primary,
      contrastText: getContrastText(primary),
    },

    accent: {
      main: safeHex(colors.accent, DEFAULT_THEME_COLORS.accent),
      contrastText: getContrastText(
        safeHex(colors.accent, DEFAULT_THEME_COLORS.accent),
      ),
    },

    ctaPrimary: {
      main: actionPrimary,
      dark: darken(actionPrimary, 0.12),
      contrastText: safeHex(
        colors.actionPrimaryText,
        DEFAULT_THEME_COLORS.actionPrimaryText,
      ),
    },

    ctaSecondary: {
      main: actionSecondary,
      dark: darken(actionSecondary, 0.12),
      contrastText: safeHex(
        colors.actionSecondaryText,
        DEFAULT_THEME_COLORS.actionSecondaryText,
      ),
    },

    commercePrice: {
      main: safeHex(colors.price, DEFAULT_THEME_COLORS.price),
      contrastText: getContrastText(
        safeHex(colors.price, DEFAULT_THEME_COLORS.price),
      ),
    },

    commerceSalePrice: {
      main: safeHex(colors.salePrice, DEFAULT_THEME_COLORS.salePrice),
      contrastText: getContrastText(
        safeHex(colors.salePrice, DEFAULT_THEME_COLORS.salePrice),
      ),
    },

    text: {
      primary: safeHex(colors.text, DEFAULT_THEME_COLORS.text),
      secondary: safeHex(
        colors.mutedText || colors.textSecondary,
        DEFAULT_THEME_COLORS.mutedText,
      ),
    },

    error: { main: safeHex(colors.error, '#d32f2f') },
    warning: { main: safeHex(colors.warning, '#ed6c02') },
    info: { main: safeHex(colors.info, '#0288d1') },
    success: { main: safeHex(colors.success, '#2e7d32') },
  }

  // 🎯 TYPOGRAPHY CORREGIDO
  const muiTypography = {
    fontFamily: typography.fontFamily || '"Inter", "Roboto", sans-serif',

    h1: mapHeading(typography.headings?.h1, 48),
    h2: mapHeading(typography.headings?.h2, 40),
    h3: mapHeading(typography.headings?.h3, 32),
    h4: mapHeading(typography.headings?.h4, 28),
    h5: mapHeading(typography.headings?.h5, 24),
    h6: mapHeading(typography.headings?.h6, 20),

    body1: {
      fontSize: typography.baseSize || 16,
      lineHeight: typography.lineHeight || 1.5,
    },

    button: {
      textTransform: buttons.uppercase ? 'uppercase' : 'none',
      fontWeight: 500,
    },
  }

  // 🎯 SPACING REAL
  const muiSpacing = factor => {
    const base = spacing.base || spacing.unit || 8
    return base * factor
  }

  // 🎯 SHAPE
  const shape = {
    borderRadius: spacing.radius ?? layout.borderRadius ?? 8,
  }

  // 🎯 COMPONENT OVERRIDES
  const components = {
    MuiButton: {
      styleOverrides: {
        root: ({ ownerState }) => {
          const isPrimaryAction =
            !ownerState?.color || ownerState.color === 'primary'
          const isSecondaryAction = ownerState?.color === 'secondary'

          return {
            borderRadius: buttons.radius ?? 8,
            textTransform: buttons.uppercase ? 'uppercase' : 'none',
            ...(ownerState?.variant === 'contained' && isPrimaryAction
              ? {
                  backgroundColor: actionPrimary,
                  color: safeHex(
                    colors.actionPrimaryText,
                    DEFAULT_THEME_COLORS.actionPrimaryText,
                  ),
                  '&:hover': {
                    backgroundColor: darken(actionPrimary, 0.12),
                  },
                }
              : {}),
            ...(ownerState?.variant === 'contained' && isSecondaryAction
              ? {
                  backgroundColor: actionSecondary,
                  color: safeHex(
                    colors.actionSecondaryText,
                    DEFAULT_THEME_COLORS.actionSecondaryText,
                  ),
                  '&:hover': {
                    backgroundColor: darken(actionSecondary, 0.12),
                  },
                }
              : {}),
            ...(ownerState?.variant === 'outlined' && isPrimaryAction
              ? {
                  borderColor: actionPrimary,
                  color: actionPrimary,
                }
              : {}),
            ...(ownerState?.variant === 'outlined' && isSecondaryAction
              ? {
                  borderColor: actionSecondary,
                  color: actionSecondary,
                }
              : {}),
            ...(ownerState?.variant === 'text' && isPrimaryAction
              ? {
                  color: actionPrimary,
                }
              : {}),
            ...(ownerState?.variant === 'text' && isSecondaryAction
              ? {
                  color: actionSecondary,
                }
              : {}),
          }
        },
        containedPrimary: {
          backgroundColor: actionPrimary,
          color: safeHex(
            colors.actionPrimaryText,
            DEFAULT_THEME_COLORS.actionPrimaryText,
          ),
          '&:hover': {
            backgroundColor: darken(actionPrimary, 0.12),
          },
        },
        containedSecondary: {
          backgroundColor: actionSecondary,
          color: safeHex(
            colors.actionSecondaryText,
            DEFAULT_THEME_COLORS.actionSecondaryText,
          ),
          '&:hover': {
            backgroundColor: darken(actionSecondary, 0.12),
          },
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: spacing.radius ?? layout.borderRadius ?? 8,
          backgroundColor: cardSurface,
          border: `1px solid ${cardBorder}`,
          color: cardText,
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: spacing.radius ?? layout.borderRadius ?? 8,
        },
      },
    },
  }

  return createTheme({
    palette,
    typography: muiTypography,
    spacing: muiSpacing,
    shape,
    components,
  })
}

//
// 🧠 HELPERS REALES (SIN PLACEHOLDERS)
//

// HEX → RGB
const isValidHex = hex => /^#([0-9A-F]{3}|[0-9A-F]{6})$/i.test(hex || '')

const safeHex = (hex, fallback) => (isValidHex(hex) ? hex : fallback)

const hexToRgb = hex => {
  const clean = hex.replace('#', '')
  const bigint = parseInt(clean, 16)

  if (clean.length === 3) {
    return {
      r: ((bigint >> 8) & 15) * 17,
      g: ((bigint >> 4) & 15) * 17,
      b: (bigint & 15) * 17,
    }
  }

  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  }
}

// RGB → HEX
const rgbToHex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map(x => {
      const safeValue = Math.max(0, Math.min(255, Math.round(x)))
      const hex = safeValue.toString(16)
      return hex.length === 1 ? '0' + hex : hex
    })
    .join('')

// Lighten
const lighten = (hex, amount = 0.2) => {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHex(
    Math.min(255, r + 255 * amount),
    Math.min(255, g + 255 * amount),
    Math.min(255, b + 255 * amount),
  )
}

// Darken
const darken = (hex, amount = 0.2) => {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHex(
    Math.max(0, r - 255 * amount),
    Math.max(0, g - 255 * amount),
    Math.max(0, b - 255 * amount),
  )
}

// Luminancia (para modo light/dark)
const getLuminance = hex => {
  const { r, g, b } = hexToRgb(hex)
  const a = [r, g, b].map(v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]
}

// Contraste automático
const getContrastText = bg => {
  return getLuminance(bg) > 0.5 ? '#000' : '#fff'
}

// Headings
const mapHeading = (heading = {}, fallbackSize) => ({
  fontSize: heading.size || fallbackSize,
  fontWeight: heading.weight || 700,
  lineHeight: heading.lineHeight || 1.3,
  letterSpacing: heading.letterSpacing ?? -0.3,
  textTransform: heading.transform || 'none',
})

//
// 🎯 CSS VARIABLES (opcional pero útil)
//
export const mapConfigToCssVars = config => {
  if (!config) return {}

  const { colors = {}, spacing = {}, typography = {} } = config

  return {
    '--color-primary': colors.primary || DEFAULT_THEME_COLORS.primary,
    '--color-secondary': colors.secondary || DEFAULT_THEME_COLORS.secondary,
    '--color-background': colors.background || DEFAULT_THEME_COLORS.background,
    '--color-surface': colors.surface || DEFAULT_THEME_COLORS.surface,
    '--color-header-background':
      colors.headerBackground || DEFAULT_THEME_COLORS.headerBackground,
    '--color-header-text': colors.headerText || DEFAULT_THEME_COLORS.headerText,
    '--color-header-link': colors.headerLink || DEFAULT_THEME_COLORS.headerLink,
    '--color-header-icon': colors.headerIcon || DEFAULT_THEME_COLORS.headerIcon,
    '--color-card-background':
      colors.cardBackground || DEFAULT_THEME_COLORS.cardBackground,
    '--color-card-text': colors.cardText || DEFAULT_THEME_COLORS.cardText,
    '--color-card-muted':
      colors.cardMutedText || DEFAULT_THEME_COLORS.cardMutedText,
    '--color-card-border': colors.cardBorder || DEFAULT_THEME_COLORS.cardBorder,
    '--color-card-price': colors.cardPrice || DEFAULT_THEME_COLORS.cardPrice,
    '--color-action-primary':
      colors.actionPrimary || DEFAULT_THEME_COLORS.actionPrimary,
    '--color-action-primary-text':
      colors.actionPrimaryText || DEFAULT_THEME_COLORS.actionPrimaryText,
    '--color-action-secondary':
      colors.actionSecondary || DEFAULT_THEME_COLORS.actionSecondary,
    '--color-action-secondary-text':
      colors.actionSecondaryText || DEFAULT_THEME_COLORS.actionSecondaryText,
    '--color-link': colors.link || DEFAULT_THEME_COLORS.link,
    '--color-price': colors.price || DEFAULT_THEME_COLORS.price,
    '--color-sale-price': colors.salePrice || DEFAULT_THEME_COLORS.salePrice,
    '--color-text': colors.text || DEFAULT_THEME_COLORS.text,
    '--color-muted': colors.mutedText || DEFAULT_THEME_COLORS.mutedText,
    '--spacing-section': `${spacing.section || 24}px`,
    '--spacing-container': `${spacing.container || 24}px`,
    '--font-family': typography.fontFamily,
    '--font-size-base': `${typography.baseSize || 16}px`,
  }
}
