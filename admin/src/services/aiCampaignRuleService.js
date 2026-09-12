// 📁 admin/src/services/aiCampaignRuleService.js
// CRUD de reglas de campaña del Agente IA. Se conecta a
// /ai-agent/campaign-rules/* — autenticado como admin, tenant del token.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data ?? response?.data

export const listCampaignRules = async params => {
  const response = await api.get('/ai-agent/campaign-rules', { params })

  // El backend manda las reglas en `data` y, al lado, si la recuperación de
  // carritos puede correr. Se devuelven las dos cosas: una regla activa con el
  // canal de WhatsApp apagado no hace nada, y la pantalla tiene que poder
  // decirlo.
  return {
    items: unwrap(response) || [],
    readiness: response?.data?.readiness || null,
  }
}

export const upsertCampaignRule = async (payload, id) => {
  const url = id ? `/ai-agent/campaign-rules/${id}` : '/ai-agent/campaign-rules'
  const response = await api.put(url, payload)
  return unwrap(response)
}

export const deleteCampaignRule = async id => {
  const response = await api.delete(`/ai-agent/campaign-rules/${id}`)
  return unwrap(response)
}
