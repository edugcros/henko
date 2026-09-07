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
