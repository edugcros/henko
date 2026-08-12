// 📁 admin/src/services/emailDomainService.js
//
// Dominio de envío propio del comercio.
// Backend: backend/src/controller/tenantSettingsCtrl.js
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getEmailDomain = async () => {
  const response = await api.get('/tenants/me/email-domain')
  return unwrap(response)
}

export const saveEmailDomain = async fromAddress => {
  const response = await api.put('/tenants/me/email-domain', { fromAddress })
  return unwrap(response)
}

export const verifyEmailDomain = async () => {
  const response = await api.post('/tenants/me/email-domain/verify')
  return unwrap(response)
}

export const deleteEmailDomain = async () => {
  const response = await api.delete('/tenants/me/email-domain')
  return unwrap(response)
}

export default {
  getEmailDomain,
  saveEmailDomain,
  verifyEmailDomain,
  deleteEmailDomain,
}
