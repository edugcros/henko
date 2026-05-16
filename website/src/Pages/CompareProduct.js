// 📁 src/Components/CompareProduct.jsx
import React, { useMemo, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { removeFromCompare, clearCompare } from '@features/compare/compareSlice'
import Meta from '@components/Meta'
import Container from '@components/Container'
import { motion, AnimatePresence } from 'framer-motion'

import {
  Grid,
  Card,
  CardMedia,
  Typography,
  IconButton,
  Button,
  Box,
  TableContainer,
  Table,
  TableRow,
  TableCell,
  TableBody,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  Zoom,
  Avatar,
  Stack,
  useTheme,
  alpha,
  Badge,
} from '@mui/material'

import {
  Close as CloseIcon,
  DeleteSweep as ClearIcon,
  Storefront as ShopIcon,
  InfoOutlined as InfoIcon,
  CheckCircle as BestIcon,
  DifferenceOutlined as DiffIcon,
  Palette as ColorIcon,
  Straighten as SizeIcon,
  Style as MaterialIcon,
  Label as TagIcon,
  Inventory2 as StockIcon,
  AttachMoney as PriceIcon,
  Category as CategoryIcon,
  DescriptionOutlined as DescriptionIcon,
} from '@mui/icons-material'

// ==========================================
// CONFIGURACIÓN DE CAMPOS
// ==========================================

const BASE_FIELDS = [
  {
    key: 'title',
    label: 'Producto',
    type: 'title',
    icon: null,
    category: 'general',
  },
  {
    key: 'shortDescription',
    label: 'Descripción breve',
    type: 'description',
    icon: DescriptionIcon,
    category: 'general',
  },
  {
    key: 'marca',
    label: 'Marca',
    type: 'string',
    icon: CategoryIcon,
    category: 'general',
  },
  {
    key: 'condicion',
    label: 'Condición',
    type: 'badge',
    icon: TagIcon,
    category: 'general',
  },
  {
    key: 'categoria',
    label: 'Categoría',
    type: 'string',
    icon: CategoryIcon,
    category: 'general',
  },
  {
    key: 'price',
    label: 'Precio',
    type: 'currency',
    icon: PriceIcon,
    category: 'pricing',
    highlight: 'lower',
  },
  {
    key: 'stock',
    label: 'Stock',
    type: 'number',
    icon: StockIcon,
    category: 'inventory',
    highlight: 'higher',
  },
]

const PHYSICAL_ATTRIBUTES = [
  {
    key: 'color',
    label: 'Color',
    type: 'color',
    icon: ColorIcon,
    paths: ['color', 'atributos.color'],
  },
  {
    key: 'material',
    label: 'Material',
    type: 'string',
    icon: MaterialIcon,
    paths: ['material', 'atributos.material'],
  },
  {
    key: 'talle',
    label: 'Talle / Talla',
    type: 'string',
    icon: SizeIcon,
    paths: ['atributos.talle', 'atributos.talla'],
  },
  {
    key: 'genero',
    label: 'Género',
    type: 'string',
    icon: TagIcon,
    paths: ['atributos.genero', 'atributos.sexo'],
  },
  {
    key: 'estilo',
    label: 'Estilo',
    type: 'string',
    icon: TagIcon,
    paths: ['atributos.estilo'],
  },
  {
    key: 'temporada',
    label: 'Temporada',
    type: 'string',
    icon: TagIcon,
    paths: ['atributos.temporada'],
  },
]

// ==========================================
// HELPERS
// ==========================================

const getNestedValue = (obj, path) => {
  if (!obj || !path) return undefined
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}

const normalizeText = value => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

const stripHtml = value => {
  return normalizeText(value).replace(/<[^>]*>/g, ' ')
}

const compactSpaces = value => {
  return normalizeText(value).replace(/\s+/g, ' ').trim()
}

const truncateText = (value, maxLength = 130) => {
  const clean = compactSpaces(stripHtml(value))

  if (!clean) return ''
  if (clean.length <= maxLength) return clean

  return `${clean.slice(0, maxLength).trim()}...`
}

const normalizeArray = value => {
  if (value === undefined || value === null || value === '') return []

  const arr = Array.isArray(value) ? value : [value]

  return [
    ...new Set(
      arr
        .flat()
        .map(item => normalizeText(item))
        .filter(Boolean),
    ),
  ]
}

const getFirstValueFromPaths = (item, paths = []) => {
  for (const path of paths) {
    const value = getNestedValue(item, path)

    if (Array.isArray(value) && value.length > 0) return value
    if (!Array.isArray(value) && value !== undefined && value !== null && value !== '') return value
  }

  return undefined
}

const getProductImage = product => {
  if (!product) return '/assets/images/placeholder.png'

  if (typeof product.image === 'string') return product.image
  if (product.image?.url) return product.image.url

  if (Array.isArray(product.images) && product.images[0]) {
    if (typeof product.images[0] === 'string') return product.images[0]
    return product.images[0]?.url || '/assets/images/placeholder.png'
  }

  return '/assets/images/placeholder.png'
}

const getProductDescription = product => {
  return (
    product?.shortDescription ||
    product?.descriptionShort ||
    product?.summary ||
    product?.excerpt ||
    product?.description ||
    product?.desc ||
    ''
  )
}

const getShortTitle = (title, maxLength = 50) => {
  const clean = normalizeText(title)
  if (!clean) return 'Producto sin título'
  return clean.length <= maxLength ? clean : `${clean.substring(0, maxLength).trim()}...`
}

const formatValue = (value, type) => {
  if (value === undefined || value === null || value === '') return null

  switch (type) {
    case 'currency':
      return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        maximumFractionDigits: 0,
      }).format(Number(value) || 0)

    case 'number':
      return Number(value || 0).toLocaleString('es-AR')

    case 'array':
      return normalizeArray(value)

    case 'color':
      return normalizeArray(value)

    case 'description':
      return truncateText(value, 140)

    default:
      return String(value)
  }
}

const getColorValue = color => {
  const clean = normalizeText(color).toLowerCase()

  const colorMap = {
    negro: '#1a1a1a',
    black: '#1a1a1a',
    blanco: '#f5f5f5',
    white: '#f5f5f5',
    rojo: '#d32f2f',
    red: '#d32f2f',
    azul: '#1976d2',
    blue: '#1976d2',
    verde: '#2e7d32',
    green: '#2e7d32',
    amarillo: '#fbc02d',
    yellow: '#fbc02d',
    gris: '#9e9e9e',
    gray: '#9e9e9e',
    grey: '#9e9e9e',
    marron: '#795548',
    marrón: '#795548',
    brown: '#795548',
    beige: '#d7ccc8',
    rosa: '#e91e63',
    pink: '#e91e63',
    violeta: '#7b1fa2',
    purple: '#7b1fa2',
    naranja: '#f57c00',
    orange: '#f57c00',
  }

  if (clean.startsWith('#') || clean.startsWith('rgb')) return clean

  return colorMap[clean] || clean
}

const hasRealValue = value => {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  return String(value).trim() !== ''
}

const isSameValue = (a, b) => {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// ==========================================
// SUBCOMPONENTE: CELDA DE ATRIBUTO
// ==========================================

const AttributeCell = ({ value, type, isBest, isDifferent, rowKey }) => {
  const theme = useTheme()

  if (value === null || value === undefined || value === '') {
    return (
      <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
        No especificado
      </Typography>
    )
  }

  if (type === 'color' || rowKey === 'color') {
    const colors = Array.isArray(value) ? value : [value]

    return (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="center" gap={0.5}>
        {colors.map((color, idx) => (
          <Tooltip key={`${color}-${idx}`} title={color} arrow>
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                bgcolor: getColorValue(color),
                border: '2px solid',
                borderColor: 'divider',
                boxShadow: 1,
                transition: 'transform 0.2s ease',
                '&:hover': { transform: 'scale(1.2)' },
              }}
            />
          </Tooltip>
        ))}
      </Stack>
    )
  }

  if (Array.isArray(value)) {
    return (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="center" gap={0.5}>
        {value.slice(0, 3).map((item, idx) => (
          <Chip
            key={`${item}-${idx}`}
            label={item}
            size="small"
            variant="outlined"
            sx={{
              fontSize: '0.75rem',
              height: 24,
              bgcolor: isDifferent ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
            }}
          />
        ))}

        {value.length > 3 && (
          <Chip
            label={`+${value.length - 3}`}
            size="small"
            sx={{ fontSize: '0.75rem', height: 24 }}
          />
        )}
      </Stack>
    )
  }

  if (type === 'description') {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          lineHeight: 1.6,
          textAlign: 'left',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {value}
      </Typography>
    )
  }

  return (
    <Box display="flex" flexDirection="column" alignItems="center" gap={0.5}>
      <Typography
        variant="body2"
        sx={{
          fontWeight: isBest ? 700 : isDifferent ? 600 : 400,
          color: isBest ? 'success.main' : isDifferent ? 'text.primary' : 'text.secondary',
          fontSize: type === 'currency' ? '1.05rem' : '0.9rem',
        }}
      >
        {value}
      </Typography>

      {isBest && (
        <Zoom in>
          <Chip
            icon={<BestIcon sx={{ fontSize: 14 }} />}
            label="Mejor"
            color="success"
            size="small"
            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700 }}
          />
        </Zoom>
      )}
    </Box>
  )
}

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================

const CompareProduct = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const theme = useTheme()

  const { items = [] } = useSelector(state => state.compare || {})

  const [openModal, setOpenModal] = useState(false)
  const [modalContent, setModalContent] = useState({ title: '', text: '' })

  const comparisonData = useMemo(() => {
    if (items.length === 0) return { sections: [], allRows: [] }

    const baseRows = BASE_FIELDS.map(field => {
      const values = items.map(item => {
        const raw =
          field.key === 'shortDescription'
            ? getProductDescription(item)
            : getNestedValue(item, field.path) ?? item[field.key]

        return {
          raw,
          formatted: formatValue(raw, field.type),
          productId: item._id,
        }
      })

      const validValues = values.filter(v => hasRealValue(v.raw))

      if (validValues.length === 0) return null

      const isDifferent =
        validValues.length > 1 &&
        !validValues.every(v => isSameValue(v.raw, validValues[0].raw))

      let bestIndex = -1

      if (field.highlight === 'lower' && field.type === 'currency') {
        const numericValues = values.map(v => Number(v.raw)).filter(Number.isFinite)

        if (numericValues.length > 0) {
          const minVal = Math.min(...numericValues)
          bestIndex = values.findIndex(v => Number(v.raw) === minVal)
        }
      }

      if (field.highlight === 'higher' && field.type === 'number') {
        const numericValues = values.map(v => Number(v.raw)).filter(Number.isFinite)

        if (numericValues.length > 0) {
          const maxVal = Math.max(...numericValues)
          bestIndex = values.findIndex(v => Number(v.raw) === maxVal)
        }
      }

      return { ...field, values, isDifferent, bestIndex }
    }).filter(Boolean)

    const physicalRows = PHYSICAL_ATTRIBUTES.map(field => {
      const values = items.map(item => {
        let raw = getFirstValueFromPaths(item, field.paths)

        if (!hasRealValue(raw) && Array.isArray(item.variants) && item.variants.length > 0) {
          const variantValues = item.variants
            .filter(variant => variant.isActive !== false)
            .flatMap(variant => Object.entries(variant.attributes || {}))
            .filter(([key]) => field.paths.some(path => path.endsWith(key)))
            .map(([, val]) => val)

          raw = normalizeArray(variantValues)
        }

        return {
          raw,
          formatted: formatValue(raw, field.type),
          productId: item._id,
        }
      })

      const validValues = values.filter(v => hasRealValue(v.raw))
      if (validValues.length === 0) return null

      const isDifferent =
        validValues.length > 1 &&
        !validValues.every(v => isSameValue(v.raw, validValues[0].raw))

      return { ...field, values, isDifferent, bestIndex: -1 }
    }).filter(Boolean)

    const variantAttributeKeys = new Set()

    items.forEach(item => {
      item.variantAttributes?.forEach(attr => {
        if (attr?.name) variantAttributeKeys.add(attr.name)
      })
    })

    const variantRows = Array.from(variantAttributeKeys)
      .map(attrName => {
        const values = items.map(item => {
          const attrConfig = item.variantAttributes?.find(attr => attr.name === attrName)
          const availableValues = normalizeArray(item.availableAttributes?.[attrName])

          return {
            raw: availableValues,
            formatted: availableValues,
            productId: item._id,
            label: attrConfig?.label || attrName,
          }
        })

        const validValues = values.filter(v => hasRealValue(v.raw))
        if (validValues.length === 0) return null

        return {
          key: `variant_${attrName}`,
          label: values.find(v => v.label)?.label || attrName,
          type: 'array',
          icon: TagIcon,
          values,
          isDifferent:
            validValues.length > 1 &&
            !validValues.every(v => isSameValue(v.raw, validValues[0].raw)),
          bestIndex: -1,
          category: 'variants',
        }
      })
      .filter(Boolean)

    const sections = [
      {
        title: 'Información General',
        icon: CategoryIcon,
        rows: baseRows.filter(row => row.category === 'general' || !row.category),
      },
      {
        title: 'Precio y Disponibilidad',
        icon: PriceIcon,
        rows: baseRows.filter(row => row.category === 'pricing' || row.category === 'inventory'),
      },
      {
        title: 'Características Físicas',
        icon: MaterialIcon,
        rows: physicalRows,
      },
    ].filter(section => section.rows.length > 0)

    if (variantRows.length > 0) {
      sections.push({
        title: 'Variantes Disponibles',
        icon: SizeIcon,
        rows: variantRows,
      })
    }

    return {
      sections,
      allRows: [...baseRows, ...physicalRows, ...variantRows],
    }
  }, [items])

  const handleOpenDetails = (title, text) => {
    setModalContent({
      title: title || 'Detalle del producto',
      text: text || 'No hay descripción disponible.',
    })
    setOpenModal(true)
  }

  if (items.length === 0) {
    return (
      <Container class1="py-5">
        <Meta title="Comparar productos" />

        <Box
          textAlign="center"
          py={12}
          sx={{
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`,
            borderRadius: 4,
          }}
        >
          <ShopIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 3, opacity: 0.5 }} />

          <Typography variant="h3" fontWeight={800} color="text.primary" gutterBottom>
            Comparador Vacío
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mb: 4, maxWidth: 440, mx: 'auto' }}
          >
            Seleccioná productos para comparar precios, stock, descripción breve y atributos clave
            lado a lado.
          </Typography>

          <Button
            variant="contained"
            size="large"
            startIcon={<ShopIcon />}
            onClick={() => navigate('/product')}
            sx={{
              borderRadius: 3,
              px: 4,
              py: 1.5,
              fontWeight: 700,
              boxShadow: 3,
            }}
          >
            Explorar Productos
          </Button>
        </Box>
      </Container>
    )
  }

  return (
    <>
      <Container class1="compare-product-wrapper py-5">
        <Meta title="Comparar productos" />

        <Paper
          elevation={0}
          sx={{
            p: 3,
            mb: 4,
            borderRadius: 3,
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`,
            border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
          }}
        >
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <Box>
              <Typography variant="h4" fontWeight={900} letterSpacing="-0.5px" sx={{ mb: 0.5 }}>
                Comparador Técnico
              </Typography>

              <Typography color="text.secondary" variant="body2">
                Analizando <strong>{items.length}</strong> productos con{' '}
                <strong>{comparisonData.allRows.length}</strong> atributos comparables.
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip
                icon={<DiffIcon />}
                label={`${comparisonData.allRows.filter(row => row.isDifferent).length} diferencias`}
                color="warning"
                variant="outlined"
                sx={{ fontWeight: 600 }}
              />

              <Button
                startIcon={<ClearIcon />}
                variant="outlined"
                color="error"
                onClick={() => dispatch(clearCompare())}
                sx={{ borderRadius: 2, fontWeight: 600 }}
              >
                Limpiar
              </Button>
            </Stack>
          </Box>
        </Paper>

        <Grid container spacing={3} mb={4}>
          <AnimatePresence>
            {items.map((product, index) => {
              const description = getProductDescription(product)

              return (
                <Grid item xs={12} md={Math.max(3, 12 / Math.min(items.length, 4))} key={product._id}>
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ delay: index * 0.08 }}
                  >
                    <Card
                      sx={{
                        borderRadius: 3,
                        position: 'relative',
                        overflow: 'hidden',
                        border: `2px solid ${alpha(theme.palette.divider, 0.5)}`,
                        height: '100%',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                          borderColor: alpha(theme.palette.primary.main, 0.3),
                        },
                      }}
                    >
                      <IconButton
                        size="small"
                        onClick={() => dispatch(removeFromCompare(product._id))}
                        sx={{
                          position: 'absolute',
                          top: 12,
                          right: 12,
                          zIndex: 2,
                          bgcolor: 'rgba(255,255,255,0.9)',
                          backdropFilter: 'blur(4px)',
                          boxShadow: 1,
                          '&:hover': { bgcolor: 'error.main', color: 'white' },
                        }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>

                      <Box
                        sx={{
                          p: 3,
                          height: 200,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: alpha(theme.palette.grey[100], 0.5),
                          position: 'relative',
                        }}
                      >
                        <Badge
                          badgeContent={product.variants?.length || 0}
                          color="primary"
                          sx={{ position: 'absolute', top: 16, left: 16 }}
                        >
                          <Avatar
                            sx={{
                              bgcolor: alpha(theme.palette.primary.main, 0.1),
                              width: 40,
                              height: 40,
                            }}
                          >
                            <Typography fontWeight={800} color="primary">
                              {index + 1}
                            </Typography>
                          </Avatar>
                        </Badge>

                        <CardMedia
                          component="img"
                          image={getProductImage(product)}
                          alt={product.title || 'Producto'}
                          sx={{
                            maxHeight: '100%',
                            width: 'auto',
                            maxWidth: '100%',
                            objectFit: 'contain',
                            filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))',
                          }}
                        />
                      </Box>

                      <Box p={2.5} bgcolor="background.paper">
                        <Typography
                          variant="subtitle1"
                          fontWeight={800}
                          color="text.primary"
                          sx={{
                            minHeight: 48,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {getShortTitle(product.title)}
                        </Typography>

                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            mt: 1,
                            minHeight: 44,
                            lineHeight: 1.55,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {truncateText(description, 100) || 'Sin descripción breve disponible.'}
                        </Typography>

                        <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" gap={1}>
                          {product.marca && (
                            <Chip
                              label={product.marca}
                              size="small"
                              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                            />
                          )}

                          {product.condicion && (
                            <Chip
                              label={product.condicion}
                              size="small"
                              color={product.condicion === 'nuevo' ? 'success' : 'default'}
                              variant="outlined"
                              sx={{ fontSize: '0.75rem' }}
                            />
                          )}

                          {description && (
                            <Button
                              size="small"
                              startIcon={<InfoIcon />}
                              onClick={() => handleOpenDetails(product.title, stripHtml(description))}
                              sx={{ textTransform: 'none', fontWeight: 700 }}
                            >
                              Ver detalle
                            </Button>
                          )}
                        </Stack>
                      </Box>
                    </Card>
                  </motion.div>
                </Grid>
              )
            })}
          </AnimatePresence>
        </Grid>

        <Stack spacing={3}>
          {comparisonData.sections.map(section => (
            <Paper
              key={section.title}
              elevation={0}
              sx={{
                borderRadius: 3,
                overflow: 'hidden',
                border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
              }}
            >
              <Box
                sx={{
                  p: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.03),
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <section.icon sx={{ color: 'primary.main', fontSize: 24 }} />

                <Typography variant="h6" fontWeight={800} color="primary">
                  {section.title}
                </Typography>

                <Chip
                  label={`${section.rows.length} atributos`}
                  size="small"
                  sx={{ ml: 'auto', fontWeight: 600 }}
                />
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableBody>
                    {section.rows.map((row, rowIdx) => {
                      const Icon = row.icon

                      return (
                        <TableRow
                          key={row.key}
                          sx={{
                            bgcolor:
                              rowIdx % 2 === 0
                                ? 'background.paper'
                                : alpha(theme.palette.grey[50], 0.5),
                            '&:hover': {
                              bgcolor: alpha(theme.palette.primary.main, 0.02),
                            },
                          }}
                        >
                          <TableCell
                            sx={{
                              width: 210,
                              py: 2,
                              borderRight: `1px solid ${theme.palette.divider}`,
                              position: 'sticky',
                              left: 0,
                              bgcolor: 'inherit',
                              zIndex: 1,
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={1.5}>
                              {Icon && (
                                <Icon
                                  sx={{
                                    fontSize: 20,
                                    color: 'text.secondary',
                                  }}
                                />
                              )}

                              <Box>
                                <Typography
                                  variant="body2"
                                  fontWeight={700}
                                  color="text.primary"
                                  sx={{
                                    textTransform: 'uppercase',
                                    fontSize: '0.75rem',
                                    letterSpacing: '0.5px',
                                  }}
                                >
                                  {row.label}
                                </Typography>

                                {row.isDifferent && (
                                  <Chip
                                    icon={<DiffIcon sx={{ fontSize: 12 }} />}
                                    label="Diferente"
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                    sx={{
                                      height: 18,
                                      fontSize: '0.65rem',
                                      mt: 0.5,
                                    }}
                                  />
                                )}
                              </Box>
                            </Box>
                          </TableCell>

                          {row.values.map((val, idx) => (
                            <TableCell
                              key={`${row.key}-${idx}`}
                              align={row.type === 'description' ? 'left' : 'center'}
                              sx={{
                                py: 2,
                                borderRight:
                                  idx < row.values.length - 1
                                    ? `1px solid ${theme.palette.divider}`
                                    : 'none',
                                width: `${100 / items.length}%`,
                                minWidth: row.type === 'description' ? 220 : 150,
                              }}
                            >
                              <AttributeCell
                                value={val.formatted}
                                type={row.type}
                                isBest={idx === row.bestIndex}
                                isDifferent={row.isDifferent}
                                rowKey={row.key}
                              />

                              {row.type === 'description' && val.raw && (
                                <Button
                                  variant="text"
                                  size="small"
                                  startIcon={<InfoIcon />}
                                  onClick={() => handleOpenDetails(items[idx]?.title, stripHtml(val.raw))}
                                  sx={{
                                    mt: 1,
                                    px: 0,
                                    fontWeight: 700,
                                    textTransform: 'none',
                                  }}
                                >
                                  Ver completa
                                </Button>
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          ))}
        </Stack>

        <Dialog
          open={openModal}
          onClose={() => setOpenModal(false)}
          maxWidth="sm"
          fullWidth
          PaperProps={{ sx: { borderRadius: 3 } }}
        >
          <DialogTitle
            sx={{
              fontWeight: 800,
              px: 3,
              pt: 3,
              pb: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            {modalContent.title}
          </DialogTitle>

          <DialogContent sx={{ px: 3, py: 3 }}>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ whiteSpace: 'pre-line', lineHeight: 1.8 }}
            >
              {modalContent.text || 'No hay descripción disponible.'}
            </Typography>
          </DialogContent>

          <DialogActions sx={{ p: 3, pt: 0 }}>
            <Button
              onClick={() => setOpenModal(false)}
              variant="contained"
              fullWidth
              size="large"
              sx={{ borderRadius: 2, py: 1.5, fontWeight: 700 }}
            >
              Entendido
            </Button>
          </DialogActions>
        </Dialog>

        <Box textAlign="center" mt={6}>
          <Button
            variant="outlined"
            startIcon={<ShopIcon />}
            onClick={() => navigate('/product')}
            sx={{
              borderRadius: 3,
              px: 5,
              py: 1.5,
              fontWeight: 700,
              borderWidth: 2,
            }}
          >
            Seguir explorando productos
          </Button>
        </Box>
      </Container>
    </>
  )
}

export default CompareProduct