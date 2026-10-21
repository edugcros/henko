// 📁 admin/src/pages/SocialPromotionPage.jsx
//
// Kit de contenido para redes — la IA escribe el caption y los hashtags de
// un producto, el comercio los copia y postea desde su propia cuenta de
// Instagram. No hay integración con la API de Instagram a propósito: exigiría
// que cada comercio tenga una cuenta Business/Creator vinculada y que Meta
// apruebe el permiso de publicación (App Review), algo que no todos los
// comercios de hoy cumplen y que HENKO no controla. Esto entrega valor real
// sin esa dependencia.
import React, { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { toast } from 'react-toastify'
import { getAdminProducts } from '@features/product/productSlice'
import socialPromotionService from '@features/marketing/socialPromotionService'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import InstagramIcon from '@mui/icons-material/Instagram'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import RefreshIcon from '@mui/icons-material/Refresh'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'
const GRADIENT = 'linear-gradient(100deg, #0b6bff 0%, #5b3dff 58%, #8a2cff 100%)'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

// Límites de Instagram: pasados esos números, la publicación se rechaza o se recorta.
export const CAPTION_MAX = 2200
export const HASHTAGS_MAX = 30

const SEARCH_DELAY_MS = 300

export const getMainImage = product => {
  const images = Array.isArray(product?.images) ? product.images : []
  const main = images.find(image => image?.isMain) || images[0]
  return main?.url || ''
}

export const formatMoney = value => {
  const num = Number(value || 0)
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(num) ? num : 0)
}

const SocialPromotionPage = () => {
  const dispatch = useDispatch()
  // adminProducts filtra por req.user.tenantId en el backend; usar el
  // listado público del storefront acá dejaba productos de otro tenant en el
  // selector y el POST a /social-caption devolvía 404 porque
  // Product.findOne({ _id, tenantId: req.user.tenantId }) no matcheaba.
  const { adminProducts, isAdminLoading } = useSelector(state => state.product || {})

  const [selectedProduct, setSelectedProduct] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [captionDraft, setCaptionDraft] = useState('')
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)

  const searchTimeout = useRef(null)

  useEffect(() => {
    dispatch(getAdminProducts())

    return () => clearTimeout(searchTimeout.current)
  }, [dispatch])

  // El listado trae solo la primera página (20 productos): con un catálogo más grande, el resto no
  // se podía elegir. Al escribir se busca en el servidor, que es quien conoce todo el catálogo.
  const handleInputChange = (_event, value, reason) => {
    if (reason !== 'input' && reason !== 'clear') return

    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      dispatch(getAdminProducts({ q: value.trim(), limit: 20 }))
    }, SEARCH_DELAY_MS)
  }

  const handleSelectProduct = (_event, product) => {
    setSelectedProduct(product)
    setResult(null)
    setCaptionDraft('')
    setError('')
  }

  const generate = async () => {
    if (!selectedProduct?._id) return

    setGenerating(true)
    setError('')

    try {
      const data = await socialPromotionService.generateSocialContent(selectedProduct._id)
      setResult(data)
      setCaptionDraft(data.caption)
    } catch (err) {
      setError(err?.message || 'No se pudo generar el contenido. Probá de nuevo en un rato.')
    } finally {
      setGenerating(false)
    }
  }

  // Regenerar reemplaza el texto: si se lo había editado, antes se perdía sin aviso.
  const handleGenerateClick = () => {
    if (result && captionDraft !== result.caption) {
      setConfirmingRegenerate(true)
      return
    }

    generate()
  }

  const confirmRegenerate = () => {
    setConfirmingRegenerate(false)
    generate()
  }

  const hashtags = result?.hashtags || []

  const hashtagsText = hashtags.map(tag => `#${tag}`).join(' ')

  const copyToClipboard = async (text, label) => {
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copiado al portapapeles`)
    } catch {
      toast.error('No se pudo copiar — seleccioná el texto manualmente')
    }
  }

  const captionTooLong = captionDraft.length > CAPTION_MAX
  const tooManyHashtags = hashtags.length > HASHTAGS_MAX

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 820, mx: 'auto' }}>
      <Box component="header" sx={{ mb: 4 }}>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          MARKETING
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <InstagramIcon sx={{ color: BRAND.blue, fontSize: { xs: 30, md: 38 } }} />
          <Typography
            component="h1"
            sx={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: { xs: 26, md: 34 },
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
            }}
          >
            Redes sociales
          </Typography>
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 640 }}>
          Elegí un producto y generá un caption con hashtags listo para copiar y postear en
          Instagram. No publica nada automáticamente — revisás el texto y lo subís vos desde tu
          cuenta.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2.5, md: 3 }, mb: 3 }}>
        <Autocomplete
          options={adminProducts || []}
          loading={isAdminLoading}
          value={selectedProduct}
          onChange={handleSelectProduct}
          onInputChange={handleInputChange}
          // La búsqueda la hace el servidor: no se vuelve a filtrar acá.
          filterOptions={options => options}
          getOptionLabel={option => option?.title || ''}
          isOptionEqualToValue={(option, value) => option._id === value._id}
          noOptionsText="Ningún producto coincide con la búsqueda"
          loadingText="Buscando productos..."
          renderInput={params => (
            <TextField
              {...params}
              label="Buscar producto"
              placeholder="Escribí el nombre del producto..."
            />
          )}
        />

        {selectedProduct && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'center' }, mt: 2.5 }}
          >
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
              {getMainImage(selectedProduct) ? (
                <Box
                  component="img"
                  src={getMainImage(selectedProduct)}
                  alt={selectedProduct.title}
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: 3,
                    objectFit: 'cover',
                    border: `1px solid ${BRAND.line}`,
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <Typography sx={{ fontWeight: 700 }} noWrap>
                  {selectedProduct.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatMoney(selectedProduct.price)}
                </Typography>
              </Box>
            </Stack>
            <Button
              variant="contained"
              startIcon={
                generating ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />
              }
              onClick={handleGenerateClick}
              disabled={generating}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                background: GRADIENT,
              }}
            >
              {generating ? 'Generando...' : result ? 'Regenerar' : 'Generar contenido'}
            </Button>
          </Stack>
        )}
      </Paper>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ borderRadius: 3, mb: 3 }}>
          {error}
        </Alert>
      )}

      {result && (
        <Paper variant="outlined" sx={{ ...PANEL_SX, p: { xs: 2.5, md: 3 } }}>
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 2,
            }}
          >
            <Typography
              component="h2"
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 20 }}
            >
              Contenido generado
            </Typography>
            <Tooltip title="Regenerar">
              <span>
                <IconButton
                  onClick={handleGenerateClick}
                  disabled={generating}
                  size="small"
                  aria-label="Regenerar el contenido"
                >
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
                borderRadius: 3,
                bgcolor: BRAND.paper,
                mb: 2.5,
              }}
            />
          )}

          <Typography
            variant="caption"
            sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.06em' }}
          >
            CAPTION
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            value={captionDraft}
            onChange={e => setCaptionDraft(e.target.value)}
            error={captionTooLong}
            helperText={
              captionTooLong
                ? `${captionDraft.length}/${CAPTION_MAX} — Instagram no admite más de ${CAPTION_MAX} caracteres: acortá el texto.`
                : `${captionDraft.length}/${CAPTION_MAX}`
            }
            slotProps={{ htmlInput: { 'aria-label': 'Caption' } }}
            sx={{ mt: 0.5, mb: 1 }}
          />

          <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 2.5 }}>
            <Button
              size="small"
              startIcon={<ContentCopyIcon fontSize="small" />}
              onClick={() => copyToClipboard(captionDraft, 'Caption')}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Copiar caption
            </Button>
          </Stack>

          <Typography
            variant="caption"
            sx={{ color: BRAND.muted, fontWeight: 700, letterSpacing: '0.06em' }}
          >
            HASHTAGS
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', mt: 1, mb: 1 }} useFlexGap>
            {hashtags.map((tag, index) => (
              <Chip key={`${tag}-${index}`} label={`#${tag}`} size="small" />
            ))}
          </Stack>
          {tooManyHashtags && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1 }}>
              Son {hashtags.length} hashtags y Instagram admite hasta {HASHTAGS_MAX}: borrá algunos
              antes de publicar.
            </Typography>
          )}

          <Stack
            direction="row"
            spacing={1.5}
            sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', rowGap: 1, mt: 1.5 }}
          >
            <Button
              size="small"
              startIcon={<ContentCopyIcon fontSize="small" />}
              onClick={() => copyToClipboard(hashtagsText, 'Hashtags')}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Copiar hashtags
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<ContentCopyIcon fontSize="small" />}
              onClick={() => copyToClipboard(`${captionDraft}\n\n${hashtagsText}`, 'Todo')}
              sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700, background: GRADIENT }}
            >
              Copiar todo
            </Button>
          </Stack>

          <Divider sx={{ my: 2.5, borderColor: BRAND.line }} />

          <Typography variant="body2" color="text.secondary">
            Descargá la imagen desde la ficha del producto y pegá este texto al crear el post en
            Instagram.
          </Typography>
        </Paper>
      )}

      <Dialog
        open={confirmingRegenerate}
        onClose={() => setConfirmingRegenerate(false)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="redes-regenerar-titulo"
      >
        <DialogTitle id="redes-regenerar-titulo" sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          ¿Regenerar el contenido?
        </DialogTitle>
        <DialogContent>
          <Typography>
            Editaste el texto. Si regenerás, vas a perder tus cambios y se escribe uno nuevo.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConfirmingRegenerate(false)} color="inherit">
            Seguir editando
          </Button>
          <Button onClick={confirmRegenerate} variant="contained">
            Regenerar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default SocialPromotionPage
