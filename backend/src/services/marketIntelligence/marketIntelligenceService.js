/**
 * marketIntelligenceService.js
 *
 * Orquestador del HENKO Market Intelligence Agent.
 *
 * Coordina fuentes de datos (MELI, Gemini grounding, BI interna del tenant),
 * pasa sus outputs crudos al scoring determinístico y devuelve un contrato
 * de respuesta estable.
 *
 * DOS REGLAS NO NEGOCIABLES:
 *
 * 1. El score NUNCA lo calcula un LLM. Gemini solo produce señales
 *    estructuradas; el cálculo vive en scoring/demandScoreEngine.js.
 *
 * 2. Todo consumo de Gemini pasa por aiBudgetService, igual que el agente de
 *    ventas y el análisis de imágenes. Sin esto, el análisis de mercado
 *    quemaría la key compartida sin aparecer en ningún medidor, y podría
 *    hacer saltar el disyuntor de plataforma dejando sin asistente a todos
 *    los comercios.
 */

import logger from '../../../config/logger.js'
import { loadTenantAiProfile } from '../ai/aiCredentialsService.js'
import {
  AI_METRICS,
  reserveAiBudget,
  refundAiBudget,
  recordAiConsumption,
  buildBudgetDenialMessage,
} from '../ai/aiBudgetService.js'

import { getMeliSignals } from './sources/meliSource.js'
import { getShoppingSignals } from './sources/shoppingSource.js'
import { getGroundingSignals } from './sources/geminiGroundingSource.js'
import { getInternalBiSignals } from './sources/internalBiSource.js'
import { calculateDemandScore, SCORING_VERSION } from './scoring/demandScoreEngine.js'
import { classifyTrend } from './scoring/trendClassifier.js'
import { calculateConfidence } from './scoring/confidenceCalculator.js'
import { calculateProfitability } from './scoring/profitabilityEngine.js'
import { buildMarketAnalysisResponse } from './schemas/marketAnalysisContract.js'
import MarketAnalysis from './schemas/MarketAnalysis.js'

const CACHE_TTL_HOURS = 24

/**
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.product        - Producto, categoría o keyword
 * @param {string} [params.country='AR'] - Mercado objetivo (ISO-2)
 * @param {boolean} [params.forceRefresh=false]
 */
export async function analyzeMarketDemand({
  tenantId,
  product,
  country = 'AR',
  forceRefresh = false,
  costs = null,
}) {
  if (!tenantId) throw new Error('tenantId es requerido: el análisis nunca corre sin contexto de tenant')
  if (!product || typeof product !== 'string') throw new Error('product es requerido y debe ser string')

  const normalizedQuery = normalizeProductQuery(product)

  // El cache se consulta ANTES de reservar cuota: servir un análisis guardado
  // no consume Gemini, así que cobrarlo sería cobrar dos veces lo mismo.
  if (!forceRefresh) {
    // El filtro incluye scoringVersion: un análisis calculado con una
    // fórmula anterior no se sirve nunca, aunque siga dentro del TTL.
    const cached = await MarketAnalysis.findOne({
      tenantId,
      normalizedQuery,
      country,
      scoringVersion: SCORING_VERSION,
      expiresAt: { $gt: new Date() },
    })
      .setOptions({ tenantId })
      .lean()

    if (cached) {
      logger.info('[marketIntelligence] cache hit', { normalizedQuery, country, tenantId: String(tenantId) })

      // La rentabilidad NO se sirve desde cache: depende de los costos que
      // el comercio ingresó en ESTA consulta, no en la que llenó el cache.
      // Los precios de mercado sí se reutilizan — esos no cambian por quién
      // pregunta. Así el usuario puede probar varios escenarios de costo sin
      // gastar una consulta al proveedor de scraping por cada uno.
      const recalculated = costs
        ? calculateProfitability(costs, cached.rawSignals?.shopping?.priceStats || null)
        : null

      return {
        ...buildMarketAnalysisResponse({ ...cached, profitability: recalculated }),
        fromCache: true,
      }
    }
  }

  // Un solo load del perfil, reutilizado en reserva, credencial y registro:
  // loadTenantAiProfile cachea 60s, pero pasarlo explícito evita 3 lecturas.
  const profile = await loadTenantAiProfile(tenantId)

  // El guard impide seguir si ya se agotó el presupuesto de tokens de
  // análisis del mes — mismo criterio que usa el agente para no contestar
  // un mensaje más cuando se pasó de sus propios tokens.
  const budget = await reserveAiBudget({
    tenantId,
    metric: AI_METRICS.MARKET_ANALYSES,
    amount: 1,
    // El guard es MARKET_TOKENS: un tenant que agotó el presupuesto de
    // tokens de análisis no puede seguir. No se usa AGENT_TOKENS acá para
    // no dejar sin research a alguien cuyo bot de ventas tuvo un mes activo
    // — son productos distintos con presupuestos distintos.
    guards: [AI_METRICS.MARKET_TOKENS],
    profile,
  })

  if (!budget.allowed) {
    logger.info('[marketIntelligence] análisis bloqueado por cuota', {
      tenantId: String(tenantId),
      reason: budget.reason,
    })

    return {
      blocked: true,
      reason: budget.reason,
      message: buildBudgetDenialMessage(budget),
      budget: {
        metric: budget.metric,
        limit: budget.limit,
        used: budget.used,
        remaining: budget.remaining,
      },
    }
  }

  // Las tres fuentes son independientes: el fallo de una degrada la confianza
  // pero no tumba el análisis. allSettled es intencional.
  const [meliResult, shoppingResult, groundingResult, internalResult] = await Promise.allSettled([
    getMeliSignals({ product, country }),
    getShoppingSignals({ product, country }),
    getGroundingSignals({ product, country, apiKey: profile.apiKey }),
    getInternalBiSignals({ tenantId, product }),
  ])

  const rawSignals = {
    meli: unwrapSettled(meliResult, 'meliSource'),
    shopping: unwrapSettled(shoppingResult, 'shoppingSource'),
    gemini: unwrapSettled(groundingResult, 'geminiGroundingSource'),
    internal: unwrapSettled(internalResult, 'internalBiSource'),
  }

  // Los tokens se registran SIEMPRE que se hayan gastado, incluso si el
  // análisis después falla: lo que ya se le pagó a Google no se recupera.
  //
  // Van a MARKET_TOKENS, no a AGENT_TOKENS: mezclarlos hacía que el panel
  // atribuyera al bot de WhatsApp un consumo que gastó esta herramienta.
  const tokensUsed = Number(rawSignals.gemini?.tokensUsed || 0)

  if (tokensUsed > 0) {
    await recordAiConsumption({
      tenantId,
      metric: AI_METRICS.MARKET_TOKENS,
      amount: tokensUsed,
      profile,
    })
  }

  const breakdown = calculateDemandScore(rawSignals)
  const trendClassification = classifyTrend(rawSignals)
  const confidenceScore = calculateConfidence(rawSignals, breakdown.measuredWeight)

  // Rentabilidad: solo si el comercio declaró su costo. Sin ese dato no se
  // calcula ni se estima — un margen inventado es peor que ningún margen.
  const profitability = costs
    ? calculateProfitability(costs, rawSignals.shopping?.priceStats || null)
    : null

  // Refund solo si el análisis no produjo NADA. Con fuentes externas caídas
  // pero BI interna suficiente sí hay un resultado útil (limitado al propio
  // catálogo), así que ahí el consumo se cobra: el trabajo se hizo.
  const noExternalSources =
    !rawSignals.shopping?.available && !rawSignals.gemini?.available
  const producedNothing = breakdown.total === null

  if (producedNothing) {
    await refundAiBudget({ tenantId, metric: AI_METRICS.MARKET_ANALYSES, amount: 1 })

    logger.warn('[marketIntelligence] cobertura insuficiente, reserva devuelta', {
      tenantId: String(tenantId),
      normalizedQuery,
      meli: rawSignals.meli?.reason || rawSignals.meli?.error,
      gemini: rawSignals.gemini?.reason || rawSignals.gemini?.error,
    })
  } else if (noExternalSources) {
    logger.info('[marketIntelligence] análisis basado solo en datos internos del tenant', {
      tenantId: String(tenantId),
      normalizedQuery,
      measuredWeight: breakdown.measuredWeight,
    })
  }

  const analysisDoc = {
    tenantId,
    product,
    normalizedQuery,
    country,
    demandScore: breakdown.total, // null si nada fue medible
    confidenceScore,
    trendClassification,
    breakdown: breakdown.components,
    scoringVersion: SCORING_VERSION,
    measuredWeight: breakdown.measuredWeight,
    unmeasured: breakdown.unmeasured,
    degenerate: breakdown.degenerate ?? false,
    rawSignals,
    profitability,
    generatedAt: new Date(),
    expiresAt: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000),
  }

  if (breakdown.total !== null) {
    // tenantId va en el filtro y en setOnInsert, NUNCA en $set: el
    // tenantPlugin bloquea cualquier update que intente modificarlo.
    const { tenantId: _omit, ...updatableFields } = analysisDoc

    // El filtro NO incluye scoringVersion a propósito: queremos un solo
    // documento por (tenant, query, país), y que un recálculo con fórmula
    // nueva PISE al de la fórmula vieja. Si scoringVersion estuviera acá,
    // cada cambio de versión dejaría un documento huérfano más por producto,
    // que nadie volvería a leer pero seguiría ocupando espacio hasta el TTL.
    await MarketAnalysis.findOneAndUpdate(
      { tenantId, normalizedQuery, country },
      {
        $set: updatableFields,
        $setOnInsert: { tenantId },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ).setOptions({ tenantId })
  }

  return buildMarketAnalysisResponse(analysisDoc)
}

function normalizeProductQuery(product) {
  return product.trim().toLowerCase().replace(/\s+/g, ' ')
}

function unwrapSettled(settledResult, sourceName) {
  if (settledResult.status === 'fulfilled') return settledResult.value

  logger.warn(`[marketIntelligence] fuente ${sourceName} falló`, {
    error: settledResult.reason?.message,
  })

  return { available: false, error: settledResult.reason?.message || 'NO_DISPONIBLE' }
}
