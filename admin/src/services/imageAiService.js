import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const removeBackground = async file => {
  const formData = new FormData()
  formData.append('image', file)

  const response = await api.post('/image-ai/remove-background', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
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
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90000,
  })

  return unwrap(response)
}

export default { removeBackground, generateVariation }
