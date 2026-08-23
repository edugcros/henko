// 📁 src/services/ai/socialCaptionService.js
//
// Copy para Instagram a partir de un producto — versión "kit asistido": la
// IA escribe el texto, el comercio lo copia y lo postea él mismo. No hay
// integración con la API de Instagram (eso exigiría cuenta Business/Creator
// por comercio + App Review de Meta, que ni siquiera todos los comercios
// actuales podrían cumplir hoy). Ver docs/EMAIL_PRODUCTION.md como ejemplo
// de qué tan caro sale asumir una integración externa que no se puede
// controlar del todo — acá se evita el mismo problema de raíz.

import { callAgentLLM } from '../aiAgent/aiAgentLLMService.js'

const clean = value => String(value ?? '').trim()

// Mismo patrón que AI_VISION_MAX_OUTPUT_TOKENS en aiVisionService.js: un
// tope hardcodeado sin vía de override fue justo lo que rompió esto en
// producción dos veces seguidas. La primera vez, 500 no alcanzaba ni para un
// caption real (aparte del JSON de la respuesta). La segunda, con el tope ya
// en 1024: probado en vivo contra gemini-3.6-flash, el "pensamiento" interno
// del modelo (thoughtsTokenCount) NO respeta thinkingBudget como un techo —
// es un mínimo, no un máximo — y consumió entre 0 y ~550 tokens de forma no
// determinística entre llamados idénticos, dejando a veces muy poco margen
// para la respuesta real. 2048 le da margen al peor caso observado sin
// acercarse al techo real de la API (8192). El env var permite subirlo sin
// redeploy si un modelo futuro piensa todavía más.
const MAX_CAPTION_OUTPUT_TOKENS = Math.min(
  Math.max(Number(process.env.AI_SOCIAL_CAPTION_MAX_OUTPUT_TOKENS || 2048), 256),
  8192,
)

// La API de Gemini rechaza thinkingBudget:0 (400 INVALID_ARGUMENT) en los
// modelos "thinking" — 1 es el mínimo aceptado. No elimina el razonamiento
// (ver nota arriba), pero lo sesga hacia abajo; la defensa real contra
// MAX_TOKENS es el margen de MAX_CAPTION_OUTPUT_TOKENS. Env var por si un
// modelo futuro exige otro mínimo.
const CAPTION_THINKING_BUDGET = Math.max(
  Number(process.env.AI_SOCIAL_CAPTION_THINKING_BUDGET || 1),
  1,
)

/**
 * Mismo patrón que aiVisionService.extractJsonObject: el modelo a veces
 * envuelve el JSON en fences de markdown o le agrega una frase antes/después
 * a pesar de responseMimeType:'application/json'. Se tolera en vez de fallar
 * la generación entera por un `` ```json `` de más.
 */
const extractJsonObject = rawText => {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Respuesta vacía del modelo')
  }

  const trimmed = rawText
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim()

  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')

    if (start === -1 || end === -1 || end <= start) {
      throw new Error('El modelo no devolvió un JSON parseable')
    }

    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

const buildProductSummary = product => {
  const price = Number(product?.price || 0)
  const compareAtPrice = Number(product?.compareAtPrice || 0)
  const hasDiscount = compareAtPrice > price

  const lines = [
    `Título: ${clean(product?.title)}`,
    `Descripción: ${clean(product?.description).slice(0, 600)}`,
    `Marca: ${clean(product?.marca)}`,
    `Categoría: ${clean(product?.categoria)}${product?.subcategoria ? ` > ${clean(product.subcategoria)}` : ''}`,
    `Precio: ${Number.isFinite(price) ? price : 0}`,
  ]

  if (hasDiscount) {
    lines.push(`Precio anterior: ${compareAtPrice} (está en oferta)`)
  }

  const tags = Array.isArray(product?.tags) ? product.tags.filter(Boolean) : []
  if (tags.length) {
    lines.push(`Etiquetas: ${tags.slice(0, 10).join(', ')}`)
  }

  return lines.join('\n')
}

const SYSTEM_PROMPT = `Sos un community manager que escribe posts de Instagram para tiendas online argentinas.

Con los datos de UN producto, generá un JSON con exactamente estas dos claves:
{
  "caption": "el texto del post, en español rioplatense, tono cercano y entusiasta pero sin sonar forzado, 2 a 4 oraciones cortas, puede usar 1-3 emojis relevantes (no abuses), termina con una llamada a la acción clara (ej. 'Link en bio' o mencionar que está disponible en la tienda). NO inventes datos que no te di (no inventes stock, envíos, ni promociones que no mencioné).",
  "hashtags": ["array de 8 a 15 hashtags relevantes, sin el símbolo #, mezclando términos amplios (ej. moda, ecommerce) con específicos de la categoría/marca del producto, todo en minúscula, sin espacios dentro de cada hashtag"]
}

Devolvé ÚNICAMENTE ese JSON, sin texto antes ni después, sin bloque de código markdown.`

/**
 * Genera caption + hashtags para un producto. No persiste nada — es
 * generar-bajo-demanda, el comercio decide qué hacer con el resultado.
 *
 * @param {object} product  Documento de producto (o su .toObject()).
 * @param {object} options
 * @param {string} options.apiKey  Key de Gemini ya resuelta (BYOK o
 *   plataforma) por aiCredentialsService — este servicio no decide de dónde
 *   sale.
 * @param {string} [options.storeName]  Para que el caption pueda mencionar
 *   la tienda por nombre si el modelo lo considera natural.
 */
export const generateSocialCaption = async (product, { apiKey, storeName } = {}) => {
  const summary = buildProductSummary(product)

  const userMessage = storeName
    ? `Tienda: ${clean(storeName)}\n\n${summary}`
    : summary

  const result = await callAgentLLM({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    conversationalMode: false,
    temperature: 0.6,
    maxOutputTokens: MAX_CAPTION_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    // Un caption + hashtags no necesita razonamiento — y en los modelos
    // "thinking" (ver geminiModels.js) ese razonamiento comía el presupuesto
    // de tokens entero antes de escribir el JSON.
    thinkingBudget: CAPTION_THINKING_BUDGET,
    apiKey,
  })

  if (result.fallback || !result.content) {
    const error = new Error(
      result.error === 'missing_gemini_api_key'
        ? 'No hay una API key de IA configurada para este comercio'
        : 'El modelo no generó contenido',
    )
    error.code = result.error || 'SOCIAL_CAPTION_EMPTY'
    throw error
  }

  // finishReason MAX_TOKENS deja el JSON cortado a la mitad (una comilla o un
  // corchete sin cerrar) — el parseo de abajo va a fallar igual, pero con un
  // mensaje genérico que no dice por qué. Cortar acá da un error accionable
  // (reintentá) en vez de "no se pudo parsear".
  if (result.truncated) {
    const error = new Error('La respuesta del modelo se cortó por longitud, probá de nuevo')
    error.code = 'SOCIAL_CAPTION_TRUNCATED'
    throw error
  }

  let parsed
  try {
    parsed = extractJsonObject(result.content)
  } catch (parseError) {
    // El mensaje solo no alcanza para diagnosticar un caso nuevo sin volver a
    // reproducirlo a mano — un fragmento del contenido real sí.
    parseError.rawContentSnippet = result.content.slice(0, 300)
    throw parseError
  }

  const caption = clean(parsed?.caption)
  const hashtags = Array.isArray(parsed?.hashtags)
    ? parsed.hashtags
      .map(tag => clean(tag).replace(/^#/, '').replace(/\s+/g, ''))
      .filter(Boolean)
      .slice(0, 15)
    : []

  if (!caption) {
    const error = new Error('El modelo no devolvió un caption válido')
    error.code = 'SOCIAL_CAPTION_INVALID'
    throw error
  }

  return {
    caption,
    hashtags,
    tokensUsed: Number(result.usageMetadata?.totalTokenCount || 0),
    model: result.model,
  }
}

export default { generateSocialCaption }
