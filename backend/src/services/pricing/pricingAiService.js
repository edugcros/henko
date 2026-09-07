// 📁 src/services/pricing/pricingAiService.js
//
// La capa que razona. Recibe indicadores ya calculados y devuelve una
// recomendación estructurada.
//
// Lo que NO hace, a propósito:
//
//   - No calcula. El margen, la cobertura de stock y la variación de demanda
//     llegan resueltos desde pricingSignalService. Pedirle aritmética a un
//     modelo de lenguaje cuesta tokens y da un resultado menos confiable que
//     una división.
//
//   - No fija el precio. Devuelve una intención; pricingPolicyService decide
//     si es aplicable y la recorta contra los límites del comerciante. Que el
//     modelo proponga algo fuera de política es esperable, no un fallo.
//
//   - No se llama sola. Solo corre sobre productos con warrantsAnalysis, que
//     en un catálogo de 10.000 son decenas. Esa condición es la diferencia
//     medida entre USD 0,78 y USD 260 por comercio por mes.

import { callAgentLLM } from '../aiAgent/aiAgentLLMService.js'
import { loadTenantAiProfile } from '../ai/aiCredentialsService.js'
import {
  AI_METRICS,
  buildBudgetDenialMessage,
  reserveAiBudget,
  refundAiBudget,
  recordAiConsumption,
} from '../ai/aiBudgetService.js'
import { PRICING_ACTION } from './pricingPolicyService.js'
import logger from '../../../config/logger.js'

const RECOMMENDATION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['INCREASE', 'DECREASE', 'HOLD'] },
    recommendedPrice: { type: 'number' },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    expectedImpact: {
      type: 'object',
      properties: {
        marginPercent: { type: 'number' },
        sellThroughChangePercent: { type: 'number' },
      },
    },
  },
  required: ['action', 'recommendedPrice', 'confidence', 'reason'],
}

const FLAG_TEXT = {
  margin_below_min: 'el margen está por debajo del mínimo que fijó el comercio',
  margin_below_target: 'el margen está por debajo del objetivo',
  no_cost: 'el producto no tiene costo cargado',
  stock_stuck: 'el stock no rota',
  stock_critical: 'vendía y dejó de vender teniendo stock',
  demand_falling: 'la demanda cayó',
  demand_rising: 'la demanda subió',
  cost_increased: 'el costo subió desde el último cambio de precio',
}

const STRATEGY_TEXT = {
  margin: 'proteger la rentabilidad por sobre el volumen',
  rotation: 'mover stock aunque resigne algo de margen',
  liquidate: 'vaciar inventario, priorizando la venta sobre el margen',
  revenue: 'maximizar facturación total',
  competitive: 'defender la posición de precio frente a la competencia',
}

const SYSTEM_PROMPT = `Sos un analista de pricing para comercios argentinos.

Recibís indicadores YA CALCULADOS de un producto. No recalcules nada: los
números que te llegan son correctos y son la única fuente. No inventes datos
que no estén en el input — si algo no está, no existe para tu análisis.

Tu tarea es explicar qué está pasando y proponer un precio.

Reglas:
- Respondé SIEMPRE en el esquema JSON pedido, sin texto alrededor.
- "reason" en español rioplatense, una o dos oraciones, concreto: citá los
  números que justifican la decisión. Nada de generalidades.
- "confidence" entre 0 y 1. Bajala cuando las señales se contradicen o la
  muestra de ventas es chica.
- Si las señales no alcanzan para justificar un cambio, devolvé HOLD con el
  precio actual. HOLD es una respuesta válida y frecuente.
- El precio que propongas puede quedar fuera de los límites del comercio: el
  sistema lo va a recortar después. No mientas para que entre.`

const buildUserPrompt = ({ signals, policy }) => {
  const money = v => (Number.isFinite(v) ? `$${Math.round(v).toLocaleString('es-AR')}` : 'sin dato')
  const pct = v => (Number.isFinite(v) ? `${v}%` : 'sin dato')

  const lines = [
    `PRODUCTO: ${signals.title}`,
    `Precio actual: ${money(signals.price)}`,
    `Stock: ${signals.stock} unidades`,
    '',
    'COSTOS',
    signals.cost
      ? [
        `Costo total por unidad: ${money(signals.cost.totalUnitCost)}`,
        `Precio de equilibrio: ${money(signals.cost.breakEvenPrice)}`,
        `Deducciones (comisiones + impuestos): ${pct(Math.round((signals.cost.deductionRate || 0) * 100))}`,
        `Margen actual: ${pct(signals.marginPercent)}`,
      ].join('\n')
      : 'Sin costo cargado: no se puede evaluar margen.',
    '',
    'DEMANDA',
    `Vendidas últimos 30 días: ${signals.demand.unitsLast30}`,
    `Vendidas 30 días previos: ${signals.demand.unitsPrior30}`,
    `Variación: ${pct(signals.demand.changePercent)}`,
    signals.demand.stockCoverageDays !== null
      ? `Cobertura de stock al ritmo actual: ${signals.demand.stockCoverageDays} días`
      : 'Cobertura de stock: sin ventas en el período, no calculable',
  ]

  if (signals.costChangePercent !== null) {
    lines.push('', `El costo varió ${pct(signals.costChangePercent)} desde el último cambio de precio.`)
  }

  if (signals.lastPriceChange) {
    const p = signals.lastPriceChange
    lines.push(
      `Último cambio de precio: ${money(p.previousPrice)} → ${money(p.newPrice)} (${pct(p.changePercent)})${p.reason ? `, motivo: ${p.reason}` : ''}.`,
    )
  }

  lines.push(
    '',
    'SEÑALES DETECTADAS',
    ...signals.flags.map(f => `- ${FLAG_TEXT[f] || f}`),
    '',
    'POLÍTICA DEL COMERCIO',
    `Estrategia: ${STRATEGY_TEXT[policy.strategy] || policy.strategy}`,
    `Margen mínimo: ${policy.minMarginPercent}% · objetivo: ${policy.targetMarginPercent}%`,
    `Variación máxima permitida por ajuste: ±${policy.maxChangePercent}%`,
  )

  return lines.join('\n')
}

/**
 * Recomendación de precio para un producto que ya pasó el filtro.
 *
 * @returns {Promise<Object>} { blocked } si no hay cuota, { available:false }
 *   si el proveedor falló, o la recomendación cruda del modelo.
 */
export const analyzePricingWithAI = async ({ tenantId, signals, policy }) => {
  if (!signals?.warrantsAnalysis) {
    // Defensa en profundidad: el llamador ya debería haber filtrado, pero una
    // llamada de más acá es plata.
    return { available: false, reason: 'SIN_SEÑALES' }
  }

  const profile = await loadTenantAiProfile(tenantId)

  const budget = await reserveAiBudget({
    tenantId,
    metric: AI_METRICS.MARKET_ANALYSES,
    amount: 1,
    // Mismo guard que el análisis de mercado: son el mismo presupuesto de
    // research, distinto del que consume el asistente de ventas.
    guards: [AI_METRICS.MARKET_TOKENS],
    profile,
  })

  if (!budget.allowed) {
    return {
      blocked: true,
      reason: budget.reason,
      message: buildBudgetDenialMessage(budget),
      budget,
    }
  }

  try {
    const result = await callAgentLLM({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt({ signals, policy }) }],
      conversationalMode: false,
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: RECOMMENDATION_SCHEMA,
      apiKey: profile.apiKey,
    })

    const tokensUsed = Number(result?.usageMetadata?.totalTokenCount || 0)

    // Los tokens se registran aunque el parseo falle: ya se gastaron contra la
    // API de Google, y no cobrarlos deja el presupuesto mintiendo.
    if (tokensUsed > 0) {
      await recordAiConsumption({
        tenantId,
        metric: AI_METRICS.MARKET_TOKENS,
        amount: tokensUsed,
        profile,
      }).catch(error => {
        logger.warn('[PRICING AI] No se pudo registrar el consumo de tokens', {
          tenantId: String(tenantId),
          error: error.message,
        })
      })
    }

    if (result?.fallback || !result?.content) {
      await refundAiBudget({ tenantId, metric: AI_METRICS.MARKET_ANALYSES, amount: 1 })
      return { available: false, reason: result?.error || 'sin respuesta del modelo' }
    }

    const parsed = parseRecommendation(result.content)

    if (!parsed) {
      await refundAiBudget({ tenantId, metric: AI_METRICS.MARKET_ANALYSES, amount: 1 })
      return { available: false, reason: 'respuesta ilegible del modelo' }
    }

    return { available: true, recommendation: parsed, tokensUsed }
  } catch (error) {
    // El proveedor falló después de reservarle cuota al comercio: no se le
    // cobra un análisis que no recibió.
    await refundAiBudget({ tenantId, metric: AI_METRICS.MARKET_ANALYSES, amount: 1 }).catch(
      () => undefined,
    )

    logger.error('[PRICING AI] Falló el análisis de precio', {
      tenantId: String(tenantId),
      productId: signals.productId,
      error: error.message,
    })

    return { available: false, reason: error.message }
  }
}

/**
 * Convierte la respuesta del modelo en una recomendación utilizable, o null.
 *
 * Se valida acá y no se confía en responseSchema: el esquema es una
 * indicación al modelo, no una garantía del contenido. Un precio negativo o
 * una confianza de 7 llegan igual si el modelo se equivoca.
 */
export const parseRecommendation = raw => {
  let data = raw

  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }

  if (!data || typeof data !== 'object') return null

  const action = String(data.action || '').toUpperCase()
  if (!Object.values(PRICING_ACTION).includes(action)) return null

  const recommendedPrice = Number(data.recommendedPrice)
  if (!Number.isFinite(recommendedPrice) || recommendedPrice < 0) return null

  const confidence = Number(data.confidence)

  return {
    action,
    recommendedPrice,
    // Fuera de rango se trata como desconocido y no se recorta a 1: una
    // confianza inventada por el modelo no mejora por acotarla.
    confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
      ? confidence
      : null,
    reason: typeof data.reason === 'string' ? data.reason.trim().slice(0, 600) : '',
    expectedImpact: {
      marginPercent: Number.isFinite(Number(data.expectedImpact?.marginPercent))
        ? Number(data.expectedImpact.marginPercent)
        : null,
      sellThroughChangePercent: Number.isFinite(
        Number(data.expectedImpact?.sellThroughChangePercent),
      )
        ? Number(data.expectedImpact.sellThroughChangePercent)
        : null,
    },
  }
}
