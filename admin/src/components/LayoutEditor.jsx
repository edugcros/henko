import React from 'react'
import { Box, Typography, Slider, Paper, Grid, TextField } from '@mui/material'

const LayoutEditor = ({ value, onChange }) => {
  const layout = value || {}

  const handleChange = (field, newValue) => {
    onChange({ ...layout, [field]: newValue })
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Layout General
      </Typography>

      <Grid container spacing={3}>
        {/* Max Width */}
        <Grid item xs={12}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Ancho Máximo del Contenedor: {layout.maxWidth ?? 1200}px
            </Typography>
            <Slider
              value={layout.maxWidth ?? 1200}
              onChange={(_, v) => handleChange('maxWidth', v)}
              min={800}
              max={1600}
              step={50}
              marks={[
                { value: 800, label: '800' },
                { value: 1200, label: '1200' },
                { value: 1600, label: '1600' },
              ]}
              valueLabelDisplay="auto"
            />
          </Box>
        </Grid>

        {/* Container Padding */}
        <Grid item xs={12}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Padding Horizontal: {layout.containerPadding ?? 0}px
            </Typography>
            <Slider
              value={layout.containerPadding ?? 0}
              onChange={(_, v) => handleChange('containerPadding', v)}
              min={0}
              max={64}
              step={4}
              marks
              valueLabelDisplay="auto"
            />
          </Box>
        </Grid>

        {/* Border Radius */}
        <Grid item xs={12}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Radio de Bordes (Layout): {layout.borderRadius ?? 8}px
            </Typography>
            <Slider
              value={layout.borderRadius ?? 8}
              onChange={(_, v) => handleChange('borderRadius', v)}
              min={0}
              max={24}
              step={1}
              marks
              valueLabelDisplay="auto"
            />
          </Box>
        </Grid>

        {/* Shadow Intensity */}
        <Grid item xs={12}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Intensidad de Sombras: {layout.shadowIntensity ?? 2}
            </Typography>
            <Slider
              value={layout.shadowIntensity ?? 2}
              onChange={(_, v) => handleChange('shadowIntensity', v)}
              min={0}
              max={5}
              step={1}
              marks={[
                { value: 0, label: 'Ninguna' },
                { value: 2, label: 'Normal' },
                { value: 5, label: 'Alta' },
              ]}
              valueLabelDisplay="auto"
            />
          </Box>
        </Grid>
      </Grid>

      {/* Visual Preview */}
      <Box sx={{ mt: 3, p: 3, bgcolor: 'grey.100', borderRadius: 2 }}>
        <Typography variant="subtitle2" gutterBottom align="center">
          Preview del Contenedor
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Box
            sx={{
              width: `${(layout.maxWidth ?? 1200) / 10}px`,
              maxWidth: '100%',
              height: 100,
              bgcolor: 'background.paper',
              borderRadius: (layout.borderRadius ?? 8) / 4,
              boxShadow: layout.shadowIntensity
                ? `${layout.shadowIntensity}px ${layout.shadowIntensity}px ${layout.shadowIntensity * 3}px rgba(0,0,0,${0.1 + layout.shadowIntensity * 0.02})`
                : 'none',
              border: '2px solid',
              borderColor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {layout.maxWidth ?? 1200}px
            </Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  )
}

export default LayoutEditor
