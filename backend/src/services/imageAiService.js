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

const getReplicate = () => {
  const token = env.replicate?.apiToken
  if (!token) throw new Error('REPLICATE_API_TOKEN no configurado')
  return new Replicate({ auth: token })
}

const getHf = () => {
  const token = env.huggingface?.apiKey
  if (!token) throw new Error('HUGGINGFACE_API_KEY no configurado')
  return new HfInference(token)
}

const downloadUrl = async url => {
  const r = await fetch(typeof url === 'string' ? url : url.url())
  if (!r.ok) throw new Error(`Download failed: ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

// ─── Background removal providers ───────────────────────

const removeBgReplicate = async imageBuffer => {
  const replicate = getReplicate()
  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`

  const output = await replicate.run('lucataco/remove-bg', {
    input: { image: dataUrl },
  })

  return downloadUrl(output)
}

const removeBgHuggingFace = async imageBuffer => {
  const hf = getHf()
  const blob = new Blob([imageBuffer], { type: 'image/png' })

  const result = await hf.imageSegmentation({
    model: 'briaai/RMBG-2.0',
    data: blob,
  })

  if (result instanceof Blob) {
    return Buffer.from(await result.arrayBuffer())
  }

  if (Array.isArray(result) && result.length > 0 && result[0].blob) {
    return Buffer.from(await result[0].blob.arrayBuffer())
  }

  throw new Error('HuggingFace background removal returned unexpected format')
}

// ─── Background generation providers ────────────────────

const generateBgReplicate = async prompt => {
  const replicate = getReplicate()

  const output = await replicate.run('black-forest-labs/flux-schnell', {
    input: {
      prompt,
      num_outputs: 1,
      aspect_ratio: '1:1',
      output_format: 'png',
      go_fast: true,
    },
  })

  const imageUrl = Array.isArray(output) ? output[0] : output
  if (!imageUrl) throw new Error('Replicate did not return an image')

  return downloadUrl(imageUrl)
}

const generateBgHuggingFace = async prompt => {
  const hf = getHf()

  const result = await hf.textToImage({
    model: 'stabilityai/stable-diffusion-xl-base-1.0',
    inputs: prompt,
    parameters: { width: 1024, height: 1024 },
  })

  return Buffer.from(await result.arrayBuffer())
}

// ─── Fallback wrappers ──────────────────────────────────

const withFallback = (primary, fallback, label) => async (...args) => {
  try {
    return await primary(...args)
  } catch (err) {
    if (isCreditsError(err)) {
      logger.info(`${label}: Replicate credits exhausted, falling back to HuggingFace`, {
        error: err.message,
      })
      return fallback(...args)
    }
    throw err
  }
}

const removeBgWithFallback = withFallback(removeBgReplicate, removeBgHuggingFace, 'removeBg')
const generateBgWithFallback = withFallback(generateBgReplicate, generateBgHuggingFace, 'generateBg')

// ─── Public API ──────────────────────────────────────────

export const removeBackground = async (imageBuffer, mimeType = 'image/png') => {
  logger.info('removeBackground', { bytes: imageBuffer.length, mime: mimeType })

  const buffer = await removeBgWithFallback(imageBuffer)
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

  const transparentBuf = await removeBgWithFallback(imageBuffer)
  const bgBuffer = await generateBgWithFallback(optimizedPrompt)

  const result = await sharp(bgBuffer)
    .resize(width, height, { fit: 'cover' })
    .composite([{ input: transparentBuf, gravity: 'centre' }])
    .png()
    .toBuffer()

  logger.info('generateVariation OK', { outputBytes: result.length })

  return { buffer: result, contentType: 'image/png' }
}
