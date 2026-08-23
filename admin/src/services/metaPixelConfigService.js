import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getMetaPixelConfig = async () => {
  const response = await api.get('/meta-pixel-config')
  return unwrap(response)
}

export const updateMetaPixelConfig = async payload => {
  const response = await api.put('/meta-pixel-config', payload)
  return unwrap(response)
}

export default { getMetaPixelConfig, updateMetaPixelConfig }
