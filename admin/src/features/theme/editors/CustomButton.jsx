import React from 'react'
import {
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material'

const DEFAULT_BUTTONS = {
  radius: 8,
  uppercase: false,
  elevation: 2,
  size: 'medium',
  variant: 'contained',
  fullWidthMobile: false,
}

const SIZE_OPTIONS = [
  { value: 'small', label: 'Compacto' },
  { value: 'medium', label: 'Estándar' },
  { value: 'large', label: 'Grande' },
]

const VARIANT_OPTIONS = [
  { value: 'contained', label: 'Sólido' },
  { value: 'outlined', label: 'Contorno' },
  { value: 'text', label: 'Texto' },
]

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

const CustomButton = ({ value, onChange, theme, sectionMeta }) => {
  const buttons = {
    ...DEFAULT_BUTTONS,
    ...(value || {}),
  }

  const colors = theme?.colors || {}
  const actionPrimary = colors.actionPrimary || '#1976d2'
  const actionPrimaryText = colors.actionPrimaryText || '#ffffff'
  const actionSecondary = colors.actionSecondary || '#dc004e'
  const actionSecondaryText = colors.actionSecondaryText || '#ffffff'

  const handleChange = (field, nextValue) => {
    onChange?.({
      ...buttons,
      [field]: nextValue,
    })
  }

  const sharedButtonSx = {
    borderRadius: `${buttons.radius}px`,
    textTransform: buttons.uppercase ? 'uppercase' : 'none',
    boxShadow:
      buttons.elevation > 0
        ? `0 ${buttons.elevation * 2}px ${buttons.elevation * 6}px rgba(15,23,42,0.18)`
        : 'none',
  }

  return (
    <Stack spacing={1.5}>
      {sectionMeta?.appliesTo && (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.25 }}>
          <Typography variant="subtitle2" fontWeight={850}>
            Botones
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {sectionMeta.appliesTo}
          </Typography>
        </Paper>
      )}

      <SettingGroupComponents
        title="Estilo base"
        caption="Define la apariencia por defecto de los CTA."
      >
        <Grid container spacing={1.25}>
          <Grid item xs={12}>
            <FormControl fullWidth size="small">
              <InputLabel>Variante</InputLabel>
              <Select
                label="Variante"
                value={buttons.variant}
                onChange={event => handleChange('variant', event.target.value)}
              >
                {VARIANT_OPTIONS.map(option => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <FormControl fullWidth size="small">
              <InputLabel>Tamaño</InputLabel>
              <Select
                label="Tamaño"
                value={buttons.size}
                onChange={event => handleChange('size', event.target.value)}
              >
                {SIZE_OPTIONS.map(option => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </SettingGroupComponents>

      <SettingGroupComponents
        title="Forma y profundidad"
        caption="Ajusta redondeo y sombra sin tocar los colores."
      >
        <Stack spacing={1.25}>
          <RangeControlComponents
            label="Radio"
            value={buttons.radius}
            min={0}
            max={24}
            step={1}
            suffix="px"
            onChange={nextValue => handleChange('radius', nextValue)}
          />
          <RangeControlComponents
            label="Sombra"
            value={buttons.elevation}
            min={0}
            max={8}
            step={1}
            onChange={nextValue => handleChange('elevation', nextValue)}
          />
        </Stack>
      </SettingGroupComponents>

      <SettingGroupComponents
        title="Comportamiento"
        caption="Opciones de lectura y adaptación mobile."
      >
        <Stack spacing={1}>
          <FormControlLabel
            sx={{ m: 0, justifyContent: 'space-between' }}
            label={<Typography variant="body2">Texto en mayúsculas</Typography>}
            labelPlacement="start"
            control={
              <Switch
                checked={Boolean(buttons.uppercase)}
                onChange={event =>
                  handleChange('uppercase', event.target.checked)
                }
              />
            }
          />
          <FormControlLabel
            sx={{ m: 0, justifyContent: 'space-between' }}
            label={
              <Typography variant="body2">Ancho completo en mobile</Typography>
            }
            labelPlacement="start"
            control={
              <Switch
                checked={Boolean(buttons.fullWidthMobile)}
                onChange={event =>
                  handleChange('fullWidthMobile', event.target.checked)
                }
              />
            }
          />
        </Stack>
      </SettingGroupComponents>

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.25 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle2" fontWeight={850}>
              Vista previa
            </Typography>
            <Chip size="small" label={buttons.variant} variant="outlined" />
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gap: 1,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'background.default',
            }}
          >
            <Button
              variant={buttons.variant}
              size={buttons.size}
              sx={{
                ...sharedButtonSx,
                bgcolor:
                  buttons.variant === 'contained'
                    ? actionPrimary
                    : 'transparent',
                color:
                  buttons.variant === 'contained'
                    ? actionPrimaryText
                    : actionPrimary,
                borderColor: actionPrimary,
                '&:hover': {
                  bgcolor:
                    buttons.variant === 'contained'
                      ? actionPrimary
                      : 'transparent',
                  color:
                    buttons.variant === 'contained'
                      ? actionPrimaryText
                      : actionPrimary,
                  borderColor: actionPrimary,
                  filter: 'brightness(0.94)',
                },
              }}
            >
              Comprar ahora
            </Button>

            <Button
              variant={
                buttons.variant === 'contained' ? 'outlined' : 'contained'
              }
              size={buttons.size}
              sx={{
                ...sharedButtonSx,
                bgcolor:
                  buttons.variant === 'contained'
                    ? 'transparent'
                    : actionSecondary,
                color:
                  buttons.variant === 'contained'
                    ? actionSecondary
                    : actionSecondaryText,
                borderColor: actionSecondary,
                '&:hover': {
                  bgcolor:
                    buttons.variant === 'contained'
                      ? 'transparent'
                      : actionSecondary,
                  color:
                    buttons.variant === 'contained'
                      ? actionSecondary
                      : actionSecondaryText,
                  borderColor: actionSecondary,
                  filter: 'brightness(0.94)',
                },
              }}
            >
              Ver detalles
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  )
}

export default React.memo(CustomButton)
