import React, { useState, useEffect, useMemo } from 'react'
import { Box, Typography, Button, Stack, Chip, Alert, Paper } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { useTheme } from '@mui/material/styles'

const ProductVariantSelector = ({ product, onVariantSelect, initialSelection = {} }) => {
  const theme = useTheme()
  const [selectedAttributes, setSelectedAttributes] = useState(initialSelection)

  // Normalizar estructura de variantes (soporta ambos formatos)
  const normalizedVariants = useMemo(() => {
    if (!product?.variants) return []

    return product.variants
      .map(v => ({
        ...v,
        // Normalizar: usar 'attributes' si existe, sino 'combinacion'
        attributes: v.attributes || v.combinacion || {},
        // Normalizar precio y stock
        price: v.price || 0,
        stock: v.stock || v.quantity || 0,
        isActive: v.isActive !== false, // default true si no especificado
        sku: v.sku || v._id?.slice(-6) || 'N/A',
      }))
      .filter(v => v.isActive)
  }, [product])

  // Obtener nombres de atributos dinámicamente
  const attributeNames = useMemo(() => {
    if (normalizedVariants.length === 0) return []
    return Object.keys(normalizedVariants[0].attributes)
  }, [normalizedVariants])

  // Calcular opciones disponibles por atributo
  const availableOptions = useMemo(() => {
    const options = {}
    attributeNames.forEach(attrName => {
      options[attrName] = [
        ...new Set(normalizedVariants.map(v => v.attributes[attrName]).filter(Boolean)),
      ]
    })
    return options
  }, [normalizedVariants, attributeNames])

  // Verificar si una opción es válida (tiene stock con la selección actual)
  const isOptionValid = (attrName, value) => {
    const hypothetical = { ...selectedAttributes, [attrName]: value }

    return normalizedVariants.some(v => {
      const matches = Object.entries(hypothetical).every(([key, val]) => v.attributes[key] === val)
      return matches && v.stock > 0
    })
  }

  // Encontrar variante seleccionada
  const selectedVariant = useMemo(() => {
    if (Object.keys(selectedAttributes).length !== attributeNames.length) return null

    return normalizedVariants.find(v =>
      Object.entries(selectedAttributes).every(([key, val]) => v.attributes[key] === val),
    )
  }, [selectedAttributes, normalizedVariants, attributeNames])

  // Notificar al padre
  useEffect(() => {
    onVariantSelect?.(selectedVariant, selectedAttributes)
  }, [selectedVariant, selectedAttributes, onVariantSelect])

  // Manejar selección
  const handleSelect = (attrName, value) => {
    setSelectedAttributes(prev => {
      const current = prev[attrName]
      // Toggle: si ya está seleccionado, deseleccionar
      if (current === value) {
        const { [attrName]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [attrName]: value }
    })
  }

  // Resetear cuando cambia el producto
  useEffect(() => {
    setSelectedAttributes(initialSelection)
  }, [product?._id, initialSelection])

  if (!product?.hasVariants && normalizedVariants.length === 0) return null

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        borderRadius: 3,
        bgcolor: theme.palette.card.background,
        borderColor: theme.palette.card.border,
      }}
    >
      <Typography variant="h6" fontWeight={800} gutterBottom>
        Selecciona tus opciones
      </Typography>

      <Stack spacing={3}>
        {attributeNames.map(attrName => (
          <Box key={attrName}>
            <Typography
              variant="subtitle2"
              sx={{
                mb: 1.5,
                textTransform: 'uppercase',
                fontWeight: 'bold',
                color: 'text.secondary',
                fontSize: '0.75rem',
                letterSpacing: '0.5px',
              }}
            >
              {attrName}:{' '}
              <Typography
                component="span"
                sx={{ color: theme.palette.ctaPrimary.main }}
                fontWeight="bold"
              >
                {selectedAttributes[attrName] || 'Seleccionar'}
              </Typography>
            </Typography>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {availableOptions[attrName]?.map(value => {
                const selected = selectedAttributes[attrName] === value
                const valid = isOptionValid(attrName, value)
                const isColor = attrName.toLowerCase().includes('color')

                return (
                  <Button
                    key={`${attrName}-${value}`}
                    variant={selected ? 'contained' : 'outlined'}
                    onClick={() => handleSelect(attrName, value)}
                    disabled={!valid && !selected}
                    sx={{
                      minWidth: isColor ? 50 : 60,
                      height: isColor ? 50 : 45,
                      borderRadius: isColor ? '50%' : 2,
                      position: 'relative',
                      backgroundColor: isColor ? value : undefined,
                      border: selected ? '2px solid' : '1px solid',
                      borderColor: selected ? theme.palette.ctaPrimary.main : 'divider',
                      opacity: !valid ? 0.4 : 1,
                      '&:hover': {
                        transform: valid ? 'scale(1.05)' : 'none',
                      },
                      // Indicador de selección para colores
                      ...(isColor &&
                        selected && {
                          '&::after': {
                            content: '""',
                            position: 'absolute',
                            inset: -4,
                            borderRadius: '50%',
                            border: '2px solid',
                            borderColor: theme.palette.ctaPrimary.main,
                          },
                        }),
                      // Tachado para opciones sin stock
                      ...(!valid &&
                        !selected && {
                          '&::before': {
                            content: '""',
                            position: 'absolute',
                            width: '80%',
                            height: '2px',
                            backgroundColor: 'error.main',
                            transform: 'rotate(-45deg)',
                          },
                        }),
                    }}
                  >
                    {!isColor && value}
                    {isColor && selected && (
                      <CheckIcon
                        sx={{
                          color: ['#FFFFFF', '#FFFF00', '#FFC0CB'].includes(value?.toUpperCase())
                            ? '#000'
                            : '#fff',
                          fontSize: 20,
                        }}
                      />
                    )}
                  </Button>
                )
              })}
            </Stack>
          </Box>
        ))}
      </Stack>

      {/* Info de variante seleccionada */}
      {selectedVariant ? (
        <Box
          sx={{
            mt: 3,
            p: 2.5,
            bgcolor: 'background.paper',
            borderRadius: 2,
            border: '1px solid',
            borderColor: selectedVariant.stock > 0 ? 'success.light' : 'error.light',
            boxShadow: 1,
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                SKU: {selectedVariant.sku}
              </Typography>
              <Typography
                variant="h5"
                sx={{ color: theme.palette.commercePrice.main }}
                fontWeight="bold"
              >
                ${selectedVariant.price.toLocaleString('es-CL')}
              </Typography>
            </Box>
            <Chip
              label={selectedVariant.stock > 0 ? `${selectedVariant.stock} disponibles` : 'Agotado'}
              color={selectedVariant.stock > 0 ? 'success' : 'error'}
              variant="filled"
              size="small"
            />
          </Stack>

          {/* Resumen de atributos seleccionados */}
          <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap">
            {Object.entries(selectedAttributes).map(([key, value]) => (
              <Chip
                key={key}
                label={`${key}: ${value}`}
                size="small"
                variant="outlined"
                sx={{
                  color: theme.palette.ctaPrimary.main,
                  borderColor: theme.palette.ctaPrimary.main,
                }}
              />
            ))}
          </Stack>
        </Box>
      ) : (
        <Alert severity="info" sx={{ mt: 3 }} icon={false}>
          <Typography variant="body2">
            Selecciona todas las opciones para ver el precio y disponibilidad exactos.
          </Typography>
        </Alert>
      )}
    </Paper>
  )
}

export default ProductVariantSelector
