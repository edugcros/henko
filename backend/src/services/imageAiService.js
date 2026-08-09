import FormData from 'form-data'
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
    const error = new Error(`Stability AI error: ${response.status} — ${errorBody}`)
    error.statusCode = 502
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
  logger.info('Stability AI — search-and-replace request', {
    promptLength: prompt.length,
  })

  const form = new FormData()
  form.append('image', imageBuffer, {
    filename: 'image.png',
    contentType: mimeType,
  })
  form.append('prompt', prompt)
  form.append('search_prompt', 'background')
  form.append('output_format', 'png')

  return stabilityRequest('/edit/search-and-replace', form)
}
