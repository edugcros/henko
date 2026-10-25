// src/hooks/useTheme.js - VERSIÓN PRODUCCIÓN REFACTORIZADA
import { useCallback, useEffect, useRef, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { debounce } from 'lodash'
import {
  // Selectors
  selectTheme,
  selectActiveTheme,
  selectOriginalTheme,
  selectThemeSection,
  selectHasUnsavedChanges,
  selectIsLoading,
  selectIsSaving,
  selectThemeError,
  selectAutoSaveStatus,
  selectPreviewStatus,
  selectActiveSection,
  selectThemeStatus,

  // Actions
  updateField as updateFieldAction,
  updateSection as updateSectionAction,
  setPreviewData,
  clearPreview,
  setActiveSection,
  togglePreviewMode,
  toggleAutoSave,
  discardChanges,
  clearError,
  clearAutoSaveError,

  // Thunks
  fetchTheme,
  saveTheme,
  autoSaveTheme,
  resetThemeToDefault,
  uploadThemeImage,
  exportThemeToFile,
  importThemeFromFile,
  toggleMaintenanceMode,
  validateThemeConfig,
} from '../features/theme/themeSlice'

// ==========================================
// CONFIGURACIÓN
// ==========================================

const AUTO_SAVE_DELAY = 1500
const AUTO_SAVE_MAX_WAIT = 10000
const AUTO_SAVE_RETRY_COOLDOWN = 15000

// ==========================================
// HOOK PRINCIPAL
// ==========================================

export const useTheme = () => {
  const dispatch = useDispatch()

  // Selectors
  const theme = useSelector(selectTheme)
  const activeTheme = useSelector(selectActiveTheme)
  const originalTheme = useSelector(selectOriginalTheme)
  const hasChanges = useSelector(selectHasUnsavedChanges)
  const isLoading = useSelector(selectIsLoading)
  const isSaving = useSelector(selectIsSaving)
  const error = useSelector(selectThemeError)
  const autoSave = useSelector(selectAutoSaveStatus)
  const preview = useSelector(selectPreviewStatus)
  const activeSection = useSelector(selectActiveSection)
  const status = useSelector(selectThemeStatus)

  // Refs para auto-save
  const pendingChanges = useRef({})
  const autoSaveBlockedUntil = useRef(0)
  const retryTimer = useRef(null)
  const inFlight = useRef(false)
  const queuedWhileInFlight = useRef(false)
  const autoSaveEnabled = useRef(autoSave.enabled)
  autoSaveEnabled.current = autoSave.enabled

  // ==========================================
  // CARGA INICIAL
  // ==========================================

  const loadTheme = useCallback(() => {
    return dispatch(fetchTheme())
  }, [dispatch])

  // Con `error` se corta: antes, si la carga fallaba, theme seguía en null e
  // isLoading volvía a false, así que este efecto la pedía otra vez, y otra,
  // en un ciclo sin fin contra el backend. Reintentar es `refresh`.
  useEffect(() => {
    if (!theme && !isLoading && !error) {
      loadTheme()
    }
  }, [theme, isLoading, error, loadTheme])

  // ==========================================
  // AUTO-SAVE CON DEBOUNCE
  // ==========================================

  // Lee los cambios pendientes al momento de mandar, no al programarse. Antes
  // recibía una foto tomada en el primer cambio y el efecto que la disparaba
  // solo corría cuando hasChanges pasaba de false a true: lo que se escribía
  // después de la primera tecla no viajaba, y la respuesta del servidor lo
  // borraba de la pantalla.
  const debouncedAutoSave = useMemo(() => {
    const run = debounce(
      async () => {
        // Un reintento programado puede disparar después de que se apagó el
        // auto-guardado: se vuelve a mirar acá, al momento de mandar.
        if (!autoSaveEnabled.current) return

        // De a uno: si dos PATCH viajan juntos y el más nuevo termina primero,
        // el viejo llega último al backend y deja guardado el valor anterior.
        if (inFlight.current) {
          queuedWhileInFlight.current = true
          return
        }

        const changes = { ...pendingChanges.current }
        if (Object.keys(changes).length === 0) return

        const cooldownRemaining = autoSaveBlockedUntil.current - Date.now()
        if (cooldownRemaining > 0) {
          clearTimeout(retryTimer.current)
          retryTimer.current = setTimeout(run, cooldownRemaining + 50)
          return
        }

        // Flatten changes para PATCH
        const patchData = {}
        Object.entries(changes).forEach(([path, value]) => {
          const keys = path.split('.')
          let current = patchData
          keys.forEach((key, index) => {
            if (index === keys.length - 1) {
              current[key] = value
            } else {
              current[key] = current[key] || {}
              current = current[key]
            }
          })
        })

        inFlight.current = true
        const result = await dispatch(autoSaveTheme(patchData))
        inFlight.current = false
        const queued = queuedWhileInFlight.current
        queuedWhileInFlight.current = false

        if (autoSaveTheme.fulfilled.match(result)) {
          autoSaveBlockedUntil.current = 0
          dispatch(clearAutoSaveError())

          Object.entries(changes).forEach(([path, value]) => {
            if (pendingChanges.current[path] === value) {
              delete pendingChanges.current[path]
            }
          })

          // Lo que se escribió mientras viajaba este guardado sale en el próximo.
          if (Object.keys(pendingChanges.current).length > 0 && autoSaveEnabled.current) run()
          return
        }

        if (result.payload?.status === 429) {
          autoSaveBlockedUntil.current = Date.now() + AUTO_SAVE_RETRY_COOLDOWN
          if (autoSaveEnabled.current) run()
          return
        }

        // Otro error: si se escribió algo mientras viajaba, se intenta con eso.
        if (queued && autoSaveEnabled.current) run()
      },
      AUTO_SAVE_DELAY,
      { maxWait: AUTO_SAVE_MAX_WAIT },
    )
    return run
  }, [dispatch])

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveEnabled.current) debouncedAutoSave()
  }, [debouncedAutoSave])

  // Al prender el auto-guardado (o al terminar un guardado manual) se manda lo
  // que haya quedado pendiente.
  // Al apagarlo se cancela lo programado, incluido un reintento por 429.
  useEffect(() => {
    if (!autoSave.enabled) {
      debouncedAutoSave.cancel()
      clearTimeout(retryTimer.current)
      return
    }
    if (!isSaving && Object.keys(pendingChanges.current).length > 0) {
      debouncedAutoSave()
    }
  }, [autoSave.enabled, isSaving, debouncedAutoSave])

  // Cancelar debounce al desmontar
  useEffect(() => {
    return () => {
      debouncedAutoSave.cancel()
      clearTimeout(retryTimer.current)
    }
  }, [debouncedAutoSave])

  // ==========================================
  // ACTUALIZACIONES
  // ==========================================

  const updateField = useCallback(
    (path, value) => {
      pendingChanges.current[path] = value
      dispatch(updateFieldAction({ path, value }))
      scheduleAutoSave()
    },
    [dispatch, scheduleAutoSave],
  )

  const updateSection = useCallback(
    (section, data) => {
      Object.entries(data).forEach(([key, value]) => {
        pendingChanges.current[`${section}.${key}`] = value
      })
      dispatch(updateSectionAction({ section, data }))
      scheduleAutoSave()
    },
    [dispatch, scheduleAutoSave],
  )

  // ==========================================
  // GUARDADO MANUAL
  // ==========================================

  const save = useCallback(() => {
    debouncedAutoSave.cancel()
    clearTimeout(retryTimer.current)
    pendingChanges.current = {}
    return dispatch(saveTheme(theme))
  }, [dispatch, theme, debouncedAutoSave])

  // ==========================================
  // PREVIEW SYSTEM
  // ==========================================

  const togglePreview = useCallback(() => {
    if (!preview.active) {
      // Activar: guardar config actual como preview
      dispatch(setPreviewData(theme))
    }
    dispatch(togglePreviewMode())
  }, [dispatch, preview.active, theme])

  // ==========================================
  // GESTIÓN DE IMÁGENES
  // ==========================================

  const uploadImage = useCallback(
    ({ file, type, fieldPath }) => {
      return dispatch(uploadThemeImage({ file, type, fieldPath }))
        .unwrap()
        .then(result => result?.image || result)
    },
    [dispatch],
  )

  // ==========================================
  // IMPORT/EXPORT
  // ==========================================

  const exportTheme = useCallback(
    filename => {
      return dispatch(exportThemeToFile(filename))
    },
    [dispatch],
  )

  const importTheme = useCallback(
    themeData => {
      return dispatch(importThemeFromFile(themeData))
    },
    [dispatch],
  )

  // ==========================================
  // UTILIDADES
  // ==========================================

  // Lo pendiente es anterior al reset: si se mandara después (un reintento por
  // 429, un debounce en curso), deshacería el reset.
  const reset = useCallback(() => {
    debouncedAutoSave.cancel()
    clearTimeout(retryTimer.current)
    pendingChanges.current = {}
    return dispatch(resetThemeToDefault())
  }, [dispatch, debouncedAutoSave])

  const toggleMaintenance = useCallback(
    enabled => {
      return dispatch(toggleMaintenanceMode(enabled))
    },
    [dispatch],
  )

  const validate = useCallback(
    config => {
      return dispatch(validateThemeConfig(config || theme))
    },
    [dispatch, theme],
  )

  const setSection = useCallback(
    section => {
      dispatch(setActiveSection(section))
    },
    [dispatch],
  )

  const discard = useCallback(() => {
    debouncedAutoSave.cancel()
    clearTimeout(retryTimer.current)
    dispatch(discardChanges())
    pendingChanges.current = {}
  }, [dispatch, debouncedAutoSave])

  const clear = useCallback(() => {
    dispatch(clearError())
  }, [dispatch])

  // ==========================================
  // RETORNO
  // ==========================================

  return {
    // Data
    theme,
    activeTheme,
    originalTheme,
    hasChanges,

    // Status
    isLoading,
    isSaving,
    error,
    status,

    // Auto-save
    autoSaveEnabled: autoSave.enabled,
    lastSaved: autoSave.lastSaved,
    autoSaveError: autoSave.error,
    toggleAutoSave: () => dispatch(toggleAutoSave()),

    // Preview
    previewMode: preview.active,
    togglePreview,
    clearPreview: () => dispatch(clearPreview()),

    // Navigation
    activeSection,
    setSection,

    // Actions
    updateField,
    updateSection,
    save,
    discard,
    reset,

    // Images
    uploadImage,

    // Import/Export
    exportTheme,
    importTheme,

    // Advanced
    toggleMaintenance,
    validate,

    // Utils
    refresh: loadTheme,
    clearError: clear,
  }
}

// ==========================================
// HOOK ESPECIALIZADOS
// ==========================================
