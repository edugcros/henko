// 📁 src/controller/socialPromotionCtrl.js
//
// Kit de contenido para redes sociales — genera caption + hashtags para un
// producto vía IA. No publica nada por sí solo (ver
// services/ai/socialCaptionService.js para el porqué); el comercio copia el
// texto y lo postea desde su propia cuenta.

import expressAsyncHandler from 'express-async-handler'
import Product from '../models/productModel.js'
import {
  AI_METRICS,
  buildBudgetDenialMessage,
  recordAiConsumption,
  refundAiBudget,
  reserveAiBudget,
} from '../services/ai/aiBudgetService.js'
import { resolveTenantAiCredentials } from '../services/ai/aiCredentialsService.js'
import { generateSocialCaption } from '../services/ai/socialCaptionService.js'
import { isValidObjectId } from '../utils/requestContext.js'
import logger from '../../config/logger.js'

const getMainImageUrl = product => {
  const images = Array.isArray(product?.images) ? product.images : []
  const main = images.find(image => image?.isMain) || images[0]
  return main?.url || ''
}

export const generateProductSocialContent = expressAsyncHandler(async (req, res) => {
  const { id } = req.params
  const tenantId = String(req.user?.tenantId || req.tenantId || '').trim()

  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'ID de producto inválido' })
  }

  const product = await Product.findOne({ _id: id, tenantId }).lean()

  if (!product) {
    return res.status(404).json({ success: false, message: 'Producto no encontrado' })
  }

  // Igual que generate-variation en imageAiCtrl: el middleware de la ruta ya
  // cortó temprano a quien no tiene cupo; esta es la reserva atómica pegada
  // a la llamada real, para no cobrar por trabajo que después no ocurre.
  const reservation = await reserveAiBudget({
    tenantId,
    metric: AI_METRICS.AGENT_MESSAGES,
    guards: [AI_METRICS.AGENT_TOKENS],
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

    result = await generateSocialCaption(product, {
      apiKey: credentials.apiKey,
      storeName: req.tenant?.name,
    })
  } catch (error) {
    // El proveedor no entregó nada: no se cobra el mensaje reservado.
    await refundAiBudget({ tenantId, metric: AI_METRICS.AGENT_MESSAGES })

    logger.error('❌ Error generando contenido social', {
      tenantId,
      productId: id,
      message: error.message,
      code: error.code,
      rawContentSnippet: error.rawContentSnippet,
    })

    throw error
  }

  if (result.tokensUsed > 0) {
    await recordAiConsumption({
      tenantId,
      metric: AI_METRICS.AGENT_TOKENS,
      amount: result.tokensUsed,
    })
  }

  return res.json({
    success: true,
    data: {
      caption: result.caption,
      hashtags: result.hashtags,
      imageUrl: getMainImageUrl(product),
      productTitle: product.title,
    },
  })
})

export default { generateProductSocialContent }
