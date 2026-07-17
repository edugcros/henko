// src/pages/ThemeCustomizer.jsx - Store Design admin
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  ThemeProvider,
  alpha,
  useTheme as useMuiTheme,
} from '@mui/material/styles'
import {
  Animation as AnimationIcon,
  ArrowBack as ArrowBackIcon,
  ChevronRight as ChevronRightIcon,
  CloudUpload as CloudUploadIcon,
  Image as ImageIcon,
  Menu as MenuIcon,
  OpenInFull as FocusPreviewIcon,
  Palette as PaletteIcon,
  Preview as PreviewIcon,
  Refresh as ResetIcon,
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

const APP_BAR_HEIGHT = 72
const DRAWER_WIDTH = 440

const SECTION_LIBRARY = [
  {
    id: 'colors',
    label: 'Colores',
    description: 'Paleta semántica del storefront.',
    appliesTo: 'Fondo, textos, header, cards, botones, precios y estados.',
    icon: <PaletteIcon fontSize="small" />,
    help: 'Cada color tiene un rol concreto. La edición está separada por marca, layout, header, cards, acciones y señales comerciales.',
  },
  {
    id: 'typography',
    label: 'Tipografía',
    description: 'Fuentes, lectura y jerarquía visual.',
    appliesTo: 'Títulos, párrafos, texto auxiliar, links y botones.',
    icon: <TextFieldsIcon fontSize="small" />,
    help: 'Define cómo se lee la tienda: familias tipográficas, escala base, títulos H1-H6 y texto secundario.',
  },
  {
    id: 'spacing',
    label: 'Espaciado',
    description: 'Densidad, aire y radios.',
    appliesTo: 'Separación entre secciones, contenedores, cards y bordes.',
    icon: <TuneIcon fontSize="small" />,
    help: 'Controla la respiración visual del sitio y evita layouts apretados o demasiado dispersos.',
  },
  {
    id: 'buttons',
    label: 'Botones',
    description: 'Jerarquía y apariencia de acciones.',
    appliesTo:
      'CTA primarios, secundarios, estados hover y botones reutilizables.',
    icon: <SmartButtonIcon fontSize="small" />,
    help: 'Afecta los botones de compra, navegación, formularios y llamadas a la acción.',
  },
  {
    id: 'layout',
    label: 'Layout',
    description: 'Estructura general de página.',
    appliesTo: 'Anchos máximos, padding de contenedor, radios y sombras.',
    icon: <ViewCompactIcon fontSize="small" />,
    help: 'Define el marco donde se renderiza la tienda y la sensación general del layout.',
  },
  {
    id: 'hero',
    label: 'Hero',
    description: 'Bloque principal de la Home.',
    appliesTo: 'Banner superior, imagen, alineación, textos destacados y CTA.',
    icon: <ImageIcon fontSize="small" />,
    help: 'Edita el primer impacto visual de la tienda y su bloque de comunicación principal.',
  },
  {
    id: 'header-footer',
    label: 'Header / Footer',
    description: 'Navegación, identidad y cierre.',
    appliesTo: 'Header, logo, navegación, iconos, newsletter, footer y redes.',
    icon: <WebIcon fontSize="small" />,
    help: 'Agrupa los elementos persistentes que acompañan al usuario durante toda la tienda.',
  },
  {
    id: 'products',
    label: 'Productos',
    description: 'Listado y cards comerciales.',
    appliesTo: 'Grilla, cards, imagen, badges, precio, rating y acciones.',
    icon: <ShoppingBagIcon fontSize="small" />,
    help: 'Controla cómo se presentan los productos en catálogo y bloques destacados.',
  },
  {
    id: 'animations',
    label: 'Animaciones',
    description: 'Movimiento y microinteracciones.',
    appliesTo: 'Hover, transiciones, apariciones y sensación de respuesta.',
    icon: <AnimationIcon fontSize="small" />,
    help: 'Ajusta movimiento sin comprometer performance o legibilidad en mobile.',
  },
  {
    id: 'advanced',
    label: 'Avanzado',
    description: 'CSS y JS custom.',
    appliesTo: 'Reglas globales y ajustes específicos del tema.',
    icon: <SettingsIcon fontSize="small" />,
    help: 'Reservado para ajustes puntuales que no estén cubiertos por los controles visuales.',
  },
]

const VIEWPORT_CONFIG = {
  desktop: { label: 'Desktop', width: '100%', maxWidth: '100%' },
  tablet: { label: 'Tablet', width: '820px', maxWidth: '100%' },
  mobile: { label: 'Mobile', width: '390px', maxWidth: '100%' },
}

const findActiveSection = id =>
  SECTION_LIBRARY.find(section => section.id === id) || SECTION_LIBRARY[0]

const ThemeCustomizer = () => {
  const muiTheme = useMuiTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('md'))

  const [activeSectionId, setActiveSectionId] = useState('colors')
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(false)
  const [previewViewport, setPreviewViewport] = useState('desktop')
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [focusPreview, setFocusPreview] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(true)

  const {
    activeTheme,
    autoSaveEnabled,
    autoSaveError,
    clearError,
    clearPreview,
    discard,
    error,
    hasChanges,
    isLoading,
    isSaving,
    lastSaved,
    previewMode,
    reset,
    save,
    setSection,
    theme,
    toggleAutoSave,
    togglePreview,
    updateField,
    updateSection,
    uploadImage,
  } = useTheme()

  const activeSection = useMemo(
    () => findActiveSection(activeSectionId),
    [activeSectionId],
  )

  const sectionData = useMemo(() => {
    if (!theme) return {}
    if (activeSectionId === 'header-footer') {
      return {
        header: theme.header || {},
        footer: theme.footer || {},
      }
    }
    return theme[activeSectionId] || {}
  }, [activeSectionId, theme])

  useEffect(() => {
    if (error || autoSaveError) setShowError(true)
  }, [error, autoSaveError])

  useEffect(() => {
    if (!isMobile) setMobileDrawerOpen(false)
  }, [isMobile])

  useEffect(() => {
    setSection?.(activeSectionId)
  }, [activeSectionId, setSection])

  const handleSectionSelect = useCallback(sectionId => {
    setActiveSectionId(sectionId)
    setFocusPreview(false)
    setSettingsOpen(true)
  }, [])

  const handleSave = useCallback(async () => {
    const result = await save()
    if (result?.meta?.requestStatus === 'fulfilled') {
      setShowSuccess(true)
      clearPreview()
    } else {
      setShowError(true)
    }
  }, [clearPreview, save])

  const handleReset = useCallback(async () => {
    const shouldReset = window.confirm(
      '¿Resetear todo el tema a valores por defecto? Esta acción no se puede deshacer.',
    )
    if (!shouldReset) return

    const result = await reset()
    if (result?.meta?.requestStatus === 'fulfilled') {
      setShowSuccess(true)
      clearError()
    } else {
      setShowError(true)
    }
  }, [clearError, reset])

  const handleDiscard = useCallback(() => {
    if (!hasChanges) return
    if (window.confirm('¿Descartar cambios no guardados?')) discard()
  }, [discard, hasChanges])

  const resolvedErrorMessage =
    error?.message ||
    autoSaveError?.message ||
    error ||
    autoSaveError ||
    'Error al procesar la solicitud'

  const storeName = theme?.general?.storeName || 'Mi Tienda'
  console.log(theme?.general?.tagline)
  const tagline = theme?.general?.tagline || ''
  const faviconUrl = theme?.general?.favicon?.url

  const lastSavedText = lastSaved
    ? new Date(lastSaved).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  const previewWidth =
    previewViewport === 'desktop'
      ? VIEWPORT_CONFIG.desktop.width
      : VIEWPORT_CONFIG[previewViewport].width

  const renderPanel = useCallback(() => {
    if (!theme) return null

    const common = {
      theme,
      themeData: theme,
      sectionMeta: activeSection,
    }

    switch (activeSectionId) {
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
              uploadImage({
                file,
                type: 'hero',
                fieldPath: 'hero.backgroundImage',
              })
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
              onColorChange={(key, color) =>
                updateField(`colors.${key}`, color)
              }
              onChange={value => updateSection('header', value)}
              onLogoUpload={file =>
                uploadImage({
                  file,
                  type: 'logo',
                  fieldPath: 'header.logo',
                })
              }
            />
            <Divider />
            <FooterEditor
              {...common}
              value={sectionData.footer}
              onChange={value => updateSection('footer', value)}
              onLogoUpload={file =>
                uploadImage({
                  file,
                  type: 'logo',
                  fieldPath: 'footer.logo',
                })
              }
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
  }, [
    activeSection,
    activeSectionId,
    sectionData,
    theme,
    updateField,
    updateSection,
    uploadImage,
  ])

  if (isLoading || !theme) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2,
          bgcolor: 'background.default',
          p: 3,
          textAlign: 'center',
        }}
      >
        <CircularProgress size={56} thickness={4} />
        <Typography variant="h6" color="text.secondary">
          Cargando configuración del tema...
        </Typography>
      </Box>
    )
  }

  const showDrawer = !previewMode && !focusPreview

  return (
    <ThemeProvider theme={adminBaseTheme}>
      <Box
        sx={{
          height: '100vh',
          overflow: 'hidden',
          bgcolor: 'background.default',
        }}
      >
        <AppBar
          position="fixed"
          sx={{
            zIndex: appTheme => appTheme.zIndex.drawer + 2,
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 1,
          }}
        >
          <Toolbar sx={{ minHeight: APP_BAR_HEIGHT, gap: 1, flexWrap: 'wrap' }}>
            {isMobile && showDrawer && (
              <IconButton
                size="small"
                edge="start"
                color="inherit"
                aria-label="Abrir secciones"
                onClick={() => setMobileDrawerOpen(true)}
              >
                <MenuIcon />
              </IconButton>
            )}

            <Box sx={{ flex: 1, minWidth: { xs: '100%', sm: 260 } }}>
              <Typography
                variant="h6"
                sx={{ fontWeight: 800, lineHeight: 1.15 }}
              >
                Diseñador de tienda
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {activeSection.label}: {activeSection.appliesTo}
              </Typography>
            </Box>

            {hasChanges && (
              <Badge color="warning" variant="dot">
                <Chip
                  size="small"
                  label="Sin guardar"
                  color="warning"
                  variant="outlined"
                />
              </Badge>
            )}

            <Tooltip
              title={
                autoSaveEnabled
                  ? 'Auto-guardado activado'
                  : 'Auto-guardado desactivado'
              }
            >
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={autoSaveEnabled}
                    onChange={toggleAutoSave}
                  />
                }
                label={
                  <Typography variant="caption">
                    Auto {lastSavedText ? lastSavedText : ''}
                  </Typography>
                }
                sx={{ m: 0 }}
              />
            </Tooltip>

            {!previewMode && !isMobile && (
              <Tooltip
                title={
                  focusPreview ? 'Volver al editor' : 'Ampliar vista previa'
                }
              >
                <Button
                  size="small"
                  variant={focusPreview ? 'contained' : 'outlined'}
                  startIcon={<FocusPreviewIcon />}
                  onClick={() => setFocusPreview(value => !value)}
                >
                  {focusPreview ? 'Editar' : 'Preview grande'}
                </Button>
              </Tooltip>
            )}

            <Tooltip
              title={
                previewMode ? 'Salir de vista previa' : 'Entrar en vista previa'
              }
            >
              <Button
                variant={previewMode ? 'contained' : 'outlined'}
                color="info"
                size="small"
                onClick={togglePreview}
                startIcon={<PreviewIcon />}
              >
                {previewMode ? 'Salir preview' : 'Preview'}
              </Button>
            </Tooltip>

            <Tooltip title="Resetear tema">
              <IconButton
                size="small"
                color="error"
                aria-label="Resetear tema"
                disabled={isSaving}
                onClick={handleReset}
              >
                <ResetIcon />
              </IconButton>
            </Tooltip>

            {hasChanges && (
              <Button
                size="small"
                variant="outlined"
                onClick={handleDiscard}
                disabled={isSaving}
              >
                Descartar
              </Button>
            )}

            <Button
              size="small"
              variant="contained"
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              color={hasChanges ? 'primary' : 'success'}
              startIcon={
                isSaving ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <SaveIcon />
                )
              }
            >
              {isSaving
                ? 'Guardando...'
                : hasChanges
                  ? 'Guardar'
                  : 'Actualizado'}
            </Button>
          </Toolbar>
        </AppBar>

        <Box
          sx={{ display: 'flex', height: '100%', pt: `${APP_BAR_HEIGHT}px` }}
        >
          {showDrawer && (
            <Drawer
              variant={isMobile ? 'temporary' : 'permanent'}
              open={isMobile ? mobileDrawerOpen : true}
              onClose={() => setMobileDrawerOpen(false)}
              ModalProps={{ keepMounted: true }}
              PaperProps={{
                sx: {
                  width: DRAWER_WIDTH,
                  top: `${APP_BAR_HEIGHT}px`,
                  height: `calc(100% - ${APP_BAR_HEIGHT}px)`,
                  boxSizing: 'border-box',
                  borderRight: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                },
              }}
              sx={{
                width: isMobile ? 0 : DRAWER_WIDTH,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  minHeight: 0,
                }}
              >
                {settingsOpen ? (
                  <>
                    <Box
                      sx={{
                        p: 1.5,
                        borderBottom: 1,
                        borderColor: 'divider',
                        display: 'flex',
                        gap: 1,
                        alignItems: 'flex-start',
                      }}
                    >
                      <Tooltip title="Volver a secciones">
                        <IconButton
                          size="small"
                          aria-label="Volver a secciones"
                          onClick={() => setSettingsOpen(false)}
                        >
                          <ArrowBackIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="subtitle1"
                          fontWeight={850}
                          sx={{ lineHeight: 1.2 }}
                        >
                          {activeSection.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ mt: 0.5, display: 'block' }}
                        >
                          {activeSection.help}
                        </Typography>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={activeSection.appliesTo}
                          sx={{ mt: 1, maxWidth: '100%' }}
                        />
                      </Box>
                    </Box>

                    <Box
                      sx={{
                        p: 1.5,
                        overflow: 'auto',
                        minHeight: 0,
                        flex: 1,
                      }}
                    >
                      {renderPanel()}
                    </Box>
                  </>
                ) : (
                  <Box
                    sx={{
                      p: 2,
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                      minHeight: 0,
                      gap: 2,
                    }}
                  >
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                      <Typography
                        variant="subtitle2"
                        fontWeight={800}
                        gutterBottom
                      >
                        Identidad general
                      </Typography>
                      <TextField
                        size="small"
                        fullWidth
                        label="Nombre de la tienda"
                        value={storeName}
                        onChange={event =>
                          updateField('general.storeName', event.target.value)
                        }
                        sx={{ mt: 1.5 }}
                      />
                      <TextField
                        size="small"
                        fullWidth
                        label="Slogan"
                        value={tagline}
                        onChange={event =>
                          updateField('general.tagline', event.target.value)
                        }
                        sx={{ mt: 1.5 }}
                      />
                      {faviconUrl && (
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          sx={{ mt: 1.5 }}
                        >
                          <CloudUploadIcon color="action" fontSize="small" />
                          <Typography variant="caption" color="text.secondary">
                            Favicon cargado
                          </Typography>
                        </Stack>
                      )}
                    </Paper>

                    <List
                      disablePadding
                      subheader={
                        <ListSubheader sx={{ px: 0 }}>
                          Secciones de diseño
                        </ListSubheader>
                      }
                      sx={{ overflow: 'auto', pb: 1 }}
                    >
                      {SECTION_LIBRARY.map(section => {
                        const selected = activeSectionId === section.id
                        return (
                          <ListItem
                            key={section.id}
                            disablePadding
                            sx={{ mb: 0.5 }}
                          >
                            <ListItemButton
                              selected={selected}
                              onClick={() => handleSectionSelect(section.id)}
                              sx={{
                                borderRadius: 1.5,
                                alignItems: 'flex-start',
                                border: '1px solid',
                                borderColor: selected
                                  ? alpha(muiTheme.palette.primary.main, 0.35)
                                  : 'transparent',
                              }}
                            >
                              <ListItemIcon sx={{ minWidth: 34, mt: 0.25 }}>
                                {section.icon}
                              </ListItemIcon>
                              <ListItemText
                                primary={section.label}
                                secondary={section.description}
                                primaryTypographyProps={{
                                  fontWeight: selected ? 800 : 600,
                                }}
                                secondaryTypographyProps={{
                                  variant: 'caption',
                                }}
                              />
                              <ChevronRightIcon
                                fontSize="small"
                                color="action"
                                sx={{ mt: 0.5 }}
                              />
                            </ListItemButton>
                          </ListItem>
                        )
                      })}
                    </List>
                  </Box>
                )}
              </Box>
            </Drawer>
          )}

          <Box
            component="main"
            sx={{
              flex: 1,
              minWidth: 0,
              height: '100%',
              overflow: 'hidden',
              position: 'relative',
              p: { xs: 1, md: 1.5 },
            }}
          >
            {previewMode && (
              <Paper
                elevation={0}
                sx={{
                  mb: 1,
                  p: 1,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  alignItems: 'center',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                }}
              >
                <Typography variant="caption" fontWeight={800}>
                  Vista previa
                </Typography>
                {Object.keys(VIEWPORT_CONFIG).map(viewport => (
                  <Button
                    key={viewport}
                    size="small"
                    variant={
                      previewViewport === viewport ? 'contained' : 'outlined'
                    }
                    onClick={() => setPreviewViewport(viewport)}
                  >
                    {VIEWPORT_CONFIG[viewport].label}
                  </Button>
                ))}
              </Paper>
            )}

            <Box
              sx={{
                height: previewMode ? `calc(100% - 58px)` : '100%',
                minHeight: 0,
              }}
            >
              <Paper
                variant="outlined"
                sx={{
                  height: '100%',
                  minHeight: 0,
                  overflow: 'hidden',
                  borderRadius: 1.5,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {!previewMode && (
                  <Box
                    sx={{
                      px: 1.5,
                      py: 1,
                      borderBottom: 1,
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Typography variant="subtitle2" fontWeight={850}>
                      Vista previa de la tienda
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {Object.keys(VIEWPORT_CONFIG).map(viewport => (
                      <Button
                        key={viewport}
                        size="small"
                        variant={
                          previewViewport === viewport
                            ? 'contained'
                            : 'outlined'
                        }
                        onClick={() => setPreviewViewport(viewport)}
                      >
                        {VIEWPORT_CONFIG[viewport].label}
                      </Button>
                    ))}
                  </Box>
                )}

                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    display: 'flex',
                    justifyContent: 'center',
                    bgcolor: 'action.hover',
                    p: previewViewport === 'desktop' ? 0 : 1.5,
                  }}
                >
                  <Box
                    sx={{
                      width: previewWidth,
                      maxWidth: VIEWPORT_CONFIG[previewViewport].maxWidth,
                      minWidth: 0,
                      height: '100%',
                      transition: 'width 180ms ease',
                    }}
                  >
                    <LivePreview
                      themeData={activeTheme || theme}
                      viewport={previewViewport}
                      isPreview={previewMode}
                    />
                  </Box>
                </Box>
              </Paper>
            </Box>
          </Box>
        </Box>

        <Snackbar
          open={showSuccess}
          autoHideDuration={3500}
          onClose={() => setShowSuccess(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          <Alert
            severity="success"
            onClose={() => setShowSuccess(false)}
            variant="filled"
          >
            Tema guardado correctamente.
          </Alert>
        </Snackbar>

        <Snackbar
          open={showError}
          autoHideDuration={6000}
          onClose={() => setShowError(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          <Alert
            severity="error"
            onClose={() => setShowError(false)}
            variant="filled"
          >
            {resolvedErrorMessage}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  )
}

export default React.memo(ThemeCustomizer)
