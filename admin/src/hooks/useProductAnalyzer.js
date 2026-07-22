// 📁 src/hooks/useProductAnalyzer.js
import { useState, useCallback } from 'react'
import api from '@utils/axiosConfig'
import {
  MAX_IMAGE_SIZE_MB,
  SUPPORTED_IMAGE_TYPES,
} from '../constants/imageUpload'

const detectType = value => {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

const normalizeImageFile = file => {
  return file?.originFileObj || file?.file || file
}

const validateImageFile = file => {
  if (!file) {
    return 'No se seleccionó una imagen válida'
  }

  if (!(file instanceof File || file instanceof Blob)) {
    return 'El archivo seleccionado no es una imagen válida'
  }

  if (file.type && !SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    return 'Formato de imagen no soportado. Usá JPG, PNG, WEBP, HEIC o HEIF.'
  }

  const sizeMb = file.size / 1024 / 1024

  if (sizeMb > MAX_IMAGE_SIZE_MB) {
    return `La imagen supera el máximo permitido de ${MAX_IMAGE_SIZE_MB}MB`
  }

  return null
}

const extractServerMessage = error => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.response?.data?.code ||
    error?.message ||
    'Error de conexión con IA'
  )
}

export default function useProductAnalyzer() {
  const [iaResult, setIaResult] = useState(null)
  const [dynamicFields, setDynamicFields] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const generateDynamicFields = useCallback(result => {
    if (!result || !result.atributos || typeof result.atributos !== 'object') {
      return []
    }

    return Object.entries(result.atributos)
      .filter(([name]) => Boolean(name))
      .map(([name, value]) => ({
        name,
        value: value ?? '',
        type: detectType(value),
      }))
  }, [])

  const analyzeImage = useCallback(
    async file => {
      const imageFile = normalizeImageFile(file)
      const validationError = validateImageFile(imageFile)

      if (validationError) {
        setError(validationError)
        setIaResult(null)
        setDynamicFields([])
        return null
      }

      setLoading(true)
      setError(null)

      try {
        const formData = new FormData()

        // IMPORTANTE:
        // Backend usa uploadPhoto.single('images')
        // Por eso el campo debe llamarse exactamente "images".
        formData.append('images', imageFile, imageFile.name || 'product-image')

        const response = await api.post('/product/analyze-visual', formData, {
          withCredentials: true,

          // No enviar Content-Type manual.
          // El navegador/Axios debe generar multipart/form-data con boundary.
          headers: {
            Accept: 'application/json',
          },

          // Flag útil para que axiosConfig borre application/json si lo tenés como default.
          isMultipart: true,
        })

        const resData = response.data

        if (!resData?.success) {
          throw new Error(
            resData?.message || 'La IA no pudo clasificar el producto',
          )
        }

        const data = resData?.data || null

        setIaResult(data)
        setDynamicFields(generateDynamicFields(data))

        return data
      } catch (err) {
        console.error('AI Analyzer Error:', err)

        const message = extractServerMessage(err)

        setError(message)
        setIaResult(null)
        setDynamicFields([])

        return null
      } finally {
        setLoading(false)
      }
    },
    [generateDynamicFields],
  )

  const resetIa = useCallback(() => {
    setIaResult(null)
    setDynamicFields([])
    setError(null)
  }, [])

  // Carga un análisis que la IA ya calculó (por ejemplo, uno que el
  // agente autónomo dejó guardado en el job) sin volver a llamar a la
  // IA. Mismo resultado final que analyzeImage, sin gastar una consulta.
  const hydrateAnalysis = useCallback(
    result => {
      if (!result || typeof result !== 'object') return null

      setError(null)
      setIaResult(result)
      setDynamicFields(generateDynamicFields(result))

      return result
    },
    [generateDynamicFields],
  )

  return {
    iaResult,
    dynamicFields,
    analyzeImage,
    hydrateAnalysis,
    resetIa,
    loading,
    error,
  }
}
