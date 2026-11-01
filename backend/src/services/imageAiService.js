import sharp from 'sharp'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import { getModelChain, isModelUnavailable, markModelDead } from './ai/geminiModels.js'
import { removeBackgroundLocal, isLocalBackgroundRemovalEnabled } from './ai/backgroundRemoval.js'

/**
 * Motores de imagen
 * ─────────────────
 * Quitar fondo:  RMBG local (gratis, sin API key) → Replicate solo si falla el recorte local
 * Generar fondo: Gemini Image (modelo configurable, por defecto Flash Lite Image)
 * Prompt:        Gemini optimiza el prompt del usuario a inglés
 *
 * La generación de fondo utiliza la clave Gemini de plataforma y no hace
 * fallback automático a otros proveedores pagos: un error de cuota debe
 * detener la operación en vez de disparar un segundo gasto. El producto se
 * recorta y compone localmente para preservar la foto original.
 */

const REPLICATE_API = 'https://api.replicate.com/v1'

const BG_REMOVER_VERSION = 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc'

const MAX_EDGE = 1600
const POLL_INTERVAL_MS = 1000
const POLL_MAX_ATTEMPTS = 90

// 'store' no entra acá: ya es exactamente removeBackground (el corte limpio
// ES la imagen para tienda), no una variante de generateVariation.
const PURPOSE_ASPECT = {
  ad: { ratio: '16:9', wRatio: 16, hRatio: 9 },
  social: { ratio: '1:1', wRatio: 1, hRatio: 1 },
  alternative: { ratio: '4:5', wRatio: 4, hRatio: 5 },
}

/**
 * Sin purpose, devuelve el comportamiento de siempre: el canvas final es el
 * de la foto original, sin ninguna proporción forzada — retrocompatible con
 * cualquier caller que no mande el parámetro nuevo.
 *
 * Exportada (mismo criterio que tryPersonalizeMessage en el Bloque 7) para
 * poder verificar la matemática del canvas directamente, sin depender de
 * credenciales reales de Replicate/HuggingFace.
 */
export const resolveTargetCanvas = (purpose, originalWidth, originalHeight) => {
  const preset = PURPOSE_ASPECT[purpose]
  if (!preset) return { width: originalWidth, height: originalHeight, replicateRatio: '1:1' }

  const baseEdge = Math.min(MAX_EDGE, Math.max(originalWidth, originalHeight))

  if (preset.wRatio >= preset.hRatio) {
    const width = baseEdge
    const height = Math.round((baseEdge * preset.hRatio) / preset.wRatio)
    return { width, height, replicateRatio: preset.ratio }
  }

  const height = baseEdge
  const width = Math.round((baseEdge * preset.wRatio) / preset.hRatio)
  return { width, height, replicateRatio: preset.ratio }
}

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
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (isModelUnavailable(res.status, body)) {
      markModelDead(model, `${res.status}: ${body.slice(0, 80)}`, res.status)
    }
    throw new Error(`${model} → ${res.status}: ${body.slice(0, 120)}`)
  }

  const json = await res.json()
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

const optimizePrompt = async (userPrompt, apiKey = null) => {
  // La key la manda el llamador cuando conoce el tenant (puede ser la propia
  // del comercio); el fallback a la de la plataforma queda para los usos
  // internos que no tienen tenant a mano.
  const geminiKey = String(apiKey || '').trim() || env.ai?.geminiApiKey
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

User instruction (JSON string): ${JSON.stringify(userPrompt)}`

  for (const model of getModelChain(env.ai?.geminiModel)) {
    try {
      const raw = await askGemini(geminiKey, model, instruction)

      const optimized = raw
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/^(here['']?s?|prompt|output|result|answer)[:\s]*/i, '')
        .trim()

      if (optimized.length < 5) continue

      logger.info('Prompt optimized', {
        model,
        originalLength: userPrompt.length,
        optimizedLength: optimized.length,
      })
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

// ─── Utilidades de imagen ────────────────────────────────

/** Normaliza a PNG y limita el lado mayor: menos payload, menos latencia, menos costo. */
const normalize = async imageBuffer => {
  const image = sharp(imageBuffer, { failOn: 'none' })
  const meta = await image.metadata()

  const needsResize = Math.max(meta.width || 0, meta.height || 0) > MAX_EDGE
  const buffer = await (
    needsResize
      ? image.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      : image
  )
    .png()
    .toBuffer()

  const out = await sharp(buffer).metadata()
  return { buffer, width: out.width, height: out.height }
}

const downloadImage = async url => {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw fail(`No se pudo descargar el resultado (${res.status})`)
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length === 0) throw fail('El proveedor devolvió una imagen vacía')
  return data
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
    signal: AbortSignal.timeout(30000),
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
    const res = await fetch(url, {
      headers: { Authorization: `Token ${token}` },
      signal: AbortSignal.timeout(10000),
    })
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
    signal: AbortSignal.timeout(30000),
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

// ─── Generar fondo con Gemini ───────────────────────────────
//
// Gemini genera únicamente el fondo. El producto se recorta localmente y se
// compone después, así se conserva la foto original del producto sin pedirle
// al modelo que la vuelva a dibujar. No se reintenta con proveedores pagos:
// un error de cuota debe detenerse aquí, no disparar una segunda factura.

const GEMINI_IMAGE_MODEL_DEFAULT = 'gemini-3.1-flash-lite-image'

/**
 * Qué decirle al comercio cuando Gemini no genera el fondo, y qué hacer del
 * lado de la plataforma.
 *
 * La generación usa la key de PLATAFORMA (imageAiCtrl fuerza esa
 * facturación), así que credencial y cuota son problema de HENKO, no del
 * comercio. Antes el mensaje le decía al comerciante "Revisá la facturación y
 * los límites de la API": algo que no puede hacer. Medido en producción el
 * 31/10/2026: cada intento devolvía 429 por plan gratuito (limit: 0 para los
 * modelos de imagen). El detalle va al log; al comercio, qué pasó y que no se
 * le cobró (el controller devuelve el cupo cuando esto tira).
 */
export const describeGeminiImageFailure = status => {
  if (status === 401 || status === 403 || status === 429) {
    return {
      statusCode: 503,
      message:
        'La generación de fondos no está disponible en este momento. No se descontó de tu cupo; probá más tarde o usá "Quitar fondo".',
      platformAction:
        status === 429
          ? 'Sin cuota para el modelo de imagen: revisar facturación y límites del proyecto en Google AI Studio.'
          : 'Credencial rechazada: revisar GEMINI_API_KEY y los permisos del proyecto.',
    }
  }

  return {
    statusCode: 502,
    message: `No se pudo generar el fondo (${status}). No se descontó de tu cupo.`,
    platformAction: null,
  }
}

/**
 * El error que sale cuando Gemini no genera el fondo, marcado con `expose`:
 * el mensaje se redactó PARA el comercio. errorHandler tapa todo 5xx en
 * producción con "Ocurrió un error interno", así que sin esta marca el
 * comercio nunca leería que no se le cobró ni la alternativa. El controller
 * (handleGenerateVariation) la usa para responder él mismo.
 */
export const buildGeminiImageError = status => {
  const failure = describeGeminiImageFailure(status)
  const error = fail(failure.message, failure.statusCode)
  error.expose = true
  error.code = 'IMAGE_GENERATION_UNAVAILABLE'
  return error
}

const generateBgGemini = async (prompt, aspectRatio = '1:1') => {
  const apiKey = String(env.ai?.geminiApiKey || '').trim()
  if (!apiKey) {
    throw fail('GEMINI_API_KEY no está configurada para generar imágenes.', 503)
  }

  const configuredModel = String(
    env.ai?.geminiImageModel || env.ai?.googleImageModel || GEMINI_IMAGE_MODEL_DEFAULT,
  ).trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(configuredModel)) {
    throw fail('GEMINI_IMAGE_MODEL tiene un formato inválido.', 503)
  }

  const allowedRatios = new Set(['1:1', '16:9', '4:5'])
  const safeRatio = allowedRatios.has(aspectRatio) ? aspectRatio : '1:1'
  const url = `${GEMINI_API}/${encodeURIComponent(configuredModel)}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: safeRatio },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('Gemini image generation failed', {
      model: configuredModel,
      status: res.status,
      body: body.slice(0, 500),
    })

    const failure = describeGeminiImageFailure(res.status)
    if (failure.platformAction) {
      logger.error('[IMAGE AI] La key de plataforma no puede generar imágenes', {
        model: configuredModel,
        status: res.status,
        action: failure.platformAction,
      })
      markGenerativeBackgroundUnavailable()
    }
    throw buildGeminiImageError(res.status)
  }

  const json = await res.json()
  const imagePart = json?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    const finishReason = json?.candidates?.[0]?.finishReason || 'sin imagen en la respuesta'
    logger.warn('Gemini image generation returned no image', {
      model: configuredModel,
      finishReason,
    })
    // Escrito para el comercio: sin `expose`, errorHandler lo taparía en
    // producción por ser 5xx.
    const error = fail(
      'La IA no devolvió una imagen. Probá con otra descripción. No se descontó de tu cupo.',
      502,
    )
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64')
  if (!buffer.length) throw fail('Gemini devolvió una imagen vacía.', 502)

  // Respondió: si estaba marcada como no disponible, deja de estarlo.
  resetGenerativeBackgroundStatus()

  logger.info('Background generado con Gemini', {
    model: configuredModel,
    bytes: buffer.length,
    aspectRatio: safeRatio,
  })
  return buffer
}

const generateBg = (prompt, aspectRatio = '1:1') => generateBgGemini(prompt, aspectRatio)

// ─── Disponibilidad de la generación con IA ─────────────────
//
// Medido en producción el 31/10/2026: con la key de plataforma en el plan
// gratuito, cada "Generar variación" recortaba el producto (8–13 s de CPU y
// hasta 300 MB de memoria) para recibir después un 429 de Gemini. Ningún
// intento podía salir bien y todos costaban lo mismo. Después de un 401, 403 o
// 429 se recuerda que no está disponible: el controller corta antes de
// reservar cupo y de recortar, y el panel lo muestra antes de que el comercio
// suba nada. Se vuelve a probar sola pasado el cooldown, y un éxito la limpia.
const GENERATIVE_COOLDOWN_MS = Number(process.env.IMAGE_AI_GENERATIVE_COOLDOWN_MS) || 30 * 60 * 1000

let generativeUnavailableUntil = 0

export const markGenerativeBackgroundUnavailable = (now = Date.now()) => {
  generativeUnavailableUntil = now + GENERATIVE_COOLDOWN_MS
}

export const getGenerativeBackgroundStatus = (now = Date.now()) => {
  const configured = Boolean(String(env.ai?.geminiApiKey || '').trim())
  const coolingDown = now < generativeUnavailableUntil

  return {
    available: configured && !coolingDown,
    retryAt: coolingDown ? new Date(generativeUnavailableUntil).toISOString() : null,
  }
}

/** Solo para tests: el estado vive en el módulo. */
export const resetGenerativeBackgroundStatus = () => {
  generativeUnavailableUntil = 0
}

// ─── Fondos de estudio (sin IA generativa) ──────────────────
//
// El producto recortado se compone sobre un fondo dibujado acá mismo con SVG.
// No llama a ningún proveedor: es gratis, no usa cupo, funciona aunque Gemini
// no tenga cuota, y el producto queda exactamente como en la foto. Cubre los
// fondos que más se usan en catálogo —blanco de estudio, gris, beige,
// degradado, oscuro y el color de la marca— con una sombra suave de apoyo.

export const STUDIO_STYLES = Object.freeze({
  blanco: { label: 'Blanco de estudio', from: '#ffffff', to: '#e6eaf0', shadow: 0.22 },
  gris: { label: 'Gris suave', from: '#f5f6f8', to: '#cdd2da', shadow: 0.24 },
  beige: { label: 'Beige cálido', from: '#fcf6ee', to: '#e2cdb0', shadow: 0.22 },
  pastel: {
    label: 'Degradado pastel',
    from: '#fde2e4',
    to: '#dbeafe',
    linear: true,
    shadow: 0.18,
  },
  oscuro: { label: 'Oscuro premium', from: '#3b414d', to: '#0c0e12', shadow: 0.6 },
  color: { label: 'Color de tu marca', shadow: 0.24 },
})

const HEX_COLOR = /^#[0-9a-f]{6}$/i

const darken = (hex, amount) => {
  const value = parseInt(hex.slice(1), 16)
  const channel = shift => Math.max(0, Math.round(((value >> shift) & 255) * (1 - amount)))
  return `#${[16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('')}`
}

/**
 * El estilo pedido, con sus colores. Un estilo o un color inválidos son un
 * error del pedido (400, con mensaje para el comercio), no un fallo interno.
 */
export const resolveStudioStyle = (style, color) => {
  const preset = STUDIO_STYLES[style]
  if (!preset) throw fail('Elegí uno de los fondos de estudio.', 400)

  if (style !== 'color') return { ...preset }

  const hex = String(color || '').trim()
  if (!HEX_COLOR.test(hex)) throw fail('El color tiene que ser un código como #0b6bff.', 400)

  return { ...preset, from: hex, to: darken(hex, 0.18) }
}

const studioBackgroundSvg = (width, height, look) => {
  const gradient = look.linear
    ? `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${look.from}"/><stop offset="1" stop-color="${look.to}"/></linearGradient>`
    : `<radialGradient id="g" cx="50%" cy="42%" r="78%"><stop offset="0" stop-color="${look.from}"/><stop offset="1" stop-color="${look.to}"/></radialGradient>`

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs>${gradient}</defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  )
}

/**
 * Compone el recorte sobre el fondo de estudio y devuelve un JPEG.
 *
 * JPEG y no PNG: el resultado es opaco, y el PNG de un recorte de 1600 px
 * pesaba 4,3 MB en producción. El producto ocupa hasta el 72% del lienzo, se
 * apoya sobre una sombra difusa y no se deforma.
 */
export const composeStudioImage = async (cutout, { width, height }, look) => {
  // Se recortan los bordes transparentes para centrar el PRODUCTO y no la
  // foto. Si el recorte quedó vacío, trim falla: se usa tal cual.
  const trimmed = await sharp(cutout)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
    .png()
    .toBuffer()
    .catch(() => cutout)

  const product = await sharp(trimmed)
    .resize(Math.round(width * 0.72), Math.round(height * 0.72), { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true })

  const productWidth = product.info.width
  const productHeight = product.info.height
  const left = Math.round((width - productWidth) / 2)
  const top = Math.max(0, Math.round((height - productHeight) / 2 - height * 0.03))

  const shadowHeight = Math.max(6, Math.round(Math.min(productWidth, productHeight) * 0.08))
  const shadowY = Math.min(height - shadowHeight, top + productHeight - shadowHeight * 0.15)
  const blur = Math.max(4, Math.round(shadowHeight * 0.7))
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs><ellipse cx="${left + productWidth / 2}" cy="${shadowY}" rx="${Math.round(productWidth * 0.4)}" ry="${Math.round(shadowHeight / 2)}" fill="#000" fill-opacity="${look.shadow}" filter="url(#b)"/></svg>`,
  )

  return sharp(studioBackgroundSvg(width, height, look))
    .composite([
      { input: shadow, left: 0, top: 0 },
      { input: product.data, left, top },
    ])
    .flatten({ background: look.from })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

/**
 * El recorte del producto. Una foto que ya viene con transparencia —por
 * ejemplo, el resultado de "Quitar fondo"— no se vuelve a recortar: en
 * producción eso eran 8–13 segundos de CPU para obtener la misma imagen.
 */
const cutoutOf = async normalized => {
  const { isOpaque } = await sharp(normalized).stats()
  if (!isOpaque) return normalized
  return removeBg(normalized)
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

export const generateVariation = async (
  imageBuffer,
  prompt,
  mimeType = 'image/png',
  { apiKey = null, purpose = null } = {},
) => {
  const optimizedPrompt = await optimizePrompt(prompt, apiKey)

  logger.info('generateVariation', {
    bytes: imageBuffer.length,
    mime: mimeType,
    promptLength: prompt.length,
    optimizedPromptLength: optimizedPrompt.length,
    purpose,
  })

  const { buffer: normalized, width, height } = await normalize(imageBuffer)
  const canvas = resolveTargetCanvas(purpose, width, height)

  // El recorte va primero: es obligatorio y si falla evitamos generar un fondo inútil.
  const cutout = await cutoutOf(normalized)
  const background = await generateBg(optimizedPrompt, canvas.replicateRatio)

  // El producto se ajusta con "contain" (no deformarlo) dentro del canvas de
  // destino antes de componerlo — importante cuando el canvas cambia de
  // proporción respecto a la foto original (ej. 16:9 para publicidad). El
  // fondo generado sí cubre el canvas completo con "cover", como siempre.
  const cutoutFitted = await sharp(cutout)
    .resize(canvas.width, canvas.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  const buffer = await sharp(background)
    .resize(canvas.width, canvas.height, { fit: 'cover' })
    .composite([{ input: cutoutFitted, gravity: 'centre' }])
    .png()
    .toBuffer()

  logger.info('generateVariation OK', { outputBytes: buffer.length })

  return { buffer, contentType: 'image/png' }
}

/**
 * Producto recortado sobre un fondo de estudio dibujado en el servidor.
 * Sin IA generativa: no usa cupo ni depende de que Gemini tenga cuota.
 */
export const createStudioImage = async (
  imageBuffer,
  { style, color = null, purpose = null } = {},
) => {
  // Primero el estilo: un pedido inválido no tiene que costar un recorte.
  const look = resolveStudioStyle(style, color)

  logger.info('createStudioImage', { bytes: imageBuffer.length, style, purpose })

  const { buffer: normalized, width, height } = await normalize(imageBuffer)
  const canvas = resolveTargetCanvas(purpose, width, height)

  try {
    const cutout = await cutoutOf(normalized)
    const buffer = await composeStudioImage(cutout, canvas, look)
    logger.info('createStudioImage OK', { outputBytes: buffer.length, style })
    return { buffer, contentType: 'image/jpeg' }
  } catch (err) {
    logger.error('createStudioImage failed', { error: describe(err) })
    if (err.statusCode) throw err
    throw fail(`No se pudo armar el fondo de estudio: ${describe(err)}`)
  }
}
