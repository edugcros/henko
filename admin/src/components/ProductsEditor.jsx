import React from 'react'
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
} from '@mui/material'
import Section from '@components/Section'

const GRID_STYLES = [
  { value: 'grid', label: 'Cuadrícula' },
  { value: 'masonry', label: 'Masonry' },
  { value: 'list', label: 'Lista' },
]

const HOVER_EFFECTS = [
  { value: 'none', label: 'Ninguno' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'lift', label: 'Elevar' },
  { value: 'border', label: 'Borde' },
  { value: 'scale', label: 'Escala' },
]

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
]

const slugifySkuPart = value => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 24)
}

const isWeakSku = sku => {
  const normalized = String(sku || '')
    .trim()
    .toLowerCase()

  if (!normalized) return true

  return ['1', '2', '3', 'sku', 'default', 'sin-sku', 'n/a', 'na'].includes(
    normalized,
  )
}

const buildVariantSignature = variant => {
  const attrs = variant?.attributes || variant?.attributeValues || {}

  if (!attrs || typeof attrs !== 'object') return ''

  return Object.entries(attrs)
    .filter(
      ([, value]) =>
        value !== undefined && value !== null && String(value).trim(),
    )
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([key, value]) => `${slugifySkuPart(key)}-${slugifySkuPart(value)}`)
    .join('-')
}

const generateVariantSku = ({ productTitle, variant, index }) => {
  const titlePart = slugifySkuPart(productTitle || 'PRODUCTO').slice(0, 16)
  const variantPart = buildVariantSignature(variant)
  const indexPart = String(index + 1).padStart(2, '0')

  return [titlePart, variantPart, indexPart]
    .filter(Boolean)
    .join('-')
    .slice(0, 64)
}

const ensureUniqueVariantSkus = (variants = [], productTitle = '') => {
  if (!Array.isArray(variants)) return []

  const used = new Set()

  return variants.map((variant, index) => {
    const currentSku = String(variant?.sku || '').trim()
    let nextSku = currentSku

    if (isWeakSku(nextSku) || used.has(nextSku.toLowerCase())) {
      nextSku = generateVariantSku({
        productTitle,
        variant,
        index,
      })
    }

    let uniqueSku = nextSku
    let counter = 2

    while (used.has(uniqueSku.toLowerCase())) {
      uniqueSku = `${nextSku}-${counter}`
      counter += 1
    }

    used.add(uniqueSku.toLowerCase())

    return {
      ...variant,
      sku: uniqueSku,
    }
  })
}

const ProductsEditor = ({ value, onChange }) => {
  const products = value || {}

  const handleChange = (field, newValue) => {
    onChange({ ...products, [field]: newValue })
  }

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      {/* ================= LAYOUT ================= */}
      <Section title="Layout" subtitle="Estructura del grid de productos">
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Tipo de Grid</InputLabel>
              <Select
                value={products.gridStyle ?? 'grid'}
                onChange={e => handleChange('gridStyle', e.target.value)}
              >
                {GRID_STYLES.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="caption">
              Columnas: {products.columns ?? 4}
            </Typography>
            <Slider
              size="small"
              value={products.columns ?? 4}
              onChange={(_, v) => handleChange('columns', v)}
              min={1}
              max={6}
              step={1}
              valueLabelDisplay="auto"
            />
          </Grid>

          <Grid item xs={12}>
            <Typography variant="caption">
              Espaciado: {products.gap ?? 24}px
            </Typography>
            <Slider
              size="small"
              value={products.gap ?? 24}
              onChange={(_, v) => handleChange('gap', v)}
              min={0}
              max={48}
              step={4}
              valueLabelDisplay="auto"
            />
          </Grid>
        </Grid>
      </Section>

      {/* ================= VISUAL ================= */}
      <Section
        title="Estilo Visual"
        subtitle="Comportamiento e imagen de las cards"
      >
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <FormControl fullWidth size="small">
              <InputLabel>Efecto Hover</InputLabel>
              <Select
                value={products.hoverEffect ?? 'lift'}
                onChange={e => handleChange('hoverEffect', e.target.value)}
              >
                {HOVER_EFFECTS.map(opt => (
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
                value={products.imageAspectRatio ?? '1:1'}
                onChange={e => handleChange('imageAspectRatio', e.target.value)}
              >
                {ASPECT_RATIOS.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12}>
            <Typography variant="caption">
              Productos por página: {products.itemsPerPage ?? 12}
            </Typography>
            <Slider
              size="small"
              value={products.itemsPerPage ?? 12}
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
            { key: 'showBadge', label: 'Badge', defaultValue: true },
            { key: 'showQuickView', label: 'Quick View', defaultValue: true },
            { key: 'showWishlist', label: 'Wishlist', defaultValue: true },
            { key: 'showCompare', label: 'Comparar', defaultValue: false },
            { key: 'showRating', label: 'Rating', defaultValue: true },
            { key: 'showPrice', label: 'Precio', defaultValue: true },
          ].map(({ key, label, defaultValue }) => (
            <Grid item xs={12} md={6} key={key}>
              <FormControlLabel
                control={
                  <Switch
                    checked={
                      defaultValue
                        ? products[key] !== false
                        : products[key] === true
                    }
                    onChange={e => handleChange(key, e.target.checked)}
                  />
                }
                label={<Typography variant="body2">{label}</Typography>}
              />
            </Grid>
          ))}
        </Grid>
      </Section>
    </Box>
  )
}

export default ProductsEditor
