import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getPlatformMarginReport = async period => {
  const response = await api.get('/platform/margin', {
    params: period ? { period } : undefined,
  })

  return unwrap(response)
}

export default { getPlatformMarginReport }
