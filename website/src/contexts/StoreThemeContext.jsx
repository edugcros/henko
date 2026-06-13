import React, { createContext, useContext, useMemo } from 'react'

import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider as MUIThemeProvider } from '@mui/material/styles'
import { useSelector } from 'react-redux'

import { useTenant } from './TenantContext'
import { createStoreTheme } from './themeMapper'

const StoreThemeContext = createContext(null)

const createDefaultTheme = () => ({
  general: {
    storeName: 'Mi Tienda',
    tagline: 'Bienvenidos',
  },
  colors: {
    primary: '#2563eb',
    secondary: '#64748b',
    accent: '#0f172a',
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#111827',
    mutedText: '#64748b',
    border: '#e5e7eb',
    actionPrimary: '#2563eb',
    actionPrimaryText: '#ffffff',
    actionSecondary: '#64748b',
    actionSecondaryText: '#ffffff',
    link: '#2563eb',
    price: '#2563eb',
    salePrice: '#dc2626',
    badgeBackground: '#64748b',
    badgeText: '#ffffff',
    error: '#dc2626',
    warning: '#f59e0b',
    info: '#0288d1',
    success: '#16a34a',
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    headingFont: 'Inter, sans-serif',
    secondaryFont: 'Inter, sans-serif',
    baseSize: 16,
    lineHeight: 1.5,
    scale: 1.25,
  },
  spacing: {
    section: 64,
    container: 24,
    radius: 8,
    cardPadding: 16,
  },
  layout: {
    maxWidth: 1200,
    containerPadding: 24,
    borderRadius: 8,
    shadowIntensity: 2,
  },
  buttons: {
    radius: 8,
    uppercase: false,
    elevation: 2,
    size: 'medium',
    variant: 'contained',
  },
})

const isThemePreviewRoute = () =>
  typeof window !== 'undefined' && window.location.pathname === '/theme-preview'

export const StoreThemeProvider = ({ children }) => {
  const tenant = useTenant()
  const reduxThemeState = useSelector(state => state.theme) || {}
  const { config: reduxConfig, previewMode, previewConfig } = reduxThemeState

  const activeTheme = useMemo(() => {
    if (previewMode && previewConfig) return previewConfig
    if (reduxConfig) return reduxConfig
    if (tenant?.themeConfig) return tenant.themeConfig
    return createDefaultTheme()
  }, [previewMode, previewConfig, reduxConfig, tenant?.themeConfig])

  const muiTheme = useMemo(() => {
    return createStoreTheme(
      activeTheme,
      activeTheme?.tenantId || tenant?.tenantId || 'default',
    )
  }, [activeTheme, tenant?.tenantId])

  const loading = useMemo(() => {
    if (isThemePreviewRoute()) return false
    return Boolean(
      !previewMode && !reduxConfig && tenant?.isLoading && !tenant?.themeConfig,
    )
  }, [previewMode, reduxConfig, tenant?.isLoading, tenant?.themeConfig])

  const contextValue = useMemo(
    () => ({
      themeData: activeTheme,
      loading,
      error: tenant?.error || null,
      refreshTheme: tenant?.refresh || (async () => {}),
      isPreview: previewMode,
    }),
    [activeTheme, loading, tenant?.error, tenant?.refresh, previewMode],
  )

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontFamily: 'system-ui',
        }}
      >
        <div>Cargando tema...</div>
      </div>
    )
  }

  return (
    <StoreThemeContext.Provider value={contextValue}>
      <MUIThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </MUIThemeProvider>
    </StoreThemeContext.Provider>
  )
}

export const useStoreTheme = () => {
  const context = useContext(StoreThemeContext)

  if (context === null) {
    throw new Error('useStoreTheme debe usarse dentro de StoreThemeProvider')
  }

  return context
}

export default StoreThemeProvider
