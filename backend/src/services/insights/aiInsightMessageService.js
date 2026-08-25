// 📁 src/services/insights/aiInsightMessageService.js
//
// Genera el mensaje de reactivación para un insight customer_inactivity.
// Mismo patrón exacto que aiAgent/aiCartRecoveryMessageService.js:
// callAgentLLM no conversacional, respuesta forzada a JSON, tolerante a
// fences de markdown. A diferencia de esa función, esta NO decide el canal
// ni envía nada — el resultado se le muestra al admin para revisar/editar
// antes de mandar (ver aiInsightActionService.js).

import { callAgentLLM } from '../aiAgent/aiAgentLLMService.js'

const clean = value => String(value ?? '').trim()

// Mismo margen relativo que MAX_RECOVERY_MESSAGE_OUTPUT_TOKENS — el
// "pensamiento" interno de los modelos thinking no respeta thinkingBudget
// como techo.
const MAX_REACTIVATION_MESSAGE_OUTPUT_TOKENS = Math.min(
  Math.max(Number(process.env.AI_INSIGHT_MESSAGE_MAX_OUTPUT_TOKENS || 1024), 256),
  8192,
)

// La API de Gemini rechaza thinkingBudget:0 en modelos thinking — 1 es el
// mínimo aceptado.
const REACTIVATION_MESSAGE_THINKING_BUDGET = Math.max(
  Number(process.env.AI_INSIGHT_MESSAGE_THINKING_BUDGET || 1),
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

const SYSTEM_PROMPT = `Sos un asistente de un ecommerce argentino que escribe mensajes cortos para reactivar clientes que compraron antes y dejaron de comprar.

Con los datos del cliente, generá un JSON con exactamente esta clave:
{
  "message": "el mensaje, en español rioplatense, tono cercano, 2 a 4 oraciones cortas, SIEMPRE incluye el link de la tienda tal cual te lo doy, no inventes descuentos, cupones ni promociones que no te haya dado explícitamente."
}

Devolvé ÚNICAMENTE ese JSON, sin texto antes ni después, sin bloque de código markdown.`

/**
 * @param {object} options
 * @param {object} options.values  { customerName, orderCount, daysSinceLastOrder, storeUrl }
 * @param {string} options.apiKey  Key de Gemini ya resuelta (BYOK o plataforma).
 */
export const generateReactivationMessageText = async ({ values, apiKey }) => {
  const userMessage = [
    `Cliente: ${values.customerName}`,
    `Compras anteriores: ${values.orderCount}`,
    `Días sin comprar: ${values.daysSinceLastOrder}`,
    `Link de la tienda: ${values.storeUrl}`,
  ].join('\n')

  const result = await callAgentLLM({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    conversationalMode: false,
    temperature: 0.6,
    maxOutputTokens: MAX_REACTIVATION_MESSAGE_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    thinkingBudget: REACTIVATION_MESSAGE_THINKING_BUDGET,
    apiKey,
  })

  if (result.fallback || !result.content) {
    const error = new Error(
      result.error === 'missing_gemini_api_key'
        ? 'No hay una API key de IA configurada para este comercio'
        : 'El modelo no generó contenido',
    )
    error.code = result.error || 'REACTIVATION_MESSAGE_EMPTY'
    throw error
  }

  if (result.truncated) {
    const error = new Error('La respuesta del modelo se cortó por longitud')
    error.code = 'REACTIVATION_MESSAGE_TRUNCATED'
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
    error.code = 'REACTIVATION_MESSAGE_INVALID'
    throw error
  }

  // Si la IA "olvidó" el link de la tienda, el mensaje no sirve — mejor caer
  // al fallback estático (que sí lo incluye siempre) que mandarle al admin
  // algo para revisar sin forma de volver a la tienda.
  if (values.storeUrl && !message.includes(values.storeUrl)) {
    const error = new Error('El mensaje generado no incluye el link de la tienda')
    error.code = 'REACTIVATION_MESSAGE_MISSING_LINK'
    throw error
  }

  return {
    message,
    tokensUsed: Number(result.usageMetadata?.totalTokenCount || 0),
  }
}

export default { generateReactivationMessageText }
