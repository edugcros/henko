/**
 * shoppingSource.js
 *
 * Precios y ofertas reales del mercado, vía un proveedor de scraping.
 *
 * POR QUÉ UN ADAPTER Y NO UNA INTEGRACIÓN DIRECTA:
 * Este mercado de proveedores es inestable. En un benchmark de agosto 2026,
 * solo 3 de 16 proveedores tenían un camino funcional de búsqueda +
 * producto, y Google cerró la página clásica de ofertas por product_id que
 * todos ofrecían. Acoplar el análisis a un proveedor puntual significa
 * reescribir esta capa cada vez que uno se cae o cambia su API.
 *
 * El default es Scrape.do (~$1.16/1K requests, el mejor ratio
 * precio/confiabilidad medido). Cambiar de proveedor es implementar un
 * adapter nuevo y cambiar SHOPPING_PROVIDER — nada más de este paquete se
 * entera.
 *
 * Variables de entorno:
 *   SHOPPING_PROVIDER   'scrapedo' (default) | 'serpapi' | 'none'
 *   SCRAPEDO_API_KEY
 *   SERPAPI_API_KEY
 */

import axios from 'axios'
import logger from '../../../../config/logger.js'

const REQUEST_TIMEOUT_MS = 20000
const MAX_OFFERS = 40

const GOOGLE_DOMAIN_BY_COUNTRY = {
  AR: { domain: 'google.com.ar', gl: 'ar', hl: 'es' },
  MX: { domain: 'google.com.mx', gl: 'mx', hl: 'es' },
  CL: { domain: 'google.cl', gl: 'cl', hl: 'es' },
  CO: { domain: 'google.com.co', gl: 'co', hl: 'es' },
  UY: { domain: 'google.com.uy', gl: 'uy', hl: 'es' },
  PE: { domain: 'google.com.pe', gl: 'pe', hl: 'es' },
  BR: { domain: 'google.com.br', gl: 'br', hl: 'pt' },
}

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {string} params.country - ISO-2
 * @returns {Promise<ShoppingSignals>}
 *
 * @typedef {Object} ShoppingSignals
 * @property {boolean} available
 * @property {string} provider
 * @property {number} offerCount
 * @property {number} merchantCount     - vendedores únicos
 * @property {Object} priceStats        - min, p25, median, p75, max, currency
 * @property {Array} offers             - muestra para mostrar en el panel
 */
export async function getShoppingSignals({ product, country }) {
  const provider = (process.env.SHOPPING_PROVIDER || 'scrapedo').trim().toLowerCase()

  if (provider === 'none') {
    return { available: false, reason: 'NO_DISPONIBLE: SHOPPING_PROVIDER deshabilitado' }
  }

  const locale = GOOGLE_DOMAIN_BY_COUNTRY[country]
  if (!locale) {
    return { available: false, reason: `NO_DISPONIBLE: país ${country} sin dominio de Google mapeado` }
  }

  const adapter = ADAPTERS[provider]
  if (!adapter) {
    return { available: false, reason: `NO_DISPONIBLE: proveedor "${provider}" no implementado` }
  }

  const offers = await adapter({ product, locale })

  if (!offers) {
    return { available: false, reason: `NO_DISPONIBLE: ${provider} no devolvió resultados` }
  }

  // 0 ofertas es un DATO (nadie lo vende online en ese mercado), no una falla.
  if (offers.length === 0) {
    return {
      available: true,
      provider,
      offerCount: 0,
      merchantCount: 0,
      priceStats: null,
      offers: [],
    }
  }

  return {
    available: true,
    provider,
    offerCount: offers.length,
    merchantCount: new Set(offers.map(o => o.merchant).filter(Boolean)).size,
    priceStats: computePriceStats(offers),
    offers: offers.slice(0, 10),
  }
}

// ─── Adapters por proveedor ──────────────────────────────

const ADAPTERS = {
  /**
   * Scrape.do — endpoint de Google Shopping.
   * Docs: https://scrape.do/documentation/
   */
  async scrapedo({ product, locale }) {
    const apiKey = String(process.env.SCRAPEDO_API_KEY || '').trim()
    if (!apiKey) {
      logger.warn('[shoppingSource] SCRAPEDO_API_KEY no configurada')
      return null
    }

    try {
      const { data } = await axios.get('https://api.scrape.do/plugin/google/shopping', {
        params: {
          token: apiKey,
          q: product,
          google_domain: locale.domain,
          gl: locale.gl,
          hl: locale.hl,
        },
        timeout: REQUEST_TIMEOUT_MS,
      })

      return normalizeOffers(data?.shopping_results || data?.results || [])
    } catch (error) {
      logger.warn('[shoppingSource] scrape.do falló', {
        status: error?.response?.status,
        message: error.message,
      })
      return null
    }
  },

  /**
   * SerpApi — alternativa cara (~21x scrape.do) pero con el output más
   * completo. Se mantiene como escape si scrape.do falla o cambia.
   */
  async serpapi({ product, locale }) {
    const apiKey = String(process.env.SERPAPI_API_KEY || '').trim()
    if (!apiKey) return null

    try {
      const { data } = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_shopping',
          q: product,
          google_domain: locale.domain,
          gl: locale.gl,
          hl: locale.hl,
          api_key: apiKey,
        },
        timeout: REQUEST_TIMEOUT_MS,
      })

      return normalizeOffers(data?.shopping_results || [])
    } catch (error) {
      logger.warn('[shoppingSource] serpapi falló', {
        status: error?.response?.status,
        message: error.message,
      })
      return null
    }
  },
}

// ─── Normalización ───────────────────────────────────────

/**
 * Los proveedores devuelven formas parecidas pero no idénticas, y el precio
 * a veces viene como string con símbolo de moneda. Todo lo que entra al
 * scoring pasa por acá.
 */
function normalizeOffers(rawResults) {
  return rawResults
    .slice(0, MAX_OFFERS)
    .map(item => {
      const price = parsePrice(item.extracted_price ?? item.price)
      if (price === null) return null

      return {
        title: String(item.title || '').slice(0, 200),
        price,
        currency: item.currency || detectCurrency(item.price) || null,
        merchant: item.source || item.merchant || item.seller || null,
        rating: numberOrNull(item.rating),
        reviewCount: numberOrNull(item.reviews),
        link: item.link || item.product_link || null,
      }
    })
    .filter(Boolean)
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  // "$ 189.999,00" (AR) y "$189,999.00" (US) conviven en los resultados.
  const cleaned = value.replace(/[^\d.,]/g, '')
  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  // El separador decimal es el que aparece más a la derecha.
  let normalized
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = cleaned.replace(/,/g, '')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function detectCurrency(value) {
  if (typeof value !== 'string') return null
  if (value.includes('ARS') || value.includes('$')) return 'ARS'
  if (value.includes('R$')) return 'BRL'
  if (value.includes('€')) return 'EUR'
  return null
}

function numberOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Percentiles, no promedio.
 *
 * El promedio de precios se distorsiona con un solo outlier (un accesorio
 * barato o un pack mayorista caro mezclado en los resultados). La mediana y
 * los cuartiles describen dónde está realmente el mercado.
 */
function computePriceStats(offers) {
  const prices = offers.map(o => o.price).sort((a, b) => a - b)

  return {
    min: prices[0],
    p25: percentile(prices, 0.25),
    median: percentile(prices, 0.5),
    p75: percentile(prices, 0.75),
    max: prices[prices.length - 1],
    currency: offers.find(o => o.currency)?.currency || null,
    sampleSize: prices.length,
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}
