// 📁 admin/src/services/aiAgentDashboardService.js
import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data ?? response?.data

export const getAiAgentMetrics = async (period = '30d') => {
  const response = await api.get('/ai-agent/metrics', {
    params: period && period !== 'all' ? { period } : {},
  })
  return unwrap(response)
}

export const testAiAgentMessage = async message => {
  const response = await api.post('/ai-agent/test-message', { message })
  return unwrap(response)
}

export const getAiCartRecoveries = async ({
  page = 1,
  limit = 25,
  status,
} = {}) => {
  const params = { page, limit }
  if (status) params.status = status
  const response = await api.get('/ai-agent/cart-recoveries', { params })
  return unwrap(response)
}

export default { getAiAgentMetrics, testAiAgentMessage, getAiCartRecoveries }
