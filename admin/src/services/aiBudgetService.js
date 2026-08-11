// 📁 admin/src/services/aiBudgetService.js
//
// Consumo de IA del mes y credencial propia del comercio (BYOK).
// Backend: backend/src/controller/aiBudgetCtrl.js
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getAiBudget = async () => {
  const response = await api.get('/ai-agent/budget')
  return unwrap(response)
}

/**
 * La key viaja una sola vez y nunca vuelve: el backend la guarda cifrada y
 * el snapshot solo informa si hay una configurada.
 */
export const saveAiCredentials = async geminiApiKey => {
  const response = await api.put('/ai-agent/credentials', { geminiApiKey })
  return unwrap(response)
}

export const deleteAiCredentials = async () => {
  const response = await api.delete('/ai-agent/credentials')
  return unwrap(response)
}

export default { getAiBudget, saveAiCredentials, deleteAiCredentials }
