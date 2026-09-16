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
 * Cuánta de la contabilidad del período es medida, y cuánta plata hay detrás
 * de cada clase de supuesto.
 *
 * Va en el reporte y no en una nota al pie porque cambia cómo hay que leer el
 * total. Un costo repartido con una proporción asumida y uno calculado con el
 * usageMetadata real no son la misma clase de dato, y quien mira el número para
 * decidir algo tiene que saber cuál está mirando.
 *
 * SOLO CUENTA LAS FILAS DE TOKENS, Y ESA ES LA CORRECCIÓN QUE MÁS IMPORTA.
 *
 * Antes miraba TODOS los movimientos, y el resultado mentía. Medido en
 * producción sobre 2026-09:
 *
 *   todos los movimientos   160 filas · 27 estimadas (17%) · 24 sin modelo
 *   solo las de tokens      132 filas ·  4 estimadas  (3%) ·  0 sin modelo
 *
 * Las 19 de diferencia son ediciones de imagen. Llevan costEstimated porque el
 * precio es por imagen y se cobra al reservar, y no llevan modelo porque no lo
 * tienen: las sirve Replicate, no Gemini. Contarlas como "contabilidad
 * supuesta" inflaba el defecto cuatro veces y tapaba la señal real. Lo que se
 * cobra por unidad se informa aparte, en `flatRate`.
 *
 * LAS CUATRO CLASES SON EXCLUYENTES Y SUMAN EL TOTAL.
 *
 * Si se contaran solapadas, una fila estimada Y con tarifa de respaldo sumaría
 * dos veces y el reporte no cerraría contra el gasto. Van de peor a mejor:
 *
 *   unknownModel   ni siquiera se sabe qué modelo respondió
 *   priceFallback  el modelo se sabe, pero no está en el catálogo
 *   estimated      la tarifa se sabe; el reparto entrada/salida fue supuesto
 *   measured       todo real
 *
 * UNA ACLARACIÓN DE NOMBRES QUE CUESTA CARA SI SE PASA POR ALTO.
 *
 * `priceFallback` (ledger) y `pricingFallback` (AiProviderCall) se escriben
 * casi igual y significan cosas distintas: el primero es "sé el modelo, no
 * tengo su tarifa"; el segundo, "no sé ni el modelo". Acá se usa el nombre del
 * campo que se está contando, y el segundo caso viaja como `unknownModel`,
 * que dice lo que es.
 */
export const getPeriodQuality = async period => {
  const ES_TOKENS = { $eq: [{ $ifNull: ['$unit', 'units'] }, 'tokens'] }
  const SIN_MODELO = { $in: [{ $ifNull: ['$model', null] }, [null, '']] }

  // Excluyentes y en orden de gravedad: la primera que aplica se queda la fila.
  const clase = {
    $switch: {
      branches: [
        { case: SIN_MODELO, then: 'unknownModel' },
        { case: { $eq: ['$priceFallback', true] }, then: 'priceFallback' },
        { case: { $eq: ['$costEstimated', true] }, then: 'estimated' },
      ],
      default: 'measured',
    },
  }

  const filas = await AiConsumptionLedger.aggregate([
    { $match: { period, event: LEDGER_EVENT.CONSUMED } },
    {
      $group: {
        _id: { tokens: ES_TOKENS, clase },
        rows: { $sum: 1 },
        costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
      },
    },
  ]).option({ ignoreTenant: true, platformScope: 'platform:reporte-de-gasto-ia' })

  const acc = {
    measured: { rows: 0, costUsd: 0 },
    estimated: { rows: 0, costUsd: 0 },
    priceFallback: { rows: 0, costUsd: 0 },
    unknownModel: { rows: 0, costUsd: 0 },
  }
  const flatRate = { rows: 0, costUsd: 0 }

  for (const f of filas) {
    const destino = f._id.tokens ? acc[f._id.clase] : flatRate
    if (!destino) continue
    destino.rows += f.rows
    destino.costUsd += f.costUsd
  }

  const rows =
    acc.measured.rows + acc.estimated.rows + acc.priceFallback.rows + acc.unknownModel.rows
  const costUsd =
    acc.measured.costUsd +
    acc.estimated.costUsd +
    acc.priceFallback.costUsd +
    acc.unknownModel.costUsd

  return {
    // Los tres nombres que el panel ya leía. Siguen significando lo mismo, pero
    // ahora sobre las filas de tokens, que es donde la pregunta tiene sentido.
    rows,
    estimatedRows: acc.estimated.rows,
    fallbackRows: acc.priceFallback.rows,

    // El total de tokens, para que la suma de las cuatro clases se pueda
    // verificar contra él en vez de tener que confiar.
    costUsd: round(costUsd, 6),

    measured: acc.measured.rows,
    measuredCostUsd: round(acc.measured.costUsd, 6),
    estimated: acc.estimated.rows,
    estimatedCostUsd: round(acc.estimated.costUsd, 6),
    priceFallback: acc.priceFallback.rows,
    fallbackCostUsd: round(acc.priceFallback.costUsd, 6),
    unknownModel: acc.unknownModel.rows,
    unknownModelCostUsd: round(acc.unknownModel.costUsd, 6),

    // El número que contesta la pregunta de una sola lectura: qué porcentaje
    // del gasto en tokens salió de una medición y no de un supuesto. null
    // cuando no hubo gasto — es distinto de 0%.
    measuredShare: costUsd > 0 ? round((acc.measured.costUsd / costUsd) * 100, 1) : null,

    // Imágenes y mensajes: precio por unidad, no por token. No entra en el
    // porcentaje de arriba porque no hay desglose que medir ni suponer.
    flatRate: { rows: flatRate.rows, costUsd: round(flatRate.costUsd, 6) },
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
  getPeriodQuality,
  getPlatformSpendSnapshot,
}
