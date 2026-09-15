// 📁 src/services/ai/aiBudgetService.js
//
// Medidor único de consumo de IA. Reemplaza a aiUsageService (que solo medía
// análisis de imagen) y a la cuota que vivía suelta dentro del cerebro del
// agente con los defaults del schema.
//
// Reglas del medidor:
//
//  - Reservar ANTES de gastar. Si reserve devuelve allowed:false no se llama
//    al proveedor. Devolver la reserva (refund) si el proveedor falló, porque
//    esa falla no es del comercio.
//  - La reserva es atómica: un findOneAndUpdate con el tope dentro del filtro,
//    para que dos requests concurrentes del mismo tenant no puedan pasarse.
//  - Los tokens no se pueden reservar (recién se conocen después de la
//    respuesta): se registran a posteriori y actúan como guarda del mensaje
//    siguiente. Es el mismo criterio que ya usaba el agente.
//  - Si el tenant trae su propia key, no se cobra contra ningún tope de la
//    plataforma, pero se registra igual para poder dimensionar su plan.

import { randomUUID } from 'node:crypto'

import AiUsage from '../../models/aiUsageModel.js'
import AiAgent from '../../models/aiAgentModel.js'
import AiPlatformUsage from '../../models/aiPlatformUsageModel.js'
import logger from '../../../config/logger.js'
import { cacheGet, cacheSet, cacheDel } from '../../utils/cache.js'
import {
  AI_METRICS,
  AI_METRIC_LABELS,
  AI_METRIC_LIST,
  UNLIMITED,
  estimateImageCostUsd,
  getPlanLimit,
  getPlatformMonthlyTokenBudget,
  getPlatformMonthlyUsdBudget,
  getEstimatedCostUsd,
  getSharedKeyTenantCap,
  getSubscriptionState,
  normalizeMetric,
  normalizePlan,
} from './aiPlanPolicy.js'
import { KEY_SOURCE, loadTenantAiProfile } from './aiCredentialsService.js'
import { computeCostUsd, normalizeModelName } from './aiModelPricing.js'
import { getPeriodSpendByMetric } from './aiSpendReportService.js'
import { getCurrentPeriod } from './aiPeriod.js'
import { notifyBudgetPressure, EMAIL_THRESHOLD } from './aiBudgetNotifier.js'
import AiConsumptionLedger, { LEDGER_EVENT } from '../../models/aiConsumptionLedgerModel.js'
import AiProviderCall, { CALL_ID } from '../../models/aiProviderCallModel.js'
import AiOperation, {
  AI_FEATURES,
  AI_OPERATION_STATUS,
  AI_PROVIDERS,
  HOLDS_QUOTA,
} from '../../models/aiOperationModel.js'

// Se reexportan para que quien mide consumo tenga un único import: el medidor
// es la puerta de entrada, la política es un detalle de implementación suyo.
export { AI_METRICS, AI_METRIC_LABELS, UNLIMITED }
// Mismo criterio: quien mide consumo declara de dónde viene con un solo
// import, sin tener que conocer el modelo por dentro.
export { AI_FEATURES, AI_PROVIDERS, AI_OPERATION_STATUS, CALL_ID }

const clean = value => String(value || '').trim()

const BREAKER_CACHE_KEY = 'ai:platform:breaker'
const BREAKER_CACHE_TTL_SEC = 30

/**
 * Las métricas que se miden en tokens y por lo tanto cuestan plata.
 *
 * Antes esto era una comparación contra AGENT_TOKENS solamente, y MARKET_TOKENS
 * quedaba afuera: el consumo de los análisis de mercado no sumaba costo ni
 * llegaba a registerPlatformConsumption, o sea que era invisible para el
 * disyuntor de plataforma — el único techo duro de gasto no veía esa vía
 * entera. Como conjunto, agregar una métrica de tokens nueva no vuelve a
 * requerir acordarse de este lugar.
 */
const TOKEN_METRICS = new Set([AI_METRICS.AGENT_TOKENS, AI_METRICS.MARKET_TOKENS])

/**
 * Último recurso cuando el llamador no informa qué modelo usó.
 *
 * Es un supuesto, no una verdad, y por eso conviene que casi nunca se use: el
 * que corrió la llamada es el único que sabe si hubo respaldo, y la cadena de
 * respaldo cruza tarifas que difieren hasta 5x (3.6-flash 0,75/3,75 contra
 * 3.1-flash-lite 0,25/1,50). Un costo calculado con el modelo equivocado no se
 * nota en ningún lado: sale un número plausible. Hoy visión y el agente pasan
 * el modelo real; esto queda para lo que no lo haga.
 *
 * Se lee en cada llamada, no una vez al arrancar, por la misma razón que el
 * resto de la política (getPlatformMonthlyTokenBudget, getPlanLimit): un valor
 * congelado en el import no se puede corregir ni testear sin recargar el
 * módulo, y es una asimetría que sorprende al que lee el archivo.
 *
 * El orden de precedencia replica el de aiVisionService::MODEL_NAME.
 */
const getDefaultPricingModel = () =>
  normalizeModelName(
    process.env.GEMINI_IMAGE_MODEL ||
      process.env.GOOGLE_IMAGE_MODEL ||
      process.env.GEMINI_MODEL ||
      'gemini-3.8-flash',
  )

/**
 * Escribe una fila del ledger. Nunca lanza.
 *
 * El ledger registra lo que YA pasó, así que un fallo suyo no puede tumbar una
 * operación de IA que salió bien. Se loguea con nivel error y no warn: un libro
 * contable que falla en silencio es peor que no tenerlo, porque igual se confía
 * en él para decir cuánto se gastó.
 */
/**
 * Abre la operación, y de paso decide si esto es un reintento.
 *
 * ES EL CANDADO DEL COBRO. Se escribe ANTES de tocar cualquier contador: si el
 * insert entra, la operación es nueva y el cobro procede; si choca contra el
 * índice único, ese cobro ya ocurrió y hay que saltearlo entero.
 *
 * Medido contra una base real antes de esto, llamando dos veces con la misma
 * clave: el ledger guardaba UNA fila —su índice ya funcionaba— y
 * `counters.agentMessages` marcaba 2, `AiPlatformUsage.tokens` marcaba 3000
 * sobre 1500 reales. El `$inc` corría primero y la escritura del ledger ni
 * siquiera se esperaba, así que el duplicado se detectaba tarde.
 *
 * @returns {Promise<{fresh: boolean, operation: Object|null}>}
 *   fresh:false significa "esto ya se cobró". El llamador NO debe incrementar.
 */
const openOperation = async ({
  tenantId,
  operationId,
  period,
  metric,
  amount,
  feature = null,
  provider = null,
  requestedModel = null,
  reservedCostUsd = 0,
  status = AI_OPERATION_STATUS.RUNNING,
}) => {
  try {
    const operation = await AiOperation.create({
      tenantId,
      operationId,
      period,
      metric,
      amount,
      feature,
      provider,
      requestedModel,
      reservedCostUsd,
      status,
      startedAt: new Date(),
    })

    return { fresh: true, operation }
  } catch (error) {
    if (error?.code === 11000) {
      // La clave ya existe. Lo que decide qué hacer es EN QUÉ ESTADO quedó:
      //
      //   running / completed → hay cupo reservado a su nombre. Volver a
      //                         cobrarlo es el bug que esto vino a cerrar.
      //   pending / failed / refunded → no hay nada cobrado. Es el caso normal
      //                         de "el proveedor se cayó, probá de nuevo", y
      //                         el reintento tiene que poder reservar.
      //
      // La transición se hace en UNA sola operación con el estado en el
      // filtro: leer y después escribir sería la misma carrera que todo esto
      // intenta cerrar, un nivel más arriba.
      const reabierta = await AiOperation.findOneAndUpdate(
        { tenantId, operationId, status: { $nin: HOLDS_QUOTA } },
        {
          $set: {
            status,
            startedAt: new Date(),
            failedAt: null,
            failureReason: null,
            ...(requestedModel ? { requestedModel } : {}),
          },
        },
        { new: true },
      )
        .setOptions({ tenantId })
        .lean()
        .catch(() => null)

      if (reabierta) {
        logger.info('[AI OPERATION] Reintento de una operación sin cupo retenido', {
          tenantId: String(tenantId),
          operationId,
          metric,
        })

        return { fresh: true, operation: reabierta }
      }

      logger.info('[AI OPERATION] Reintento detectado, no se cobra de nuevo', {
        tenantId: String(tenantId),
        operationId,
        metric,
      })

      const operation = await AiOperation.findOne({ tenantId, operationId })
        .setOptions({ tenantId })
        .lean()
        .catch(() => null)

      return { fresh: false, operation }
    }

    // FALLA ABIERTA. La base de contabilidad caída no puede ser el motivo por
    // el que un comercio se queda sin poder usar la IA: es el mismo contrato
    // que ya tenía el ledger. Se pierde la protección contra reintentos en esa
    // ventana, y por eso se loguea en error y no en warn.
    logger.error('[AI OPERATION] No se pudo abrir la operación, se sigue sin candado', {
      tenantId: String(tenantId),
      operationId,
      metric,
      error: error.message,
    })

    return { fresh: true, operation: null }
  }
}

/**
 * Reclama el consumo de UNA LLAMADA. Devuelve false si ya estaba reclamado.
 *
 * La unidad no es la operación: es la llamada dentro de la operación. Una
 * operación puede hacer varias legítimamente —el agente contesta y repara, el
 * análisis de mercado busca y estructura— y cada una se paga.
 *
 * La versión anterior reclamaba por operación y marcaba 'completed' con la
 * PRIMERA llamada que registrara consumo. Con dos llamadas reales, la segunda
 * se habría descartado como reintento y su costo habría desaparecido de la
 * contabilidad. Eso no se notaba porque aiAgentBrainService le inventaba a la
 * reparación una operación falsa —`${operationId}:repair`— que esquivaba el
 * problema contando dos operaciones donde hay una.
 *
 * El insert de AiProviderCall ES el candado: su índice único (tenant,
 * operación, llamada) impone la unicidad en la base, no una comprobación
 * previa en el código.
 *
 * Sin operationId no hay nada que reclamar y se deja pasar: cerrar el paso
 * sería dejar de registrar consumo real de los llamadores que todavía no
 * informan clave, que es peor que el problema.
 */
const claimConsumption = async ({
  tenantId,
  operationId,
  callId = CALL_ID.MAIN,
  period,
  metric,
  amount = 0,
  provider = null,
  requestedModel = null,
  actualModel = null,
  breakdown = null,
  costUsd = 0,
  ok = true,
}) => {
  if (!operationId || !tenantId) return true

  try {
    await AiProviderCall.create({
      tenantId,
      operationId,
      callId,
      period,
      metric,
      provider,
      requestedModel,
      actualModel,
      inputTokens: breakdown?.inputTokens ?? null,
      outputTokens: breakdown?.outputTokens ?? null,
      totalTokens: breakdown?.totalTokens ?? Math.max(0, Math.round(Number(amount) || 0)),
      costUsd: Number(costUsd) || 0,
      ok,
    })
  } catch (error) {
    if (error?.code === 11000) {
      logger.info('[AI OPERATION] Llamada ya registrada, no se cobra de nuevo', {
        tenantId: String(tenantId),
        operationId,
        callId,
        metric,
      })

      return false
    }

    logger.error('[AI OPERATION] No se pudo registrar la llamada, se sigue sin candado', {
      tenantId: String(tenantId),
      operationId,
      callId,
      metric,
      error: error.message,
    })

    return true
  }

  // LA LIQUIDACIÓN.
  //
  // Ya se conoce el costo real, así que lo comprometido al reservar se suelta.
  // El gasto verdadero entra por registerPlatformConsumption, que es quien
  // mueve estimatedCostUsd; acá solo se libera la retención.
  //
  //   reservado  0,010
  //   real       0,0034   ← lo cobra registerPlatformConsumption
  //   liberado   0,010    ← lo suelta esto
  //
  // Se libera el total y no la diferencia porque son dos contadores distintos:
  // el techo mira la suma de los dos, así que soltar todo lo retenido y sumar
  // todo lo gastado deja el número final exacto.
  //
  // La liberación se hace ANTES de cerrar la operación y se espera: si el
  // proceso muere en el medio, la reserva queda retenida y la levanta el
  // barrido de colgadas. Al revés —cerrar primero— la operación quedaría
  // 'completed' con plata retenida que ya nadie busca.
  await liquidarReserva({ tenantId, operationId, period })

  // El estado de la operación es observabilidad y no se espera: el dinero ya
  // lo mueven los contadores y el ledger. La última llamada que registre
  // consumo deja la operación completada, que es lo que uno quiere saber.
  closeOperation({
    tenantId,
    operationId,
    status: AI_OPERATION_STATUS.COMPLETED,
    actualModel,
  })

  return true
}

/**
 * Suelta la plata que una operación tenía retenida, una sola vez.
 *
 * El reclamo va en el filtro: solo quien encuentra la operación CON reserva
 * pendiente la libera, así que una liquidación y un barrido que se crucen
 * sobre la misma operación no descuentan dos veces.
 */
const liquidarReserva = async ({ tenantId, operationId, period }) => {
  if (!operationId || !tenantId) return

  const operacion = await AiOperation.findOneAndUpdate(
    { tenantId, operationId, reservedCostUsd: { $gt: 0 } },
    { $set: { reservedCostUsd: 0 } },
    { new: false },
  )
    .setOptions({ tenantId })
    .lean()
    .catch(() => null)

  if (!operacion) return

  await releasePlatformCost({
    period: operacion.period || period,
    amount: Number(operacion.reservedCostUsd || 0),
  })
}

/**
 * Cierra la operación. No se espera a propósito: el estado final es
 * observabilidad, no dinero — el dinero ya lo movieron los contadores y el
 * ledger. Hacer esperar a quien llama por una escritura que no cambia ninguna
 * decisión sería cobrarle latencia al comercio por nuestra trazabilidad.
 */
const closeOperation = ({
  tenantId,
  operationId,
  status,
  actualModel = null,
  failureReason = null,
}) => {
  if (!operationId || !tenantId) return

  const now = new Date()

  AiOperation.updateOne(
    { tenantId, operationId },
    {
      $set: {
        status,
        ...(actualModel ? { actualModel } : {}),
        ...(failureReason ? { failureReason: String(failureReason).slice(0, 200) } : {}),
        ...(status === AI_OPERATION_STATUS.COMPLETED ? { completedAt: now } : {}),
        ...(status === AI_OPERATION_STATUS.FAILED || status === AI_OPERATION_STATUS.REFUNDED
          ? { failedAt: now }
          : {}),
      },
    },
  )
    .setOptions({ tenantId })
    .catch(error => {
      logger.warn('[AI OPERATION] No se pudo cerrar la operación', {
        tenantId: String(tenantId),
        operationId,
        status,
        error: error.message,
      })
    })
}

/**
 * La clave con la que el movimiento entra al ledger.
 *
 * El índice único del ledger es (tenant, operación, evento), y una operación
 * con dos llamadas produce legítimamente dos consumos. Componer la clave acá
 * los mantiene distinguibles sin tocar ese índice, que ya está construido
 * sobre datos de producción: cambiarlo exigiría reconstruirlo con la colección
 * en uso, y el beneficio no lo justifica.
 *
 * Es el mismo sufijo que antes armaba aiAgentBrainService a mano. La
 * diferencia es dónde vive: ahora es un detalle del medidor y no una decisión
 * que cada llamador toma por su cuenta — y AiOperation ya no lo ve, así que el
 * conteo de operaciones dejó de estar inflado.
 */
const ledgerKey = (operationId, callId) =>
  !operationId || !callId || callId === CALL_ID.MAIN
    ? operationId
    : `${operationId}:${callId}`

const writeLedgerEntry = ({
  tenantId,
  period,
  event,
  metric,
  amount,
  model = null,
  keySource = null,
  plan = null,
  breakdown = null,
  costUsd = 0,
  unit = 'units',
  operationId = null,
}) => {
  AiConsumptionLedger.create({
    tenantId,
    period,
    event,
    metric,
    amount: Math.max(0, Math.round(Number(amount) || 0)),
    unit,
    operationId,
    model,
    keySource,
    plan,
    inputTokens: breakdown?.inputTokens ?? null,
    outputTokens: breakdown?.outputTokens ?? null,
    totalTokens: breakdown?.totalTokens ?? null,
    costUsd: Number(costUsd) || 0,
    priceInputPerMillion: breakdown?.price?.input ?? null,
    priceOutputPerMillion: breakdown?.price?.output ?? null,
    costEstimated: Boolean(breakdown?.estimated),
    priceFallback: Boolean(breakdown?.price?.fallback),
  }).catch(error => {
    // 11000 es la violación del índice único de (tenant, operación, evento).
    // No es un fallo: es que este movimiento ya estaba registrado y alguien
    // reintentó. Descartarlo en silencio ES el comportamiento correcto — la
    // primera fila queda, que es la que vale. Se registra en info y no en
    // error, porque un reintento tratado como error entrena a ignorar el log
    // justo donde hay que mirarlo.
    if (error?.code === 11000) {
      logger.info('[AI LEDGER] Movimiento repetido descartado', {
        tenantId: String(tenantId),
        operationId,
        event,
        metric,
      })
      return
    }

    logger.error('[AI LEDGER] No se pudo registrar el movimiento', {
      tenantId: String(tenantId),
      event,
      metric,
      error: error.message,
    })
  })
}

export const DENY_REASONS = Object.freeze({
  SUBSCRIPTION: 'subscription_inactive',
  NO_API_KEY: 'no_api_key',
  METRIC_LIMIT: 'metric_limit_exceeded',
  GUARD_LIMIT: 'guard_limit_exceeded',
  PLATFORM_BUDGET: 'platform_budget_exhausted',
})

/**
 * Mensaje accionable por motivo de rechazo.
 *
 * Vive acá y no en el middleware porque el mismo rechazo puede llegarle al
 * comercio por tres caminos distintos (ruta admin, análisis de imagen,
 * agente) y tiene que decir siempre lo mismo. Regla: cada mensaje explica qué
 * pasó y qué hacer, sin obligar a abrir un ticket.
 */
export const buildBudgetDenialMessage = (result = {}) => {
  const label = AI_METRIC_LABELS[result.metric] || 'funciones de IA'

  switch (result.reason) {
  case DENY_REASONS.SUBSCRIPTION:
    return 'Las funciones de IA están pausadas porque la suscripción no está al día. El resto de la tienda sigue funcionando normalmente.'

  case DENY_REASONS.NO_API_KEY:
    return 'El servicio de IA no está configurado. Configurá una API key propia desde el panel o contactá al soporte.'

  case DENY_REASONS.PLATFORM_BUDGET:
    return 'El servicio de IA está temporalmente pausado por mantenimiento de capacidad. Volvé a intentar más tarde.'

  case DENY_REASONS.GUARD_LIMIT:
    return `Se alcanzó el límite mensual de ${label} de tu plan. Se renueva el mes que viene, o podés subir de plan.`

  default:
    return `Se alcanzó el límite mensual de ${label} de tu plan (${result.limit}). Se renueva el mes que viene, o podés subir de plan.`
  }
}

// Se sigue reexportando desde acá: era el origen del dato y hay call sites
// —platformMarginService, entre otros— que lo importan de este módulo.
export { getCurrentPeriod }

const counterPath = metric => `counters.${metric}`

const readCounter = (usage, metric) => {
  const value = Number(usage?.counters?.[metric])
  if (Number.isFinite(value)) return value

  // Documentos creados antes de este refactor solo tienen analysisCount.
  if (metric === AI_METRICS.VISION) {
    const legacy = Number(usage?.analysisCount)
    return Number.isFinite(legacy) ? legacy : 0
  }

  return 0
}

const buildDeniedResult = ({ metric, limit, used, reason, detail, profile }) => ({
  allowed: false,
  metric,
  limit,
  used,
  remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
  unlimited: limit === UNLIMITED,
  reason,
  detail: detail || null,
  keySource: profile?.keySource || KEY_SOURCE.NONE,
  plan: normalizePlan(profile?.plan),
  label: AI_METRIC_LABELS[metric] || metric,
})

// ─── Disyuntor de plataforma ─────────────────────────────

/**
 * ¿Se agotó el presupuesto global del mes contra la key propia?
 *
 * Se cachea 30 segundos: es un backstop de fin de mes, no un contador exacto.
 * Pagar una lectura extra por cada mensaje del agente para afinarlo al
 * segundo no compra nada.
 */
/**
 * Compromete plata ANTES de llamar al proveedor. Atómica.
 *
 * ES LA DIFERENCIA ENTRE UN TECHO Y UNA SUGERENCIA
 *
 * El costo real se conoce después de la respuesta. Entre la comprobación del
 * techo y ese momento hay una ventana, y con cien requests simultáneos los
 * cien pasan la comprobación y los cien gastan: el techo se supera por
 * concurrencia sin que ninguno haya hecho nada mal.
 *
 * Acá el techo viaja DENTRO del filtro del findOneAndUpdate, igual que el tope
 * de cuota por comercio. Si no entra, no matchea, y no se reserva nada. No hay
 * ventana porque no hay dos pasos.
 *
 * La condición suma las tres cosas: lo ya gastado, lo ya comprometido por
 * otras operaciones en vuelo, y lo que esta pide.
 *
 * @returns {Promise<number>} cuánto se comprometió; 0 si no hacía falta
 *   reservar, null si no entró en el techo.
 */
const reservePlatformCost = async ({ period, estimate, usdBudget }) => {
  if (usdBudget === UNLIMITED || !(estimate > 0)) return 0

  await AiPlatformUsage.updateOne(
    { period },
    { $setOnInsert: { period } },
    { upsert: true },
  ).catch(() => null)

  const updated = await AiPlatformUsage.findOneAndUpdate(
    {
      period,
      $expr: {
        $lte: [
          {
            $add: [
              { $ifNull: ['$estimatedCostUsd', 0] },
              { $ifNull: ['$reservedCostUsd', 0] },
              estimate,
            ],
          },
          usdBudget,
        ],
      },
    },
    { $inc: { reservedCostUsd: estimate } },
    { new: true },
  ).lean()

  return updated ? estimate : null
}

/**
 * Libera plata comprometida: al liquidarla contra el costo real, al devolver
 * una operación, o al barrer una que quedó colgada.
 *
 * Nunca deja el contador en negativo: el $max con cero lo impide aunque una
 * liberación llegue dos veces, que es exactamente lo que pasaría si un refund
 * y el barrido se cruzaran sobre la misma operación.
 */
const releasePlatformCost = async ({ period, amount }) => {
  if (!(amount > 0)) return

  await AiPlatformUsage.updateOne({ period }, [
    {
      $set: {
        reservedCostUsd: {
          $max: [0, { $subtract: [{ $ifNull: ['$reservedCostUsd', 0] }, amount] }],
        },
      },
    },
  ]).catch(error => {
    logger.warn('[AI BUDGET] No se pudo liberar la reserva financiera', {
      period,
      amount,
      error: error.message,
    })
  })
}

/**
 * Cuál de los dos techos se pasó, si alguno.
 *
 * DOS CONTROLES, NO UNO CON DOS NOMBRES
 *
 *   tokens → volumen. No depende de ningún precio, así que es la red cuando el
 *            catálogo de tarifas está viejo o el modelo no figura en él.
 *   usd    → plata. Es lo que HENKO paga de verdad, y el único que sube cuando
 *            la cadena de respaldo entrega un modelo cinco veces más caro sin
 *            que se mueva un solo token de más.
 *
 * Corta el primero que se pase. No es "uno duro y otro blando": los dos paran
 * la IA, porque pasarse de cualquiera de los dos es un problema —uno de plata
 * y otro de volumen— y ninguno se arregla dejando correr al otro.
 *
 * Con AI_PLATFORM_MONTHLY_USD_BUDGET sin configurar, el techo en dólares es
 * UNLIMITED y esto se comporta exactamente como antes.
 *
 * @returns {Promise<{exhausted: boolean, reason: 'tokens'|'usd'|null}>}
 */
const evaluatePlatformBudget = async () => {
  const tokenBudget = getPlatformMonthlyTokenBudget()
  const usdBudget = getPlatformMonthlyUsdBudget()

  if (tokenBudget === UNLIMITED && usdBudget === UNLIMITED) {
    return { exhausted: false, reason: null }
  }

  // El período va en la clave: si no, un disyuntor que cortó el día 31 sigue
  // cortando hasta 30 segundos después del cambio de mes, cuando el contador
  // real ya arrancó de cero.
  const period = getCurrentPeriod()
  const cacheKey = `${BREAKER_CACHE_KEY}:${period}`

  const cached = await cacheGet(cacheKey)
  if (cached !== null && cached !== undefined) {
    return { exhausted: Boolean(cached.exhausted), reason: cached.reason ?? null }
  }

  const usage = await AiPlatformUsage.findOne({ period }).lean()

  const tokens = Number(usage?.tokens || 0)
  // Gastado MÁS comprometido. Mirar solo lo gastado dejaría entrar a cien
  // requests simultáneos: ninguno habría liquidado todavía.
  const costUsd =
    Number(usage?.estimatedCostUsd || 0) + Number(usage?.reservedCostUsd || 0)

  // La plata se evalúa primero: entre dos techos pasados, el que hay que
  // contarle al dueño de la plataforma es el que le cuesta dinero.
  const reason =
    usdBudget !== UNLIMITED && costUsd >= usdBudget
      ? 'usd'
      : tokenBudget !== UNLIMITED && tokens >= tokenBudget
        ? 'tokens'
        : null

  const resultado = { exhausted: reason !== null, reason }

  await cacheSet(cacheKey, resultado, BREAKER_CACHE_TTL_SEC)

  return resultado
}

/**
 * Escalones de aviso, en porcentaje del presupuesto del mes.
 *
 * El disyuntor avisaba recién al cortar, que es cuando el asistente ya dejó de
 * contestar para TODOS los comercios que comparten la key. El primer síntoma
 * era un cliente escribiendo. Estos avisos existen para que haya margen de
 * reacción: mover el techo o apagar una función cuesta minutos, enterarse
 * tarde cuesta una caída.
 *
 * Dos escalones y no cinco: cada uno tiene que significar algo. El 50% a mitad
 * de mes es normal; el 50% el día 8 no lo es, y esa lectura la hace quien lo
 * recibe con la fecha delante.
 */
const ALERT_THRESHOLDS = Object.freeze([50, 80])

/**
 * Avisa una sola vez por escalón y por mes.
 *
 * No lanza nunca: es un aviso sobre un consumo que ya se registró, así que su
 * fallo no puede voltear la operación que lo disparó.
 */
const announceBudgetPressure = async ({ period, usage, budget, usdBudget = UNLIMITED }) => {
  try {
    const tokens = Number(usage?.tokens || 0)
    const costUsd = Number(usage?.estimatedCostUsd || 0)

    // El aviso sale por el techo MÁS CERCA de cortar, no por el de tokens.
    //
    // Con los dos controles puestos, avisar siempre por tokens dejaría el caso
    // que este bloque vino a resolver: la cadena de respaldo entrega un modelo
    // cinco veces más caro, el gasto va por el 90% y los tokens por el 30%, y
    // el aviso diría "todo bien" hasta que corte.
    const porcentajes = [
      budget !== UNLIMITED && budget > 0
        ? { control: 'tokens', percent: (tokens / budget) * 100 }
        : null,
      usdBudget !== UNLIMITED && usdBudget > 0
        ? { control: 'usd', percent: (costUsd / usdBudget) * 100 }
        : null,
    ].filter(Boolean)

    if (porcentajes.length === 0) return

    const apremiante = porcentajes.reduce((a, b) => (b.percent > a.percent ? b : a))
    const percent = apremiante.percent

    // El escalón más alto alcanzado. Si un consumo grande cruza los dos de una,
    // se anuncia el 80 y no se emite después un 50 que ya quedó viejo.
    const reached = ALERT_THRESHOLDS.filter(threshold => percent >= threshold).pop()

    if (!reached) return
    // Salida barata: la enorme mayoría de los requests del mes muere acá, sin
    // tocar la base.
    if (Number(usage?.alertedThreshold || 0) >= reached) return

    // Solo un proceso gana. La condición va en el filtro, no en un chequeo
    // previo: con varias instancias corriendo, leer-y-después-escribir emite el
    // mismo aviso una vez por instancia.
    const claimed = await AiPlatformUsage.findOneAndUpdate(
      {
        period,
        $or: [
          { alertedThreshold: { $exists: false } },
          { alertedThreshold: { $lt: reached } },
        ],
      },
      { $set: { alertedThreshold: reached } },
      { new: true },
    ).lean()

    if (!claimed) return

    // Con el desglose el aviso ya trae la respuesta en vez de abrir una
    // investigación. Si la consulta falla, se avisa igual: el número solo vale
    // más que ningún aviso.
    const byMetric = await getPeriodSpendByMetric(period).catch(() => [])

    const level = reached >= EMAIL_THRESHOLD ? 'error' : 'warn'
    const topSpend = byMetric.slice(0, 3)

    logger[level](`[AI BUDGET] Presupuesto de plataforma al ${reached}%`, {
      period,
      // Cuál de los dos techos es el que está al ${reached}%. Sin esto, un
      // aviso por gasto se lee como un aviso por volumen y manda a buscar el
      // problema donde no está.
      control: apremiante.control,
      percent: percent.toFixed(1),
      tokens,
      budget: budget === UNLIMITED ? null : budget,
      usdBudget: usdBudget === UNLIMITED ? null : usdBudget,
      estimatedCostUsd: costUsd.toFixed(2),
      topSpend,
    })

    // El log alcanza para el escalón informativo. Desde el 80% el aviso tiene
    // que salir a buscar a alguien, porque a partir de ahí hay que decidir algo.
    if (reached >= EMAIL_THRESHOLD) {
      await notifyBudgetPressure({
        period,
        control: apremiante.control,
        percent: percent.toFixed(1),
        tokens,
        budget,
        usdBudget,
        estimatedCostUsd: costUsd,
        topSpend,
      })
    }
  } catch (error) {
    logger.warn('[AI BUDGET] No se pudo emitir el aviso de presupuesto', {
      period,
      error: error.message,
    })
  }
}

const registerPlatformConsumption = async ({
  tokens,
  costUsd,
  period: requestedPeriod = null,
}) => {
  const period = requestedPeriod || getCurrentPeriod()
  const budget = getPlatformMonthlyTokenBudget()
  const usdBudget = getPlatformMonthlyUsdBudget()
  const normalizedTokens = Math.max(0, Math.round(Number(tokens) || 0))
  // El costo admite negativo y los tokens no. Un refund de un gasto cobrado por
  // adelantado tiene que poder revertir la plata; los tokens, en cambio, ya se
  // consumieron contra Google pase lo que pase y el disyuntor se mide con ellos,
  // así que devolverlos volvería el techo mentiroso.
  const normalizedCost = Number(costUsd) || 0

  const updated = await AiPlatformUsage.findOneAndUpdate(
    { period },
    {
      $inc: {
        tokens: normalizedTokens,
        estimatedCostUsd: normalizedCost,
      },
      $set: { lastActivityAt: new Date() },
      $setOnInsert: { period },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()

  if (budget === UNLIMITED && usdBudget === UNLIMITED) return updated

  await announceBudgetPressure({ period, usage: updated, budget, usdBudget })

  // Cuál de los dos se pasó. La plata primero: entre dos techos superados, el
  // que hay que contar es el que cuesta dinero.
  const breakerReason =
    usdBudget !== UNLIMITED && Number(updated.estimatedCostUsd || 0) >= usdBudget
      ? 'usd'
      : budget !== UNLIMITED && updated.tokens >= budget
        ? 'tokens'
        : null

  // Solo una instancia puede reclamar el disparo. Se tolera tanto null como
  // campo ausente porque convivimos con documentos creados por versiones viejas.
  if (breakerReason && !updated.breakerTrippedAt) {
    const claimed = await AiPlatformUsage.findOneAndUpdate(
      {
        period,
        $or: [
          { breakerTrippedAt: null },
          { breakerTrippedAt: { $exists: false } },
        ],
      },
      { $set: { breakerTrippedAt: new Date(), breakerReason } },
      { new: true },
    ).lean()

    if (claimed) {
      logger.error('[AI BUDGET] Disyuntor de plataforma activado', {
        period,
        // Por cuál cortó. "El disyuntor cortó" a secas no dice si hay que
        // decidir gastar más o buscar qué está consumiendo de más.
        reason: breakerReason,
        tokens: claimed.tokens,
        budget,
        usdBudget: usdBudget === UNLIMITED ? null : usdBudget,
        estimatedCostUsd: Number(claimed.estimatedCostUsd || 0).toFixed(2),
      })

      const topSpend = await getPeriodSpendByMetric(period).catch(() => [])

      await notifyBudgetPressure({
        period,
        percent: '100',
        tokens: claimed.tokens,
        budget,
        estimatedCostUsd: Number(claimed.estimatedCostUsd || 0),
        topSpend: topSpend.slice(0, 3),
        tripped: true,
      }).catch(() => undefined)
    }
  }

  if (updated.tokens >= budget) await cacheDel(`${BREAKER_CACHE_KEY}:${period}`)

  return updated
}

// ─── Reserva y cuota ──────────────────────────────────────

const normalizeAmount = (value, fallback = 1) => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback
  return Math.max(1, Math.floor(numeric))
}


/**
 * Inicializa el documento del período sin intentar reservar en el mismo upsert.
 * Separar "crear documento" de "incrementar contador" evita que un filtro de
 * cuota que no matchee termine en un upsert que cree un documento sin respetar
 * el límite.
 */
const ensureUsageDocument = async ({ tenantId, period }) => {
  await AiUsage.updateOne(
    { tenantId, period },
    {
      $setOnInsert: {
        tenantId,
        period,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

/**
 * Migra contadores creados por versiones anteriores del servicio.
 *
 * La visión históricamente usaba `analysisCount`. Para las demás métricas un
 * contador ausente significa cero. La inicialización es atómica mediante un
 * update pipeline y solo afecta el campo cuando todavía no existe.
 */
const ensureCounter = async ({ tenantId, period, metric }) => {
  const path = counterPath(metric)
  const valueExpression = metric === AI_METRICS.VISION
    ? { $ifNull: ['$analysisCount', 0] }
    : 0

  await AiUsage.updateOne(
    {
      tenantId,
      period,
      [path]: { $exists: false },
    },
    [
      {
        $set: {
          [path]: valueExpression,
        },
      },
    ],
  ).setOptions({ tenantId })
}

const buildQuotaExpression = ({ metric, limit, amount }) => {
  if (limit === UNLIMITED) return null

  const path = `$${counterPath(metric)}`
  return {
    $lte: [
      {
        $add: [
          { $ifNull: [path, 0] },
          amount,
        ],
      },
      limit,
    ],
  }
}

const buildGuardExpression = ({ metric, limit }) => {
  if (limit === UNLIMITED) return null

  return {
    $lt: [
      { $ifNull: [`$${counterPath(metric)}`, 0] },
      limit,
    ],
  }
}

const buildAtomicReservationFilter = ({ tenantId, period, metric, limit, amount, guardLimits }) => {
  const expressions = []
  const quotaExpression = buildQuotaExpression({ metric, limit, amount })
  if (quotaExpression) expressions.push(quotaExpression)

  for (const guard of guardLimits) {
    const expression = buildGuardExpression(guard)
    if (expression) expressions.push(expression)
  }

  return {
    tenantId,
    period,
    ...(expressions.length > 0 ? { $expr: { $and: expressions } } : {}),
  }
}

/**
 * Reserva de forma estrictamente atómica.
 *
 * IMPORTANTE: no usa `upsert:true` con el filtro de cuota. Primero garantiza la
 * existencia del documento y después ejecuta un findOneAndUpdate sin upsert.
 * Así, cuando `used + amount > limit`, la operación simplemente no matchea y
 * jamás crea un documento saltándose el límite.
 */
const applyReservation = async ({
  tenantId,
  period,
  metric,
  amount,
  limit,
  guardLimits,
  costUsd = 0,
}) => {
  const increment = {
    [counterPath(metric)]: amount,
    ...(metric === AI_METRICS.VISION ? { analysisCount: amount } : {}),
    // La plata entra en el MISMO $inc que la cuota. Es la única forma de que
    // no se separen: un solo documento, un solo operador, atómico por
    // definición en Mongo. Cuando eran dos escrituras, el contador decía 3 y
    // el dinero decía 2 y nada permitía saber cuál de las tres faltaba.
    ...(costUsd > 0 ? { estimatedCostUsd: costUsd } : {}),
  }

  await ensureUsageDocument({ tenantId, period })
  await ensureCounter({ tenantId, period, metric })

  return AiUsage.findOneAndUpdate(
    buildAtomicReservationFilter({
      tenantId,
      period,
      metric,
      limit,
      amount,
      guardLimits,
    }),
    {
      $inc: increment,
      $set: {
        lastActivityAt: new Date(),
        ...(metric === AI_METRICS.VISION ? { lastAnalysisAt: new Date() } : {}),
      },
    },
    { new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

/**
 * Autolímite del comercio. Solo puede APRETAR el tope del plan, nunca
 * aflojarlo: si se aceptara un valor más alto, cualquier admin de tenant se
 * subiría la cuota desde su propio panel.
 */
const resolveEffectiveLimit = ({ plan, metric, keySource }) => {
  const planLimit = getPlanLimit(plan, metric)

  if (keySource !== KEY_SOURCE.PLATFORM) return planLimit
  if (planLimit !== UNLIMITED) return planLimit

  return getSharedKeyTenantCap(metric)
}

/**
 * Costo que se puede cobrar POR ADELANTADO, en el mismo movimiento que reserva
 * la cuota.
 *
 * La condición es una sola: que el precio sea una tarifa plana por unidad,
 * conocida antes de hacer el trabajo. Las ediciones de imagen la cumplen —
 * Replicate cobra por imagen, no por token, y el número sale de
 * AI_COST_USD_PER_IMAGE_EDIT. Las métricas de tokens NO la cumplen: su costo se
 * mide después, con el usageMetadata que devuelve Google, y cobrarlas por
 * adelantado sería inventar el número.
 *
 * Todo lo que devuelve algo mayor a cero acá queda contabilizado de forma
 * atómica con su cuota, y se revierte igual de atómicamente en el refund.
 */
const getUpfrontCostUsd = (metric, amount) =>
  metric === AI_METRICS.IMAGE_EDITS ? estimateImageCostUsd(amount) : 0

const applyLimitOverride = (planLimit, override) => {
  const value = Number(override)
  if (!Number.isFinite(value) || value <= 0) return planLimit
  if (planLimit === UNLIMITED) return Math.floor(value)
  return Math.min(planLimit, Math.floor(value))
}

/**
 * Autolímites que el comercio configuró en su propio panel, en la forma que
 * espera applyLimitOverride (número o null).
 *
 * Solo lo usa el SNAPSHOT. El cobro no lee de acá a propósito: el cerebro del
 * agente ya tiene el documento en la mano cuando reserva, y agregarle una
 * consulta más a cada mensaje para releer lo mismo sería pagar dos veces por
 * el mismo dato.
 *
 * Un error acá no se traga: si la base no responde, el snapshot entero falla
 * igual por la lectura de AiUsage, y devolver los topes del plan como si nada
 * recrearía en silencio la misma mentira que esto vino a arreglar.
 */
const loadAgentSelfLimits = async tenantId => {
  const agent = await AiAgent.findOne({ tenantId })
    .select('quotas.monthlyMessageLimit quotas.monthlyAiTokenLimit')
    .setOptions({ tenantId })
    .lean()

  return {
    [AI_METRICS.AGENT_MESSAGES]: agent?.quotas?.monthlyMessageLimit || null,
    [AI_METRICS.AGENT_TOKENS]: agent?.quotas?.monthlyAiTokenLimit || null,
  }
}

const buildAllowedResult = ({
  metric,
  limit,
  used,
  profile,
  reason = 'ok',
  byok = false,
  operationId = null,
}) => ({
  allowed: true,
  metric,
  limit,
  used,
  remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
  unlimited: limit === UNLIMITED,
  byok,
  reason,
  keySource: profile.keySource,
  plan: profile.plan,
  label: AI_METRIC_LABELS[metric],
  // Se devuelve para que quien reservó pase la MISMA clave al registrar el
  // consumo o al devolver la reserva. Sin esto cada paso generaría la suya y
  // las tres filas quedarían sin relación entre sí.
  operationId,
})

/**
 * Reserva consumo para un tenant.
 *
 * Los nombres y el contrato de la función pública se conservan. Se agregan
 * solo parámetros opcionales (`period`) para poder corregir refunds de
 * operaciones que crucen el cambio de mes sin romper callers existentes.
 *
 * @param guards         Métricas que deben seguir por debajo del límite.
 * @param limitOverride  Autolímite del comercio, siempre hacia abajo.
 * @param period         Período explícito para operaciones controladas. Si no
 *                       viene, se usa el período actual como antes.
 */
export const reserveAiBudget = async ({
  tenantId,
  metric,
  amount = 1,
  guards = [],
  profile = null,
  limitOverride = null,
  // Autolímites del comercio para las métricas de GUARDA, por métrica. Mismo
  // criterio que limitOverride: solo pueden apretar.
  guardOverrides = null,
  period: requestedPeriod = null,
  // Clave de idempotencia de la operación. La provee quien llama cuando puede
  // derivar una estable —el id de un job, el hash de una imagen— y si no, se
  // genera acá y se devuelve en el resultado para que los pasos siguientes
  // usen la misma.
  operationId: requestedOperationId = null,
  // Trazabilidad de la operación. Los tres son opcionales: ningún llamador
  // existente tiene que cambiar para que esto funcione, y el que los manda
  // gana poder responder "¿qué función me está costando la plata?" y "¿cuántas
  // veces el fallback decidió el modelo que pagué?".
  feature = null,
  provider = null,
  requestedModel = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)
  const operationId = clean(requestedOperationId) || randomUUID()
  const reservationAmount = normalizeAmount(amount)

  if (!normalizedMetric) throw new Error(`Métrica de IA desconocida: ${metric}`)
  if (!id) throw new Error('reserveAiBudget requiere tenantId')

  const aiProfile = profile || (await loadTenantAiProfile(id))
  const subscription = getSubscriptionState(aiProfile)
  const limit = applyLimitOverride(
    resolveEffectiveLimit({
      plan: aiProfile.plan,
      metric: normalizedMetric,
      keySource: aiProfile.keySource,
    }),
    limitOverride,
  )

  if (!subscription.entitled) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.SUBSCRIPTION,
      detail: subscription.reason,
      profile: aiProfile,
    })
  }

  if (aiProfile.keySource === KEY_SOURCE.NONE) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.NO_API_KEY,
      profile: aiProfile,
    })
  }

  // BYOK no consume presupuesto de infraestructura de HENKO. Conservamos el
  // registro de uso porque el panel necesita visibilidad del consumo del tenant.
  if (aiProfile.keySource === KEY_SOURCE.TENANT) {
    await recordAiConsumption({
      tenantId: id,
      metric: normalizedMetric,
      amount: reservationAmount,
      profile: aiProfile,
      period: requestedPeriod || undefined,
    })

    return buildAllowedResult({
      metric: normalizedMetric,
      limit: UNLIMITED,
      used: 0,
      profile: aiProfile,
      reason: 'byok',
      byok: true,
      operationId,
    })
  }

  const platformBudget = await evaluatePlatformBudget()

  if (platformBudget.exhausted) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.PLATFORM_BUDGET,
      // Cuál de los dos techos cortó. Lo consume el panel de plataforma: la
      // acción es distinta según cuál sea.
      detail: platformBudget.reason,
      profile: aiProfile,
    })
  }

  const period = requestedPeriod || getCurrentPeriod()
  const uniqueGuardMetrics = [...new Set((guards || []).map(normalizeMetric).filter(Boolean))]
  const guardLimits = uniqueGuardMetrics
    .filter(guardMetric => guardMetric !== normalizedMetric)
    .map(guardMetric => ({
      metric: guardMetric,
      // El autolímite del comercio también aprieta las métricas de guarda, no
      // solo la que se reserva. Sin esto, el tope de tokens que el comercio
      // configura en su panel se guardaba y no lo leía nadie: un control que
      // se puede tocar y no hace nada es peor que no ofrecerlo, porque el
      // comercio cree que puso un freno.
      //
      // applyLimitOverride solo permite APRETAR, igual que en la métrica
      // principal: nadie se amplía la cuota desde su propio panel.
      limit: applyLimitOverride(
        resolveEffectiveLimit({
          plan: aiProfile.plan,
          metric: guardMetric,
          keySource: aiProfile.keySource,
        }),
        guardOverrides?.[guardMetric] ?? null,
      ),
    }))
    .filter(guard => guard.limit !== UNLIMITED)

  const upfrontCostUsd = getUpfrontCostUsd(normalizedMetric, reservationAmount)

  // LA RESERVA FINANCIERA, antes que nada.
  //
  // Va primero porque es el único techo compartido por TODOS los comercios:
  // si no entra, no hay nada más que decidir. Y va como reserva y no como
  // comprobación porque el costo real recién se conoce después de la
  // respuesta — comprobar y después gastar deja pasar a cien requests
  // simultáneos.
  //
  // Lo que se compromete es un estimado ALTO. La diferencia contra el costo
  // real se libera apenas se sabe, en claimConsumption.
  //
  // Una edición de imagen no se estima: su tarifa es plana y ya se conoce acá,
  // así que se compromete el número exacto.
  const usdBudget = getPlatformMonthlyUsdBudget()
  const estimateUsd =
    upfrontCostUsd > 0 ? upfrontCostUsd : getEstimatedCostUsd(normalizedMetric)

  const reservedUsd = await reservePlatformCost({
    period,
    estimate: estimateUsd,
    usdBudget,
  })

  if (reservedUsd === null) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.PLATFORM_BUDGET,
      detail: 'usd',
      profile: aiProfile,
    })
  }

  // EL CANDADO. Antes de este punto no se tocó ningún contador; después de
  // este punto, el `$inc` solo corre si la operación es nueva.
  const { fresh, operation } = await openOperation({
    tenantId: id,
    operationId,
    period,
    metric: normalizedMetric,
    amount: reservationAmount,
    feature,
    provider,
    requestedModel,
    reservedCostUsd: reservedUsd,
  })

  // Reintento: este cobro ya ocurrió. Se devuelve permitido —porque la reserva
  // original SÍ se hizo y el llamador tiene derecho a seguir— pero sin sumar
  // nada. Devolver denegado sería peor: haría fallar un reintento legítimo de
  // algo que ya estaba pago.
  if (!fresh) {
    // No se cobra, así que no se compromete: lo reservado hace tres líneas se
    // devuelve o quedaría retenido hasta fin de mes por un reintento.
    await releasePlatformCost({ period, amount: reservedUsd })

    const usage = await AiUsage.findOne({ tenantId: id, period })
      .setOptions({ tenantId: id })
      .lean()
      .catch(() => null)

    return buildAllowedResult({
      metric: normalizedMetric,
      limit,
      used: readCounter(usage, normalizedMetric),
      profile: aiProfile,
      reason: 'replay',
      operationId,
    })
  }

  const updated = await applyReservation({
    tenantId: id,
    period,
    metric: normalizedMetric,
    amount: reservationAmount,
    limit,
    guardLimits,
    costUsd: upfrontCostUsd,
  })

  if (!updated) {
    // La cuota del comercio no alcanzó: la plata comprometida vuelve. Sin
    // esto, un comercio sin cupo le comería el techo a la plataforma con cada
    // intento fallido.
    await releasePlatformCost({ period, amount: reservedUsd })

    const usage = await AiUsage.findOne({ tenantId: id, period })
      .setOptions({ tenantId: id })
      .lean()

    const exhaustedGuard = guardLimits.find(
      guard => readCounter(usage, guard.metric) >= guard.limit,
    )

    if (exhaustedGuard) {
      closeOperation({
        tenantId: id,
        operationId,
        status: AI_OPERATION_STATUS.FAILED,
        failureReason: `${DENY_REASONS.GUARD_LIMIT}:${exhaustedGuard.metric}`,
      })

      return buildDeniedResult({
        metric: exhaustedGuard.metric,
        limit: exhaustedGuard.limit,
        used: readCounter(usage, exhaustedGuard.metric),
        reason: DENY_REASONS.GUARD_LIMIT,
        detail: exhaustedGuard.metric,
        profile: aiProfile,
      })
    }

    const used = readCounter(usage, normalizedMetric)
    if (limit !== UNLIMITED && used + reservationAmount > limit) {
      closeOperation({
        tenantId: id,
        operationId,
        status: AI_OPERATION_STATUS.FAILED,
        failureReason: DENY_REASONS.METRIC_LIMIT,
      })

      return buildDeniedResult({
        metric: normalizedMetric,
        limit,
        used,
        reason: DENY_REASONS.METRIC_LIMIT,
        profile: aiProfile,
      })
    }

    // El rechazo no debería llegar acá salvo que otra condición cambie entre
    // lecturas o que Mongo/Mongoose rechace la expresión de forma transitoria.
    // No reintentamos sin condición porque eso podría convertir un error de
    // concurrencia en una sobrerreserva.
    closeOperation({
      tenantId: id,
      operationId,
      status: AI_OPERATION_STATUS.FAILED,
      failureReason: 'AI_RESERVATION_NOT_CONFIRMED',
    })

    const error = new Error('No se pudo confirmar la reserva atómica de IA')
    error.code = 'AI_RESERVATION_NOT_CONFIRMED'
    error.details = {
      tenantId: id,
      period,
      metric: normalizedMetric,
      amount: reservationAmount,
    }
    throw error
  }

  const used = readCounter(updated, normalizedMetric)

  if (upfrontCostUsd > 0) {
    await registerPlatformConsumption({
      tokens: 0,
      costUsd: upfrontCostUsd,
      period,
    }).catch(error => {
      logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma (adelantado)', {
        tenantId: id,
        metric: normalizedMetric,
        period,
        error: error.message,
      })
    })
  }

  writeLedgerEntry({
    tenantId: id,
    period,
    // Cuando el costo se cobra por adelantado, reservar Y gastar son el mismo
    // acto: no hay una medición posterior que pueda cambiar el número. Marcarlo
    // 'reserved' dejaría el gasto de imágenes fuera del reporte, que suma
    // 'consumed'; y dejaría abierta la pregunta "¿esta reserva llegó a
    // consumirse?" para un caso donde no puede no haberse consumido.
    event: upfrontCostUsd > 0 ? LEDGER_EVENT.CONSUMED : LEDGER_EVENT.RESERVED,
    operationId,
    metric: normalizedMetric,
    amount: reservationAmount,
    unit: TOKEN_METRICS.has(normalizedMetric) ? 'tokens' : 'units',
    keySource: aiProfile.keySource,
    plan: aiProfile.plan,
    costUsd: upfrontCostUsd,
    // `model` queda nulo: esto no lo cobra Google por token sino Replicate o
    // Stability por imagen, así que no hay tarifa del catálogo que congelar. Y
    // va marcado como estimado porque el costo por imagen es un supuesto
    // configurable (AI_COST_USD_PER_IMAGE_EDIT), no una factura.
    ...(upfrontCostUsd > 0 ? { breakdown: { estimated: true } } : {}),
  })

  // Cuando el costo se cobra por adelantado no hay medición posterior que
  // pueda cerrarla: reservar y consumir fueron el mismo acto, igual que en el
  // ledger, que ya la marca 'consumed' en este caso.
  if (upfrontCostUsd > 0) {
    closeOperation({
      tenantId: id,
      operationId,
      status: AI_OPERATION_STATUS.COMPLETED,
    })
  }

  return buildAllowedResult({
    metric: normalizedMetric,
    limit,
    used,
    profile: aiProfile,
    operationId,
  })
}

/**
 * Devuelve una reserva cuando el proveedor falló. El período ahora puede ser
 * enviado por el caller; sin él se conserva el comportamiento histórico.
 */
export const refundAiBudget = async ({
  tenantId,
  metric,
  amount = 1,
  period: requestedPeriod = null,
  // La MISMA clave que devolvió reserveAiBudget. Sin ella la devolución queda
  // sin relación con lo que devuelve, y un reintento del refund descuenta dos
  // veces.
  operationId = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)
  const refundAmount = normalizeAmount(amount)

  if (!normalizedMetric || !id) return

  const period = requestedPeriod || getCurrentPeriod()

  // SE RECLAMA LA DEVOLUCIÓN, NO SE CONSULTA.
  //
  // La primera versión de esta guarda leía el estado y después decidía. Eso es
  // exactamente la carrera que todo este trabajo viene cerrando, un nivel más
  // arriba: dos refunds concurrentes leen 'running' los dos, los dos deciden
  // que hay algo que devolver, y los dos descuentan.
  //
  // Acá la transición a 'refunded' ES el reclamo: va en una sola operación con
  // el estado dentro del filtro, así que solo uno de los dos la gana. El que
  // pierde no encuentra nada y se va sin tocar ningún agregado.
  //
  // El filtro exige HOLDS_QUOTA y no "distinto de refunded": devolver cupo de
  // una operación que nunca lo reservó —una que se denegó por falta de plan,
  // por ejemplo— le regalaría cuota al comercio.
  if (operationId) {
    const reclamada = await AiOperation.findOneAndUpdate(
      { tenantId: id, operationId, status: { $in: HOLDS_QUOTA } },
      {
        $set: {
          status: AI_OPERATION_STATUS.REFUNDED,
          failedAt: new Date(),
        },
      },
      { new: true },
    )
      .setOptions({ tenantId: id })
      .lean()
      .catch(error => {
        // Falla abierta, igual que el resto: la contabilidad no puede ser el
        // motivo por el que a un comercio no se le devuelve su cupo.
        logger.error('[AI OPERATION] No se pudo reclamar la devolución', {
          tenantId: String(id),
          operationId,
          error: error.message,
        })
        return null
      })

    if (reclamada) {
      // La operación se devolvió: la plata comprometida vuelve con ella.
      await liquidarReserva({ tenantId: id, operationId, period })
    }

    if (!reclamada) {
      const operacion = await AiOperation.findOne({ tenantId: id, operationId })
        .setOptions({ tenantId: id })
        .lean()
        .catch(() => null)

      // Si existe, alguien ya la devolvió o nunca retuvo cupo: en los dos
      // casos no hay nada que descontar. Si NO existe, el llamador está
      // devolviendo algo que este servicio no reservó, y ahí se deja pasar
      // para no cambiarle el comportamiento a quien todavía no usa claves.
      if (operacion) {
        logger.info('[AI OPERATION] Devolución sin cupo que devolver, descartada', {
          tenantId: String(id),
          operationId,
          metric: normalizedMetric,
          status: operacion.status,
        })
        return
      }
    }
  }

  // Lo que se cobró por adelantado se devuelve por adelantado, en el mismo
  // movimiento. La simetría no es estética: es lo que garantiza que cuota y
  // dinero no puedan quedar desalineados en ninguna rama.
  const upfrontCostUsd = getUpfrontCostUsd(normalizedMetric, refundAmount)

  try {
    const refunded = await AiUsage.findOneAndUpdate(
      {
        tenantId: id,
        period,
        $expr: {
          $gte: [
            { $ifNull: [`$${counterPath(normalizedMetric)}`, 0] },
            refundAmount,
          ],
        },
      },
      {
        $inc: {
          [counterPath(normalizedMetric)]: -refundAmount,
          ...(normalizedMetric === AI_METRICS.VISION
            ? { analysisCount: -refundAmount }
            : {}),
          ...(upfrontCostUsd > 0 ? { estimatedCostUsd: -upfrontCostUsd } : {}),
        },
        $set: { lastActivityAt: new Date() },
      },
      { new: true },
    ).setOptions({ tenantId: id })

    if (refunded) {
      if (upfrontCostUsd > 0) {
        await registerPlatformConsumption({
          tokens: 0,
          costUsd: -upfrontCostUsd,
          period,
        }).catch(platformError => {
          logger.warn('[AI BUDGET] No se pudo revertir consumo de plataforma', {
            tenantId: id,
            metric: normalizedMetric,
            period,
            error: platformError.message,
          })
        })
      }

      // No se cierra acá: el estado ya quedó en 'refunded' cuando se ganó el
      // reclamo, arriba. Volver a escribirlo sería una escritura de más y,
      // peor, sugeriría que el estado depende de que esta rama se alcance.
      writeLedgerEntry({
        tenantId: id,
        period,
        event: LEDGER_EVENT.REFUNDED,
        operationId,
        metric: normalizedMetric,
        amount: refundAmount,
        unit: TOKEN_METRICS.has(normalizedMetric) ? 'tokens' : 'units',
        // El reporte resta los refunds, así que esta fila tiene que llevar lo
        // mismo que llevó la de consumo o el gasto quedaría inflado.
        costUsd: upfrontCostUsd,
      })
    }
  } catch (error) {
    logger.warn('[AI BUDGET] No se pudo devolver la reserva', {
      tenantId: id,
      metric: normalizedMetric,
      period,
      error: error.message,
    })
  }
}

/**
 * Registra consumo ya ocurrido (tokens, o consumo de un tenant BYOK).
 *
 * `period` es opcional y mantiene compatibilidad con callers actuales. Cuando
 * el caller conoce el período de la operación, debe enviarlo para que la
 * contabilización no cruce de mes.
 */
export const recordAiConsumption = async ({
  tenantId,
  metric,
  amount = 0,
  profile = null,
  model = null,
  inputTokens = null,
  outputTokens = null,
  period: requestedPeriod = null,
  // La misma clave que devolvió reserveAiBudget. El evento distingue la fila,
  // así que reserva y consumo de una operación conviven; dos consumos de la
  // misma operación son un reintento y el índice los descarta.
  operationId = null,
  callId = CALL_ID.MAIN,
  provider = null,
  requestedModel = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)
  const value = Number(amount)

  if (!normalizedMetric || !id) return
  if (!Number.isFinite(value) || value <= 0) return

  const normalizedAmount = normalizeAmount(value)
  const aiProfile = profile || (await loadTenantAiProfile(id))
  const isByok = aiProfile.keySource === KEY_SOURCE.TENANT
  const isTokenMetric = TOKEN_METRICS.has(normalizedMetric)
  const usedModel = normalizeModelName(model || getDefaultPricingModel())

  const breakdown = isTokenMetric && !isByok
    ? computeCostUsd({ model: usedModel, inputTokens, outputTokens, totalTokens: normalizedAmount })
    : null

  const costUsd = breakdown?.costUsd || 0
  const period = requestedPeriod || getCurrentPeriod()

  // Mismo candado que en recordTokenSpend: acá también se incrementan
  // contadores del comercio y de la plataforma.
  const nuevo = await claimConsumption({
    tenantId: id,
    operationId,
    callId,
    period,
    metric: normalizedMetric,
    amount: normalizedAmount,
    provider,
    requestedModel,
    actualModel: isTokenMetric ? usedModel : null,
    breakdown,
    costUsd,
  })

  if (!nuevo) return

  try {
    await ensureUsageDocument({ tenantId: id, period })
    await AiUsage.updateOne(
      { tenantId: id, period },
      {
        $inc: {
          [counterPath(normalizedMetric)]: normalizedAmount,
          ...(isTokenMetric && isByok ? { byokTokens: normalizedAmount } : {}),
          ...(costUsd > 0 ? { estimatedCostUsd: costUsd } : {}),
        },
        $set: { lastActivityAt: new Date() },
      },
    ).setOptions({ tenantId: id })
  } catch (error) {
    logger.warn('[AI BUDGET] No se pudo registrar consumo', {
      tenantId: id,
      metric: normalizedMetric,
      period,
      error: error.message,
    })
  }

  if (isTokenMetric && !isByok) {
    await registerPlatformConsumption({ tokens: normalizedAmount, costUsd, period }).catch(error => {
      logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma', {
        tenantId: id,
        metric: normalizedMetric,
        period,
        error: error.message,
      })
    })
  }

  writeLedgerEntry({
    tenantId: id,
    period,
    event: LEDGER_EVENT.CONSUMED,
    operationId: ledgerKey(operationId, callId),
    metric: normalizedMetric,
    amount: normalizedAmount,
    model: isTokenMetric ? usedModel : null,
    keySource: aiProfile.keySource,
    plan: aiProfile.plan,
    breakdown,
    costUsd,
    unit: isTokenMetric ? 'tokens' : 'units',
  })
}

/**
 * Tokens de una operación que al tenant ya se le cobró POR UNIDAD.
 *
 * Esta función no toca counters de cuota: la unidad (por ejemplo, un análisis
 * de visión) ya fue descontada por reserveAiBudget. Solo registra costo,
 * consumo de plataforma y ledger.
 */
export const recordTokenSpend = async ({
  tenantId,
  metric,
  model = null,
  inputTokens = null,
  outputTokens = null,
  totalTokens = null,
  profile = null,
  period: requestedPeriod = null,
  // La misma clave que devolvió reserveAiBudget. El evento distingue la fila,
  // así que reserva y consumo de una operación conviven; dos consumos de la
  // misma operación son un reintento y el índice los descarta.
  operationId = null,
  // Cuál de las llamadas de la operación. El default cubre el caso de siempre
  // —una operación, una llamada— sin que ningún llamador cambie.
  callId = CALL_ID.MAIN,
  provider = null,
  requestedModel = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)

  if (!normalizedMetric || !id) return

  const breakdown = computeCostUsd({
    model: model || getDefaultPricingModel(),
    inputTokens,
    outputTokens,
    totalTokens,
  })

  if (breakdown.totalTokens <= 0) return

  const aiProfile = profile || (await loadTenantAiProfile(id))
  const isByok = aiProfile.keySource === KEY_SOURCE.TENANT
  const costUsd = isByok ? 0 : breakdown.costUsd
  const period = requestedPeriod || getCurrentPeriod()

  // Antes de este punto no se tocó nada. Medido contra una base real, sin este
  // candado dos llamadas con la misma clave dejaban AiPlatformUsage.tokens en
  // 3000 sobre 1500 realmente gastados — y ese contador es el que mide el
  // disyuntor de plataforma, así que un reintento podía dispararlo antes de
  // tiempo y dejar sin IA a todos los comercios.
  const nuevo = await claimConsumption({
    tenantId: id,
    operationId,
    callId,
    period,
    metric: normalizedMetric,
    amount: breakdown.totalTokens,
    provider,
    requestedModel,
    // El modelo que EFECTIVAMENTE respondió. Es el dato que explica una factura
    // rara: se pide gemini-3.8-flash, el fallback entrega 3.1-flash-lite, y lo
    // que se paga es lo segundo.
    actualModel: breakdown.price?.model || model,
    breakdown,
    costUsd,
  })

  if (!nuevo) return

  if (costUsd > 0) {
    try {
      await ensureUsageDocument({ tenantId: id, period })
      await AiUsage.updateOne(
        { tenantId: id, period },
        {
          $inc: { estimatedCostUsd: costUsd },
          $set: { lastActivityAt: new Date() },
        },
      ).setOptions({ tenantId: id })
    } catch (error) {
      logger.warn('[AI BUDGET] No se pudo registrar el costo de tokens', {
        tenantId: id,
        metric: normalizedMetric,
        period,
        error: error.message,
      })
    }
  }

  if (!isByok) {
    await registerPlatformConsumption({
      tokens: breakdown.totalTokens,
      costUsd,
      period,
    }).catch(error => {
      logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma', {
        tenantId: id,
        metric: normalizedMetric,
        period,
        error: error.message,
      })
    })
  }

  writeLedgerEntry({
    tenantId: id,
    period,
    event: LEDGER_EVENT.CONSUMED,
    operationId: ledgerKey(operationId, callId),
    metric: normalizedMetric,
    amount: breakdown.totalTokens,
    unit: 'tokens',
    model: breakdown.price.model || model,
    keySource: aiProfile.keySource,
    plan: aiProfile.plan,
    breakdown,
    costUsd,
  })
}

// ─── RESERVAS COLGADAS ──────────────────────────────────────────────────────

/** Entero positivo de entorno, o el default medido. Nada fijo a mano. */
const envPositiveInt = (name, fallback) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Cuánto puede estar corriendo una operación antes de considerarla muerta.
 *
 * Tiene que ser holgado: la operación más lenta medida es un análisis de
 * mercado, que llegó a 116 segundos cuando el modelo estaba saturado y hubo
 * que esperar la cadena de respaldo. Treinta minutos deja margen de sobra y
 * sigue siendo mucho menos que el mes que el cupo quedaría tomado.
 *
 * Barrer de más tiene un costo real y acotado: si la operación seguía viva y
 * termina después, el cupo ya se devolvió y el comercio se lleva ese mensaje
 * gratis. Barrer de menos deja al comercio pagando algo que nunca recibió,
 * hasta que cambie el mes. Por eso el umbral es generoso y el sesgo, a esperar.
 */
const STALE_AFTER_MS = envPositiveInt('AI_STALE_OPERATION_MS', 30 * 60 * 1000)

/** Cuántas se barren por ciclo. Un tope evita que un incidente viejo monopolice. */
const STALE_BATCH = envPositiveInt('AI_STALE_OPERATION_BATCH', 200)

/**
 * Devuelve el cupo de las operaciones que quedaron corriendo para siempre.
 *
 * Una operación entra en 'running' cuando se reserva el cupo y sale cuando se
 * registra el consumo o se devuelve la reserva. Si el proceso muere en el
 * medio —un deploy a mitad de una llamada, un timeout del contenedor, un
 * crash— no pasa ninguna de las dos cosas: el comercio queda pagando un
 * mensaje que nunca se envió, y nada lo devuelve hasta que cambia el mes.
 *
 * Esta función es la razón por la que AiOperation existe como colección
 * separada y no como una vista derivada del ledger: encontrar estas
 * operaciones es un índice sobre (status, startedAt), y derivarlo del ledger
 * sería una agregación buscando reservas sin su consumo ni su devolución.
 *
 * NO duplica la lógica de devolución: llama a refundAiBudget, que ya tiene el
 * reclamo atómico. Dos barredoras corriendo a la vez —dos instancias del
 * servidor— no pueden devolver la misma reserva dos veces, por el mismo
 * mecanismo que protege a los refunds normales.
 *
 * @param {Object} [params]
 * @param {number} [params.olderThanMs]
 * @param {number} [params.limit]
 * @returns {Promise<{found:number, swept:number}>}
 */
export const sweepStaleOperations = async ({
  olderThanMs = STALE_AFTER_MS,
  limit = STALE_BATCH,
} = {}) => {
  const corte = new Date(Date.now() - olderThanMs)

  const colgadas = await AiOperation.find({
    status: AI_OPERATION_STATUS.RUNNING,
    startedAt: { $lt: corte },
  })
    .sort({ startedAt: 1 })
    .limit(limit)
    .select('tenantId operationId metric amount period startedAt feature')
    .setOptions({ ignoreTenant: true, platformScope: 'platform:barrido-reservas-colgadas' })
    .lean()

  if (colgadas.length === 0) return { found: 0, swept: 0 }

  let swept = 0

  for (const operacion of colgadas) {
    try {
      await refundAiBudget({
        tenantId: operacion.tenantId,
        metric: operacion.metric,
        amount: operacion.amount || 1,
        period: operacion.period,
        operationId: operacion.operationId,
      })

      swept += 1
    } catch (error) {
      logger.warn('[AI SWEEP] No se pudo devolver una reserva colgada', {
        tenantId: String(operacion.tenantId),
        operationId: operacion.operationId,
        error: error.message,
      })
    }
  }

  // Nivel warn y no info: que haya reservas colgadas significa que algo se
  // murió a mitad de camino. El barrido arregla la plata, no la causa.
  logger.warn('[AI SWEEP] Reservas colgadas devueltas', {
    found: colgadas.length,
    swept,
    olderThanMinutes: Math.round(olderThanMs / 60000),
    features: [...new Set(colgadas.map(o => o.feature).filter(Boolean))],
  })

  return { found: colgadas.length, swept }
}

let sweepInterval = null

/**
 * Arranca el barrido periódico.
 *
 * Vive acá y no en src/workers/ a propósito: es lógica de presupuesto —decide
 * devolver plata— y su cuerpo son diez líneas que llaman a refundAiBudget, que
 * está en este mismo archivo. Un archivo aparte separaría la decisión de
 * devolver del resto de las reglas de cobro.
 */
export const startStaleOperationSweeper = ({ logger: log = logger } = {}) => {
  if (process.env.AI_STALE_SWEEPER_ENABLED === 'false') {
    log.info?.('[AI SWEEP] Barrido de reservas colgadas deshabilitado')
    return
  }

  if (sweepInterval) return

  // Cada quince minutos. No hace falta más: el daño de una reserva colgada es
  // cupo tomado durante el mes, no una urgencia de segundos.
  const intervalMs = envPositiveInt('AI_STALE_SWEEP_INTERVAL_MS', 15 * 60 * 1000)

  // UNA PASADA AL ARRANCAR, y es lo que hace que esto sirva de verdad.
  //
  // El intervalo se reinicia en cada deploy. Verificado en producción: dos
  // operaciones quedaron 67 y 59 minutos en 'running' con la barredora
  // desplegada y funcionando —su consulta las encontraba— porque entre deploy
  // y deploy el tick de quince minutos nunca llegó a dispararse. En un
  // servicio que se reinicia seguido, un timer largo sin pasada inicial es un
  // timer que no corre nunca.
  //
  // Va con un retraso corto y no en el instante cero: al arrancar hay
  // conexiones abriéndose y migraciones corriendo, y este barrido no tiene
  // ninguna urgencia de segundos.
  const arranqueMs = envPositiveInt('AI_STALE_SWEEP_ON_START_MS', 60 * 1000)

  const primeraPasada = setTimeout(() => {
    sweepStaleOperations().catch(error => {
      log.error?.('[AI SWEEP] El barrido de arranque falló', { error: error.message })
    })
  }, arranqueMs)

  primeraPasada.unref?.()

  sweepInterval = setInterval(() => {
    sweepStaleOperations().catch(error => {
      log.error?.('[AI SWEEP] El barrido falló', { error: error.message })
    })
  }, intervalMs)

  // No mantiene vivo el proceso: si no queda nada más que hacer, que Node
  // pueda salir.
  sweepInterval.unref?.()

  log.info?.('[AI SWEEP] Barrido de reservas colgadas iniciado', {
    intervalMinutes: Math.round(intervalMs / 60000),
    staleAfterMinutes: Math.round(STALE_AFTER_MS / 60000),
  })

  anunciarFrenos(log)
}

/**
 * Qué frenos quedaron armados, al arrancar.
 *
 * Los dos techos se configuran por variable de entorno y no había forma de
 * saber cuáles estaban puestos sin leer el panel o esperar a que cortaran.
 * "¿Está activo el techo en dólares?" se contestaba deduciendo, y el modo de
 * falla es silencioso: una variable mal escrita deja el freno apagado y todo
 * se ve exactamente igual hasta la factura.
 *
 * Una línea en el arranque lo vuelve verificable desde los logs del servicio.
 */
const anunciarFrenos = (log = logger) => {
  const tokens = getPlatformMonthlyTokenBudget()
  const usd = getPlatformMonthlyUsdBudget()

  log.info?.('[AI BUDGET] Frenos de plataforma', {
    tokenBudget: tokens === UNLIMITED ? 'sin techo' : tokens,
    usdBudget: usd === UNLIMITED ? 'sin techo' : usd,
    // Con los dos sin techo no hay disyuntor. Es una decisión válida, y
    // conviene que se lea como tal y no como un olvido.
    disyuntor: tokens === UNLIMITED && usd === UNLIMITED ? 'APAGADO' : 'armado',
  })
}

export const stopStaleOperationSweeper = () => {
  if (sweepInterval) {
    clearInterval(sweepInterval)
    sweepInterval = null
  }
}

/**
 * Chequeo sin reservar, para el middleware de ruta: corta temprano al que ya
 * está sin cupo o sin suscripción, sin duplicar el contador que después
 * incrementa el servicio.
 */
export const checkAiEntitlement = async ({ tenantId, metric, profile = null }) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)

  if (!normalizedMetric || !id) {
    return { allowed: false, reason: DENY_REASONS.NO_API_KEY, metric: normalizedMetric }
  }

  const aiProfile = profile || (await loadTenantAiProfile(id))
  const subscription = getSubscriptionState(aiProfile)
  const limit = resolveEffectiveLimit({
    plan: aiProfile.plan,
    metric: normalizedMetric,
    keySource: aiProfile.keySource,
  })

  if (!subscription.entitled) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.SUBSCRIPTION,
      detail: subscription.reason,
      profile: aiProfile,
    })
  }

  if (aiProfile.keySource === KEY_SOURCE.NONE) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.NO_API_KEY,
      profile: aiProfile,
    })
  }

  if (aiProfile.keySource === KEY_SOURCE.TENANT) {
    return {
      allowed: true,
      metric: normalizedMetric,
      limit: UNLIMITED,
      unlimited: true,
      byok: true,
      keySource: aiProfile.keySource,
      plan: aiProfile.plan,
    }
  }

  const platformBudget = await evaluatePlatformBudget()

  if (platformBudget.exhausted) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.PLATFORM_BUDGET,
      detail: platformBudget.reason,
      profile: aiProfile,
    })
  }

  if (limit === UNLIMITED) {
    return {
      allowed: true,
      metric: normalizedMetric,
      limit: UNLIMITED,
      unlimited: true,
      keySource: aiProfile.keySource,
      plan: aiProfile.plan,
    }
  }

  const usage = await AiUsage.findOne({ tenantId: id, period: getCurrentPeriod() })
    .setOptions({ tenantId: id })
    .lean()

  const used = readCounter(usage, normalizedMetric)

  if (used >= limit) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used,
      reason: DENY_REASONS.METRIC_LIMIT,
      profile: aiProfile,
    })
  }

  return {
    allowed: true,
    metric: normalizedMetric,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    unlimited: false,
    keySource: aiProfile.keySource,
    plan: aiProfile.plan,
  }
}

// ─── Lectura para el panel ───────────────────────────────

/**
 * Estado completo del mes: todas las métricas, el plan, la suscripción y de
 * qué key sale el gasto. Es lo que necesita el admin para entender por qué
 * la IA dejó de responder, sin tener que preguntar.
 */
export const getAiBudgetSnapshot = async tenantId => {
  const id = clean(tenantId)
  const period = getCurrentPeriod()

  const profile = await loadTenantAiProfile(id)
  const usage = await AiUsage.findOne({ tenantId: id, period })
    .setOptions({ tenantId: id })
    .lean()
  const selfLimits = await loadAgentSelfLimits(id)

  // Los topes del snapshot pasan por la misma resolución que el cobro: si el
  // panel mostrara "sin límite" y el medidor cortara igual, el comercio no
  // tendría forma de entender por qué se le apagó el asistente.
  const limits = AI_METRIC_LIST.reduce((acc, metric) => {
    acc[metric] = resolveEffectiveLimit({
      plan: profile.plan,
      metric,
      keySource: profile.keySource,
    })
    return acc
  }, {})
  const subscription = getSubscriptionState(profile)

  const metrics = AI_METRIC_LIST.reduce((acc, metric) => {
    const planLimit = limits[metric]

    // ...y por el mismo autolímite. Esta línea faltaba: el cobro aplicaba el
    // autolímite del comercio (reserveAiBudget → applyLimitOverride) y el
    // panel seguía mostrando el tope del plan, así que quien se ponía un
    // freno de 2.000 mensajes veía "10K" y se quedaba sin asistente en 2.000
    // sin ninguna explicación a la vista.
    const limit = applyLimitOverride(planLimit, selfLimits[metric] ?? null)
    const used = readCounter(usage, metric)

    acc[metric] = {
      label: AI_METRIC_LABELS[metric],
      used,
      limit,
      unlimited: limit === UNLIMITED,
      remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
      // El tope del plan viaja aparte para que el panel pueda decir de dónde
      // sale el recorte. Sin esto, un tope más bajo que el contratado se lee
      // como un error de facturación.
      planLimit,
      selfLimited: limit !== planLimit,
    }

    return acc
  }, {})

  return {
    period,
    plan: profile.plan,
    subscription: {
      status: subscription.status,
      entitled: subscription.entitled,
      reason: subscription.reason,
      trialEndsAt: profile.trialEndsAt,
    },
    credentials: {
      source: profile.keySource,
      byokEnabled: profile.byokEnabled,
      byokAllowed: profile.byokAllowed,
      hasTenantKey: profile.hasTenantKey,
    },
    metrics,
    // Se acota a cero por el cruce del despliegue: una edición reservada por la
    // versión vieja (que no cobraba al reservar) y devuelta por la nueva (que
    // sí descuenta) resta una plata que nunca se sumó. Son centavos y una
    // ventana de minutos, pero un total negativo en el panel se lee como un
    // error de la plataforma, no como el redondeo que es.
    estimatedCostUsd: Math.max(0, Number(usage?.estimatedCostUsd || 0)),
    byokTokens: Number(usage?.byokTokens || 0),
    lastActivityAt: usage?.lastActivityAt || null,
  }
}

/**
 * Snapshot legacy del análisis de imágenes.
 *
 * Mantiene exactamente la forma que ya consume ProductAnalysisPage
 * (`{ period, plan, used, limit, unlimited, remaining }`). No cambiarla acá
 * sin cambiar el panel.
 */
export const getAiUsageSnapshot = async tenantId => {
  const snapshot = await getAiBudgetSnapshot(tenantId)
  const vision = snapshot.metrics[AI_METRICS.VISION]

  return {
    period: snapshot.period,
    plan: snapshot.plan,
    used: vision.used,
    limit: vision.limit,
    unlimited: vision.unlimited,
    remaining: vision.remaining,
  }
}

export default {
  AI_METRICS,
  DENY_REASONS,
  getCurrentPeriod,
  reserveAiBudget,
  refundAiBudget,
  recordAiConsumption,
  checkAiEntitlement,
  getAiBudgetSnapshot,
  getAiUsageSnapshot,
  buildBudgetDenialMessage,
}
