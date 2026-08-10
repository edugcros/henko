import sharp from 'sharp'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import { getModelChain, isModelUnavailable, markModelDead } from './ai/geminiModels.js'
import {
  removeBackgroundLocal,
  isLocalBackgroundRemovalEnabled,
} from './ai/backgroundRemoval.js'

/**
 * Motores de imagen
 * ─────────────────
 * Quitar fondo:  RMBG-1.4 local (gratis, sin API key) → Replicate si está el token
 * Generar fondo: Replicate flux-schnell (modelo oficial) → HuggingFace SD3 (gratis)
 * Prompt:        Gemini traduce/optimiza el prompt del usuario a inglés
 *
 * Todo el flujo funciona sin ninguna credencial de pago: el recorte corre en el
 * propio proceso y el fondo lo genera HuggingFace. Replicate es opcional y sólo
 * mejora velocidad y calidad cuando hay token.
 *
 * HuggingFace no sirve ningún modelo de background removal en su tier gratuito
 * (hf-inference sólo expone segmentación semántica, no recortes con alpha), por
 * eso el recorte se resuelve localmente y no contra su API.
 */

const REPLICATE_API = 'https://api.replicate.com/v1'
const HF_ROUTER = 'https://router.huggingface.co/hf-inference/models'

const BG_REMOVER_VERSION =
  'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc'
const FLUX_MODEL = 'black-forest-labs/flux-schnell'
const HF_TXT2IMG_MODEL = 'stabilityai/stable-diffusion-3-medium-diffusers'

const MAX_EDGE = 1600
const POLL_INTERVAL_MS = 1000
const POLL_MAX_ATTEMPTS = 90

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models'

// ─── Errores ─────────────────────────────────────────────

const fail = (message, statusCode = 502) => {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/** undici esconde la causa real en err.cause — sin esto quedamos ciegos. */
const describe = err => {
  const cause = err?.cause
  if (!cause) return err?.message || 'error desconocido'
  return `${err.message} (${cause.code || cause.message || cause})`
}

// ─── Gemini: prompt engineering ──────────────────────────

const askGemini = async (key, model, prompt) => {
  const res = await fetch(`${GEMINI_API}/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (isModelUnavailable(res.status, body)) {
      markModelDead(model, `${res.status}: ${body.slice(0, 80)}`)
    }
    throw new Error(`${model} → ${res.status}: ${body.slice(0, 120)}`)
  }

  const json = await res.json()
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

const optimizePrompt = async userPrompt => {
  const geminiKey = env.ai?.geminiApiKey
  if (!geminiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping prompt optimization')
    return userPrompt
  }

  const instruction = `You are a prompt engineer for AI image generation.

The user uploaded a product photo and wants to generate a new background scene for it.

Convert their instruction into an optimal English prompt that describes the desired background scene. The prompt will be used with a text-to-image model to generate ONLY the background.

Rules:
- Output ONLY the optimized English prompt, nothing else — no prefix, no quotes, no explanation
- Describe background scene, lighting, surface, materials, atmosphere
- Never mention or describe the product itself
- Be visually specific: mention colors, lighting direction, textures
- Keep it under 50 words
- Use simple English, no special characters or markdown

User instruction: "${userPrompt}"`

  for (const model of getModelChain(env.ai?.geminiModel)) {
    try {
      const raw = await askGemini(geminiKey, model, instruction)

      const optimized = raw
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^(here['']?s?|prompt|output|result|answer)[:\s]*/i, '')
        .trim()

      if (optimized.length < 5) continue

      logger.info('Prompt optimized', { model, original: userPrompt, optimized })
      return optimized
    } catch (err) {
      logger.warn('Gemini model unavailable, trying next', { error: describe(err) })
    }
  }

  logger.warn('Prompt optimization failed on all models, using original prompt')
  return userPrompt
}

// ─── Credenciales ────────────────────────────────────────

const getReplicateToken = () => {
  const token = env.replicate?.apiToken
  if (!token) {
    throw fail(
      'REPLICATE_API_TOKEN no está configurado en el servidor. Agregalo en las variables de entorno.',
      503,
    )
  }
  return token
}

const getHfToken = () => env.huggingface?.apiKey || ''

// ─── Utilidades de imagen ────────────────────────────────

/** Normaliza a PNG y limita el lado mayor: menos payload, menos latencia, menos costo. */
const normalize = async imageBuffer => {
  const image = sharp(imageBuffer, { failOn: 'none' })
  const meta = await image.metadata()

  const needsResize = Math.max(meta.width || 0, meta.height || 0) > MAX_EDGE
  const buffer = await (needsResize
    ? image.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    : image
  )
    .png()
    .toBuffer()

  const out = await sharp(buffer).metadata()
  return { buffer, width: out.width, height: out.height }
}

const downloadImage = async url => {
  const res = await fetch(url)
  if (!res.ok) throw fail(`No se pudo descargar el resultado (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

// ─── Replicate ───────────────────────────────────────────

/**
 * Sube el archivo a Replicate y devuelve su URL.
 * Inlinear la imagen como data URI base64 infla el JSON varios MB y la conexión
 * se corta a nivel socket ("fetch failed"). La Files API es el camino correcto.
 */
const uploadToReplicate = async (token, buffer) => {
  const form = new FormData()
  form.append('content', new Blob([buffer], { type: 'image/png' }), 'input.png')

  const res = await fetch(`${REPLICATE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Token ${token}` },
    body: form,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('Replicate file upload failed', { status: res.status, body })
    throw fail(`Replicate rechazó la subida de la imagen (${res.status})`)
  }

  const json = await res.json()
  const url = json?.urls?.get
  if (!url) throw fail('Replicate no devolvió una URL para la imagen subida')
  return url
}

const pollPrediction = async (token, url) => {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } })
    if (!res.ok) throw fail(`Replicate falló al consultar el estado (${res.status})`)

    const prediction = await res.json()

    if (prediction.status === 'succeeded') {
      const output = prediction.output
      return Array.isArray(output) ? output[0] : output
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw fail(`Replicate no pudo procesar la imagen: ${prediction.error || prediction.status}`)
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw fail('Replicate tardó demasiado en responder. Intentá de nuevo.')
}

const createPrediction = async (token, endpoint, payload) => {
  const res = await fetch(`${REPLICATE_API}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('Replicate create prediction failed', { endpoint, status: res.status, body })

    if (res.status === 402) throw fail('Sin créditos en Replicate.', 402)
    if (res.status === 401) throw fail('REPLICATE_API_TOKEN inválido.', 503)
    throw fail(`Replicate rechazó la solicitud (${res.status}): ${body.slice(0, 200)}`)
  }

  const prediction = await res.json()
  const outputUrl = await pollPrediction(token, prediction.urls.get)
  if (!outputUrl) throw fail('Replicate no devolvió ninguna imagen')

  return downloadImage(outputUrl)
}

// ─── Quitar fondo ────────────────────────────────────────

const removeBgReplicate = async imageBuffer => {
  const token = getReplicateToken()
  const imageUrl = await uploadToReplicate(token, imageBuffer)

  // Modelo comunitario → /predictions con version hash
  return createPrediction(token, '/predictions', {
    version: BG_REMOVER_VERSION,
    input: {
      image: imageUrl,
      threshold: 0,
      background_type: 'rgba',
      format: 'png',
    },
  })
}

/**
 * El recorte local es la opción por defecto: gratis y sin credenciales.
 * Replicate queda como respaldo para cuando hay token, porque es más rápido
 * y afina mejor los bordes finos (pelo, transparencias).
 */
const removeBg = async imageBuffer => {
  if (isLocalBackgroundRemovalEnabled()) {
    try {
      return await removeBackgroundLocal(imageBuffer)
    } catch (error) {
      if (!env.replicate?.apiToken) {
        if (error.code === 'RMBG_INSUFFICIENT_MEMORY') {
          throw fail(
            `${error.message} Ampliá la instancia, o configurá REPLICATE_API_TOKEN para procesar la imagen fuera del servidor.`,
            503,
          )
        }
        throw error
      }

      logger.warn('[RMBG] Recorte local no disponible, se usa Replicate', {
        error: error.message,
      })
    }
  }

  return removeBgReplicate(imageBuffer)
}

// ─── Generar fondo ───────────────────────────────────────

const generateBgReplicate = async prompt => {
  const token = getReplicateToken()

  // Modelo oficial → /models/{owner}/{name}/predictions, sin version hash
  return createPrediction(token, `/models/${FLUX_MODEL}/predictions`, {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'png',
      go_fast: true,
    },
  })
}

const generateBgHuggingFace = async prompt => {
  const token = getHfToken()
  if (!token) throw fail('HUGGINGFACE_API_KEY no configurado', 503)

  const res = await fetch(`${HF_ROUTER}/${HF_TXT2IMG_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: prompt }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('HuggingFace txt2img failed', { status: res.status, body })
    throw fail(`HuggingFace no pudo generar el fondo (${res.status})`)
  }

  return Buffer.from(await res.arrayBuffer())
}

/** Cualquier fallo de Replicate (créditos, red, 5xx) cae a HuggingFace. */
const generateBg = async prompt => {
  try {
    const buffer = await generateBgReplicate(prompt)
    logger.info('Background generado con Replicate')
    return buffer
  } catch (err) {
    logger.warn('Replicate falló, usando HuggingFace', { error: describe(err) })
    const buffer = await generateBgHuggingFace(prompt)
    logger.info('Background generado con HuggingFace (fallback)')
    return buffer
  }
}

// ─── API pública ─────────────────────────────────────────

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  logger.info('removeBackground', { bytes: imageBuffer.length, mime: mimeType })

  const { buffer: normalized } = await normalize(imageBuffer)

  try {
    const buffer = await removeBg(normalized)
    logger.info('removeBackground OK', { outputBytes: buffer.length })
    return { buffer, contentType: 'image/png' }
  } catch (err) {
    logger.error('removeBackground failed', { error: describe(err) })
    if (err.statusCode) throw err
    throw fail(`No se pudo quitar el fondo: ${describe(err)}`)
  }
}

export const generateVariation = async (imageBuffer, prompt, mimeType = 'image/png') => {
  const optimizedPrompt = await optimizePrompt(prompt)

  logger.info('generateVariation', {
    bytes: imageBuffer.length,
    mime: mimeType,
    original: prompt,
    optimized: optimizedPrompt,
  })

  const { buffer: normalized, width, height } = await normalize(imageBuffer)

  // El recorte va primero: es obligatorio y si falla evitamos generar un fondo inútil.
  const cutout = await removeBg(normalized)
  const background = await generateBg(optimizedPrompt)

  const buffer = await sharp(background)
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: cutout, gravity: 'centre' }])
    .png()
    .toBuffer()

  logger.info('generateVariation OK', { outputBytes: buffer.length })

  return { buffer, contentType: 'image/png' }
}
