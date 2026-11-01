// 📁 marketIntelligenceApi.js
//
// Capa de acceso a la API del análisis de mercado
// (backend/src/routes/marketintelligenceRoutes.js, montada en
// /api/market-intelligence).

import api from '@utils/axiosConfig'

const BASE_URL = '/market-intelligence'

/**
 * Ejecuta un análisis de demanda de mercado para un producto.
 *
 * Ojo: cada llamada con forceRefresh=true consume cuota de IA y del buscador
 * de precios. Sin forceRefresh, el backend sirve desde cache (TTL 24h) — que
 * es el comportamiento que querés por default en la UI.
 *
 * @param {Object} params
 * @param {string} params.product
 * @param {string} [params.country='AR']
 * @param {boolean} [params.forceRefresh=false]
 * @param {Object|null} [params.costs] - costos tipeados por el comerciante
 * @param {string|null} [params.productId] - producto del catálogo: el backend
 *   completa el costo de la ficha y la comisión medida en las ventas, y
 *   `costs` pasa a ser lo que el comerciante quiere sobrescribir.
 */
export const analyzeProduct = async ({
  product,
  country = 'AR',
  forceRefresh = false,
  costs = null,
  productId = null,
}) => {
  const { data } = await api.post(`${BASE_URL}/analyze`, {
    product,
    country,
    forceRefresh,
    costs,
    ...(productId ? { productId } : {}),
  })
  return data
}

export default { analyzeProduct }
