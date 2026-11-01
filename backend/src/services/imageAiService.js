import sharp from 'sharp'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'
import {
  getModelChain,
  isModelUnavailable,
  markModelDead,
  resolveImageModel,
  resolveTextModel,
} from './ai/geminiModels.js'
import { removeBackgroundLocal, isLocalBackgroundRemovalEnabled } from './ai/backgroundRemoval.js'

/**
 * Motores de imagen
 * ─────────────────
 * Quitar fondo:  RMBG local (gratis, sin API key) → Replicate solo si falla el recorte local
 * Generar fondo: cadena de proveedores (IMAGE_AI_PROVIDERS, por defecto
 *                cloudflare → gemini). Cloudflare Workers AI (FLUX.1 schnell)
 *                entra en su cupo diario gratuito; Gemini Image exige facturación.
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

  for (const model of getModelChain(resolveTextModel())) {
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

const generateBgGemini = async (prompt, aspectRatio = '1:1', timeoutMs = 90000) => {
  const apiKey = String(env.ai?.geminiApiKey || '').trim()
  if (!apiKey) {
    throw fail('GEMINI_API_KEY no está configurada para generar imágenes.', 503)
  }

  const configuredModel = resolveImageModel()
  if (!/^[a-zA-Z0-9._-]+$/.test(configuredModel)) {
    throw fail('GEMINI_IMAGE_MODEL tiene un formato inválido.', 503)
  }

  const allowedRatios = new Set(['1:1', '16:9', '4:5'])
  const safeRatio = allowedRatios.has(aspectRatio) ? aspectRatio : '1:1'
  const url = `${GEMINI_API}/${encodeURIComponent(configuredModel)}:generateContent`

  const res = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
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
      markGenerativeBackgroundUnavailable('gemini')
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

  logger.info('Background generado con Gemini', {
    model: configuredModel,
    bytes: buffer.length,
    aspectRatio: safeRatio,
  })
  return buffer
}

// ─── Generar fondo con Cloudflare Workers AI ───────────────
//
// FLUX.1 schnell en Workers AI. Verificado en la documentación de Cloudflare
// (01/11/2026): está en el plan gratuito de Workers, que incluye 10.000
// neuronas por día; una imagen de 1024×1024 con 4 pasos son ~58 neuronas
// (4 bloques × 4,8 + 4 pasos × 9,6), o sea unas 170 imágenes diarias sin
// costo. Se agregó porque Gemini Image no tiene cupo en el plan gratuito
// (limit: 0) y el editor quedaba sin generación.
//
// Se activa con CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_AI_API_TOKEN (un token con
// permiso Workers AI). Sin las dos, el proveedor se saltea.

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const CLOUDFLARE_IMAGE_MODEL_DEFAULT = '@cf/black-forest-labs/flux-1-schnell'

const cloudflareConfig = () => {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  const apiToken = String(process.env.CLOUDFLARE_AI_API_TOKEN || '').trim()
  const model = String(process.env.CLOUDFLARE_IMAGE_MODEL || CLOUDFLARE_IMAGE_MODEL_DEFAULT).trim()

  return {
    accountId,
    apiToken,
    model,
    configured:
      /^[a-f0-9]{32}$/i.test(accountId) && Boolean(apiToken) && /^@cf\/[a-z0-9._/-]+$/i.test(model),
  }
}

/**
 * ¿El 429 es por el cupo diario agotado? Workers AI distingue (ver
 * developers.cloudflare.com/workers-ai/platform/errors/): 3036 es "usaste las
 * 10.000 neuronas del día", 3040 es "falta de capacidad, reintentá". Los dos
 * llegan como 429 en { errors: [{ code, message }] }.
 */
export const isCloudflareDailyLimit = body => {
  try {
    const codes = (JSON.parse(body)?.errors || []).map(error => Number(error?.code))
    if (codes.includes(3036)) return true
    if (codes.length) return false
  } catch {
    // No vino JSON: se decide por el texto.
  }
  return /daily free allocation/i.test(String(body || ''))
}

/** Próxima medianoche UTC: ahí Cloudflare renueva el cupo diario gratuito. */
const nextUtcMidnight = now => {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}

const generateBgCloudflare = async (prompt, timeoutMs = 60000) => {
  const { accountId, apiToken, model, configured } = cloudflareConfig()
  if (!configured) throw fail('Cloudflare Workers AI no está configurado.', 503)

  // FLUX.1 schnell no recibe proporción: genera cuadrado y la composición lo
  // recorta con "cover" al lienzo del propósito.
  const res = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: String(prompt).slice(0, 2048), steps: 4 }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // El token nunca va al log: solo el status y lo que respondió Cloudflare.
    logger.error('Cloudflare image generation failed', {
      model,
      status: res.status,
      body: body.slice(0, 300),
    })

    if (res.status === 401 || res.status === 403) {
      logger.error('[IMAGE AI] Cloudflare rechazó el token', {
        action: 'Revisar CLOUDFLARE_AI_API_TOKEN: necesita permiso Workers AI (Read y Edit).',
      })
      markGenerativeBackgroundUnavailable('cloudflare')
    } else if (res.status === 429 && isCloudflareDailyLimit(body)) {
      logger.error('[IMAGE AI] Cloudflare: se agotó el cupo diario gratuito', {
        action: 'Se renueva a las 00:00 UTC. Para más imágenes por día, el plan Workers Paid.',
      })
      markGenerativeBackgroundUnavailable('cloudflare', Date.now(), nextUtcMidnight(Date.now()))
    }
    // Cualquier otro 429 —sobre todo el 3040, falta de capacidad— es
    // transitorio: falla este intento y la cadena sigue, pero no se pausa el
    // proveedor. Pausarlo hasta medianoche por un pico de demanda dejaba la
    // generación en Gemini (o sin generación) el resto del día.

    throw buildGeminiImageError(res.status === 401 || res.status === 403 ? 403 : 429)
  }

  const json = await res.json().catch(() => null)
  const image = json?.result?.image
  if (!image) {
    logger.warn('Cloudflare image generation returned no image', { model })
    const error = fail(
      'La IA no devolvió una imagen. Probá con otra descripción. No se descontó de tu cupo.',
      502,
    )
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(image, 'base64')
  if (!buffer.length) throw fail('Cloudflare devolvió una imagen vacía.', 502)

  logger.info('Background generado con Cloudflare Workers AI', { model, bytes: buffer.length })
  return buffer
}

// ─── Cadena de proveedores y disponibilidad ─────────────────
//
// Medido en producción el 31/10/2026: con la key de Gemini en el plan
// gratuito, cada "Generar variación" recortaba el producto (8–13 s de CPU y
// hasta 300 MB de memoria) para recibir después un 429. Después de un 401,
// 403 o 429 se recuerda que ESE proveedor no está disponible —un 429 de Gemini
// no apaga Cloudflare—: si no queda ninguno, el controller corta antes de
// reservar cupo y de recortar, y el panel lo muestra antes de que el comercio
// suba nada. Cada proveedor se vuelve a probar solo pasado su pausa, y un
// éxito la limpia.

const GENERATIVE_COOLDOWN_MS = Number(process.env.IMAGE_AI_GENERATIVE_COOLDOWN_MS) || 30 * 60 * 1000

const IMAGE_PROVIDERS = {
  cloudflare: {
    configured: () => cloudflareConfig().configured,
    timeoutMs: 60000,
    generate: (prompt, aspectRatio, timeoutMs) => generateBgCloudflare(prompt, timeoutMs),
  },
  gemini: {
    configured: () => Boolean(String(env.ai?.geminiApiKey || '').trim()),
    timeoutMs: 90000,
    generate: (prompt, aspectRatio, timeoutMs) => generateBgGemini(prompt, aspectRatio, timeoutMs),
  },
}

const unavailableUntil = { cloudflare: 0, gemini: 0 }
// Cuándo se marcó cada pausa. Un éxito solo limpia una pausa marcada ANTES de
// que ese pedido empezara: con pedidos en paralelo, uno viejo que termina bien
// no puede borrar la pausa que acaba de poner otro (por ejemplo, el cupo
// diario agotado).
const unavailableMarkedAt = { cloudflare: 0, gemini: 0 }

/**
 * Plazo total de una generación, desde que entra el pedido. El panel espera
 * 180 s (admin/src/services/imageAiService.js); con margen para responder,
 * la cadena no puede pasarse de esto. Sin plazo, optimizar el prompt +
 * Cloudflare (60 s) + Gemini (90 s) superaba los 180 s: el navegador mostraba
 * error mientras el backend terminaba y se quedaba con el cupo.
 */
const generationBudgetMs = () => Number(process.env.IMAGE_AI_GENERATION_BUDGET_MS) || 150000

// Menos que esto no alcanza para que un proveedor genere: mejor no empezar.
const MIN_PROVIDER_MS = 15000

/** El orden de la cadena. Cloudflare primero: entra en su cupo gratuito. */
const providerOrder = () =>
  String(process.env.IMAGE_AI_PROVIDERS || 'cloudflare,gemini')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter((name, index, list) => IMAGE_PROVIDERS[name] && list.indexOf(name) === index)

export const markGenerativeBackgroundUnavailable = (
  provider = 'gemini',
  now = Date.now(),
  until = null,
) => {
  if (!(provider in unavailableUntil)) return
  unavailableUntil[provider] = until ?? now + GENERATIVE_COOLDOWN_MS
  unavailableMarkedAt[provider] = now
}

export const getGenerativeBackgroundStatus = (now = Date.now()) => {
  const configured = providerOrder().filter(name => IMAGE_PROVIDERS[name].configured())
  const ready = configured.filter(name => now >= unavailableUntil[name])
  const pauses = configured.map(name => unavailableUntil[name]).filter(until => until > now)

  return {
    available: ready.length > 0,
    retryAt:
      ready.length === 0 && pauses.length ? new Date(Math.min(...pauses)).toISOString() : null,
    provider: ready[0] || null,
  }
}

/** Solo para tests: el estado vive en el módulo. */
export const resetGenerativeBackgroundStatus = () => {
  unavailableUntil.cloudflare = 0
  unavailableUntil.gemini = 0
  unavailableMarkedAt.cloudflare = 0
  unavailableMarkedAt.gemini = 0
}

/** Error para el comercio cuando ningún proveedor generó el fondo a tiempo. */
const generationFailedError = () => {
  const error = fail(
    'No se pudo generar el fondo en este momento. Probá de nuevo en unos minutos. No se descontó de tu cupo.',
    502,
  )
  error.expose = true
  return error
}

/**
 * El fondo, del primer proveedor de la cadena que responda. Uno que falla no
 * corta la generación: se prueba el siguiente. Si no responde ninguno, sale el
 * error del último (marcado `expose` para que el comercio lo lea).
 */
const generateBg = async (
  prompt,
  aspectRatio = '1:1',
  deadline = Date.now() + generationBudgetMs(),
) => {
  let lastError = null

  for (const name of providerOrder()) {
    const provider = IMAGE_PROVIDERS[name]
    if (!provider.configured() || Date.now() < unavailableUntil[name]) continue

    const remaining = deadline - Date.now()
    if (remaining < MIN_PROVIDER_MS) {
      logger.warn('[IMAGE AI] Sin tiempo para otro proveedor dentro del plazo', {
        provider: name,
        remainingMs: remaining,
      })
      break
    }

    const startedAt = Date.now()
    try {
      const buffer = await provider.generate(
        prompt,
        aspectRatio,
        Math.min(provider.timeoutMs, remaining),
      )
      if (unavailableMarkedAt[name] <= startedAt) unavailableUntil[name] = 0
      return buffer
    } catch (error) {
      lastError = error
      logger.warn('[IMAGE AI] El proveedor no generó el fondo, se prueba el siguiente', {
        provider: name,
        status: error?.statusCode,
        error: error?.message,
      })
    }
  }

  if (!lastError) throw buildGeminiImageError(429)
  // Un error ya redactado para el comercio sale tal cual; uno crudo —un
  // timeout, una caída de red— se reemplaza, porque errorHandler taparía el
  // 5xx en producción y el comercio no sabría que no se le cobró.
  throw lastError.expose ? lastError : generationFailedError()
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
  // El plazo corre desde que entra el pedido: optimizar el prompt y recortar
  // también consumen del tiempo que espera el panel.
  const deadline = Date.now() + generationBudgetMs()
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
  const background = await generateBg(optimizedPrompt, canvas.replicateRatio, deadline)

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
