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

// Se reexportan para que quien mide consumo tenga un único import: el medidor
// es la puerta de entrada, la política es un detalle de implementación suyo.
export { AI_METRICS, AI_METRIC_LABELS, UNLIMITED }

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
      'gemini-3.6-flash',
  )

/**
 * Escribe una fila del ledger. Nunca lanza.
 *
 * El ledger registra lo que YA pasó, así que un fallo suyo no puede tumbar una
 * operación de IA que salió bien. Se loguea con nivel error y no warn: un libro
 * contable que falla en silencio es peor que no tenerlo, porque igual se confía
 * en él para decir cuánto se gastó.
 */
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
const isPlatformBudgetExhausted = async () => {
  const budget = getPlatformMonthlyTokenBudget()
  if (budget === UNLIMITED) return false

  // El período va en la clave: si no, un disyuntor que cortó el día 31 sigue
  // cortando hasta 30 segundos después del cambio de mes, cuando el contador
  // real ya arrancó de cero.
  const period = getCurrentPeriod()
  const cacheKey = `${BREAKER_CACHE_KEY}:${period}`

  const cached = await cacheGet(cacheKey)
  if (cached !== null && cached !== undefined) return Boolean(cached.exhausted)

  const usage = await AiPlatformUsage.findOne({ period }).lean()
  const tokens = Number(usage?.tokens || 0)
  const exhausted = tokens >= budget

  await cacheSet(cacheKey, { exhausted }, BREAKER_CACHE_TTL_SEC)

  return exhausted
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
const announceBudgetPressure = async ({ period, usage, budget }) => {
  try {
    const tokens = Number(usage?.tokens || 0)
    const percent = (tokens / budget) * 100

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
      percent: percent.toFixed(1),
      tokens,
      budget,
      estimatedCostUsd: Number(usage?.estimatedCostUsd || 0).toFixed(2),
      topSpend,
    })

    // El log alcanza para el escalón informativo. Desde el 80% el aviso tiene
    // que salir a buscar a alguien, porque a partir de ahí hay que decidir algo.
    if (reached >= EMAIL_THRESHOLD) {
      await notifyBudgetPressure({
        period,
        percent: percent.toFixed(1),
        tokens,
        budget,
        estimatedCostUsd: Number(usage?.estimatedCostUsd || 0),
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

  if (budget === UNLIMITED) return updated

  await announceBudgetPressure({ period, usage: updated, budget })

  // Solo una instancia puede reclamar el disparo. Se tolera tanto null como
  // campo ausente porque convivimos con documentos creados por versiones viejas.
  if (updated.tokens >= budget && !updated.breakerTrippedAt) {
    const claimed = await AiPlatformUsage.findOneAndUpdate(
      {
        period,
        $or: [
          { breakerTrippedAt: null },
          { breakerTrippedAt: { $exists: false } },
        ],
      },
      { $set: { breakerTrippedAt: new Date() } },
      { new: true },
    ).lean()

    if (claimed) {
      logger.error('[AI BUDGET] Disyuntor de plataforma activado', {
        period,
        tokens: claimed.tokens,
        budget,
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

  if (await isPlatformBudgetExhausted()) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.PLATFORM_BUDGET,
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
    const usage = await AiUsage.findOne({ tenantId: id, period })
      .setOptions({ tenantId: id })
      .lean()

    const exhaustedGuard = guardLimits.find(
      guard => readCounter(usage, guard.metric) >= guard.limit,
    )

    if (exhaustedGuard) {
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
    operationId,
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
    operationId,
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

  if (await isPlatformBudgetExhausted()) {
    return buildDeniedResult({
      metric: normalizedMetric,
      limit,
      used: 0,
      reason: DENY_REASONS.PLATFORM_BUDGET,
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
