// 📁 src/components/ColorsPanel.jsx - VERSIÓN PRODUCCIÓN
import React, { useCallback, useMemo } from 'react'
import {
  Grid,
  Typography,
  Box,
  Tooltip,
  IconButton,
  Paper,
  Stack,
} from '@mui/material'
import ColorPicker from '@components/ColorPicker'
import RefreshIcon from '@mui/icons-material/Refresh'
import {
  COLOR_PRESETS,
  COLOR_ROLE_GROUPS,
  DEFAULT_THEME_COLORS,
} from '@features/theme/colorSystem'

const ColorsPanel = ({
  colors = {},
  updateTheme,
  updateField,
  onChange,
  sectionMeta,
}) => {
  const effectiveColors = useMemo(
    () => ({ ...DEFAULT_THEME_COLORS, ...colors }),
    [colors],
  )

  // 🔥 Handler optimizado con validación
  const handleColorChange = useCallback(
    (key, value) => {
      // Validar formato HEX
      const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

      if (!hexRegex.test(value)) {
        console.warn(`Color inválido para ${key}:`, value)
        return
      }

      // Usar updateField con path notation (si está disponible) o updateTheme
      if (updateField) {
        updateField(`colors.${key}`, value)
      } else if (onChange) {
        onChange({ ...effectiveColors, [key]: value })
      } else if (updateTheme) {
        updateTheme('colors', { ...effectiveColors, [key]: value })
      }
    },
    [effectiveColors, updateField, updateTheme, onChange],
  )

  // 🔥 Reset individual de color
  const handleResetColor = useCallback(
    key => {
      handleColorChange(key, DEFAULT_THEME_COLORS[key])
    },
    [handleColorChange],
  )

  // 🔥 Aplicar preset completo
  const handleApplyPreset = useCallback(
    preset => {
      const presetColors = { ...preset }
      delete presetColors.name
      const newColors = { ...effectiveColors, ...presetColors }

      if (onChange) {
        onChange(newColors)
        return
      }

      if (updateTheme) {
        updateTheme('colors', newColors)
      }
    },
    [effectiveColors, updateTheme, onChange],
  )

  // 🔥 Reset todos los colores
  const handleResetAll = useCallback(() => {
    if (window.confirm('¿Restaurar todos los colores a valores por defecto?')) {
      if (onChange) {
        onChange(DEFAULT_THEME_COLORS)
        return
      }

      if (updateTheme) {
        updateTheme('colors', DEFAULT_THEME_COLORS)
      }
    }
  }, [updateTheme, onChange])

  const renderColorPicker = (
    { key, label, appliesTo },
    size = { xs: 12, sm: 6 },
  ) => (
    <Grid item xs={size.xs} sm={size.sm} key={key}>
      <ColorPicker
        label={label}
        value={effectiveColors[key]}
        onChange={v => handleColorChange(key, v)}
        helperText={appliesTo}
        showReset
        onReset={() => handleResetColor(key)}
        sx={{
          '& .MuiInputBase-root': {
            borderLeft: `4px solid ${effectiveColors[key]}`,
          },
        }}
      />
    </Grid>
  )

  return (
    <Box>
      {sectionMeta?.appliesTo && (
        <Paper sx={{ p: 2, mb: 2 }} variant="outlined">
          <Typography variant="subtitle2" fontWeight={600}>
            {sectionMeta.label || 'Colores'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {sectionMeta.appliesTo}
          </Typography>
        </Paper>
      )}

      {/* PRESETS RÁPIDOS */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Paletas Rápidas
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {COLOR_PRESETS.map(preset => (
            <Tooltip key={preset.name} title={preset.name}>
              <Box
                onClick={() => handleApplyPreset(preset)}
                sx={{
                  display: 'flex',
                  gap: 0.5,
                  p: 0.5,
                  borderRadius: 2,
                  border: '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    transform: 'scale(1.05)',
                  },
                }}
              >
                {[preset.primary, preset.secondary, preset.accent].map(
                  (color, i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: 1,
                        bgcolor: color,
                        border: '1px solid rgba(0,0,0,0.1)',
                      }}
                    />
                  ),
                )}
              </Box>
            </Tooltip>
          ))}
        </Box>
      </Box>

      <Stack spacing={3}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Typography variant="subtitle2">Sistema de color</Typography>
          <Tooltip title="Restaurar colores por defecto">
            <IconButton size="small" onClick={handleResetAll}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {COLOR_ROLE_GROUPS.map(group => (
          <Paper key={group.id} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              {group.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {group.description}
            </Typography>
            <Grid container spacing={2}>
              {group.fields.map(field =>
                renderColorPicker(
                  field,
                  group.id === 'feedback'
                    ? { xs: 6, sm: 3 }
                    : { xs: 12, sm: 6 },
                ),
              )}
            </Grid>
          </Paper>
        ))}
      </Stack>

      {/* PREVIEW DE CONTRASTE */}
      <Box sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Preview semántico
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.primary,
              color: effectiveColors.background,
            }}
          >
            Marca primaria
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.actionPrimary,
              color: effectiveColors.actionPrimaryText,
            }}
          >
            Botón primario
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.headerBackground,
              color: effectiveColors.headerText,
              border: `1px solid ${effectiveColors.border}`,
            }}
          >
            Header
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.cardBackground,
              color: effectiveColors.cardText,
              border: `2px solid ${effectiveColors.cardBorder}`,
            }}
          >
            Card / Panel
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.badgeBackground,
              color: effectiveColors.badgeText,
            }}
          >
            Badge comercial
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.background,
              color: effectiveColors.link,
              border: `2px solid ${effectiveColors.border}`,
            }}
          >
            Link general
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: effectiveColors.cardBackground,
              color: effectiveColors.cardPrice,
              border: `2px solid ${effectiveColors.cardBorder}`,
            }}
          >
            Precio en card
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default React.memo(ColorsPanel)
