/**
 * tavilyClient.js
 *
 * Una sola forma de hablarle a Tavily. Las dos fuentes que lo usan —precios y
 * research— compartían endpoint, credencial, timeout y manejo de error; tener
 * eso duplicado significaba que un cambio de contrato de la API había que
 * acordarse de aplicarlo dos veces.
 *
 * Todo lo ajustable sale por variable de entorno, con el default medido:
 *   TAVILY_API_KEY        credencial (sin ella, las fuentes se reportan caídas)
 *   TAVILY_API_URL        endpoint            (https://api.tavily.com/search)
 *   TAVILY_SEARCH_DEPTH   'basic' | 'advanced'                       (basic)
 *   TAVILY_MAX_RESULTS    resultados por consulta                        (20)
 *   TAVILY_TIMEOUT_MS     corte de la llamada                         (20000)
 *
 * 'basic' cuesta 1 crédito y 'advanced' 2. El plan gratuito da 1.000 al mes.
 */

import axios from 'axios'

import logger from '../../../../config/logger.js'

const num = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const SEARCH_URL =
  String(process.env.TAVILY_API_URL || '').trim() || 'https://api.tavily.com/search'

const SEARCH_DEPTH =
  String(process.env.TAVILY_SEARCH_DEPTH || '').trim() || 'basic'

const MAX_RESULTS = num('TAVILY_MAX_RESULTS', 20)
const TIMEOUT_MS = num('TAVILY_TIMEOUT_MS', 20000)

/**
 * Tavily espera el país escrito, no el código ISO.
 *
 * El filtro `country` es todo o nada: medido sobre seis productos, CINCO
 * consultas volvieron con cero resultados y la sexta con doce precios. Por eso
 * los llamadores lo usan como segundo intento y no como filtro principal.
 */
export const TAVILY_COUNTRY = {
  AR: 'argentina',
  MX: 'mexico',
  CL: 'chile',
  CO: 'colombia',
  UY: 'uruguay',
  PE: 'peru',
  BR: 'brazil',
}

export const hasTavilyKey = () => Boolean(String(process.env.TAVILY_API_KEY || '').trim())

/**
 * Una búsqueda. Devuelve los resultados crudos —title, url, content— o null si
 * la llamada falló, que el llamador distingue de "buscó y no encontró nada".
 *
 * @param {Object} params
 * @param {string} params.query
 * @param {string} [params.language]   ISO-639-1
 * @param {string} [params.country]    nombre del país, ver TAVILY_COUNTRY
 * @param {number} [params.maxResults]
 * @param {string} [params.source]     quién pregunta, solo para el log
 */
export async function tavilySearch({
  query,
  language,
  country,
  maxResults = MAX_RESULTS,
  source = 'tavily',
}) {
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim()

  if (!apiKey) {
    logger.warn(`[${source}] TAVILY_API_KEY no configurada`)
    return null
  }

  try {
    const { data } = await axios.post(
      SEARCH_URL,
      {
        query,
        search_depth: SEARCH_DEPTH,
        max_results: maxResults,
        topic: 'general',
        include_answer: false,
        include_raw_content: false,
        ...(language ? { language } : {}),
        ...(country ? { country } : {}),
      },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: TIMEOUT_MS,
      },
    )

    return Array.isArray(data?.results) ? data.results : []
  } catch (error) {
    logger.warn(`[${source}] Tavily falló`, {
      status: error?.response?.status,
      message: error.message,
    })

    return null
  }
}
