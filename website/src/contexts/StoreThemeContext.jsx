// 📁 src/contexts/StoreThemeContext.jsx
import React, {
  useState,
  useEffect,
  useMemo,
  createContext,
  useContext,
  useCallback,
} from 'react'

import { ThemeProvider as MUIThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { useSelector } from 'react-redux'

import { createStoreTheme } from './themeMapper'
import tenantService from '../services/tenantService'

const StoreThemeContext = createContext(null)

// =====================================================
// 🎨 Tema fallback seguro
// =====================================================

const createDefaultTheme = () => ({
  general: {
    storeName: 'Mi Tienda',
    tagline: 'Bienvenidos',
  },
  colors: {
    primary: '#3b82f6',
    secondary: '#8b5cf6',
    background: '#ffffff',
    textPrimary: '#111827',
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    headingFont: 'Inter, sans-serif',
  },
  header: {
    height: 70,
    sticky: true,
    showCart: true,
    showAccount: true,
    showWishlist: true,
  },
})

// =====================================================
// 🧠 Helpers
// =====================================================

const getCurrentTenantDomain = () => {
  return window.location.hostname.trim().toLowerCase()
}

// =====================================================
// 🏪 Provider
// =====================================================

export const StoreThemeProvider = ({ children }) => {
  const [themeData, setThemeData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reduxThemeState = useSelector(state => state.theme) || {}
  const { previewMode, previewConfig } = reduxThemeState

  const loadTheme = useCallback(async () => {
    // -------------------------------------------------
    // Preview mode del panel admin
    // -------------------------------------------------
    if (previewMode && previewConfig) {
      setThemeData(previewConfig)
      setError(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const currentDomain = getCurrentTenantDomain()

      // 1. Resolver tenant por dominio real actual
      const domain = window.location.hostname
      const tenantResponse = await tenantService.resolveTenantByDomain(domain)

      if (!tenantResponse?.success || !tenantResponse?.data?.tenantId) {
        throw new Error(
          tenantResponse?.error ||
            'No se pudo resolver el comercio para este dominio',
        )
      }

      const { tenantId } = tenantResponse.data

      // 2. Obtener tema público del tenant
      const themeResponse = await tenantService.getPublicTheme(tenantId)

      if (!themeResponse?.success || !themeResponse?.data) {
        throw new Error(
          themeResponse?.error ||
            'No se pudo cargar la configuración visual del comercio',
        )
      }

      setThemeData(themeResponse.data)
      setError(null)
    } catch (err) {
      console.error('❌ Error cargando tema:', err)

      setError(
        err?.response?.data?.message || err?.message || 'Error cargando tema',
      )

      // Fallback visual controlado para no romper la tienda
      setThemeData(createDefaultTheme())
    } finally {
      setLoading(false)
    }
  }, [previewMode, previewConfig])

  useEffect(() => {
    loadTheme()

    let intervalId = null

    // Polling liviano para refrescar cambios públicos de theme.
    // En preview mode no debe interferir con el estado del panel.
    if (!previewMode) {
      intervalId = setInterval(loadTheme, 30000)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [loadTheme, previewMode])

  const muiTheme = useMemo(() => {
    return createStoreTheme(themeData || createDefaultTheme())
  }, [themeData])

  const contextValue = useMemo(
    () => ({
      themeData,
      loading,
      error,
      refreshTheme: loadTheme,
      isPreview: previewMode,
    }),
    [themeData, loading, error, loadTheme, previewMode],
  )

  if (loading && !themeData) {
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

// =====================================================
// 🪝 Hook
// =====================================================

export const useStoreTheme = () => {
  const context = useContext(StoreThemeContext)

  if (context === null) {
    throw new Error('useStoreTheme debe usarse dentro de StoreThemeProvider')
  }

  return context
}

export default StoreThemeProvider
