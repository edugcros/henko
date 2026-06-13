import React from 'react'
import {
  Box,
  Typography,
  TextField,
  Slider,
  Paper,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tabs,
  Tab,
  Divider,
} from '@mui/material'
import { FontDownload } from '@mui/icons-material'

const GOOGLE_FONTS = [
  'Roboto',
  'Montserrat',
  'Open Sans',
  'Inter',
  'Poppins',
  'Lato',
  'Raleway',
  'Playfair Display',
  'Merriweather',
  'Source Sans Pro',
  'Work Sans',
  'Nunito',
]

const TRANSFORM_OPTIONS = [
  { value: 'none', label: 'Normal' },
  { value: 'uppercase', label: 'MAYÚSCULAS' },
  { value: 'lowercase', label: 'minúsculas' },
  { value: 'capitalize', label: 'Capitalizar' },
]

const DEFAULT_HEADINGS = {
  h1: {
    size: 30,
    weight: 700,
    lineHeight: 1.2,
    letterSpacing: -0.5,
    transform: 'none',
  },
  h2: {
    size: 32,
    weight: 700,
    lineHeight: 1.3,
    letterSpacing: -0.3,
    transform: 'none',
  },
  h3: {
    size: 28,
    weight: 600,
    lineHeight: 1.3,
    letterSpacing: 0,
    transform: 'none',
  },
  h4: {
    size: 24,
    weight: 600,
    lineHeight: 1.4,
    letterSpacing: 0,
    transform: 'none',
  },
  h5: {
    size: 20,
    weight: 500,
    lineHeight: 1.4,
    letterSpacing: 0,
    transform: 'none',
  },
  h6: {
    size: 18,
    weight: 500,
    lineHeight: 1.5,
    letterSpacing: 0,
    transform: 'none',
  },
}

const TypographyEditor = ({ value, onChange }) => {
  const typography = value || {}
  const headings = typography.headings || DEFAULT_HEADINGS

  const handleGlobalChange = (field, newValue) => {
    onChange({ ...typography, [field]: newValue })
  }

  const handleHeadingChange = (headingKey, field, newValue) => {
    onChange({
      ...typography,
      headings: {
        ...headings,
        [headingKey]: {
          ...headings[headingKey],
          [field]: newValue,
        },
      },
    })
  }

  const handleSecondaryChange = (field, newValue) => {
    onChange({
      ...typography,
      secondary: {
        ...(typography.secondary || {}),
        [field]: newValue,
      },
    })
  }

  return (
    <Box>
      {/* Fuentes Globales */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Fuentes
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Fuente Principal</InputLabel>
              <Select
                value={typography.fontFamily || 'Roboto'}
                onChange={e => handleGlobalChange('fontFamily', e.target.value)}
              >
                {GOOGLE_FONTS.map(font => (
                  <MenuItem key={font} value={font}>
                    <span style={{ fontFamily: font }}>{font}</span>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Fuente Headings</InputLabel>
              <Select
                value={typography.headingFont || 'Montserrat'}
                onChange={e =>
                  handleGlobalChange('headingFont', e.target.value)
                }
              >
                {GOOGLE_FONTS.map(font => (
                  <MenuItem key={font} value={font}>
                    <span style={{ fontFamily: font }}>{font}</span>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Fuente Secundaria</InputLabel>
              <Select
                value={typography.secondaryFont || 'Open Sans'}
                onChange={e =>
                  handleGlobalChange('secondaryFont', e.target.value)
                }
              >
                {GOOGLE_FONTS.map(font => (
                  <MenuItem key={font} value={font}>
                    <span style={{ fontFamily: font }}>{font}</span>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <Box sx={{ mt: 3 }}>
          <Grid container spacing={3}>
            <Grid item xs={6}>
              <Typography variant="body2" gutterBottom>
                Tamaño Base: {typography.baseSize || 16}px
              </Typography>
              <Slider
                value={typography.baseSize || 16}
                onChange={(_, v) => handleGlobalChange('baseSize', v)}
                min={12}
                max={24}
                step={1}
                marks
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" gutterBottom>
                Escala: {typography.scale || 1.25}
              </Typography>
              <Slider
                value={typography.scale || 1.25}
                onChange={(_, v) => handleGlobalChange('scale', v)}
                min={1.1}
                max={1.5}
                step={0.05}
                marks
                valueLabelDisplay="auto"
              />
            </Grid>
          </Grid>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" gutterBottom>
            Line Height Global: {typography.lineHeight || 1.5}
          </Typography>
          <Slider
            value={typography.lineHeight || 1.5}
            onChange={(_, v) => handleGlobalChange('lineHeight', v)}
            min={1}
            max={2}
            step={0.1}
            marks
            valueLabelDisplay="auto"
          />
        </Box>
      </Paper>

      {/* Secondary Typography */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Tipografía Secundaria
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField
              fullWidth
              size="small"
              label="Tamaño (px)"
              type="number"
              value={typography.secondary?.size || 14}
              onChange={e =>
                handleSecondaryChange('size', Number(e.target.value))
              }
            />
          </Grid>
          <Grid item xs={6}>
            <TextField
              fullWidth
              size="small"
              label="Peso"
              type="number"
              value={typography.secondary?.weight || 400}
              onChange={e =>
                handleSecondaryChange('weight', Number(e.target.value))
              }
            />
          </Grid>
          <Grid item xs={6}>
            <Typography variant="body2" gutterBottom>
              Line Height
            </Typography>
            <Slider
              value={typography.secondary?.lineHeight || 1.6}
              onChange={(_, v) => handleSecondaryChange('lineHeight', v)}
              min={1}
              max={2}
              step={0.1}
              valueLabelDisplay="auto"
            />
          </Grid>
          <Grid item xs={6}>
            <Typography variant="body2" gutterBottom>
              Letter Spacing
            </Typography>
            <Slider
              value={typography.secondary?.letterSpacing || 0}
              onChange={(_, v) => handleSecondaryChange('letterSpacing', v)}
              min={-2}
              max={2}
              step={0.1}
              valueLabelDisplay="auto"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Headings Individuales */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Encabezados (H1-H6)
        </Typography>

        {['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(headingKey => {
          const heading = headings[headingKey] || DEFAULT_HEADINGS[headingKey]

          return (
            <Box
              key={headingKey}
              sx={{ mb: 3, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                }}
              >
                <Typography
                  variant={headingKey}
                  sx={{
                    fontFamily: typography.headingFont || 'Montserrat',
                    color: 'text.primary',
                  }}
                >
                  {headingKey.toUpperCase()} Preview
                </Typography>
                <FormControl size="small" sx={{ width: 120 }}>
                  <Select
                    value={heading.transform || 'none'}
                    onChange={e =>
                      handleHeadingChange(
                        headingKey,
                        'transform',
                        e.target.value,
                      )
                    }
                  >
                    {TRANSFORM_OPTIONS.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Tamaño (px)"
                    type="number"
                    value={heading.size}
                    onChange={e =>
                      handleHeadingChange(
                        headingKey,
                        'size',
                        Number(e.target.value),
                      )
                    }
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Peso"
                    type="number"
                    value={heading.weight}
                    onChange={e =>
                      handleHeadingChange(
                        headingKey,
                        'weight',
                        Number(e.target.value),
                      )
                    }
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption">Line Height</Typography>
                  <Slider
                    size="small"
                    value={heading.lineHeight}
                    onChange={(_, v) =>
                      handleHeadingChange(headingKey, 'lineHeight', v)
                    }
                    min={0.8}
                    max={2}
                    step={0.1}
                    valueLabelDisplay="auto"
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption">Letter Spacing</Typography>
                  <Slider
                    size="small"
                    value={heading.letterSpacing}
                    onChange={(_, v) =>
                      handleHeadingChange(headingKey, 'letterSpacing', v)
                    }
                    min={-2}
                    max={2}
                    step={0.1}
                    valueLabelDisplay="auto"
                  />
                </Grid>
              </Grid>
            </Box>
          )
        })}
      </Paper>
    </Box>
  )
}

export default TypographyEditor
