// 📁 src/hooks/useThemeConfig.js
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useDispatch } from 'react-redux'
import themeService from '@features/theme/themeService'
import { updatePreviewConfig, setPreviewMode } from '@features/theme/themeSlice'

// ==========================================
// CONFIGURACIÓN
// ==========================================

const CONFIG = {
  CACHE_KEY: 'saas_theme_config',
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  DEFAULT_STORE_NAME: 'Mi Tienda',
}

// ==========================================
// UTILIDADES DE CACHE
// ==========================================

const getCachedConfig = () => {
  try {
    const cached = localStorage.getItem(CONFIG.CACHE_KEY)
    if (!cached) return null

    const { data, timestamp, hostname } = JSON.parse(cached)

    // Invalidar si cambió el dominio o expiró
    if (hostname !== window.location.hostname || Date.now() - timestamp > CONFIG.CACHE_TTL) {
      localStorage.removeItem(CONFIG.CACHE_KEY)
      return null
    }

    return data
  } catch {
    return null
  }
}

const setCachedConfig = data => {
  try {
    localStorage.setItem(
      CONFIG.CACHE_KEY,
      JSON.stringify({
        data,
        timestamp: Date.now(),
        hostname: window.location.hostname,
      }),
    )
  } catch (error) {
    console.warn('[useThemeConfig] No se pudo guardar en cache:', error)
  }
}

// ==========================================
// HOOK PRINCIPAL
// ==========================================

export const useThemeConfig = () => {
  const dispatch = useDispatch()
  const abortControllerRef = useRef(null)
  const retryCountRef = useRef(0)
  const isMountedRef = useRef(true)

  const [state, setState] = useState(() => ({
    themeConfig: getCachedConfig(),
    isLoading: !getCachedConfig(),
    error: null,
    tenantId: null,
    tenantName: null,
  }))

  // ==========================================
  // FUNCIÓN DE FETCH CON RETRY
  // ==========================================

  const fetchWithRetry = useCallback(async (operation, operationName) => {
    try {
      const result = await operation()

      if (!isMountedRef.current) {
        throw new Error('COMPONENT_UNMOUNTED')
      }

      return result
    } catch (error) {
      // No reintentar si el componente se desmontó
      if (error.message === 'COMPONENT_UNMOUNTED' || !isMountedRef.current) {
        throw error
      }

      // Reintentar solo en errores de red o 5xx
      const shouldRetry =
        !error.response || (error.response?.status >= 500 && error.response?.status < 600)

      if (shouldRetry && retryCountRef.current < CONFIG.MAX_RETRIES) {
        retryCountRef.current += 1

        await new Promise(resolve =>
          setTimeout(resolve, CONFIG.RETRY_DELAY * retryCountRef.current),
        )

        return fetchWithRetry(operation, operationName)
      }

      throw error
    }
  }, [])

  // ==========================================
  // INICIALIZACIÓN
  // ==========================================

  useEffect(() => {
    isMountedRef.current = true

    // Si ya tenemos cache, no forzar loading visual
    const hasCache = !!state.themeConfig

    const initSaaS = async () => {
      // Cancelar petición anterior si existe
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      abortControllerRef.current = new AbortController()
      retryCountRef.current = 0

      try {
        if (!hasCache) {
          setState(prev => ({ ...prev, isLoading: true, error: null }))
        }

        const hostname = window.location.hostname

        // 1. RESOLVER TENANT
        const tenantRes = await fetchWithRetry(
          () =>
            themeService.resolveTenantByDomain(hostname, {
              signal: abortControllerRef.current.signal,
            }),
          'resolveTenant',
        )

        const tenantData = tenantRes?.data
        const tenantId = tenantData?.tenantId || tenantData?._id
        const tenantName = tenantData?.name || tenantData?.storeName

        if (!tenantRes?.success || !tenantId) {
          throw new Error(tenantRes?.message || `No se encontró tenant para: ${hostname}`)
        }

        // 2. CARGAR TEMA
        const themeRes = await fetchWithRetry(
          () =>
            themeService.getPublicTheme(tenantId, {
              signal: abortControllerRef.current.signal,
            }),
          'getPublicTheme',
        )

        if (!themeRes?.success || !themeRes?.data) {
          throw new Error(themeRes?.message || 'Tema no disponible')
        }

        // 3. CONSTRUIR CONFIGURACIÓN COMPLETA
        const configFull = useMemo(
          () => ({
            ...themeRes.data,
            // Asegurar valores críticos
            tenantId,
            storeName: themeRes.data?.storeName || tenantName || CONFIG.DEFAULT_STORE_NAME,
            tenantName: tenantName || themeRes.data?.storeName,
            // Metadata útil
            _loadedAt: Date.now(),
            _source: 'api',
          }),
          [themeRes.data, tenantId, tenantName],
        )

        // 4. ACTUALIZAR ESTADOS (solo si sigue montado)
        if (!isMountedRef.current) return

        setState({
          themeConfig: configFull,
          isLoading: false,
          error: null,
          tenantId,
          tenantName,
        })

        // 5. SINCRONIZAR CON REDUX Y CACHE
        setCachedConfig(configFull)
        dispatch(updatePreviewConfig(configFull))

        // Desactivar modo preview si estaba activo (carga real)
        dispatch(setPreviewMode(false))
      } catch (error) {
        if (error.message === 'COMPONENT_UNMOUNTED') return

        // Intentar usar cache como fallback
        const cached = getCachedConfig()

        if (cached && isMountedRef.current) {
          console.warn('[useThemeConfig] Usando cache como fallback')
          setState({
            themeConfig: cached,
            isLoading: false,
            error: {
              message: 'Usando datos en cache. Algunos cambios pueden no reflejarse.',
              originalError: error.message,
              isOffline: !error.response,
            },
            tenantId: cached.tenantId,
            tenantName: cached.tenantName,
          })
          dispatch(updatePreviewConfig(cached))
          return
        }

        if (isMountedRef.current) {
          setState(prev => ({
            ...prev,
            themeConfig: null,
            isLoading: false,
            error: {
              message: error.message || 'Error cargando configuración',
              isOffline: !error.response,
              status: error.response?.status,
            },
          }))
        }
      }
    }

    initSaaS()

    // Cleanup
    return () => {
      isMountedRef.current = false
      abortControllerRef.current?.abort()
    }
  }, [dispatch, fetchWithRetry]) // Solo se ejecuta al montar

  // ==========================================
  // ACCIONES EXPUESTAS
  // ==========================================

  /**
   * Refrescar configuración manualmente
   */
  const refresh = useCallback(async () => {
    // Invalidar cache
    localStorage.removeItem(CONFIG.CACHE_KEY)
    retryCountRef.current = 0

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    // Forzar re-ejecución del effect
    // Nota: En una implementación real, podrías usar una key de estado
    window.location.reload() // Fallback simple para producción
  }, [])

  /**
   * Actualizar configuración optimistamente (para el editor)
   */
  const updateOptimistic = useCallback(
    partialConfig => {
      setState(prev => {
        const newConfig = {
          ...prev.themeConfig,
          ...partialConfig,
          _source: 'optimistic',
        }

        // Sincronizar con Redux para preview en tiempo real
        dispatch(updatePreviewConfig(newConfig))
        dispatch(setPreviewMode(true))

        return {
          ...prev,
          themeConfig: newConfig,
        }
      })
    },
    [dispatch],
  )

  /**
   * Guardar configuración (persistir cambios)
   */
  const persist = useCallback(
    async newConfig => {
      if (!state.tenantId) {
        throw new Error('No hay tenant activo para persistir')
      }

      try {
        const result = await themeService.updateTheme(state.tenantId, newConfig)

        if (result.success) {
          // Actualizar cache y estados
          const persisted = { ...newConfig, _source: 'persisted' }
          setCachedConfig(persisted)
          setState(prev => ({
            ...prev,
            themeConfig: persisted,
          }))
          dispatch(updatePreviewConfig(persisted))
          dispatch(setPreviewMode(false))
        }

        return result
      } catch (error) {
        console.error('[useThemeConfig] Error persistiendo:', error)
        throw error
      }
    },
    [state.tenantId, dispatch],
  )

  // ==========================================
  // VALOR RETORNADO (MEMOIZADO)
  // ==========================================

  const value = useMemo(
    () => ({
      // Datos principales
      themeConfig: state.themeConfig,
      isLoading: state.isLoading,
      error: state.error,

      // Metadata del tenant
      tenantId: state.tenantId,
      tenantName: state.tenantName,

      // Estados derivados
      isReady: !state.isLoading && !!state.themeConfig,
      hasError: !!state.error && !state.themeConfig,
      isOffline: state.error?.isOffline || false,
      isCached: state.themeConfig?._source === 'cache' || (!!getCachedConfig() && state.isLoading),

      // Acciones
      refresh,
      updateOptimistic,
      persist,
    }),
    [
      state.themeConfig,
      state.isLoading,
      state.error,
      state.tenantId,
      state.tenantName,
      refresh,
      updateOptimistic,
      persist,
    ],
  )

  return value
}

export default useThemeConfig
