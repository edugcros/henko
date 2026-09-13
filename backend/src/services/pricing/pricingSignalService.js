// 📁 src/services/pricing/pricingSignalService.js
//
// Indicadores de precio de un producto, calculados con aritmética.
//
// Este archivo no llama a la IA y esa es su razón de ser. Detectar que un
// margen está bajo el mínimo, que el stock no rota o que las ventas cayeron es
// una resta y una división: preguntárselo a un modelo de lenguaje cuesta plata
// y da una respuesta menos confiable que la cuenta.
//
// Cumple dos funciones a la vez:
//
//   1. Filtro. De un catálogo de 10.000 productos, los que tienen algo raro
//      son decenas. Solo esos justifican una llamada a Gemini. La diferencia
//      medida es USD 0,78 contra USD 260 por comercio por mes.
//
//   2. Insumo del prompt. Cuando la IA entra, no recibe datos crudos para que
//      haga cuentas: recibe "margen 26,5%, cobertura 93 días, rotación -42%" y
//      razona sobre eso.

import mongoose from 'mongoose'
import Order, { PAYMENT_STATUS } from '../../models/orderModel.js'
import Product from '../../models/productModel.js'
import ProductPriceHistory from '../../models/productPriceHistoryModel.js'
import { calculateProfitability } from '../marketIntelligence/scoring/profitabilityEngine.js'
import { resolveProductCostInputs } from './productCostService.js'
import logger from '../../../config/logger.js'

/** Motivos por los que un producto merece mirarse. */
export const PRICING_FLAG = Object.freeze({
  MARGIN_BELOW_MIN: 'margin_below_min',
  MARGIN_BELOW_TARGET: 'margin_below_target',
  NO_COST: 'no_cost',
  STOCK_STUCK: 'stock_stuck',
  STOCK_CRITICAL: 'stock_critical',
  DEMAND_FALLING: 'demand_falling',
  DEMAND_RISING: 'demand_rising',
  COST_INCREASED: 'cost_increased',
})

const WINDOW_DAYS = 30

/** Días de stock a partir de los cuales el inventario se considera parado. */
const STOCK_STUCK_DAYS = 60

/** Variación de rotación que deja de ser ruido. */
const DEMAND_SHIFT_PERCENT = 25

/** Suba de costo que amerita revisar el precio. */
const COST_SHIFT_PERCENT = 5

const daysAgo = n => new Date(Date.now() - n * 24 * 60 * 60 * 1000)

const round = (value, decimals = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : null

/**
 * Unidades vendidas de un producto en una ventana, contando solo órdenes
 * cobradas: una orden pendiente o cancelada no es demanda satisfecha.
 */
const unitsSoldBetween = async ({ tenantId, productId, from, to }) => {
  const [row] = await Order.aggregate([
    { $match: { paymentStatus: PAYMENT_STATUS.APPROVED, paidAt: { $gte: from, $lt: to } } },
    { $unwind: '$products' },
    { $match: { 'products.product': new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: null, units: { $sum: '$products.count' } } },
  ]).option({ tenantId })

  return Number(row?.units || 0)
}

/**
 * Señales de precio de un producto.
 *
 * @returns {Promise<Object|null>} null si el producto no existe o no es del
 *   comercio. `warrantsAnalysis` dice si vale la pena gastar una llamada de IA.
 */
export const buildPricingSignals = async ({ tenantId, productId, policy }) => {
  // El tenant va en el filtro y no delegado al plugin: tenantPlugin se apaga
  // entero cuando NODE_ENV es 'test', así que una consulta que dependa de él
  // no está acotada en la suite. Ver productCostService.js.
  const product = await Product.findOne({ _id: productId, tenantId })
    .select('title price stock costoUnitario')
    .lean()

  if (!product) return null

  const price = Number(product.price) || 0
  const stock = Number(product.stock) || 0
  const flags = []

  // --- Costo y margen -------------------------------------------------
  const { costs, provenance } = await resolveProductCostInputs({ tenantId, productId })

  const profitability = costs
    ? calculateProfitability({ ...costs, targetPrice: price }, null)
    : null

  const margin = profitability?.atTargetPrice?.marginPercent ?? null
  const breakEvenPrice = profitability?.breakEvenPrice ?? null

  if (!costs) {
    // Sin costo no hay margen que evaluar. Es un hallazgo en sí mismo: el
    // comerciante está vendiendo sin saber cuánto gana.
    flags.push(PRICING_FLAG.NO_COST)
  } else if (margin !== null) {
    if (margin < policy.minMarginPercent) flags.push(PRICING_FLAG.MARGIN_BELOW_MIN)
    else if (margin < policy.targetMarginPercent) flags.push(PRICING_FLAG.MARGIN_BELOW_TARGET)
  }

  // --- Rotación -------------------------------------------------------
  const now = new Date()
  const [unitsRecent, unitsPrior] = await Promise.all([
    unitsSoldBetween({ tenantId, productId, from: daysAgo(WINDOW_DAYS), to: now }),
    unitsSoldBetween({
      tenantId,
      productId,
      from: daysAgo(WINDOW_DAYS * 2),
      to: daysAgo(WINDOW_DAYS),
    }),
  ])

  const dailyRate = unitsRecent / WINDOW_DAYS

  // Sin ventas no se puede afirmar "tarda N días": queda null en vez de
  // Infinity, que se propagaría como un número al prompt y al panel.
  const stockCoverageDays = dailyRate > 0 ? round(stock / dailyRate, 0) : null

  let demandChangePercent = null
  if (unitsPrior > 0) {
    demandChangePercent = round(((unitsRecent - unitsPrior) / unitsPrior) * 100)
  } else if (unitsRecent > 0) {
    // De cero a algo es demanda nueva, no un porcentaje: dividir por cero
    // daría Infinity y decir "+100%" sería inventar una base que no existió.
    demandChangePercent = null
  }

  if (policy.consider?.stock !== false) {
    if (stockCoverageDays !== null && stockCoverageDays > STOCK_STUCK_DAYS) {
      flags.push(PRICING_FLAG.STOCK_STUCK)
    }
    if (stock > 0 && unitsRecent === 0 && unitsPrior > 0) {
      // Vendía y dejó de vender con stock disponible.
      flags.push(PRICING_FLAG.STOCK_CRITICAL)
    }
  }

  if (policy.consider?.demand !== false && demandChangePercent !== null) {
    if (demandChangePercent <= -DEMAND_SHIFT_PERCENT) flags.push(PRICING_FLAG.DEMAND_FALLING)
    if (demandChangePercent >= DEMAND_SHIFT_PERCENT) flags.push(PRICING_FLAG.DEMAND_RISING)
  }

  // --- Costo contra el último cambio de precio ------------------------
  //
  // Compara el costo de hoy con el que estaba vigente la última vez que se
  // tocó el precio. Es la pregunta que importa: si el costo subió desde
  // entonces, el margen se erosionó sin que nadie lo decidiera.
  let costChangePercent = null
  let lastPriceChange = null

  try {
    const [last] = await ProductPriceHistory.find({ tenantId, productId })
      .sort({ createdAt: -1 })
      .limit(1)
      .lean()

    if (last) {
      lastPriceChange = {
        at: last.createdAt,
        previousPrice: last.previousPrice,
        newPrice: last.newPrice,
        changePercent: last.changePercent,
        reason: last.reason || null,
      }

      const then = Number(last.unitCostAtChange)
      const nowCost = Number(costs?.unitCost)

      if (Number.isFinite(then) && then > 0 && Number.isFinite(nowCost)) {
        costChangePercent = round(((nowCost - then) / then) * 100)

        if (policy.consider?.cost !== false && costChangePercent >= COST_SHIFT_PERCENT) {
          flags.push(PRICING_FLAG.COST_INCREASED)
        }
      }
    }
  } catch (error) {
    // El historial es un enriquecimiento, no un requisito: sin él las demás
    // señales siguen sirviendo.
    logger.warn('[PRICING] No se pudo leer el historial de precios', {
      tenantId: String(tenantId),
      productId: String(productId),
      error: error.message,
    })
  }

  return {
    productId: String(productId),
    title: product.title,
    price,
    stock,
    cost: costs
      ? {
        unitCost: costs.unitCost,
        totalUnitCost: profitability?.totalUnitCost ?? null,
        breakEvenPrice: round(breakEvenPrice),
        deductionRate: profitability?.deductionRate ?? null,
        sources: provenance,
      }
      : null,
    marginPercent: margin,
    demand: {
      unitsLast30: unitsRecent,
      unitsPrior30: unitsPrior,
      changePercent: demandChangePercent,
      stockCoverageDays,
    },
    costChangePercent,
    lastPriceChange,
    flags,
    // El filtro: sin ninguna señal, este producto no justifica una llamada de
    // IA. Es la línea que separa USD 0,78 de USD 260 por mes.
    //
    // "Sin costo cargado" no cuenta como señal para analizar, aunque se
    // muestre. La respuesta ya la sabe el sistema —cargá el costo— y sin costo
    // no hay margen que calcular: la IA solo puede contestar "no hay datos
    // suficientes", que es lo que contestaba, gastando una llamada para
    // recomendar el mismo precio. Si además hay una señal de rotación o
    // demanda, ahí sí se analiza: eso se puede razonar sin conocer el costo.
    warrantsAnalysis: flags.some(flag => flag !== PRICING_FLAG.NO_COST),
  }
}
