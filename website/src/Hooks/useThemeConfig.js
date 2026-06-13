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
// HELPERS DE ENTORNO
// ==========================================

const canUseBrowser = () => typeof window !== 'undefined'

const canUseLocalStorage = () =>
  canUseBrowser() && typeof window.localStorage !== 'undefined'

const getCurrentHostname = () => {
  if (!canUseBrowser()) return ''

  return window.location?.hostname || ''
}

const delay = ms =>
  new Promise(resolve => {
    if (canUseBrowser() && typeof window.setTimeout === 'function') {
      window.setTimeout(resolve, ms)
      return
    }

    resolve()
  })

const createAbortController = () => {
  if (canUseBrowser() && typeof window.AbortController === 'function') {
    return new window.AbortController()
  }

  return null
}

// ==========================================
// UTILIDADES DE CACHE
// ==========================================

const getCachedConfig = () => {
  if (!canUseLocalStorage()) return null

  try {
    const cached = window.localStorage.getItem(CONFIG.CACHE_KEY)
    if (!cached) return null

    const { data, timestamp, hostname } = JSON.parse(cached)

    const currentHostname = getCurrentHostname()

    if (
      hostname !== currentHostname ||
      Date.now() - Number(timestamp || 0) > CONFIG.CACHE_TTL
    ) {
      window.localStorage.removeItem(CONFIG.CACHE_KEY)
      return null
    }

    return data || null
  } catch {
    return null
  }
}

const setCachedConfig = data => {
  if (!canUseLocalStorage()) return

  try {
    window.localStorage.setItem(
      CONFIG.CACHE_KEY,
      JSON.stringify({
        data,
        timestamp: Date.now(),
        hostname: getCurrentHostname(),
      }),
    )
  } catch (error) {
    console.warn('[useThemeConfig] No se pudo guardar en cache:', error)
  }
}

const removeCachedConfig = () => {
  if (!canUseLocalStorage()) return

  try {
    window.localStorage.removeItem(CONFIG.CACHE_KEY)
  } catch {
    // Silencioso: cache no crítico.
  }
}

const getAuthToken = () => {
  if (!canUseLocalStorage()) return null

  try {
    return window.localStorage.getItem('token')
  } catch {
    return null
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

  const [state, setState] = useState(() => {
    const cachedConfig = getCachedConfig()

    return {
      themeConfig: cachedConfig,
      isLoading: !cachedConfig,
      error: null,
      tenantId: cachedConfig?.tenantId || null,
      tenantName: cachedConfig?.tenantName || null,
    }
  })

  // ==========================================
  // FUNCIÓN DE FETCH CON RETRY
  // ==========================================

  const fetchWithRetry = useCallback(async operation => {
    try {
      const result = await operation()

      if (!isMountedRef.current) {
        throw new Error('COMPONENT_UNMOUNTED')
      }

      return result
    } catch (error) {
      if (error?.message === 'COMPONENT_UNMOUNTED' || !isMountedRef.current) {
        throw error
      }

      const shouldRetry =
        !error?.response ||
        (error.response?.status >= 500 && error.response?.status < 600)

      if (shouldRetry && retryCountRef.current < CONFIG.MAX_RETRIES) {
        retryCountRef.current += 1

        await delay(CONFIG.RETRY_DELAY * retryCountRef.current)

        return fetchWithRetry(operation)
      }

      throw error
    }
  }, [])

  // ==========================================
  // INICIALIZACIÓN
  // ==========================================

  useEffect(() => {
    isMountedRef.current = true

    const hasCache = !!state.themeConfig

    const initSaaS = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      abortControllerRef.current = createAbortController()
      retryCountRef.current = 0

      try {
        if (!hasCache) {
          setState(prev => ({
            ...prev,
            isLoading: true,
            error: null,
          }))
        }

        const hostname = getCurrentHostname()

        if (!hostname) {
          throw new Error('No se pudo detectar el dominio actual')
        }

        // 1. RESOLVER TENANT
        const tenantRes = await fetchWithRetry(() =>
          themeService.resolveTenantByDomain(hostname, {
            signal: abortControllerRef.current?.signal,
          }),
        )

        const tenantData = tenantRes?.data
        const tenantId = tenantData?.tenantId || tenantData?._id
        const tenantName = tenantData?.name || tenantData?.storeName

        if (!tenantRes?.success || !tenantId) {
          throw new Error(
            tenantRes?.message || `No se encontró tenant para: ${hostname}`,
          )
        }

        // 2. CARGAR TEMA
        const themeRes = await fetchWithRetry(() =>
          themeService.getPublicTheme(tenantId, {
            signal: abortControllerRef.current?.signal,
          }),
        )

        if (!themeRes?.success || !themeRes?.data) {
          throw new Error(themeRes?.message || 'Tema no disponible')
        }

        // 3. CONSTRUIR CONFIGURACIÓN COMPLETA
        const configFull = {
          ...themeRes.data,
          tenantId,
          storeName:
            themeRes.data?.general?.storeName ||
            themeRes.data?.storeName ||
            tenantName ||
            CONFIG.DEFAULT_STORE_NAME,
          tenantName:
            tenantName ||
            themeRes.data?.general?.storeName ||
            themeRes.data?.storeName ||
            CONFIG.DEFAULT_STORE_NAME,
          _loadedAt: Date.now(),
          _source: 'api',
        }

        if (!isMountedRef.current) return

        // 4. ACTUALIZAR ESTADOS
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
        dispatch(setPreviewMode(false))
      } catch (error) {
        if (error?.message === 'COMPONENT_UNMOUNTED') return

        const cached = getCachedConfig()

        if (cached && isMountedRef.current) {
          console.warn('[useThemeConfig] Usando cache como fallback')

          setState({
            themeConfig: cached,
            isLoading: false,
            error: {
              message:
                'Usando datos en cache. Algunos cambios pueden no reflejarse.',
              originalError: error?.message || 'Error desconocido',
              isOffline: !error?.response,
            },
            tenantId: cached.tenantId || null,
            tenantName: cached.tenantName || cached.storeName || null,
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
              message: error?.message || 'Error cargando configuración',
              isOffline: !error?.response,
              status: error?.response?.status,
            },
          }))
        }
      }
    }

    initSaaS()

    return () => {
      isMountedRef.current = false
      abortControllerRef.current?.abort()
    }
  }, [dispatch, fetchWithRetry, state.themeConfig])

  // ==========================================
  // ACCIONES EXPUESTAS
  // ==========================================

  const refresh = useCallback(async () => {
    removeCachedConfig()
    retryCountRef.current = 0

    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
    }))

    if (canUseBrowser()) {
      window.location.reload()
    }
  }, [])

  const updateOptimistic = useCallback(
    partialConfig => {
      setState(prev => {
        const newConfig = {
          ...prev.themeConfig,
          ...partialConfig,
          _source: 'optimistic',
          _updatedAt: Date.now(),
        }

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

  const persist = useCallback(
    async newConfig => {
      if (!state.tenantId) {
        throw new Error('No hay tenant activo para persistir')
      }

      try {
        const token = getAuthToken()
        const result = await themeService.updateThemeConfig(token, newConfig)

        if (result?.success) {
          const persisted = {
            ...newConfig,
            tenantId: state.tenantId,
            tenantName: state.tenantName,
            _source: 'persisted',
            _updatedAt: Date.now(),
          }

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
    [state.tenantId, state.tenantName, dispatch],
  )

  // ==========================================
  // VALOR RETORNADO
  // ==========================================

  const value = useMemo(() => {
    const cachedConfig = getCachedConfig()

    return {
      themeConfig: state.themeConfig,
      isLoading: state.isLoading,
      error: state.error,

      tenantId: state.tenantId,
      tenantName: state.tenantName,

      isReady: !state.isLoading && !!state.themeConfig,
      hasError: !!state.error && !state.themeConfig,
      isOffline: state.error?.isOffline || false,
      isCached:
        state.themeConfig?._source === 'cache' ||
        (!!cachedConfig && state.isLoading),

      refresh,
      updateOptimistic,
      persist,
    }
  }, [
    state.themeConfig,
    state.isLoading,
    state.error,
    state.tenantId,
    state.tenantName,
    refresh,
    updateOptimistic,
    persist,
  ])

  return value
}

export default useThemeConfig
