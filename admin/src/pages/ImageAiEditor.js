import React, { useState, useCallback, useRef } from 'react'
import {
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import {
  AutoFixHigh as MagicIcon,
  CloudUpload as UploadIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  HideImage as RemoveBgIcon,
  Image as ImageIcon,
  AutoAwesome as VariationIcon,
  BrokenImage as EmptyIcon,
  SwapHoriz as SwapIcon,
  Bolt as BoltIcon,
  Lightbulb as LightbulbIcon,
  Spa as SpaIcon,
  WbSunny as SunnyIcon,
  Gradient as GradientIcon,
  TableRestaurant as TableIcon,
} from '@mui/icons-material'
import { useSnackbar } from 'notistack'
import { removeBackground, generateVariation } from '../services/imageAiService'

const MODES = {
  REMOVE_BG: 'remove-bg',
  VARIATION: 'variation',
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

const PROMPT_SUGGESTIONS = [
  { label: 'Estudio profesional', full: 'Fondo blanco de estudio profesional con iluminación suave', icon: SunnyIcon },
  { label: 'Mesa rústica', full: 'Sobre una mesa de madera rústica con luz natural cálida', icon: TableIcon },
  { label: 'Minimalista gris', full: 'Fondo minimalista gris claro con sombra sutil', icon: GradientIcon },
  { label: 'Lifestyle moderno', full: 'Escena de lifestyle: sobre un escritorio moderno con plantas', icon: SpaIcon },
  { label: 'Degradado pastel', full: 'Fondo degradado suave de tonos pastel', icon: GradientIcon },
  { label: 'Mármol cenital', full: 'Sobre mármol blanco con luz cenital', icon: SunnyIcon },
]

const ACCENT = '#6366F1'
const ACCENT_LIGHT = '#818CF8'
const ACCENT_DARK = '#4F46E5'
const GRADIENT_PRIMARY = 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A78BFA 100%)'
const GRADIENT_DARK = 'linear-gradient(135deg, #312E81 0%, #4338CA 50%, #6366F1 100%)'

const cardSx = {
  borderRadius: 4,
  border: '1px solid',
  borderColor: 'divider',
  boxShadow: '0 1px 4px rgba(0,0,0,0.03), 0 4px 12px rgba(0,0,0,0.02)',
  overflow: 'hidden',
  transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
  '&:hover': {
    boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)',
  },
}

const ImageAiEditor = () => {
  const theme = useTheme()
  const { enqueueSnackbar } = useSnackbar()
  const fileInputRef = useRef(null)

  const [mode, setMode] = useState(MODES.REMOVE_BG)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState([])
  const [dragActive, setDragActive] = useState(false)

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
      if (dropped) {
        handleFileSelect({ target: { files: [dropped] } })
      }
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
    if (!file) {
      enqueueSnackbar('Subí una imagen primero', { variant: 'warning' })
      return
    }

    if (mode === MODES.VARIATION && !prompt.trim()) {
      enqueueSnackbar('Escribí un prompt describiendo los cambios', { variant: 'warning' })
      return
    }

    try {
      setProcessing(true)

      let result
      if (mode === MODES.REMOVE_BG) {
        result = await removeBackground(file)
      } else {
        result = await generateVariation(file, prompt.trim())
      }

      setResults(prev => [
        {
          id: Date.now(),
          image: result.image,
          mode,
          prompt: mode === MODES.VARIATION ? prompt.trim() : null,
          size: result.size,
        },
        ...prev,
      ])

      enqueueSnackbar(
        mode === MODES.REMOVE_BG ? 'Fondo removido exitosamente' : 'Variación generada exitosamente',
        { variant: 'success' },
      )
    } catch (error) {
      const msg = error.response?.data?.message || error.message || 'Error procesando la imagen'
      enqueueSnackbar(msg, { variant: 'error' })
    } finally {
      setProcessing(false)
    }
  }

  const handleDownload = result => {
    const link = document.createElement('a')
    link.href = result.image
    link.download = `imagen-ai-${result.id}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopyToClipboard = async result => {
    try {
      const response = await fetch(result.image)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      enqueueSnackbar('Imagen copiada al portapapeles', { variant: 'success' })
    } catch {
      enqueueSnackbar('No se pudo copiar la imagen', { variant: 'error' })
    }
  }

  const handleRemoveResult = id => {
    setResults(prev => prev.filter(r => r.id !== id))
  }

  const isRemoveBg = mode === MODES.REMOVE_BG

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 3, md: 4.5 },
          mb: 4,
          borderRadius: 5,
          background: GRADIENT_DARK,
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ position: 'absolute', top: -80, right: -80, width: 320, height: 320, borderRadius: '50%', background: 'rgba(139,92,246,0.15)', filter: 'blur(40px)' }} />
        <Box sx={{ position: 'absolute', bottom: -100, left: '30%', width: 260, height: 260, borderRadius: '50%', background: 'rgba(99,102,241,0.12)', filter: 'blur(50px)' }} />
        <Box sx={{ position: 'absolute', top: 20, right: 40, width: 6, height: 6, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.4)' }} />
        <Box sx={{ position: 'absolute', top: 50, right: 120, width: 4, height: 4, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.25)' }} />
        <Box sx={{ position: 'absolute', bottom: 30, right: 200, width: 5, height: 5, borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.3)' }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ position: 'relative', zIndex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.1)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            >
              <MagicIcon sx={{ fontSize: 30 }} />
            </Box>
            <Box>
              <Typography variant="h4" fontWeight={900} sx={{ letterSpacing: -1, lineHeight: 1.15 }}>
                Editor de Imágenes IA
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7, mt: 0.5, maxWidth: 440 }}>
                Transformá tus fotos de producto con inteligencia artificial. Quitá fondos o generá variaciones profesionales en segundos.
              </Typography>
            </Box>
          </Stack>

          <Chip
            icon={<BoltIcon sx={{ fontSize: 16, color: '#FCD34D !important' }} />}
            label="Powered by Gemini AI"
            size="small"
            sx={{
              mt: { xs: 2, sm: 0 },
              alignSelf: { xs: 'flex-start', sm: 'center' },
              bgcolor: 'rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(255,255,255,0.15)',
              backdropFilter: 'blur(10px)',
              fontWeight: 600,
              fontSize: '0.75rem',
              letterSpacing: 0.3,
            }}
          />
        </Stack>
      </Paper>

      <Grid container spacing={3.5}>
        <Grid item xs={12} md={5}>
          <Stack spacing={3}>
            <Card sx={cardSx}>
              <CardContent sx={{ p: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2.5 }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: '50%', background: GRADIENT_PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" sx={{ color: '#fff', fontWeight: 900, fontSize: '0.7rem', lineHeight: 1 }}>1</Typography>
                  </Box>
                  <Typography variant="subtitle2" fontWeight={800}>Elegí qué querés hacer</Typography>
                </Stack>

                <Stack spacing={1.5}>
                  {[
                    { value: MODES.REMOVE_BG, icon: RemoveBgIcon, title: 'Quitar fondo', desc: 'Eliminá el fondo y dejá solo el producto sobre blanco' },
                    { value: MODES.VARIATION, icon: VariationIcon, title: 'Generar variación', desc: 'Cambiá el entorno, fondo e iluminación de tu foto' },
                  ].map(opt => {
                    const selected = mode === opt.value
                    return (
                      <Paper
                        key={opt.value}
                        onClick={() => setMode(opt.value)}
                        sx={{
                          p: 2,
                          cursor: 'pointer',
                          borderRadius: 3,
                          border: '2px solid',
                          borderColor: selected ? ACCENT : 'divider',
                          bgcolor: selected ? alpha(ACCENT, 0.04) : 'transparent',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          '&:hover': {
                            borderColor: selected ? ACCENT : alpha(ACCENT, 0.3),
                            bgcolor: selected ? alpha(ACCENT, 0.06) : alpha(ACCENT, 0.02),
                          },
                        }}
                      >
                        <Box
                          sx={{
                            width: 44,
                            height: 44,
                            borderRadius: 2.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            background: selected ? GRADIENT_PRIMARY : 'transparent',
                            bgcolor: selected ? undefined : alpha(ACCENT, 0.08),
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <opt.icon sx={{ fontSize: 22, color: selected ? '#fff' : ACCENT }} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={800} sx={{ color: selected ? ACCENT_DARK : 'text.primary' }}>
                            {opt.title}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.3, display: 'block', mt: 0.25 }}>
                            {opt.desc}
                          </Typography>
                        </Box>
                      </Paper>
                    )
                  })}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={cardSx}>
              <CardContent sx={{ p: 3 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2.5 }}>
                  <Box sx={{ width: 24, height: 24, borderRadius: '50%', background: GRADIENT_PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="caption" sx={{ color: '#fff', fontWeight: 900, fontSize: '0.7rem', lineHeight: 1 }}>2</Typography>
                  </Box>
                  <Typography variant="subtitle2" fontWeight={800}>Subí tu imagen</Typography>
                </Stack>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {!preview ? (
                  <Paper
                    elevation={0}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                    onDragLeave={() => setDragActive(false)}
                    onClick={() => fileInputRef.current?.click()}
                    sx={{
                      p: 5,
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderRadius: 4,
                      border: '2px dashed',
                      borderColor: dragActive ? ACCENT : alpha('#94A3B8', 0.4),
                      bgcolor: dragActive ? alpha(ACCENT, 0.04) : alpha('#F8FAFC', 0.5),
                      transition: 'all 0.25s ease',
                      '&:hover': {
                        borderColor: ACCENT_LIGHT,
                        bgcolor: alpha(ACCENT, 0.03),
                        '& .upload-icon-wrapper': {
                          transform: 'translateY(-2px)',
                          bgcolor: alpha(ACCENT, 0.1),
                        },
                      },
                    }}
                  >
                    <Box
                      className="upload-icon-wrapper"
                      sx={{
                        width: 64,
                        height: 64,
                        borderRadius: 3,
                        bgcolor: alpha('#94A3B8', 0.08),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        mx: 'auto',
                        mb: 2,
                        transition: 'all 0.25s ease',
                      }}
                    >
                      <UploadIcon sx={{ fontSize: 28, color: dragActive ? ACCENT : '#94A3B8' }} />
                    </Box>
                    <Typography variant="body2" fontWeight={600} sx={{ color: dragActive ? ACCENT : 'text.secondary' }}>
                      Arrastrá una imagen o hacé click para seleccionar
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.5, display: 'block' }}>
                      JPG, PNG, WebP — hasta 10 MB
                    </Typography>
                  </Paper>
                ) : (
                  <Box>
                    <Box
                      sx={{
                        borderRadius: 3,
                        overflow: 'hidden',
                        bgcolor: '#f1f5f9',
                        border: '1px solid',
                        borderColor: 'divider',
                        position: 'relative',
                      }}
                    >
                      <Box
                        component="img"
                        src={preview}
                        alt="Preview"
                        sx={{
                          width: '100%',
                          maxHeight: 280,
                          objectFit: 'contain',
                          display: 'block',
                          p: 1,
                        }}
                      />
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SwapIcon sx={{ fontSize: 16 }} />}
                        onClick={() => fileInputRef.current?.click()}
                        sx={{
                          borderRadius: 2.5,
                          textTransform: 'none',
                          fontWeight: 600,
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&:hover': { borderColor: ACCENT, color: ACCENT },
                        }}
                      >
                        Cambiar
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DeleteIcon sx={{ fontSize: 16 }} />}
                        onClick={handleClear}
                        sx={{
                          borderRadius: 2.5,
                          textTransform: 'none',
                          fontWeight: 600,
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&:hover': { borderColor: 'error.main', color: 'error.main' },
                        }}
                      >
                        Limpiar
                      </Button>
                    </Stack>
                  </Box>
                )}
              </CardContent>
            </Card>

            {!isRemoveBg && (
              <Card sx={cardSx}>
                <CardContent sx={{ p: 3 }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2.5 }}>
                    <Box sx={{ width: 24, height: 24, borderRadius: '50%', background: GRADIENT_PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography variant="caption" sx={{ color: '#fff', fontWeight: 900, fontSize: '0.7rem', lineHeight: 1 }}>3</Typography>
                    </Box>
                    <Typography variant="subtitle2" fontWeight={800}>Describí los cambios</Typography>
                  </Stack>

                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="Ej: Fondo blanco de estudio profesional con iluminación suave..."
                    inputProps={{ maxLength: 1000 }}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 3,
                        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                          borderColor: ACCENT,
                          borderWidth: 2,
                        },
                      },
                    }}
                  />

                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5, mb: 2 }}>
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {prompt.length}/1000
                    </Typography>
                  </Stack>

                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1.5 }}>
                    <LightbulbIcon sx={{ fontSize: 15, color: '#F59E0B' }} />
                    <Typography variant="caption" fontWeight={700} sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.8, fontSize: '0.65rem' }}>
                      Ideas rápidas
                    </Typography>
                  </Stack>

                  <Stack direction="row" flexWrap="wrap" gap={0.75}>
                    {PROMPT_SUGGESTIONS.map(s => (
                      <Chip
                        key={s.label}
                        icon={<s.icon sx={{ fontSize: '15px !important' }} />}
                        label={s.label}
                        size="small"
                        onClick={() => setPrompt(s.full)}
                        variant={prompt === s.full ? 'filled' : 'outlined'}
                        sx={{
                          fontWeight: 600,
                          fontSize: '0.72rem',
                          borderRadius: 2,
                          borderColor: prompt === s.full ? ACCENT : 'divider',
                          bgcolor: prompt === s.full ? alpha(ACCENT, 0.08) : 'transparent',
                          color: prompt === s.full ? ACCENT_DARK : 'text.secondary',
                          transition: 'all 0.15s ease',
                          '&:hover': {
                            borderColor: ACCENT_LIGHT,
                            bgcolor: alpha(ACCENT, 0.06),
                            color: ACCENT,
                          },
                        }}
                      />
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Button
              variant="contained"
              size="large"
              fullWidth
              onClick={handleProcess}
              disabled={processing || !file}
              startIcon={
                processing ? (
                  <CircularProgress size={20} sx={{ color: 'rgba(255,255,255,0.7)' }} />
                ) : (
                  <MagicIcon />
                )
              }
              sx={{
                borderRadius: 3.5,
                textTransform: 'none',
                fontWeight: 800,
                py: 2,
                fontSize: '1rem',
                letterSpacing: 0.2,
                background: processing ? alpha(ACCENT, 0.7) : GRADIENT_PRIMARY,
                boxShadow: processing ? 'none' : `0 8px 24px ${alpha(ACCENT, 0.35)}`,
                transition: 'all 0.25s ease',
                '&:hover': {
                  background: GRADIENT_DARK,
                  boxShadow: `0 12px 32px ${alpha(ACCENT, 0.4)}`,
                  transform: 'translateY(-1px)',
                },
                '&:active': { transform: 'translateY(0)' },
                '&.Mui-disabled': {
                  background: alpha('#94A3B8', 0.12),
                  color: alpha('#94A3B8', 0.5),
                  boxShadow: 'none',
                },
              }}
            >
              {processing
                ? 'Procesando con IA...'
                : isRemoveBg
                  ? 'Quitar fondo'
                  : 'Generar variación'}
            </Button>
          </Stack>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card sx={{ ...cardSx, minHeight: 500, display: 'flex', flexDirection: 'column' }}>
            <Box
              sx={{
                px: 3,
                py: 2,
                borderBottom: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: results.length > 0 ? '#22C55E' : alpha('#94A3B8', 0.4) }} />
                <Typography variant="subtitle2" fontWeight={800}>Resultados</Typography>
                {results.length > 0 && (
                  <Chip label={results.length} size="small" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700, bgcolor: alpha(ACCENT, 0.08), color: ACCENT }} />
                )}
              </Stack>
            </Box>

            <CardContent sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
              {results.length === 0 ? (
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                  <Box
                    sx={{
                      width: 88,
                      height: 88,
                      borderRadius: 4,
                      background: alpha('#94A3B8', 0.06),
                      border: '2px dashed',
                      borderColor: alpha('#94A3B8', 0.15),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mb: 3,
                    }}
                  >
                    <EmptyIcon sx={{ fontSize: 36, color: alpha('#94A3B8', 0.35) }} />
                  </Box>
                  <Typography variant="body1" fontWeight={700} sx={{ color: 'text.secondary', mb: 0.5 }}>
                    Sin resultados todavía
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.disabled', textAlign: 'center', maxWidth: 280 }}>
                    Subí una foto de producto y elegí una acción para ver la magia de la IA
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2.5}>
                  {results.map(result => (
                    <Paper
                      key={result.id}
                      elevation={0}
                      sx={{
                        borderRadius: 4,
                        overflow: 'hidden',
                        border: '1px solid',
                        borderColor: 'divider',
                        transition: 'all 0.25s ease',
                        '&:hover': {
                          boxShadow: `0 4px 20px ${alpha('#000', 0.06)}`,
                          borderColor: alpha(ACCENT, 0.2),
                        },
                      }}
                    >
                      <Box
                        sx={{
                          bgcolor: '#f8fafc',
                          backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23f1f5f9'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23f1f5f9'/%3E%3C/svg%3E")`,
                          backgroundSize: '20px 20px',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          p: 2.5,
                          minHeight: 200,
                          position: 'relative',
                        }}
                      >
                        <Box
                          component="img"
                          src={result.image}
                          alt="Resultado IA"
                          sx={{
                            maxWidth: '100%',
                            maxHeight: 380,
                            objectFit: 'contain',
                            borderRadius: 2,
                            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))',
                          }}
                        />
                      </Box>

                      <Box sx={{ px: 2.5, py: 2, borderTop: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                            <Box
                              sx={{
                                width: 32,
                                height: 32,
                                borderRadius: 2,
                                background: result.mode === MODES.REMOVE_BG ? 'linear-gradient(135deg, #10B981, #059669)' : GRADIENT_PRIMARY,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {result.mode === MODES.REMOVE_BG ? (
                                <RemoveBgIcon sx={{ fontSize: 16, color: '#fff' }} />
                              ) : (
                                <VariationIcon sx={{ fontSize: 16, color: '#fff' }} />
                              )}
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={700}>
                                {result.mode === MODES.REMOVE_BG ? 'Fondo removido' : 'Variación generada'}
                              </Typography>
                              {result.prompt && (
                                <Typography variant="caption" color="text.secondary" noWrap title={result.prompt} sx={{ display: 'block', maxWidth: 260 }}>
                                  {result.prompt}
                                </Typography>
                              )}
                            </Box>
                          </Stack>

                          <Stack direction="row" spacing={0.25}>
                            <Tooltip title="Descargar" arrow>
                              <IconButton
                                size="small"
                                onClick={() => handleDownload(result)}
                                sx={{
                                  color: 'text.secondary',
                                  '&:hover': { color: ACCENT, bgcolor: alpha(ACCENT, 0.08) },
                                }}
                              >
                                <DownloadIcon sx={{ fontSize: 19 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Copiar al portapapeles" arrow>
                              <IconButton
                                size="small"
                                onClick={() => handleCopyToClipboard(result)}
                                sx={{
                                  color: 'text.secondary',
                                  '&:hover': { color: ACCENT, bgcolor: alpha(ACCENT, 0.08) },
                                }}
                              >
                                <CopyIcon sx={{ fontSize: 19 }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Eliminar" arrow>
                              <IconButton
                                size="small"
                                onClick={() => handleRemoveResult(result.id)}
                                sx={{
                                  color: 'text.secondary',
                                  '&:hover': { color: '#EF4444', bgcolor: alpha('#EF4444', 0.08) },
                                }}
                              >
                                <DeleteIcon sx={{ fontSize: 19 }} />
                              </IconButton>
                            </Tooltip>
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
    </Box>
  )
}

export default ImageAiEditor
