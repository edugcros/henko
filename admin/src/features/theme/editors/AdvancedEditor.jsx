import React from 'react'
import { Box, Typography, Paper, Grid, Switch, FormControlLabel, TextField } from '@mui/material'

const AdvancedEditor = ({ value, customCSS, customJS, onChange, onCSSChange, onJSChange }) => {
  const advanced = value || {}

  const handleChange = (field, newValue) => {
    onChange({ ...advanced, [field]: newValue })
  }

  return (
    <Box>
      {/* Performance */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Rendimiento
        </Typography>
        <Grid container spacing={2}>
          {[
            { key: 'lazyLoadImages', label: 'Lazy Loading de Imágenes' },
            { key: 'preloadFonts', label: 'Precargar Fuentes' },
            {
              key: 'optimizeImages',
              label: 'Optimización Automática de Imágenes',
            },
            { key: 'enableServiceWorker', label: 'Service Worker (PWA)' },
          ].map(({ key, label }) => (
            <Grid item xs={12} sm={6} key={key}>
              <FormControlLabel
                control={
                  <Switch
                    checked={advanced[key] !== false}
                    onChange={e => handleChange(key, e.target.checked)}
                  />
                }
                label={label}
              />
            </Grid>
          ))}
        </Grid>
      </Paper>

      {/* Analytics */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Analytics
        </Typography>
        <TextField
          fullWidth
          label="Google Analytics ID (G-XXXXXXXXXX)"
          value={advanced.analyticsId || ''}
          onChange={e => handleChange('analyticsId', e.target.value)}
          placeholder="G-XXXXXXXXXX"
        />
      </Paper>

      {/* Custom Code */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Código Personalizado
        </Typography>

        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            CSS Personalizado
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={6}
            value={customCSS || ''}
            onChange={e => onCSSChange(e.target.value)}
            placeholder="/* Tu CSS personalizado aquí */"
            sx={{
              '& .MuiInputBase-root': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            JavaScript Personalizado
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={6}
            value={customJS ?? advanced.customJS ?? ''}
            onChange={e => {
              if (onJSChange) {
                onJSChange(e.target.value)
              } else {
                handleChange('customJS', e.target.value)
              }
            }}
            placeholder="// Tu JavaScript personalizado aquí"
            sx={{
              '& .MuiInputBase-root': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />
        </Box>
      </Paper>

      {/* Danger Zone */}
      <Paper sx={{ p: 3, borderColor: 'error.main', border: 1 }}>
        <Typography variant="h6" color="error" gutterBottom>
          Zona de Peligro
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Estas acciones son irreversibles.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Exportar tema como JSON"
            InputProps={{ readOnly: true }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            placeholder="Importar desde JSON"
            InputProps={{ readOnly: true }}
            sx={{ flex: 1 }}
          />
        </Box>
      </Paper>
    </Box>
  )
}

export default AdvancedEditor
