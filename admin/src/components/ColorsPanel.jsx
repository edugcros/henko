// 📁 src/components/ColorsPanel.jsx - VERSIÓN PRODUCCIÓN
import React, { useCallback, useMemo } from 'react';
import { Grid, Typography, Box, Tooltip, IconButton } from '@mui/material';
import ColorPicker from '@components/ColorPicker';
import RefreshIcon from '@mui/icons-material/Refresh';

// Colores por defecto del sistema (para reset rápido)
const DEFAULT_COLORS = {
  primary: '#1976d2',
  secondary: '#dc004e',
  accent: '#ff9800',
  background: '#ffffff',
  surface: '#f5f5f5',
  text: '#1a1a1a',
  mutedText: '#666666',
  border: '#e0e0e0',
  success: '#2e7d32',
  error: '#d32f2f',
  info: '#0288d1',
  warning: '#ed6c02',
};

// Presets de paletas populares
const COLOR_PRESETS = [
  { name: 'Azul Corporativo', primary: '#1565c0', secondary: '#ff6f00', accent: '#00b8d4' },
  { name: 'Verde Natural', primary: '#2e7d32', secondary: '#558b2f', accent: '#fbc02d' },
  { name: 'Rosa Moderno', primary: '#c2185b', secondary: '#7b1fa2', accent: '#ffd54f' },
  { name: 'Oscuro Premium', primary: '#90caf9', secondary: '#f48fb1', accent: '#ffe082', background: '#121212', surface: '#1e1e1e', text: '#ffffff' },
];

const ColorsPanel = ({ colors = {}, updateTheme, updateField, onChange }) => {
  // 🔥 Memoizar grupos de colores
  const mainColors = useMemo(() => [
    { key: 'primary', label: 'Primario', description: 'Botones principales, links y precios' },
    { key: 'secondary', label: 'Secundario', description: 'Badges promocionales y apoyos visuales' },
    { key: 'accent', label: 'Acento', description: 'CTAs especiales, iconos destacados e info' },
    { key: 'background', label: 'Fondo', description: 'Fondo de la página' },
    { key: 'surface', label: 'Superficie', description: 'Cards, modales, elementos elevados' },
    { key: 'text', label: 'Texto Principal', description: 'Títulos y contenido principal' },
    { key: 'mutedText', label: 'Texto Secundario', description: 'Subtítulos, descripciones' },
    { key: 'border', label: 'Bordes', description: 'Líneas divisorias, inputs' },
  ], []);

  const stateColors = useMemo(() => [
    { key: 'success', label: 'Éxito', description: 'Operaciones completadas, checkmarks' },
    { key: 'error', label: 'Error', description: 'Errores, validaciones fallidas' },
    { key: 'warning', label: 'Advertencia', description: 'Alertas, precauciones' },
    { key: 'info', label: 'Info', description: 'Información neutral, tips' },
  ], []);

  // 🔥 Handler optimizado con validación
  const handleColorChange = useCallback((key, value) => {
    // Validar formato HEX
    const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    
    if (!hexRegex.test(value)) {
      console.warn(`Color inválido para ${key}:`, value);
      return;
    }

    // Usar updateField con path notation (si está disponible) o updateTheme
    if (updateField) {
      updateField(`colors.${key}`, value);
    } else if (onChange) {
      onChange({ ...colors, [key]: value });
    } else if (updateTheme) {
      // Fallback: actualizar objeto completo
      updateTheme('colors', { ...colors, [key]: value });
    }
  }, [colors, updateField, updateTheme, onChange]);

  // 🔥 Reset individual de color
  const handleResetColor = useCallback((key) => {
    handleColorChange(key, DEFAULT_COLORS[key]);
  }, [handleColorChange]);

  // 🔥 Aplicar preset completo
  const handleApplyPreset = useCallback((preset) => {
    const { name, ...presetColors } = preset;
    const newColors = { ...colors, ...presetColors };

    if (onChange) {
      onChange(newColors);
      return;
    }

    if (updateTheme) {
      updateTheme('colors', newColors);
    }
  }, [colors, updateTheme, onChange]);

  // 🔥 Reset todos los colores
  const handleResetAll = useCallback(() => {
    if (window.confirm('¿Restaurar todos los colores a valores por defecto?')) {
      if (onChange) {
        onChange(DEFAULT_COLORS);
        return;
      }

      if (updateTheme) {
        updateTheme('colors', DEFAULT_COLORS);
      }
    }
  }, [updateTheme, onChange]);

  return (
    <Box>
      {/* PRESETS RÁPIDOS */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="subtitle2" gutterBottom>
          Paletas Rápidas
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {COLOR_PRESETS.map((preset) => (
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
                {[preset.primary, preset.secondary, preset.accent].map((color, i) => (
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
                ))}
              </Box>
            </Tooltip>
          ))}
        </Box>
      </Box>

      {/* COLORES PRINCIPALES */}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2">
              Colores Principales
            </Typography>
            <Tooltip title="Restaurar colores por defecto">
              <IconButton size="small" onClick={handleResetAll}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Grid>

        {mainColors.map(({ key, label, description }) => (
          <Grid item xs={12} sm={6} key={key}>
            <ColorPicker
              label={label}
              value={colors[key] || DEFAULT_COLORS[key]}
              onChange={(v) => handleColorChange(key, v)}
              helperText={description}
              showReset
              onReset={() => handleResetColor(key)}
              // Preview del color actual
              sx={{
                '& .MuiInputBase-root': {
                  borderLeft: `4px solid ${colors[key] || DEFAULT_COLORS[key]}`,
                },
              }}
            />
          </Grid>
        ))}

        {/* COLORES DE ESTADO */}
        <Grid item xs={12}>
          <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
            Estados (Feedback)
          </Typography>
        </Grid>

        {stateColors.map(({ key, label, description }) => (
          <Grid item xs={6} sm={3} key={key}>
            <ColorPicker
              label={label}
              value={colors[key] || DEFAULT_COLORS[key]}
              onChange={(v) => handleColorChange(key, v)}
              helperText={description}
              size="small"
              showReset
              onReset={() => handleResetColor(key)}
            />
          </Grid>
        ))}
      </Grid>

      {/* PREVIEW DE CONTRASTE */}
      <Box sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Preview de Contraste
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: colors.primary || DEFAULT_COLORS.primary,
              color: colors.background || DEFAULT_COLORS.background,
            }}
          >
            Primario sobre Fondo
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: colors.surface || DEFAULT_COLORS.surface,
              color: colors.text || DEFAULT_COLORS.text,
            }}
          >
            Texto en Superficie
          </Box>
          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: colors.background || DEFAULT_COLORS.background,
              color: colors.primary || DEFAULT_COLORS.primary,
              border: `2px solid ${colors.border || DEFAULT_COLORS.border}`,
            }}
          >
            Primario en Fondo
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default React.memo(ColorsPanel);
