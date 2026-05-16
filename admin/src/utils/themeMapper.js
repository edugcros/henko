import { createTheme } from '@mui/material/styles';

/**
 * Mapper robusto config → MUI Theme
 */
export const mapConfigToMuiTheme = (config) => {
  if (!config) return createTheme();

  const {
    colors = {},
    typography = {},
    spacing = {},
    layout = {},
    buttons = {},
  } = config;

  const primary = colors.primary || '#1976d2';
  const secondary = colors.secondary || '#dc004e';

  // 🎯 PALETTE CORREGIDO
  const palette = {
    mode: getLuminance(colors.background || '#ffffff') > 0.5 ? 'light' : 'dark',

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
      default: colors.background || '#ffffff',
      paper: colors.surface || '#f5f5f5',
    },

    text: {
      primary: colors.text || '#1a1a1a',
      secondary: colors.mutedText || '#666',
    },

    error: { main: colors.error || '#d32f2f' },
    warning: { main: colors.warning || '#ed6c02' },
    info: { main: colors.info || '#0288d1' },
    success: { main: colors.success || '#2e7d32' },
  };

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
  };

  // 🎯 SPACING REAL
  const muiSpacing = (factor) => {
    const base = spacing.container || 8;
    return base * factor;
  };

  // 🎯 SHAPE
  const shape = {
    borderRadius: layout.borderRadius ?? 8,
  };

  // 🎯 COMPONENT OVERRIDES
  const components = {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: buttons.radius ?? 8,
          textTransform: buttons.uppercase ? 'uppercase' : 'none',
        },
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: layout.borderRadius ?? 8,
        },
      },
    },
  };

  return createTheme({
    palette,
    typography: muiTypography,
    spacing: muiSpacing,
    shape,
    components,
  });
};

//
// 🧠 HELPERS REALES (SIN PLACEHOLDERS)
//

// HEX → RGB
const hexToRgb = (hex) => {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);

  if (clean.length === 3) {
    return {
      r: ((bigint >> 8) & 15) * 17,
      g: ((bigint >> 4) & 15) * 17,
      b: (bigint & 15) * 17,
    };
  }

  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
};

// RGB → HEX
const rgbToHex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map((x) => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    })
    .join('');

// Lighten
const lighten = (hex, amount = 0.2) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.min(255, r + 255 * amount),
    Math.min(255, g + 255 * amount),
    Math.min(255, b + 255 * amount)
  );
};

// Darken
const darken = (hex, amount = 0.2) => {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.max(0, r - 255 * amount),
    Math.max(0, g - 255 * amount),
    Math.max(0, b - 255 * amount)
  );
};

// Luminancia (para modo light/dark)
const getLuminance = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928
      ? v / 12.92
      : Math.pow((v + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};

// Contraste automático
const getContrastText = (bg) => {
  return getLuminance(bg) > 0.5 ? '#000' : '#fff';
};

// Headings
const mapHeading = (heading = {}, fallbackSize) => ({
  fontSize: heading.size || fallbackSize,
  fontWeight: heading.weight || 700,
  lineHeight: heading.lineHeight || 1.3,
  letterSpacing: heading.letterSpacing ?? -0.3,
  textTransform: heading.transform || 'none',
});

//
// 🎯 CSS VARIABLES (opcional pero útil)
//
export const mapConfigToCssVars = (config) => {
  if (!config) return {};

  const { colors = {}, spacing = {}, typography = {} } = config;

  return {
    '--color-primary': colors.primary,
    '--color-secondary': colors.secondary,
    '--color-background': colors.background,
    '--color-surface': colors.surface,
    '--color-text': colors.text,
    '--color-muted': colors.mutedText,
    '--spacing-section': `${spacing.section || 24}px`,
    '--spacing-container': `${spacing.container || 8}px`,
    '--font-family': typography.fontFamily,
    '--font-size-base': `${typography.baseSize || 16}px`,
  };
};