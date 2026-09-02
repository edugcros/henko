// 📁 src/contexts/TenantContext.js - VERSIÓN INTEGRADA Y OPTIMIZADA
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import tenantService from '../services/tenantService'
import { setPreviewMode, updateLocalConfig } from '@features/theme/themeSlice'
import { initMetaPixel } from '@utils/metaPixel'

// ==========================================
// CONFIGURACIÓN
// ==========================================

const CONFIG = {
  CACHE_KEY: 'tenant_theme_config',
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
}

// ==========================================
// TIPOS / INTERFACES (JSDoc)
// ==========================================

/**
 * @typedef {Object} TenantContextValue
 * @property {Object|null} themeConfig - Configuración del tema
 * @property {boolean} isLoading - Estado de carga
 * @property {Error|null} error - Error si ocurrió
 * @property {string|null} tenantId - ID del tenant actual
 * @property {boolean} aiAssistantEnabled - Si el comercio activó el asistente
 * @property {boolean} isReady - Si está listo para usar
 * @property {Function} refresh - Recargar configuración
 * @property {Function} updateOptimistic - Actualización optimista
 * @property {Function} syncWithRedux - Sincronizar con Redux manualmente
 */

// ==========================================
// DEFAULT VALUE
// ==========================================

const defaultContextValue = {
  themeConfig: null,
  isLoading: true,
  error: null,
  tenantId: null,
  aiAssistantEnabled: false,
  isReady: false,
  refresh: async () => {},
  updateOptimistic: () => {},
  syncWithRedux: () => {},
}

// ==========================================
// CONTEXT
// ==========================================

const TenantContext = createContext(defaultContextValue)

// ==========================================
// PROVIDER
// ==========================================

export const TenantProvider = ({ children }) => {
  // ==========================================
  // REDUX INTEGRATION
  // ==========================================

  const dispatch = useDispatch()
  const reduxTheme = useSelector(state => state.theme?.config)
  const reduxLoading = useSelector(state => state.theme?.isLoading)

  // ==========================================
  // LOCAL STATE
  // ==========================================

  const [localState, setLocalState] = useState({
    themeConfig: null,
    isLoading: true,
    error: null,
    tenantId: null,
    initialized: false,
  })

  // ==========================================
  // HELPERS
  // ==========================================

  const getHostname = useCallback(() => {
    // Priorizar variable de entorno en desarrollo
    if (process.env.REACT_APP_FORCE_TENANT_DOMAIN) {
      return process.env.REACT_APP_FORCE_TENANT_DOMAIN
    }
    return window.location.hostname
  }, [])

  const loadFromCache = useCallback(() => {
    try {
      const cached = localStorage.getItem(CONFIG.CACHE_KEY)
      if (!cached) return null

      const { data, timestamp } = JSON.parse(cached)
      const isValid = Date.now() - timestamp < CONFIG.CACHE_TTL

      return isValid ? data : null
    } catch {
      return null
    }
  }, [])

  const saveToCache = useCallback(data => {
    try {
      localStorage.setItem(
        CONFIG.CACHE_KEY,
        JSON.stringify({
          data,
          timestamp: Date.now(),
        }),
      )
    } catch (error) {
      console.warn('[TenantContext] Error guardando en cache:', error)
    }
  }, [])

  // ==========================================
  // CORE FUNCTION: LOAD TENANT & THEME
  // ==========================================

  const loadTenantAndTheme = useCallback(
    async (attempt = 1) => {
      if (typeof window !== 'undefined' && window.location.pathname === '/theme-preview') {
        setLocalState(prev => ({
          ...prev,
          isLoading: false,
          error: null,
          initialized: true,
        }))
        return null
      }

      const hostname = getHostname()

      try {
        // 1. RESOLVER TENANT
        const tenantRes = await tenantService.resolveTenantByDomain(hostname)

        if (!tenantRes.success) {
          throw new Error(tenantRes.error || 'Error resolviendo tenant')
        }

        const tenantId = tenantRes.data?.tenantId || tenantRes.data?._id
        const tenantName = tenantRes.data?.name || tenantRes.data?.storeName

        if (!tenantId) {
          throw new Error('Tenant ID no encontrado en respuesta')
        }

        // 2. CARGAR TEMA (público para inicialización rápida)

        const themeRes = await tenantService.getPublicTheme(tenantId)
        if (!themeRes.success) {
          throw new Error(themeRes.error || 'Error cargando tema')
        }
        // 3. CONSTRUIR CONFIGURACIÓN COMPLETA
        //
        // aiAssistantEnabled viaja dentro de la config (y no en un estado
        // aparte) para que los tres caminos de arranque lo tengan sin
        // duplicar lógica: red, cache previa y cache de fallback guardan y
        // leen este mismo objeto.
        //
        // Se guarda tal cual lo dijo el backend, incluido `undefined` cuando
        // no dijo nada. Distinguir "apagado" de "no sé" es lo que evita que
        // una ventana de deploy apague el asistente en todas las tiendas: la
        // política de qué hacer ante "no sé" se decide en un solo lugar, al
        // leer el valor más abajo.
        const fullConfig = {
          ...themeRes.data,
          tenantId,
          aiAssistantEnabled: tenantRes.data?.aiAssistant?.enabled,
          tenantName: tenantName || themeRes.data?.general?.storeName || 'Mi Tienda',
          tracking: tenantRes.data?.tracking || null,
          _meta: {
            loadedAt: Date.now(),
            source: 'api',
            hostname,
          },
        }

        // El pixel se inyecta recién acá porque public/index.html es un solo
        // build compartido por todos los tenants — no hay dónde hardcodearlo
        // por tienda. No-op si el comercio no configuró Meta Pixel.
        const pixelId = fullConfig.tracking?.meta?.pixelId
        if (pixelId) initMetaPixel(pixelId)

        // 4. GUARDAR EN CACHE
        saveToCache(fullConfig)

        // 5. ACTUALIZAR ESTADO LOCAL
        setLocalState({
          themeConfig: fullConfig,
          isLoading: false,
          error: null,
          tenantId,
          initialized: true,
        })

        // 6. SINCRONIZAR CON REDUX
        dispatch(updateLocalConfig(fullConfig))
        dispatch(setPreviewMode(false))

        return fullConfig
      } catch (error) {
        console.error(`[TenantContext] ❌ Error (intento ${attempt}):`, error.message)

        // RETRY LOGIC
        if (attempt < CONFIG.RETRY_ATTEMPTS) {
          await new Promise(resolve => {
            setTimeout(resolve, CONFIG.RETRY_DELAY)
          })
        }
        // FALLBACK A CACHE
        const cached = loadFromCache()
        if (cached) {
          setLocalState({
            themeConfig: cached,
            isLoading: false,
            error: { message: error.message, usingCache: true },
            tenantId: cached.tenantId,
            initialized: true,
          })

          dispatch(updateLocalConfig(cached))
          return cached
        }

        // ERROR FINAL
        setLocalState(prev => ({
          ...prev,
          isLoading: false,
          error: {
            message: error.message,
            isOffline:
              typeof window !== 'undefined' && typeof window.navigator !== 'undefined'
                ? !window.navigator.onLine
                : false,
            timestamp: Date.now(),
          },
          initialized: true,
        }))

        throw error
      }
    },
    [dispatch, getHostname, loadFromCache, saveToCache],
  )

  // ==========================================
  // PUBLIC ACTIONS
  // ==========================================

  const refresh = useCallback(async () => {
    setLocalState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      // Invalidar cache
      localStorage.removeItem(CONFIG.CACHE_KEY)

      // Recargar
      await loadTenantAndTheme()
    } catch (error) {
      console.error('[TenantContext] Error en refresh:', error)
    }
  }, [dispatch, loadTenantAndTheme])

  const updateOptimistic = useCallback(
    partialConfig => {
      setLocalState(prev => {
        if (!prev.themeConfig) return prev

        const updated = {
          ...prev.themeConfig,
          ...partialConfig,
          _meta: {
            ...prev.themeConfig._meta,
            updatedAt: Date.now(),
            optimistic: true,
          },
        }

        // Sincronizar con Redux inmediatamente
        dispatch(updateLocalConfig(updated))
        dispatch(setPreviewMode(true))

        return { ...prev, themeConfig: updated }
      })
    },
    [dispatch],
  )

  const syncWithRedux = useCallback(() => {
    if (localState.themeConfig) {
      dispatch(updateLocalConfig(localState.themeConfig))
      dispatch(setPreviewMode(false))
    }
  }, [dispatch, localState.themeConfig])

  // ==========================================
  // INITIALIZATION EFFECT
  // ==========================================

  useEffect(() => {
    // Evitar doble ejecución en StrictMode
    if (localState.initialized) return

    // Intentar cache primero para UX rápida
    const cached = loadFromCache()
    if (cached) {
      setLocalState({
        themeConfig: cached,
        isLoading: true, // Seguir cargando en background
        error: null,
        tenantId: cached.tenantId,
        initialized: true,
      })
      dispatch(updateLocalConfig(cached))

      const cachedPixelId = cached.tracking?.meta?.pixelId
      if (cachedPixelId) initMetaPixel(cachedPixelId)
    }

    // Cargar fresco (siempre)
    loadTenantAndTheme().catch(() => {
      // Error ya manejado en la función
    })
  }, []) // Solo al montar

  // ==========================================
  // SYNC EFFECT: Redux -> Local
  // ==========================================

  useEffect(() => {
    // Si Redux tiene datos más recientes (ej: después de guardar en admin)
    if (reduxTheme && localState.initialized) {
      const reduxTime = reduxTheme._meta?.loadedAt || 0
      const localTime = localState.themeConfig?._meta?.loadedAt || 0

      if (reduxTime > localTime) {
        setLocalState(prev => ({
          ...prev,
          themeConfig: reduxTheme,
        }))
      }
    }
  }, [reduxTheme, localState.initialized, localState.themeConfig?._meta?.loadedAt])

  // ==========================================
  // MEMOIZED VALUE
  // ==========================================

  const value = useMemo(
    () => ({
      themeConfig: localState.themeConfig,
      isLoading: localState.isLoading || reduxLoading,
      error: localState.error,
      tenantId: localState.tenantId,
      // Única decisión sobre si la tienda descarga y muestra el asistente.
      // Tres estados, no dos:
      //
      //   config sin cargar  → false, para no hacer parpadear la burbuja en
      //                        cada carga antes de saber si corresponde.
      //   campo ausente      → true. Es un backend que todavía no conoce el
      //                        campo (o un cache escrito por una versión
      //                        anterior). Vercel publica en cada push y Render
      //                        recién al mergear, así que esa ventana existe
      //                        siempre; fallar cerrado ahí apagaba el
      //                        asistente en TODAS las tiendas hasta que los
      //                        dos deploys se emparejaran.
      //   campo en false     → false. Acá el backend sí sabe y dijo que no.
      aiAssistantEnabled:
        Boolean(localState.themeConfig) && localState.themeConfig.aiAssistantEnabled !== false,
      isReady: localState.initialized && !!localState.themeConfig && !localState.isLoading,
      refresh,
      updateOptimistic,
      syncWithRedux,
    }),
    [localState, reduxLoading, refresh, updateOptimistic, syncWithRedux],
  )

  // ==========================================
  // RENDER
  // ==========================================

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

// ==========================================
// HOOK
// ==========================================

export const useTenant = () => {
  const context = useContext(TenantContext)

  if (context === undefined || context === null) {
    console.error('❌ useTenant debe usarse dentro de TenantProvider')
    // Retornar default en lugar de throw para evitar crashes
    return defaultContextValue
  }

  return context
}

// ==========================================
// HOC PARA PROTEGER COMPONENTES
// ==========================================

export const withTenant = Component => {
  return function WithTenantWrapper(props) {
    const tenant = useTenant()

    if (!tenant.isReady) {
      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          {tenant.isLoading ? (
            <>
              <div className="spinner" />
              <p>Cargando configuración...</p>
            </>
          ) : tenant.error ? (
            <>
              <p style={{ color: 'red' }}>Error: {tenant.error.message}</p>
              <button onClick={tenant.refresh}>Reintentar</button>
            </>
          ) : (
            <p>Error desconocido</p>
          )}
        </div>
      )
    }

    return React.createElement(Component, {
      ...props,
      tenant,
    })
  }
}

export default TenantContext
