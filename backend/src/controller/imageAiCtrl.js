import expressAsyncHandler from 'express-async-handler'
import { removeBackground, generateVariation } from '../services/imageAiService.js'
import { getBackgroundRemovalStatus } from '../services/ai/backgroundRemoval.js'
import {
  AI_METRICS,
  buildBudgetDenialMessage,
  refundAiBudget,
  reserveAiBudget,
} from '../services/ai/aiBudgetService.js'
import { resolveTenantAiCredentials } from '../services/ai/aiCredentialsService.js'

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

  const tenantId = String(req.user?.tenantId || req.tenantId || '').trim()

  // Generar un fondo cuesta plata en tres lugares a la vez (Gemini optimiza
  // el prompt, Replicate o HuggingFace generan la imagen). Es la única de las
  // tres vías de IA que hasta este refactor no tenía ningún medidor.
  const reservation = await reserveAiBudget({
    tenantId,
    metric: AI_METRICS.IMAGE_EDITS,
  })

  if (!reservation.allowed) {
    return res.status(reservation.reason === 'subscription_inactive' ? 403 : 402).json({
      success: false,
      code: 'AI_ENTITLEMENT_DENIED',
      reason: reservation.reason,
      message: buildBudgetDenialMessage(reservation),
    })
  }

  let result

  try {
    const credentials = await resolveTenantAiCredentials(tenantId)

    result = await generateVariation(req.file.buffer, prompt, req.file.mimetype, {
      apiKey: credentials.apiKey,
    })
  } catch (error) {
    // El proveedor falló: la generación no se entregó, así que no se cobra.
    await refundAiBudget({ tenantId, metric: AI_METRICS.IMAGE_EDITS })
    throw error
  }

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
