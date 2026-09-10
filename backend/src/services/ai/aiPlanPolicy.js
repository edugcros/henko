// 📁 src/services/ai/aiPlanPolicy.js
//
// Única fuente de verdad de "cuánta IA le corresponde a cada plan".
//
// Antes de este módulo el sistema tenía tres medidores independientes que no
// se conocían entre sí:
//
//   1. Análisis de imagen  → cuota por plan en aiUsageService (50/300/1500).
//   2. Agente comercial    → cuota tomada de los *defaults del schema* de
//                            aiAgentModel (3000 mensajes y 1M de tokens),
//                            idéntica para un tenant free y uno enterprise
//                            porque nadie la escribía nunca al aprovisionar.
//   3. Editor de imágenes  → sin medidor de ningún tipo.
//
// El (2) es el que duele: 3000 mensajes/mes contra la key de la plataforma
// son del orden de USD 9 por tenant gratuito. Con 30 tenants free eso es la
// factura entera del proyecto, generada por gente que no paga.
//
// Acá se declaran los topes por plan y métrica; el cobro atómico vive en
// aiBudgetService.js y el corte por suscripción se decide con
// getSubscriptionState().
//
// Convención heredada de aiUsageService: 0 = ilimitado.

import {
  getPlatformAiOverride,
  PLATFORM_AI_SETTINGS,
} from './platformAiSettingService.js'

const clean = value => String(value || '').trim()

export const AI_METRICS = Object.freeze({
  VISION: 'vision',
  AGENT_MESSAGES: 'agentMessages',
  AGENT_TOKENS: 'agentTokens',
  IMAGE_EDITS: 'imageEdits',
  MARKET_ANALYSES: 'marketAnalyses',
  MARKET_TOKENS: 'marketTokens',
})

export const AI_METRIC_LIST = Object.freeze(Object.values(AI_METRICS))

export const AI_PLANS = Object.freeze(['free', 'starter', 'pro', 'enterprise'])

export const UNLIMITED = 0

// Etiquetas para el admin y para los mensajes de error. El usuario final del
// panel no sabe qué es "agentMessages".
export const AI_METRIC_LABELS = Object.freeze({
  [AI_METRICS.VISION]: 'análisis de imágenes de producto',
  [AI_METRICS.AGENT_MESSAGES]: 'mensajes del asistente de ventas',
  [AI_METRICS.AGENT_TOKENS]: 'tokens del asistente de ventas',
  [AI_METRICS.IMAGE_EDITS]: 'generaciones de fondo con IA',
  [AI_METRICS.MARKET_ANALYSES]: 'análisis de demanda de mercado',
  [AI_METRICS.MARKET_TOKENS]: 'consumo de los análisis de mercado',
})

/**
 * Topes mensuales por plan.
 *
 * MEDICIÓN REAL (agosto 2026, gemini-3.6-flash, catálogo vacío, un
 * saludo de una línea): **2.617 tokens** para un solo mensaje. Ese es el piso
 * absoluto — un mensaje con catálogo, promociones y memoria de conversación
 * en el prompt cuesta bastante más.
 *
 * De ahí sale la relación entre los dos topes del agente. La primera versión
 * de estos defaults daba 300 mensajes y 150k tokens a un tenant free, o sea
 * ~500 tokens por mensaje: el tope de tokens se agotaba a los ~57 mensajes y
 * el panel seguía prometiendo 300. Un medidor que promete cinco veces lo que
 * entrega es el mismo problema que este refactor vino a arreglar.
 *
 * Regla: los tokens se dimensionan como mensajes x ~5.000, con el tope de
 * mensajes como la promesa visible y el de tokens como freno de las
 * conversaciones anormalmente caras, no como el límite de todos los días.
 *
 * Cualquiera se puede sobrescribir por entorno sin tocar código:
 *   AI_LIMIT_FREE_AGENT_MESSAGES=500
 */
const DEFAULT_PLAN_LIMITS = Object.freeze({
  free: {
    [AI_METRICS.VISION]: 50,
    [AI_METRICS.AGENT_MESSAGES]: 300,
    [AI_METRICS.AGENT_TOKENS]: 1_500_000,
    [AI_METRICS.IMAGE_EDITS]: 10,
    [AI_METRICS.MARKET_ANALYSES]: 10,
    [AI_METRICS.MARKET_TOKENS]: 250_000,
  },
  starter: {
    [AI_METRICS.VISION]: 300,
    [AI_METRICS.AGENT_MESSAGES]: 2_000,
    [AI_METRICS.AGENT_TOKENS]: 10_000_000,
    [AI_METRICS.IMAGE_EDITS]: 100,
    [AI_METRICS.MARKET_ANALYSES]: 50,
    [AI_METRICS.MARKET_TOKENS]: 1_250_000,
  },
  pro: {
    [AI_METRICS.VISION]: 1_500,
    [AI_METRICS.AGENT_MESSAGES]: 10_000,
    [AI_METRICS.AGENT_TOKENS]: 50_000_000,
    [AI_METRICS.IMAGE_EDITS]: 500,
    [AI_METRICS.MARKET_ANALYSES]: 250,
    [AI_METRICS.MARKET_TOKENS]: 6_250_000,
  },
  enterprise: {
    [AI_METRICS.VISION]: UNLIMITED,
    [AI_METRICS.AGENT_MESSAGES]: UNLIMITED,
    [AI_METRICS.AGENT_TOKENS]: UNLIMITED,
    [AI_METRICS.IMAGE_EDITS]: UNLIMITED,
    [AI_METRICS.MARKET_ANALYSES]: UNLIMITED,
    [AI_METRICS.MARKET_TOKENS]: UNLIMITED,
  },
})

// Nombre de la variable de entorno por métrica. Se escribe a mano en vez de
// derivarlo con una regex para que un `grep AI_LIMIT_` en el repo encuentre
// todas las claves reales.
const METRIC_ENV_SUFFIX = Object.freeze({
  [AI_METRICS.VISION]: 'VISION',
  [AI_METRICS.AGENT_MESSAGES]: 'AGENT_MESSAGES',
  [AI_METRICS.AGENT_TOKENS]: 'AGENT_TOKENS',
  [AI_METRICS.IMAGE_EDITS]: 'IMAGE_EDITS',
  [AI_METRICS.MARKET_ANALYSES]: 'MARKET_ANALYSES',
  [AI_METRICS.MARKET_TOKENS]: 'MARKET_TOKENS',
})

// Variables que ya existían en producción para la cuota de visión. Si el
// deploy actual las tiene seteadas, mandan ellas: este refactor no debe
// cambiarle los límites a nadie sin que se entere.
const LEGACY_VISION_ENV = Object.freeze({
  free: 'AI_MONTHLY_LIMIT_FREE',
  starter: 'AI_MONTHLY_LIMIT_STARTER',
  pro: 'AI_MONTHLY_LIMIT_PRO',
  enterprise: 'AI_MONTHLY_LIMIT_ENTERPRISE',
})

export const normalizePlan = plan => {
  const value = clean(plan).toLowerCase()
  return AI_PLANS.includes(value) ? value : 'free'
}

export const normalizeMetric = metric => {
  const value = clean(metric)
  return AI_METRIC_LIST.includes(value) ? value : null
}

const readEnvLimit = name => {
  const raw = clean(process.env[name])
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null

  return Math.floor(parsed)
}


/**
 * Tope mensual de una métrica para un plan. 0 = ilimitado.
 */
export const getPlanLimit = (plan, metric) => {
  const normalizedPlan = normalizePlan(plan)
  const normalizedMetric = normalizeMetric(metric)

  if (!normalizedMetric) return UNLIMITED

  const envLimit = readEnvLimit(
    `AI_LIMIT_${normalizedPlan.toUpperCase()}_${METRIC_ENV_SUFFIX[normalizedMetric]}`,
  )
  if (envLimit !== null) return envLimit

  if (normalizedMetric === AI_METRICS.VISION) {
    const legacyLimit = readEnvLimit(LEGACY_VISION_ENV[normalizedPlan])
    if (legacyLimit !== null) return legacyLimit
  }

  return DEFAULT_PLAN_LIMITS[normalizedPlan][normalizedMetric]
}

/**
 * Todos los topes de un plan de una sola vez (para el snapshot del admin).
 */
export const getPlanLimits = plan => {
  const normalizedPlan = normalizePlan(plan)

  return AI_METRIC_LIST.reduce((limits, metric) => {
    limits[metric] = getPlanLimit(normalizedPlan, metric)
    return limits
  }, {})
}

/**
 * Si el tenant trae su propia API key (BYOK), los topes de la plataforma
 * dejan de tener sentido: el gasto lo paga él directamente contra Google.
 * Igual seguimos contando el consumo, porque sin ese número no hay forma de
 * responder "¿por qué está lento?" ni de dimensionar un plan.
 */
export const isByokAllowedForPlan = plan => {
  const normalizedPlan = normalizePlan(plan)
  const raw = clean(process.env.AI_BYOK_ALLOWED_PLANS)

  if (!raw) return normalizedPlan === 'pro' || normalizedPlan === 'enterprise'

  return raw
    .split(',')
    .map(value => clean(value).toLowerCase())
    .filter(Boolean)
    .includes(normalizedPlan)
}

// ─── Suscripción ─────────────────────────────────────────

const SUBSCRIPTION_BLOCKED = Object.freeze(new Set(['cancelled', 'expired']))
const SUBSCRIPTION_GRACE = Object.freeze(new Set(['past_due']))

// Number('') es 0, no NaN: leer una variable de entorno sin definir con
// Number(clean(...)) devuelve 0 silenciosamente, y ese 0 se interpretaba como
// "cero días de gracia" y "tarifa cero". Por eso el valor vacío se descarta
// antes de convertir.
const readEnvNumber = (name, { min = 0 } = {}) => {
  const raw = clean(process.env[name])
  if (!raw) return null

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < min) return null

  return parsed
}

const getGraceDays = () => readEnvNumber('AI_SUBSCRIPTION_GRACE_DAYS') ?? 7

/**
 * El corte por suscripción viene APAGADO por defecto, y no es una omisión.
 *
 * El alta (userCtrl) crea el tenant con subscriptionStatus 'trialing' y
 * trialEndsAt a 14 días, y no hay un solo lugar en el backend que después lo
 * pase a 'active' — no existe todavía un flujo de facturación. Con el corte
 * activado por defecto, todo comercio que se registre pierde la IA a los 14
 * días sin forma de recuperarla salvo editando la base a mano.
 *
 * Una regla que nada puede satisfacer no es una regla, es una trampa. La
 * maquinaria queda escrita y probada; se enciende con
 * AI_ENFORCE_SUBSCRIPTION=true el día que exista cobranza que mantenga el
 * campo.
 */
const isEnforcementEnabled = () => {
  const raw = clean(process.env.AI_ENFORCE_SUBSCRIPTION).toLowerCase()
  if (!raw) return false
  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(raw)
}

const daysSince = date => {
  const time = new Date(date).getTime()
  if (!Number.isFinite(time)) return null
  return (Date.now() - time) / (24 * 60 * 60 * 1000)
}

/**
 * ¿Este comercio tiene derecho a gastar IA de la plataforma hoy?
 *
 * Importante: solo corta IA. La tienda, el checkout y el panel siguen
 * funcionando — cortarle las ventas a un cliente por una tarjeta rechazada
 * es una forma cara de perderlo.
 *
 * `trialEndsAt` nulo se trata como "sin vencimiento". Hoy en producción todos
 * los tenants están en 'trialing' con esa fecha vacía porque nunca se
 * mantuvo el campo, así que activar esto no le corta el servicio a nadie
 * hasta que exista un flujo de facturación real que la escriba.
 */
export const getSubscriptionState = (tenant = {}) => {
  const status = clean(tenant?.subscriptionStatus) || 'trialing'
  const plan = normalizePlan(tenant?.plan)

  if (!isEnforcementEnabled()) {
    return { entitled: true, status, plan, reason: 'enforcement_disabled' }
  }

  if (SUBSCRIPTION_BLOCKED.has(status)) {
    return { entitled: false, status, plan, reason: `subscription_${status}` }
  }

  if (SUBSCRIPTION_GRACE.has(status)) {
    const overdueDays = daysSince(tenant?.subscriptionPastDueAt || tenant?.updatedAt)
    const graceDays = getGraceDays()

    if (overdueDays !== null && overdueDays > graceDays) {
      return {
        entitled: false,
        status,
        plan,
        reason: 'subscription_past_due_grace_expired',
        graceDays,
      }
    }

    return { entitled: true, status, plan, reason: 'subscription_grace', graceDays }
  }

  if (status === 'trialing' && tenant?.trialEndsAt) {
    const expiredDays = daysSince(tenant.trialEndsAt)

    if (expiredDays !== null && expiredDays > 0) {
      return { entitled: false, status, plan, reason: 'trial_expired' }
    }
  }

  return { entitled: true, status, plan, reason: 'ok' }
}

// ─── Costo estimado ──────────────────────────────────────

// estimateCostUsd vivía acá: una tarifa mezclada única (AI_COST_USD_PER_1M_TOKENS,
// 1,3 por defecto) para convertir tokens a dólares. La reemplazó
// services/ai/aiModelPricing.js, que cobra por modelo, separa entrada de salida
// —la salida cuesta 5x— y fecha las tarifas para que la duplicación anunciada
// del 1/1/2027 no repricee la historia.
//
// Se borra en vez de dejarla deprecada porque quedó sin un solo llamador y
// porque dos funciones de costeo que dan números distintos por los mismos
// tokens no conviven: la que sobra se usa por accidente y nadie nota la
// diferencia, que es exactamente el problema que el catálogo vino a resolver.
// AI_COST_USD_PER_1M_TOKENS ya no se lee en ningún lado.

/**
 * Costo aproximado en USD de N generaciones de imagen (Replicate/HuggingFace,
 * ver imageAiService.js::generateVariation). El default ($0.02/imagen) es una
 * estimación conservadora sobre el costo típico documentado de Replicate
 * (flux-schnell + el fallback ocasional de quitar fondo) — no una factura
 * real. Mismo criterio que estimateCostUsd: sirve para el panel, no para
 * cobrarle a nadie; el env var permite corregirlo con datos reales de
 * facturación el día que existan.
 */
export const estimateImageCostUsd = count => {
  const amount = Number(count)
  if (!Number.isFinite(amount) || amount <= 0) return 0

  const rate = readEnvNumber('AI_COST_USD_PER_IMAGE_EDIT') ?? 0.02

  return amount * rate
}

// ─── Precio de plan ──────────────────────────────────────

// starter: decisión de negocio del usuario — $40.000 ARS/mes, convertido a
// USD porque todo este motor de margen ya opera en USD (evita un refactor
// de moneda para un solo número). Conversión al dólar oficial VENTA, Banco
// Nación, cierre del 24/08/2026 ($1.530 ARS/USD — El Cronista/La Nación/
// Infobae, mismo tipo de cambio usado en admin/src/pages/SubscriptionPage.js
// para no tener dos referencias distintas): 40000 / 1530 ≈ 26.14.
// PLAN_PRICE_USD_STARTER sobrescribe esto el día que haga falta ajustar por
// inflación/tipo de cambio sin tocar código.
// pro/$99 sigue siendo el placeholder visual de SubscriptionPage.js — no
// hubo una decisión de negocio para ese plan todavía.
// `enterprise` es precio a medida: null a propósito, no 0 — un 0 numérico
// se leería como margen falso en cualquier reporte que lo use.
const DEFAULT_PLAN_PRICE_USD = Object.freeze({
  free: 0,
  starter: 26.14,
  pro: 99,
  enterprise: null,
})

/**
 * Precio nominal mensual del plan, en USD. `null` significa precio a medida
 * (no hay un número fijo que asumir) — distinguirlo de 0 importa para
 * cualquier cálculo de margen que use este valor.
 *
 * Se puede sobrescribir por entorno sin tocar código:
 *   PLAN_PRICE_USD_STARTER=35
 */
export const getPlanMonthlyPriceUsd = plan => {
  const normalizedPlan = normalizePlan(plan)
  const envPrice = readEnvNumber(`PLAN_PRICE_USD_${normalizedPlan.toUpperCase()}`)
  if (envPrice !== null) return envPrice
  return DEFAULT_PLAN_PRICE_USD[normalizedPlan]
}

// ─── Costos operativos de HENKO (Bloque 8.10) ────────────
//
// A diferencia de la primera versión de esto (que quedaba en 0 porque no
// había números reales a mano), estos defaults salen de una búsqueda de
// precios públicos de los proveedores que HENKO ya usa (Render, MongoDB
// Atlas, Cloudinary, SendGrid, Meta WhatsApp) — NO son la factura real de
// HENKO, que puede diferir por el plan/tier contratado, volumen o
// descuentos. Igual que estimateCostUsd/estimateImageCostUsd más arriba: una
// estimación razonable y documentada, sobrescribible por variable de entorno
// en cuanto haya una factura real para comparar.

// Render Standard (backend con workers en background, no puede dormir como
// el free/starter tier): ~$25/mes. + MongoDB Atlas M10 dedicado: ~$57/mes
// por nodo listado — un replica set de producción real son 3 nodos, así que
// la factura real de Atlas puede ser bastante mayor a este número; se deja
// el precio de un solo nodo (el dato público más citado) en vez de estimar
// un multiplicador que no se puede confirmar sin la factura real.
// Total infra: 25 + 57 = 82.
export const getPlatformMonthlyInfraCostUsd = () =>
  Math.max(0, readEnvNumber('PLATFORM_INFRA_MONTHLY_COST_USD') ?? 82)

// Cloudinary Plus (storage/transformaciones de imágenes de producto de
// todos los comercios, plan mensual sin compromiso anual): $89/mes.
export const getPlatformMonthlyStorageCostUsd = () =>
  Math.max(0, readEnvNumber('PLATFORM_STORAGE_MONTHLY_COST_USD') ?? 89)

/**
 * A diferencia de infra/storage (costos fijos de la plataforma, no
 * atribuibles a un comercio puntual sin inventar un criterio de reparto), el
 * envío de emails/WhatsApp sí tiene volumen real y medible por comercio
 * (Order.emailSent, AiCartRecovery por canal) — ver platformMarginService.js.
 * Acá solo la tarifa por envío.
 */

// SendGrid Essentials: $19.95/mes por 50.000 emails incluidos →
// 19.95 / 50000 ≈ $0.0004 por envío (costo promedio dentro del plan, no la
// tarifa de excedente que solo aplica pasado ese volumen).
export const getEmailCostPerSendUsd = () =>
  Math.max(0, readEnvNumber('EMAIL_COST_USD_PER_SEND') ?? 0.0004)

// Meta WhatsApp Business API, tarifa Argentina, categoría "marketing"
// (la que aplica a recuperación de carrito / reactivación — no son mensajes
// transaccionales de una orden existente): $0.0618 por conversación, más un
// margen típico de BSP de $0.003–$0.010 (se toma el punto medio, ~$0.005) →
// ~$0.067 por envío.
export const getWhatsappCostPerSendUsd = () =>
  Math.max(0, readEnvNumber('WHATSAPP_COST_USD_PER_SEND') ?? 0.067)

/**
 * Tope global de tokens de la plataforma para el mes, contra la key propia.
 * Es el disyuntor: aunque la suma de las cuotas por tenant se dispare (por
 * un plan mal cargado, un bug o un tenant enterprise), la factura tiene un
 * techo duro que no depende de que ninguna otra cuenta esté bien puesta.
 *
 * 0 = sin disyuntor (no recomendado en producción).
 */
export const getPlatformMonthlyTokenBudget = () => {
  // El override del panel gana sobre la variable de entorno. La variable no
  // deja de ser la configuración base —es lo que vale mientras nadie tocó
  // nada— pero cambiarla exige reiniciar el servicio, y el momento en que este
  // número importa de verdad es cuando el disyuntor ya cortó y hay que moverlo
  // sin esperar un deploy.
  //
  // Para que esto no se vuelva un misterio, la pantalla muestra las dos cosas:
  // el valor vigente y de dónde salió.
  const override = getPlatformAiOverride(PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET)

  if (override !== null && Number.isFinite(override)) {
    return Math.floor(override)
  }

  const budget = readEnvNumber('AI_PLATFORM_MONTHLY_TOKEN_BUDGET')
  return budget === null ? UNLIMITED : Math.floor(budget)
}

/** De dónde sale el techo vigente. Solo para mostrarlo, no para decidir. */
export const getPlatformBudgetSource = () => {
  const override = getPlatformAiOverride(PLATFORM_AI_SETTINGS.MONTHLY_TOKEN_BUDGET)

  if (override !== null && Number.isFinite(override)) return 'panel'
  return readEnvNumber('AI_PLATFORM_MONTHLY_TOKEN_BUDGET') === null ? 'none' : 'env'
}

/**
 * Cuántos caracteres del mensaje entrante llegan al modelo.
 *
 * La salida de una llamada está acotada en varios lugares —8192 tokens como
 * techo duro en aiAgentLLMService— y el prompt de sistema tiene su propio
 * límite. La ENTRADA que manda el cliente no tenía ninguno: el body admite
 * 1 MB en producción, o sea unos 250.000 tokens en un solo mensaje. A tarifa de
 * entrada eso son ~USD 0,19 por mensaje, y le vacía la cuota mensual a un
 * comercio free en seis.
 *
 * Se recorta en vez de rechazar: el visitante escribió algo y merece una
 * respuesta aunque haya pegado media página. Rechazar convertiría un tope de
 * costo en una falla visible para alguien que no hizo nada malo.
 *
 * 2.000 caracteres es holgado para un mensaje de chat — nadie legítimo se
 * acerca — así que el tope es invisible en el uso real.
 */
export const getMaxInboundMessageChars = () =>
  Math.min(Math.max(readEnvNumber('AI_AGENT_MAX_INBOUND_CHARS') ?? 2000, 200), 20000)

/**
 * Tokens que consume un análisis de visión.
 *
 * MEDICIÓN (agosto 2026, gemini-3.6-flash): ~3.900 tokens de entrada más la
 * imagen contra ~1.000 de salida. Se usa solo para convertir el techo del
 * presupuesto —que está en tokens— a la unidad en que se mide visión, que son
 * análisis. No interviene en ningún costo: el costo de visión se calcula con
 * el usageMetadata real que devuelve Gemini.
 *
 * El promedio se va a mover cuando cambie el prompt. Desde que existe el
 * ledger ese número se puede MEDIR en vez de estimar: el promedio de
 * totalTokens de las filas de visión del período lo dice. Cuando el panel de
 * costos exista, conviene contrastarlo y ajustar por entorno.
 */
const getVisionTokensPerCall = () =>
  Math.max(1, readEnvNumber('AI_VISION_TOKENS_PER_CALL') ?? 4900)

/**
 * Techo por tenant sobre la key COMPARTIDA de la plataforma.
 *
 * "Ilimitado" es una entitlement coherente cuando el comercio paga su propio
 * consumo (BYOK), y una contradicción cuando corre sobre la key de todos: un
 * único tenant enterprise sin key propia podía consumir el presupuesto
 * mensual entero y hacer saltar el disyuntor, que corta para TODOS los que
 * comparten esa key. El tenant grande no pierde nada y los chicos se quedan
 * sin asistente.
 *
 * La regla es una sola y sale de un número que ya existe: nadie sobre la key
 * compartida puede pasarse de una fracción del presupuesto de la plataforma.
 * Con el disyuntor apagado no hay fracción que calcular y no se aplica.
 *
 * Solo toca las métricas que traducen a dinero contra el presupuesto de la
 * plataforma: los tokens, y visión, que se mide en unidades pero gasta tokens
 * igual. Los topes finitos de un plan no se tocan — son deliberados; esto
 * aplica únicamente donde el plan dice "ilimitado".
 *
 * Lo que queda deliberadamente afuera: las ediciones de imagen se pagan por
 * imagen a otro proveedor y no consumen tokens, así que derivarles un techo de
 * un presupuesto medido en tokens no significaría nada. Su freno son las
 * cuotas por plan.
 */
export const getSharedKeyTenantCap = metric => {
  const normalizedMetric = normalizeMetric(metric)

  // La guarda vieja comparaba solo contra AGENT_TOKENS y quedó viva debajo de
  // la nueva cuando se agregó MARKET_TOKENS: el array declaraba las dos
  // métricas y la línea siguiente dejaba pasar de largo a la segunda, así que
  // el análisis de mercado no tenía techo por tenant sobre la key compartida.
  const TOKEN_METRICS = [AI_METRICS.AGENT_TOKENS, AI_METRICS.MARKET_TOKENS]
  const isTokenMetric = TOKEN_METRICS.includes(normalizedMetric)
  const isVision = normalizedMetric === AI_METRICS.VISION

  if (!isTokenMetric && !isVision) return UNLIMITED

  const budget = getPlatformMonthlyTokenBudget()
  if (budget === UNLIMITED) return UNLIMITED

  const shareOverride = getPlatformAiOverride(PLATFORM_AI_SETTINGS.PER_TENANT_SHARE)
  const rawShare =
    shareOverride !== null && Number.isFinite(shareOverride)
      ? shareOverride
      : readEnvNumber('AI_PLATFORM_PER_TENANT_SHARE') ?? 0.5
  const share = Math.min(Math.max(rawShare, 0.01), 1)
  const tokenCap = Math.floor(budget * share)

  if (isTokenMetric) return tokenCap

  // Visión se mide en unidades, no en tokens, y por eso quedaba fuera de esta
  // regla: era el ÚNICO gasto sin techo por tenant sobre la key compartida. Un
  // enterprise sin key propia tiene visión ilimitada, y desde que visión
  // reporta sus tokens (ver recordTokenSpend) esos tokens pegan contra el
  // disyuntor — o sea que un solo comercio podía llevarse el presupuesto
  // entero y dejar sin IA a todos los demás.
  //
  // No hace falta una regla nueva: alcanza con expresar la misma fracción en
  // la unidad que esta métrica usa, convirtiéndola por lo que cuesta un
  // análisis.
  return Math.max(1, Math.floor(tokenCap / getVisionTokensPerCall()))
}

export default {
  AI_METRICS,
  AI_METRIC_LIST,
  AI_METRIC_LABELS,
  AI_PLANS,
  UNLIMITED,
  normalizePlan,
  normalizeMetric,
  getPlanLimit,
  getPlanLimits,
  isByokAllowedForPlan,
  getSubscriptionState,
  estimateImageCostUsd,
  getPlanMonthlyPriceUsd,
  getPlatformMonthlyTokenBudget,
  getSharedKeyTenantCap,
  getPlatformMonthlyInfraCostUsd,
  getPlatformMonthlyStorageCostUsd,
  getEmailCostPerSendUsd,
  getWhatsappCostPerSendUsd,
}
