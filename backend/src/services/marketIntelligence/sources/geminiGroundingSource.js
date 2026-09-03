/**
 * geminiGroundingSource.js
 *
 * Usa el cliente Gemini compartido (aiAgentLLMService.js) — hereda su
 * retry/backoff, cadena de fallback de modelos y timeout, en vez de
 * duplicar esa infraestructura.
 *
 * DISEÑO EN DOS PASOS (obligatorio, no cosmético):
 * La API de Gemini rechaza combinar `tools: [{ google_search: {} }]` con
 * `responseSchema` en modelos 2.5.x (400 INVALID_ARGUMENT: "controlled
 * generation is not supported with google_search tool"). El DEFAULT_MODEL
 * de aiAgentLLMService.js es gemini-2.5-flash, así que este archivo NO
 * asume que el modelo resuelto soporte ambas cosas a la vez — funciona
 * igual sin importar qué modelo gane la cadena de fallback:
 *
 *   Paso 1: generateContent CON tools (google_search), SIN responseSchema.
 *           Devuelve texto en prosa + groundingMetadata con fuentes reales.
 *   Paso 2: generateContent SIN tools, CON responseSchema, usando el texto
 *           del paso 1 como contexto a extraer/estructurar.
 *
 * Esto también evita el problema de thinkingBudget bajo cortando el
 * grounding a mitad de búsqueda (ver PATCH_aiAgentLLMService.js).
 *
 * Requiere aplicar antes: PATCH_aiAgentLLMService.js (agrega soporte
 * opcional de `tools`, aditivo y no rompe llamadores existentes).
 */

import { callAgentLLM } from '../../aiAgent/aiAgentLLMService.js'
import { buildGroundingPrompt, buildExtractionPrompt } from '../prompts/groundingPrompt.js'

const GROUNDING_RESPONSE_SCHEMA = {
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
    trendDirection: { type: 'string', enum: ['CRECIENTE', 'ESTABLE', 'DECRECIENTE', 'INDETERMINADA'] },
    recurringComplaints: { type: 'array', items: { type: 'string' } },

    // Competencia y precios: los cubría meliSource con datos duros de
    // marketplace. Con MELI cerrado, Gemini es la única fuente externa, así
    // que reporta lo que encuentre buscando — es evidencia más blanda
    // (observación, no conteo), y el scoring lo topea en consecuencia.
    competition: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA', 'INDETERMINADA'] },
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
 * @param {string} params.country
 * @returns {Promise<GroundingSignals>}
 *
 * @typedef {Object} GroundingSignals
 * @property {boolean} available
 * @property {{informational:number, commercial:number, transactional:number}} searchIntent
 * @property {{mentions:number|'NO_DISPONIBLE', engagement:string}} socialSignals
 * @property {'CRECIENTE'|'ESTABLE'|'DECRECIENTE'|'INDETERMINADA'} trendDirection
 * @property {string[]} recurringComplaints
 * @property {Array<{url:string, title:string}>} sources - de groundingMetadata real, no inventado
 */
export async function getGroundingSignals({ product, country, apiKey }) {
  // --- Paso 1: búsqueda real con grounding, sin forzar schema ---
  const groundingResult = await callAgentLLM({
    systemPrompt: buildGroundingPrompt({ product, country }),
    messages: [{ role: 'user', content: `Analizá el producto: ${product}` }],
    conversationalMode: false,
    temperature: 0.2,
    apiKey, // BYOK del tenant o key de plataforma, resuelta por el orquestador
    tools: [{ google_search: {} }], // TODO: confirmar nombre exacto tras aplicar el patch
    // Sin thinkingBudget definido a propósito: dejamos el default del
    // modelo para no cortar la búsqueda a mitad de camino.
  })

  // Los tokens del paso 1 se contabilizan aunque el paso 2 falle: ya se
  // gastaron contra la API de Google.
  const step1Tokens = Number(groundingResult?.usageMetadata?.totalTokenCount || 0)

  if (groundingResult.fallback || !groundingResult.content) {
    return {
      available: false,
      reason: `NO_DISPONIBLE: ${groundingResult.error || 'sin respuesta del modelo'}`,
      tokensUsed: step1Tokens,
    }
  }

  const sources = extractGroundingSources(groundingResult)

  // --- Paso 2: extracción estructurada del texto ya grounded ---
  const extractionResult = await callAgentLLM({
    systemPrompt: buildExtractionPrompt(),
    messages: [{ role: 'user', content: groundingResult.content }],
    conversationalMode: false,
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: GROUNDING_RESPONSE_SCHEMA,
    apiKey,
  })

  const step2Tokens = Number(extractionResult?.usageMetadata?.totalTokenCount || 0)
  const tokensUsed = step1Tokens + step2Tokens

  const parsed = safeParseJson(extractionResult.content)
  if (!parsed) {
    return {
      available: false,
      reason: 'NO_DISPONIBLE: no se pudo estructurar la respuesta grounded en JSON válido',
      tokensUsed,
    }
  }

  return { available: true, ...parsed, sources, tokensUsed }
}

/**
 * groundingMetadata es el único lugar de donde tomamos "sources" — nunca se
 * generan a partir de lo que el modelo escribe en prosa, porque eso es
 * exactamente el vector de alucinación de URLs que la sección 14 del spec
 * prohíbe.
 *
 * TODO: la forma exacta de groundingMetadata (groundingChunks vs.
 * citationMetadata) depende de si aiAgentLLMService.js empieza a devolver
 * ese campo — hoy `getGeminiFinishInfo` solo extrae
 * safetyRatings/citationMetadata, no groundingMetadata. Falta agregarlo ahí
 * también como parte del mismo patch aditivo.
 */
function extractGroundingSources(groundingResult) {
  const chunks = groundingResult?.groundingMetadata?.groundingChunks || []
  return chunks
    .map(chunk => chunk?.web)
    .filter(Boolean)
    .map(web => ({ url: web.uri, title: web.title || 'NO_DISPONIBLE' }))
}

function safeParseJson(text) {
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}
