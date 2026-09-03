/**
 * profitabilityEngine.js
 *
 * Convierte costos declarados por el comercio + precios reales del mercado
 * en margen, precio de equilibrio y posición competitiva.
 *
 * Es matemática pura y determinística: mismos inputs, mismo resultado. No
 * interviene ningún LLM. Es la única parte del sistema que produce números
 * en pesos, así que cualquier error acá se traduce directo en una decisión
 * comercial equivocada.
 *
 * ═══════════════════════════════════════════════════════════════════
 * LÍMITE IMPORTANTE — ESTO NO ES CONTABILIDAD
 *
 * El tratamiento impositivo es una SIMPLIFICACIÓN. Se aplica el porcentaje
 * declarado sobre el precio de venta, como un costo más. En la realidad
 * argentina eso no es exacto:
 *
 *   - Un responsable inscripto computa crédito fiscal por el IVA de la
 *     compra, así que su carga efectiva es sobre el valor agregado, no
 *     sobre el precio de venta completo.
 *   - Ingresos Brutos varía por jurisdicción y actividad.
 *   - Puede haber percepciones y retenciones que este cálculo ignora.
 *
 * Sirve para comparar productos entre sí y descartar los que claramente no
 * cierran. NO reemplaza a un contador para decidir precios finales.
 * ═══════════════════════════════════════════════════════════════════
 */

export const PROFITABILITY_VERSION = 1

/**
 * @typedef {Object} CostInputs
 * @property {number} unitCost          - costo de adquisición por unidad
 * @property {number} [shippingCost=0]  - logística por unidad
 * @property {number} [platformFeePercent=0] - comisión de plataforma/pago (0-100)
 * @property {number} [taxPercent=0]    - carga impositiva estimada (0-100)
 * @property {number} [targetPrice]     - precio propio a evaluar; si falta se usa la mediana
 */

/**
 * @param {CostInputs} costs
 * @param {Object} priceStats - de shoppingSource: min, p25, median, p75, max
 * @returns {Object|null} null si faltan datos para calcular
 */
export function calculateProfitability(costs, priceStats) {
  const unitCost = positiveNumber(costs?.unitCost)

  // Sin costo no hay rentabilidad posible. Devolver 0 o estimar un costo
  // sería inventar el dato central del cálculo.
  if (unitCost === null) return null

  const shippingCost = positiveNumber(costs?.shippingCost) ?? 0
  const feeRate = percentToRate(costs?.platformFeePercent)
  const taxRate = percentToRate(costs?.taxPercent)

  const totalUnitCost = unitCost + shippingCost
  const deductionRate = feeRate + taxRate

  // Si comisiones + impuestos se llevan el 100% o más, no existe precio que
  // deje ganancia: cada peso de aumento se lo consume la deducción.
  if (deductionRate >= 1) {
    return {
      version: PROFITABILITY_VERSION,
      viable: false,
      reason: 'DEDUCCIONES_EXCEDEN_INGRESO',
      message: 'Las comisiones e impuestos declarados suman 100% o más del precio de venta. Revisá esos porcentajes.',
      totalUnitCost,
      breakEvenPrice: null,
      scenarios: null,
      marketPosition: null,
    }
  }

  // Precio al que el resultado es exactamente cero:
  //   P - P·fee - P·tax - costo = 0  →  P = costo / (1 - fee - tax)
  const breakEvenPrice = totalUnitCost / (1 - deductionRate)

  const scenarios = priceStats
    ? {
      atMin: evaluatePrice(priceStats.min, { totalUnitCost, deductionRate }),
      atP25: evaluatePrice(priceStats.p25, { totalUnitCost, deductionRate }),
      atMedian: evaluatePrice(priceStats.median, { totalUnitCost, deductionRate }),
      atP75: evaluatePrice(priceStats.p75, { totalUnitCost, deductionRate }),
    }
    : null

  const targetPrice = positiveNumber(costs?.targetPrice)
  const atTargetPrice = targetPrice
    ? evaluatePrice(targetPrice, { totalUnitCost, deductionRate })
    : null

  return {
    version: PROFITABILITY_VERSION,
    viable: true,
    currency: priceStats?.currency || null,
    totalUnitCost,
    breakEvenPrice,
    deductionRate,
    scenarios,
    atTargetPrice,
    marketPosition: priceStats ? assessMarketPosition(breakEvenPrice, priceStats) : null,
    sampleSize: priceStats?.sampleSize ?? 0,
  }
}

/** Resultado de vender una unidad a un precio dado. */
function evaluatePrice(price, { totalUnitCost, deductionRate }) {
  if (!Number.isFinite(price) || price <= 0) return null

  const deductions = price * deductionRate
  const netRevenue = price - deductions
  const profit = netRevenue - totalUnitCost

  return {
    price,
    deductions,
    netRevenue,
    profit,
    // Margen sobre precio de venta (no markup sobre costo): es la métrica
    // que se compara entre productos de precios distintos.
    marginPercent: (profit / price) * 100,
    profitable: profit > 0,
  }
}

/**
 * Dónde queda el punto de equilibrio dentro de la distribución de precios
 * del mercado. Es la respuesta a "¿puedo competir acá?".
 */
function assessMarketPosition(breakEvenPrice, priceStats) {
  const { min, p25, median, p75 } = priceStats

  if (breakEvenPrice > priceStats.max) {
    return {
      level: 'INVIABLE',
      message: 'Tu costo supera el precio más alto del mercado. No hay precio al que puedas vender con ganancia.',
    }
  }

  if (breakEvenPrice > median) {
    return {
      level: 'MUY_AJUSTADO',
      message: 'Necesitás vender por encima de la mediana del mercado solo para no perder. Competir por precio no es opción.',
    }
  }

  if (breakEvenPrice > p25) {
    return {
      level: 'AJUSTADO',
      message: 'Tenés margen, pero quedás en la mitad cara del mercado. Vas a competir contra opciones más baratas.',
    }
  }

  if (breakEvenPrice > min) {
    return {
      level: 'COMPETITIVO',
      message: 'Podés ubicarte en el cuartil barato del mercado y seguir ganando.',
    }
  }

  return {
    level: 'MUY_COMPETITIVO',
    message: 'Tu costo queda por debajo del precio más bajo publicado. Tenés espacio amplio de maniobra.',
  }
}

function positiveNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Acepta 21 o 0.21 como 21%: los usuarios escriben las dos formas. */
function percentToRate(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed > 1 ? parsed / 100 : parsed
}
