// 📁 pricingApi.js
//
// Acceso a la API de Pricing Intelligence.

import api from '@utils/axiosConfig'

const BASE_URL = '/pricing'

/** Política del comercio, o la de fábrica si nunca configuró nada. */
export const getPricingPolicy = async () => {
  const { data } = await api.get(`${BASE_URL}/policy`)
  return data
}

/** Guarda los límites del comercio. */
export const updatePricingPolicy = async policy => {
  const { data } = await api.put(`${BASE_URL}/policy`, policy)
  return data
}

/**
 * Indicadores y, si hay señales que lo justifiquen, recomendación de precio.
 *
 * Los indicadores llegan siempre y salen gratis. La recomendación solo corre
 * cuando el producto tiene alguna señal — o con force, que gasta una llamada
 * de IA y por eso debería salir de un click explícito sobre un producto y
 * nunca de un recorrido masivo.
 */
export const recommendPrice = async ({ productId, force = false }) => {
  const { data } = await api.post(`${BASE_URL}/recommend/${productId}`, {
    force,
  })
  return data
}

export default { getPricingPolicy, updatePricingPolicy, recommendPrice }
