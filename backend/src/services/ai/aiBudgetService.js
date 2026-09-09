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

import AiUsage from '../../models/aiUsageModel.js'
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
}) => {
  AiConsumptionLedger.create({
    tenantId,
    period,
    event,
    metric,
    amount: Math.max(0, Math.round(Number(amount) || 0)),
    unit,
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
  plan: profile?.plan || 'free',
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
  const normalizedCost = Math.max(0, Number(costUsd) || 0)

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
const applyReservation = async ({ tenantId, period, metric, amount, limit, guardLimits }) => {
  const increment = {
    [counterPath(metric)]: amount,
    ...(metric === AI_METRICS.VISION ? { analysisCount: amount } : {}),
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

const applyLimitOverride = (planLimit, override) => {
  const value = Number(override)
  if (!Number.isFinite(value) || value <= 0) return planLimit
  if (planLimit === UNLIMITED) return Math.floor(value)
  return Math.min(planLimit, Math.floor(value))
}

const buildAllowedResult = ({ metric, limit, used, profile, reason = 'ok', byok = false }) => ({
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
  period: requestedPeriod = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)
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
      limit: resolveEffectiveLimit({
        plan: aiProfile.plan,
        metric: guardMetric,
        keySource: aiProfile.keySource,
      }),
    }))
    .filter(guard => guard.limit !== UNLIMITED)

  const updated = await applyReservation({
    tenantId: id,
    period,
    metric: normalizedMetric,
    amount: reservationAmount,
    limit,
    guardLimits,
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

  writeLedgerEntry({
    tenantId: id,
    period,
    event: LEDGER_EVENT.RESERVED,
    metric: normalizedMetric,
    amount: reservationAmount,
    unit: TOKEN_METRICS.has(normalizedMetric) ? 'tokens' : 'units',
    keySource: aiProfile.keySource,
    plan: aiProfile.plan,
  })

  return buildAllowedResult({
    metric: normalizedMetric,
    limit,
    used,
    profile: aiProfile,
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
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)
  const refundAmount = normalizeAmount(amount)

  if (!normalizedMetric || !id) return

  const period = requestedPeriod || getCurrentPeriod()

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
        },
        $set: { lastActivityAt: new Date() },
      },
      { new: true },
    ).setOptions({ tenantId: id })

    if (refunded) {
      writeLedgerEntry({
        tenantId: id,
        period,
        event: LEDGER_EVENT.REFUNDED,
        metric: normalizedMetric,
        amount: refundAmount,
        unit: TOKEN_METRICS.has(normalizedMetric) ? 'tokens' : 'units',
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
 * Costo de una generación de imagen (Replicate/HuggingFace).
 * No toca counters.imageEdits porque la cuota por unidad ya fue reservada.
 */
export const recordImageGenerationCost = async ({
  tenantId,
  profile = null,
  count = 1,
  period: requestedPeriod = null,
}) => {
  const id = clean(tenantId)
  if (!id) return

  const aiProfile = profile || (await loadTenantAiProfile(id))
  if (aiProfile.keySource === KEY_SOURCE.TENANT) return

  const imageCount = normalizeAmount(count)
  const costUsd = estimateImageCostUsd(imageCount)
  if (costUsd <= 0) return

  const period = requestedPeriod || getCurrentPeriod()

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
    logger.warn('[AI BUDGET] No se pudo registrar costo de imagen', {
      tenantId: id,
      period,
      error: error.message,
    })
  }

  await registerPlatformConsumption({ tokens: 0, costUsd, period }).catch(error => {
    logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma (imagen)', {
      tenantId: id,
      period,
      error: error.message,
    })
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
    const limit = limits[metric]
    const used = readCounter(usage, metric)

    acc[metric] = {
      label: AI_METRIC_LABELS[metric],
      used,
      limit,
      unlimited: limit === UNLIMITED,
      remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
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
    estimatedCostUsd: Number(usage?.estimatedCostUsd || 0),
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
  recordImageGenerationCost,
  checkAiEntitlement,
  getAiBudgetSnapshot,
  getAiUsageSnapshot,
  buildBudgetDenialMessage,
}
