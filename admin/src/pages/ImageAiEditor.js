import React, { useState, useCallback, useRef } from 'react'
import {
  alpha,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  AutoFixHigh as MagicIcon,
  CloudUpload as UploadIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  HideImage as RemoveBgIcon,
  Inventory2 as AttachIcon,
  AutoAwesome as VariationIcon,
  BrokenImage as EmptyIcon,
  SwapHoriz as SwapIcon,
  Bolt as BoltIcon,
  Lightbulb as LightbulbIcon,
} from '@mui/icons-material'
import { useSnackbar } from 'notistack'
import { removeBackground, generateVariation } from '../services/imageAiService'
import productService from '@features/product/productService'

const MODES = { REMOVE_BG: 'remove-bg', VARIATION: 'variation' }
const MAX_FILE_SIZE = 10 * 1024 * 1024

const PROMPT_SUGGESTIONS = [
  'Fondo blanco de estudio profesional con iluminación suave',
  'Sobre una mesa de madera rústica con luz natural cálida',
  'Fondo minimalista gris claro con sombra sutil',
  'Escena lifestyle: escritorio moderno con plantas',
  'Fondo degradado suave de tonos pastel',
  'Sobre mármol blanco con luz cenital',
]

const V = '#6366F1'
const VL = '#818CF8'
const VD = '#4F46E5'
const GRAD = 'linear-gradient(135deg, #312E81 0%, #4338CA 50%, #6366F1 100%)'
const GRAD_BTN = 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A78BFA 100%)'

const fmtSize = bytes => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const cardSx = {
  borderRadius: 4,
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: '0 1px 4px rgba(0,0,0,0.03), 0 4px 12px rgba(0,0,0,0.02)',
  overflow: 'hidden',
}

const StepBadge = ({ n }) => (
  <Box sx={{ width: 26, height: 26, borderRadius: '50%', background: GRAD_BTN, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    <Typography sx={{ color: '#fff', fontWeight: 900, fontSize: '0.72rem', lineHeight: 1 }}>{n}</Typography>
  </Box>
)

const ImageAiEditor = () => {
  const { enqueueSnackbar } = useSnackbar()
  const fileInputRef = useRef(null)

  const [mode, setMode] = useState(MODES.REMOVE_BG)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState([])
  const [dragActive, setDragActive] = useState(false)

  const [attachTarget, setAttachTarget] = useState(null)
  const [productQuery, setProductQuery] = useState('')
  const [productOptions, setProductOptions] = useState([])
  const [productSearching, setProductSearching] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [attaching, setAttaching] = useState(false)

  const handleFileSelect = useCallback(
    event => {
      const selected = event.target.files?.[0]
      if (!selected) return
      if (!selected.type.startsWith('image/')) {
        enqueueSnackbar('Solo se permiten archivos de imagen', { variant: 'warning' })
        return
      }
      if (selected.size > MAX_FILE_SIZE) {
        enqueueSnackbar('La imagen no puede superar los 10 MB', { variant: 'warning' })
        return
      }
      setFile(selected)
      setPreview(URL.createObjectURL(selected))
      setResults([])
    },
    [enqueueSnackbar],
  )

  const handleDrop = useCallback(
    event => {
      event.preventDefault()
      setDragActive(false)
      const dropped = event.dataTransfer.files?.[0]
      if (dropped) handleFileSelect({ target: { files: [dropped] } })
    },
    [handleFileSelect],
  )

  const handleClear = () => {
    setFile(null)
    setPreview(null)
    setResults([])
    setPrompt('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleProcess = async () => {
    if (!file) return
    if (mode === MODES.VARIATION && !prompt.trim()) {
      enqueueSnackbar('Escribí un prompt describiendo los cambios', { variant: 'warning' })
      return
    }
    try {
      setProcessing(true)
      const result = mode === MODES.REMOVE_BG
        ? await removeBackground(file)
        : await generateVariation(file, prompt.trim())

      setResults(prev => [
        { id: Date.now(), image: result.image, mode, prompt: mode === MODES.VARIATION ? prompt.trim() : null, size: result.size },
        ...prev,
      ])
      enqueueSnackbar(mode === MODES.REMOVE_BG ? 'Fondo removido exitosamente' : 'Variación generada exitosamente', { variant: 'success' })
    } catch (error) {
      enqueueSnackbar(error.response?.data?.message || error.message || 'Error procesando la imagen', { variant: 'error' })
    } finally {
      setProcessing(false)
    }
  }

  const handleDownload = r => {
    const a = document.createElement('a')
    a.href = r.image
    a.download = `imagen-ai-${r.id}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleCopy = async r => {
    try {
      const res = await fetch(r.image)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      enqueueSnackbar('Imagen copiada al portapapeles', { variant: 'success' })
    } catch {
      enqueueSnackbar('No se pudo copiar la imagen', { variant: 'error' })
    }
  }

  const searchDebounceRef = useRef(null)

  const handleOpenAttachDialog = r => {
    setAttachTarget(r)
    setSelectedProduct(null)
    setProductQuery('')
    setProductOptions([])
  }

  const handleCloseAttachDialog = () => {
    if (attaching) return
    setAttachTarget(null)
  }

  const handleProductQueryChange = query => {
    setProductQuery(query)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)

    if (!query.trim()) {
      setProductOptions([])
      return
    }

    searchDebounceRef.current = setTimeout(async () => {
      setProductSearching(true)
      try {
        const res = await productService.getAdminProducts({ q: query.trim(), limit: 10 })
        setProductOptions(res?.data || [])
      } catch {
        setProductOptions([])
      } finally {
        setProductSearching(false)
      }
    }, 350)
  }

  const handleAttachToProduct = async () => {
    if (!attachTarget || !selectedProduct) return

    try {
      setAttaching(true)
      const response = await fetch(attachTarget.image)
      const blob = await response.blob()
      const imageFile = new File([blob], `ai-${attachTarget.mode}-${attachTarget.id}.png`, {
        type: blob.type || 'image/png',
      })

      await productService.uploadProductImage(selectedProduct._id, imageFile, {
        aiGenerated: true,
        aiSource: attachTarget.mode,
      })

      enqueueSnackbar(`Imagen agregada a "${selectedProduct.title}"`, { variant: 'success' })
      setAttachTarget(null)
    } catch (error) {
      enqueueSnackbar(error.message || 'No se pudo agregar la imagen al producto', { variant: 'error' })
    } finally {
      setAttaching(false)
    }
  }

  const isRemoveBg = mode === MODES.REMOVE_BG

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      {/* ── Header ── */}
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, md: 4 },
          mb: 3.5,
          borderRadius: 5,
          background: GRAD,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(139,92,246,0.15)', filter: 'blur(40px)' }} />
        <Box sx={{ position: 'absolute', bottom: -80, left: '25%', width: 220, height: 220, borderRadius: '50%', background: 'rgba(99,102,241,0.1)', filter: 'blur(50px)' }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ position: 'relative', zIndex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box sx={{ width: 52, height: 52, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <MagicIcon sx={{ fontSize: 27 }} />
            </Box>
            <Box>
              <Typography variant="h5" fontWeight={900} sx={{ letterSpacing: -0.8, lineHeight: 1.2 }}>
                Editor de Imágenes IA
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.65, mt: 0.25, maxWidth: 400 }}>
                Transformá fotos de producto con inteligencia artificial
              </Typography>
            </Box>
          </Stack>
          <Chip
            icon={<BoltIcon sx={{ fontSize: 14, color: '#FCD34D !important' }} />}
            label="AI Image Editor"
            size="small"
            sx={{ mt: { xs: 1.5, sm: 0 }, alignSelf: { xs: 'flex-start', sm: 'center' }, bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '0.7rem' }}
          />
        </Stack>
      </Paper>

      <Grid container spacing={3}>
        {/* ── Panel izquierdo ── */}
        <Grid item xs={12} md={5} lg={4}>
          <Stack spacing={2.5}>

            {/* Paso 1 — Modo */}
            <Card sx={cardSx}>
              <CardContent sx={{ p: 2.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <StepBadge n={1} />
                  <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: '0.82rem' }}>Elegí qué querés hacer</Typography>
                </Stack>
                <Stack spacing={1}>
                  {[
                    { value: MODES.REMOVE_BG, icon: RemoveBgIcon, title: 'Quitar fondo', desc: 'Producto sobre fondo blanco limpio' },
                    { value: MODES.VARIATION, icon: VariationIcon, title: 'Generar variación', desc: 'Cambiá fondo, escena o iluminación' },
                  ].map(o => {
                    const sel = mode === o.value
                    return (
                      <Paper
                        key={o.value}
                        elevation={0}
                        onClick={() => setMode(o.value)}
                        sx={{
                          p: 1.75,
                          cursor: 'pointer',
                          borderRadius: 3,
                          border: '2px solid',
                          borderColor: sel ? V : 'divider',
                          bgcolor: sel ? alpha(V, 0.04) : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          transition: 'all 0.15s ease',
                          '&:hover': { borderColor: sel ? V : alpha(V, 0.35), bgcolor: alpha(V, sel ? 0.06 : 0.02) },
                        }}
                      >
                        <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: sel ? GRAD_BTN : 'transparent', bgcolor: sel ? undefined : alpha(V, 0.07) }}>
                          <o.icon sx={{ fontSize: 20, color: sel ? '#fff' : V }} />
                        </Box>
                        <Box>
                          <Typography variant="body2" fontWeight={800} sx={{ color: sel ? VD : 'text.primary', lineHeight: 1.3 }}>{o.title}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2, display: 'block' }}>{o.desc}</Typography>
                        </Box>
                      </Paper>
                    )
                  })}
                </Stack>
              </CardContent>
            </Card>

            {/* Paso 2 — Upload */}
            <Card sx={cardSx}>
              <CardContent sx={{ p: 2.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <StepBadge n={2} />
                  <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: '0.82rem' }}>Subí tu imagen</Typography>
                </Stack>

                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />

                {!preview ? (
                  <Paper
                    elevation={0}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                    onDragLeave={() => setDragActive(false)}
                    onClick={() => fileInputRef.current?.click()}
                    sx={{
                      p: { xs: 3, md: 4 },
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderRadius: 3,
                      border: '2px dashed',
                      borderColor: dragActive ? V : alpha('#94A3B8', 0.35),
                      bgcolor: dragActive ? alpha(V, 0.04) : alpha('#F8FAFC', 0.5),
                      transition: 'all 0.2s ease',
                      '&:hover': { borderColor: VL, bgcolor: alpha(V, 0.03) },
                    }}
                  >
                    <Box sx={{ width: 56, height: 56, borderRadius: 3, bgcolor: alpha('#94A3B8', 0.08), display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1.5, transition: 'all 0.2s' }}>
                      <UploadIcon sx={{ fontSize: 26, color: dragActive ? V : '#94A3B8' }} />
                    </Box>
                    <Typography variant="body2" fontWeight={600} color={dragActive ? V : 'text.secondary'}>
                      Arrastrá o hacé click para subir
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.25, display: 'block' }}>
                      JPG, PNG, WebP — hasta 10 MB
                    </Typography>
                  </Paper>
                ) : (
                  <Box>
                    <Box sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: '#f1f5f9', border: '1px solid', borderColor: 'divider', position: 'relative' }}>
                      <Box component="img" src={preview} alt="Preview" sx={{ width: '100%', maxHeight: 240, objectFit: 'contain', display: 'block', p: 1 }} />
                      {processing && (
                        <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, backdropFilter: 'blur(2px)' }}>
                          <CircularProgress size={36} sx={{ color: V }} />
                          <Typography variant="caption" fontWeight={700} sx={{ color: VD }}>Procesando...</Typography>
                        </Box>
                      )}
                    </Box>

                    {file && (
                      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                          {file.name.length > 25 ? file.name.slice(0, 22) + '...' : file.name} · {fmtSize(file.size)}
                        </Typography>
                        <Stack direction="row" spacing={0.5}>
                          <Button size="small" startIcon={<SwapIcon sx={{ fontSize: 14 }} />} onClick={() => fileInputRef.current?.click()} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, fontSize: '0.72rem', color: 'text.secondary', minWidth: 0, px: 1 }}>
                            Cambiar
                          </Button>
                          <Button size="small" startIcon={<DeleteIcon sx={{ fontSize: 14 }} />} onClick={handleClear} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, fontSize: '0.72rem', color: 'text.secondary', minWidth: 0, px: 1, '&:hover': { color: 'error.main' } }}>
                            Quitar
                          </Button>
                        </Stack>
                      </Stack>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Paso 3 — Prompt (solo variación) */}
            {!isRemoveBg && (
              <Card sx={cardSx}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                    <StepBadge n={3} />
                    <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: '0.82rem' }}>Describí los cambios</Typography>
                  </Stack>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="Ej: Fondo blanco de estudio profesional con iluminación suave..."
                    inputProps={{ maxLength: 1000 }}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5, fontSize: '0.875rem', '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: V, borderWidth: 2 } } }}
                  />
                  <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.5, display: 'block', textAlign: 'right' }}>
                    {prompt.length}/1000
                  </Typography>

                  <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1, mb: 1 }}>
                    <LightbulbIcon sx={{ fontSize: 14, color: '#F59E0B' }} />
                    <Typography variant="caption" fontWeight={700} sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.6, fontSize: '0.62rem' }}>
                      Ideas rápidas
                    </Typography>
                  </Stack>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {PROMPT_SUGGESTIONS.map(s => (
                      <Chip
                        key={s}
                        label={s.length > 30 ? s.slice(0, 28) + '...' : s}
                        size="small"
                        onClick={() => setPrompt(s)}
                        variant={prompt === s ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.68rem',
                          height: 26,
                          borderRadius: 1.5,
                          borderColor: prompt === s ? V : 'divider',
                          bgcolor: prompt === s ? alpha(V, 0.08) : 'transparent',
                          color: prompt === s ? VD : 'text.secondary',
                          '&:hover': { borderColor: VL, color: V, bgcolor: alpha(V, 0.04) },
                        }}
                      />
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}

            {/* CTA */}
            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={handleProcess}
              disabled={processing || !file}
              startIcon={processing ? <CircularProgress size={18} sx={{ color: 'rgba(255,255,255,0.7)' }} /> : <MagicIcon />}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 800,
                py: 1.75,
                fontSize: '0.95rem',
                background: processing ? alpha(V, 0.65) : GRAD_BTN,
                boxShadow: processing ? 'none' : `0 6px 20px ${alpha(V, 0.3)}`,
                transition: 'all 0.2s ease',
                '&:hover': { background: GRAD, boxShadow: `0 8px 28px ${alpha(V, 0.35)}`, transform: 'translateY(-1px)' },
                '&:active': { transform: 'translateY(0)' },
                '&.Mui-disabled': { background: alpha('#94A3B8', 0.1), color: alpha('#94A3B8', 0.45), boxShadow: 'none' },
              }}
            >
              {processing ? 'Procesando con IA...' : isRemoveBg ? 'Quitar fondo' : 'Generar variación'}
            </Button>
          </Stack>
        </Grid>

        {/* ── Panel derecho — Resultados ── */}
        <Grid item xs={12} md={7} lg={8}>
          <Card sx={{ ...cardSx, minHeight: { md: 540 }, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: results.length > 0 ? '#22C55E' : alpha('#94A3B8', 0.35) }} />
                <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: '0.82rem' }}>Resultados</Typography>
                {results.length > 0 && (
                  <Chip label={results.length} size="small" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: alpha(V, 0.08), color: V }} />
                )}
              </Stack>
              {results.length > 1 && (
                <Button size="small" onClick={() => setResults([])} sx={{ textTransform: 'none', fontSize: '0.72rem', fontWeight: 600, color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                  Limpiar todo
                </Button>
              )}
            </Box>

            {processing && <LinearProgress sx={{ '& .MuiLinearProgress-bar': { bgcolor: V } }} />}

            <CardContent sx={{ p: 2.5, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
              {results.length === 0 ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 6 }}>
                  <Box sx={{ width: 80, height: 80, borderRadius: 4, background: alpha('#94A3B8', 0.05), border: '2px dashed', borderColor: alpha('#94A3B8', 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2.5 }}>
                    <EmptyIcon sx={{ fontSize: 32, color: alpha('#94A3B8', 0.3) }} />
                  </Box>
                  <Typography variant="body2" fontWeight={700} sx={{ color: 'text.secondary', mb: 0.5 }}>
                    Sin resultados todavía
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center', maxWidth: 260, lineHeight: 1.5 }}>
                    Subí una foto de producto y elegí una acción para comenzar
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2}>
                  {results.map(r => (
                    <Paper
                      key={r.id}
                      elevation={0}
                      sx={{
                        borderRadius: 3,
                        overflow: 'hidden',
                        border: '1px solid',
                        borderColor: 'divider',
                        transition: 'all 0.2s ease',
                        '&:hover': { boxShadow: `0 4px 16px ${alpha('#000', 0.06)}`, borderColor: alpha(V, 0.15) },
                      }}
                    >
                      {/* Imagen resultado */}
                      <Box
                        sx={{
                          bgcolor: '#f8fafc',
                          backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23f1f5f9'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f1f5f9'/%3E%3C/svg%3E")`,
                          backgroundSize: '20px 20px',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          p: 2,
                          minHeight: 180,
                        }}
                      >
                        <Box
                          component="img"
                          src={r.image}
                          alt="Resultado IA"
                          sx={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 1.5, filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.06))' }}
                        />
                      </Box>

                      {/* Info bar */}
                      <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
                            <Box sx={{ width: 30, height: 30, borderRadius: 1.5, background: r.mode === MODES.REMOVE_BG ? 'linear-gradient(135deg, #10B981, #059669)' : GRAD_BTN, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              {r.mode === MODES.REMOVE_BG ? <RemoveBgIcon sx={{ fontSize: 15, color: '#fff' }} /> : <VariationIcon sx={{ fontSize: 15, color: '#fff' }} />}
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={700} sx={{ fontSize: '0.8rem', lineHeight: 1.3 }}>
                                {r.mode === MODES.REMOVE_BG ? 'Fondo removido' : 'Variación generada'}
                              </Typography>
                              {r.prompt && (
                                <Typography variant="caption" color="text.secondary" noWrap title={r.prompt} sx={{ display: 'block', maxWidth: { xs: 180, md: 320 } }}>
                                  {r.prompt}
                                </Typography>
                              )}
                            </Box>
                          </Stack>

                          <Stack direction="row" spacing={0.25}>
                            {[
                              { tip: 'Usar en un producto', icon: AttachIcon, fn: () => handleOpenAttachDialog(r), hc: V },
                              { tip: 'Descargar', icon: DownloadIcon, fn: () => handleDownload(r), hc: V },
                              { tip: 'Copiar', icon: CopyIcon, fn: () => handleCopy(r), hc: V },
                              { tip: 'Eliminar', icon: DeleteIcon, fn: () => setResults(p => p.filter(x => x.id !== r.id)), hc: '#EF4444' },
                            ].map(a => (
                              <Tooltip key={a.tip} title={a.tip} arrow>
                                <IconButton size="small" onClick={a.fn} sx={{ color: 'text.secondary', '&:hover': { color: a.hc, bgcolor: alpha(a.hc, 0.08) } }}>
                                  <a.icon sx={{ fontSize: 18 }} />
                                </IconButton>
                              </Tooltip>
                            ))}
                          </Stack>
                        </Stack>
                      </Box>
                    </Paper>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={Boolean(attachTarget)} onClose={handleCloseAttachDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Usar en un producto</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Buscá el producto al que querés agregar esta imagen.
          </Typography>
          <Autocomplete
            options={productOptions}
            loading={productSearching}
            value={selectedProduct}
            onChange={(_, value) => setSelectedProduct(value)}
            inputValue={productQuery}
            onInputChange={(_, value) => handleProductQueryChange(value)}
            getOptionLabel={option => option?.title || ''}
            isOptionEqualToValue={(option, value) => option._id === value._id}
            noOptionsText={productQuery.trim() ? 'Sin resultados' : 'Escribí para buscar'}
            renderInput={params => (
              <TextField
                {...params}
                label="Producto"
                placeholder="Título o marca"
                autoFocus
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {productSearching ? <CircularProgress color="inherit" size={16} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={handleCloseAttachDialog} disabled={attaching}>
            Cancelar
          </Button>
          <Button
            variant="contained"
            onClick={handleAttachToProduct}
            disabled={!selectedProduct || attaching}
            startIcon={attaching ? <CircularProgress size={16} color="inherit" /> : <AttachIcon />}
          >
            {attaching ? 'Agregando…' : 'Agregar al producto'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ImageAiEditor
