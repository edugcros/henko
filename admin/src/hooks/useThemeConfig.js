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
  selectThemeHistory,
  selectIsHistoryLoading,

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
  createThemePreview,
  activateThemePreview,
  fetchThemeHistory,
  rollbackToVersion,
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
  const history = useSelector(selectThemeHistory)
  const isHistoryLoading = useSelector(selectIsHistoryLoading)
  const status = useSelector(selectThemeStatus)

  // Refs para auto-save
  const pendingChanges = useRef({})
  const lastChangeTime = useRef(0)
  const autoSaveBlockedUntil = useRef(0)

  // ==========================================
  // CARGA INICIAL
  // ==========================================

  const loadTheme = useCallback(() => {
    return dispatch(fetchTheme())
  }, [dispatch])

  useEffect(() => {
    if (!theme && !isLoading) {
      loadTheme()
    }
  }, [theme, isLoading, loadTheme])

  // ==========================================
  // ACTUALIZACIONES
  // ==========================================

  const updateField = useCallback(
    (path, value) => {
      pendingChanges.current[path] = value
      lastChangeTime.current = Date.now()
      dispatch(updateFieldAction({ path, value }))
    },
    [dispatch],
  )

  const updateSection = useCallback(
    (section, data) => {
      Object.entries(data).forEach(([key, value]) => {
        pendingChanges.current[`${section}.${key}`] = value
      })
      dispatch(updateSectionAction({ section, data }))
    },
    [dispatch],
  )

  // ==========================================
  // AUTO-SAVE CON DEBOUNCE
  // ==========================================

  const debouncedAutoSave = useMemo(
    () =>
      debounce(
        async changes => {
          if (Object.keys(changes).length === 0) return
          if (Date.now() < autoSaveBlockedUntil.current) return

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

          const result = await dispatch(autoSaveTheme(patchData))

          if (autoSaveTheme.fulfilled.match(result)) {
            autoSaveBlockedUntil.current = 0
            dispatch(clearAutoSaveError())

            Object.entries(changes).forEach(([path, value]) => {
              if (pendingChanges.current[path] === value) {
                delete pendingChanges.current[path]
              }
            })
            return
          }

          if (result.payload?.status === 429) {
            autoSaveBlockedUntil.current = Date.now() + AUTO_SAVE_RETRY_COOLDOWN
          }
        },
        AUTO_SAVE_DELAY,
        { maxWait: AUTO_SAVE_MAX_WAIT },
      ),
    [dispatch],
  )

  // Trigger auto-save cuando hay cambios
  useEffect(() => {
    if (hasChanges && autoSave.enabled && !isSaving) {
      const cooldownRemaining = autoSaveBlockedUntil.current - Date.now()

      if (cooldownRemaining > 0) {
        const retryTimer = setTimeout(() => {
          debouncedAutoSave({ ...pendingChanges.current })
        }, cooldownRemaining + 50)

        return () => clearTimeout(retryTimer)
      }

      debouncedAutoSave({ ...pendingChanges.current })
    }
  }, [hasChanges, autoSave.enabled, isSaving, debouncedAutoSave])

  // Cancelar debounce al desmontar
  useEffect(() => {
    return () => debouncedAutoSave.cancel()
  }, [debouncedAutoSave])

  // ==========================================
  // GUARDADO MANUAL
  // ==========================================

  const save = useCallback(() => {
    debouncedAutoSave.cancel()
    pendingChanges.current = {}
    return dispatch(saveTheme(theme))
  }, [dispatch, theme, debouncedAutoSave])

  // ==========================================
  // PREVIEW SYSTEM
  // ==========================================

  const createPreview = useCallback(() => {
    return dispatch(createThemePreview(theme))
  }, [dispatch, theme])

  const activatePreview = useCallback(
    previewId => {
      return dispatch(activateThemePreview(previewId))
    },
    [dispatch],
  )

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
  // VERSIONADO
  // ==========================================

  const loadHistory = useCallback(
    limit => {
      return dispatch(fetchThemeHistory(limit))
    },
    [dispatch],
  )

  const rollback = useCallback(
    version => {
      return dispatch(rollbackToVersion(version))
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

  const reset = useCallback(() => {
    return dispatch(resetThemeToDefault())
  }, [dispatch])

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
    dispatch(discardChanges())
    pendingChanges.current = {}
  }, [dispatch])

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
    previewId: preview.previewId,
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

    // Versioning
    loadHistory,
    rollback,
    history,
    isHistoryLoading,

    // Import/Export
    exportTheme,
    importTheme,

    // Advanced
    createPreview,
    activatePreview,
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

export const useThemeSection = sectionName => {
  const dispatch = useDispatch()
  const section = useSelector(selectThemeSection(sectionName))
  const theme = useSelector(selectTheme)

  const update = useCallback(
    data => {
      dispatch(updateSectionAction({ section: sectionName, data }))
    },
    [dispatch, sectionName],
  )

  const updateField = useCallback(
    (field, value) => {
      dispatch(
        updateFieldAction({
          path: `${sectionName}.${field}`,
          value,
        }),
      )
    },
    [dispatch, sectionName],
  )

  return {
    data: section || {},
    theme,
    update,
    updateField,
  }
}

export const useThemeStatus = () => useSelector(selectThemeStatus)
