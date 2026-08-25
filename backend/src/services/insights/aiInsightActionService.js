// 📁 src/services/insights/aiInsightActionService.js
//
// Acciones del Bloque 8.8 (alcance acotado con el usuario, escalado en
// niveles): reactivación de clientes (Nivel 1), refuerzo de recuperación de
// carritos (Nivel 2), reducción de precio en productos de bajo rendimiento
// (Nivel 3). En los tres casos HENKO arma la propuesta pero nunca la
// ejecuta sola — el admin siempre revisa/edita y confirma con un clic
// explícito antes de que cualquier cambio real se aplique.

import User from '../../models/userModel.js'
import Tenant from '../../models/tenantModel.js'
import AiAgent from '../../models/aiAgentModel.js'
import AiInsight from '../../models/aiInsightModel.js'
import AiCampaignRule from '../../models/aiCampaignRuleModel.js'
import Product from '../../models/productModel.js'
import {
  canContactCustomer,
  isWithinWhatsappCustomerWindow,
  registerCustomerContact,
} from '../aiAgent/aiContactPolicyService.js'
import { sendWhatsappTextMessage } from '../aiAgent/whatsappService.js'
import { sendReactivationEmail } from '../email/reactivationEmail.service.js'
import {
  AI_METRICS,
  recordAiConsumption,
  refundAiBudget,
  reserveAiBudget,
} from '../ai/aiBudgetService.js'
import { resolveTenantAiCredentials } from '../ai/aiCredentialsService.js'
import { generateReactivationMessageText } from './aiInsightMessageService.js'
import logger from '../../../config/logger.js'

const clean = value => String(value || '').trim()

const getUserName = user => {
  const explicit = clean(user?.name || user?.fullName)
  if (explicit) return explicit

  return clean(`${user?.firstname || ''} ${user?.lastname || ''}`)
}

// Misma resolución de dominio que aiCartRecoveryService.js::buildCheckoutUrl
// — copiada, no importada, porque esa función arma un link de /checkout con
// un recoveryId que no aplica acá.
const resolveTenantDomain = tenant => {
  const domains = Array.isArray(tenant?.domains) ? tenant.domains : []
  const primary = domains.find(domain => domain?.status === 'active' && domain?.isPrimary)
  const firstActive = domains.find(domain => domain?.status === 'active')
  const selected = primary || firstActive

  return clean(selected?.hostname || selected?.normalizedHostname || '')
}

const buildStoreUrl = tenant => {
  const domain = resolveTenantDomain(tenant)
  if (!domain) return ''

  const protocol = domain.includes('localhost') || domain.includes('.local') ? 'http' : 'https'
  return `${protocol}://${domain.replace(/\/+$/, '')}/`
}

const buildFallbackMessage = values => {
  const days = values.daysSinceLastOrder !== '' ? ` hace ${values.daysSinceLastOrder} días que no comprás` : ' hace un tiempo que no comprás'
  return `Hola ${values.customerName}, te extrañamos —${days}. Date una vuelta por la tienda: ${values.storeUrl}`
}

const buildValues = ({ user, tenant, insight }) => ({
  customerName: getUserName(user) || insight.entity?.label || 'Cliente',
  orderCount: insight.evidence?.orderCount ?? '',
  daysSinceLastOrder: insight.evidence?.daysSinceLastOrder ?? '',
  storeUrl: buildStoreUrl(tenant),
})

/**
 * Arma el texto del mensaje de reactivación. NO lo envía ni cambia el
 * estado del insight — el admin lo revisa/edita en el panel y recién
 * después llama a sendReactivationMessage.
 */
export const generateReactivationMessage = async ({ tenantId, insight }) => {
  if (insight?.type !== 'customer_inactivity') {
    const error = new Error('Esta acción solo aplica a insights de cliente inactivo')
    error.statusCode = 400
    throw error
  }

  const [user, tenant] = await Promise.all([
    User.findById(insight.entity?.id).setOptions({ tenantId }).lean(),
    Tenant.findById(tenantId).lean(),
  ])

  if (!user) {
    const error = new Error('Cliente no encontrado')
    error.statusCode = 404
    throw error
  }

  const values = buildValues({ user, tenant, insight })

  const reservation = await reserveAiBudget({
    tenantId,
    metric: AI_METRICS.AGENT_MESSAGES,
    guards: [AI_METRICS.AGENT_TOKENS],
  })

  if (!reservation.allowed) {
    return { message: buildFallbackMessage(values), aiGenerated: false }
  }

  try {
    const credentials = await resolveTenantAiCredentials(tenantId)
    const result = await generateReactivationMessageText({ values, apiKey: credentials.apiKey })

    if (result.tokensUsed > 0) {
      await recordAiConsumption({
        tenantId,
        metric: AI_METRICS.AGENT_TOKENS,
        amount: result.tokensUsed,
      })
    }

    return { message: result.message, aiGenerated: true }
  } catch (error) {
    await refundAiBudget({ tenantId, metric: AI_METRICS.AGENT_MESSAGES })
    logger.warn('⚠️ No se pudo generar el mensaje de reactivación con IA, se usa la plantilla', {
      tenantId: String(tenantId),
      message: error?.message,
      code: error?.code,
    })
    return { message: buildFallbackMessage(values), aiGenerated: false }
  }
}

/**
 * Envía el mensaje que el admin confirmó (puede venir editado respecto al
 * que generó generateReactivationMessage) y deja rastro de la acción en el
 * insight. Mismo gate de consentimiento/frecuencia que la recuperación de
 * carritos (canContactCustomer) — es el mismo tipo de contacto saliente no
 * solicitado, no hay motivo para relajarlo acá.
 */
export const sendReactivationMessage = async ({ tenantId, insightId, adminUserId, message }) => {
  const cleanMessage = clean(message)

  if (!cleanMessage) {
    const error = new Error('El mensaje no puede estar vacío')
    error.statusCode = 400
    throw error
  }

  const insight = await AiInsight.findOne({
    _id: insightId,
    tenantId,
    type: 'customer_inactivity',
    status: { $in: ['pending_review', 'measuring'] },
    // Ya se ejecutó una acción sobre este insight — no depender solo del
    // rate-limit de canContactCustomer para evitar un reenvío accidental.
    'action.actionType': null,
  }).setOptions({ tenantId })

  if (!insight) {
    const error = new Error('Insight no encontrado o ya no admite esta acción')
    error.statusCode = 404
    throw error
  }

  const [user, tenant, agent] = await Promise.all([
    User.findById(insight.entity?.id).setOptions({ tenantId }).lean(),
    Tenant.findById(tenantId).lean(),
    AiAgent.findOne({ tenantId, enabled: true })
      .select('+channels.whatsapp.accessToken')
      .setOptions({ tenantId }),
  ])

  if (!user) {
    const error = new Error('Cliente no encontrado')
    error.statusCode = 404
    throw error
  }

  const email = clean(user.email)
  const phone = clean(user.mobile)
  const whatsappReady = Boolean(
    agent?.channels?.whatsapp?.enabled &&
      clean(agent?.channels?.whatsapp?.phoneNumberId) &&
      clean(agent?.channels?.whatsapp?.accessToken),
  )

  // Solo WhatsApp DENTRO de la ventana de 24h puede llevar el texto libre
  // que el admin acaba de revisar/editar — fuera de esa ventana, Meta exige
  // una plantilla pre-aprobada con parámetros fijos, que no puede llevar
  // este texto (misma limitación estructural que el Bloque 7). Si no hay
  // ventana abierta, se prueba con email en vez de fallar directamente.
  let channel = null
  let destination = ''

  if (phone && whatsappReady) {
    const whatsappPolicy = await canContactCustomer({
      tenantId,
      channel: 'whatsapp',
      destination: phone,
      requireMarketingConsent: true,
    })

    if (whatsappPolicy.allowed && isWithinWhatsappCustomerWindow(whatsappPolicy.preference)) {
      channel = 'whatsapp'
      destination = phone
    }
  }

  let blockedReason = null

  if (!channel && email) {
    const emailPolicy = await canContactCustomer({
      tenantId,
      channel: 'email',
      destination: email,
      requireMarketingConsent: true,
    })

    if (emailPolicy.allowed) {
      channel = 'email'
      destination = email
    } else {
      blockedReason = emailPolicy.reason
    }
  }

  if (!channel) {
    const error = new Error(
      blockedReason
        ? `No se puede contactar a este cliente por email: ${blockedReason}`
        : 'No hay un canal disponible para contactar a este cliente (sin email, o WhatsApp fuera de la ventana de 24hs)',
    )
    error.statusCode = 409
    error.code = blockedReason || 'no_channel_available'
    throw error
  }

  if (channel === 'email') {
    await sendReactivationEmail({
      to: destination,
      tenantConfig: tenant,
      customerName: getUserName(user) || insight.entity?.label,
      storeUrl: buildStoreUrl(tenant),
      body: cleanMessage,
    })
  } else {
    await sendWhatsappTextMessage({
      phoneNumberId: agent.channels.whatsapp.phoneNumberId,
      accessToken: agent.channels.whatsapp.accessToken,
      to: destination,
      text: cleanMessage,
    })
  }

  const remeasureDays = Math.max(Number(process.env.AI_INSIGHT_REMEASURE_DAYS || 14), 1)
  const measureAfterDate = new Date(Date.now() + remeasureDays * 86400000)

  const updated = await AiInsight.findOneAndUpdate(
    { _id: insight._id, tenantId },
    {
      $set: {
        status: 'measuring',
        acknowledgedBy: insight.acknowledgedBy || adminUserId || null,
        acknowledgedAt: insight.acknowledgedAt || new Date(),
        'measurement.measureAfterDate': measureAfterDate,
        'action.actionType': 'reactivation_message',
        'action.channel': channel,
        'action.message': cleanMessage,
        'action.executedAt': new Date(),
        'action.executedBy': adminUserId || null,
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  await registerCustomerContact({ tenantId, channel, destination })

  logger.info('📨 Mensaje de reactivación enviado', {
    tenantId: String(tenantId),
    insightId: String(insight._id),
    channel,
  })

  return updated
}

// ─── cart_recovery_underperformance: reforzar recuperación (8.8 Nivel 2) ──
//
// A diferencia de la reactivación (que manda un mensaje), acá no hay texto
// que revisar: la "propuesta" es un cambio concreto de configuración sobre
// las reglas de recuperación de carrito (AiCampaignRule tipo abandoned_cart)
// que YA existen — activa/ajusta la estrategia existente, no crea una nueva.
// El admin ve el antes/después de cada regla antes de aprobar (mismo
// principio de revisar-antes-de-ejecutar que reactivación, adaptado a un
// cambio de config en vez de un mensaje).

// Tope ya impuesto por el propio schema (trigger.maxAttempts max:5) — se
// referencia acá para no proponer un valor que Mongoose va a rechazar.
const REINFORCEMENT_MAX_ATTEMPTS_CAP = 5
// Baja el piso de carrito elegible un 30% — más carritos entran a la
// estrategia de recuperación. No se toca si ya está en 0 (sin piso).
const REINFORCEMENT_MIN_CART_REDUCTION_RATIO = 0.3

const buildReinforcementPlan = rule => {
  const currentMaxAttempts = rule.trigger?.maxAttempts ?? 2
  const currentMinCartAmountCents = rule.trigger?.minCartAmountCents ?? 0
  const currentAiPersonalization = rule.useAiPersonalization !== false

  const nextMaxAttempts = Math.min(currentMaxAttempts + 1, REINFORCEMENT_MAX_ATTEMPTS_CAP)
  const nextMinCartAmountCents =
    currentMinCartAmountCents > 0
      ? Math.round(currentMinCartAmountCents * (1 - REINFORCEMENT_MIN_CART_REDUCTION_RATIO))
      : currentMinCartAmountCents
  const nextAiPersonalization = true

  const changed =
    nextMaxAttempts !== currentMaxAttempts ||
    nextMinCartAmountCents !== currentMinCartAmountCents ||
    nextAiPersonalization !== currentAiPersonalization

  return {
    ruleId: String(rule._id),
    channel: rule.channel,
    changed,
    before: {
      maxAttempts: currentMaxAttempts,
      minCartAmountCents: currentMinCartAmountCents,
      useAiPersonalization: currentAiPersonalization,
    },
    after: {
      maxAttempts: nextMaxAttempts,
      minCartAmountCents: nextMinCartAmountCents,
      useAiPersonalization: nextAiPersonalization,
    },
  }
}

const loadAbandonedCartRules = tenantId =>
  AiCampaignRule.find({ tenantId, type: 'abandoned_cart', enabled: true }).setOptions({ tenantId })

/**
 * Arma el plan de refuerzo (antes/después por regla) SIN escribir nada — el
 * admin lo revisa antes de aprobar.
 */
export const previewCartRecoveryReinforcement = async ({ tenantId, insight }) => {
  if (insight?.type !== 'cart_recovery_underperformance') {
    const error = new Error('Esta acción solo aplica a insights de recuperación de carrito con baja conversión')
    error.statusCode = 400
    throw error
  }

  const rules = await loadAbandonedCartRules(tenantId)

  if (!rules.length) {
    const error = new Error('No hay reglas de recuperación de carrito activas para reforzar')
    error.statusCode = 409
    throw error
  }

  const plans = rules.map(buildReinforcementPlan)

  return { plans, hasChanges: plans.some(plan => plan.changed) }
}

/**
 * Aplica el plan de refuerzo sobre las reglas reales y deja rastro en el
 * insight — mismo guard de "una sola acción por insight" que reactivación.
 */
export const applyCartRecoveryReinforcement = async ({ tenantId, insightId, adminUserId }) => {
  const insight = await AiInsight.findOne({
    _id: insightId,
    tenantId,
    type: 'cart_recovery_underperformance',
    status: { $in: ['pending_review', 'measuring'] },
    'action.actionType': null,
  }).setOptions({ tenantId })

  if (!insight) {
    const error = new Error('Insight no encontrado o ya no admite esta acción')
    error.statusCode = 404
    throw error
  }

  const rules = await loadAbandonedCartRules(tenantId)

  if (!rules.length) {
    const error = new Error('No hay reglas de recuperación de carrito activas para reforzar')
    error.statusCode = 409
    throw error
  }

  const plans = rules.map(buildReinforcementPlan).filter(plan => plan.changed)

  if (!plans.length) {
    const error = new Error('La configuración de recuperación ya está al máximo — no hay nada para reforzar')
    error.statusCode = 409
    throw error
  }

  await Promise.all(
    plans.map(plan =>
      AiCampaignRule.updateOne(
        { _id: plan.ruleId, tenantId },
        {
          $set: {
            'trigger.maxAttempts': plan.after.maxAttempts,
            'trigger.minCartAmountCents': plan.after.minCartAmountCents,
            useAiPersonalization: plan.after.useAiPersonalization,
          },
        },
      ).setOptions({ tenantId }),
    ),
  )

  const remeasureDays = Math.max(Number(process.env.AI_INSIGHT_REMEASURE_DAYS || 14), 1)
  const measureAfterDate = new Date(Date.now() + remeasureDays * 86400000)

  const updated = await AiInsight.findOneAndUpdate(
    { _id: insight._id, tenantId },
    {
      $set: {
        status: 'measuring',
        acknowledgedBy: insight.acknowledgedBy || adminUserId || null,
        acknowledgedAt: insight.acknowledgedAt || new Date(),
        'measurement.measureAfterDate': measureAfterDate,
        'action.actionType': 'cart_recovery_reinforcement',
        'action.detail': { rulesUpdated: plans },
        'action.executedAt': new Date(),
        'action.executedBy': adminUserId || null,
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  logger.info('🚀 Recuperación de carritos reforzada', {
    tenantId: String(tenantId),
    insightId: String(insight._id),
    rulesUpdated: plans.length,
  })

  return updated
}

// ─── product_underperformance: reducir precio (8.8 Nivel 3) ──────────────
//
// Mucho tráfico, poca conversión — la propuesta es bajar el precio un %
// configurable. El admin ve el precio actual y el sugerido, puede editar
// el precio final antes de confirmar (mismo principio que el mensaje de
// reactivación), y recién ahí se aplica. Si el producto tiene costoUnitario
// cargado (Bloque 8.5), la reducción nunca lo lleva por debajo del costo
// real — no se sugiere vender a pérdida.

const round2Money = value => Math.round(value * 100) / 100

const getPriceReductionPct = () =>
  Math.min(Math.max(Number(process.env.AI_INSIGHT_PRICE_REDUCTION_PCT || 5), 1), 50) / 100

const buildPriceReductionPlan = product => {
  const currentPrice = Number(product.price || 0)
  const reductionPct = getPriceReductionPct()
  const rawSuggested = currentPrice * (1 - reductionPct)

  const costFloor =
    product.costoUnitario !== null && product.costoUnitario !== undefined
      ? Number(product.costoUnitario)
      : null

  const cappedByCost = costFloor !== null && rawSuggested < costFloor
  const suggestedPrice = round2Money(cappedByCost ? costFloor : rawSuggested)

  return {
    currentPrice,
    suggestedPrice,
    reductionPct: round2Money(reductionPct * 100),
    costFloor,
    cappedByCost,
    hasVariants: Boolean(product.hasVariants),
    variantCount: Array.isArray(product.variants) ? product.variants.length : 0,
  }
}

export const previewPriceReduction = async ({ tenantId, insight }) => {
  if (insight?.type !== 'product_underperformance') {
    const error = new Error('Esta acción solo aplica a insights de producto con bajo rendimiento')
    error.statusCode = 400
    throw error
  }

  const product = await Product.findOne({ _id: insight.entity?.id, tenantId })
    .select('price costoUnitario hasVariants variants')
    .setOptions({ tenantId })
    .lean()

  if (!product) {
    const error = new Error('Producto no encontrado')
    error.statusCode = 404
    throw error
  }

  return buildPriceReductionPlan(product)
}

export const applyPriceReduction = async ({ tenantId, insightId, adminUserId, newPrice }) => {
  const requestedPrice = round2Money(Number(newPrice))

  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
    const error = new Error('El precio no puede estar vacío ni ser 0')
    error.statusCode = 400
    throw error
  }

  const insight = await AiInsight.findOne({
    _id: insightId,
    tenantId,
    type: 'product_underperformance',
    status: { $in: ['pending_review', 'measuring'] },
    'action.actionType': null,
  }).setOptions({ tenantId })

  if (!insight) {
    const error = new Error('Insight no encontrado o ya no admite esta acción')
    error.statusCode = 404
    throw error
  }

  const product = await Product.findOne({ _id: insight.entity?.id, tenantId }).setOptions({ tenantId })

  if (!product) {
    const error = new Error('Producto no encontrado')
    error.statusCode = 404
    throw error
  }

  const previousPrice = Number(product.price || 0)

  if (requestedPrice >= previousPrice) {
    const error = new Error('El precio nuevo debe ser menor al precio actual')
    error.statusCode = 400
    throw error
  }

  // No vender a pérdida si hay un costo real cargado — mismo guard que el
  // preview, revalidado acá por si el admin editó el precio a mano después
  // de ver la sugerencia.
  if (
    product.costoUnitario !== null &&
    product.costoUnitario !== undefined &&
    requestedPrice < product.costoUnitario
  ) {
    const error = new Error(
      `El precio propuesto ($${requestedPrice}) queda por debajo del costo cargado ($${product.costoUnitario}) — ajustalo antes de confirmar`,
    )
    error.statusCode = 409
    throw error
  }

  const ratio = requestedPrice / previousPrice
  let variantsUpdated = 0

  product.price = requestedPrice

  if (product.hasVariants && Array.isArray(product.variants)) {
    for (const variant of product.variants) {
      if (variant.isActive === false) continue
      variant.price = round2Money(Number(variant.price || 0) * ratio)
      variantsUpdated += 1
    }
  }

  await product.save()

  const remeasureDays = Math.max(Number(process.env.AI_INSIGHT_REMEASURE_DAYS || 14), 1)
  const measureAfterDate = new Date(Date.now() + remeasureDays * 86400000)

  const updated = await AiInsight.findOneAndUpdate(
    { _id: insight._id, tenantId },
    {
      $set: {
        status: 'measuring',
        acknowledgedBy: insight.acknowledgedBy || adminUserId || null,
        acknowledgedAt: insight.acknowledgedAt || new Date(),
        'measurement.measureAfterDate': measureAfterDate,
        'action.actionType': 'price_reduction',
        'action.detail': {
          previousPrice,
          newPrice: product.price,
          variantsUpdated,
        },
        'action.executedAt': new Date(),
        'action.executedBy': adminUserId || null,
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  logger.info('💲 Precio reducido por recomendación de HENKO', {
    tenantId: String(tenantId),
    insightId: String(insight._id),
    productId: String(product._id),
    previousPrice,
    newPrice: product.price,
  })

  return updated
}

export default {
  generateReactivationMessage,
  sendReactivationMessage,
  previewCartRecoveryReinforcement,
  applyCartRecoveryReinforcement,
  previewPriceReduction,
  applyPriceReduction,
}
