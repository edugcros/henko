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

/** Precios vigentes de los planes, con su historial de cambios. */
export const getPlanPrices = async () => {
  const response = await api.get('/platform/plan-prices')
  return unwrap(response)
}

/**
 * Cambia el precio de un plan, en pesos. `priceArs: null` quita el override y
 * devuelve el mando al valor por defecto. Responde con el catálogo actualizado.
 */
export const updatePlanPrice = async ({ plan, priceArs, reason }) => {
  const response = await api.put('/platform/plan-prices', {
    plan,
    priceArs,
    reason,
  })

  return unwrap(response)
}

export default {
  getPlatformMarginReport,
  getPlatformAiSpend,
  updatePlatformAiBudget,
  getPlanPrices,
  updatePlanPrice,
}
