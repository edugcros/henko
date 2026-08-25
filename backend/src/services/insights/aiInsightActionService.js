// 📁 src/services/insights/aiInsightActionService.js
//
// Primer paso de "acción" del Bloque 8.8 (alcance acotado con el usuario):
// solo para insights customer_inactivity, solo mensaje de reactivación, y
// el admin SIEMPRE revisa/edita el texto antes de que salga — HENKO no
// manda nada sin ese clic de confirmación. Reusa toda la infraestructura de
// mensajería del Bloque 7 (presupuesto de IA, política de contacto, envío
// por email/WhatsApp) en vez de reinventarla.

import User from '../../models/userModel.js'
import Tenant from '../../models/tenantModel.js'
import AiAgent from '../../models/aiAgentModel.js'
import AiInsight from '../../models/aiInsightModel.js'
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

export default { generateReactivationMessage, sendReactivationMessage }
