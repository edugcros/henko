import React, { useState, useCallback, useRef } from 'react'
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
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
  Image as ImageIcon,
  Replay as RetryIcon,
  AutoAwesome as VariationIcon,
} from '@mui/icons-material'
import { useSnackbar } from 'notistack'
import { removeBackground, generateVariation } from '../services/imageAiService'

const MODES = {
  REMOVE_BG: 'remove-bg',
  VARIATION: 'variation',
}

const MAX_FILE_SIZE = 10 * 1024 * 1024

const PROMPT_SUGGESTIONS = [
  'Fondo blanco de estudio profesional con iluminación suave',
  'Sobre una mesa de madera rústica con luz natural cálida',
  'Fondo minimalista gris claro con sombra sutil',
  'Escena de lifestyle: sobre un escritorio moderno con plantas',
  'Fondo degradado suave de tonos pastel',
  'Sobre mármol blanco con luz cenital',
]

const ImageAiEditor = () => {
  const { enqueueSnackbar } = useSnackbar()
  const fileInputRef = useRef(null)

  const [mode, setMode] = useState(MODES.REMOVE_BG)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState([])

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
      const dropped = event.dataTransfer.files?.[0]
      if (dropped) {
        const syntheticEvent = { target: { files: [dropped] } }
        handleFileSelect(syntheticEvent)
      }
    },
    [handleFileSelect],
  )

  const handleDragOver = event => {
    event.preventDefault()
  }

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
        mode === MODES.REMOVE_BG
          ? 'Fondo removido exitosamente'
          : 'Variación generada exitosamente',
        { variant: 'success' },
      )
    } catch (error) {
      const msg =
        error.response?.data?.message ||
        error.message ||
        'Error procesando la imagen'
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
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
      enqueueSnackbar('Imagen copiada al portapapeles', { variant: 'success' })
    } catch {
      enqueueSnackbar('No se pudo copiar la imagen', { variant: 'error' })
    }
  }

  const handleRemoveResult = id => {
    setResults(prev => prev.filter(r => r.id !== id))
  }

  return (
    <Box>
      <Paper
        sx={{
          p: { xs: 2.5, md: 3.5 },
          mb: 3,
          borderRadius: 4,
          background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A78BFA 100%)',
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <Box sx={{ position: 'absolute', bottom: -60, right: 80, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ position: 'relative', zIndex: 1 }}>
          <MagicIcon sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={900} sx={{ letterSpacing: -0.5 }}>
              Editor de Imágenes IA
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
              Quitá fondos o generá variaciones profesionales de tus fotos de producto con inteligencia artificial.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Stack spacing={2.5}>
            <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 2 }}>
                  1. Elegí qué querés hacer
                </Typography>
                <ToggleButtonGroup
                  value={mode}
                  exclusive
                  onChange={(_, val) => val && setMode(val)}
                  fullWidth
                  sx={{
                    '& .MuiToggleButton-root': {
                      textTransform: 'none',
                      fontWeight: 600,
                      py: 1.5,
                      borderRadius: '12px !important',
                      border: '1px solid',
                      borderColor: 'divider',
                      '&.Mui-selected': {
                        bgcolor: '#6366F1',
                        color: '#fff',
                        borderColor: '#6366F1',
                        '&:hover': { bgcolor: '#5558E6' },
                      },
                    },
                    gap: 1,
                    '& .MuiToggleButtonGroup-grouped:not(:first-of-type)': {
                      borderLeft: '1px solid',
                      borderColor: 'divider',
                      ml: 0,
                    },
                  }}
                >
                  <ToggleButton value={MODES.REMOVE_BG}>
                    <RemoveBgIcon sx={{ mr: 1, fontSize: 20 }} />
                    Quitar fondo
                  </ToggleButton>
                  <ToggleButton value={MODES.VARIATION}>
                    <VariationIcon sx={{ mr: 1, fontSize: 20 }} />
                    Generar variación
                  </ToggleButton>
                </ToggleButtonGroup>
              </CardContent>
            </Card>

            <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <CardContent sx={{ p: 2.5 }}>
                <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 2 }}>
                  2. Subí tu imagen
                </Typography>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />

                {!preview ? (
                  <Paper
                    variant="outlined"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                    sx={{
                      p: 4,
                      textAlign: 'center',
                      cursor: 'pointer',
                      borderRadius: 3,
                      borderStyle: 'dashed',
                      borderWidth: 2,
                      borderColor: 'action.disabled',
                      bgcolor: 'action.hover',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: '#6366F1',
                        bgcolor: 'rgba(99,102,241,0.04)',
                      },
                    }}
                  >
                    <UploadIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                      Arrastrá una imagen o hacé click para seleccionar
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
                      JPG, PNG, WebP — máx. 10 MB
                    </Typography>
                  </Paper>
                ) : (
                  <Box sx={{ position: 'relative' }}>
                    <Box
                      component="img"
                      src={preview}
                      alt="Preview"
                      sx={{
                        width: '100%',
                        maxHeight: 300,
                        objectFit: 'contain',
                        borderRadius: 2,
                        bgcolor: '#f1f5f9',
                        display: 'block',
                      }}
                    />
                    <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => fileInputRef.current?.click()}
                        sx={{ borderRadius: 2, textTransform: 'none' }}
                      >
                        Cambiar imagen
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="outlined"
                        onClick={handleClear}
                        sx={{ borderRadius: 2, textTransform: 'none' }}
                      >
                        Limpiar
                      </Button>
                    </Stack>
                  </Box>
                )}
              </CardContent>
            </Card>

            {mode === MODES.VARIATION && (
              <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 2 }}>
                    3. Describí los cambios
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    rows={3}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="Ej: Fondo blanco de estudio profesional con iluminación suave..."
                    helperText={`${prompt.length}/1000 caracteres`}
                    inputProps={{ maxLength: 1000 }}
                    sx={{
                      '& .MuiOutlinedInput-root': { borderRadius: 2 },
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mt: 1.5, mb: 1, display: 'block' }}>
                    Sugerencias rápidas:
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.75}>
                    {PROMPT_SUGGESTIONS.map(suggestion => (
                      <Button
                        key={suggestion}
                        size="small"
                        variant="outlined"
                        onClick={() => setPrompt(suggestion)}
                        sx={{
                          borderRadius: 5,
                          textTransform: 'none',
                          fontSize: '0.75rem',
                          py: 0.25,
                          borderColor: 'divider',
                          color: 'text.secondary',
                          '&:hover': { borderColor: '#6366F1', color: '#6366F1' },
                        }}
                      >
                        {suggestion.length > 40 ? suggestion.slice(0, 40) + '...' : suggestion}
                      </Button>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Button
              variant="contained"
              size="large"
              onClick={handleProcess}
              disabled={processing || !file}
              startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <MagicIcon />}
              sx={{
                borderRadius: 3,
                textTransform: 'none',
                fontWeight: 700,
                py: 1.5,
                fontSize: '1rem',
                bgcolor: '#6366F1',
                '&:hover': { bgcolor: '#5558E6' },
                boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
              }}
            >
              {processing
                ? 'Procesando...'
                : mode === MODES.REMOVE_BG
                  ? 'Quitar fondo'
                  : 'Generar variación'}
            </Button>
          </Stack>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', minHeight: 400 }}>
            <CardContent sx={{ p: 2.5 }}>
              <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 2 }}>
                Resultados
              </Typography>

              {results.length === 0 ? (
                <Box sx={{ py: 8, textAlign: 'center' }}>
                  <Box
                    sx={{
                      width: 64,
                      height: 64,
                      borderRadius: 3,
                      bgcolor: 'action.hover',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mx: 'auto',
                      mb: 2,
                    }}
                  >
                    <ImageIcon sx={{ fontSize: 32, color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    Las imágenes procesadas aparecerán acá
                  </Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
                    Subí una foto y elegí una acción para comenzar
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2.5}>
                  {results.map(result => (
                    <Paper
                      key={result.id}
                      variant="outlined"
                      sx={{ borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}
                    >
                      <Box
                        sx={{
                          bgcolor: '#f1f5f9',
                          backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23e2e8f0'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23e2e8f0'/%3E%3C/svg%3E")`,
                          backgroundSize: '20px 20px',
                          display: 'flex',
                          justifyContent: 'center',
                          p: 2,
                        }}
                      >
                        <Box
                          component="img"
                          src={result.image}
                          alt="Resultado IA"
                          sx={{
                            maxWidth: '100%',
                            maxHeight: 400,
                            objectFit: 'contain',
                            borderRadius: 1,
                          }}
                        />
                      </Box>

                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        sx={{ px: 2, py: 1.5 }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={700}>
                            {result.mode === MODES.REMOVE_BG ? 'Fondo removido' : 'Variación generada'}
                          </Typography>
                          {result.prompt && (
                            <Typography variant="caption" color="text.secondary" noWrap title={result.prompt}>
                              {result.prompt}
                            </Typography>
                          )}
                        </Box>
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title="Descargar">
                            <IconButton size="small" onClick={() => handleDownload(result)}>
                              <DownloadIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Copiar al portapapeles">
                            <IconButton size="small" onClick={() => handleCopyToClipboard(result)}>
                              <CopyIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Eliminar">
                            <IconButton size="small" onClick={() => handleRemoveResult(result.id)}>
                              <DeleteIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Stack>
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
