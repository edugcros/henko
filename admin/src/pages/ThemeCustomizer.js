// src/pages/ThemeCustomizer.js - Diseño de la tienda
//
// El marco del diseñador: la lista de secciones, el editor de la elegida y la
// vista previa en vivo. Los editores de cada sección viven en
// features/theme/editors; el guardado (manual y automático) en
// hooks/useThemeConfig.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import {
  Animation as AnimationIcon,
  ArrowBack as ArrowBackIcon,
  ChevronRight as ChevronRightIcon,
  CloseFullscreen as CloseFullscreenIcon,
  Image as ImageIcon,
  MoreVert as MoreVertIcon,
  OpenInFull as OpenInFullIcon,
  Palette as PaletteIcon,
  Save as SaveIcon,
  Settings as SettingsIcon,
  ShoppingBag as ShoppingBagIcon,
  SmartButton as SmartButtonIcon,
  TextFields as TextFieldsIcon,
  Tune as TuneIcon,
  ViewCompact as ViewCompactIcon,
  Web as WebIcon,
} from '@mui/icons-material'

import adminBaseTheme from '../theme/muiTheme'
import { useTheme } from '@hooks/useThemeConfig'
import {
  AdvancedEditor,
  AnimationsEditor,
  ColorsPanel,
  CustomButton,
  FooterEditor,
  HeaderEditor,
  HeroPanel as HeroEditor,
  LayoutEditor,
  LivePreview,
  ProductsEditor,
  SpacingEditor,
  TypographyEditor,
} from '@features/theme/editors'

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

const APP_BAR_HEIGHT = 64
const PANEL_WIDTH = 440

const SECTION_LIBRARY = [
  {
    id: 'colors',
    label: 'Colores',
    description: 'Fondo, textos, header, botones y precios.',
    icon: <PaletteIcon fontSize="small" />,
    help: 'Cada color tiene un rol: marca, fondo, header, tarjetas, botones y señales como ofertas o sin stock.',
  },
  {
    id: 'typography',
    label: 'Tipografía',
    description: 'Fuentes, tamaños y títulos.',
    icon: <TextFieldsIcon fontSize="small" />,
    help: 'Cómo se lee la tienda: familias tipográficas, tamaño base, títulos y texto secundario.',
  },
  {
    id: 'spacing',
    label: 'Espaciado',
    description: 'Aire entre secciones y bordes.',
    icon: <TuneIcon fontSize="small" />,
    help: 'La separación entre bloques, contenedores y tarjetas, y qué tan redondeados son los bordes.',
  },
  {
    id: 'buttons',
    label: 'Botones',
    description: 'Comprar, agregar al carrito y demás acciones.',
    icon: <SmartButtonIcon fontSize="small" />,
    help: 'Los botones de compra, navegación y formularios, y cómo responden al pasar el mouse.',
  },
  {
    id: 'layout',
    label: 'Estructura',
    description: 'Ancho de página, márgenes y sombras.',
    icon: <ViewCompactIcon fontSize="small" />,
    help: 'El marco donde se muestra la tienda: ancho máximo, márgenes, bordes y sombras.',
  },
  {
    id: 'hero',
    label: 'Portada',
    description: 'El bloque principal de la página de inicio.',
    icon: <ImageIcon fontSize="small" />,
    help: 'Lo primero que ve un cliente al entrar: imagen, título, texto y botón.',
  },
  {
    id: 'header-footer',
    label: 'Encabezado y pie',
    description: 'Logo, menú, newsletter y redes.',
    icon: <WebIcon fontSize="small" />,
    help: 'Lo que acompaña al cliente en todas las páginas: el encabezado con el logo y el menú, y el pie.',
  },
  {
    id: 'products',
    label: 'Productos',
    description: 'Grilla y tarjetas de producto.',
    icon: <ShoppingBagIcon fontSize="small" />,
    help: 'Cómo se muestran los productos en el catálogo: grilla, imagen, etiquetas, precio y acciones.',
  },
  {
    id: 'animations',
    label: 'Animaciones',
    description: 'Movimiento al pasar el mouse y al aparecer.',
    icon: <AnimationIcon fontSize="small" />,
    help: 'Transiciones y movimiento. Con moderación: en el celular demasiada animación se nota.',
  },
  {
    id: 'advanced',
    label: 'Avanzado',
    description: 'CSS y JavaScript propios.',
    icon: <SettingsIcon fontSize="small" />,
    help: 'Para ajustes puntuales que no cubren los controles visuales. Un error acá puede romper la tienda.',
  },
]

const VIEWPORTS = [
  { id: 'desktop', label: 'Computadora', width: '100%' },
  { id: 'tablet', label: 'Tablet', width: '820px' },
  { id: 'mobile', label: 'Celular', width: '390px' },
]

const CONFIRMATIONS = {
  discard: {
    title: '¿Descartar los cambios?',
    body: 'Se pierde todo lo que cambiaste desde la última vez que se guardó.',
    action: 'Descartar cambios',
  },
  reset: {
    title: '¿Volver al diseño original?',
    body: 'Se borran todos los colores, fuentes, imágenes y ajustes que hiciste, y la tienda vuelve al diseño de fábrica. No se puede deshacer.',
    action: 'Volver al diseño original',
  },
  leave: {
    title: '¿Salir sin guardar?',
    body: 'Hay cambios que todavía no se guardaron. Si salís ahora, se pierden.',
    action: 'Salir sin guardar',
  },
}

const findSection = id => SECTION_LIBRARY.find(section => section.id === id) || SECTION_LIBRARY[0]

const messageOf = value => {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.message || ''
}

const formatTime = iso =>
  new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

// El estado del guardado, en una frase. Orden: lo que necesita atención primero.
export const saveStatus = ({ isSaving, autoSaveError, hasChanges, autoSaveEnabled, lastSaved }) => {
  if (isSaving) return { label: 'Guardando…', color: BRAND.blue }
  if (autoSaveError) return { label: 'No se pudo guardar solo', color: BRAND.red }
  if (hasChanges) {
    return autoSaveEnabled
      ? { label: 'Guardando en un momento…', color: BRAND.blue }
      : { label: 'Cambios sin guardar', color: BRAND.amber }
  }
  if (lastSaved) return { label: `Guardado a las ${formatTime(lastSaved)}`, color: BRAND.green }
  return { label: 'Todo guardado', color: BRAND.green }
}

const ThemeCustomizer = () => {
  const navigate = useNavigate()
  const isMobile = useMediaQuery('(max-width:899.95px)')

  // null = la lista de secciones; si no, el id de la sección abierta.
  const [openSectionId, setOpenSectionId] = useState(null)
  const [viewport, setViewport] = useState('desktop')
  const [widePreview, setWidePreview] = useState(false)
  const [mobileView, setMobileView] = useState('edit')
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const {
    autoSaveEnabled,
    autoSaveError,
    discard,
    error,
    hasChanges,
    isLoading,
    isSaving,
    lastSaved,
    refresh,
    reset,
    save,
    setSection,
    theme,
    toggleAutoSave,
    updateField,
    updateSection,
    uploadImage,
  } = useTheme()

  const openSection = openSectionId ? findSection(openSectionId) : null

  useEffect(() => {
    if (openSectionId) setSection?.(openSectionId)
  }, [openSectionId, setSection])

  // Cerrar la pestaña con cambios sin guardar avisa, como cualquier editor.
  useEffect(() => {
    if (!hasChanges) return undefined
    const warn = event => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasChanges])

  // Un error del guardado automático se avisa una vez, no en cada render.
  useEffect(() => {
    const message = messageOf(autoSaveError)
    if (message) setNotice({ severity: 'error', message: `No se pudo guardar solo: ${message}` })
  }, [autoSaveError])

  const handleSave = useCallback(async () => {
    const result = await save()
    if (result?.meta?.requestStatus === 'fulfilled') {
      setNotice({ severity: 'success', message: 'Diseño guardado.' })
    } else {
      setNotice({
        severity: 'error',
        message: `No se pudo guardar: ${messageOf(result?.payload) || messageOf(error) || 'probá de nuevo.'}`,
      })
    }
  }, [error, save])

  const confirm = useCallback(async () => {
    const kind = confirming
    if (kind === 'discard') {
      discard()
      setConfirming(null)
      return
    }
    if (kind === 'leave') {
      discard()
      setConfirming(null)
      navigate('/admin')
      return
    }
    // reset: el diálogo queda abierto hasta que contesta el servidor.
    setBusy(true)
    const result = await reset()
    setBusy(false)
    setConfirming(null)
    setNotice(
      result?.meta?.requestStatus === 'fulfilled'
        ? { severity: 'success', message: 'La tienda volvió al diseño original.' }
        : {
            severity: 'error',
            message: `No se pudo volver al diseño original: ${messageOf(result?.payload) || 'probá de nuevo.'}`,
          },
    )
  }, [confirming, discard, navigate, reset])

  const leave = useCallback(() => {
    if (hasChanges) setConfirming('leave')
    else navigate('/admin')
  }, [hasChanges, navigate])

  const sectionData = useMemo(() => {
    if (!theme || !openSectionId) return {}
    if (openSectionId === 'header-footer') {
      return { header: theme.header || {}, footer: theme.footer || {} }
    }
    return theme[openSectionId] || {}
  }, [openSectionId, theme])

  const renderEditor = () => {
    const common = { theme, themeData: theme, sectionMeta: openSection }

    switch (openSectionId) {
      case 'colors':
        return (
          <ColorsPanel
            {...common}
            colors={sectionData}
            updateField={updateField}
            onChange={colors => updateSection('colors', colors)}
          />
        )
      case 'typography':
        return (
          <TypographyEditor
            {...common}
            value={sectionData}
            updateField={updateField}
            onChange={value => updateSection('typography', value)}
          />
        )
      case 'spacing':
        return (
          <SpacingEditor
            {...common}
            value={sectionData}
            onChange={value => updateSection('spacing', value)}
          />
        )
      case 'buttons':
        return (
          <CustomButton
            {...common}
            value={sectionData}
            onChange={value => updateSection('buttons', value)}
          />
        )
      case 'layout':
        return (
          <LayoutEditor
            {...common}
            value={sectionData}
            onChange={value => updateSection('layout', value)}
          />
        )
      case 'hero':
        return (
          <HeroEditor
            {...common}
            value={sectionData}
            onChange={value => updateSection('hero', value)}
            onImageUpload={file =>
              uploadImage({ file, type: 'hero', fieldPath: 'hero.backgroundImage' })
            }
          />
        )
      case 'header-footer':
        return (
          <Stack spacing={2}>
            <HeaderEditor
              {...common}
              value={sectionData.header}
              colors={theme.colors || {}}
              onColorChange={(key, color) => updateField(`colors.${key}`, color)}
              onChange={value => updateSection('header', value)}
              onLogoUpload={file => uploadImage({ file, type: 'logo', fieldPath: 'header.logo' })}
            />
            <Divider />
            <FooterEditor
              {...common}
              value={sectionData.footer}
              onChange={value => updateSection('footer', value)}
              onLogoUpload={file => uploadImage({ file, type: 'logo', fieldPath: 'footer.logo' })}
            />
          </Stack>
        )
      case 'products':
        return (
          <ProductsEditor
            {...common}
            value={sectionData}
            onChange={value => updateSection('products', value)}
          />
        )
      case 'animations':
        return (
          <AnimationsEditor
            {...common}
            value={sectionData}
            onChange={value => updateSection('animations', value)}
          />
        )
      case 'advanced':
        return (
          <AdvancedEditor
            {...common}
            value={sectionData}
            customCSS={theme.advanced?.customCSS || ''}
            customJS={theme.advanced?.customJS || ''}
            onChange={value => updateSection('advanced', value)}
            onCSSChange={value => updateField('advanced.customCSS', value)}
            onJSChange={value => updateField('advanced.customJS', value)}
          />
        )
      default:
        return null
    }
  }

  if (!theme) {
    const loadError = messageOf(error)
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2,
          bgcolor: BRAND.paper,
          p: 3,
          textAlign: 'center',
        }}
      >
        {loadError && !isLoading ? (
          <Alert
            severity="error"
            sx={{ maxWidth: 520, textAlign: 'left' }}
            action={<Button onClick={refresh}>Reintentar</Button>}
          >
            No se pudo cargar el diseño de la tienda: {loadError}
          </Alert>
        ) : (
          <>
            <CircularProgress size={48} />
            <Typography sx={{ color: BRAND.muted }}>Cargando el diseño de la tienda…</Typography>
          </>
        )}
      </Box>
    )
  }

  const status = saveStatus({ isSaving, autoSaveError, hasChanges, autoSaveEnabled, lastSaved })
  const showPanel = isMobile ? mobileView === 'edit' : !widePreview
  const showPreview = isMobile ? mobileView === 'preview' : true
  const previewWidth = VIEWPORTS.find(item => item.id === viewport)?.width || '100%'

  const sectionList = (
    <Stack spacing={2.5} sx={{ p: 2.5 }}>
      <Box>
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          IDENTIDAD
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField
            size="small"
            fullWidth
            label="Nombre de la tienda"
            value={theme.general?.storeName ?? ''}
            placeholder="Mi Tienda"
            onChange={event => updateField('general.storeName', event.target.value)}
          />
          <TextField
            size="small"
            fullWidth
            label="Slogan"
            value={theme.general?.tagline ?? ''}
            placeholder="Opcional"
            onChange={event => updateField('general.tagline', event.target.value)}
          />
        </Stack>
      </Box>

      <Box component="nav" aria-label="Secciones del diseño">
        <Typography
          variant="overline"
          sx={{ color: BRAND.blue, fontWeight: 700, letterSpacing: '0.16em' }}
        >
          SECCIONES
        </Typography>
        <Stack sx={{ mt: 0.5, border: `1px solid ${BRAND.line}`, borderRadius: 3 }}>
          {SECTION_LIBRARY.map((section, index) => (
            <ButtonBase
              key={section.id}
              onClick={() => setOpenSectionId(section.id)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.5,
                textAlign: 'left',
                borderTop: index ? `1px solid ${BRAND.line}` : 'none',
                '&:hover': { bgcolor: BRAND.paper },
                '&:first-of-type': { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
                '&:last-of-type': { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
              }}
            >
              <Box sx={{ color: BRAND.blue, display: 'flex' }}>{section.icon}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, color: BRAND.ink }}>{section.label}</Typography>
                <Typography variant="caption" sx={{ color: BRAND.muted }}>
                  {section.description}
                </Typography>
              </Box>
              <ChevronRightIcon fontSize="small" sx={{ color: BRAND.muted }} />
            </ButtonBase>
          ))}
        </Stack>
      </Box>
    </Stack>
  )

  const sectionEditor = openSection && (
    <>
      <Box sx={{ p: 2, borderBottom: `1px solid ${BRAND.line}` }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon fontSize="small" />}
          onClick={() => setOpenSectionId(null)}
          sx={{ textTransform: 'none', fontWeight: 700, color: BRAND.muted, ml: -0.5, mb: 1 }}
        >
          Todas las secciones
        </Button>
        <Typography
          component="h2"
          sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: 19, color: BRAND.ink }}
        >
          {openSection.label}
        </Typography>
        <Typography variant="body2" sx={{ color: BRAND.muted, mt: 0.5 }}>
          {openSection.help}
        </Typography>
      </Box>
      <Box sx={{ p: 2, overflow: 'auto', flex: 1, minHeight: 0 }}>{renderEditor()}</Box>
    </>
  )

  return (
    <ThemeProvider theme={adminBaseTheme}>
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: BRAND.paper,
        }}
      >
        <Box
          component="header"
          sx={{
            minHeight: APP_BAR_HEIGHT,
            px: { xs: 1, md: 2 },
            py: 1,
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 0.5, md: 1.5 },
            bgcolor: '#fff',
            borderBottom: `1px solid ${BRAND.line}`,
            flexShrink: 0,
          }}
        >
          <Tooltip title="Volver al panel">
            <IconButton aria-label="Volver al panel" onClick={leave}>
              <ArrowBackIcon />
            </IconButton>
          </Tooltip>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              component="h1"
              noWrap
              sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800, fontSize: { xs: 17, md: 20 } }}
            >
              Diseño de la tienda
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }} role="status">
              <Box
                component="span"
                sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: status.color }}
              />
              <Typography variant="caption" noWrap sx={{ color: BRAND.muted, fontWeight: 600 }}>
                {status.label}
              </Typography>
            </Stack>
          </Box>

          {!isMobile && (
            <FormControlLabel
              control={<Switch size="small" checked={autoSaveEnabled} onChange={toggleAutoSave} />}
              label={<Typography variant="body2">Guardar solo</Typography>}
              sx={{ m: 0 }}
            />
          )}

          {!isMobile && (
            <Button
              variant="outlined"
              size="small"
              startIcon={widePreview ? <CloseFullscreenIcon /> : <OpenInFullIcon />}
              onClick={() => setWidePreview(value => !value)}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}
            >
              {widePreview ? 'Volver al editor' : 'Vista amplia'}
            </Button>
          )}

          {hasChanges && !isMobile && (
            <Button
              size="small"
              onClick={() => setConfirming('discard')}
              disabled={isSaving}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              Descartar
            </Button>
          )}

          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, flexShrink: 0 }}
          >
            {isSaving ? 'Guardando…' : hasChanges ? 'Guardar' : 'Guardado'}
          </Button>

          <IconButton
            aria-label="Más acciones"
            onClick={event => setMenuAnchor(event.currentTarget)}
          >
            <MoreVertIcon />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
          >
            {isMobile && (
              <MenuItem
                onClick={() => {
                  toggleAutoSave()
                  setMenuAnchor(null)
                }}
              >
                {autoSaveEnabled ? 'Dejar de guardar solo' : 'Guardar solo'}
              </MenuItem>
            )}
            {isMobile && hasChanges && (
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null)
                  setConfirming('discard')
                }}
              >
                Descartar cambios
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                setMenuAnchor(null)
                setConfirming('reset')
              }}
              sx={{ color: BRAND.red }}
            >
              Volver al diseño original
            </MenuItem>
          </Menu>
        </Box>

        {isMobile && (
          <Stack
            direction="row"
            role="tablist"
            aria-label="Editar o ver la tienda"
            sx={{ bgcolor: '#fff', borderBottom: `1px solid ${BRAND.line}`, flexShrink: 0 }}
          >
            {[
              ['edit', 'Editar'],
              ['preview', 'Ver tienda'],
            ].map(([id, label]) => (
              <ButtonBase
                key={id}
                role="tab"
                aria-selected={mobileView === id}
                onClick={() => setMobileView(id)}
                sx={{
                  flex: 1,
                  py: 1.25,
                  fontWeight: 700,
                  color: mobileView === id ? BRAND.blue : BRAND.muted,
                  borderBottom: `3px solid ${mobileView === id ? BRAND.blue : 'transparent'}`,
                }}
              >
                {label}
              </ButtonBase>
            ))}
          </Stack>
        )}

        <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {showPanel && (
            <Box
              component="aside"
              aria-label="Editor"
              sx={{
                width: isMobile ? '100%' : PANEL_WIDTH,
                flexShrink: 0,
                bgcolor: '#fff',
                borderRight: isMobile ? 'none' : `1px solid ${BRAND.line}`,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                overflow: openSection ? 'hidden' : 'auto',
              }}
            >
              {openSection ? sectionEditor : sectionList}
            </Box>
          )}

          {showPreview && (
            <Box
              component="main"
              aria-label="Vista previa"
              sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  px: 2,
                  py: 1,
                  alignItems: 'center',
                  borderBottom: `1px solid ${BRAND.line}`,
                  bgcolor: '#fff',
                  overflowX: 'auto',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, color: BRAND.ink, mr: 'auto', whiteSpace: 'nowrap' }}
                >
                  Vista previa
                </Typography>
                {VIEWPORTS.map(item => (
                  <Button
                    key={item.id}
                    size="small"
                    aria-pressed={viewport === item.id}
                    variant={viewport === item.id ? 'contained' : 'text'}
                    onClick={() => setViewport(item.id)}
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, flexShrink: 0 }}
                  >
                    {item.label}
                  </Button>
                ))}
              </Stack>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  display: 'flex',
                  justifyContent: 'center',
                  p: viewport === 'desktop' ? 0 : 2,
                }}
              >
                <Box
                  sx={{
                    width: previewWidth,
                    maxWidth: '100%',
                    minWidth: 0,
                    height: '100%',
                    transition: 'width 180ms ease',
                  }}
                >
                  <LivePreview themeData={theme} viewport={viewport} isPreview={false} />
                </Box>
              </Box>
            </Box>
          )}
        </Box>

        <Dialog
          open={Boolean(confirming)}
          onClose={() => !busy && setConfirming(null)}
          maxWidth="xs"
          fullWidth
        >
          {confirming && (
            <>
              <DialogTitle sx={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
                {CONFIRMATIONS[confirming].title}
              </DialogTitle>
              <DialogContent>
                <DialogContentText>{CONFIRMATIONS[confirming].body}</DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirming(null)} disabled={busy}>
                  Cancelar
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  onClick={confirm}
                  disabled={busy}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
                >
                  {CONFIRMATIONS[confirming].action}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>

        <Snackbar
          open={Boolean(notice)}
          autoHideDuration={notice?.severity === 'error' ? 6000 : 3500}
          onClose={() => setNotice(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          {notice ? (
            <Alert severity={notice.severity} variant="filled" onClose={() => setNotice(null)}>
              {notice.message}
            </Alert>
          ) : (
            <span />
          )}
        </Snackbar>
      </Box>
    </ThemeProvider>
  )
}

export default React.memo(ThemeCustomizer)
