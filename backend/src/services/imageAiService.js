import FormData from 'form-data'
import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const STABILITY_API_BASE = 'https://api.stability.ai/v2beta/stable-image'

let genAI = null

const translatePromptToEnglish = async prompt => {
  const geminiKey = env.ai?.geminiApiKey
  if (!geminiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping prompt translation')
    return prompt
  }

  try {
    if (!genAI) genAI = new GoogleGenerativeAI(geminiKey)

    const model = genAI.getGenerativeModel({ model: env.ai?.geminiModel || 'gemini-2.0-flash' })

    const result = await model.generateContent(
      `You are a prompt engineer for Stability AI's image editing API (search-and-replace endpoint).

The user uploaded a product photo and wants to modify ONLY the background/surroundings while keeping the product intact.

Your job: convert the user's instruction into an optimal English prompt that describes the desired NEW background or scene. The prompt will be used as the "replacement" for the background in the image.

Rules:
- Output ONLY the optimized English prompt, nothing else
- Never describe the product itself — only the background, scene, lighting, or surroundings
- Be visually specific: mention materials, colors, lighting direction, atmosphere
- Keep it under 80 words
- If the user mentions something that should appear near/around the product, describe it as part of the scene

User instruction: "${prompt}"`,
    )

    const translated = result.response.text().trim()
    logger.info('Prompt translated', { original: prompt, translated })
    return translated || prompt
  } catch (err) {
    logger.warn('Prompt translation failed, using original', { error: err.message })
    return prompt
  }
}

const getApiKey = () => {
  const key = env.stabilityAi?.apiKey
  if (!key) {
    const error = new Error('STABILITY_AI_API_KEY no está configurada')
    error.statusCode = 503
    throw error
  }
  return key
}

const stabilityRequest = async (endpoint, formData) => {
  const apiKey = getApiKey()

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
    logger.error(`Stability AI ${endpoint} error`, {
      status: response.status,
      body: errorBody,
    })

    let userMessage = `Error del servicio de IA (${response.status})`
    if (response.status === 403) {
      userMessage = 'El filtro de contenido de Stability AI rechazó la imagen o el prompt. Intentá con otra imagen o reformulá la descripción.'
    } else if (response.status === 401) {
      userMessage = 'La API key de Stability AI no es válida. Revisá la configuración.'
    } else if (response.status === 402) {
      userMessage = 'Créditos insuficientes en Stability AI. Recargá tu cuenta.'
    } else if (response.status === 429) {
      userMessage = 'Demasiadas solicitudes. Esperá unos segundos e intentá de nuevo.'
    }

    const error = new Error(userMessage)
    error.statusCode = response.status === 403 ? 422 : 502
    throw error
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer())

  logger.info(`Stability AI ${endpoint} success`, {
    outputSize: resultBuffer.length,
  })

  return { buffer: resultBuffer, contentType: 'image/png' }
}

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  logger.info('Stability AI — remove-background request')

  const form = new FormData()
  form.append('image', imageBuffer, {
    filename: 'image.png',
    contentType: mimeType,
  })
  form.append('output_format', 'png')

  return stabilityRequest('/edit/remove-background', form)
}

export const generateVariation = async (
  imageBuffer,
  prompt,
  mimeType = 'image/png',
) => {
  const translatedPrompt = await translatePromptToEnglish(prompt)

  logger.info('Stability AI — search-and-replace request', {
    originalPrompt: prompt,
    translatedPrompt,
  })

  const form = new FormData()
  form.append('image', imageBuffer, {
    filename: 'image.png',
    contentType: mimeType,
  })
  form.append('prompt', translatedPrompt)
  form.append('search_prompt', 'background')
  form.append('output_format', 'png')

  return stabilityRequest('/edit/search-and-replace', form)
}
