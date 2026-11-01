// 📁 src/pages/ImageAiEditor.js
//
// Editor de imágenes con IA: quitar el fondo de una foto de producto, o
// generarle uno nuevo, y sumar el resultado a un producto del catálogo.
//
// Lo que esta pantalla cuida:
//
//   - Qué cuesta cada cosa. Quitar el fondo corre en el servidor y no usa
//     cuota; generar un fondo sí (imageEdits del plan). Se muestra cuánto
//     queda antes de gastarlo, no después.
//   - No perder un resultado. Cada fondo generado ya se cobró: cambiar de foto
//     no borra los resultados, irse a otra pantalla del panel y volver los
//     conserva, y recargar o cerrar la pestaña con imágenes sin guardar pide
//     confirmación.
//   - Aceptar solo lo que el backend acepta (constants/imageUpload.js refleja
//     backend/config/imageUploadPolicy.js), y decirlo antes de subir.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  SwapHoriz as SwapIcon,
  CheckCircle as CheckIcon,
} from '@mui/icons-material'
import { useSnackbar } from 'notistack'
import { useSelector } from 'react-redux'
import { buildSessionKey } from '../features/auth/authSlice'
import { removeBackground, generateVariation } from '../services/imageAiService'
import { getAiBudget } from '../services/aiBudgetService'
import productService from '@features/product/productService'
import { MAX_IMAGE_SIZE_MB, SUPPORTED_IMAGE_TYPES } from '../constants/imageUpload'

const BRAND = {
  ink: '#050b1f',
  blue: '#0b6bff',
  paper: '#f4f7ff',
  line: '#dfe6fb',
  muted: '#55618a',
  green: '#047857',
  amber: '#b45309',
  red: '#b42318',
}

const DISPLAY_FONT = 'Montserrat, Roboto, ui-sans-serif, system-ui, sans-serif'

const PANEL_SX = { borderRadius: 4, borderColor: BRAND.line, boxShadow: 'none', bgcolor: '#fff' }

const MODES = { REMOVE_BG: 'remove-bg', VARIATION: 'variation' }

const MAX_FILE_SIZE = MAX_IMAGE_SIZE_MB * 1024 * 1024

// El backend corta en 1000 (imageAiCtrl.handleGenerateVariation).
export const PROMPT_MAX = 1000

// Windows y algunos navegadores entregan un HEIC con type vacío. Sin esto se
// rechazaba una foto válida de iPhone, o viajaba como octet-stream y la
// rechazaba el backend.
const EXTENSION_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

/**
 * Valida una imagen contra lo que acepta el backend y la devuelve con el tipo
 * correcto. Antes se aceptaba cualquier `image/*`: un GIF o un SVG pasaban
 * acá, se subían, y recién el backend decía que no.
 *
 * @returns {{ file: File } | { error: string }}
 */
export const checkImageFile = file => {
  const extension = String(file?.name || '')
    .split('.')
    .pop()
    .toLowerCase()
  const type = file?.type || EXTENSION_TYPES[extension] || ''

  if (!SUPPORTED_IMAGE_TYPES.includes(type)) {
    return { error: 'Ese formato no se puede usar. Subí una foto JPG, PNG, WebP, AVIF o HEIC.' }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { error: `La imagen no puede superar los ${MAX_IMAGE_SIZE_MB} MB.` }
  }

  return { file: file.type === type ? file : new File([file], file.name, { type }) }
}

// 'store' no tiene entrada acá: es directamente el resultado de "Quitar
// fondo" (mode REMOVE_BG), no una variante de "Generar variación".
const PURPOSE_OPTIONS = [
  { value: '', label: 'Genérico', hint: 'Mantiene la proporción de tu foto.' },
  { value: 'ad', label: 'Publicidad', hint: 'Formato panorámico 16:9.' },
  { value: 'social', label: 'Redes sociales', hint: 'Formato cuadrado 1:1.' },
  { value: 'alternative', label: 'Alternativa', hint: 'Formato vertical 4:5.' },
]

const PROMPT_SUGGESTIONS = [
  'Fondo blanco de estudio profesional con iluminación suave',
  'Sobre una mesa de madera rústica con luz natural cálida',
  'Fondo minimalista gris claro con sombra sutil',
  'Escena lifestyle: escritorio moderno con plantas',
  'Fondo degradado suave de tonos pastel',
  'Sobre mármol blanco con luz cenital',
]

/**
 * Cuánto queda de fondos generados este mes, en palabras. null cuando no se
 * sabe: la pantalla funciona igual sin el dato.
 */
export const describeQuota = edits => {
  if (!edits) return null
  if (edits.unlimited) return { text: 'Sin tope en tu plan', exhausted: false }

  const remaining = Number(edits.remaining)
  const limit = Number(edits.limit)
  if (!Number.isFinite(remaining)) return null

  if (remaining <= 0) {
    return {
      text: 'Llegaste al tope de fondos generados de este mes.',
      exhausted: true,
    }
  }

  return {
    text: `Te quedan ${remaining.toLocaleString('es-AR')} de ${limit.toLocaleString('es-AR')} este mes`,
    exhausted: false,
  }
}

const fmtSize = bytes => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// El resultado de quitar el fondo es transparente: se ve sobre un damero.
const CHECKER =
  "url(\"data:image/svg+xml,%3Csvg width='20' height='20' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='10' height='10' fill='%23eef1fb'/%3E%3Crect x='10' y='10' width='10' height='10' fill='%23eef1fb'/%3E%3C/svg%3E\")"

const canCopyImages = () =>
  typeof window !== 'undefined' &&
  typeof window.ClipboardItem === 'function' &&
  Boolean(navigator.clipboard?.write)

const Pill = ({ tone = 'muted', children }) => {
  const tones = {
    blue: { color: BRAND.blue, bg: '#e8f0ff' },
    green: { color: BRAND.green, bg: '#e7f6ef' },
    amber: { color: BRAND.amber, bg: '#fdf3e7' },
    muted: { color: BRAND.muted, bg: '#eef1fb' },
  }
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.1,
        py: 0.2,
        borderRadius: 999,
        fontFamily: theme => theme.typography.fontFamily,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        color: tones[tone].color,
        bgcolor: tones[tone].bg,
      }}
    >
      {children}
    </Box>
  )
}

const StepTitle = ({ n, children, aside }) => (
  <Stack
    direction="row"
    spacing={1.25}
    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.75 }}
  >
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
      <Box
        aria-hidden
        sx={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          fontFamily: theme => theme.typography.fontFamily,
          fontSize: 12,
          fontWeight: 800,
          color: BRAND.blue,
          bgcolor: '#e8f0ff',
        }}
      >
        {n}
      </Box>
      <Typography
        component="h2"
        sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 16, color: BRAND.ink }}
      >
        {children}
      </Typography>
    </Stack>
    {aside}
  </Stack>
)

const ModeOption = ({ selected, disabled, icon: Icon, title, desc, cost, onSelect }) => (
  <ButtonBase
    role="radio"
    aria-checked={selected}
    disabled={disabled}
    onClick={onSelect}
    focusRipple
    sx={{
      width: '100%',
      p: 1.5,
      borderRadius: 3,
      textAlign: 'left',
      justifyContent: 'flex-start',
      alignItems: 'flex-start',
      gap: 1.5,
      border: `2px solid ${selected ? BRAND.blue : BRAND.line}`,
      bgcolor: selected ? '#f2f7ff' : '#fff',
      transition: 'border-color 0.15s ease, background-color 0.15s ease',
      '&:hover': { borderColor: selected ? BRAND.blue : '#b9c8f2' },
      '&.Mui-focusVisible': { outline: `3px solid ${BRAND.blue}33`, outlineOffset: 2 },
      '&.Mui-disabled': { opacity: 0.6 },
    }}
  >
    <Box
      sx={{
        width: 38,
        height: 38,
        borderRadius: 2,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        color: selected ? '#fff' : BRAND.blue,
        bgcolor: selected ? BRAND.blue : '#e8f0ff',
      }}
    >
      <Icon sx={{ fontSize: 20 }} />
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 15, color: BRAND.ink, lineHeight: 1.3 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: BRAND.muted, lineHeight: 1.35 }}>
        {desc}
      </Typography>
      {cost && <Box sx={{ mt: 0.75 }}>{cost}</Box>}
    </Box>
  </ButtonBase>
)

// Los resultados viven fuera del componente para sobrevivir a la navegación
// interna: el panel usa BrowserRouter, que no permite bloquear un cambio de
// ruta (useBlocker exige un data router), y beforeunload solo cubre recargar
// o cerrar la pestaña. Irse por el menú desmontaba el editor y descartaba
// imágenes ya cobradas sin preguntar.
//
// Van por `usuario:comercio`: cerrar sesión y entrar con otro comercio en la
// misma pestaña no tiene que mostrar las imágenes del anterior.
const resultsBySession = new Map()

/** Solo para tests: el Map sobrevive entre tests del mismo archivo. */
export const resetEditorResults = () => resultsBySession.clear()

const ImageAiEditor = () => {
  const { enqueueSnackbar } = useSnackbar()
  const sessionKey = useSelector(state => buildSessionKey(state.user?.user)) || 'sin-sesion'
  const fileInputRef = useRef(null)
  const previewUrlRef = useRef(null)
  const mountedRef = useRef(true)
  const searchDebounceRef = useRef(null)
  const productSearchIdRef = useRef(0)

  const [mode, setMode] = useState(MODES.REMOVE_BG)
  const [purpose, setPurpose] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [fileError, setFileError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [processing, setProcessing] = useState(false)
  const [results, setResults] = useState(() => resultsBySession.get(sessionKey) || [])
  const [resultsSession, setResultsSession] = useState(sessionKey)

  // Si la sesión cambia con el editor abierto, se muestran los de la nueva
  // (ajuste durante el render, para que el efecto de abajo nunca guarde los
  // resultados de una sesión bajo la clave de otra).
  if (resultsSession !== sessionKey) {
    setResultsSession(sessionKey)
    setResults(resultsBySession.get(sessionKey) || [])
  }
  const [dragActive, setDragActive] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [quota, setQuota] = useState(null)

  const [attachTarget, setAttachTarget] = useState(null)
  const [productQuery, setProductQuery] = useState('')
  const [productOptions, setProductOptions] = useState([])
  const [productSearching, setProductSearching] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [attaching, setAttaching] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  // El cupo se consulta al entrar y después de cada fondo generado. Si la
  // consulta falla la pantalla sigue andando: el backend igual corta al que
  // no tiene cupo, con su mensaje.
  const loadQuota = useCallback(async () => {
    try {
      const budget = await getAiBudget()
      if (mountedRef.current) setQuota(describeQuota(budget?.metrics?.imageEdits))
    } catch {
      if (mountedRef.current) setQuota(null)
    }
  }, [])

  useEffect(() => {
    loadQuota()
  }, [loadQuota])

  // Lo de otra sesión se suelta (son imágenes en base64, pesan) y lo de esta
  // se guarda para cuando se vuelva a la pantalla.
  useEffect(() => {
    for (const key of resultsBySession.keys()) {
      if (key !== sessionKey) resultsBySession.delete(key)
    }
    if (results.length) resultsBySession.set(sessionKey, results)
    else resultsBySession.delete(sessionKey)
  }, [sessionKey, results])

  // Cada resultado sin descargar ni agregar a un producto se pierde al
  // recargar o cerrar la pestaña, y si fue un fondo generado, ya se cobró.
  const unsavedCount = results.filter(r => !r.savedTo && !r.downloaded).length

  useEffect(() => {
    if (!unsavedCount) return undefined
    const warn = event => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsavedCount])

  const handleFileSelect = useCallback(
    event => {
      const selected = event.target.files?.[0]
      // Se limpia el input para que elegir otra vez el mismo archivo dispare
      // onChange (antes, "Cambiar" por la misma foto no hacía nada).
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (!selected || processing) return

      const checked = checkImageFile(selected)
      if (checked.error) {
        setFileError(checked.error)
        return
      }

      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      const nextPreviewUrl = URL.createObjectURL(checked.file)
      previewUrlRef.current = nextPreviewUrl
      setFileError('')
      setPreviewFailed(false)
      setFile(checked.file)
      setPreview(nextPreviewUrl)
      // Los resultados NO se borran: cada uno es una imagen ya hecha (y si es
      // un fondo generado, ya pagada). Antes cambiar de foto los descartaba
      // sin aviso.
    },
    [processing],
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

  const openPicker = () => {
    if (!processing) fileInputRef.current?.click()
  }

  const handleClearPhoto = () => {
    if (processing) return
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
    setFile(null)
    setPreview(null)
    setFileError('')
  }

  const isRemoveBg = mode === MODES.REMOVE_BG
  const trimmedPrompt = prompt.trim()
  const quotaExhausted = !isRemoveBg && Boolean(quota?.exhausted)
  const canProcess =
    Boolean(file) && !processing && !quotaExhausted && (isRemoveBg || Boolean(trimmedPrompt))

  const handleProcess = async () => {
    if (!file || processing) return
    if (!isRemoveBg && !trimmedPrompt) return

    // Se fija todo al momento del clic: si mientras procesa se cambia de modo
    // o de descripción, el resultado igual se etiqueta con lo que se pidió.
    const request = {
      mode,
      prompt: isRemoveBg ? null : trimmedPrompt,
      purpose: isRemoveBg ? '' : purpose,
    }

    try {
      setProcessing(true)
      const result = isRemoveBg
        ? await removeBackground(file)
        : await generateVariation(file, request.prompt, request.purpose || undefined)

      setResults(prev => [
        {
          id: Date.now(),
          image: result.image,
          size: result.size,
          sourceName: file.name,
          savedTo: null,
          downloaded: false,
          ...request,
        },
        ...prev,
      ])
      enqueueSnackbar(isRemoveBg ? 'Listo: fondo quitado' : 'Listo: fondo generado', {
        variant: 'success',
      })
    } catch (error) {
      enqueueSnackbar(
        error.response?.data?.message || error.message || 'No se pudo procesar la imagen',
        { variant: 'error' },
      )
    } finally {
      setProcessing(false)
      if (!isRemoveBg) loadQuota()
    }
  }

  const markResult = (id, changes) =>
    setResults(prev => prev.map(r => (r.id === id ? { ...r, ...changes } : r)))

  const handleDownload = r => {
    const a = document.createElement('a')
    a.href = r.image
    a.download = `imagen-ia-${r.id}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    markResult(r.id, { downloaded: true })
  }

  const handleCopy = async r => {
    try {
      const res = await fetch(r.image)
      const blob = await res.blob()
      await navigator.clipboard.write([new window.ClipboardItem({ [blob.type]: blob })])
      enqueueSnackbar('Imagen copiada', { variant: 'success' })
    } catch {
      enqueueSnackbar('No se pudo copiar la imagen. Descargala.', { variant: 'error' })
    }
  }

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
    const searchId = ++productSearchIdRef.current
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
        if (mountedRef.current && searchId === productSearchIdRef.current) {
          setProductOptions(res?.data || [])
        }
      } catch {
        if (mountedRef.current && searchId === productSearchIdRef.current) {
          setProductOptions([])
        }
      } finally {
        if (mountedRef.current) setProductSearching(false)
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
        imagePurpose: attachTarget.mode === MODES.REMOVE_BG ? 'store' : attachTarget.purpose || '',
      })

      markResult(attachTarget.id, { savedTo: selectedProduct.title })
      enqueueSnackbar(`Imagen agregada a "${selectedProduct.title}"`, { variant: 'success' })
      setAttachTarget(null)
    } catch (error) {
      enqueueSnackbar(error.message || 'No se pudo agregar la imagen al producto', {
        variant: 'error',
      })
    } finally {
      setAttaching(false)
    }
  }

  const clearResults = () => {
    setResults([])
    setConfirmClear(false)
  }

  const purposeHint = PURPOSE_OPTIONS.find(o => o.value === purpose)?.hint

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1280, mx: 'auto', color: BRAND.ink }}>
      <Box component="header" sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          sx={{ display: 'block', color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          DISEÑO Y CONTENIDO
        </Typography>
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
          Editor de imágenes
        </Typography>
        <Typography sx={{ mt: 0.5, maxWidth: 680, color: BRAND.muted }}>
          Quitale el fondo a una foto de producto o generale uno nuevo con IA, y sumá el resultado a
          tu catálogo.
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 5fr) minmax(0, 7fr)' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={2.5}>
          <Paper variant="outlined" component="section" sx={{ ...PANEL_SX, p: 2.5 }}>
            <StepTitle n={1}>Qué querés hacer</StepTitle>
            <Stack role="radiogroup" aria-label="Qué querés hacer" spacing={1.25}>
              <ModeOption
                selected={isRemoveBg}
                disabled={processing}
                icon={RemoveBgIcon}
                title="Quitar fondo"
                desc="Deja el producto solo, sobre fondo transparente (PNG)."
                cost={<Pill tone="green">No usa cuota</Pill>}
                onSelect={() => setMode(MODES.REMOVE_BG)}
              />
              <ModeOption
                selected={!isRemoveBg}
                disabled={processing}
                icon={VariationIcon}
                title="Generar variación"
                desc="La IA le pone un fondo o una escena nueva al producto."
                cost={
                  quota ? (
                    <Pill tone={quota.exhausted ? 'amber' : 'blue'}>
                      {quota.exhausted ? 'Sin cupo este mes' : quota.text}
                    </Pill>
                  ) : (
                    <Pill tone="blue">Usa 1 fondo del plan</Pill>
                  )
                }
                onSelect={() => setMode(MODES.VARIATION)}
              />
            </Stack>
          </Paper>

          <Paper variant="outlined" component="section" sx={{ ...PANEL_SX, p: 2.5 }}>
            <StepTitle n={2}>Tu foto</StepTitle>

            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_IMAGE_TYPES.join(',')}
              onChange={handleFileSelect}
              aria-label="Elegir foto"
              style={{ display: 'none' }}
            />

            {!preview ? (
              <ButtonBase
                onClick={openPicker}
                onDrop={handleDrop}
                onDragOver={e => {
                  e.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                disabled={processing}
                focusRipple
                sx={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  p: { xs: 3, md: 4 },
                  borderRadius: 3,
                  border: `2px dashed ${dragActive ? BRAND.blue : fileError ? BRAND.red : '#c3cfee'}`,
                  bgcolor: dragActive ? '#f2f7ff' : BRAND.paper,
                  transition: 'border-color 0.15s ease, background-color 0.15s ease',
                  '&:hover': { borderColor: BRAND.blue },
                  '&.Mui-focusVisible': { outline: `3px solid ${BRAND.blue}33`, outlineOffset: 2 },
                }}
              >
                <UploadIcon sx={{ fontSize: 30, color: BRAND.blue, mb: 1 }} />
                <Typography sx={{ fontWeight: 800, color: BRAND.ink }}>
                  Arrastrá una foto o hacé clic para elegirla
                </Typography>
                <Typography variant="body2" sx={{ color: BRAND.muted, mt: 0.25 }}>
                  JPG, PNG, WebP, AVIF o HEIC · hasta {MAX_IMAGE_SIZE_MB} MB
                </Typography>
              </ButtonBase>
            ) : (
              <Box>
                <Box
                  sx={{
                    position: 'relative',
                    borderRadius: 3,
                    overflow: 'hidden',
                    border: `1px solid ${BRAND.line}`,
                    bgcolor: BRAND.paper,
                    minHeight: 140,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {previewFailed ? (
                    // HEIC: el navegador no lo puede mostrar, pero el backend sí
                    // lo procesa. Mejor decirlo que dejar un ícono roto.
                    <Typography
                      variant="body2"
                      sx={{ color: BRAND.muted, p: 3, textAlign: 'center' }}
                    >
                      Tu navegador no puede mostrar esta foto, pero se puede procesar igual.
                    </Typography>
                  ) : (
                    <Box
                      component="img"
                      src={preview}
                      alt="Tu foto"
                      onError={() => setPreviewFailed(true)}
                      sx={{
                        width: '100%',
                        maxHeight: 260,
                        objectFit: 'contain',
                        display: 'block',
                        p: 1,
                      }}
                    />
                  )}
                  {processing && (
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        bgcolor: 'rgba(255,255,255,0.8)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1.25,
                      }}
                    >
                      <CircularProgress size={32} />
                      <Typography sx={{ fontWeight: 700, fontSize: 14, color: BRAND.ink }}>
                        {isRemoveBg
                          ? 'Quitando el fondo…'
                          : 'Generando el fondo… puede tardar un minuto'}
                      </Typography>
                    </Box>
                  )}
                </Box>

                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 1.25 }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    title={file?.name}
                    sx={{ color: BRAND.muted, minWidth: 0 }}
                  >
                    {file?.name} · {file ? fmtSize(file.size) : ''}
                  </Typography>
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Button
                      size="small"
                      startIcon={<SwapIcon />}
                      onClick={openPicker}
                      disabled={processing}
                      sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                      Cambiar
                    </Button>
                    <Button
                      size="small"
                      startIcon={<DeleteIcon />}
                      onClick={handleClearPhoto}
                      disabled={processing}
                      sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted }}
                    >
                      Quitar
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            )}

            {fileError && (
              <Alert severity="error" sx={{ mt: 1.5, borderRadius: 3 }}>
                {fileError}
              </Alert>
            )}
          </Paper>

          {!isRemoveBg && (
            <Paper variant="outlined" component="section" sx={{ ...PANEL_SX, p: 2.5 }}>
              <StepTitle n={3}>Cómo querés el fondo</StepTitle>

              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Descripción del fondo"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                disabled={processing}
                placeholder="Ej: sobre una mesa de madera clara, con luz natural de ventana"
                helperText={`${prompt.length}/${PROMPT_MAX}`}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { maxLength: PROMPT_MAX },
                  formHelperText: { sx: { textAlign: 'right', mx: 0 } },
                }}
              />

              <Typography sx={{ fontWeight: 700, fontSize: 13, color: BRAND.muted, mt: 1, mb: 1 }}>
                Ideas para empezar
              </Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {PROMPT_SUGGESTIONS.map(s => {
                  const active = prompt === s
                  return (
                    <ButtonBase
                      key={s}
                      onClick={() => setPrompt(s)}
                      disabled={processing}
                      aria-pressed={active}
                      sx={{
                        px: 1.25,
                        py: 0.5,
                        borderRadius: 999,
                        fontFamily: theme => theme.typography.fontFamily,
                        fontSize: 13,
                        fontWeight: 600,
                        textAlign: 'left',
                        border: `1px solid ${active ? BRAND.blue : BRAND.line}`,
                        color: active ? BRAND.blue : BRAND.ink,
                        bgcolor: active ? '#e8f0ff' : '#fff',
                        '&:hover': { borderColor: BRAND.blue },
                      }}
                    >
                      {s}
                    </ButtonBase>
                  )
                })}
              </Stack>

              <Typography
                sx={{ fontWeight: 700, fontSize: 13, color: BRAND.muted, mt: 2.5, mb: 1 }}
              >
                Para qué la vas a usar
              </Typography>
              <Stack
                role="radiogroup"
                aria-label="Para qué la vas a usar"
                direction="row"
                sx={{ flexWrap: 'wrap', gap: 0.75 }}
              >
                {PURPOSE_OPTIONS.map(o => {
                  const active = purpose === o.value
                  return (
                    <ButtonBase
                      key={o.value || 'generic'}
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPurpose(o.value)}
                      disabled={processing}
                      sx={{
                        px: 1.5,
                        py: 0.6,
                        borderRadius: 999,
                        fontFamily: theme => theme.typography.fontFamily,
                        fontSize: 13,
                        fontWeight: 700,
                        border: `1px solid ${active ? BRAND.blue : BRAND.line}`,
                        color: active ? '#fff' : BRAND.ink,
                        bgcolor: active ? BRAND.blue : '#fff',
                      }}
                    >
                      {o.label}
                    </ButtonBase>
                  )
                })}
              </Stack>
              <Typography variant="body2" sx={{ color: BRAND.muted, mt: 1 }}>
                {purposeHint}
              </Typography>
            </Paper>
          )}

          {quotaExhausted && (
            <Alert severity="warning" sx={{ borderRadius: 3 }}>
              {quota.text} Quitar el fondo sigue disponible, y en Mi suscripción podés ver los
              planes con más cupo.
            </Alert>
          )}

          <Button
            variant="contained"
            size="large"
            disableElevation
            fullWidth
            onClick={handleProcess}
            disabled={!canProcess}
            startIcon={processing ? <CircularProgress size={18} color="inherit" /> : <MagicIcon />}
            sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 800, fontSize: 16, py: 1.5 }}
          >
            {processing ? 'Procesando…' : isRemoveBg ? 'Quitar fondo' : 'Generar variación'}
          </Button>
          {!isRemoveBg && file && !trimmedPrompt && !processing && (
            <Typography variant="body2" sx={{ color: BRAND.muted, mt: -1.5, textAlign: 'center' }}>
              Describí el fondo para poder generarlo.
            </Typography>
          )}
        </Stack>

        <Paper
          variant="outlined"
          component="section"
          aria-label="Resultados"
          sx={{ ...PANEL_SX, overflow: 'hidden' }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 2.5,
              py: 1.75,
              borderBottom: `1px solid ${BRAND.line}`,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography
                component="h2"
                sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 16 }}
              >
                Resultados
              </Typography>
              {results.length > 0 && <Pill>{results.length}</Pill>}
              {unsavedCount > 0 && <Pill tone="amber">{unsavedCount} sin guardar</Pill>}
            </Stack>
            {results.length > 1 && (
              <Button
                size="small"
                onClick={() => (unsavedCount ? setConfirmClear(true) : clearResults())}
                disabled={processing}
                sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted }}
              >
                Borrar todos
              </Button>
            )}
          </Stack>
          {processing && <LinearProgress />}

          <Box sx={{ p: 2.5 }}>
            {results.length === 0 ? (
              <Box sx={{ py: { xs: 4, md: 10 }, textAlign: 'center' }}>
                <MagicIcon sx={{ fontSize: 34, color: '#b9c8f2' }} />
                <Typography sx={{ fontWeight: 800, mt: 1 }}>Todavía no hay resultados</Typography>
                <Typography
                  variant="body2"
                  sx={{ color: BRAND.muted, maxWidth: 320, mx: 'auto', mt: 0.5 }}
                >
                  Subí una foto, elegí qué querés hacer y los resultados van a aparecer acá. Quedan
                  mientras no recargues ni cierres la pestaña: descargalos o sumalos a un producto.
                </Typography>
              </Box>
            ) : (
              <Stack spacing={2}>
                {results.map(r => (
                  <Box
                    key={r.id}
                    sx={{ borderRadius: 3, border: `1px solid ${BRAND.line}`, overflow: 'hidden' }}
                  >
                    <Box
                      sx={{
                        backgroundImage: CHECKER,
                        backgroundSize: '20px 20px',
                        display: 'grid',
                        placeItems: 'center',
                        minHeight: 180,
                        p: 2,
                      }}
                    >
                      <Box
                        component="img"
                        src={r.image}
                        alt={
                          r.mode === MODES.REMOVE_BG
                            ? 'Resultado sin fondo'
                            : 'Resultado con fondo generado'
                        }
                        sx={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }}
                      />
                    </Box>
                    <Box sx={{ p: 1.75, borderTop: `1px solid ${BRAND.line}` }}>
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.75 }}
                      >
                        <Typography sx={{ fontWeight: 800, fontSize: 14 }}>
                          {r.mode === MODES.REMOVE_BG ? 'Sin fondo' : 'Fondo generado'}
                        </Typography>
                        {r.purpose && (
                          <Pill>
                            {PURPOSE_OPTIONS.find(o => o.value === r.purpose)?.label || r.purpose}
                          </Pill>
                        )}
                        {r.savedTo ? (
                          <Pill tone="green">
                            <CheckIcon sx={{ fontSize: 14 }} /> En «{r.savedTo}»
                          </Pill>
                        ) : r.downloaded ? (
                          <Pill tone="green">
                            <CheckIcon sx={{ fontSize: 14 }} /> Descargada
                          </Pill>
                        ) : (
                          <Pill tone="amber">Sin guardar</Pill>
                        )}
                      </Stack>
                      <Typography
                        variant="body2"
                        noWrap
                        title={r.prompt || r.sourceName}
                        sx={{ color: BRAND.muted, mt: 0.5 }}
                      >
                        {r.prompt || `De ${r.sourceName}`}
                      </Typography>

                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}
                      >
                        <Button
                          size="small"
                          variant="contained"
                          disableElevation
                          startIcon={<AttachIcon />}
                          onClick={() => handleOpenAttachDialog(r)}
                          sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                        >
                          Usar en un producto
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<DownloadIcon />}
                          onClick={() => handleDownload(r)}
                          sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                        >
                          Descargar
                        </Button>
                        {canCopyImages() && (
                          <Button
                            size="small"
                            startIcon={<CopyIcon />}
                            onClick={() => handleCopy(r)}
                            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 700 }}
                          >
                            Copiar
                          </Button>
                        )}
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title="Borrar este resultado">
                          <IconButton
                            size="small"
                            aria-label="Borrar este resultado"
                            onClick={() => setResults(prev => prev.filter(x => x.id !== r.id))}
                            sx={{ color: BRAND.muted, '&:hover': { color: BRAND.red } }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Box>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </Paper>
      </Box>

      <Dialog
        open={Boolean(attachTarget)}
        onClose={handleCloseAttachDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          Usar en un producto
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: BRAND.muted, mb: 2 }}>
            La imagen se suma a las fotos del producto, marcada como generada con IA.
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
            filterOptions={x => x}
            disabled={attaching}
            loadingText="Buscando…"
            noOptionsText={productQuery.trim() ? 'Ningún producto coincide' : 'Escribí para buscar'}
            renderInput={params => (
              <TextField
                {...params}
                label="Producto"
                placeholder="Título, marca o SKU"
                autoFocus
                // Se conservan TODOS los slotProps del Autocomplete. Antes este
                // objeto reemplazaba params.slotProps y se perdía htmlInput —
                // la ref, el onChange y el rol del campo—: escribir no buscaba
                // nada y "Usar en un producto" no funcionaba.
                slotProps={{
                  ...params.slotProps,
                  input: {
                    ...params.slotProps.input,
                    endAdornment: (
                      <>
                        {productSearching ? <CircularProgress color="inherit" size={16} /> : null}
                        {params.slotProps.input.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={handleCloseAttachDialog}
            disabled={attaching}
            sx={{ textTransform: 'none' }}
          >
            Cancelar
          </Button>
          <Button
            variant="contained"
            disableElevation
            onClick={handleAttachToProduct}
            disabled={!selectedProduct || attaching}
            startIcon={attaching ? <CircularProgress size={16} color="inherit" /> : <AttachIcon />}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {attaching ? 'Agregando…' : 'Agregar al producto'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
          ¿Borrar todos los resultados?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: BRAND.muted }}>
            {unsavedCount === 1
              ? 'Hay 1 imagen que no descargaste ni sumaste a un producto.'
              : `Hay ${unsavedCount} imágenes que no descargaste ni sumaste a un producto.`}{' '}
            Si las borrás no se pueden recuperar, y los fondos generados ya se descontaron de tu
            cupo.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmClear(false)} sx={{ textTransform: 'none' }}>
            Cancelar
          </Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            onClick={clearResults}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Borrar todos
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default ImageAiEditor
