import Replicate from 'replicate'
import { HfInference } from '@huggingface/inference'
import sharp from 'sharp'
import { GoogleGenerativeAI } from '@google/generative-ai'
import logger from '../../config/logger.js'
import { env } from '../../config/env.js'

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
      `You are a prompt engineer for AI image generation.

The user uploaded a product photo and wants to generate a new background scene for it.

Convert their instruction into an optimal English prompt that describes the desired background scene. The prompt will be used with a text-to-image model to generate ONLY the background.

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

// ─── Helpers ─────────────────────────────────────────────

const isCreditsError = err => {
  const msg = (err?.message || '').toLowerCase()
  return (
    msg.includes('insufficient') ||
    msg.includes('payment') ||
    msg.includes('billing') ||
    msg.includes('quota') ||
    msg.includes('credit') ||
    err?.status === 402 ||
    err?.statusCode === 402
  )
}

const getReplicateToken = () => {
  const token = env.replicate?.apiToken
  if (!token) throw new Error('REPLICATE_API_TOKEN no configurado')
  return token
}

const getHfToken = () => {
  const token = env.huggingface?.apiKey
  if (!token) throw new Error('HUGGINGFACE_API_KEY no configurado')
  return token
}

const fileOutputToBuffer = async output => {
  if (Buffer.isBuffer(output)) return output
  if (typeof output === 'string') {
    const res = await fetch(output)
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  if (output && typeof output.url === 'function') {
    const res = await fetch(output.url())
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  if (output instanceof ReadableStream || (output && typeof output[Symbol.asyncIterator] === 'function')) {
    const chunks = []
    for await (const chunk of output) chunks.push(chunk)
    return Buffer.concat(chunks)
  }
  throw new Error('Unexpected Replicate output type')
}

// ─── Background removal ─────────────────────────────────

const removeBgReplicate = async imageBuffer => {
  const replicate = new Replicate({ auth: getReplicateToken(), useFileOutput: false })

  const output = await replicate.run('851-labs/background-remover', {
    input: { image: imageBuffer },
  })

  const url = Array.isArray(output) ? output[0] : output
  return fileOutputToBuffer(url)
}

const removeBgHuggingFace = async imageBuffer => {
  const token = getHfToken()

  const response = await fetch('https://api-inference.huggingface.co/models/briaai/RMBG-2.0', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: imageBuffer,
  })

  if (!response.ok) {
    const errBody = await response.text().catch(() => '')
    throw new Error(`HuggingFace bg removal failed (${response.status}): ${errBody}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

// ─── Background generation ──────────────────────────────

const generateBgReplicate = async prompt => {
  const replicate = new Replicate({ auth: getReplicateToken(), useFileOutput: false })

  const output = await replicate.run('black-forest-labs/flux-schnell', {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'png',
      go_fast: true,
    },
  })

  const url = Array.isArray(output) ? output[0] : output
  if (!url) throw new Error('Replicate did not return an image')
  return fileOutputToBuffer(url)
}

const generateBgHuggingFace = async prompt => {
  const hf = new HfInference(getHfToken())

  const result = await hf.textToImage({
    model: 'stabilityai/stable-diffusion-xl-base-1.0',
    inputs: prompt,
    parameters: { width: 1024, height: 1024 },
  })

  return Buffer.from(await result.arrayBuffer())
}

// ─── Fallback wrapper ───────────────────────────────────

const withFallback = (primary, fallback, label) => async (...args) => {
  try {
    return await primary(...args)
  } catch (err) {
    if (isCreditsError(err)) {
      logger.info(`${label}: Replicate sin créditos, usando HuggingFace`, { error: err.message })
      return fallback(...args)
    }
    throw err
  }
}

const removeBg = withFallback(removeBgReplicate, removeBgHuggingFace, 'removeBg')
const generateBg = withFallback(generateBgReplicate, generateBgHuggingFace, 'generateBg')

// ─── Public API ──────────────────────────────────────────

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  logger.info('removeBackground', { bytes: imageBuffer.length, mime: mimeType })

  const buffer = await removeBg(imageBuffer)
  logger.info('removeBackground OK', { outputBytes: buffer.length })

  return { buffer, contentType: 'image/png' }
}

export const generateVariation = async (imageBuffer, prompt, mimeType = 'image/png') => {
  const optimizedPrompt = await optimizePrompt(prompt)

  logger.info('generateVariation', {
    bytes: imageBuffer.length,
    mime: mimeType,
    original: prompt,
    optimized: optimizedPrompt,
  })

  const { width, height } = await sharp(imageBuffer).metadata()
  const transparentBuf = await removeBg(imageBuffer)
  const bgBuffer = await generateBg(optimizedPrompt)

  const result = await sharp(bgBuffer)
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: transparentBuf, gravity: 'centre' }])
    .png()
    .toBuffer()

  logger.info('generateVariation OK', { outputBytes: result.length })

  return { buffer: result, contentType: 'image/png' }
}
