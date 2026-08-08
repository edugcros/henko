import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getPaymentConfig = async () => {
  const response = await api.get('/payment-config')
  return unwrap(response)
}

export const updatePaymentConfig = async payload => {
  const response = await api.put('/payment-config', payload)
  return unwrap(response)
}

export default { getPaymentConfig, updatePaymentConfig }
