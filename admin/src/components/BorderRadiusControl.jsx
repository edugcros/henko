import React from 'react'
import { Box, Typography, Slider, Paper, Grid, TextField } from '@mui/material'

const BorderRadiusControl = ({ value, onChange }) => {
  // value es un objeto: { none, sm, md, lg, xl, full }

  const handleChange = (key, newValue) => {
    onChange({
      ...value,
      [key]: `${newValue}rem`,
    })
  }

  const presets = [
    { key: 'none', label: 'Ninguno', max: 0 },
    { key: 'sm', label: 'Pequeño', max: 0.5 },
    { key: 'md', label: 'Medio', max: 1 },
    { key: 'lg', label: 'Grande', max: 1.5 },
    { key: 'xl', label: 'Extra', max: 2 },
    { key: 'full', label: 'Completo', max: 50 },
  ]

  const getNumericValue = val => parseFloat(val?.replace('rem', '') || 0)

  return (
    <Paper
      elevation={0}
      sx={{ p: 3, border: '1px solid', borderColor: 'divider' }}
    >
      <Typography variant="h6" gutterBottom>
        Bordes Redondeados
      </Typography>

      <Grid container spacing={3}>
        {presets.map(preset => {
          const numericValue = getNumericValue(value?.[preset.key])

          return (
            <Grid item xs={12} sm={6} key={preset.key}>
              <Box sx={{ mb: 2 }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    mb: 1,
                  }}
                >
                  <Typography variant="body2" fontWeight={500}>
                    {preset.label}
                  </Typography>
                  <TextField
                    size="small"
                    value={value?.[preset.key] || '0rem'}
                    onChange={e =>
                      onChange({ ...value, [preset.key]: e.target.value })
                    }
                    sx={{ width: 80 }}
                    inputProps={{ style: { textAlign: 'center' } }}
                  />
                </Box>

                <Slider
                  value={numericValue}
                  onChange={(_, newVal) => handleChange(preset.key, newVal)}
                  min={0}
                  max={preset.max}
                  step={0.125}
                  marks={[
                    { value: 0, label: '0' },
                    { value: preset.max / 2, label: `${preset.max / 2}` },
                    { value: preset.max, label: `${preset.max}` },
                  ]}
                  valueLabelDisplay="auto"
                  valueLabelFormat={val => `${val}rem`}
                />

                {/* Visual Preview */}
                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                  <Box
                    sx={{
                      width: 60,
                      height: 60,
                      backgroundColor: 'primary.main',
                      borderRadius: value?.[preset.key] || 0,
                    }}
                  />
                </Box>
              </Box>
            </Grid>
          )
        })}
      </Grid>
    </Paper>
  )
}

export default BorderRadiusControl
