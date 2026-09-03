// 📁 marketIntelligenceApi.js
//
// Capa de acceso a la API del Market Intelligence Agent.
//
// TODO: ajustar el import de la instancia axios centralizada al path real
// de tu proyecto (api.js / axiosConfig.js) y ubicar este archivo donde
// tengas el resto de los services/api del frontend.

import api, { fetchCsrfToken } from '@utils/axiosConfig'

const BASE_URL = '/market-intelligence' // TODO: alinear con el prefijo real registrado en server.js

/**
 * Ejecuta un análisis de demanda de mercado para un producto.
 *
 * Ojo: cada llamada con forceRefresh=true consume cuota de Gemini y de la
 * API de MercadoLibre. Sin forceRefresh, el backend sirve desde cache (TTL
 * 24h) — que es el comportamiento que querés por default en la UI.
 *
 * @param {Object} params
 * @param {string} params.product
 * @param {string} [params.country='AR']
 * @param {boolean} [params.forceRefresh=false]
 */
export const analyzeProduct = async ({ product, country = 'AR', forceRefresh = false, costs = null }) => {
  const { data } = await api.post(`${BASE_URL}/analyze`, { product, country, forceRefresh, costs })
  return data
}

/**
 * Historial de análisis previos del tenant.
 * TODO: el endpoint devuelve 501 hasta que se implemente en el controller.
 */
export const getAnalysisHistory = async ({ limit = 20 } = {}) => {
  const { data } = await api.get(`${BASE_URL}/history`, { params: { limit } })
  return data
}

export default { analyzeProduct, getAnalysisHistory }
