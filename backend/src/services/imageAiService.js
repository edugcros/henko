import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const IMAGE_MODEL = 'gemini-3.1-flash-image'

const getGeminiKey = () => {
  const key = env.ai?.geminiApiKey
  if (!key) {
    const error = new Error('GEMINI_API_KEY no está configurada')
    error.statusCode = 503
    throw error
  }
  return key
}

const geminiImageEdit = async (imageBuffer, mimeType, textPrompt) => {
  const apiKey = getGeminiKey()
  const model = env.ai?.geminiImageModel || IMAGE_MODEL

  const base64Image = imageBuffer.toString('base64')
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`

  logger.info('Gemini image request', { model, mimeType, imageSize: imageBuffer.length })

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
    logger.error('Gemini image edit error', {
      status: response.status,
      model,
      body: errorBody,
    })

    let parsed = {}
    try { parsed = JSON.parse(errorBody) } catch {}
    const detail = parsed?.error?.message || ''

    let userMessage = `Error del servicio de IA (${response.status})`
    if (response.status === 403) {
      userMessage = 'La API key de Gemini no tiene permisos suficientes. Revisá la configuración.'
    } else if (response.status === 429) {
      userMessage = 'Demasiadas solicitudes. Esperá unos segundos e intentá de nuevo.'
    } else if (response.status === 400) {
      userMessage = `Error al procesar la imagen: ${detail || 'revisá el formato de la imagen e intentá de nuevo.'}`
    } else if (response.status === 404) {
      userMessage = `Modelo "${model}" no disponible. Configurá GEMINI_IMAGE_MODEL con un modelo válido.`
    }

    const error = new Error(userMessage)
    error.statusCode = response.status === 400 || response.status === 404 ? 422 : 502
    throw error
  }

  const data = await response.json()
  const candidates = data.candidates || []

  if (candidates.length === 0) {
    const blockReason = data.promptFeedback?.blockReason
    logger.error('Gemini returned no candidates', { blockReason, data })
    const error = new Error(
      blockReason
        ? `Gemini bloqueó la solicitud: ${blockReason}. Probá con otra imagen o descripción.`
        : 'La IA no generó resultados. Probá con otra imagen.',
    )
    error.statusCode = 422
    throw error
  }

  const parts = candidates[0]?.content?.parts || []
  const imagePart = parts.find(p => p.inlineData)

  if (!imagePart) {
    const textPart = parts.find(p => p.text)
    logger.error('Gemini did not return an image', {
      textResponse: textPart?.text,
      finishReason: candidates[0]?.finishReason,
    })
    const error = new Error(
      'La IA no pudo generar una imagen. Probá con otra imagen o reformulá la descripción.',
    )
    error.statusCode = 422
    throw error
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64')
  const contentType = imagePart.inlineData.mimeType || 'image/png'

  logger.info('Gemini image edit success', { outputSize: buffer.length, contentType })

  return { buffer, contentType }
}

export const removeBackground = async (
  imageBuffer,
  mimeType = 'image/png',
) => {
  logger.info('Gemini — remove background request')

  return geminiImageEdit(
    imageBuffer,
    mimeType,
    'Remove the background from this product photo completely. Return ONLY the product with a clean, pure white background. Maintain the exact same product, size, angle, and quality. Do not modify the product in any way.',
  )
}

export const generateVariation = async (
  imageBuffer,
  prompt,
  mimeType = 'image/png',
) => {
  logger.info('Gemini — generate variation request', { prompt })

  return geminiImageEdit(
    imageBuffer,
    mimeType,
    `Edit this product photo following these instructions. IMPORTANT: Keep the product EXACTLY the same — same shape, color, details, angle, and size. Only modify the background, surroundings, and lighting as described below.\n\nInstructions: ${prompt}`,
  )
}
