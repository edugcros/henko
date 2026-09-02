// 📁 admin/src/pages/SocialPromotionPage.jsx
//
// Kit de contenido para redes — la IA escribe el caption y los hashtags de
// un producto, el comercio los copia y postea desde su propia cuenta de
// Instagram. No hay integración con la API de Instagram a propósito: exigiría
// que cada comercio tenga una cuenta Business/Creator vinculada y que Meta
// apruebe el permiso de publicación (App Review), algo que no todos los
// comercios de hoy cumplen y que HENKO no controla. Esto entrega valor real
// sin esa dependencia.
import React, { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import { getProducts } from '@features/product/productSlice'
import socialPromotionService from '@features/marketing/socialPromotionService'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import InstagramIcon from '@mui/icons-material/Instagram'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import RefreshIcon from '@mui/icons-material/Refresh'

const getMainImage = product => {
  const images = Array.isArray(product?.images) ? product.images : []
  const main = images.find(image => image?.isMain) || images[0]
  return main?.url || ''
}

const formatMoney = value => {
  const num = Number(value || 0)
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(num) ? num : 0)
}

const SocialPromotionPage = () => {
  const dispatch = useDispatch()
  const { products, isLoading: productsLoading } = useSelector(state => state.product || {})

  const [selectedProduct, setSelectedProduct] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [captionDraft, setCaptionDraft] = useState('')

  useEffect(() => {
    dispatch(getProducts())
  }, [dispatch])

  const handleSelectProduct = (_event, product) => {
    setSelectedProduct(product)
    setResult(null)
    setCaptionDraft('')
    setError('')
  }

  const handleGenerate = async () => {
    if (!selectedProduct?._id) return

    setGenerating(true)
    setError('')

    try {
      const data = await socialPromotionService.generateSocialContent(selectedProduct._id)
      setResult(data)
      setCaptionDraft(data.caption)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const hashtagsText = useMemo(() => {
    return (result?.hashtags || []).map(tag => `#${tag}`).join(' ')
  }, [result])

  const copyToClipboard = async (text, label) => {
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copiado al portapapeles`)
    } catch {
      toast.error('No se pudo copiar — seleccioná el texto manualmente')
    }
  }

  return (
    <Box p={{ xs: 2, md: 4 }} maxWidth={760} mx="auto">
      <Stack direction="row" spacing={1.5} alignItems="center" mb={0.5}>
        <InstagramIcon color="primary" fontSize="large" />
        <Typography variant="h4" fontWeight={700}>
          Redes sociales
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={4}>
        Elegí un producto y generá un caption con hashtags listo para copiar y postear en Instagram.
        No publica nada automáticamente — revisás el texto y lo subís vos desde tu cuenta.
      </Typography>

      <Card variant="outlined" sx={{ borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Autocomplete
            options={products || []}
            loading={productsLoading}
            value={selectedProduct}
            onChange={handleSelectProduct}
            getOptionLabel={option => option?.title || ''}
            isOptionEqualToValue={(option, value) => option._id === value._id}
            renderInput={params => (
              <TextField
                {...params}
                label="Buscar producto"
                placeholder="Escribí el nombre del producto..."
              />
            )}
          />

          {selectedProduct && (
            <Stack direction="row" spacing={2} alignItems="center" mt={2.5}>
              {getMainImage(selectedProduct) ? (
                <Box
                  component="img"
                  src={getMainImage(selectedProduct)}
                  alt={selectedProduct.title}
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: 2,
                    objectFit: 'cover',
                    border: '1px solid',
                    borderColor: 'divider',
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <Box flex={1} overflow="hidden">
                <Typography variant="subtitle1" fontWeight={600} noWrap>
                  {selectedProduct.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatMoney(selectedProduct.price)}
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={
                  generating ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />
                }
                onClick={handleGenerate}
                disabled={generating}
                sx={{
                  borderRadius: 2,
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {generating ? 'Generando...' : result ? 'Regenerar' : 'Generar contenido'}
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ borderRadius: 2, mb: 3 }}>
          {error}
        </Alert>
      )}

      {result && (
        <Card variant="outlined" sx={{ borderRadius: 3 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" fontWeight={700}>
                Contenido generado
              </Typography>
              <Tooltip title="Regenerar">
                <span>
                  <IconButton onClick={handleGenerate} disabled={generating} size="small">
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            {result.imageUrl && (
              <Box
                component="img"
                src={result.imageUrl}
                alt={result.productTitle}
                sx={{
                  width: '100%',
                  maxHeight: 320,
                  objectFit: 'contain',
                  borderRadius: 2,
                  bgcolor: 'grey.50',
                  mb: 2.5,
                }}
              />
            )}

            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              CAPTION
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={3}
              value={captionDraft}
              onChange={e => setCaptionDraft(e.target.value)}
              sx={{ mt: 0.5, mb: 1.5 }}
            />

            <Stack direction="row" justifyContent="flex-end" mb={2.5}>
              <Button
                size="small"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => copyToClipboard(captionDraft, 'Caption')}
                sx={{ textTransform: 'none' }}
              >
                Copiar caption
              </Button>
            </Stack>

            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              HASHTAGS
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap mt={1} mb={2.5}>
              {(result.hashtags || []).map(tag => (
                <Chip key={tag} label={`#${tag}`} size="small" />
              ))}
            </Stack>

            <Stack direction="row" spacing={1.5} justifyContent="flex-end">
              <Button
                size="small"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => copyToClipboard(hashtagsText, 'Hashtags')}
                sx={{ textTransform: 'none' }}
              >
                Copiar hashtags
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => copyToClipboard(`${captionDraft}\n\n${hashtagsText}`, 'Todo')}
                sx={{ borderRadius: 2, textTransform: 'none' }}
              >
                Copiar todo
              </Button>
            </Stack>

            <Divider sx={{ my: 2.5 }} />

            <Typography variant="body2" color="text.secondary">
              Descargá la imagen desde la ficha del producto y pegá este texto al crear el post en
              Instagram.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  )
}

export default SocialPromotionPage
