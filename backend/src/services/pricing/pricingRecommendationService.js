// 📁 src/services/pricing/pricingRecommendationService.js
//
// El orquestador. Une las cuatro piezas en el orden que las hace seguras y
// pagables:
//
//   señales (aritmética)  →  ¿amerita?  →  Gemini  →  política
//
// Cada paso puede terminar el flujo. La mayoría de los productos no llega al
// segundo, y ese es el punto: en un catálogo de 10.000, los que tienen algo
// raro son decenas. La llamada a la IA es el recurso caro y se gasta última.

import PricingPolicy from '../../models/pricingPolicyModel.js'
import Product from '../../models/productModel.js'
import { PRICE_CHANGE_SOURCE } from '../../models/productPriceHistoryModel.js'
import { buildPricingSignals } from './pricingSignalService.js'
import { analyzePricingWithAI } from './pricingAiService.js'
import { applyPricingPolicy, PRICING_ACTION } from './pricingPolicyService.js'

/**
 * Recomendación de precio para un producto.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.productId
 * @param {boolean} [params.force] - analizar aunque no haya señales. Cuesta
 *   una llamada de IA, así que solo debería venir de una acción explícita del
 *   comerciante sobre un producto puntual, nunca de un recorrido masivo.
 */
export const recommendPriceForProduct = async ({ tenantId, productId, force = false }) => {
  const policy = await PricingPolicy.forTenant(tenantId)
  const signals = await buildPricingSignals({ tenantId, productId, policy })

  if (!signals) {
    return { found: false }
  }

  // Sin señales no se gasta IA. El comerciante igual recibe los indicadores:
  // "este producto está bien" es una respuesta útil y sale gratis.
  if (!signals.warrantsAnalysis && !force) {
    return {
      found: true,
      signals,
      policy: { strategy: policy.strategy, mode: policy.mode },
      analyzed: false,
      recommendation: null,
      decision: {
        action: PRICING_ACTION.HOLD,
        finalPrice: signals.price,
        changePercent: 0,
        requiresApproval: false,
        adjustments: [],
      },
    }
  }

  const ai = await analyzePricingWithAI({ tenantId, signals, policy })

  if (ai.blocked) {
    // Cuota agotada: se devuelven las señales igual. El análisis determinístico
    // ya vale sin la explicación de la IA.
    return {
      found: true,
      signals,
      policy: { strategy: policy.strategy, mode: policy.mode },
      analyzed: false,
      blocked: true,
      reason: ai.reason,
      message: ai.message,
      recommendation: null,
      decision: null,
    }
  }

  if (!ai.available) {
    return {
      found: true,
      signals,
      policy: { strategy: policy.strategy, mode: policy.mode },
      analyzed: false,
      reason: ai.reason,
      recommendation: null,
      decision: null,
    }
  }

  // La IA propuso; la política decide. Lo que el comerciante ve como
  // "precio recomendado" sale de acá, no del modelo.
  const decision = applyPricingPolicy({
    recommendation: ai.recommendation,
    policy,
    signals,
  })

  return {
    found: true,
    signals,
    policy: { strategy: policy.strategy, mode: policy.mode },
    analyzed: true,
    tokensUsed: ai.tokensUsed,
    // La propuesta cruda se devuelve además de la decisión: si la política la
    // recortó, el comerciante tiene derecho a ver qué se había propuesto y por
    // qué no se aplicó tal cual.
    recommendation: ai.recommendation,
    decision,
  }
}

const round2 = value => Math.round(Number(value) * 100) / 100

/**
 * Aplica un precio al producto. Es el paso que faltaba.
 *
 * El motor calculaba la recomendación, la pantalla la mostraba… y no había
 * forma de aplicarla: ni botón ni endpoint. Alguien miraba "precio recomendado
 * $12.900", se iba a Editar producto y lo tipeaba a mano — perdiendo, de paso,
 * el rastro de que ese cambio salió de una recomendación, que es justo lo que
 * después permite medir si sirvió.
 *
 * Las guardas son las mismas que ya usa la política, revalidadas acá: entre el
 * momento en que se muestra la recomendación y el clic pueden pasar minutos, y
 * el precio o el costo pueden haber cambiado.
 */
export const applyRecommendedPrice = async ({
  tenantId,
  productId,
  price,
  reason = '',
  userId = null,
}) => {
  const requestedPrice = round2(price)

  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
    const error = new Error('El precio tiene que ser un número mayor a cero')
    error.statusCode = 400
    throw error
  }

  const product = await Product.findOne({ _id: productId, tenantId }).setOptions({
    tenantId,
  })

  if (!product) {
    const error = new Error('Producto no encontrado')
    error.statusCode = 404
    throw error
  }

  const previousPrice = Number(product.price) || 0

  if (previousPrice === requestedPrice) {
    const error = new Error('El precio nuevo es igual al actual')
    error.statusCode = 409
    throw error
  }

  // Nunca por debajo del costo cuando hay costo cargado. No es una preferencia
  // de la política: es vender perdiendo plata en cada unidad.
  const unitCost = Number(product.costoUnitario)

  if (Number.isFinite(unitCost) && unitCost > 0 && requestedPrice < unitCost) {
    const error = new Error(
      `Ese precio ($${requestedPrice}) queda por debajo del costo cargado ($${unitCost}): cada venta perdería plata`,
    )
    error.statusCode = 409
    throw error
  }

  const policy = await PricingPolicy.forTenant(tenantId)

  if (policy.priceFloor && requestedPrice < policy.priceFloor) {
    const error = new Error(
      `Tu política fija un precio mínimo de $${policy.priceFloor} y este queda abajo`,
    )
    error.statusCode = 409
    throw error
  }

  if (policy.priceCeiling && requestedPrice > policy.priceCeiling) {
    const error = new Error(
      `Tu política fija un precio máximo de $${policy.priceCeiling} y este queda arriba`,
    )
    error.statusCode = 409
    throw error
  }

  // El hook post('save') de productModel escribe el historial solo; lo que
  // necesita de acá es el CONTEXTO: que el cambio salió de una recomendación y
  // no de alguien tipeando. Sin esto quedaría registrado como 'unknown' y no se
  // podría medir después si las recomendaciones sirven.
  product.$locals.priceChange = {
    source: PRICE_CHANGE_SOURCE.AI_RECOMMENDATION,
    reason: String(reason || '').slice(0, 300),
    userId,
  }

  const ratio = requestedPrice / previousPrice
  let variantsUpdated = 0

  product.price = requestedPrice

  // Las variantes se mueven en la misma proporción: si no, un producto con
  // variantes queda con el precio base cambiado y las variantes en el viejo,
  // que es lo que el comprador termina pagando.
  if (product.hasVariants && Array.isArray(product.variants)) {
    for (const variant of product.variants) {
      if (variant.isActive === false) continue
      variant.price = round2(Number(variant.price || 0) * ratio)
      variantsUpdated += 1
    }
  }

  await product.save()

  return {
    productId: String(product._id),
    title: product.title,
    previousPrice,
    newPrice: product.price,
    changePercent: round2(((product.price - previousPrice) / previousPrice) * 100),
    variantsUpdated,
  }
}
