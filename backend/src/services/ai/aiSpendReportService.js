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
import AiPlatformUsage from '../../models/aiPlatformUsageModel.js'
import logger from '../../../config/logger.js'
import {
  getPlatformMonthlyTokenBudget,
  getPlatformMonthlyUsdBudget,
  getPlatformBudgetSource,
  getPlatformUsdBudgetSource,
  UNLIMITED,
} from './aiPlanPolicy.js'
import { getPlatformAiSettingHistory } from './platformAiSettingService.js'
import { getCurrentPeriod } from './aiPeriod.js'
// La contabilidad vive aparte: este archivo REPORTA, aquel RECONCILIA.
import { rebuildPlatformProjection } from './aiAccountingService.js'

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
 * Mira los 'consumed' y RESTA los 'refunded'. Las reservas quedan afuera:
 * siguen siendo intención.
 *
 * La resta es nueva y hace falta desde que el costo de tarifa plana se cobra en
 * el mismo movimiento que la cuota. Antes un 'consumed' solo se escribía cuando
 * la operación ya había salido bien, así que la devolución no tenía nada que
 * descontar; ahora la edición de imagen se cobra al reservar y se devuelve si
 * el proveedor falla, y sin esta resta el reporte contaría un gasto que se
 * revirtió.
 *
 * Para las métricas de tokens no cambia nada: sus filas de devolución llevan
 * costo cero, porque esos tokens sí se gastaron contra Google.
 *
 * @param {string} period
 * @returns {Promise<Array<{metric:string, costUsd:number, tokens:number, operations:number}>>}
 */
export const getPeriodSpendByMetric = async period => {
  if (!period) return []

  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const rows = await AiConsumptionLedger.aggregate([
    {
      $match: {
        period,
        event: { $in: [LEDGER_EVENT.CONSUMED, LEDGER_EVENT.REFUNDED] },
      },
    },
    {
      $group: {
        _id: '$metric',
        costUsd: { $sum: conSigno('$costUsd') },
        tokens: {
          $sum: conSigno({ $cond: [{ $eq: ['$unit', 'tokens'] }, '$amount', 0] }),
        },
        operations: { $sum: conSigno(1) },
      },
    },
    { $sort: { costUsd: -1 } },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

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
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  return rows.map(row => ({
    model: row._id,
    costUsd: round(row.costUsd),
    tokens: row.tokens || 0,
    operations: row.operations || 0,
    fallbackRows: row.fallbackRows || 0,
  }))
}

/**
 * Cuánta de la contabilidad del período es medida y cuánta supuesta.
 *
 * Va en el reporte y no en una nota al pie porque cambia cómo hay que leer el
 * total. Un costo repartido con una proporción asumida y uno calculado con el
 * usageMetadata real no son la misma clase de dato, y quien mira el número para
 * decidir algo tiene que saber cuál está mirando.
 *
 * `fallbackRows` es distinto y más urgente: son filas cobradas con la tarifa
 * conservadora porque el modelo no estaba en el catálogo. Si eso crece, el
 * catálogo quedó viejo y el total está inflado.
 */
const getPeriodQuality = async period => {
  const [row] = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED } },
    {
      $group: {
        _id: null,
        rows: { $sum: 1 },
        estimatedRows: { $sum: { $cond: ['$costEstimated', 1, 0] } },
        fallbackRows: { $sum: { $cond: ['$priceFallback', 1, 0] } },
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  return {
    rows: row?.rows || 0,
    estimatedRows: row?.estimatedRows || 0,
    fallbackRows: row?.fallbackRows || 0,
  }
}

/**
 * Todo lo que hace falta para contestar "¿cuánto va a pagar HENKO este mes y
 * en qué?" en una sola lectura.
 *
 * Junta las dos fuentes a propósito, porque miden cosas distintas y verlas
 * juntas es el control:
 *
 *  - AiPlatformUsage.tokens es lo que el DISYUNTOR cuenta. Es la cifra que
 *    decide si se corta, y la única que importa para saber cuánto falta.
 *  - El ledger explica ese número: qué función y qué modelo lo consumieron.
 *
 * Pueden no coincidir, y eso no es un error: el consumo de los comercios con
 * key propia entra al ledger con costo 0 y NO al contador de plataforma,
 * porque no lo paga HENKO. Por eso el desglose se informa aparte del total
 * contra el techo en vez de mezclarlos en un solo número.
 */
export const getPlatformSpendSnapshot = async (period = getCurrentPeriod()) => {
  const budget = getPlatformMonthlyTokenBudget()
  const usdBudget = getPlatformMonthlyUsdBudget()

  const [usage, byMetric, byModel, quality, settingHistory, reconciliation] =
    await Promise.all([
      AiPlatformUsage.findOne({ period }).lean(),
      getPeriodSpendByMetric(period),
      getPeriodSpendByModel(period),
      getPeriodQuality(period),
      getPlatformAiSettingHistory(10).catch(() => []),
      // La diferencia entre el contador y el libro, SIN corregir. Va acá y no
      // en un script que alguien tiene que acordarse de correr: una
      // reconciliación que nadie mira es código muerto, y este contador es el
      // que decide si el disyuntor corta la IA de todos los comercios.
      //
      // Nunca escribe desde esta lectura. Corregir un agregado como efecto
      // secundario de abrir una pantalla es la clase de sorpresa que uno no
      // quiere en el camino de la plata: el reporte muestra, la corrección se
      // pide.
      rebuildPlatformProjection({ period }).catch(error => {
        logger.warn('[AI RECONCILE] No se pudo calcular la diferencia', {
          period,
          error: error.message,
        })
        return null
      }),
    ])

  const tokens = Number(usage?.tokens || 0)
  const hasBudget = budget !== UNLIMITED

  return {
    period,
    budget: {
      // null y no 0: "sin disyuntor configurado" es una situación distinta de
      // "el techo es cero", y la pantalla las tiene que mostrar distinto.
      tokens: hasBudget ? budget : null,
      configured: hasBudget,
      // De dónde sale el valor vigente: 'panel' si lo cambió alguien desde acá,
      // 'env' si manda la variable de entorno, 'none' si no hay techo. Se
      // informa porque un override que gana en silencio sobre la variable
      // convierte "ya lo cambié en Render y no pasa nada" en un misterio.
      source: getPlatformBudgetSource(),
      // Los avisos viven en el mismo objeto que el techo porque se leen juntos:
      // un 47% no dice nada sin saber que el próximo escalón es 50.
      alertedThreshold: Number(usage?.alertedThreshold || 0),
      // El techo en PLATA, que es lo que HENKO paga. Va al lado del de tokens
      // y no en lugar de él: miden cosas distintas, y la pantalla tiene que
      // poder mostrar que el gasto va por el 90% mientras el volumen va por el
      // 30% — que es exactamente lo que pasa cuando la cadena de respaldo
      // entrega un modelo cinco veces más caro.
      usd: usdBudget === UNLIMITED ? null : usdBudget,
      usdConfigured: usdBudget !== UNLIMITED,
      usdSource: getPlatformUsdBudgetSource(),
    },
    consumption: {
      tokens,
      percentUsed: hasBudget && budget > 0 ? round((tokens / budget) * 100, 1) : null,
      remainingTokens: hasBudget ? Math.max(0, budget - tokens) : null,
      // El costo del contador de plataforma, que es el que HENKO paga.
      estimatedCostUsd: round(usage?.estimatedCostUsd || 0, 2),
      // Plata comprometida por operaciones en vuelo, todavía sin liquidar. El
      // techo mira la SUMA de las dos; la auditoría contable, solo la gastada.
      reservedCostUsd: round(usage?.reservedCostUsd || 0, 2),
      percentUsdUsed:
        usdBudget !== UNLIMITED && usdBudget > 0
          ? round(
            ((Number(usage?.estimatedCostUsd || 0) +
                Number(usage?.reservedCostUsd || 0)) /
                usdBudget) *
                100,
            1,
          )
          : null,
      lastActivityAt: usage?.lastActivityAt || null,
    },
    breaker: {
      trippedAt: usage?.breakerTrippedAt || null,
      tripped: Boolean(usage?.breakerTrippedAt),
      // 'tokens' o 'usd'. La acción es distinta: si cortó la plata hay que
      // decidir si se gasta más; si cortó el volumen, hay que buscar qué está
      // consumiendo de más.
      reason: usage?.breakerReason || null,
    },
    // null cuando no se pudo calcular: es distinto de "no hay diferencia", y
    // la pantalla lo tiene que poder distinguir.
    reconciliation,
    byMetric,
    byModel,
    quality,
    // Quién movió el techo, cuándo y por qué. Va en el mismo reporte porque un
    // salto en el consumo y un cambio de límite se leen juntos o no se leen.
    settingHistory,
  }
}

export default {
  getPeriodSpendByMetric,
  getPeriodSpendByModel,
  getPlatformSpendSnapshot,
}
