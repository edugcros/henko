// 📁 admin/src/services/aiInsightService.js
// Motor de diagnóstico (Bloque 8.4-8.9). Se conecta a /insights/* —
// autenticado como admin, tenant del token. Mismo patrón que
// aiLearningSuggestionService.js.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data ?? response?.data

export const listInsights = async params => {
  const response = await api.get('/insights', { params })
  return unwrap(response)
}

export const acknowledgeInsight = async id => {
  const response = await api.post(`/insights/${id}/acknowledge`, {})
  return unwrap(response)
}

export const dismissInsight = async (id, reason = '') => {
  const response = await api.post(`/insights/${id}/dismiss`, { reason })
  return unwrap(response)
}

export const archiveInsight = async id => {
  const response = await api.post(`/insights/${id}/archive`, {})
  return unwrap(response)
}

// Bloque 8.8 (alcance acotado, solo customer_inactivity): arma el texto, no
// envía nada — el admin lo revisa/edita antes de confirmar con sendReactivationMessage.
export const previewReactivationMessage = async id => {
  const response = await api.post(
    `/insights/${id}/reactivation-message/preview`,
    {},
  )
  return unwrap(response)
}

export const sendReactivationMessage = async (id, message) => {
  const response = await api.post(`/insights/${id}/reactivation-message/send`, {
    message,
  })
  return unwrap(response)
}

export default {
  listInsights,
  acknowledgeInsight,
  dismissInsight,
  archiveInsight,
  previewReactivationMessage,
  sendReactivationMessage,
}
