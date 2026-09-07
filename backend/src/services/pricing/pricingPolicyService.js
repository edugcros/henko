// 📁 src/services/pricing/pricingPolicyService.js
//
// Decide si una recomendación de precio está permitida.
//
// Es la pieza que hace segura a la IA. Gemini propone un número; acá se
// verifica contra los límites que puso el comerciante y se recorta si hace
// falta. El modelo nunca fija un precio: fija una intención que este archivo
// convierte —o no— en un precio aplicable.
//
// Todo recorte queda registrado en `adjustments`. Una recomendación que llegó
// recortada y una que pasó entera no son lo mismo, y el comerciante tiene que
// poder ver cuál de las dos está mirando antes de aceptarla.

import { PRICING_MODE } from '../../models/pricingPolicyModel.js'

export const PRICING_ACTION = Object.freeze({
  INCREASE: 'INCREASE',
  DECREASE: 'DECREASE',
  HOLD: 'HOLD',
})

export const ADJUSTMENT = Object.freeze({
  CLAMPED_BY_MAX_CHANGE: 'clamped_by_max_change',
  RAISED_BY_MIN_MARGIN: 'raised_by_min_margin',
  CLAMPED_BY_FLOOR: 'clamped_by_floor',
  CLAMPED_BY_CEILING: 'clamped_by_ceiling',
  ROUNDED: 'rounded',
  REJECTED_IMPOSSIBLE_MARGIN: 'rejected_impossible_margin',
})

/**
 * Precio mínimo que deja el margen pedido.
 *
 *   margen = (precio·(1 - deducciones) - costo) / precio
 *
 * despejando el precio:
 *
 *   precio = costo / ((1 - deducciones) - margen)
 *
 * El caso margen = 0 es el precio de equilibrio, así que esto es una
 * generalización de breakEvenPrice y no una fórmula paralela.
 *
 * @returns {number|null} null cuando el margen pedido es inalcanzable: si las
 *   deducciones más el margen se llevan todo, no existe precio que lo cumpla.
 */
export const minPriceForMargin = ({ totalUnitCost, deductionRate, marginPercent }) => {
  const cost = Number(totalUnitCost)
  const deductions = Number(deductionRate) || 0
  const margin = Number(marginPercent) / 100

  if (!Number.isFinite(cost) || cost <= 0) return null

  const available = 1 - deductions - margin
  if (!Number.isFinite(available) || available <= 0) return null

  return cost / available
}

/**
 * Redondea al valor más cercano que termine en alguna de las terminaciones
 * configuradas, sin bajar de un piso.
 *
 * Redondear hacia abajo puede romper el margen mínimo, así que cuando el
 * candidato más cercano cae por debajo del piso se usa el de arriba. Un precio
 * lindo que pierde plata no es una mejora.
 */
export const roundToEnding = (price, endings = [990], floor = 0) => {
  if (!Array.isArray(endings) || !endings.length) return price

  const candidates = []

  for (const ending of endings) {
    const e = Number(ending)
    if (!Number.isFinite(e) || e < 0) continue

    // Escalón sobre el que se apoya la terminación: 990 → miles.
    const step = Math.pow(10, String(Math.trunc(e)).length)
    const base = Math.floor(price / step) * step

    // Los tres escalones: el de abajo, el del tramo actual y el de arriba.
    // Sin el de abajo la función solo podía redondear hacia arriba, porque
    // base + e ya suele quedar por encima del precio.
    candidates.push(base - step + e, base + e, base + step + e)
  }

  const viables = candidates.filter(c => c >= floor)
  if (!viables.length) return price

  return viables.reduce((best, c) =>
    Math.abs(c - price) < Math.abs(best - price) ? c : best,
  )
}

/**
 * Aplica la política a una recomendación.
 *
 * @param {Object} params
 * @param {Object} params.recommendation - { action, recommendedPrice } del modelo
 * @param {Object} params.policy
 * @param {Object} params.signals - de pricingSignalService
 * @returns {Object} decisión final, con lo que se recortó y por qué
 */
export const applyPricingPolicy = ({ recommendation, policy, signals }) => {
  const currentPrice = Number(signals?.price)
  const adjustments = []

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      allowed: false,
      action: PRICING_ACTION.HOLD,
      finalPrice: null,
      reason: 'El producto no tiene un precio válido.',
      adjustments,
      requiresApproval: true,
    }
  }

  let proposed = Number(recommendation?.recommendedPrice)

  if (!Number.isFinite(proposed) || proposed <= 0 || recommendation?.action === PRICING_ACTION.HOLD) {
    return {
      allowed: true,
      action: PRICING_ACTION.HOLD,
      finalPrice: currentPrice,
      changePercent: 0,
      adjustments,
      requiresApproval: false,
    }
  }

  // --- 1. Techo de variación -------------------------------------------
  const maxChange = Number(policy.maxChangePercent) || 0
  const upperBound = currentPrice * (1 + maxChange / 100)
  const lowerBound = currentPrice * (1 - maxChange / 100)

  if (proposed > upperBound) {
    proposed = upperBound
    adjustments.push(ADJUSTMENT.CLAMPED_BY_MAX_CHANGE)
  } else if (proposed < lowerBound) {
    proposed = lowerBound
    adjustments.push(ADJUSTMENT.CLAMPED_BY_MAX_CHANGE)
  }

  // --- 2. Piso de margen ------------------------------------------------
  //
  // Se aplica después del techo de variación y no antes: el margen mínimo es
  // un límite duro y tiene que poder empujar el precio incluso más allá de lo
  // que el techo de variación permitiría bajar.
  if (signals?.cost?.totalUnitCost) {
    const floorByMargin = minPriceForMargin({
      totalUnitCost: signals.cost.totalUnitCost,
      deductionRate: signals.cost.deductionRate,
      marginPercent: policy.minMarginPercent,
    })

    if (floorByMargin === null) {
      // Ni el precio más alto cumple: costo y deducciones no dejan lugar.
      return {
        allowed: false,
        action: PRICING_ACTION.HOLD,
        finalPrice: currentPrice,
        reason:
          'Con este costo y estas deducciones no existe precio que alcance el margen mínimo configurado.',
        adjustments: [ADJUSTMENT.REJECTED_IMPOSSIBLE_MARGIN],
        requiresApproval: true,
      }
    }

    if (proposed < floorByMargin) {
      proposed = floorByMargin
      adjustments.push(ADJUSTMENT.RAISED_BY_MIN_MARGIN)
    }
  }

  // --- 3. Límites absolutos --------------------------------------------
  if (Number.isFinite(policy.priceFloor) && policy.priceFloor > 0 && proposed < policy.priceFloor) {
    proposed = policy.priceFloor
    adjustments.push(ADJUSTMENT.CLAMPED_BY_FLOOR)
  }

  if (Number.isFinite(policy.priceCeiling) && policy.priceCeiling > 0 && proposed > policy.priceCeiling) {
    proposed = policy.priceCeiling
    adjustments.push(ADJUSTMENT.CLAMPED_BY_CEILING)
  }

  // --- 4. Redondeo ------------------------------------------------------
  if (policy.rounding?.enabled) {
    const marginFloor = signals?.cost?.totalUnitCost
      ? minPriceForMargin({
        totalUnitCost: signals.cost.totalUnitCost,
        deductionRate: signals.cost.deductionRate,
        marginPercent: policy.minMarginPercent,
      })
      : 0

    const rounded = roundToEnding(proposed, policy.rounding.endings, marginFloor || 0)

    if (rounded !== proposed) {
      proposed = rounded
      adjustments.push(ADJUSTMENT.ROUNDED)
    }
  }

  proposed = Math.round(proposed)

  const changePercent = Number((((proposed - currentPrice) / currentPrice) * 100).toFixed(2))

  const action =
    changePercent > 0
      ? PRICING_ACTION.INCREASE
      : changePercent < 0
        ? PRICING_ACTION.DECREASE
        : PRICING_ACTION.HOLD

  // --- 5. ¿Puede aplicarse solo? ---------------------------------------
  //
  // El modo por defecto es MANUAL, así que sin configuración explícita nada se
  // aplica automáticamente. Es deliberado: un precio que se mueve solo el
  // primer día, sin que el comerciante entienda por qué, se traduce en la
  // función apagada para siempre.
  const magnitude = Math.abs(changePercent)
  let requiresApproval = true

  if (policy.mode === PRICING_MODE.AUTOPILOT) {
    requiresApproval = false
  } else if (policy.mode === PRICING_MODE.SEMI) {
    requiresApproval = magnitude > (Number(policy.autoApplyMaxPercent) || 0)
  }

  return {
    allowed: true,
    action,
    currentPrice,
    finalPrice: proposed,
    changePercent,
    adjustments,
    requiresApproval,
  }
}
