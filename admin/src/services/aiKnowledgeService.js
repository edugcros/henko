// 📁 admin/src/services/aiKnowledgeService.js
// CRUD de la base de conocimiento del Agente IA. Se conecta a
// /ai-agent/knowledge/* — autenticado como admin, tenant del token.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data ?? response?.data
const unwrapFull = response => response?.data ?? {}

export const listKnowledge = async params => {
  const res = await api.get('/ai-agent/knowledge', { params })
  const body = unwrapFull(res)
  return { items: body.data || [], meta: body.meta || {} }
}

export const createKnowledgeItem = async payload => {
  const response = await api.post('/ai-agent/knowledge', payload)
  return unwrap(response)
}

export const updateKnowledgeItem = async (id, payload) => {
  const response = await api.put(`/ai-agent/knowledge/${id}`, payload)
  return unwrap(response)
}

export const approveKnowledgeItem = async id => {
  const response = await api.patch(`/ai-agent/knowledge/${id}/approve`)
  return unwrap(response)
}

export const deleteKnowledgeItem = async id => {
  const response = await api.delete(`/ai-agent/knowledge/${id}`)
  return unwrap(response)
}
