// 📁 src/features/theme/components/panels/HeroPanel.jsx

import React, { useMemo } from 'react'
import {
  Box,
  Typography,
  TextField,
  Paper,
  Grid,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Slider,
  Divider,
  Button,
} from '@mui/material'
import ImageUploader from '@components/ImageUploader'

// ===============================
// CONFIG
// ===============================
const ALIGNMENTS = ['left', 'center', 'right']

const HEIGHTS = {
  small: '40vh',
  medium: '60vh',
  large: '80vh',
  fullscreen: '100vh',
}

// ===============================
// COMPONENT
// ===============================
const HeroPanel = ({ value = {}, onChange, colors = {} }) => {
  const hero = value

  const update = (field, val) => {
    onChange({ ...hero, [field]: val })
  }

  // ===============================
  // PREVIEW COMPUTED
  // ===============================
  const previewStyles = useMemo(() => {
    const bg = hero.backgroundImage?.url
      ? `url(${hero.backgroundImage.url})`
      : `linear-gradient(135deg, ${colors.primary || '#1976d2'}, ${colors.secondary || '#21CBF3'})`

    return {
      backgroundImage: bg,
      height: HEIGHTS[hero.height || 'medium'],
      justifyContent: hero.alignment || 'center',
      textAlign: hero.alignment || 'center',
    }
  }, [hero, colors])

  return (
    <Box>
      {/* ===================== ENABLE ===================== */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={hero.enabled !== false}
              onChange={(e) => update('enabled', e.target.checked)}
            />
          }
          label="Mostrar Hero"
        />
      </Paper>

      {hero.enabled !== false && (
        <>
          {/* ===================== CONTENT ===================== */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Contenido
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Título"
                  value={hero.title || ''}
                  onChange={(e) => update('title', e.target.value)}
                />
              </Grid>

              <Grid item xs={12}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  label="Subtítulo"
                  value={hero.subtitle || ''}
                  onChange={(e) => update('subtitle', e.target.value)}
                />
              </Grid>
            </Grid>
          </Paper>

          {/* ===================== LAYOUT ===================== */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Layout
            </Typography>

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Alineación</InputLabel>
                  <Select
                    value={hero.alignment || 'center'}
                    onChange={(e) => update('alignment', e.target.value)}
                  >
                    {ALIGNMENTS.map((a) => (
                      <MenuItem key={a} value={a}>
                        {a}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} md={6}>
                <FormControl fullWidth size="small">
                  <InputLabel>Altura</InputLabel>
                  <Select
                    value={hero.height || 'medium'}
                    onChange={(e) => update('height', e.target.value)}
                  >
                    {Object.keys(HEIGHTS).map((h) => (
                      <MenuItem key={h} value={h}>
                        {h}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Paper>

          {/* ===================== CTA ===================== */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Call To Action
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={hero.showCta !== false}
                  onChange={(e) => update('showCta', e.target.checked)}
                />
              }
              label="Mostrar CTA"
            />

            {hero.showCta !== false && (
              <Grid container spacing={2} mt={1}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Texto"
                    value={hero.ctaText || ''}
                    onChange={(e) => update('ctaText', e.target.value)}
                  />
                </Grid>

                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Link"
                    value={hero.ctaLink || ''}
                    onChange={(e) => update('ctaLink', e.target.value)}
                  />
                </Grid>
              </Grid>
            )}
          </Paper>

          {/* ===================== MEDIA ===================== */}
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Imagen & Overlay
            </Typography>

            <ImageUploader
              value={hero.backgroundImage}
              onChange={(img) => update('backgroundImage', img)}
              label="Imagen"
            />

            <Box mt={3}>
              <Typography variant="caption">
                Overlay ({Math.round((hero.overlayOpacity ?? 0.3) * 100)}%)
              </Typography>

              <Slider
                value={hero.overlayOpacity ?? 0.3}
                onChange={(_, v) => update('overlayOpacity', v)}
                min={0}
                max={0.9}
                step={0.05}
                valueLabelDisplay="auto"
              />
            </Box>
          </Paper>

          {/* ===================== PREVIEW ===================== */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Preview
            </Typography>

            <Box
              sx={{
                ...previewStyles,
                borderRadius: 2,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                px: 4,
                overflow: 'hidden',
              }}
            >
              {/* Overlay */}
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  backgroundColor: `rgba(0,0,0,${hero.overlayOpacity ?? 0.3})`,
                }}
              />

              {/* Content */}
              <Box
                sx={{
                  position: 'relative',
                  zIndex: 1,
                  color: hero.textColor || '#fff',
                  maxWidth: 600,
                }}
              >
                <Typography variant="h4" gutterBottom>
                  {hero.title || 'Título del Hero'}
                </Typography>

                <Typography variant="body1">
                  {hero.subtitle || 'Subtítulo descriptivo'}
                </Typography>

                {hero.showCta !== false && (
                  <Button
                    variant="contained"
                    sx={{ mt: 2 }}
                  >
                    {hero.ctaText || 'Ver más'}
                  </Button>
                )}
              </Box>
            </Box>
          </Paper>
        </>
      )}
    </Box>
  )
}

export default HeroPanel