// 📁 src/components/HeaderEditor.jsx

import React from 'react'
import {
  Box,
  Typography,
  Paper,
  Grid,
  Switch,
  FormControlLabel,
  Slider,
  Divider,
} from '@mui/material'
import ImageUploader from '@components/ImageUploader'

// ===============================
// CONFIG
// ===============================
const TOGGLES = [
  { key: 'sticky', label: 'Sticky (fijo al scroll)' },
  { key: 'transparent', label: 'Transparente inicial' },
  { key: 'showLogo', label: 'Mostrar Logo' },
  { key: 'showSearch', label: 'Mostrar Búsqueda' },
  { key: 'showCart', label: 'Mostrar Carrito' },
  { key: 'showAccount', label: 'Mostrar Cuenta' },
  { key: 'showWishlist', label: 'Mostrar Wishlist' },
  { key: 'showCompare', label: 'Mostrar Comparador', defaultValue: false },
]

// ===============================
// COMPONENT
// ===============================
const HeaderEditor = ({ value = {}, onChange, onLogoUpload }) => {
  const header = value

  const update = (field, val) => {
    onChange({ ...header, [field]: val })
  }

  const updateLogo = (img) => {
    onChange({ ...header, logo: img })
  }

  return (
    <Box>
      {/* ===================== LAYOUT ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Layout
        </Typography>

        <Box>
          <Typography variant="caption">
            Altura ({header.height ?? 64}px)
          </Typography>

          <Slider
            value={header.height ?? 64}
            onChange={(_, v) => update('height', v)}
            min={48}
            max={120}
            step={4}
            valueLabelDisplay="auto"
          />
        </Box>
      </Paper>

      {/* ===================== BRANDING ===================== */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Branding
        </Typography>

        <Typography variant="caption" display="block" mb={1}>
          Logo
        </Typography>

        <ImageUploader
          value={header.logo}
          onChange={updateLogo}
          onUpload={onLogoUpload}
          label="Logo"
        />

        {header.showLogo !== false && (
          <Box mt={2}>
            <Typography variant="caption">
              Ancho del logo ({header.logoWidth ?? 120}px)
            </Typography>

            <Slider
              value={header.logoWidth ?? 120}
              onChange={(_, v) => update('logoWidth', v)}
              min={80}
              max={220}
              step={10}
              valueLabelDisplay="auto"
            />
          </Box>
        )}
      </Paper>

      {/* ===================== VISIBILITY ===================== */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Visibilidad & Comportamiento
        </Typography>

        <Grid container spacing={1}>
          {TOGGLES.map(({ key, label, defaultValue = true }) => (
            <Grid item xs={12} sm={6} key={key}>
              <FormControlLabel
                control={
                  <Switch
                    checked={defaultValue ? header[key] !== false : header[key] === true}
                    onChange={(e) => update(key, e.target.checked)}
                  />
                }
                label={label}
              />
            </Grid>
          ))}
        </Grid>
      </Paper>
    </Box>
  )
}

export default HeaderEditor
