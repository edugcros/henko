import expressAsyncHandler from 'express-async-handler'
import {
  createStudioImage,
  describeGeminiImageFailure,
  generateVariation,
  getGenerativeBackgroundStatus,
  removeBackground,
  STUDIO_STYLES,
} from '../services/imageAiService.js'
import { getBackgroundRemovalStatus } from '../services/ai/backgroundRemoval.js'
import { resolveImageModel } from '../services/ai/geminiModels.js'
import {
  AI_FEATURES,
  AI_METRICS,
  AI_PROVIDERS,
  buildBudgetDenialMessage,
  refundAiBudget,
  reserveAiBudget,
} from '../services/ai/aiBudgetService.js'

const IMAGE_PURPOSES = new Set(['ad', 'social', 'alternative'])
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
      geminiImageConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiImageModel: resolveImageModel(),
      localBackgroundRemoval: local,
      // El panel lo usa para desactivar "Fondo con IA" con una explicación,
      // en vez de dejar que el comercio suba una foto y espere para fallar.
      generativeBackground: getGenerativeBackgroundStatus(),
      studioStyles: Object.entries(STUDIO_STYLES).map(([key, { label }]) => ({ key, label })),
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
    return res
      .status(400)
      .json({ success: false, message: 'Se requiere un prompt describiendo los cambios deseados' })
  }

  if (prompt.length > 1000) {
    return res
      .status(400)
      .json({ success: false, message: 'El prompt no puede superar los 1000 caracteres' })
  }

  const tenantId = String(req.user?.tenantId || req.tenantId || '').trim()
  const purpose = IMAGE_PURPOSES.has(req.body.purpose) ? req.body.purpose : null

  // Ya se sabe que Gemini no puede generar (sin cuota o credencial
  // rechazada): se corta acá, antes de reservar cupo y de recortar el
  // producto, que eran 8–13 s de CPU por intento para un 429 seguro.
  const generative = getGenerativeBackgroundStatus()
  if (!generative.available) {
    return res.status(503).json({
      success: false,
      code: 'IMAGE_GENERATION_UNAVAILABLE',
      message: describeGeminiImageFailure(429).message,
      retryAt: generative.retryAt,
    })
  }

  // La generación del fondo usa Gemini con la clave de plataforma. La clave
  // propia del tenant, si existe, solo se usa para optimizar el prompt. La
  // reserva debe reflejar el proveedor que realmente factura la generación.
  //
  // La reserva cobra la cuota Y el costo en el mismo movimiento: el precio por
  // imagen es una tarifa plana, o sea que ya se conoce acá. Antes el costo se
  // registraba después, en una segunda llamada, y si esa llamada no llegaba a
  // ejecutarse el cupo quedaba consumido sin su plata. El refund de más abajo
  // devuelve las dos cosas juntas.
  const reservation = await reserveAiBudget({
    tenantId,
    metric: AI_METRICS.IMAGE_EDITS,
    feature: AI_FEATURES.IMAGE_AI,
    // Gemini es el proveedor de generación de fondo y la llamada usa la key
    // de plataforma; no hay fallback automático a otros proveedores pagos.
    provider: AI_PROVIDERS.GEMINI,
    // La key propia, si existe, solo optimiza el prompt. La generación de la
    // imagen se factura a la plataforma, por lo que se fuerza ese presupuesto.
    forcePlatformBilling: true,
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
      purpose,
    })
  } catch (error) {
    // El proveedor falló: la generación no se entregó, así que no se cobra.
    await refundAiBudget({
      tenantId,
      metric: AI_METRICS.IMAGE_EDITS,
      operationId: reservation.operationId,
    })

    // Un mensaje escrito para el comercio (imageAiService lo marca con
    // `expose`) se responde acá: errorHandler tapa cualquier 5xx en producción
    // y el comercio no se enteraría de que no se le cobró. El resto sigue al
    // handler global, que oculta lo que nadie redactó para el cliente.
    if (error?.expose) {
      return res.status(error.statusCode || 503).json({
        success: false,
        code: error.code || 'IMAGE_GENERATION_UNAVAILABLE',
        message: error.message,
      })
    }

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
      purpose,
    },
  })
})

/**
 * Producto recortado sobre un fondo de estudio (blanco, gris, beige,
 * degradado, oscuro o el color de la marca). Se arma en el servidor sin IA
 * generativa: no usa cupo y funciona aunque Gemini no tenga cuota.
 */
export const handleStudioBackground = expressAsyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se envió ninguna imagen' })
  }

  const style = String(req.body?.style || '').trim()
  const purpose = IMAGE_PURPOSES.has(req.body?.purpose) ? req.body.purpose : null

  const result = await createStudioImage(req.file.buffer, {
    style,
    color: req.body?.color,
    purpose,
  })

  res.json({
    success: true,
    data: {
      image: `data:${result.contentType};base64,${result.buffer.toString('base64')}`,
      contentType: result.contentType,
      size: result.buffer.length,
      style,
      purpose,
    },
  })
})
