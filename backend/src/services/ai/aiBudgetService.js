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
import { computeCostUsd } from './aiModelPricing.js'
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
 * Modelo asumido cuando el llamador no informa cuál usó. Es el mismo que
 * resuelve aiVisionService, así que hoy coincide con el que corre todo.
 */
const DEFAULT_PRICING_MODEL = clean(
  process.env.GEMINI_MODEL || process.env.GOOGLE_IMAGE_MODEL || 'gemini-3.6-flash',
).replace(/^models\//, '')

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

export const getCurrentPeriod = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

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

const registerPlatformConsumption = async ({ tokens, costUsd }) => {
  const period = getCurrentPeriod()
  const budget = getPlatformMonthlyTokenBudget()

  const updated = await AiPlatformUsage.findOneAndUpdate(
    { period },
    {
      $inc: {
        tokens: Math.max(0, Math.round(tokens || 0)),
        estimatedCostUsd: Math.max(0, costUsd || 0),
      },
      $set: { lastActivityAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()

  if (budget === UNLIMITED) return updated

  if (updated.tokens >= budget && !updated.breakerTrippedAt) {
    await AiPlatformUsage.updateOne(
      { period, breakerTrippedAt: null },
      { $set: { breakerTrippedAt: new Date() } },
    )

    logger.error('[AI BUDGET] Disyuntor de plataforma activado', {
      period,
      tokens: updated.tokens,
      budget,
      estimatedCostUsd: Number(updated.estimatedCostUsd || 0).toFixed(2),
    })
  }

  // El cache del disyuntor quedó viejo en el momento en que cruzamos el tope.
  if (updated.tokens >= budget) await cacheDel(`${BREAKER_CACHE_KEY}:${period}`)

  return updated
}

// ─── Reserva ─────────────────────────────────────────────

const applyReservation = async ({ tenantId, period, metric, amount, conditions }) => {
  const now = new Date()

  const increment = {
    [counterPath(metric)]: amount,
    // analysisCount se mantiene sincronizado con counters.vision porque el
    // panel de análisis y los snapshots viejos lo leen por ese nombre.
    ...(metric === AI_METRICS.VISION ? { analysisCount: amount } : {}),
  }

  return AiUsage.findOneAndUpdate(
    { tenantId, period, ...conditions },
    {
      $inc: increment,
      $set: {
        lastActivityAt: now,
        ...(metric === AI_METRICS.VISION ? { lastAnalysisAt: now } : {}),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).setOptions({ tenantId })
}

/**
 * Autolímite del comercio. Solo puede APRETAR el tope del plan, nunca
 * aflojarlo: si se aceptara un valor más alto, cualquier admin de tenant se
 * subiría la cuota desde su propio panel, que es exactamente el agujero que
 * este refactor viene a cerrar.
 */
/**
 * Tope efectivo de una métrica: el del plan, salvo que el plan diga
 * "ilimitado" y el comercio esté corriendo sobre la key compartida. Ahí manda
 * el techo por tenant de aiPlanPolicy, porque ilimitado-sobre-la-key-de-todos
 * significa que un solo comercio puede hacer saltar el disyuntor y dejar sin
 * asistente a los demás.
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

/**
 * Reserva consumo para un tenant.
 *
 * @param guards         Métricas que además deben NO estar agotadas para
 *                       permitir la operación (el caso real: no contestar un
 *                       mensaje más si ya se pasó del tope de tokens del mes).
 *                       Se evalúan dentro del mismo filtro para que sigan
 *                       siendo atómicas.
 * @param limitOverride  Autolímite del comercio, siempre hacia abajo.
 */
export const reserveAiBudget = async ({
  tenantId,
  metric,
  amount = 1,
  guards = [],
  profile = null,
  limitOverride = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)

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

  // Con key propia el gasto no toca la factura de la plataforma: se registra
  // (para poder dimensionar el plan del comercio) pero no se cobra cuota.
  if (aiProfile.keySource === KEY_SOURCE.TENANT) {
    await recordAiConsumption({
      tenantId: id,
      metric: normalizedMetric,
      amount,
      profile: aiProfile,
    })

    return {
      allowed: true,
      metric: normalizedMetric,
      limit: UNLIMITED,
      used: 0,
      remaining: null,
      unlimited: true,
      byok: true,
      reason: 'byok',
      keySource: aiProfile.keySource,
      plan: aiProfile.plan,
      label: AI_METRIC_LABELS[normalizedMetric],
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

  const period = getCurrentPeriod()

  const guardLimits = (guards || [])
    .map(normalizeMetric)
    .filter(Boolean)
    .map(guardMetric => ({
      metric: guardMetric,
      limit: resolveEffectiveLimit({
        plan: aiProfile.plan,
        metric: guardMetric,
        keySource: aiProfile.keySource,
      }),
    }))
    .filter(guard => guard.limit !== UNLIMITED)

  const conditions = {
    ...(limit === UNLIMITED
      ? {}
      : { [counterPath(normalizedMetric)]: { $lt: limit } }),
    ...guardLimits.reduce((acc, guard) => {
      acc[counterPath(guard.metric)] = { $lt: guard.limit }
      return acc
    }, {}),
  }

  try {
    const updated = await applyReservation({
      tenantId: id,
      period,
      metric: normalizedMetric,
      amount,
      conditions,
    })

    const used = readCounter(updated, normalizedMetric)

    // La reserva se anota sin costo: acá todavía no se sabe cuántos tokens va
    // a gastar la operación. El costo llega con el 'consumed' correspondiente,
    // y si el proveedor falla llega un 'refunded'. El gasto real de un comercio
    // es la suma de sus consumed menos sus refunded — las reservas quedan como
    // rastro de intención, útil para ver cuánto se pidió contra cuánto se usó.
    writeLedgerEntry({
      tenantId: id,
      period,
      event: LEDGER_EVENT.RESERVED,
      metric: normalizedMetric,
      amount,
      unit: TOKEN_METRICS.has(normalizedMetric) ? 'tokens' : 'units',
      keySource: aiProfile.keySource,
      plan: aiProfile.plan,
    })

    return {
      allowed: true,
      metric: normalizedMetric,
      limit,
      used,
      remaining: limit === UNLIMITED ? null : Math.max(0, limit - used),
      unlimited: limit === UNLIMITED,
      byok: false,
      reason: 'ok',
      keySource: aiProfile.keySource,
      plan: aiProfile.plan,
      label: AI_METRIC_LABELS[normalizedMetric],
    }
  } catch (error) {
    if (error?.code !== 11000) throw error

    // E11000 significa que el filtro no matcheó (el documento del período ya
    // existe) y el upsert chocó contra el índice único {tenantId, period}.
    // Casi siempre es "sin cupo", pero también puede ser un documento viejo
    // sin el campo counters.<metric> todavía creado. Hay que distinguirlos:
    // tratar lo segundo como "sin cupo" dejaría al tenant bloqueado para
    // siempre en una métrica que nunca usó.
    const usage = await AiUsage.findOne({ tenantId: id, period })
      .setOptions({ tenantId: id })
      .lean()

    const used = readCounter(usage, normalizedMetric)
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

    if (limit !== UNLIMITED && used >= limit) {
      return buildDeniedResult({
        metric: normalizedMetric,
        limit,
        used,
        reason: DENY_REASONS.METRIC_LIMIT,
        profile: aiProfile,
      })
    }

    // Documento preexistente al que le faltaba el contador: lo creamos y
    // seguimos. La ventana de carrera acá es de una unidad y solo puede pasar
    // una vez por tenant y métrica, la primera vez después del deploy.
    const healed = await applyReservation({
      tenantId: id,
      period,
      metric: normalizedMetric,
      amount,
      conditions: {},
    })

    const healedUsed = readCounter(healed, normalizedMetric)

    return {
      allowed: true,
      metric: normalizedMetric,
      limit,
      used: healedUsed,
      remaining: limit === UNLIMITED ? null : Math.max(0, limit - healedUsed),
      unlimited: limit === UNLIMITED,
      byok: false,
      reason: 'ok_backfilled',
      keySource: aiProfile.keySource,
      plan: aiProfile.plan,
      label: AI_METRIC_LABELS[normalizedMetric],
    }
  }
}

/**
 * Devuelve una reserva cuando el proveedor falló. No es culpa del comercio,
 * así que no le puede contar contra el cupo.
 */
export const refundAiBudget = async ({ tenantId, metric, amount = 1 }) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)

  if (!normalizedMetric || !id) return

  const period = getCurrentPeriod()

  try {
    const refunded = await AiUsage.findOneAndUpdate(
      {
        tenantId: id,
        period,
        [counterPath(normalizedMetric)]: { $gte: amount },
      },
      {
        $inc: {
          [counterPath(normalizedMetric)]: -amount,
          ...(normalizedMetric === AI_METRICS.VISION
            ? { analysisCount: -amount }
            : {}),
        },
      },
    ).setOptions({ tenantId: id })

    // Solo se anota si el descuento OCURRIÓ. El filtro lleva un $gte que puede
    // no matchear —contador ya en cero, período distinto—, y en ese caso
    // findOneAndUpdate devuelve null sin tocar nada. Registrar igual metería en
    // el libro una devolución que nunca pasó, y el gasto real se calcula
    // restando los refunded: una fila de más deja la cuenta por debajo de la
    // verdad, que es el error caro de los dos.
    if (refunded) {
      writeLedgerEntry({
        tenantId: id,
        period,
        event: LEDGER_EVENT.REFUNDED,
        metric: normalizedMetric,
        amount,
        unit: TOKEN_METRICS.has(normalizedMetric) ? 'tokens' : 'units',
      })
    }
  } catch (error) {
    logger.warn('[AI BUDGET] No se pudo devolver la reserva', {
      tenantId: id,
      metric: normalizedMetric,
      error: error.message,
    })
  }
}

/**
 * Registra consumo ya ocurrido (tokens, o el consumo de un tenant BYOK).
 * Nunca bloquea: lo que ya se gastó, se gastó; el efecto es sobre la próxima
 * operación, que sí encuentra el contador arriba del tope.
 */
export const recordAiConsumption = async ({
  tenantId,
  metric,
  amount = 0,
  profile = null,
  // Modelo que produjo el consumo. Opcional para no tocar los call sites
  // existentes: sin él se asume el configurado, que es el que corren todos hoy.
  model = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)
  const value = Number(amount)

  if (!normalizedMetric || !id) return
  if (!Number.isFinite(value) || value <= 0) return

  const aiProfile = profile || (await loadTenantAiProfile(id))
  const isByok = aiProfile.keySource === KEY_SOURCE.TENANT
  const isTokenMetric = TOKEN_METRICS.has(normalizedMetric)
  const usedModel = model || DEFAULT_PRICING_MODEL

  // El costo sale del catálogo por modelo en vez de una tarifa mezclada: la
  // salida cuesta cinco veces la entrada, así que un promedio único se
  // equivoca en cuanto cambia la proporción entre una operación y otra.
  const breakdown = isTokenMetric && !isByok
    ? computeCostUsd({ model: usedModel, totalTokens: value })
    : null

  const costUsd = breakdown?.costUsd || 0
  const period = getCurrentPeriod()

  try {
    await AiUsage.findOneAndUpdate(
      { tenantId: id, period },
      {
        $inc: {
          [counterPath(normalizedMetric)]: Math.round(value),
          ...(isTokenMetric && isByok ? { byokTokens: Math.round(value) } : {}),
          ...(costUsd > 0 ? { estimatedCostUsd: costUsd } : {}),
        },
        $set: { lastActivityAt: new Date() },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ).setOptions({ tenantId: id })
  } catch (error) {
    logger.warn('[AI BUDGET] No se pudo registrar consumo', {
      tenantId: id,
      metric: normalizedMetric,
      error: error.message,
    })
  }

  if (isTokenMetric && !isByok) {
    await registerPlatformConsumption({ tokens: value, costUsd }).catch(error => {
      logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma', {
        error: error.message,
      })
    })
  }

  writeLedgerEntry({
    tenantId: id,
    period,
    event: LEDGER_EVENT.CONSUMED,
    metric: normalizedMetric,
    amount: value,
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
 * Visión es el caso: al comercio se le descuenta un análisis, y los tokens que
 * ese análisis gastó le cuestan plata a HENKO igual. Hasta acá nadie los
 * contaba — el disyuntor de plataforma, que es el único techo duro de la
 * factura, no veía la operación más cara por llamada de todo el sistema. Un
 * techo que no ve el gasto más grande no es un techo.
 *
 * Deliberadamente NO toca ningún contador de cuota: la unidad ya se descontó en
 * la reserva, y sumarle tokens a un contador que cuenta análisis rompería el
 * tope del plan (50 análisis pasarían a agotarse en el primero). Sí suma el
 * costo del período, el consumo de plataforma y el ledger.
 *
 * Recibe el desglose medido cuando existe —acá sí existe, Gemini lo devuelve en
 * usageMetadata— así que este costo no es repartido: es el real.
 */
export const recordTokenSpend = async ({
  tenantId,
  metric,
  model = null,
  inputTokens = null,
  outputTokens = null,
  totalTokens = null,
  profile = null,
}) => {
  const normalizedMetric = normalizeMetric(metric)
  const id = clean(tenantId)

  if (!normalizedMetric || !id) return

  const breakdown = computeCostUsd({
    model: model || DEFAULT_PRICING_MODEL,
    inputTokens,
    outputTokens,
    totalTokens,
  })

  if (breakdown.totalTokens <= 0) return

  const aiProfile = profile || (await loadTenantAiProfile(id))
  const isByok = aiProfile.keySource === KEY_SOURCE.TENANT

  // Con key propia el comercio le paga a Google directo: se registra para que
  // su panel lo vea, con costo 0 y sin tocar el disyuntor, que existe para
  // proteger la factura de HENKO y no la de él.
  const costUsd = isByok ? 0 : breakdown.costUsd
  const period = getCurrentPeriod()

  if (costUsd > 0) {
    try {
      await AiUsage.findOneAndUpdate(
        { tenantId: id, period },
        {
          $inc: { estimatedCostUsd: costUsd },
          $set: { lastActivityAt: new Date() },
        },
        { upsert: true, setDefaultsOnInsert: true },
      ).setOptions({ tenantId: id })
    } catch (error) {
      logger.warn('[AI BUDGET] No se pudo registrar el costo de tokens', {
        tenantId: id,
        metric: normalizedMetric,
        error: error.message,
      })
    }
  }

  if (!isByok) {
    await registerPlatformConsumption({
      tokens: breakdown.totalTokens,
      costUsd,
    }).catch(error => {
      logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma', {
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
 * Costo de una generación de imagen (Replicate/HuggingFace) — separado de
 * recordAiConsumption porque reserveAiBudget para IMAGE_EDITS ya incrementa
 * el contador de cuota por su cuenta (applyReservation); esta función solo
 * toca estimatedCostUsd, nunca counters.imageEdits, para no duplicar el
 * conteo de cuota.
 */
export const recordImageGenerationCost = async ({ tenantId, profile = null, count = 1 }) => {
  const id = clean(tenantId)
  if (!id) return

  const aiProfile = profile || (await loadTenantAiProfile(id))
  if (aiProfile.keySource === KEY_SOURCE.TENANT) return // BYOK: no le cuesta a la plataforma

  const costUsd = estimateImageCostUsd(count)
  if (costUsd <= 0) return

  const period = getCurrentPeriod()

  try {
    await AiUsage.findOneAndUpdate(
      { tenantId: id, period },
      {
        $inc: { estimatedCostUsd: costUsd },
        $set: { lastActivityAt: new Date() },
      },
      { upsert: true, setDefaultsOnInsert: true },
    ).setOptions({ tenantId: id })
  } catch (error) {
    logger.warn('[AI BUDGET] No se pudo registrar costo de imagen', {
      tenantId: id,
      error: error.message,
    })
  }

  await registerPlatformConsumption({ tokens: 0, costUsd }).catch(error => {
    logger.warn('[AI BUDGET] No se pudo registrar consumo de plataforma (imagen)', {
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
