/**
 * webResearchSource.js
 *
 * Señales cualitativas del mercado: intención de búsqueda, menciones, quejas
 * repetidas, marcas que compiten y rango de precios publicado.
 *
 * DOS PASOS, Y NINGUNO NECESITA LA CUOTA QUE ESTÁ EN CERO
 *
 *   1. Tavily busca y devuelve páginas reales, cada una con su URL.
 *   2. Gemini ordena esos extractos en el schema, con una llamada COMÚN.
 *
 * Esto reemplaza al grounding de Google, que estaba muerto: la familia Gemini 3
 * tiene cuota de búsqueda CERO en el nivel gratuito. Comprobado contra la API
 * con la clave de producción, misma clave y mismo minuto — sin `tools`
 * responde 200, con `tools` responde 429, en todos los modelos y en las dos
 * versiones de la API. No era falta de crédito: la búsqueda se mide aparte, y
 * el panel del proyecto la muestra como "Fundamentación de la búsqueda ·
 * Gemini 3 · 0/0".
 *
 * QUÉ GANA EL ANÁLISIS CON EL CAMBIO
 *
 * Las señales de acá pesan el 60% del modelo de scoring —demanda, tendencia e
 * interés social— y venían apagadas. Además, cada una sale ahora de un texto
 * que llegó con su URL: el modelo ordena evidencia verificable en vez de
 * recordar. Las fuentes que se muestran en el panel son esas URLs, no algo que
 * el modelo escribió.
 *
 * QUÉ NO CAMBIA
 *
 * El modelo NUNCA calcula el puntaje. Solo produce señales estructuradas; el
 * cálculo vive en scoring/demandScoreEngine.js.
 */

import { callAgentLLM } from '../../aiAgent/aiAgentLLMService.js'
import { readUsage } from '../../ai/aiUsageMetadata.js'
import { buildExtractionPrompt } from '../prompts/researchPrompt.js'
import { hasTavilyKey, tavilySearch, TAVILY_COUNTRY } from './tavilyClient.js'

const num = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** Suficiente para el JSON del schema; este paso no escribe prosa. */
const EXTRACTION_MAX_TOKENS = num('MARKET_EXTRACTION_MAX_TOKENS', 2048)

/**
 * Tiempo propio para esta llamada. El default del agente son 15 segundos, que
 * alcanzan para contestar un WhatsApp y no para leer doce páginas: cortarla ahí
 * tira a la basura la búsqueda que ya se pagó.
 */
const EXTRACTION_TIMEOUT_MS = num('MARKET_EXTRACTION_TIMEOUT_MS', 45000)

/** Cuántas páginas se le pasan al modelo. Más contexto no es más señal. */
const MAX_PAGES = num('MARKET_RESEARCH_PAGES', 12)

/** Cuánto de cada página. El extracto de Tavily ya viene recortado. */
const MAX_CHARS_PER_PAGE = num('MARKET_RESEARCH_CHARS_PER_PAGE', 600)

/**
 * Lo que se busca. Apunta a opiniones y problemas, no a fichas de producto:
 * los precios ya los trae el buscador de precios, y lo que falta acá es lo
 * que la gente dice.
 */
const RESEARCH_SUFFIX =
  String(process.env.MARKET_RESEARCH_QUERY_SUFFIX || '').trim() ||
  'opiniones reseñas vale la pena'

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    searchIntent: {
      type: 'object',
      properties: {
        informational: { type: 'integer' },
        commercial: { type: 'integer' },
        transactional: { type: 'integer' },
      },
    },
    socialSignals: {
      type: 'object',
      properties: { mentions: { type: 'integer' }, engagement: { type: 'string' } },
    },
    trendDirection: {
      type: 'string',
      enum: ['CRECIENTE', 'ESTABLE', 'DECRECIENTE', 'INDETERMINADA'],
    },
    recurringComplaints: { type: 'array', items: { type: 'string' } },
    competition: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA', 'INDETERMINADA'],
        },
        knownBrands: { type: 'array', items: { type: 'string' } },
      },
    },
    priceRange: {
      type: 'object',
      properties: {
        min: { type: 'number' },
        max: { type: 'number' },
        currency: { type: 'string' },
      },
    },
  },
  required: ['searchIntent', 'trendDirection'],
}

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {string} params.country - ISO-2
 * @param {string} [params.apiKey] - BYOK del tenant o key de plataforma
 * @returns {Promise<ResearchSignals>}
 *
 * @typedef {Object} ResearchSignals
 * @property {boolean} available
 * @property {{informational:number, commercial:number, transactional:number}} searchIntent
 * @property {'CRECIENTE'|'ESTABLE'|'DECRECIENTE'|'INDETERMINADA'} trendDirection
 * @property {string[]} recurringComplaints
 * @property {Array<{url:string, title:string}>} sources - las páginas leídas, verificables
 */
export async function getWebResearchSignals({ product, country, apiKey }) {
  if (!hasTavilyKey()) {
    return { available: false, reason: 'NO_DISPONIBLE: el buscador web no está configurado' }
  }

  // El país va en la CONSULTA, no en el filtro `country` de Tavily.
  //
  // Medido sobre seis productos: con el filtro puesto, cinco consultas
  // volvieron con cero resultados. Acá pasó lo mismo la primera vez —dos de
  // dos productos sin una sola página— y el análisis se quedaba sin el 60% del
  // modelo por un parámetro.
  const pages = await tavilySearch({
    query: `${product} ${RESEARCH_SUFFIX} ${TAVILY_COUNTRY[country] || ''}`.trim(),
    language: 'es',
    source: 'webResearchSource',
  })

  if (pages === null) {
    return { available: false, reason: 'NO_DISPONIBLE: el buscador web no respondió' }
  }

  // Buscó y no encontró nada. Es un dato —de este producto no se habla— y no
  // una falla, pero no hay nada que estructurar.
  if (pages.length === 0) {
    return {
      available: false,
      reason: 'NO_DISPONIBLE: no se encontraron páginas que hablen de este producto',
      sources: [],
    }
  }

  const usadas = pages.slice(0, MAX_PAGES)

  const extraction = await callAgentLLM({
    systemPrompt: buildExtractionPrompt({ product, country }),
    messages: [{ role: 'user', content: buildPagesDigest(usadas) }],
    conversationalMode: false,
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    maxOutputTokens: EXTRACTION_MAX_TOKENS,
    // Este paso no razona: ordena texto que ya está escrito. Con el
    // presupuesto por defecto, un modelo "thinking" gasta la salida pensando y
    // corta el JSON por la mitad.
    thinkingBudget: 1,
    timeoutMs: EXTRACTION_TIMEOUT_MS,
    apiKey,
  })

  const tokensUsed = Number(extraction?.usageMetadata?.totalTokenCount || 0)
  const usage = readUsage(extraction)

  // Las fuentes son las URLs que devolvió el buscador, nunca lo que el modelo
  // escriba: una URL inventada por un modelo es indistinguible de una real
  // hasta que alguien la abre.
  const sources = usadas.map(p => ({
    url: p?.url || null,
    title: String(p?.title || '').slice(0, 200) || 'NO_DISPONIBLE',
  }))

  const parsed = safeParseJson(extraction?.content)

  if (!parsed) {
    return {
      available: false,
      reason: 'NO_DISPONIBLE: la IA no devolvió las señales en el formato esperado',
      // La búsqueda salió bien y está pagada: se conserva lo que trajo.
      sources,
      pagesFound: usadas.length,
      tokensUsed,
      usage,
    }
  }

  return {
    available: true,
    ...parsed,
    sources,
    pagesFound: usadas.length,
    tokensUsed,
    usage,
  }
}

/**
 * Las páginas, numeradas y con su URL. El prompt pide contar extractos por
 * tipo, así que la numeración no es decorativa: es lo que el modelo cuenta.
 */
function buildPagesDigest(pages) {
  return pages
    .map((p, i) => {
      const texto = String(p?.content || '')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_CHARS_PER_PAGE)

      return `[${i + 1}] ${p?.title || 'sin título'}\n${p?.url || ''}\n${texto}`
    })
    .join('\n\n')
}

/**
 * El modelo debería devolver JSON pelado —se le pide responseMimeType y
 * schema— pero a veces lo envuelve en un bloque de código o le antepone una
 * línea. Las dos formas se recuperan sin gastar otra llamada.
 */
function safeParseJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const candidatos = [raw]

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidatos.push(fenced[1].trim())

  const primera = raw.indexOf('{')
  const ultima = raw.lastIndexOf('}')
  if (primera !== -1 && ultima > primera) candidatos.push(raw.slice(primera, ultima + 1))

  for (const candidato of candidatos) {
    try {
      const parsed = JSON.parse(candidato)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // Se prueba la forma siguiente.
    }
  }

  return null
}
