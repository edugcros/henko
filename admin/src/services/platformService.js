import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

export const getPlatformMarginReport = async period => {
  const response = await api.get('/platform/margin', {
    params: period ? { period } : undefined,
  })

  return unwrap(response)
}

export const getPlatformAiSpend = async period => {
  const response = await api.get('/platform/ai-spend', {
    params: period ? { period } : undefined,
  })

  return unwrap(response)
}

/**
 * Mueve el techo de gasto. `tokens: null` quita el override y devuelve el mando
 * a la variable de entorno. Responde con el reporte ya actualizado.
 */
export const updatePlatformAiBudget = async ({ tokens, reason }) => {
  const response = await api.put('/platform/ai-spend/budget', {
    tokens,
    reason,
  })

  return unwrap(response)
}

export default {
  getPlatformMarginReport,
  getPlatformAiSpend,
  updatePlatformAiBudget,
}
