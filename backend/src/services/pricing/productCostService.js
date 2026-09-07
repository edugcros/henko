// 📁 src/services/pricing/productCostService.js
//
// Arma los costos de un producto para el motor de rentabilidad, prefiriendo
// siempre el dato real por sobre el que alguien tipeó.
//
// Antes de esto el comerciante reescribía a mano, en cada análisis, un costo
// que ya estaba cargado en el producto y una comisión que el sistema ya conocía
// de sus propias ventas. El margen que veía no dependía de la verdad sino de lo
// que hubiera tipeado esa vez.
//
// El orden de preferencia es siempre el mismo:
//
//   1. lo que el comerciante mandó explícitamente en este análisis  (override)
//   2. lo medido de sus ventas reales                               (measured)
//   3. lo guardado en la ficha del producto                         (stored)
//   4. nada — y el motor se abstiene de calcular
//
// Cada campo viaja con su procedencia. Que un margen sea medido o estimado no
// es un detalle de implementación: es la diferencia entre un número que el
// comerciante puede usar para decidir y uno que solo puede mirar.

import Order, { PAYMENT_STATUS } from '../../models/orderModel.js'
import Product from '../../models/productModel.js'
import logger from '../../../config/logger.js'

export const COST_SOURCE = Object.freeze({
  OVERRIDE: 'override',
  MEASURED: 'measured',
  STORED: 'stored',
  MISSING: 'missing',
})

/**
 * Ventana de ventas para medir la comisión efectiva.
 *
 * 90 días es un compromiso: suficiente para juntar muestra en un comercio
 * chico, corto para que un cambio de acuerdo con la pasarela se refleje sin
 * arrastrar meses de la tarifa vieja.
 */
const WINDOW_DAYS = 90

/**
 * Mínimo de ventas antes de confiar en la tasa medida.
 *
 * Con dos o tres ventas la tasa la domina el método de pago que se haya usado
 * — una sola compra en 12 cuotas la dispara. Por debajo de este número es más
 * honesto decir "no sé" y dejar que mande el porcentaje configurado.
 */
const MIN_SAMPLE = 5

/**
 * Comisión efectiva de la pasarela, medida sobre las ventas cobradas del
 * comercio en vez de preguntada.
 *
 * Solo mira órdenes que tengan la comisión REAL informada por el proveedor
 * (paymentIntent.providerFeeCents). Las órdenes viejas, anteriores a que se
 * empezara a capturar ese dato, quedan fuera de la muestra en vez de contar
 * como comisión cero — que hundiría la tasa hacia abajo justo al principio,
 * cuando casi todas las órdenes son viejas.
 *
 * @returns {Promise<{percent: number, sampleSize: number}|null>} null cuando
 *   no hay muestra suficiente para afirmar nada.
 */
export const measurePaymentFeePercent = async ({ tenantId }) => {
  if (!tenantId) return null

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

  try {
    const [row] = await Order.aggregate([
      {
        $match: {
          paymentStatus: PAYMENT_STATUS.APPROVED,
          paidAt: { $gte: since },
          'paymentIntent.providerFeeCents': { $gte: 0 },
          'paymentIntent.amountCents': { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          fees: { $sum: '$paymentIntent.providerFeeCents' },
          amounts: { $sum: '$paymentIntent.amountCents' },
          orders: { $sum: 1 },
        },
      },
    ]).option({ tenantId })

    if (!row || row.orders < MIN_SAMPLE || !(row.amounts > 0)) return null

    // Ponderado por monto y no promedio de porcentajes: una venta de $500.000
    // pesa lo que corresponde frente a una de $5.000, que es como se compone
    // la factura real de la pasarela.
    const percent = (row.fees / row.amounts) * 100

    // Una tasa fuera de rango es un dato corrupto, no una comisión: mejor
    // abstenerse que propagarla al cálculo de margen.
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null

    return { percent: Number(percent.toFixed(2)), sampleSize: row.orders }
  } catch (error) {
    // Medir es una mejora, no un requisito: si la agregación falla, el análisis
    // sigue con el porcentaje configurado en vez de romperse.
    logger.warn('[PRICING] No se pudo medir la comisión efectiva', {
      tenantId: String(tenantId),
      error: error.message,
    })
    return null
  }
}

const positive = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Costos de un producto listos para calculateProfitability, con la procedencia
 * de cada campo.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} [params.productId] - sin él solo se usan los overrides
 * @param {Object} [params.overrides] - lo que el comerciante mandó en el body
 * @returns {Promise<{costs: Object|null, provenance: Object}>} costs en null
 *   cuando no hay costo unitario por ningún lado: el motor no debe calcular
 *   un margen sobre un costo inventado.
 */
export const resolveProductCostInputs = async ({
  tenantId,
  productId = null,
  overrides = {},
}) => {
  const provenance = {}

  let stored = null
  if (productId && tenantId) {
    try {
      // El tenant va en el filtro, no delegado al plugin.
      //
      // tenantPlugin filtra bien en producción, pero se desactiva entero
      // cuando NODE_ENV es 'test' (ver shouldIgnoreTenant). Con la condición
      // acá la consulta queda acotada por sí misma, y de paso el test de
      // aislamiento de este servicio prueba algo real en vez de pasar porque
      // el plugin lo tapa.
      stored = await Product.findOne({ _id: productId, tenantId })
        .select('costoUnitario')
        .lean()
    } catch (error) {
      logger.warn('[PRICING] No se pudo leer el costo del producto', {
        tenantId: String(tenantId),
        productId: String(productId),
        error: error.message,
      })
    }
  }

  // Costo unitario: lo que mandaron, si no lo que está en la ficha.
  const overrideCost = positive(overrides.unitCost)
  const storedCost = positive(stored?.costoUnitario)
  const unitCost = overrideCost ?? storedCost ?? null

  provenance.unitCost = overrideCost
    ? COST_SOURCE.OVERRIDE
    : storedCost
      ? COST_SOURCE.STORED
      : COST_SOURCE.MISSING

  if (unitCost === null) {
    return { costs: null, provenance }
  }

  // Comisión de la pasarela: lo que mandaron, si no lo medido de las ventas.
  // Un override explícito gana incluso sobre la medición — el comerciante
  // puede estar simulando un acuerdo distinto al que tiene hoy.
  const overrideFee = Number(overrides.paymentFeePercent)
  let paymentFeePercent

  if (Number.isFinite(overrideFee) && overrideFee > 0) {
    paymentFeePercent = overrideFee
    provenance.paymentFeePercent = COST_SOURCE.OVERRIDE
  } else {
    const measured = await measurePaymentFeePercent({ tenantId })
    paymentFeePercent = measured?.percent ?? 0
    provenance.paymentFeePercent = measured ? COST_SOURCE.MEASURED : COST_SOURCE.MISSING
    if (measured) provenance.paymentFeeSampleSize = measured.sampleSize
  }

  // El resto todavía no tiene fuente de verdad en el sistema: viajan como los
  // mandó el comerciante. Envío y logística real por producto, y la comisión de
  // la plataforma, son los próximos candidatos a medirse en vez de preguntarse.
  const passthrough = key => {
    const value = Number(overrides[key])
    const clean = Number.isFinite(value) && value > 0 ? value : 0
    provenance[key] = clean > 0 ? COST_SOURCE.OVERRIDE : COST_SOURCE.MISSING
    return clean
  }

  return {
    costs: {
      unitCost,
      shippingCost: passthrough('shippingCost'),
      platformFeePercent: Math.min(passthrough('platformFeePercent'), 100),
      paymentFeePercent: Math.min(paymentFeePercent, 100),
      taxPercent: Math.min(passthrough('taxPercent'), 100),
      targetPrice: positive(overrides.targetPrice) ?? undefined,
    },
    provenance,
  }
}
