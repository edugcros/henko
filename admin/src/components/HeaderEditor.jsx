// 📁 src/components/HeaderEditor.jsx
import React, { useCallback, useMemo } from 'react'
import {
  Box,
  Typography,
  Paper,
  Grid,
  Switch,
  FormControlLabel,
  Slider,
  Divider,
  Stack,
  Chip,
  alpha,
  useTheme,
} from '@mui/material'

import {
  PushPinOutlined as StickyIcon,
  OpacityOutlined as TransparentIcon,
  StorefrontOutlined as LogoIcon,
  SearchOutlined as SearchIcon,
  LocalMallOutlined as CartIcon,
  PersonOutline as AccountIcon,
  FavoriteBorder as WishlistIcon,
  CompareArrows as CompareIcon,
  TuneOutlined as SettingsIcon,
  BrandingWatermarkOutlined as BrandingIcon,
  HeightOutlined as HeightIcon,
} from '@mui/icons-material'

import ImageUploader from '@components/ImageUploader'
import ColorPicker from '@components/ColorPicker'

// ===============================
// CONFIG
// ===============================
const TOGGLES = [
  {
    key: 'sticky',
    label: 'Sticky',
    description: 'Fijo al hacer scroll',
    defaultValue: true,
    icon: StickyIcon,
  },
  {
    key: 'transparent',
    label: 'Transparente',
    description: 'Inicial sobre el hero',
    defaultValue: true,
    icon: TransparentIcon,
  },
  {
    key: 'showLogo',
    label: 'Logo',
    description: 'Mostrar identidad visual',
    defaultValue: true,
    icon: LogoIcon,
  },
  {
    key: 'showSearch',
    label: 'Búsqueda',
    description: 'Mostrar buscador',
    defaultValue: true,
    icon: SearchIcon,
  },
  {
    key: 'showCart',
    label: 'Carrito',
    description: 'Mostrar acceso al carrito',
    defaultValue: true,
    icon: CartIcon,
  },
  {
    key: 'showAccount',
    label: 'Cuenta',
    description: 'Mostrar acceso de usuario',
    defaultValue: true,
    icon: AccountIcon,
  },
  {
    key: 'showWishlist',
    label: 'Lista de deseos',
    description: 'Mostrar favoritos',
    defaultValue: true,
    icon: WishlistIcon,
  },
  {
    key: 'showCompare',
    label: 'Comparador',
    description: 'Mostrar comparación',
    defaultValue: false,
    icon: CompareIcon,
  },
]

const DEFAULT_HEADER = {
  height: 64,
  logoWidth: 120,
  sticky: true,
  transparent: true,
  showLogo: true,
  showSearch: true,
  showCart: true,
  showAccount: true,
  showUserMenu: true,
  showWishlist: true,
  showCompare: false,
  logo: null,
}

const HEADER_COLOR_FIELDS = [
  {
    key: 'headerBackground',
    label: 'Fondo del header',
    description:
      'Solo modifica el fondo de la cabecera. No afecta cards ni botones.',
  },
  {
    key: 'headerText',
    label: 'Texto del header',
    description: 'Marca y textos internos de la cabecera.',
  },
  {
    key: 'headerLink',
    label: 'Links del header',
    description: 'Navegación textual dentro de la cabecera.',
  },
  {
    key: 'headerIcon',
    label: 'Iconos del header',
    description: 'Búsqueda, carrito, cuenta, favoritos y menú móvil.',
  },
]

const DEFAULT_HEADER_COLORS = {
  headerBackground: '#ffffff',
  headerText: '#1a1a1a',
  headerLink: '#1976d2',
  headerIcon: '#666666',
}

// ===============================
// HELPERS
// ===============================
const normalizeNumber = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const getToggleChecked = (header, key, defaultValue) => {
  if (defaultValue === true) return header[key] !== false
  return header[key] === true
}

const normalizeHeaderValue = value => {
  const source = value || {}

  return {
    ...DEFAULT_HEADER,
    ...source,
    showAccount:
      source.showAccount ?? source.showUserMenu ?? DEFAULT_HEADER.showAccount,
    showUserMenu:
      source.showUserMenu ?? source.showAccount ?? DEFAULT_HEADER.showUserMenu,
  }
}

// ===============================
// COMPONENT
// ===============================
const HeaderEditor = ({
  value = {},
  colors = {},
  onChange,
  onColorChange,
  onLogoUpload,
}) => {
  const theme = useTheme()

  const header = useMemo(() => normalizeHeaderValue(value), [value])

  const update = useCallback(
    (field, val) => {
      if (typeof onChange !== 'function') return

      const nextHeader = {
        ...header,
        [field]: val,
      }

      /**
       * Compatibilidad:
       * CustomHeader puede leer showAccount o showUserMenu.
       * Guardamos ambos para evitar que el header no refleje cambios.
       */
      if (field === 'showAccount') {
        nextHeader.showUserMenu = val
      }

      if (field === 'showUserMenu') {
        nextHeader.showAccount = val
      }

      onChange(nextHeader)
    },
    [header, onChange],
  )

  const updateLogo = useCallback(
    img => {
      if (typeof onChange !== 'function') return

      onChange({
        ...header,
        logo: img,
      })
    },
    [header, onChange],
  )

  const cardSx = {
    p: { xs: 2, md: 2.5 },
    mb: 2,
    borderRadius: 3,
    border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
    boxShadow: 'none',
    bgcolor: theme.palette.background.paper,
  }

  const sectionTitleSx = {
    fontWeight: 850,
    letterSpacing: '-0.02em',
    color: theme.palette.text.primary,
  }

  const captionSx = {
    color: theme.palette.text.secondary,
    fontWeight: 600,
  }

  const iconBoxSx = checked => ({
    width: 38,
    height: 38,
    borderRadius: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    color: checked ? theme.palette.primary.main : theme.palette.text.secondary,
    bgcolor: checked
      ? alpha(theme.palette.primary.main, 0.1)
      : alpha(theme.palette.action.disabledBackground, 0.45),
  })

  return (
    <Box>
      {/* ===================== INFO ===================== */}
      <Paper
        elevation={0}
        sx={{
          ...cardSx,
          bgcolor: alpha(theme.palette.primary.main, 0.045),
          borderColor: alpha(theme.palette.primary.main, 0.16),
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={1.5}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={iconBoxSx(true)}>
              <SettingsIcon fontSize="small" />
            </Box>

            <Box>
              <Typography sx={sectionTitleSx}>
                Configuración del header
              </Typography>

              <Typography
                variant="body2"
                sx={{ color: theme.palette.text.secondary, mt: 0.35 }}
              >
                Estos cambios afectan únicamente la cabecera de la tienda.
              </Typography>
            </Box>
          </Stack>

          <Chip
            size="small"
            label="Header"
            sx={{
              fontWeight: 800,
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: theme.palette.primary.main,
            }}
          />
        </Stack>
      </Paper>

      {/* ===================== APPEARANCE ===================== */}
      <Paper elevation={0} sx={cardSx}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={1.5}>
          <Box sx={iconBoxSx(true)}>
            <BrandingIcon fontSize="small" />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={sectionTitleSx}>
              Apariencia
            </Typography>

            <Typography variant="caption" sx={captionSx}>
              Colores exclusivos de la cabecera del storefront
            </Typography>
          </Box>
        </Stack>

        <Grid container spacing={2}>
          {HEADER_COLOR_FIELDS.map(field => (
            <Grid item xs={12} md={6} key={field.key}>
              <ColorPicker
                label={field.label}
                description={field.description}
                value={colors[field.key] || DEFAULT_HEADER_COLORS[field.key]}
                onChange={color => onColorChange?.(field.key, color)}
              />
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* ===================== LAYOUT ===================== */}
      <Paper elevation={0} sx={cardSx}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={1.5}>
          <Box sx={iconBoxSx(true)}>
            <HeightIcon fontSize="small" />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={sectionTitleSx}>
              Layout
            </Typography>

            <Typography variant="caption" sx={captionSx}>
              Altura del header ({normalizeNumber(header.height, 64)}px)
            </Typography>
          </Box>
        </Stack>

        <Slider
          value={normalizeNumber(header.height, 64)}
          onChange={(_, v) => update('height', Number(v))}
          min={48}
          max={120}
          step={4}
          valueLabelDisplay="auto"
          sx={{ mt: 0.5 }}
        />
      </Paper>

      {/* ===================== BRANDING ===================== */}
      <Paper elevation={0} sx={cardSx}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={1.5}>
          <Box sx={iconBoxSx(header.showLogo !== false)}>
            <BrandingIcon fontSize="small" />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={sectionTitleSx}>
              Branding
            </Typography>

            <Typography variant="caption" sx={captionSx}>
              Logo e identidad visual del comercio
            </Typography>
          </Box>
        </Stack>

        <Typography variant="caption" sx={captionSx} display="block" mb={1}>
          Logo
        </Typography>

        <ImageUploader
          value={header.logo}
          onChange={updateLogo}
          onUpload={onLogoUpload}
          label="Logo"
        />

        {header.showLogo !== false && (
          <Box mt={2}>
            <Divider sx={{ mb: 2 }} />

            <Typography variant="caption" sx={captionSx}>
              Ancho del logo ({normalizeNumber(header.logoWidth, 120)}px)
            </Typography>

            <Slider
              value={normalizeNumber(header.logoWidth, 120)}
              onChange={(_, v) => update('logoWidth', Number(v))}
              min={80}
              max={240}
              step={10}
              valueLabelDisplay="auto"
              sx={{ mt: 1 }}
            />
          </Box>
        )}
      </Paper>

      {/* ===================== VISIBILITY ===================== */}
      <Paper elevation={0} sx={{ ...cardSx, mb: 0 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" mb={1}>
          <Box sx={iconBoxSx(true)}>
            <SettingsIcon fontSize="small" />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={sectionTitleSx}>
              Visibilidad y comportamiento
            </Typography>

            <Typography
              variant="body2"
              sx={{ color: theme.palette.text.secondary }}
            >
              Activá o desactivá elementos visibles en la cabecera del comercio.
            </Typography>
          </Box>
        </Stack>

        <Grid container spacing={1.25} mt={0.5}>
          {TOGGLES.map(toggle => {
            const { key, label, description, defaultValue } = toggle
            const checked = getToggleChecked(header, key, defaultValue)

            return (
              <Grid item xs={12} sm={6} key={key}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 1.25,
                    borderRadius: 2.5,
                    border: `1px solid ${
                      checked
                        ? alpha(theme.palette.primary.main, 0.22)
                        : alpha(theme.palette.divider, 0.75)
                    }`,
                    bgcolor: checked
                      ? alpha(theme.palette.primary.main, 0.045)
                      : alpha(theme.palette.action.disabledBackground, 0.26),
                    transition:
                      'background-color .18s ease, border-color .18s ease',
                  }}
                >
                  <FormControlLabel
                    sx={{
                      m: 0,
                      width: '100%',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.25,
                    }}
                    labelPlacement="start"
                    control={
                      <Switch
                        checked={checked}
                        onChange={e => update(key, e.target.checked)}
                      />
                    }
                    label={
                      <Stack
                        direction="row"
                        spacing={1.25}
                        alignItems="center"
                        sx={{ minWidth: 0 }}
                      >
                        <Box sx={iconBoxSx(checked)}>
                          {React.createElement(toggle.icon, {
                            fontSize: 'small',
                          })}
                        </Box>

                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 850,
                              color: theme.palette.text.primary,
                              lineHeight: 1.2,
                            }}
                          >
                            {label}
                          </Typography>

                          <Typography
                            variant="caption"
                            sx={{
                              color: theme.palette.text.secondary,
                              display: 'block',
                              lineHeight: 1.25,
                            }}
                          >
                            {description}
                          </Typography>
                        </Box>
                      </Stack>
                    }
                  />
                </Paper>
              </Grid>
            )
          })}
        </Grid>
      </Paper>
    </Box>
  )
}

export default HeaderEditor
