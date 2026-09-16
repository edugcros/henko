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
 *   TAVILY_MAX_RESULTS    resultados por consulta                        (50)
 *   TAVILY_TIMEOUT_MS     corte de la llamada                         (20000)
 *   TAVILY_EXTRACT_URL    endpoint de extracción  (https://api.tavily.com/extract)
 *   TAVILY_EXTRACT_DEPTH  'basic' | 'advanced'                        (basic)
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

/**
 * Cuántos resultados pedir por búsqueda.
 *
 * Veinte dejaba el análisis sin muestra, y no por los filtros: medido contra
 * la API con dos productos reales, pasar de 20 a 50 llevó las tiendas
 * ARGENTINAS distintas de 0 a 5 en unas botas Alpinestars Tech-7, y de 1 a 13
 * en un sommier Cannon Doral. Con veinte, los 20 resultados del sommier eran
 * 11 páginas de la MISMA tienda —y una oferta por dominio, así que la
 * "competencia" del producto se medía con un solo vendedor.
 *
 * No cuesta más: Tavily cobra por búsqueda (1 crédito en basic, 2 en
 * advanced), no por resultado devuelto.
 */
const MAX_RESULTS = num('TAVILY_MAX_RESULTS', 50)
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
const EXTRACT_URL =
  String(process.env.TAVILY_EXTRACT_URL || '').trim() || 'https://api.tavily.com/extract'

const EXTRACT_DEPTH =
  String(process.env.TAVILY_EXTRACT_DEPTH || '').trim() || 'basic'

/**
 * El CUERPO de las páginas, no el extracto del buscador.
 *
 * `search` devuelve un resumen por página que para una ficha de tienda es el
 * texto ALT de las fotos: medido sobre las botas Alpinestars Tech-7, lo que
 * llegaba al modelo era "vista superior que muestra el forro interior... goma
 * texturizada azul y negra". Con eso, pedirle quejas de compradores y recibir
 * una lista vacía es la respuesta correcta — no hay ninguna queja ahí.
 *
 * `extract` devuelve el texto real: 7.319 caracteres del hilo del foro, 8.732
 * de la review de Loam Wolf, 18.286 de la prueba de Moto1Pro. Cuesta 1 crédito
 * cada 5 URLs (2 en advanced), contra 1 por búsqueda. Comparado con el
 * endpoint Research —de 4 a 110 créditos por consulta sobre un plan de 1.000
 * al mes— es la forma barata de tener el contenido.
 *
 * Devuelve solo las que salieron bien; las fallidas se omiten sin romper nada.
 *
 * @param {Object} params
 * @param {string[]} params.urls
 * @param {string} [params.source] - quién pregunta, solo para el log
 * @returns {Promise<Array<{url:string, content:string}>|null>}
 */

/**
 * Cuántos créditos gasta cada llamada, y cómo se reportan.
 *
 * POR QUÉ ESTÁ ACÁ Y NO EN QUIEN LLAMA
 *
 * El precio de una llamada depende de la profundidad configurada y de cuántas
 * URLs resolvió la extracción. Las dos cosas las sabe este archivo y ninguna
 * sale en la respuesta, así que contar afuera obligaría a duplicar la tabla de
 * créditos y a adivinar la profundidad.
 *
 * LA TARIFA (docs.tavily.com/documentation/api-credits)
 *
 *   search   basic 1 crédito · advanced 2
 *   extract  basic 1 crédito cada 5 URLs RESUELTAS · advanced 2 cada 5
 *
 * "Resueltas" y no "pedidas": Tavily cobra las extracciones exitosas, así que
 * pedir 12 URLs y resolver 7 cuesta 2 créditos, no 3. Contar las pedidas
 * sobreestimaría el gasto justo en las corridas que salieron mal.
 *
 * SE REPORTA POR UN ACUMULADOR, NO POR EL VALOR DE RETORNO
 *
 * Cambiar lo que devuelven estas funciones rompería a los tres llamadores por
 * una razón que no es la suya. El acumulador es opcional: quien quiere
 * contabilizar lo pasa, y quien no, sigue llamando igual que antes.
 *
 * Una llamada que FALLA no gasta créditos y no se anota. Ese es el motivo de
 * que el push esté después del await y no antes.
 */
const CREDITOS_POR_BUSQUEDA = depth => (String(depth).toLowerCase() === 'advanced' ? 2 : 1)

const CREDITOS_POR_EXTRACCION = (urlsResueltas, depth) =>
  Math.ceil(Math.max(0, urlsResueltas) / 5) *
  (String(depth).toLowerCase() === 'advanced' ? 2 : 1)

/** Anota un consumo en el acumulador, si quien llamó pasó uno. */
const anotar = (toolUsage, tool, quantity) => {
  if (!Array.isArray(toolUsage) || !(quantity > 0)) return
  toolUsage.push({ tool, quantity })
}

export async function tavilyExtract({ urls, source = 'tavily', toolUsage = null }) {
  const apiKey = String(process.env.TAVILY_API_KEY || '').trim()
  const lista = (Array.isArray(urls) ? urls : []).filter(Boolean)

  if (!apiKey || lista.length === 0) return null

  try {
    const { data } = await axios.post(
      EXTRACT_URL,
      { urls: lista, extract_depth: EXTRACT_DEPTH },
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: TIMEOUT_MS },
    )

    const resueltas = (Array.isArray(data?.results) ? data.results : [])
      .map(r => ({ url: r?.url || null, content: String(r?.raw_content || '') }))
      .filter(r => r.url && r.content)

    // Con las RESUELTAS, no con las pedidas: Tavily cobra las exitosas.
    anotar(toolUsage, 'tavily_extract', CREDITOS_POR_EXTRACCION(resueltas.length, EXTRACT_DEPTH))

    return resueltas
  } catch (error) {
    logger.warn(`[${source}] Tavily extract falló`, {
      status: error?.response?.status,
      message: error.message,
    })

    return null
  }
}

export async function tavilySearch({
  query,
  language,
  country,
  maxResults = MAX_RESULTS,
  source = 'tavily',
  toolUsage = null,
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

    // La búsqueda se cobra por llamada, no por resultado: haya devuelto 50 o
    // ninguno, el crédito ya se gastó.
    anotar(toolUsage, 'tavily_search', CREDITOS_POR_BUSQUEDA(SEARCH_DEPTH))

    return Array.isArray(data?.results) ? data.results : []
  } catch (error) {
    logger.warn(`[${source}] Tavily falló`, {
      status: error?.response?.status,
      message: error.message,
    })

    return null
  }
}
