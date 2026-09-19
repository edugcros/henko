// 📁 src/services/ai/aiAccountingService.js
//
// Mantiene las proyecciones fieles al libro, y avisa cuando no lo son.
//
// LA REGLA
//
//   AiConsumptionLedger = fuente de verdad
//   AiUsage             = proyección
//   AiPlatformUsage     = proyección
//   Reportes            = consultas
//
// POR QUÉ LAS PROYECCIONES NO SE DERIVAN EN CALIENTE
//
// Sería lo natural: escribir el libro y que los agregados salgan de él. No se
// puede con AiUsage, y el motivo es concreto: el tope de cuota viaja DENTRO
// del filtro del findOneAndUpdate que reserva, y eso es lo que hace atómico el
// control. Un número que hay que calcular agregando el ledger no puede ir
// adentro de ese filtro — habría que leerlo primero y escribir después, que es
// la carrera que este paquete entero viene cerrando.
//
// Así que el medidor sigue escribiendo el agregado y el libro en el mismo
// acto. Lo que hace de AiUsage una PROYECCIÓN y no una segunda verdad es que
// se pueda reconstruir desde el libro, y que la diferencia se vea.
//
// POR QUÉ ESTO ES UN ARCHIVO Y NO DOS
//
// Proyectar y reconciliar son la misma responsabilidad mirada desde dos
// momentos: reconstruir el agregado desde el libro, y comparar antes de
// reconstruir. Separarlas dejaría un archivo cuyo único consumidor es el otro.
//
// PRIMERO DETECTAR, DESPUÉS CORREGIR
//
// El ciclo automático NUNCA corrige. Detecta, registra y avisa. Corregir un
// agregado sin que una persona haya mirado la evidencia es la forma más rápida
// de convertir un bug de lectura en pérdida de datos — y ya pasó una vez acá:
// la primera versión de esta reconciliación bajaba un contador correcto de 3 a
// 2 cuando al libro le faltaba una fila.

import mongoose from 'mongoose'

import AiConsumptionLedger, { LEDGER_EVENT } from '../../models/aiConsumptionLedgerModel.js'
import AiOperation from '../../models/aiOperationModel.js'
import AiPlatformUsage from '../../models/aiPlatformUsageModel.js'
import AiUsage from '../../models/aiUsageModel.js'
import logger from '../../../config/logger.js'
import { AI_METRICS, AI_METRIC_LIST } from './aiPlanPolicy.js'
import { getCurrentPeriod } from './aiPeriod.js'
import { notifyAccountingDrift } from './aiBudgetNotifier.js'

const round = (value, decimals = 4) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Number(number.toFixed(decimals))
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

/** Las filas viejas anteriores al campo `unit` valen como unidades, igual que el default del schema. */
const UNIT = { $ifNull: ['$unit', 'units'] }

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
export const rebuildTenantProjection = async ({ tenantId, period, apply = false }) => {
  if (!tenantId || !period) {
    throw new Error('rebuildTenantProjection requiere tenantId y period')
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
  // así que hay que reconocer la operación adentro de esa clave compuesta.
  //
  // ESTO DECÍA split(':')[0] Y ERA UN BUG QUE APAGABA LA RECONCILIACIÓN ENTERA.
  //
  // Asumía que un operationId no lleva dos puntos. El del agente sí:
  //
  //   AiOperation     agent:6a4dcc91…:msg_d87f0262-…
  //   ledger          agent:6a4dcc91…:msg_d87f0262-…:main
  //   split(':')[0]   "agent"                            ← no coincide con nada
  //
  // Resultado medido en producción: 8 de 23 operaciones del período se
  // reportaban como ausentes del libro teniendo sus tres filas —la reserva y
  // las dos llamadas—, ledgerComplete quedaba en false, y la corrección
  // automática se negaba a aplicar. O sea que el drift real que la
  // reconciliación existe para cerrar (−17.223 tokens, −0,006 USD) no se
  // cerraba nunca, y el panel mostraba números viejos sin que nada avisara.
  //
  // Y fallaba justo para el agente, que es el mayor consumidor: el único
  // llamador que namespacea su clave es el que más filas escribe.
  //
  // Ahora se indexan TODOS los prefijos en los límites de ':', así que la
  // operación se encuentra sin importar cuántos segmentos tenga su clave ni
  // cuántos le agregue el callId — 'tool:tavily_search' agrega dos.
  const conocidas = new Set()
  for (const id of enElLedger.filter(Boolean)) {
    const partes = String(id).split(':')
    for (let i = 1; i <= partes.length; i += 1) {
      conocidas.add(partes.slice(0, i).join(':'))
    }
  }

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
export const rebuildPlatformProjection = async ({ period, apply = false }) => {
  if (!period) throw new Error('rebuildPlatformProjection requiere period')

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

// ─── AUDITORÍA CRUZADA ──────────────────────────────────────────────────────

/**
 * Compara las TRES representaciones del mismo dinero.
 *
 *   ledger            — la suma del libro, que es la verdad
 *   AiUsage           — la suma de lo que cree cada comercio
 *   AiPlatformUsage   — lo que cree la plataforma, y lo que mide el disyuntor
 *
 * El caso que motiva esto es exactamente el del enunciado:
 *
 *   Ledger:           82.31
 *   AiPlatformUsage:  82.31
 *   AiUsage:          80.21   ← acá hay 2,10 que alguien pagó y nadie le cobró
 *
 * Los tres se escriben en el mismo acto, pero NO sobre la misma base, y eso
 * hay que tenerlo en cuenta para compararlos:
 *
 *   libro            incluye BYOK (lo que el comercio le pagó a su proveedor)
 *   AiUsage          incluye BYOK
 *   AiPlatformUsage  NO: con key propia HENKO no paga nada
 *
 * Acá decía que BYOK "no desalinea nada porque ahí el costo es cero en los
 * tres". Es falso: el libro guarda el costo del proveedor del comercio, que
 * es justamente lo que le permite a ese comercio ver su gasto. Comparar el
 * libro entero contra el contador de plataforma daba descuadre permanente.
 *
 * Cuando NO dan lo mismo, la diferencia dice dónde mirar:
 *
 *   ledger ≠ plataforma  → se perdió una escritura de una de las dos partes
 *   ledger ≠ comercios   → lo mismo, del lado del agregado por comercio
 *   plataforma ≠ comercios, ledger de acuerdo con uno → el otro es el roto
 *
 * NO corrige. Devuelve evidencia.
 *
 * @param {string} [period]
 * @returns {Promise<AccountingAudit>}
 */
export const auditAccounting = async (period = getCurrentPeriod()) => {
  const esDevolucion = { $eq: ['$event', LEDGER_EVENT.REFUNDED] }
  const conSigno = campo => ({ $cond: [esDevolucion, { $multiply: [campo, -1] }, campo] })

  const [libro, comercios, plataforma] = await Promise.all([
    // Agrupado por si la fila la pagó el comercio con su key o la plataforma.
    // Sin esa separación no hay forma de comparar: ver el bloque de abajo.
    AiConsumptionLedger.aggregate([
      { $match: { period } },
      {
        $group: {
          _id: { $eq: [{ $ifNull: ['$keySource', 'platform'] }, 'tenant'] },
          costUsd: { $sum: conSigno('$costUsd') },
        },
      },
    ]).option({ ignoreTenant: true, platformScope: 'platform:auditoria-contable-ia' }),

    // La suma de lo que cree cada comercio. Va con ignoreTenant por el mismo
    // motivo que el resto de este archivo: la pregunta es de la plataforma, y
    // lo que devuelve es un total sin nada identificable.
    AiUsage.aggregate([
      { $match: { period } },
      { $group: { _id: null, costUsd: { $sum: '$estimatedCostUsd' } } },
    ]).option({ ignoreTenant: true, platformScope: 'platform:auditoria-contable-ia' }),

    AiPlatformUsage.findOne({ period }).lean(),
  ])

  // NO SE REDONDEA ANTES DE COMPARAR, Y ANTES SÍ
  //
  // Acá se redondeaba cada total a centavos y recién después se comparaba
  // contra COST_TOLERANCE_USD, que es 0.0001. Después de cuantizar a centavos
  // la mínima diferencia distinta de cero es 0.01: cien veces la tolerancia.
  // O sea que la tolerancia era INALCANZABLE. O los tres números caían en el
  // mismo centavo y la diferencia daba exactamente cero, o se reportaba. El
  // ruido de punto flotante que la tolerancia existe para absorber no podía
  // absorberse nunca.
  //
  // Medido en producción el 18/09/2026, período 2026-09:
  //
  //   ledger         1.071712     tenantUsage   1.071685
  //   platformUsage  1.076655
  //
  //   ledger - tenantUsage    = 0.000027   ← ruido, POR DEBAJO de la tolerancia
  //   ledger - platformUsage  = 0.004943   ← real, 49x la tolerancia
  //
  // Los dos se reportaban igual: 0.01. Uno era ruido que había que callar y el
  // otro era medio centavo real informado como el doble. Un aviso que no
  // distingue esas dos cosas no sirve para decidir nada, y encima se disparaba
  // siempre — que es la forma más rápida de que se deje de leer.
  // LOS TRES NÚMEROS NO ESTABAN EN LA MISMA BASE, Y ASÍ NO PODÍAN CUADRAR
  //
  // El encabezado de esta función decía que BYOK "no desalinea nada porque ahí
  // el costo es cero en los tres". Es falso, y se ve en producción:
  //
  //   keySource=tenant  consumed  26 filas  costo 0.056
  //
  // Con key propia el costo para HENKO es cero, pero el LIBRO igual guarda lo
  // que el comercio le pagó a su proveedor — y está bien que lo guarde, es la
  // única forma de que ese comercio vea su gasto. Lo que no está bien es
  // comparar ese total contra un contador que por definición no lo incluye:
  // registerPlatformConsumption recibe costUsd=0 para BYOK, y
  // rebuildPlatformProjection filtra keySource != 'tenant'.
  //
  //   libro completo    incluye BYOK   ← comparable con AiUsage
  //   AiUsage           incluye BYOK
  //   AiPlatformUsage   NO incluye BYOK
  //
  // Medido en 2026-09: libro 1.071712, AiUsage 1.071685 (coinciden), y
  // platformUsage 1.076655 contra un libro sin BYOK de 1.015712. La auditoría
  // informaba 0.004943 de deriva cuando la real, en la base correcta, era
  // 0.060943 — y con BYOK en cero habría informado descuadre igual, para
  // siempre, porque comparaba peras con manzanas.
  //
  // Ahora cada comparación va contra la base que le corresponde.
  const byokCost = Number(libro?.find(f => f._id === true)?.costUsd || 0)
  const plataformaCost = Number(libro?.find(f => f._id === false)?.costUsd || 0)
  const ledgerCost = byokCost + plataformaCost

  const tenantsCost = Number(comercios?.[0]?.costUsd || 0)
  const platformCost = Number(plataforma?.estimatedCostUsd || 0)

  const findings = []

  const anotar = (left, right, leftName, rightName) => {
    const difference = left - right
    if (Math.abs(difference) <= COST_TOLERANCE_USD) return

    // Seis decimales: por debajo de la tolerancia y muy por encima de lo que
    // necesita una diferencia de medio centavo. Redondear acá es presentación,
    // no comparación.
    findings.push({ between: [leftName, rightName], difference: round(difference, 6) })
  }

  // Con BYOK: el libro entero contra lo que creen los comercios.
  anotar(ledgerCost, tenantsCost, 'ledger', 'tenantUsage')
  // Sin BYOK: la parte que pagó la plataforma contra su propio contador.
  anotar(plataformaCost, platformCost, 'ledgerSinByok', 'platformUsage')
  // Y la tercera pata, que es la que permite triangular cuál de las dos
  // proyecciones se rompió cuando las otras dos comparaciones fallan. Se le
  // resta el BYOK a los comercios para ponerla en la base del contador.
  anotar(platformCost, tenantsCost - byokCost, 'platformUsage', 'tenantUsageSinByok')

  return {
    period,
    // A la misma precisión que las diferencias. Mostrar los montos en centavos
    // y la diferencia en diezmilésimas haría que el correo se contradiga solo:
    // "1.07 contra 1.08" al lado de "diferencia 0.0049".
    cost: {
      ledger: round(ledgerCost, 6),
      ledgerSinByok: round(plataformaCost, 6),
      byok: round(byokCost, 6),
      tenantUsage: round(tenantsCost, 6),
      platformUsage: round(platformCost, 6),
    },
    findings,
    balanced: findings.length === 0,
  }
}

// ─── CICLO AUTOMÁTICO ───────────────────────────────────────────────────────
//
// DETECTAR → REGISTRAR → AVISAR. Nunca corregir.
//
// Corregir un agregado sin que una persona haya mirado la evidencia es la
// forma más rápida de convertir un bug de lectura en pérdida de datos. Ya pasó
// acá: la primera versión de esta reconciliación bajaba un contador correcto
// de 3 a 2 cuando al libro le faltaba una fila. La corrección existe
// —rebuildTenantProjection con apply— y se pide a mano.

let cicloRef = null

// El timer de la pasada de arranque. Se guarda para poder cancelarlo: sin
// esto, stopAccountingAudit dejaba una auditoria pendiente que se disparaba
// despues de haber apagado el ciclo — en un test, sobre una base ya cerrada.
let arranqueRef = null

const envPositiveInt = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Una pasada: audita el período en curso y avisa si no cuadra.
 *
 * @returns {Promise<AccountingAudit|null>}
 */
export const runAccountingAudit = async ({ period = getCurrentPeriod() } = {}) => {
  try {
    const auditoria = await auditAccounting(period)

    if (auditoria.balanced) {
      logger.info('[AI ACCOUNTING] Contabilidad cuadrada', {
        period,
        costUsd: auditoria.cost.ledger,
      })
      return auditoria
    }

    // Nivel error y no warn: una diferencia acá significa que alguien pagó
    // algo que no se le cobró, o al revés. No es una métrica que se mira
    // cuando hay tiempo.
    logger.error('[AI ACCOUNTING] La contabilidad NO cuadra', {
      period,
      ...auditoria.cost,
      findings: auditoria.findings,
    })

    await notifyAccountingDrift(auditoria)

    return auditoria
  } catch (error) {
    logger.error('[AI ACCOUNTING] La auditoría falló', {
      period,
      error: error.message,
    })
    return null
  }
}

/**
 * Arranca la auditoría periódica.
 *
 * Una vez por hora alcanza: la diferencia que busca no aparece de golpe, se
 * acumula. Y cada pasada son tres agregaciones sobre el período en curso, así
 * que correrla más seguido es gasto sin información nueva.
 */
export const startAccountingAudit = ({ logger: log = logger } = {}) => {
  if (process.env.AI_ACCOUNTING_AUDIT_ENABLED === 'false') {
    log.info?.('[AI ACCOUNTING] Auditoría automática deshabilitada')
    return
  }

  if (cicloRef) return

  const intervalMs = envPositiveInt('AI_ACCOUNTING_AUDIT_INTERVAL_MS', 60 * 60 * 1000)

  // UNA PASADA AL ARRANCAR, Y SIN ESTO LA AUDITORÍA NO CORRÍA NUNCA.
  //
  // Es la misma lección que ya tiene escrita el barrido de reservas viejas
  // (ver startStaleOperationSweeper), y acá pegaba más fuerte porque el
  // intervalo es cuatro veces más largo.
  //
  // Medido en los logs de producción: entre las 00:46 y las 06:25 de un mismo
  // día hay VEINTICINCO líneas de "[AI ACCOUNTING] Auditoría automática
  // iniciada" y CERO de "Contabilidad cuadrada" o "La contabilidad NO cuadra".
  // O sea: el servicio arrancó 25 veces y el tick de sesenta minutos no llegó
  // a dispararse ni una. La ventana más larga entre reinicios fue de 60
  // minutos justos, al borde.
  //
  // La auditoría existía, estaba encendida, tenía su prueba, y no se ejecutó
  // nunca. Un timer largo en un servicio que se reinicia seguido es un timer
  // que no corre.
  //
  // Va con un retraso corto y no en el instante cero: al arrancar hay
  // conexiones abriéndose y migraciones corriendo, y tres agregaciones sobre
  // el período no tienen ninguna urgencia de segundos.
  const arranqueMs = envPositiveInt('AI_ACCOUNTING_AUDIT_ON_START_MS', 90 * 1000)

  arranqueRef = setTimeout(() => {
    runAccountingAudit().catch(error => {
      log.error?.('[AI ACCOUNTING] La auditoría de arranque falló', {
        error: error.message,
      })
    })
  }, arranqueMs)

  arranqueRef.unref?.()

  cicloRef = setInterval(() => {
    runAccountingAudit().catch(error => {
      log.error?.('[AI ACCOUNTING] El ciclo falló', { error: error.message })
    })
  }, intervalMs)

  cicloRef.unref?.()

  log.info?.('[AI ACCOUNTING] Auditoría automática iniciada', {
    intervalMinutes: Math.round(intervalMs / 60000),
    primeraPasadaEnSegundos: Math.round(arranqueMs / 1000),
  })
}

export const stopAccountingAudit = () => {
  if (cicloRef) {
    clearInterval(cicloRef)
    cicloRef = null
  }

  if (arranqueRef) {
    clearTimeout(arranqueRef)
    arranqueRef = null
  }
}

export default {
  rebuildTenantProjection,
  rebuildPlatformProjection,
  auditAccounting,
  runAccountingAudit,
  startAccountingAudit,
  stopAccountingAudit,
}
