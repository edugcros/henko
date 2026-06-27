// 📁 src/components/AnimationsEditor.jsx

import React, { useMemo } from 'react'
import {
  Box,
  Typography,
  Paper,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Slider,
  Divider,
} from '@mui/material'

// ===============================
// CONFIG
// ===============================
const PRESETS = {
  subtle: { duration: 200, easing: 'ease-out', hoverScale: 1.01 },
  smooth: { duration: 300, easing: 'ease-in-out', hoverScale: 1.02 },
  bouncy: { duration: 400, easing: 'ease-out', hoverScale: 1.05 },
  instant: { duration: 0, easing: 'linear', hoverScale: 1 },
  dramatic: { duration: 600, easing: 'ease-in-out', hoverScale: 1.08 },
}

const SELECTS = {
  preset: [
    { value: 'subtle', label: 'Sutil' },
    { value: 'smooth', label: 'Suave' },
    { value: 'bouncy', label: 'Elástico' },
    { value: 'instant', label: 'Instantáneo' },
    { value: 'dramatic', label: 'Dramático' },
  ],
  pageTransitions: [
    { value: 'fade', label: 'Fade' },
    { value: 'slide', label: 'Slide' },
    { value: 'scale', label: 'Scale' },
    { value: 'bounce', label: 'Bounce' },
  ],
  elementEntrance: [
    { value: 'fadeUp', label: 'Fade Up' },
    { value: 'fadeDown', label: 'Fade Down' },
    { value: 'fadeLeft', label: 'Fade Left' },
    { value: 'fadeRight', label: 'Fade Right' },
    { value: 'zoom', label: 'Zoom' },
    { value: 'none', label: 'None' },
  ],
  easing: [
    { value: 'linear', label: 'Linear' },
    { value: 'ease', label: 'Ease' },
    { value: 'ease-in', label: 'Ease In' },
    { value: 'ease-out', label: 'Ease Out' },
    { value: 'ease-in-out', label: 'Ease In Out' },
  ],
}

// ===============================
// COMPONENT
// ===============================
const AnimationsEditor = ({ value = {}, onChange }) => {
  const animations = value

  const update = (field, val) => {
    onChange({ ...animations, [field]: val })
  }

  const applyPreset = preset => {
    const config = PRESETS[preset] || PRESETS.smooth
    onChange({
      ...animations,
      preset,
      ...config,
    })
  }

  // Preview style memoizado (optimización)
  const previewStyle = useMemo(() => {
    const duration = animations.duration ?? 300
    const easing = animations.easing ?? 'ease-in-out'
    const stagger = animations.stagger ?? 0.1
    const hoverScale = animations.hoverScale ?? 1.02

    return i => ({
      transition: `all ${duration}ms ${easing} ${i * stagger}s`,
      '&:hover': {
        transform: `scale(${hoverScale})`,
      },
    })
  }, [animations])

  return (
    <Box>
      {/* ===================== PRESET ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Preset
        </Typography>

        <FormControl fullWidth size="small">
          <InputLabel>Preset</InputLabel>
          <Select
            value={animations.preset || 'smooth'}
            onChange={e => applyPreset(e.target.value)}
          >
            {SELECTS.preset.map(opt => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Paper>

      {/* ===================== BEHAVIOR ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Comportamiento
        </Typography>

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Page Transition</InputLabel>
              <Select
                value={animations.pageTransitions || 'fade'}
                onChange={e => update('pageTransitions', e.target.value)}
              >
                {SELECTS.pageTransitions.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Element Entrance</InputLabel>
              <Select
                value={animations.elementEntrance || 'fadeUp'}
                onChange={e => update('elementEntrance', e.target.value)}
              >
                {SELECTS.elementEntrance.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* ===================== TIMING ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Timing
        </Typography>

        <Box mb={3}>
          <Typography variant="caption">
            Duración ({animations.duration ?? 300}ms)
          </Typography>
          <Slider
            value={animations.duration ?? 300}
            onChange={(_, v) => update('duration', v)}
            min={0}
            max={1000}
            step={50}
            valueLabelDisplay="auto"
          />
        </Box>

        <Box>
          <Typography variant="caption">
            Stagger ({animations.stagger ?? 0.1}s)
          </Typography>
          <Slider
            value={animations.stagger ?? 0.1}
            onChange={(_, v) => update('stagger', v)}
            min={0}
            max={0.5}
            step={0.05}
            valueLabelDisplay="auto"
          />
        </Box>
      </Paper>

      {/* ===================== INTERACTION ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Interacción
        </Typography>

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Easing</InputLabel>
              <Select
                value={animations.easing || 'ease-in-out'}
                onChange={e => update('easing', e.target.value)}
              >
                {SELECTS.easing.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="caption">
              Hover Scale ({animations.hoverScale ?? 1.02})
            </Typography>
            <Slider
              value={animations.hoverScale ?? 1.02}
              onChange={(_, v) => update('hoverScale', v)}
              min={1}
              max={1.2}
              step={0.01}
              valueLabelDisplay="auto"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* ===================== ACCESSIBILITY ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Accesibilidad
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={animations.respectPrefersReducedMotion !== false}
              onChange={e =>
                update('respectPrefersReducedMotion', e.target.checked)
              }
            />
          }
          label="Respetar prefers-reduced-motion"
        />
      </Paper>

      {/* ===================== PREVIEW ===================== */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Preview
        </Typography>

        <Box display="flex" gap={2} justifyContent="center">
          {[0, 1, 2].map(i => (
            <Box
              key={i}
              sx={{
                width: 56,
                height: 56,
                borderRadius: 2,
                bgcolor: 'primary.main',
                ...previewStyle(i),
              }}
            />
          ))}
        </Box>
      </Paper>
    </Box>
  )
}

export default AnimationsEditor
