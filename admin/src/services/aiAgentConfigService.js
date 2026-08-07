// 📁 admin/src/services/aiAgentConfigService.js
// Configuración del Agente IA por tenant. Se conecta a /ai-agent/config
// (GET/PUT), autenticado como admin — el tenant sale del token.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getAiAgentConfig = async () => {
  const response = await api.get('/ai-agent/config')
  return unwrap(response)
}

export const updateAiAgentConfig = async payload => {
  const response = await api.put('/ai-agent/config', payload)
  return unwrap(response)
}

export default { getAiAgentConfig, updateAiAgentConfig }
