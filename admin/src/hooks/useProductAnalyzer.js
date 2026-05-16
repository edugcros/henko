import { useState, useCallback } from 'react'
import api from '@utils/axiosConfig'

export default function useProductAnalyzer() {
  const [iaResult, setIaResult] = useState(null)
  const [dynamicFields, setDynamicFields] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const detectType = (value) => {
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    return 'string'
  }

  const generateDynamicFields = useCallback((result) => {
    if (!result || !result.atributos) return []
    
    return Object.entries(result.atributos).map(([name, value]) => ({
      name,
      value,
      type: detectType(value)
    }))
  }, [])

  const analyzeImage = useCallback(async (file) => {
    const imageFile = file?.originFileObj || file
    if (!imageFile) {
      setError('No se seleccionó una imagen válida')
      return
    }

    setLoading(true)
    setError(null)
    
    const formData = new FormData()
    formData.append('images', imageFile)

    try {
      // 🚨 CAMBIO CLAVE: Recibimos el objeto completo de Axios
      const response = await api.post('/product/analyze-visual', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })

      // Axios solo llega aquí si el status es 2xx
      // El JSON de tu backend está en response.data
      const resData = response.data

      if (resData?.success) {
        setIaResult(resData?.data)
        setDynamicFields(generateDynamicFields(resData?.data))
      } else {
        throw new Error(resData.message || 'La IA no pudo clasificar el producto')
      }
    } catch (err) {
      console.error("AI Analyzer Error:", err)
      
      // Manejo robusto de errores de Axios
      const serverMessage = err.response?.data?.message 
      const fallbackMessage = err.message || 'Error de conexión con IA'
      
      setError(serverMessage || fallbackMessage)
    } finally {
      setLoading(false)
    }
  }, [generateDynamicFields])

  const resetIa = () => {
    setIaResult(null)
    setDynamicFields([])
    setError(null)
  }

  return {
    iaResult,
    dynamicFields,
    analyzeImage,
    resetIa,
    loading,
    error
  }
}