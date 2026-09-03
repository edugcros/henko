/**
 * marketAnalysisContract.js
 *
 * Define el shape de respuesta pública del servicio, independiente de si el
 * origen es un doc recién calculado o un doc de cache leído con .lean().
 * El controller HTTP (o el WhatsApp agent) consume esto, nunca el
 * documento Mongoose crudo.
 *
 * Este contrato es lo que eventualmente se usa para renderizar la
 * "RESPUESTA ESTÁNDAR" de la sección 13 del spec (Market Demand Score,
 * tendencia, actividad comercial, oportunidades, riesgos, conclusión,
 * recomendación) — la redacción en lenguaje natural de esas secciones es
 * responsabilidad de una capa de presentación separada (ver TODO abajo),
 * no de este archivo.
 */

import { TREND_LABELS } from '../scoring/trendClassifier.js'

/**
 * @param {Object} doc - documento de MarketAnalysis (recién creado o cacheado)
 * @returns {MarketAnalysisResponse}
 *
 * @typedef {Object} MarketAnalysisResponse
 * @property {string} product
 * @property {string} country
 * @property {number} demandScore
 * @property {string} demandClassification - "Demanda alta" | "moderada" | "baja" | etc.
 * @property {number} confidenceScore
 * @property {string} trendLabel - emoji + etiqueta, ver TREND_LABELS
 * @property {Object} breakdown
 * @property {Object} rawSignals
 * @property {string} recommendation - RECOMENDADO | RECOMENDADO CON CONDICIONES | NO RECOMENDADO | DATOS INSUFICIENTES
 * @property {Date} generatedAt
 */
function buildMarketAnalysisResponse(doc) {
  return {
    product: doc.product,
    country: doc.country,
    demandScore: doc.demandScore,
    demandClassification: classifyDemandScore(doc.demandScore),
    confidenceScore: doc.confidenceScore,
    trendLabel: TREND_LABELS[doc.trendClassification] || TREND_LABELS.INDETERMINADA,
    breakdown: doc.breakdown,
    measuredWeight: doc.measuredWeight ?? null,
    scoringVersion: doc.scoringVersion ?? null,
    degenerate: doc.degenerate ?? false,
    // true = el score sale solo de datos del propio comercio. Responde
    // "¿mis clientes quieren esto?", NO "¿el mercado quiere esto?". La UI
    // debe decirlo explícitamente: son preguntas distintas.
    internalOnly: !doc.rawSignals?.shopping?.available && !doc.rawSignals?.gemini?.available,
    unmeasured: doc.unmeasured ?? [],
    rawSignals: doc.rawSignals,
    recommendation: buildRecommendation(doc.demandScore, doc.confidenceScore),
    profitability: doc.profitability ?? null,
    priceStats: doc.rawSignals?.shopping?.priceStats ?? null,
    // Las ofertas concretas, no solo el conteo: sin poder ver quién vende y
    // a cuánto, el comercio no tiene forma de juzgar si la muestra es
    // representativa de su mercado.
    offers: doc.rawSignals?.shopping?.offers ?? [],
    generatedAt: doc.generatedAt,
  }
}

function classifyDemandScore(score) {
  // null = no se pudo medir con las fuentes disponibles. Distinto de
  // "demanda baja", que es una medición real de poca demanda.
  if (score === null || score === undefined) return 'No se pudo medir'
  if (score >= 90) return 'Demanda excepcional'
  if (score >= 75) return 'Demanda alta'
  if (score >= 60) return 'Demanda moderada'
  if (score >= 40) return 'Demanda débil o incierta'
  return 'Demanda baja'
}

function buildRecommendation(demandScore, confidenceScore) {
  if (demandScore === null || demandScore === undefined) return 'DATOS INSUFICIENTES'
  if (confidenceScore < 40) return 'DATOS INSUFICIENTES'
  if (demandScore >= 75) return 'RECOMENDADO'
  if (demandScore >= 50) return 'RECOMENDADO CON CONDICIONES'
  return 'NO RECOMENDADO'
}

// TODO: agregar un renderer separado (p.ej. marketAnalysisPresenter.js) que
// tome este contrato y genere el texto completo de la sección 13 (🔎 📊 📈
// 🔥 🛒 🏆 💬 💡 ⚠️ 🎯 🚀) para consumo del WhatsApp agent o del admin panel.
// No mezclar esa redacción con este archivo — este es el contrato de datos.

export { buildMarketAnalysisResponse }
