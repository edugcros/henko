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
import AiUsage from '../../models/aiUsageModel.js'
import AiOperation from '../../models/aiOperationModel.js'
import mongoose from 'mongoose'
import logger from '../../../config/logger.js'
import {
  AI_METRICS,
  AI_METRIC_LIST,
  getPlatformMonthlyTokenBudget,
  getPlatformBudgetSource,
  UNLIMITED,
} from './aiPlanPolicy.js'
import { getPlatformAiSettingHistory } from './platformAiSettingService.js'
import { getCurrentPeriod } from './aiPeriod.js'

// `amount` mide unidades o tokens según la fila; sumar las dos juntas daría un
// número sin sentido. El campo `unit` es el que lo dice.
const sumTokens = {
  $sum: { $cond: [{ $eq: ['$unit', 'tokens'] }, '$amount', 0] },
}

/**
 * Las métricas cuyo `amount` son tokens. Sus filas llevan unit:'tokens' y las
 * de cuota llevan unit:'units'; mezclarlas da un número sin sentido.
 */
const TOKEN_METRIC_NAMES = new Set([AI_METRICS.AGENT_TOKENS, AI_METRICS.MARKET_TOKENS])

/**
 * Debajo de esto, una diferencia de costo es ruido de punto flotante y no
 * plata perdida: son las mismas sumas hechas en otro orden. Un décimo de
 * centavo.
 */
const COST_TOLERANCE_USD = 0.0001

/** El $match de una agregación necesita el ObjectId, no la cadena. */
const toObjectId = value =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value))

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
      reconcilePlatformUsage({ period }).catch(error => {
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
    },
    consumption: {
      tokens,
      percentUsed: hasBudget && budget > 0 ? round((tokens / budget) * 100, 1) : null,
      remainingTokens: hasBudget ? Math.max(0, budget - tokens) : null,
      // El costo del contador de plataforma, que es el que HENKO paga.
      estimatedCostUsd: round(usage?.estimatedCostUsd || 0, 2),
      lastActivityAt: usage?.lastActivityAt || null,
    },
    breaker: {
      trippedAt: usage?.breakerTrippedAt || null,
      tripped: Boolean(usage?.breakerTrippedAt),
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

// ─── RECONCILIACIÓN ─────────────────────────────────────────────────────────
//
// QUÉ HACE A AiUsage UNA PROYECCIÓN Y NO UNA FUENTE PARALELA
//
// El pipeline es AiOperation → claim → AiProviderCall → ledger → agregados.
// El ledger es el libro: append-only, una fila por movimiento, con el precio
// del momento congelado adentro. AiUsage y AiPlatformUsage son agregados que
// existen por una razón operativa: el tope de cuota vive DENTRO del filtro del
// findOneAndUpdate que reserva, y eso es lo que hace atómico el control. Un
// número que hay que calcular agregando el ledger no puede ir adentro de ese
// filtro — habría que leerlo primero y escribir después, que es exactamente la
// carrera que todo este trabajo viene cerrando.
//
// Así que los agregados se quedan materializados. Lo que los convierte en
// PROYECCIONES y no en una segunda verdad es esto: que se puedan recalcular
// desde el ledger, y que la diferencia se pueda ver.
//
// CÓMO SE RECONSTRUYE CADA CONTADOR
//
// `unit` es lo que separa las filas que suman de las que no, y sin eso el
// número da cualquier cosa. El caso que lo demuestra es `vision`: reservar
// escribe una fila de UNA UNIDAD, y los tokens que esa unidad gastó escriben
// otra fila de TOKENS, con la misma métrica. El contador de cuota solo
// contiene la primera — recordTokenSpend no toca counters, solo el costo—.
// Sumar las dos daría un contador de visión en cientos de miles.
//
// Las devoluciones restan. Las reservas SUMAN, a diferencia del reporte de
// gasto, porque el contador de cuota se incrementa al reservar: ahí el número
// no mide plata gastada sino cupo tomado.

/** Las filas viejas anteriores al campo `unit` valen como unidades, igual que el default del schema. */
const UNIT = { $ifNull: ['$unit', 'units'] }

/**
 * Recalcula los contadores de un comercio desde el ledger y reporta la
 * diferencia. Por defecto NO escribe.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.period
 * @param {boolean} [params.apply=false] - si corrige AiUsage o solo informa
 * @returns {Promise<ReconciliationReport>}
 *
 * @typedef {Object} ReconciliationReport
 * @property {Object} counters - por métrica: { stored, ledger, drift }
 * @property {Object} cost     - { stored, ledger, drift }
 * @property {boolean} hasDrift
 * @property {boolean} applied
 */
export const reconcileTenantUsage = async ({ tenantId, period, apply = false }) => {
  if (!tenantId || !period) {
    throw new Error('reconcileTenantUsage requiere tenantId y period')
  }

  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const filas = await AiConsumptionLedger.aggregate([
    { $match: { tenantId: toObjectId(tenantId), period } },
    {
      $group: {
        _id: { metric: '$metric', unit: UNIT },
        amount: { $sum: conSigno('$amount') },
        costUsd: { $sum: conSigno('$costUsd') },
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reconciliacion-ia' })

  const almacenado = await AiUsage.findOne({ tenantId, period })
    .setOptions({ tenantId })
    .lean()

  // ¿ESTÁ COMPLETO EL LIBRO?
  //
  // Declarar al ledger fuente de verdad solo vale si el ledger tiene todo. Y
  // hoy puede no tenerlo: writeLedgerEntry no se espera y se traga los errores
  // que no son clave repetida, justamente para que la contabilidad nunca rompa
  // una operación de IA. Si esa escritura falla, el contador subió y la fila
  // no existe.
  //
  // Sin esta comprobación, corregir "desde el libro" DESTRUYE el número bueno:
  // medido, un contador correcto en 3 con una fila perdida quedaba en 2.
  //
  // AiOperation es el contraste confiable porque se escribe ANTES de tocar
  // ningún contador y SÍ se espera: es el candado del cobro. Si tiene
  // operaciones que el ledger no conoce, el que está incompleto es el ledger.
  const [operaciones, enElLedger] = await Promise.all([
    AiOperation.distinct('operationId', { tenantId, period }).setOptions({ tenantId }),
    AiConsumptionLedger.distinct('operationId', { tenantId, period })
      .setOptions({ tenantId }),
  ])

  // Las filas de una llamada extra entran al ledger como 'operacion:llamada',
  // así que se compara contra la parte anterior a los dos puntos.
  const conocidas = new Set(
    enElLedger.filter(Boolean).map(id => String(id).split(':')[0]),
  )

  const missingFromLedger = operaciones.filter(id => id && !conocidas.has(id))
  const ledgerComplete = missingFromLedger.length === 0

  // Cada métrica lee SOLO las filas de su propia unidad. Es la línea de la que
  // depende que el número signifique algo — ver el caso de `vision` arriba.
  const delLedger = new Map(
    filas.map(f => [`${f._id.metric}:${f._id.unit}`, f]),
  )

  const counters = {}
  let hasDrift = false

  for (const metric of AI_METRIC_LIST) {
    const unidad = TOKEN_METRIC_NAMES.has(metric) ? 'tokens' : 'units'
    const ledger = Math.round(delLedger.get(`${metric}:${unidad}`)?.amount || 0)
    const stored = Math.round(Number(almacenado?.counters?.[metric] || 0))
    const drift = stored - ledger

    counters[metric] = { stored, ledger, drift }
    if (drift !== 0) hasDrift = true
  }

  const costoLedger = round(
    filas.reduce((suma, f) => suma + Number(f.costUsd || 0), 0),
  )
  const costoAlmacenado = round(Number(almacenado?.estimatedCostUsd || 0))
  const costDrift = round(costoAlmacenado - costoLedger)

  // El costo se compara con tolerancia: son sumas de flotantes en distinto
  // orden, y exigir igualdad exacta reportaría diferencias de 1e-15 como si
  // fueran plata perdida.
  if (Math.abs(costDrift) > COST_TOLERANCE_USD) hasDrift = true

  const report = {
    tenantId: String(tenantId),
    period,
    counters,
    cost: { stored: costoAlmacenado, ledger: costoLedger, drift: costDrift },
    hasDrift,
    // false = al libro le faltan filas, así que la diferencia de arriba NO es
    // un contador inflado: es un libro corto. Corregir contra él sería borrar
    // consumo real.
    ledgerComplete,
    missingFromLedger: missingFromLedger.slice(0, 20),
    applied: false,
  }

  if (!apply || !hasDrift) return report

  if (!ledgerComplete) {
    logger.error('[AI RECONCILE] No se corrige: al ledger le faltan operaciones', {
      tenantId: String(tenantId),
      period,
      missing: missingFromLedger.length,
      ejemplos: missingFromLedger.slice(0, 5),
    })

    return report
  }

  // Se escribe el valor del ledger, no la diferencia: el ledger es el libro y
  // un $set deja el agregado exactamente en lo que el libro dice, sin importar
  // qué lo desalineó ni cuántas veces se corra esto.
  const set = { estimatedCostUsd: costoLedger }
  for (const [metric, valores] of Object.entries(counters)) {
    set[`counters.${metric}`] = valores.ledger
  }

  await AiUsage.updateOne({ tenantId, period }, { $set: set }).setOptions({ tenantId })

  logger.warn('[AI RECONCILE] Contadores corregidos desde el ledger', {
    tenantId: String(tenantId),
    period,
    counters: Object.fromEntries(
      Object.entries(counters)
        .filter(([, v]) => v.drift !== 0)
        .map(([k, v]) => [k, v.drift]),
    ),
    costDrift,
  })

  return { ...report, applied: true }
}

/**
 * Lo mismo para el contador de plataforma, que es el que mide el disyuntor.
 *
 * Es el más importante de los dos: si este se desalinea hacia arriba, el freno
 * de emergencia se dispara antes de tiempo y deja sin IA a TODOS los
 * comercios. Hacia abajo es peor todavía, porque el freno no se dispara.
 *
 * Solo cuenta las filas de tokens que NO son de una key del comercio: un
 * consumo BYOK gasta la cuota de Google del comercio, no la de la plataforma.
 */
export const reconcilePlatformUsage = async ({ period, apply = false }) => {
  if (!period) throw new Error('reconcilePlatformUsage requiere period')

  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }

  const [fila] = await AiConsumptionLedger.aggregate([
    {
      $match: {
        period,
        event: { $in: [LEDGER_EVENT.CONSUMED, LEDGER_EVENT.REFUNDED] },
        keySource: { $ne: 'tenant' },
      },
    },
    {
      $group: {
        _id: null,
        // Los tokens NO se devuelven aunque la operación se devuelva: ya se
        // gastaron contra Google pase lo que pase, y el disyuntor se mide con
        // ellos. Devolverlos volvería el techo mentiroso.
        tokens: {
          $sum: {
            $cond: [
              { $and: [{ $eq: [UNIT, 'tokens'] }, { $ne: ['$event', LEDGER_EVENT.REFUNDED] }] },
              '$amount',
              0,
            ],
          },
        },
        costUsd: {
          $sum: { $cond: [esDevolucion, { $multiply: ['$costUsd', -1] }, '$costUsd'] },
        },
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reconciliacion-ia' })

  const almacenado = await AiPlatformUsage.findOne({ period }).lean()

  const tokensLedger = Math.round(Number(fila?.tokens || 0))
  const tokensAlmacenados = Math.round(Number(almacenado?.tokens || 0))
  const costoLedger = round(Number(fila?.costUsd || 0))
  const costoAlmacenado = round(Number(almacenado?.estimatedCostUsd || 0))

  const tokenDrift = tokensAlmacenados - tokensLedger
  const costDrift = round(costoAlmacenado - costoLedger)
  const hasDrift = tokenDrift !== 0 || Math.abs(costDrift) > COST_TOLERANCE_USD

  const report = {
    period,
    tokens: { stored: tokensAlmacenados, ledger: tokensLedger, drift: tokenDrift },
    cost: { stored: costoAlmacenado, ledger: costoLedger, drift: costDrift },
    hasDrift,
    applied: false,
  }

  if (!apply || !hasDrift) return report

  await AiPlatformUsage.updateOne(
    { period },
    { $set: { tokens: tokensLedger, estimatedCostUsd: costoLedger } },
    { upsert: true },
  )

  logger.error('[AI RECONCILE] Contador de plataforma corregido desde el ledger', {
    period,
    tokenDrift,
    costDrift,
  })

  return { ...report, applied: true }
}

export default {
  reconcileTenantUsage,
  reconcilePlatformUsage,
  getPeriodSpendByMetric,
  getPeriodSpendByModel,
  getPlatformSpendSnapshot,
}
