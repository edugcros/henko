// 📁 src/services/aiAgent/aiCartRecoveryMessageService.js
//
// Personaliza el mensaje de recuperación de carrito con IA en vez del
// messageTemplate estático de AiCampaignRule. Mismo patrón que
// services/ai/socialCaptionService.js: callAgentLLM no conversacional,
// respuesta forzada a JSON, tolerante a fences de markdown.

import { callAgentLLM } from './aiAgentLLMService.js'

const clean = value => String(value ?? '').trim()

// Mismo motivo que MAX_CAPTION_OUTPUT_TOKENS en socialCaptionService.js: el
// "pensamiento" interno de los modelos thinking no respeta thinkingBudget
// como techo, consume tokens de forma no determinística. Un mensaje de
// recuperación es más corto que un caption, pero se deja el mismo margen de
// seguridad relativo (no 500, que ya rompió esto una vez en otra feature).
const MAX_RECOVERY_MESSAGE_OUTPUT_TOKENS = Math.min(
  Math.max(Number(process.env.AI_CART_RECOVERY_MESSAGE_MAX_OUTPUT_TOKENS || 1024), 256),
  8192,
)

// La API de Gemini rechaza thinkingBudget:0 en modelos thinking — 1 es el
// mínimo aceptado (ver misma nota en socialCaptionService.js).
const RECOVERY_MESSAGE_THINKING_BUDGET = Math.max(
  Number(process.env.AI_CART_RECOVERY_MESSAGE_THINKING_BUDGET || 1),
  1,
)

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

const SYSTEM_PROMPT = `Sos un asistente de un ecommerce argentino que escribe mensajes cortos para recuperar carritos abandonados (WhatsApp o email).

Con los datos del cliente y su carrito, generá un JSON con exactamente esta clave:
{
  "message": "el mensaje, en español rioplatense, tono cercano y directo, 2 a 4 oraciones cortas, SIEMPRE incluye el link de checkout tal cual te lo doy, no inventes envío gratis, descuentos, stock limitado ni ninguna promoción que no te haya dado explícitamente."
}

Devolvé ÚNICAMENTE ese JSON, sin texto antes ni después, sin bloque de código markdown.`

/**
 * Genera un mensaje de recuperación de carrito personalizado. No decide el
 * canal ni envía nada — el caller (aiCartRecoveryWorkerService.js) es quien
 * sabe si el canal actual puede llevar texto libre o no.
 *
 * @param {object} options
 * @param {object} options.values  Mismo objeto que arma buildTemplateValues
 *   (customerName, productName, itemCount, cartTotal, checkoutUrl).
 * @param {string} options.apiKey  Key de Gemini ya resuelta (BYOK o
 *   plataforma) por aiCredentialsService.
 */
export const generatePersonalizedRecoveryMessage = async ({ values, apiKey }) => {
  const userMessage = [
    `Cliente: ${values.customerName}`,
    `Producto principal: ${values.productName}`,
    `Cantidad de ítems en el carrito: ${values.itemCount}`,
    `Total del carrito: ${values.cartTotal}`,
    `Link de checkout: ${values.checkoutUrl}`,
  ].join('\n')

  const result = await callAgentLLM({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    conversationalMode: false,
    temperature: 0.6,
    maxOutputTokens: MAX_RECOVERY_MESSAGE_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    // Un mensaje de recuperación no necesita razonamiento — mismo motivo que
    // socialCaptionService.js.
    thinkingBudget: RECOVERY_MESSAGE_THINKING_BUDGET,
    apiKey,
  })

  if (result.fallback || !result.content) {
    const error = new Error(
      result.error === 'missing_gemini_api_key'
        ? 'No hay una API key de IA configurada para este comercio'
        : 'El modelo no generó contenido',
    )
    error.code = result.error || 'RECOVERY_MESSAGE_EMPTY'
    throw error
  }

  if (result.truncated) {
    const error = new Error('La respuesta del modelo se cortó por longitud')
    error.code = 'RECOVERY_MESSAGE_TRUNCATED'
    throw error
  }

  let parsed
  try {
    parsed = extractJsonObject(result.content)
  } catch (parseError) {
    parseError.rawContentSnippet = result.content.slice(0, 300)
    throw parseError
  }

  const message = clean(parsed?.message)

  if (!message) {
    const error = new Error('El modelo no devolvió un mensaje válido')
    error.code = 'RECOVERY_MESSAGE_INVALID'
    throw error
  }

  // Si la IA "olvidó" el link de checkout, el mensaje no sirve como
  // recuperación de carrito — mejor caer al fallback estático (que sí lo
  // incluye siempre) que mandar un mensaje sin forma de comprar.
  if (values.checkoutUrl && !message.includes(values.checkoutUrl)) {
    const error = new Error('El mensaje generado no incluye el link de checkout')
    error.code = 'RECOVERY_MESSAGE_MISSING_LINK'
    throw error
  }

  return {
    message,
    tokensUsed: Number(result.usageMetadata?.totalTokenCount || 0),
  }
}

export default { generatePersonalizedRecoveryMessage }
