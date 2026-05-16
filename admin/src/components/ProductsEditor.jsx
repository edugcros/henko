import React from 'react';
import {
  Box,
  Typography,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Slider,
} from '@mui/material';
import Section from '@components/Section';

const GRID_STYLES = [
  { value: 'grid', label: 'Cuadrícula' },
  { value: 'masonry', label: 'Masonry' },
  { value: 'list', label: 'Lista' },
];

const HOVER_EFFECTS = [
  { value: 'none', label: 'Ninguno' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'lift', label: 'Elevar' },
  { value: 'border', label: 'Borde' },
  { value: 'scale', label: 'Escala' },
];

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
];

const ProductsEditor = ({ value, onChange }) => {
  const products = value || {};

  const handleChange = (field, newValue) => {
    onChange({ ...products, [field]: newValue });
  };

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      
      {/* ================= LAYOUT ================= */}
      <Section title="Layout" subtitle="Estructura del grid de productos">
        <Grid container spacing={2}>
          
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Tipo de Grid</InputLabel>
              <Select
                value={products.gridStyle || 'grid'}
                onChange={(e) => handleChange('gridStyle', e.target.value)}
              >
                {GRID_STYLES.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="caption">
              Columnas: {products.columns || 4}
            </Typography>
            <Slider
              size="small"
              value={products.columns || 4}
              onChange={(_, v) => handleChange('columns', v)}
              min={1}
              max={6}
              step={1}
              valueLabelDisplay="auto"
            />
          </Grid>

          <Grid item xs={12}>
            <Typography variant="caption">
              Espaciado: {products.gap || 24}px
            </Typography>
            <Slider
              size="small"
              value={products.gap || 24}
              onChange={(_, v) => handleChange('gap', v)}
              min={8}
              max={48}
              step={4}
              valueLabelDisplay="auto"
            />
          </Grid>
        </Grid>
      </Section>

      {/* ================= VISUAL ================= */}
      <Section title="Estilo Visual" subtitle="Comportamiento e imagen de las cards">
        <Grid container spacing={2}>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Efecto Hover</InputLabel>
              <Select
                value={products.hoverEffect || 'lift'}
                onChange={(e) => handleChange('hoverEffect', e.target.value)}
              >
                {HOVER_EFFECTS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Aspect Ratio</InputLabel>
              <Select
                value={products.imageAspectRatio || '1:1'}
                onChange={(e) => handleChange('imageAspectRatio', e.target.value)}
              >
                {ASPECT_RATIOS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="caption">
              Productos por página: {products.itemsPerPage || 12}
            </Typography>
            <Slider
              size="small"
              value={products.itemsPerPage || 12}
              onChange={(_, v) => handleChange('itemsPerPage', v)}
              min={4}
              max={48}
              step={4}
              valueLabelDisplay="auto"
            />
          </Grid>
        </Grid>
      </Section>

      {/* ================= FEATURES ================= */}
      <Section title="Elementos" subtitle="Control de visibilidad en cards">
        <Grid container spacing={1}>
          {[
            { key: 'showBadge', label: 'Badge' },
            { key: 'showQuickView', label: 'Quick View' },
            { key: 'showWishlist', label: 'Wishlist' },
            { key: 'showCompare', label: 'Comparar' },
            { key: 'showRating', label: 'Rating' },
            { key: 'showPrice', label: 'Precio' },
          ].map(({ key, label }) => (
            <Grid item xs={12} md={6} key={key}>
              <FormControlLabel
                control={
                  <Switch
                    checked={products[key] !== false}
                    onChange={(e) => handleChange(key, e.target.checked)}
                  />
                }
                label={
                  <Typography variant="body2">{label}</Typography>
                }
              />
            </Grid>
          ))}
        </Grid>
      </Section>

    </Box>
  );
};

export default ProductsEditor;