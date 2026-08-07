// 📁 admin/src/services/aiAgentDashboardService.js
// Dashboard operativo del Agente IA: métricas, prueba de mensaje y estado de
// las campañas de recuperación de carrito. Endpoints admin de /ai-agent/*.
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data ?? response?.data

export const getAiAgentMetrics = async () => {
  const response = await api.get('/ai-agent/metrics')
  return unwrap(response)
}

// Envía un mensaje de prueba al agente (canal webchat) y devuelve su respuesta.
// Sirve para verificar la configuración sin depender de WhatsApp.
export const testAiAgentMessage = async message => {
  const response = await api.post('/ai-agent/test-message', { message })
  return unwrap(response)
}

export const getAiCartRecoveries = async () => {
  const response = await api.get('/ai-agent/cart-recoveries')
  return unwrap(response)
}

export default { getAiAgentMetrics, testAiAgentMessage, getAiCartRecoveries }
