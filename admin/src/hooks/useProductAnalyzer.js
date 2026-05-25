// 📁 src/hooks/useProductAnalyzer.js
import { useState, useCallback } from 'react'
import api from '@utils/axiosConfig'

const MAX_IMAGE_SIZE_MB = 8

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]

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

      const formData = new FormData()

      // Debe coincidir con el nombre esperado por multer/backend.
      // Si tu backend usa upload.single('image'), cambiar a 'image'.
      // Si usa upload.array('images'), mantener 'images'.
      formData.append('images', imageFile)

      try {
        const response = await api.post('/product/analyze-visual', formData, {
          withCredentials: true,

          // No seteamos Content-Type manualmente.
          // Axios/browser agrega multipart/form-data con boundary.
          headers: {
            Accept: 'application/json',
          },
        })

        const resData = response.data

        if (!resData?.success) {
          throw new Error(resData?.message || 'La IA no pudo clasificar el producto')
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

  return {
    iaResult,
    dynamicFields,
    analyzeImage,
    resetIa,
    loading,
    error,
  }
}