// 📁 admin/src/services/aiLearningSuggestionService.js
// Bandeja de aprendizaje del Agente IA (human-in-the-loop). Se conecta a
// /ai-agent/learning-suggestions/* — autenticado como admin, tenant del token.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data ?? response?.data

export const listLearningSuggestions = async params => {
  const response = await api.get('/ai-agent/learning-suggestions', { params })
  return unwrap(response)
}

// Aprobar convierte la sugerencia en conocimiento aprobado. title/content/tags
// son opcionales: si el admin no los edita, el backend usa los de la sugerencia.
export const approveLearningSuggestion = async (id, { title, content, tags } = {}) => {
  const response = await api.post(`/ai-agent/learning-suggestions/${id}/approve`, {
    title,
    content,
    tags,
  })
  return unwrap(response)
}

export const rejectLearningSuggestion = async (id, reason = '') => {
  const response = await api.post(`/ai-agent/learning-suggestions/${id}/reject`, {
    reason,
  })
  return unwrap(response)
}

export const archiveLearningSuggestion = async id => {
  const response = await api.post(`/ai-agent/learning-suggestions/${id}/archive`, {})
  return unwrap(response)
}

export default {
  listLearningSuggestions,
  approveLearningSuggestion,
  rejectLearningSuggestion,
  archiveLearningSuggestion,
}
