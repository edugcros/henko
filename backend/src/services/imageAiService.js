import FormData from 'form-data'
import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const STABILITY_API_BASE = 'https://api.stability.ai/v2beta/stable-image'

let genAI = null

// ─── Gemini: prompt engineering ──────────────────────────

const optimizePrompt = async userPrompt => {
  const geminiKey = env.ai?.geminiApiKey
  if (!geminiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping prompt optimization')
    return userPrompt
  }

  try {
    if (!genAI) genAI = new GoogleGenerativeAI(geminiKey)
    const model = genAI.getGenerativeModel({
      model: env.ai?.geminiModel || 'gemini-2.0-flash',
    })

    const result = await model.generateContent(
      `You are a prompt engineer for Stability AI image editing (search-and-replace endpoint).

The user uploaded a product photo and wants to change ONLY the background/surroundings while keeping the product intact.

Convert their instruction into an optimal English prompt that describes the desired NEW background scene. This prompt will replace the current background.

Rules:
- Output ONLY the optimized English prompt, nothing else — no prefix, no quotes, no explanation
- Describe background scene, lighting, surface, materials, atmosphere
- Never mention or describe the product itself
- Be visually specific: mention colors, lighting direction, textures
- Keep it under 50 words
- Use simple English, no special characters or markdown

User instruction: "${userPrompt}"`,
    )

    let optimized = result.response.text().trim()
    optimized = optimized
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^(here['']?s?|prompt|output|result|answer)[:\s]*/i, '')
      .trim()

    if (!optimized || optimized.length < 5) return userPrompt

    logger.info('Prompt optimized', { original: userPrompt, optimized })
    return optimized
  } catch (err) {
    logger.warn('Prompt optimization failed, using original', { error: err.message })
    return userPrompt
  }
}

// ─── Stability AI ────────────────────────────────────────

const getStabilityKey = () => {
  const key = env.stabilityAi?.apiKey
  if (!key) {
    const error = new Error(
      'STABILITY_AI_API_KEY no está configurada. Agregala en las variables de entorno del servidor.',
    )
    error.statusCode = 503
    throw error
  }
  return key
}

const parseStabilityError = (status, body) => {
  let parsed = {}
  try {
    parsed = JSON.parse(body)
  } catch {}
  const detail = parsed?.message || parsed?.name || parsed?.errors?.join(', ') || ''

  const messages = {
    400: detail
      ? `Stability AI rechazó la solicitud: ${detail}`
      : 'La imagen no pudo ser procesada. Probá con otra imagen (PNG/JPG, max 10 MB).',
    401: 'API key de Stability AI inválida. Revisá STABILITY_AI_API_KEY.',
    402: 'Créditos insuficientes en Stability AI. Recargá en platform.stability.ai.',
    403: 'El filtro de contenido rechazó la solicitud. Intentá con otra imagen o reformulá el prompt.',
    429: 'Demasiadas solicitudes a Stability AI. Esperá unos segundos e intentá de nuevo.',
  }

  return messages[status] || `Error de Stability AI (${status})${detail ? ': ' + detail : ''}`
}

const stabilityRequest = async (endpoint, formData) => {
  const apiKey = getStabilityKey()

  const response = await fetch(`${STABILITY_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
      ...formData.getHeaders(),
    },
    body: formData.getBuffer(),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown')
    logger.error(`Stability AI ${endpoint} failed`, {
      status: response.status,
      body: errorBody,
    })

    const userMessage = parseStabilityError(response.status, errorBody)
    const error = new Error(userMessage)
    error.statusCode = [400, 403].includes(response.status) ? 422 : 502
    throw error
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer())

  logger.info(`Stability AI ${endpoint} OK`, { outputBytes: resultBuffer.length })

  return { buffer: resultBuffer, contentType: 'image/png' }
}

// ─── Public API ──────────────────────────────────────────

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  logger.info('removeBackground', { bytes: imageBuffer.length, mime: mimeType })

  const form = new FormData()
  form.append('image', imageBuffer, {
    filename: 'input.png',
    contentType: mimeType,
  })
  form.append('output_format', 'png')

  return stabilityRequest('/edit/remove-background', form)
}

export const generateVariation = async (imageBuffer, prompt, mimeType = 'image/png') => {
  const optimizedPrompt = await optimizePrompt(prompt)

  logger.info('generateVariation', {
    bytes: imageBuffer.length,
    mime: mimeType,
    original: prompt,
    optimized: optimizedPrompt,
  })

  const form = new FormData()
  form.append('image', imageBuffer, {
    filename: 'input.png',
    contentType: mimeType,
  })
  form.append('prompt', optimizedPrompt)
  form.append('search_prompt', 'the background behind and around the main product')
  form.append('output_format', 'png')

  return stabilityRequest('/edit/search-and-replace', form)
}
