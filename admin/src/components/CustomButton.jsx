import React from 'react';
import {
  Box,
  Typography,
  Slider,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Button,
} from '@mui/material';

const CustomButton = ({ value, onChange }) => {
  const buttons = value || {};

  const handleChange = (field, newValue) => {
    onChange({ ...buttons, [field]: newValue });
  };

  const sizeOptions = [
    { value: 'small', label: 'Pequeño' },
    { value: 'medium', label: 'Mediano' },
    { value: 'large', label: 'Grande' },
  ];

  const variantOptions = [
    { value: 'text', label: 'Texto' },
    { value: 'outlined', label: 'Contorno' },
    { value: 'contained', label: 'Sólido' },
  ];

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Configuración de Botones</Typography>
      
      <Grid container spacing={3}>
        {/* Radio de bordes */}
        <Grid item xs={12}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Radio de Bordes: {buttons.radius ?? 8}px
            </Typography>
            <Slider
              value={buttons.radius ?? 8}
              onChange={(_, v) => handleChange('radius', v)}
              min={0}
              max={24}
              step={1}
              marks={[{ value: 0, label: '0' }, { value: 12, label: '12' }, { value: 24, label: '24' }]}
              valueLabelDisplay="auto"
            />
          </Box>
        </Grid>

        {/* Elevación */}
        <Grid item xs={12}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Elevación (sombra): {buttons.elevation ?? 2}
            </Typography>
            <Slider
              value={buttons.elevation ?? 2}
              onChange={(_, v) => handleChange('elevation', v)}
              min={0}
              max={8}
              step={1}
              marks
              valueLabelDisplay="auto"
            />
          </Box>
        </Grid>

        {/* Mayúsculas */}
        <Grid item xs={12} sm={6}>
          <FormControlLabel
            control={
              <Switch
                checked={buttons.uppercase || false}
                onChange={(e) => handleChange('uppercase', e.target.checked)}
              />
            }
            label="Texto en Mayúsculas"
          />
        </Grid>

        {/* Tamaño */}
        <Grid item xs={12} sm={6}>
          <FormControl fullWidth size="small">
            <InputLabel>Tamaño por Defecto</InputLabel>
            <Select
              value={buttons.size ?? 'medium'}
              onChange={(e) => handleChange('size', e.target.value)}
            >
              {sizeOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Variante */}
        <Grid item xs={12}>
          <FormControl fullWidth size="small">
            <InputLabel>Variante por Defecto</InputLabel>
            <Select
              value={buttons.variant ?? 'contained'}
              onChange={(e) => handleChange('variant', e.target.value)}
            >
              {variantOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
      </Grid>

      {/* Preview */}
      <Box sx={{ mt: 4, p: 3, bgcolor: 'grey.100', borderRadius: 2, textAlign: 'center' }}>
        <Typography variant="subtitle2" gutterBottom>Vista Previa</Typography>
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant={buttons.variant ?? 'contained'}
            size={buttons.size ?? 'medium'}
            sx={{ 
              borderRadius: buttons.radius ?? 8,
              textTransform: buttons.uppercase ? 'uppercase' : 'none',
              boxShadow: (buttons.elevation ?? 2) > 0 ? `${buttons.elevation ?? 2}px ${buttons.elevation ?? 2}px ${(buttons.elevation ?? 2) * 2}px rgba(0,0,0,0.2)` : 'none'
            }}
          >
            Botón Primario
          </Button>
          <Button
            variant={(buttons.variant ?? 'contained') === 'contained' ? 'outlined' : 'contained'}
            color="secondary"
            size={buttons.size ?? 'medium'}
            sx={{ 
              borderRadius: buttons.radius ?? 8,
              textTransform: buttons.uppercase ? 'uppercase' : 'none'
            }}
          >
            Botón Secundario
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

export default CustomButton;
