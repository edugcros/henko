import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const IMAGE_MODEL_CANDIDATES = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash',
]

let resolvedModel = null

const getGeminiKey = () => {
  const key = env.ai?.geminiApiKey
  if (!key) {
    const error = new Error('GEMINI_API_KEY no está configurada')
    error.statusCode = 503
    throw error
  }
  return key
}

const doImageRequest = async (apiKey, model, imageBuffer, mimeType, textPrompt) => {
  const base64Image = imageBuffer.toString('base64')
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: textPrompt },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown')
    let parsed = {}
    try { parsed = JSON.parse(errorBody) } catch {}
    const detail = parsed?.error?.message || errorBody

    const err = new Error(detail)
    err.status = response.status
    err.isModelError =
      response.status === 404 ||
      /text.only|not.found|does not (exist|support)|not supported/i.test(detail)
    throw err
  }

  const data = await response.json()
  const candidates = data.candidates || []

  if (candidates.length === 0) {
    const blockReason = data.promptFeedback?.blockReason
    const err = new Error(
      blockReason
        ? `Contenido bloqueado: ${blockReason}`
        : 'La IA no generó resultados',
    )
    err.statusCode = 422
    throw err
  }

  const parts = candidates[0]?.content?.parts || []
  const imagePart = parts.find(p => p.inlineData)

  if (!imagePart) {
    const textPart = parts.find(p => p.text)
    const err = new Error(
      textPart?.text || 'La IA respondió sin imagen',
    )
    err.statusCode = 422
    err.isModelError = /text.only|not supported/i.test(textPart?.text || '')
    throw err
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    contentType: imagePart.inlineData.mimeType || 'image/png',
  }
}

const geminiImageEdit = async (imageBuffer, mimeType, textPrompt) => {
  const apiKey = getGeminiKey()

  const candidates = []
  if (resolvedModel) candidates.push(resolvedModel)

  const configured = env.ai?.geminiImageModel
  if (configured && !candidates.includes(configured)) {
    candidates.push(configured)
  }

  for (const m of IMAGE_MODEL_CANDIDATES) {
    if (!candidates.includes(m)) candidates.push(m)
  }

  let lastError = null

  for (const model of candidates) {
    try {
      logger.info('Gemini image request', { model, mimeType, imageSize: imageBuffer.length })
      const result = await doImageRequest(apiKey, model, imageBuffer, mimeType, textPrompt)

      if (model !== resolvedModel) {
        resolvedModel = model
        logger.info(`Image model resolved: ${model}`)
      }

      logger.info('Gemini image success', { model, outputSize: result.buffer.length })
      return result
    } catch (err) {
      lastError = err
      if (err.isModelError) {
        logger.warn(`Model ${model} incompatible, trying next`, { detail: err.message })
        continue
      }
      break
    }
  }

  const status = lastError?.status || 500
  let userMessage = `Error del servicio de IA: ${lastError?.message || 'error desconocido'}`

  if (lastError?.isModelError) {
    userMessage =
      'No se encontró un modelo de Gemini que soporte generación de imágenes. ' +
      'Configurá la variable GEMINI_IMAGE_MODEL con un modelo válido (ej: gemini-2.0-flash-exp).'
  } else if (status === 403) {
    userMessage = 'La API key de Gemini no tiene permisos suficientes.'
  } else if (status === 429) {
    userMessage = 'Demasiadas solicitudes. Esperá unos segundos e intentá de nuevo.'
  } else if (lastError?.statusCode === 422) {
    userMessage = lastError.message
  }

  const error = new Error(userMessage)
  error.statusCode = [400, 404, 422].includes(status) ? 422 : 502
  throw error
}

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  logger.info('Gemini — remove background request')

  return geminiImageEdit(
    imageBuffer,
    mimeType,
    'Remove the background from this product photo completely. Return ONLY the product with a clean, pure white background. Maintain the exact same product, size, angle, and quality. Do not modify the product in any way.',
  )
}

export const generateVariation = async (imageBuffer, prompt, mimeType = 'image/png') => {
  logger.info('Gemini — generate variation request', { prompt })

  return geminiImageEdit(
    imageBuffer,
    mimeType,
    `Edit this product photo following these instructions. IMPORTANT: Keep the product EXACTLY the same — same shape, color, details, angle, and size. Only modify the background, surroundings, and lighting as described below.\n\nInstructions: ${prompt}`,
  )
}
