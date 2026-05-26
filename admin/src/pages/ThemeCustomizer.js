// src/pages/ThemeCustomizer.jsx - VERSIÓN PRODUCCIÓN REFACTORIZADA
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Tabs,
  Tab,
  Paper,
  TextField,
  Chip,
  Alert,
  Snackbar,
  Divider,
  IconButton,
  Tooltip,
  Switch,
  FormControlLabel,
  CircularProgress,
  Badge,
  Stack,
} from '@mui/material'

import {
  Save as SaveIcon,
  Refresh as ResetIcon,
  Palette as PaletteIcon,
  TextFields as TextFieldsIcon,
  SmartButton as SmartButtonIcon,
  ViewCompact as ViewCompactIcon,
  Settings as SettingsIcon,
  Image as ImageIcon,
  Animation as AnimationIcon,
  Tune as TuneIcon,
  ShoppingBag as ShoppingBagIcon,
  Web as WebIcon,
  Preview as PreviewIcon,
  History as HistoryIcon,
  CloudUpload as CloudUploadIcon,
} from '@mui/icons-material'

import { ThemeProvider } from '@mui/material/styles'
import adminBaseTheme from '../theme/muiTheme'
import {useTheme} from '@hooks/useThemeConfig'

// Panels
import ColorsPanel from '@components/ColorsPanel'
import TypographyEditor from '@components/TypographyEditor'
import SpacingEditor from '@components/SpacingEditor'
import CustomButton from '@components/CustomButton'
import LayoutEditor from '@components/LayoutEditor'
import HeroEditor from '@components/HeroPanel'
import HeaderEditor from '@components/HeaderEditor'
import FooterEditor from '@components/FooterEditor'
import ProductsEditor from '@components/ProductsEditor'
import AnimationsEditor from '@components/AnimationsEditor'
import AdvancedEditor from '@components/AdvancedEditor'
import LivePreview from '@components/LivePreview'
import VersionHistory from '@components/VersionHistory'

const DRAWER_WIDTH = 380

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================

const ThemeCustomizer = () => {
  const { tenantId } = useParams()

  // UI State local
  const [activeTab, setActiveTab] = useState(0)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [previewViewport, setPreviewViewport] = useState('desktop') // desktop | tablet | mobile

  // Hook de tema (Redux)
  const {
    // Data
    theme,
    activeTheme,
    hasChanges,
    
    // Status
    isLoading,
    isSaving,
    error,
    
    // Auto-save
    autoSaveEnabled,
    lastSaved,
    autoSaveError,
    toggleAutoSave,
    
    // Preview system
    previewMode,
    previewId,
    togglePreview,
    clearPreview,
    createPreview,
    
    // Actions
    updateField,
    updateSection,
    save,
    discard,
    reset,
    
    // Images
    uploadImage,
    
    // Versioning
    rollback,
    
  } = useTheme()

  // ==========================================
  // EFECTOS
  // ==========================================

  // Mostrar errores del hook
  useEffect(() => {
    if (error || autoSaveError) {
      setShowError(true)
    }
  }, [error, autoSaveError])

  // Crear preview al entrar en modo preview
  useEffect(() => {
    if (previewMode && !previewId && hasChanges) {
      createPreview()
    }
  }, [previewMode, previewId, hasChanges, createPreview])

  // ==========================================
  // CONFIGURACIÓN TABS
  // ==========================================

  const tabs = useMemo(() => [
    { icon: <PaletteIcon />, label: 'Colores', id: 'colors', hasPanel: true },
    { icon: <TextFieldsIcon />, label: 'Tipografía', id: 'typography', hasPanel: true },
    { icon: <TuneIcon />, label: 'Espaciado', id: 'spacing', hasPanel: true },
    { icon: <SmartButtonIcon />, label: 'Botones', id: 'buttons', hasPanel: true },
    { icon: <ViewCompactIcon />, label: 'Layout', id: 'layout', hasPanel: true },
    { icon: <ImageIcon />, label: 'Hero', id: 'hero', hasPanel: true },
    { icon: <WebIcon />, label: 'Header/Footer', id: 'header-footer', hasPanel: true },
    { icon: <ShoppingBagIcon />, label: 'Productos', id: 'products', hasPanel: true },
    { icon: <AnimationIcon />, label: 'Animaciones', id: 'animations', hasPanel: true },
    { icon: <SettingsIcon />, label: 'Avanzado', id: 'advanced', hasPanel: true },
  ], [])

  // ==========================================
  // HANDLERS
  // ==========================================

  const handleSave = useCallback(async () => {
    const result = await save()
    if (result.meta?.requestStatus === 'fulfilled') {
      setShowSuccess(true)
      clearPreview() // Limpiar preview si existía
    } else {
      setShowError(true)
    }
  }, [save, clearPreview])

  const handleReset = useCallback(async () => {
    if (window.confirm('¿Resetear todo el tema a valores por defecto? Se perderán todos los cambios.')) {
      const result = await reset()
      if (result.meta?.requestStatus === 'fulfilled') {
        setShowSuccess(true)
      }
    }
  }, [reset])

  const handleDiscard = useCallback(() => {
    if (hasChanges && window.confirm('¿Descartar cambios no guardados?')) {
      discard()
    }
  }, [hasChanges, discard])

  const handleTabChange = useCallback((_, newValue) => {
    setActiveTab(newValue)
  }, [])

  const handleTogglePreview = useCallback(() => {
    if (previewMode) {
      // Salir del preview
      togglePreview()
    } else {
      // Entrar al preview
      togglePreview()
    }
  }, [previewMode, togglePreview])

  const handlePublishPreview = useCallback(async () => {
    const result = await save()
    if (result.meta?.requestStatus === 'fulfilled') {
      setShowSuccess(true)
      clearPreview()
    }
  }, [save, clearPreview])

  // ==========================================
  // HELPERS DE DATOS
  // ==========================================

  const getSectionData = useCallback((tabId) => {
    if (!theme) return {}
    
    // Tab compuesto: Header + Footer
    if (tabId === 'header-footer') {
      return {
        header: theme.header || {},
        footer: theme.footer || {},
      }
    }
    
    return theme[tabId] || {}
  }, [theme])

  const currentTab = tabs[activeTab]
  const sectionData = useMemo(() => 
    getSectionData(currentTab?.id), 
    [currentTab?.id, getSectionData]
  )

  // ==========================================
  // RENDER DE PANELS
  // ==========================================

  const renderPanel = useCallback(() => {
    if (!theme || !currentTab) return null

    const { id } = currentTab

    // Props comunes para todos los panels
    const commonProps = {
      theme, // Tema completo para referencias cruzadas
    }

    switch (id) {
      case 'colors':
        return (
          <ColorsPanel
            {...commonProps}
            colors={sectionData}
            updateField={updateField}
            onChange={(colors) => updateSection('colors', colors)}
          />
        )

      case 'typography':
        return (
          <TypographyEditor
            {...commonProps}
            value={sectionData}
            updateField={updateField}
            onChange={(v) => updateSection('typography', v)}
          />
        )

      case 'spacing':
        return (
          <SpacingEditor
            {...commonProps}
            value={sectionData}
            onChange={(v) => updateSection('spacing', v)}
          />
        )

      case 'buttons':
        return (
          <CustomButton
            {...commonProps}
            value={sectionData}
            onChange={(v) => updateSection('buttons', v)}
          />
        )

      case 'layout':
        return (
          <LayoutEditor
            {...commonProps}
            value={sectionData}
            onChange={(v) => updateSection('layout', v)}
          />
        )

      case 'hero':
        return (
          <HeroEditor
            {...commonProps}
            value={sectionData}
            onChange={(v) => updateSection('hero', v)}
            onImageUpload={(file) => uploadImage({ 
              file, 
              type: 'hero', 
              fieldPath: 'hero.backgroundImage' 
            })}
          />
        )

      case 'header-footer':
        return (
          <Stack spacing={3}>
            <HeaderEditor
              {...commonProps}
              value={sectionData.header}
              onChange={(v) => updateSection('header', v)}
              onLogoUpload={(file) => uploadImage({ 
                file, 
                type: 'logo', 
                fieldPath: 'header.logo' 
              })}
            />
            <Divider />
            <FooterEditor
              {...commonProps}
              value={sectionData.footer}
              onChange={(v) => updateSection('footer', v)}
              onLogoUpload={(file) => uploadImage({ 
                file, 
                type: 'logo', 
                fieldPath: 'footer.logo' 
              })}
            />
          </Stack>
        )

      case 'products':
        return (
          <ProductsEditor
            {...commonProps}
            value={sectionData}
            onChange={(v) => updateSection('products', v)}
          />
        )

      case 'animations':
        return (
          <AnimationsEditor
            {...commonProps}
            value={sectionData}
            onChange={(v) => updateSection('animations', v)}
          />
        )

      case 'advanced':
        return (
          <AdvancedEditor
            {...commonProps}
            value={sectionData}
            customCSS={theme.advanced?.customCSS || ''}
            customJS={theme.advanced?.customJS || ''}
            onChange={(v) => updateSection('advanced', v)}
            onCSSChange={(v) => updateField('advanced.customCSS', v)}
            onJSChange={(v) => updateField('advanced.customJS', v)}
          />
        )

      default:
        return null
    }
  }, [currentTab, sectionData, theme, updateSection, updateField, uploadImage])

  // ==========================================
  // RENDER: LOADING
  // ==========================================

  if (isLoading || !theme) {
    return (
      <Box sx={{ 
        display: 'flex', 
        height: '100vh', 
        alignItems: 'center', 
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 2,
        bgcolor: 'background.default',
      }}>
        <CircularProgress size={60} thickness={4} />
        <Typography variant="h6" color="text.secondary">
          Cargando configuración del tema...
        </Typography>
      </Box>
    )
  }

  // ==========================================
  // DATOS DERIVADOS
  // ==========================================

  const storeName = theme.general?.storeName || 'Mi Tienda'
  const tagline = theme.general?.tagline || ''
  const faviconUrl = theme.general?.favicon?.url

  // Formatear último guardado
  const lastSavedText = lastSaved 
    ? new Date(lastSaved).toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : null

  // ==========================================
  // RENDER PRINCIPAL
  // ==========================================

  return (
    <ThemeProvider theme={adminBaseTheme}>
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        
        {/* ==========================================
            APP BAR (HEADER)
        ========================================== */}
        <AppBar 
          position="fixed" 
          sx={{ 
            zIndex: (t) => t.zIndex.drawer + 1,
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 1,
          }}
        >
          <Toolbar>
            {/* Logo/Título */}
            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600 }}>
              Theme Builder
            </Typography>

            {/* Info Tenant */}
            <Chip 
              label={`Tenant: ${tenantId || 'default'}`} 
              size="small" 
              variant="outlined"
              sx={{ mr: 2 }} 
            />

            {/* Indicador de cambios */}
            {hasChanges && (
              <Badge color="warning" variant="dot" sx={{ mr: 2 }}>
                <Chip 
                  label="Sin guardar" 
                  size="small" 
                  color="warning"
                  variant="outlined"
                />
              </Badge>
            )}

            {/* Auto-save Toggle */}
            <Tooltip title={autoSaveEnabled ? 'Auto-guardado activado' : 'Auto-guardado desactivado'}>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoSaveEnabled}
                    onChange={toggleAutoSave}
                    size="small"
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <CloudUploadIcon fontSize="small" />
                    <Typography variant="caption">
                      Auto{lastSavedText && `: ${lastSavedText}`}
                    </Typography>
                  </Box>
                }
                sx={{ mr: 2 }}
              />
            </Tooltip>

            {/* Preview Toggle */}
            <Tooltip title={previewMode ? 'Editar' : 'Vista previa'}>
              <Button
                variant={previewMode ? 'contained' : 'outlined'}
                color="info"
                onClick={handleTogglePreview}
                startIcon={<PreviewIcon />}
                size="small"
                sx={{ mr: 1 }}
              >
                {previewMode ? 'Editando Preview' : 'Preview'}
              </Button>
            </Tooltip>

            {/* Historial */}
            <Tooltip title="Historial de versiones">
              <IconButton 
                onClick={() => setShowHistory(true)}
                size="small"
                sx={{ mr: 1 }}
              >
                <HistoryIcon />
              </IconButton>
            </Tooltip>

            {/* Reset */}
            <Tooltip title="Resetear tema">
              <IconButton 
                onClick={handleReset} 
                disabled={isSaving}
                size="small"
                color="error"
                sx={{ mr: 1 }}
              >
                <ResetIcon />
              </IconButton>
            </Tooltip>

            {/* Descartar (solo si hay cambios) */}
            {hasChanges && (
              <Button
                variant="outlined"
                color="inherit"
                onClick={handleDiscard}
                disabled={isSaving}
                size="small"
                sx={{ mr: 1 }}
              >
                Descartar
              </Button>
            )}

            {/* Guardar */}
            <Button
              variant="contained"
              color={hasChanges ? 'primary' : 'success'}
              onClick={handleSave}
              disabled={isSaving || (!hasChanges && !previewMode)}
              startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
              size="small"
            >
              {isSaving ? 'Guardando...' : previewMode ? 'Guardar Cambios' : hasChanges ? 'Guardar' : 'Guardado'}
            </Button>
          </Toolbar>
        </AppBar>

        {/* ==========================================
            SIDEBAR (EDITOR)
        ========================================== */}
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            display: previewMode ? 'none' : 'block',
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              mt: 8,
              height: 'calc(100% - 64px)',
              display: 'flex',
              flexDirection: 'column',
              borderRight: 1,
              borderColor: 'divider',
            },
          }}
        >
          {/* Tabs */}
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              borderBottom: 1,
              borderColor: 'divider',
              minHeight: 48,
              '& .MuiTabs-flexContainer': {
                gap: 0.5,
              },
              '& .MuiTab-root': {
                minHeight: 48,
                textTransform: 'none',
                fontSize: 13,
                fontWeight: 500,
              },
            }}
          >
            {tabs.map((tab, i) => (
              <Tab
                key={tab.id}
                icon={tab.icon}
                label={tab.label}
                iconPosition="start"
              />
            ))}
          </Tabs>

          {/* Contenido del Panel */}
          <Box sx={{ 
            flex: 1, 
            overflow: 'auto',
            p: 3,
          }}>
            {/* Info General */}
            <Paper sx={{ p: 2, mb: 3 }} variant="outlined">
              <Typography variant="subtitle2" gutterBottom color="text.secondary" fontWeight={600}>
                Información General
              </Typography>
              
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="Nombre de la Tienda"
                  value={storeName}
                  onChange={(e) => updateField('general.storeName', e.target.value)}
                  size="small"
                  variant="outlined"
                />

                <TextField
                  fullWidth
                  label="Slogan"
                  value={tagline}
                  onChange={(e) => updateField('general.tagline', e.target.value)}
                  size="small"
                  variant="outlined"
                />

                {faviconUrl && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <img 
                      src={faviconUrl} 
                      alt="Favicon" 
                      style={{ width: 16, height: 16 }} 
                    />
                    <Typography variant="caption" color="text.secondary">
                      Favicon cargado
                    </Typography>
                  </Box>
                )}
              </Stack>
            </Paper>

            <Divider sx={{ mb: 2 }} />

            {/* Panel Dinámico */}
            {renderPanel()}
          </Box>
        </Drawer>

        {/* ==========================================
            PREVIEW AREA
        ========================================== */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            mt: 8,
            height: 'calc(100vh - 64px)',
            overflow: 'auto',
            bgcolor: 'background.default',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Toolbar de Preview */}
          {previewMode && (
            <Paper 
              sx={{ 
                p: 1, 
                mx: 2, 
                mt: 2, 
                display: 'flex', 
                gap: 1,
                alignItems: 'center',
              }} 
              variant="outlined"
            >
              <Typography variant="caption" fontWeight={600} sx={{ mr: 1 }}>
                Vista Previa:
              </Typography>
              
              <Button
                size="small"
                variant={previewViewport === 'desktop' ? 'contained' : 'outlined'}
                onClick={() => setPreviewViewport('desktop')}
              >
                Desktop
              </Button>
              <Button
                size="small"
                variant={previewViewport === 'tablet' ? 'contained' : 'outlined'}
                onClick={() => setPreviewViewport('tablet')}
              >
                Tablet
              </Button>
              <Button
                size="small"
                variant={previewViewport === 'mobile' ? 'contained' : 'outlined'}
                onClick={() => setPreviewViewport('mobile')}
              >
                Mobile
              </Button>

              <Box sx={{ flexGrow: 1 }} />

              {previewId && (
                <>
                  <Chip 
                    label="Preview no publicado" 
                    color="info" 
                    size="small" 
                    variant="outlined"
                  />
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    onClick={handlePublishPreview}
                    disabled={isSaving}
                  >
                    Publicar Cambios
                  </Button>
                </>
              )}
            </Paper>
          )}

          {/* Preview Component */}
          <Box sx={{ flex: 1, p: previewMode ? 2 : 3, overflow: 'auto' }}>
            <LivePreview 
              themeData={activeTheme || theme}
              viewport={previewViewport}
              isPreview={previewMode}
            />
          </Box>
        </Box>

        {/* ==========================================
            MODALES Y FEEDBACK
        ========================================== */}
        
        {/* Historial de Versiones */}
        <VersionHistory
          open={showHistory}
          onClose={() => setShowHistory(false)}
          onRollback={rollback}
          history={[]} // Se carga vía loadHistory
        />

        {/* Snackbar Success */}
        <Snackbar
          open={showSuccess}
          autoHideDuration={3000}
          onClose={() => setShowSuccess(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        >
          <Alert 
            severity="success" 
            onClose={() => setShowSuccess(false)}
            variant="filled"
          >
            Tema guardado correctamente
          </Alert>
        </Snackbar>

        {/* Snackbar Error */}
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
            {error || autoSaveError || 'Error al procesar la solicitud'}
          </Alert>
        </Snackbar>
      </Box>
    </ThemeProvider>
  )
}

export default React.memo(ThemeCustomizer)
