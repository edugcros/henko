import expressAsyncHandler from 'express-async-handler'
import { removeBackground, generateVariation } from '../services/imageAiService.js'
import { getBackgroundRemovalStatus } from '../services/ai/backgroundRemoval.js'

/**
 * Qué motor está disponible y con cuánta memoria cuenta el contenedor.
 * Un OOM mata el proceso sin dejar rastro en la respuesta, así que sin esto
 * la única señal desde el navegador es un 502 sin cabeceras CORS.
 */
export const handleImageAiStatus = expressAsyncHandler(async (req, res) => {
  const local = getBackgroundRemovalStatus()

  res.json({
    success: true,
    data: {
      localBackgroundRemoval: local,
      replicateConfigured: Boolean(process.env.REPLICATE_API_TOKEN),
      huggingfaceConfigured: Boolean(
        process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN,
      ),
    },
  })
})

export const handleRemoveBackground = expressAsyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se envió ninguna imagen' })
  }

  const result = await removeBackground(req.file.buffer, req.file.mimetype)

  const base64 = result.buffer.toString('base64')

  res.json({
    success: true,
    data: {
      image: `data:${result.contentType};base64,${base64}`,
      contentType: result.contentType,
      size: result.buffer.length,
    },
  })
})

export const handleGenerateVariation = expressAsyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se envió ninguna imagen' })
  }

  const prompt = req.body.prompt?.trim()
  if (!prompt) {
    return res.status(400).json({ success: false, message: 'Se requiere un prompt describiendo los cambios deseados' })
  }

  if (prompt.length > 1000) {
    return res.status(400).json({ success: false, message: 'El prompt no puede superar los 1000 caracteres' })
  }

  const result = await generateVariation(req.file.buffer, prompt, req.file.mimetype)

  const base64 = result.buffer.toString('base64')

  res.json({
    success: true,
    data: {
      image: `data:${result.contentType};base64,${base64}`,
      contentType: result.contentType,
      size: result.buffer.length,
      prompt,
    },
  })
})
