// El catálogo de precios, que es la única fuente para las pantallas.
//
// Existe para que ninguna pantalla vuelva a tener un precio escrito a mano. Lo
// que devuelve es exactamente lo que el backend usa para cobrar, así que no
// pueden separarse.

import api from '@utils/axiosConfig'

const unwrap = response => response?.data?.data || response?.data

/**
 * @returns {Promise<{currency: string, plans: Array<{plan, monthlyPriceArs, currency, source}>}>}
 */
export const getPlanCatalog = async () => {
  const response = await api.get('/subscriptions/plans')
  return unwrap(response)
}

/** El precio de un plan, o null si es a medida. */
export const findPlanPrice = (catalog, plan) => {
  const row = (catalog?.plans || []).find(item => item.plan === plan)
  return row ? row.monthlyPriceArs : null
}

export default { getPlanCatalog, findPlanPrice }
