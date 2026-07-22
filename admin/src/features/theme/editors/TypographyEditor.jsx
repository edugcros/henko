import React, { useMemo, useState } from 'react'
import {
  Box,
  Chip,
  FormControl,
  Grid,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

const GOOGLE_FONTS = [
  // Modernas / SaaS / ecommerce limpio
  'Inter',
  'Roboto',
  'Montserrat',
  'Open Sans',
  'Poppins',
  'Lato',
  'Raleway',
  'Work Sans',
  'Nunito',
  'Source Sans 3',

  // Editorial / premium / lujo
  'Playfair Display',
  'Merriweather',
  'EB Garamond',
  'Libre Baskerville',
  'Cormorant Garamond',
  'Bodoni Moda',
  'GFS Didot',
  'Cinzel',
]

const HEADING_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']

const TRANSFORM_OPTIONS = [
  { value: 'none', label: 'Normal' },
  { value: 'uppercase', label: 'AA' },
  { value: 'capitalize', label: 'Aa' },
  { value: 'lowercase', label: 'aa' },
]

const DEFAULT_HEADINGS = {
  h1: {
    size: 42,
    weight: 800,
    lineHeight: 1.15,
    letterSpacing: 0,
    transform: 'none',
  },
  h2: {
    size: 34,
    weight: 750,
    lineHeight: 1.2,
    letterSpacing: 0,
    transform: 'none',
  },
  h3: {
    size: 28,
    weight: 700,
    lineHeight: 1.25,
    letterSpacing: 0,
    transform: 'none',
  },
  h4: {
    size: 24,
    weight: 650,
    lineHeight: 1.3,
    letterSpacing: 0,
    transform: 'none',
  },
  h5: {
    size: 20,
    weight: 600,
    lineHeight: 1.35,
    letterSpacing: 0,
    transform: 'none',
  },
  h6: {
    size: 18,
    weight: 600,
    lineHeight: 1.4,
    letterSpacing: 0,
    transform: 'none',
  },
}

const clamp = (value, fallback, min, max) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

const normalizeTypography = value => {
  const typography = value || {}

  return {
    fontFamily: typography.fontFamily || 'Inter',
    headingFont: typography.headingFont || 'Montserrat',
    secondaryFont: typography.secondaryFont || 'Inter',
    baseSize: clamp(typography.baseSize, 16, 12, 24),
    lineHeight: clamp(typography.lineHeight, 1.5, 1, 2),
    scale: clamp(typography.scale, 1.25, 1.1, 1.5),
    secondary: {
      size: clamp(typography.secondary?.size, 14, 10, 22),
      weight: clamp(typography.secondary?.weight, 400, 300, 900),
      lineHeight: clamp(typography.secondary?.lineHeight, 1.55, 1, 2),
      letterSpacing: clamp(typography.secondary?.letterSpacing, 0, -1, 2),
    },
    headings: HEADING_KEYS.reduce((acc, key) => {
      const source = typography.headings?.[key] || {}
      acc[key] = {
        ...DEFAULT_HEADINGS[key],
        ...source,
        size: clamp(source.size, DEFAULT_HEADINGS[key].size, 14, 72),
        weight: clamp(source.weight, DEFAULT_HEADINGS[key].weight, 300, 950),
        lineHeight: clamp(
          source.lineHeight,
          DEFAULT_HEADINGS[key].lineHeight,
          0.9,
          2,
        ),
        letterSpacing: clamp(
          source.letterSpacing,
          DEFAULT_HEADINGS[key].letterSpacing,
          -2,
          2,
        ),
        transform: source.transform || DEFAULT_HEADINGS[key].transform,
      }
      return acc
    }, {}),
  }
}

const SettingGroupComponents = ({ title, caption, children }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.25 }}>
    <Stack spacing={0.25} sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" fontWeight={850}>
        {title}
      </Typography>
      {caption && (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      )}
    </Stack>
    {children}
  </Paper>
)

const RangeControlComponents = ({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}) => (
  <Box>
    <Stack direction="row" alignItems="center" justifyContent="space-between">
      <Typography variant="body2" fontWeight={700}>
        {label}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {value}
        {suffix}
      </Typography>
    </Stack>
    <Slider
      size="small"
      value={value}
      min={min}
      max={max}
      step={step}
      valueLabelDisplay="auto"
      onChange={(_, nextValue) => onChange(nextValue)}
      sx={{ mt: 0.5 }}
    />
  </Box>
)

const FontSelectComponents = ({ label, value, onChange }) => (
  <FormControl fullWidth size="small">
    <InputLabel>{label}</InputLabel>
    <Select
      label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
    >
      {GOOGLE_FONTS.map(font => (
        <MenuItem key={font} value={font}>
          <span style={{ fontFamily: font }}>{font}</span>
        </MenuItem>
      ))}
    </Select>
  </FormControl>
)

const TypographyEditor = ({ value, onChange, sectionMeta }) => {
  const muiTheme = useTheme()
  const typography = useMemo(() => normalizeTypography(value), [value])
  const [selectedHeading, setSelectedHeading] = useState('h1')

  const updateTypography = patch => {
    onChange?.({
      ...(value || {}),
      ...patch,
    })
  }

  const updateSecondary = (field, nextValue) => {
    updateTypography({
      secondary: {
        ...typography.secondary,
        [field]: nextValue,
      },
    })
  }

  const updateHeading = (field, nextValue) => {
    updateTypography({
      headings: {
        ...typography.headings,
        [selectedHeading]: {
          ...typography.headings[selectedHeading],
          [field]: nextValue,
        },
      },
    })
  }

  const heading = typography.headings[selectedHeading]

  return (
    <Stack spacing={1.5}>
      {sectionMeta?.appliesTo && (
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 1.25,
            bgcolor: alpha(muiTheme.palette.primary.main, 0.035),
            borderColor: alpha(muiTheme.palette.primary.main, 0.18),
          }}
        >
          <Typography variant="subtitle2" fontWeight={850}>
            Tipografía
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {sectionMeta.appliesTo}
          </Typography>
        </Paper>
      )}

      <SettingGroupComponents
        title="Fuentes"
        caption="Elegí una fuente por rol de lectura."
      >
        <Stack spacing={1.25}>
          <FontSelectComponents
            label="Texto general"
            value={typography.fontFamily}
            onChange={nextValue => updateTypography({ fontFamily: nextValue })}
          />
          <FontSelectComponents
            label="Títulos"
            value={typography.headingFont}
            onChange={nextValue => updateTypography({ headingFont: nextValue })}
          />
          <FontSelectComponents
            label="Texto auxiliar"
            value={typography.secondaryFont}
            onChange={nextValue =>
              updateTypography({ secondaryFont: nextValue })
            }
          />
        </Stack>
      </SettingGroupComponents>

      <SettingGroupComponents
        title="Texto general"
        caption="Base usada por párrafos, fichas y contenido del catálogo."
      >
        <Stack spacing={1.25}>
          <RangeControlComponents
            label="Tamaño"
            value={typography.baseSize}
            min={12}
            max={24}
            step={1}
            suffix="px"
            onChange={nextValue => updateTypography({ baseSize: nextValue })}
          />
          <RangeControlComponents
            label="Interlineado"
            value={typography.lineHeight}
            min={1}
            max={2}
            step={0.05}
            onChange={nextValue => updateTypography({ lineHeight: nextValue })}
          />
          <RangeControlComponents
            label="Escala"
            value={typography.scale}
            min={1.1}
            max={1.5}
            step={0.05}
            onChange={nextValue => updateTypography({ scale: nextValue })}
          />
        </Stack>
      </SettingGroupComponents>

      <SettingGroupComponents
        title="Títulos"
        caption="Editá un nivel por vez para mantener orden visual."
      >
        <Stack spacing={1.25}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={selectedHeading}
            onChange={(_, nextValue) => {
              if (nextValue) setSelectedHeading(nextValue)
            }}
          >
            {HEADING_KEYS.map(key => (
              <ToggleButton key={key} value={key}>
                {key.toUpperCase()}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'background.default',
              overflow: 'hidden',
            }}
          >
            <Typography
              sx={{
                fontFamily: typography.headingFont,
                fontSize: Math.min(heading.size, 38),
                fontWeight: heading.weight,
                lineHeight: heading.lineHeight,
                letterSpacing: `${heading.letterSpacing}px`,
                textTransform: heading.transform,
                overflowWrap: 'anywhere',
              }}
            >
              Nueva colección
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.5 }}
            >
              {selectedHeading.toUpperCase()} · {heading.size}px · peso{' '}
              {heading.weight}
            </Typography>
          </Paper>

          <Grid container spacing={1.25}>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Tamaño"
                value={heading.size}
                onChange={event =>
                  updateHeading('size', Number(event.target.value))
                }
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">px</InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label="Peso"
                value={heading.weight}
                onChange={event =>
                  updateHeading('weight', Number(event.target.value))
                }
                inputProps={{ min: 300, max: 950, step: 50 }}
              />
            </Grid>
          </Grid>

          <RangeControlComponents
            label="Interlineado"
            value={heading.lineHeight}
            min={0.9}
            max={2}
            step={0.05}
            onChange={nextValue => updateHeading('lineHeight', nextValue)}
          />
          <RangeControlComponents
            label="Espaciado de letras"
            value={heading.letterSpacing}
            min={-2}
            max={2}
            step={0.1}
            suffix="px"
            onChange={nextValue => updateHeading('letterSpacing', nextValue)}
          />
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={heading.transform || 'none'}
            onChange={(_, nextValue) => {
              if (nextValue) updateHeading('transform', nextValue)
            }}
          >
            {TRANSFORM_OPTIONS.map(option => (
              <ToggleButton key={option.value} value={option.value}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      </SettingGroupComponents>

      <SettingGroupComponents
        title="Texto auxiliar"
        caption="Captions, metadatos y ayudas."
      >
        <Grid container spacing={1.25}>
          <Grid item xs={6}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Tamaño"
              value={typography.secondary.size}
              onChange={event =>
                updateSecondary('size', Number(event.target.value))
              }
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">px</InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Peso"
              value={typography.secondary.weight}
              onChange={event =>
                updateSecondary('weight', Number(event.target.value))
              }
              inputProps={{ min: 300, max: 900, step: 50 }}
            />
          </Grid>
          <Grid item xs={12}>
            <RangeControlComponents
              label="Interlineado"
              value={typography.secondary.lineHeight}
              min={1}
              max={2}
              step={0.05}
              onChange={nextValue => updateSecondary('lineHeight', nextValue)}
            />
          </Grid>
          <Grid item xs={12}>
            <RangeControlComponents
              label="Espaciado"
              value={typography.secondary.letterSpacing}
              min={-1}
              max={2}
              step={0.1}
              suffix="px"
              onChange={nextValue =>
                updateSecondary('letterSpacing', nextValue)
              }
            />
          </Grid>
        </Grid>
      </SettingGroupComponents>

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.25 }}>
        <Stack spacing={0.75}>
          <Typography
            sx={{
              fontFamily: typography.headingFont,
              fontSize: Math.min(typography.headings.h2.size, 30),
              fontWeight: typography.headings.h2.weight,
              lineHeight: typography.headings.h2.lineHeight,
            }}
          >
            Vista previa editorial
          </Typography>
          <Typography
            sx={{
              fontFamily: typography.fontFamily,
              fontSize: typography.baseSize,
              lineHeight: typography.lineHeight,
            }}
          >
            Producto destacado con una descripción clara, precio y llamada a la
            acción.
          </Typography>
          <Typography
            sx={{
              fontFamily: typography.secondaryFont,
              fontSize: typography.secondary.size,
              fontWeight: typography.secondary.weight,
              lineHeight: typography.secondary.lineHeight,
              letterSpacing: `${typography.secondary.letterSpacing}px`,
              color: 'text.secondary',
            }}
          >
            Stock disponible · Envío a todo el país
          </Typography>
        </Stack>
      </Paper>
    </Stack>
  )
}

export default React.memo(TypographyEditor)
