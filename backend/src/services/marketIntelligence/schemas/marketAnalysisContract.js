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
    demandClassification: classifyDemandScore(doc.demandScore, doc.breakdown),
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
    recommendation: buildRecommendation(
      doc.demandScore,
      doc.confidenceScore,
      doc.breakdown,
    ),
    profitability: doc.profitability ?? null,
    priceStats: doc.rawSignals?.shopping?.priceStats ?? null,
    // Las ofertas concretas, no solo el conteo: sin poder ver quién vende y
    // a cuánto, el comercio no tiene forma de juzgar si la muestra es
    // representativa de su mercado.
    offers: doc.rawSignals?.shopping?.offers ?? [],
    // Qué contestó cada fuente y, si no contestó, por qué — en castellano.
    // El panel mostraba el error crudo de Google ("You exceeded your current
    // quota, please check your plan and billing details…") al comerciante.
    sources: describeSources(doc.rawSignals),
    generatedAt: doc.generatedAt,
  }
}

const SOURCE_LABELS = {
  shopping: 'Buscador de precios',
  gemini: 'Búsqueda con IA',
  internal: 'Tu tienda',
}

const SOURCE_ROLES = {
  shopping: 'Precios y vendedores publicados hoy en Google Shopping.',
  gemini: 'Interés de búsqueda, tendencia, marcas y quejas de compradores.',
  internal: 'Tus ventas, tu stock y la rotación de la categoría.',
}

/**
 * Traduce el estado de cada fuente a algo accionable.
 *
 * Un "NO_DISPONIBLE" seguido del error literal del proveedor no le dice al
 * comerciante ni qué se perdió del análisis ni qué puede hacer. Cada motivo
 * de acá nombra las dos cosas.
 */
function describeSources(rawSignals = {}) {
  return ['shopping', 'gemini', 'internal'].map(key => {
    const signal = rawSignals?.[key] || null
    const available = Boolean(signal?.available)

    return {
      key,
      label: SOURCE_LABELS[key],
      role: SOURCE_ROLES[key],
      available,
      detail: available
        ? describeSuccess(key, signal)
        : explainFailure(signal?.reason || signal?.error || ''),
    }
  })
}

function describeSuccess(key, signal) {
  if (key === 'shopping') {
    const offers = Number(signal.offerCount || 0)
    if (offers === 0) return 'Respondió, pero nadie publica este producto online en ese país.'
    return `${offers} ofertas de ${Number(signal.merchantCount || 0)} vendedores distintos.`
  }

  if (key === 'internal') {
    return signal.isInCatalog
      ? `Está en tu catálogo: ${signal.unitsSoldLast90Days ?? 0} unidades vendidas en 90 días.`
      : 'No tenés este producto en tu catálogo.'
  }

  return 'Respondió con señales de mercado.'
}

function explainFailure(reason) {
  const text = String(reason || '')

  if (/exceeded your current quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(text)) {
    return 'La clave de IA llegó al límite de consultas de Google. Se renueva sola, o se amplía habilitando facturación en la clave.'
  }

  if (/no longer available|not found|NOT_FOUND|deprecat/i.test(text)) {
    return 'El modelo de IA configurado ya no existe. Hay que actualizarlo en Configuración del agente.'
  }

  if (/API key|API_KEY_INVALID|PERMISSION_DENIED|credencial/i.test(text)) {
    return 'La clave de IA no es válida o no tiene permisos. Revisala en Configuración del agente.'
  }

  if (/JSON válido|no se pudo estructurar/i.test(text)) {
    return 'La IA contestó, pero no en el formato esperado. Volvé a analizar y suele resolverse.'
  }

  if (/MercadoLibre/i.test(text)) {
    return 'MercadoLibre cerró su buscador a integraciones externas. No hay forma de consultarlo.'
  }

  if (/SHOPPING_PROVIDER|no implementado|deshabilitado/i.test(text)) {
    return 'El buscador de precios está apagado en la configuración del servidor.'
  }

  if (/sin dominio de Google mapeado/i.test(text)) {
    return 'Ese país todavía no tiene buscador de precios configurado.'
  }

  if (/no devolvió resultados/i.test(text)) {
    return 'El buscador de precios no respondió. Suele ser momentáneo: volvé a intentar.'
  }

  if (/palabras significativas/i.test(text)) {
    return 'El texto buscado no tiene palabras con las que buscar en tu catálogo.'
  }

  return text ? 'No respondió en esta consulta.' : 'No participó de esta consulta.'
}

function classifyDemandScore(score, breakdown = {}) {
  // null = no se pudo medir con las fuentes disponibles. Distinto de
  // "demanda baja", que es una medición real de poca demanda.
  if (score === null || score === undefined) return 'No se pudo medir'

  // El puntaje existe, pero el componente de demanda no se midió: lo que se
  // midió es el mercado alrededor del producto —cuántos lo venden, a cuánto,
  // qué tan activo está—. Llamarlo "demanda alta" sería ponerle nombre de
  // demanda a otra cosa.
  if (breakdown?.demand === null || breakdown?.demand === undefined) {
    return 'Actividad del mercado (la demanda no se pudo medir)'
  }
  if (score >= 90) return 'Demanda excepcional'
  if (score >= 75) return 'Demanda alta'
  if (score >= 60) return 'Demanda moderada'
  if (score >= 40) return 'Demanda débil o incierta'
  return 'Demanda baja'
}

function buildRecommendation(demandScore, confidenceScore, breakdown = {}) {
  if (demandScore === null || demandScore === undefined) return 'DATOS INSUFICIENTES'
  if (confidenceScore < 40) return 'DATOS INSUFICIENTES'

  // "No conviene" es una afirmación sobre la demanda. Si justamente la demanda
  // no se pudo medir —pasa cada vez que la búsqueda con IA no responde—, decir
  // eso es inventar la conclusión: lo medido fue el mercado alrededor del
  // producto, no cuánta gente lo quiere.
  if (breakdown?.demand === null || breakdown?.demand === undefined) {
    return 'FALTA MEDIR LA DEMANDA'
  }

  if (demandScore >= 75) return 'RECOMENDADO'
  if (demandScore >= 50) return 'RECOMENDADO CON CONDICIONES'
  return 'NO RECOMENDADO'
}

// TODO: agregar un renderer separado (p.ej. marketAnalysisPresenter.js) que
// tome este contrato y genere el texto completo de la sección 13 (🔎 📊 📈
// 🔥 🛒 🏆 💬 💡 ⚠️ 🎯 🚀) para consumo del WhatsApp agent o del admin panel.
// No mezclar esa redacción con este archivo — este es el contrato de datos.

export { buildMarketAnalysisResponse }
