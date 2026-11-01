import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const removeBackground = async file => {
  const formData = new FormData()
  formData.append('image', file)

  const response = await api.post('/image-ai/remove-background', formData, {
    // Dejar que el navegador/Axios asigne el boundary real de multipart.
    timeout: 60000,
  })

  return unwrap(response)
}

export const generateVariation = async (file, prompt, purpose) => {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('prompt', prompt)
  if (purpose) formData.append('purpose', purpose)

  const response = await api.post('/image-ai/generate-variation', formData, {
    // Dejar que el navegador/Axios asigne el boundary real de multipart.
    timeout: 180000,
  })

  return unwrap(response)
}

/**
 * Producto recortado sobre un fondo de estudio armado en el servidor, sin IA
 * generativa: no usa cupo y funciona aunque Gemini no tenga cuota.
 */
export const createStudioBackground = async (file, { style, color, purpose } = {}) => {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('style', style)
  if (color) formData.append('color', color)
  if (purpose) formData.append('purpose', purpose)

  const response = await api.post('/image-ai/studio-background', formData, {
    // Mismo costo que quitar el fondo: el recorte local es lo que tarda.
    timeout: 60000,
  })

  return unwrap(response)
}

/** Qué está disponible: si la IA generativa puede generar ahora mismo. */
export const getImageAiStatus = async () => {
  const response = await api.get('/image-ai/status')
  return unwrap(response)
}

export default { removeBackground, generateVariation, createStudioBackground, getImageAiStatus }
