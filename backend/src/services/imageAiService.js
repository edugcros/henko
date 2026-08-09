import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

const STABILITY_API_BASE = 'https://api.stability.ai/v2beta/stable-image'

const getApiKey = () => {
  const key = env.stabilityAi?.apiKey
  if (!key) {
    const error = new Error('STABILITY_AI_API_KEY no está configurada')
    error.statusCode = 503
    throw error
  }
  return key
}

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  const apiKey = getApiKey()

  const formData = new FormData()
  formData.append('image', new Blob([imageBuffer], { type: mimeType }), 'image.png')
  formData.append('output_format', 'png')

  logger.info('🖼️ Stability AI — remove-background request')

  const response = await fetch(`${STABILITY_API_BASE}/edit/remove-background`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
    },
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown')
    logger.error('Stability AI remove-background error', {
      status: response.status,
      body: errorBody,
    })
    const error = new Error(`Stability AI error: ${response.status}`)
    error.statusCode = 502
    throw error
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer())

  logger.info('Stability AI remove-background success', {
    outputSize: resultBuffer.length,
  })

  return { buffer: resultBuffer, contentType: 'image/png' }
}

export const generateVariation = async (
  imageBuffer,
  prompt,
  mimeType = 'image/png',
) => {
  const apiKey = getApiKey()

  const formData = new FormData()
  formData.append('image', new Blob([imageBuffer], { type: mimeType }), 'image.png')
  formData.append('prompt', prompt)
  formData.append('search_prompt', 'background')
  formData.append('output_format', 'png')

  logger.info('🖼️ Stability AI — search-and-replace request', {
    promptLength: prompt.length,
  })

  const response = await fetch(`${STABILITY_API_BASE}/edit/search-and-replace`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
    },
    body: formData,
  })

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown')
    logger.error('Stability AI search-and-replace error', {
      status: response.status,
      body: errorBody,
    })
    const error = new Error(`Stability AI error: ${response.status}`)
    error.statusCode = 502
    throw error
  }

  const resultBuffer = Buffer.from(await response.arrayBuffer())

  logger.info('Stability AI search-and-replace success', {
    outputSize: resultBuffer.length,
  })

  return { buffer: resultBuffer, contentType: 'image/png' }
}
