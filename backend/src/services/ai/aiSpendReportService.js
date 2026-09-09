// 📁 src/services/ai/aiSpendReportService.js
//
// Lecturas del libro de consumo.
//
// El ledger venía escribiendo sin que nadie lo leyera. Esta es la primera
// consulta que lo usa, y existe por una razón concreta: un aviso de
// presupuesto que dice "vas por el 80%" obliga a ir a investigar; uno que dice
// "vas por el 80% y el 70% se lo lleva visión" ya trae la respuesta.
//
// SOBRE EL CRUCE DE TENANTS
//
// Estas consultas son deliberadamente cross-tenant: la pregunta que contestan
// es "¿cuánto va a pagar HENKO este mes?", que no tiene sentido tenant por
// tenant. Por eso llevan `ignoreTenant`, que es justamente el tipo de opción
// que no debería aparecer sin justificar.
//
// Lo que las hace seguras es que no devuelven nada identificable: agrupan por
// métrica y por modelo, y lo que sale son totales. Ningún resultado de este
// archivo debe servirse a un comercio — es información de la plataforma.

import AiConsumptionLedger, { LEDGER_EVENT } from '../../models/aiConsumptionLedgerModel.js'

// `amount` mide unidades o tokens según la fila; sumar las dos juntas daría un
// número sin sentido. El campo `unit` es el que lo dice.
const sumTokens = {
  $sum: { $cond: [{ $eq: ['$unit', 'tokens'] }, '$amount', 0] },
}

const round = (value, decimals = 4) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Number(number.toFixed(decimals))
}

/**
 * Gasto del período agrupado por métrica, de lo más caro a lo más barato.
 *
 * Solo mira los 'consumed': las reservas son intención y las devoluciones ya
 * están descontadas de lo que se consumió. Lo que se busca acá es plata
 * efectivamente gastada.
 *
 * @param {string} period
 * @returns {Promise<Array<{metric:string, costUsd:number, tokens:number, operations:number}>>}
 */
export const getPeriodSpendByMetric = async period => {
  if (!period) return []

  const rows = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED } },
    {
      $group: {
        _id: '$metric',
        costUsd: { $sum: '$costUsd' },
        tokens: sumTokens,
        operations: { $sum: 1 },
      },
    },
    { $sort: { costUsd: -1 } },
  ]).option({ ignoreTenant: true })

  return rows.map(row => ({
    metric: row._id,
    costUsd: round(row.costUsd),
    tokens: row.tokens || 0,
    operations: row.operations || 0,
  }))
}

/**
 * Lo mismo por modelo. Sirve para una decisión distinta: si el gasto se
 * concentra en un modelo caro, cambiar de modelo es una palanca que no
 * requiere tocar el producto.
 */
export const getPeriodSpendByModel = async period => {
  if (!period) return []

  const rows = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED, model: { $ne: null } } },
    {
      $group: {
        _id: '$model',
        costUsd: { $sum: '$costUsd' },
        tokens: sumTokens,
        operations: { $sum: 1 },
        // Cuántas filas se calcularon con la tarifa conservadora por no tener
        // el modelo en el catálogo. Si esto crece, el catálogo quedó viejo y
        // el costo que muestra el panel está inflado.
        fallbackRows: { $sum: { $cond: ['$priceFallback', 1, 0] } },
      },
    },
    { $sort: { costUsd: -1 } },
  ]).option({ ignoreTenant: true })

  return rows.map(row => ({
    model: row._id,
    costUsd: round(row.costUsd),
    tokens: row.tokens || 0,
    operations: row.operations || 0,
    fallbackRows: row.fallbackRows || 0,
  }))
}

export default { getPeriodSpendByMetric, getPeriodSpendByModel }
