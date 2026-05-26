import React from 'react';
import {
  Box,
  Typography,
  Slider,
  Paper,
  Grid,
  TextField,
} from '@mui/material';

const SpacingEditor = ({ value, onChange }) => {
  const spacing = value || {};

  const handleChange = (field, newValue) => {
    onChange({ ...spacing, [field]: newValue });
  };

  const spacingFields = [
    { key: 'section', label: 'Espaciado de Secciones', min: 0, max: 128, unit: 'px', description: 'Espacio entre secciones principales' },
    { key: 'container', label: 'Padding del Contenedor', min: 0, max: 48, unit: 'px', description: 'Padding horizontal del layout' },
    { key: 'radius', label: 'Radio de Bordes Global', min: 0, max: 32, unit: 'px', description: 'Border radius por defecto' },
    { key: 'cardPadding', label: 'Padding de Tarjetas', min: 0, max: 32, unit: 'px', description: 'Padding interno de cards' },
  ];

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Espaciado</Typography>
      
      <Grid container spacing={4}>
        {spacingFields.map(({ key, label, min, max, unit, description }) => (
          <Grid item xs={12} key={key}>
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Box>
                  <Typography variant="subtitle2" fontWeight={600}>{label}</Typography>
                  <Typography variant="caption" color="text.secondary">{description}</Typography>
                </Box>
                <TextField
                  size="small"
                  type="number"
                  value={spacing[key] ?? 0}
                  onChange={(e) => handleChange(key, Number(e.target.value))}
                  sx={{ width: 80 }}
                  inputProps={{ min, max }}
                />
              </Box>
              
              <Slider
                value={spacing[key] ?? 0}
                onChange={(_, v) => handleChange(key, v)}
                min={min}
                max={max}
                step={key === 'radius' ? 1 : 4}
                marks={[
                  { value: min, label: `${min}${unit}` },
                  { value: max, label: `${max}${unit}` },
                ]}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v}${unit}`}
              />

              {/* Visual Preview */}
              <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', height: 80, bgcolor: 'grey.100', borderRadius: 1 }}>
                {key === 'section' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{ width: 60, height: 40, bgcolor: 'primary.main', borderRadius: 1 }} />
                    <Box sx={{ 
                      width: 20, 
                      height: spacing[key] ?? 64, 
                      bgcolor: 'secondary.main',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 1
                    }}>
                      <Typography variant="caption" sx={{ transform: 'rotate(-90deg)', color: 'white', whiteSpace: 'nowrap' }}>
                        {spacing[key] ?? 64}px
                      </Typography>
                    </Box>
                    <Box sx={{ width: 60, height: 40, bgcolor: 'primary.main', borderRadius: 1 }} />
                  </Box>
                )}
                {key === 'container' && (
                  <Box sx={{ width: '80%', height: 60, bgcolor: 'grey.300', borderRadius: 1, display: 'flex' }}>
                    <Box sx={{ width: (spacing[key] ?? 24), bgcolor: 'secondary.main', height: '100%' }} />
                    <Box sx={{ flex: 1, bgcolor: 'primary.main', height: '100%' }} />
                    <Box sx={{ width: (spacing[key] ?? 24), bgcolor: 'secondary.main', height: '100%' }} />
                  </Box>
                )}
                {key === 'radius' && (
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Box sx={{ 
                      width: 60, 
                      height: 60, 
                      bgcolor: 'primary.main',
                      borderRadius: (spacing[key] ?? 12) / 4
                    }} />
                    <Box sx={{ 
                      width: 60, 
                      height: 60, 
                      bgcolor: 'secondary.main',
                      borderRadius: (spacing[key] ?? 12) / 2
                    }} />
                    <Box sx={{ 
                      width: 60, 
                      height: 60, 
                      bgcolor: 'success.main',
                      borderRadius: (spacing[key] ?? 12)
                    }} />
                  </Box>
                )}
                {key === 'cardPadding' && (
                  <Box sx={{ 
                    bgcolor: 'grey.200', 
                    borderRadius: 2,
                    p: (spacing[key] ?? 0) / 8
                  }}>
                    <Box sx={{ width: 80, height: 50, bgcolor: 'primary.main', borderRadius: 1 }} />
                  </Box>
                )}
              </Box>
            </Box>
          </Grid>
        ))}
      </Grid>
    </Paper>
  );
};

export default SpacingEditor;
