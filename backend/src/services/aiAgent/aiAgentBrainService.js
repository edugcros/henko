// 📁 src/services/aiAgent/aiAgentBrainService.js
import AiConversation from '../../models/aiConversationModel.js'
import AiContactPreference from '../../models/aiContactPreferenceModel.js'
import AiAgent from '../../models/aiAgentModel.js'
import logger from '../../../config/logger.js'
import { buildAgentSystemPrompt } from './aiAgentPromptService.js'
import { callAgentLLM } from './aiAgentLLMService.js'
import { searchRelevantKnowledgeForAgent } from './aiAgentToolService.js'
import { runAgentCommerceTools } from './aiAgentToolsV2Service.js'
import { registerConversationLearningSignal } from './aiAgentLearningService.js'
import { getOrCreateAiAgentForTenant } from './aiAgentProvisioningService.js'
import { registerCustomerInboundMessage } from './aiContactPolicyService.js'
import { validateAgentCommerceResponse } from './aiAgentResponseValidatorService.js'
import { extractLeadPreferences } from './aiLeadProfileService.js'
import {
  buildActionAwareReplySuffix,
  buildAgentActions,
} from './aiAgentActionService.js'
import {
  detectLeadIntentFromText,
  upsertLeadFromConversation,
} from './aiLeadCommercialService.js'

const clean = value => String(value || '').trim()
const ALLOWED_CHANNELS = new Set(['webchat', 'whatsapp', 'admin_test', 'unknown'])

const normalizeChannel = value => {
  const channel = clean(value).toLowerCase()
  return ALLOWED_CHANNELS.has(channel) ? channel : 'unknown'
}

const MAX_STORED_MESSAGES = Math.min(
  Math.max(Number(process.env.AI_AGENT_MAX_STORED_MESSAGES || 200), 20),
  1000,
)

const isOptOutMessage = text => {
  return /\b(stop|baja|cancelar|no me escribas|no quiero recibir|desuscribir|unsubscribe)\b/i.test(
    clean(text),
  )
}

const normalizeText = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const includesConfiguredKeyword = (text, keywords = []) => {
  const normalized = normalizeText(text)
  return keywords.some(keyword => {
    const cleanKeyword = normalizeText(keyword)
    return cleanKeyword && normalized.includes(cleanKeyword)
  })
}

const requiresHumanByPolicy = ({ text, agent }) => {
  const normalized = normalizeText(text)
  const behavior = agent?.behavior || {}

  if (
    includesConfiguredKeyword(
      normalized,
      agent?.guardrails?.humanHandoffKeywords || [],
    )
  ) {
    return true
  }

  if (
    behavior.requireHumanForPayments !== false &&
    /contracargo|chargeback|fraude|desconozco el pago|pago rechazado|error de pago|datos de tarjeta|n[uú]mero de tarjeta|comprobante de transferencia|transferencia realizada/.test(
      normalized,
    )
  ) {
    return true
  }

  return (
    behavior.requireHumanForClaims !== false &&
    /reclamo|devolucion|reembolso|fraude|estafa|denuncia/.test(normalized)
  )
}

const isBlockedTopic = ({ text, agent }) => {
  return includesConfiguredKeyword(
    text,
    agent?.guardrails?.blockedTopics || [],
  )
}

const extractCustomerDataFromText = text => {
  const raw = clean(text)
  const normalized = normalizeText(raw)

  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)

  const phoneMatch = raw.match(
    /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/,
  )

  const nameMatch = normalized.match(
    /\b(?:soy|me llamo|mi nombre es|mi nombre|nombre)\s+([a-zñ]+(?:\s+[a-zñ]+){0,3})/i,
  )

  return {
    name: clean(nameMatch?.[1] || ''),
    email: clean(emailMatch?.[0] || '').toLowerCase(),
    phone: clean(phoneMatch?.[0] || '').replace(/[^\d+]/g, ''),
  }
}

const resolveCustomerData = ({
  text,
  customerName,
  customerPhone,
  customerEmail,
}) => {
  const extracted = extractCustomerDataFromText(text)

  return {
    customerName: clean(customerName) || extracted.name,
    customerPhone: clean(customerPhone) || extracted.phone,
    customerEmail: (clean(customerEmail) || extracted.email).toLowerCase(),
  }
}

const buildCustomerSet = ({ customerName, customerPhone, customerEmail }) => {
  const set = {}

  if (customerName) {
    set['customer.name'] = customerName
    set.customerName = customerName
  }

  if (customerPhone) {
    set['customer.phone'] = customerPhone
    set.customerPhone = customerPhone
  }

  if (customerEmail) {
    set['customer.email'] = customerEmail
    set.customerEmail = customerEmail
  }

  return set
}

const registerOptOut = async ({ tenantId, channel, destination }) => {
  if (!tenantId || !destination) return null

  return AiContactPreference.findOneAndUpdate(
    {
      tenantId,
      channel,
      destination,
    },
    {
      $set: {
        optedOut: true,
        optedOutAt: new Date(),
        reason: 'customer_requested',
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })
}

const buildConversationHistory = conversation => {
  const maxHistory = Math.min(
    Math.max(Number(process.env.AI_AGENT_MAX_HISTORY_MESSAGES || 12), 4),
    24,
  )

  return (conversation?.messages || [])
    .slice(-maxHistory)
    .filter(message => clean(message?.content))
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: clean(message.content),
    }))
}


const getRecentConversationMessages = (conversation, max = 10) => {
  return (conversation?.messages || [])
    .slice(-Math.max(2, max))
    .filter(message => clean(message?.content))
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: clean(message.content),
      createdAt: message.createdAt || null,
      metadata: message.metadata || {},
    }))
}

const FOLLOW_UP_PATTERNS = [
  /^(y|e|eh)\b/i,
  /\b(ese|esa|eso|aquel|aquella|el mismo|la misma|lo mismo)\b/i,
  /\b(mas barato|más barato|otro|otra|similar|parecido|mejor|peor)\b/i,
  /\b(en negro|en blanco|en rojo|en azul|talle|medida|color|capacidad|cuotas|envio|envío|garantia|garantía)\b/i,
  /^\s*(si|sí|dale|ok|bueno|perfecto|cuanto|cuánto|hay|tenes|tenés)\b/i,
]

const isFollowUpMessage = text => {
  const normalized = clean(text)
  if (!normalized) return false
  if (normalized.length <= 36 && /[?¿]?$/.test(normalized)) return true
  return FOLLOW_UP_PATTERNS.some(pattern => pattern.test(normalized))
}

const extractProductTitlesFromMessages = messages => {
  const titles = []
  const seen = new Set()

  for (const message of messages || []) {
    const products = Array.isArray(message?.metadata?.products)
      ? message.metadata.products
      : []

    for (const product of products) {
      const id = clean(product)
      if (!id || seen.has(id)) continue
      seen.add(id)
      titles.push(id)
    }

    const text = clean(message?.content)
    const quoted = text.match(/[“"]([^“"]{3,90})[”"]/g) || []
    for (const raw of quoted) {
      const title = clean(raw.replace(/[“”"]/g, ''))
      const key = normalizeText(title)
      if (!title || seen.has(key)) continue
      seen.add(key)
      titles.push(title)
    }
  }

  return titles.slice(-5)
}

const extractPreferenceHints = text => {
  const normalized = normalizeText(text)
  const hints = {}

  const budgetMatch = normalized.match(/(?:hasta|maximo|max|menos de|presupuesto)\s*\$?\s*(\d[\d.,]*)/i)
  if (budgetMatch?.[1]) hints.budgetMax = budgetMatch[1]

  const colorMatch = normalized.match(/\b(negro|negra|blanco|blanca|rojo|roja|azul|verde|amarillo|amarilla|gris|marron|marrón|rosa|dorado|dorada|plateado|plateada)\b/i)
  if (colorMatch?.[1]) hints.color = colorMatch[1]

  const sizeMatch = normalized.match(/\b(?:talle|medida|numero|número)\s*([a-z0-9.\-/]+)\b/i)
  if (sizeMatch?.[1]) hints.size = sizeMatch[1]

  return hints
}

const buildConversationMemory = ({ conversation, currentText }) => {
  const recentMessages = getRecentConversationMessages(conversation, 12)
  const lastAssistant = [...recentMessages].reverse().find(message => message.role === 'assistant')
  const lastUserMessages = recentMessages
    .filter(message => message.role === 'user')
    .slice(-4)
    .map(message => message.content)

  const preferenceHints = lastUserMessages.reduce(
    (acc, message) => ({ ...acc, ...extractPreferenceHints(message) }),
    extractPreferenceHints(currentText),
  )

  const mentionedProducts = extractProductTitlesFromMessages(recentMessages)

  return {
    isFollowUp: isFollowUpMessage(currentText),
    lastUserMessages,
    lastAssistantText: clean(lastAssistant?.content || '').slice(0, 900),
    mentionedProducts,
    preferenceHints,
    summary: [
      mentionedProducts.length
        ? `Productos/IDs ya tratados: ${mentionedProducts.join(', ')}`
        : '',
      Object.keys(preferenceHints).length
        ? `Preferencias detectadas: ${Object.entries(preferenceHints)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')}`
        : '',
      lastAssistant?.content
        ? `Última respuesta del asistente: ${clean(lastAssistant.content).slice(0, 220)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

const buildContextualCommerceQuery = ({ text, conversationMemory }) => {
  const current = clean(text)
  if (!conversationMemory?.isFollowUp) return current

  const priorUserContext = (conversationMemory.lastUserMessages || [])
    .filter(message => normalizeText(message) !== normalizeText(current))
    .slice(-3)
    .join(' | ')

  const productContext = (conversationMemory.mentionedProducts || [])
    .slice(-3)
    .join(' ')

  const preferenceContext = Object.values(conversationMemory.preferenceHints || {})
    .filter(Boolean)
    .join(' ')

  return [current, productContext, preferenceContext, priorUserContext]
    .map(clean)
    .filter(Boolean)
    .join(' | ')
    .slice(0, 900)
}

const getValidationWarnings = validation => [
  ...(Array.isArray(validation?.blockedReasons) ? validation.blockedReasons : []),
  ...(Array.isArray(validation?.hardWarnings) ? validation.hardWarnings : []),
  ...(Array.isArray(validation?.warnings) ? validation.warnings : []),
]

const shouldRepairResponse = validation => {
  if (!validation?.shouldFallback) return false

  const warnings = getValidationWarnings(validation)

  if (warnings.includes('empty_response')) return false
  if (warnings.includes('contains_numbers_not_present_in_context')) return true
  if (warnings.includes('discount_mentioned_without_known_code')) return true
  if (warnings.includes('commercial_recommendation_without_known_product_reference')) return true
  if (warnings.includes('mentions_price_without_products')) return true
  if (warnings.includes('mentions_stock_without_products')) return true

  return validation?.riskLevel === 'high' || validation?.riskLevel === 'medium'
}

const shouldForceSafeFallback = validation => {
  if (!validation?.shouldFallback) return false

  const warnings = getValidationWarnings(validation)

  return (
    warnings.includes('empty_response') ||
    warnings.includes('contains_numbers_not_present_in_context') ||
    warnings.includes('discount_mentioned_without_known_code')
  )
}

const buildRepairInstruction = ({ validation, userText, conversationMemory }) => {
  const warnings = getValidationWarnings(validation)

  return [
    'Reescribí tu respuesta anterior porque la validación interna detectó riesgo comercial.',
    'No uses una frase fija ni empieces con "Encontré estas opciones del catálogo".',
    'Contestá como una conversación natural, siguiendo el hilo previo.',
    conversationMemory?.summary ? `Memoria de conversación:\n${conversationMemory.summary}` : '',
    `Mensaje actual del cliente: ${clean(userText)}`,
    warnings.length ? `Problemas a corregir: ${warnings.join(', ')}` : '',
    'Reglas de reparación:',
    '- Si no podés confirmar precio, stock, promo o envío, decilo de forma específica y pedí el dato mínimo necesario.',
    '- Si hay productos en contexto, mencioná como máximo 2 y solo si sirven para la consulta actual.',
    '- Si el cliente está preguntando por un seguimiento como "ese", "más barato" o "en negro", retomá el producto o preferencia previa.',
    '- No inventes números, stock, cuotas, códigos ni políticas.',
  ]
    .filter(Boolean)
    .join('\n')
}

const buildConversationalFallbackResponse = ({
  userText,
  products = [],
  promotions = [],
  conversationMemory = {},
  validation = {},
}) => {
  const normalized = normalizeText(userText)
  const availableProducts = products
    .filter(product => product?.available !== false && Number(product?.stock ?? 1) > 0)
    .slice(0, 2)

  const productTitle = clean(
    conversationMemory?.mentionedProducts?.slice(-1)?.[0] ||
      availableProducts?.[0]?.title ||
      availableProducts?.[0]?.name ||
      availableProducts?.[0]?.nombre,
  )

  if (/envio|envío|mandan|entrega|retiro/.test(normalized)) {
    return productTitle
      ? `Sobre ${productTitle}: no tengo una política de envío suficientemente confirmada para darte costo o plazo exacto. Decime tu localidad o código postal y lo dejo listo para que un asesor lo confirme.`
      : 'Para confirmarte el envío necesito tu localidad o código postal. Con eso puedo orientarte mejor sin inventar costos ni plazos.'
  }

  if (/cuota|financiacion|financiación|tarjeta|pago|transferencia/.test(normalized)) {
    return productTitle
      ? `Para ${productTitle} no tengo condiciones de financiación confirmadas en este contexto. Puedo ayudarte con precio y disponibilidad, y si querés te derivo para confirmar cuotas o medio de pago.`
      : 'Puedo ayudarte, pero necesito saber qué producto querés pagar para revisar precio y disponibilidad antes de hablar de cuotas o financiación.'
  }

  if (/garantia|garantía|cambio|devolucion|devolución/.test(normalized)) {
    return productTitle
      ? `Sobre ${productTitle}, no tengo una política de garantía/cambios suficientemente específica. Te puedo contar lo que figura del producto y dejar la consulta para confirmación humana.`
      : 'Para responder bien sobre garantía, cambios o devolución necesito saber de qué producto hablamos.'
  }

  if (conversationMemory?.isFollowUp && productTitle) {
    return `Sigo con ${productTitle}. No tengo un dato confiable para responder eso con precisión. ¿Querés que revise precio, stock, variantes o envío de ese producto?`
  }

  if (availableProducts.length > 0 && !shouldForceSafeFallback(validation)) {
    const lines = availableProducts.map(product => {
      const title = clean(product.title || product.name || product.nombre || 'Producto')
      const price = product.formattedPrice || (product.price ? `$${product.price}` : 'precio a confirmar')
      const stock = Number(product.stock || 0)
      return `• ${title}${price ? ` — ${price}` : ''}${stock ? ` — stock: ${stock}` : ''}`
    })

    return [
      'Puedo orientarte con estas alternativas, pero necesito afinar un poco la búsqueda:',
      ...lines,
      '¿Buscás algún talle, color, presupuesto o uso en particular?',
    ].join('\n')
  }

  if (promotions.length > 0) {
    return 'Hay promociones activas, pero para no aplicarte una promo incorrecta necesito saber qué producto te interesa.'
  }

  return 'Para ayudarte mejor necesito un dato más: ¿qué producto, categoría, marca, talle, color o presupuesto estás buscando?'
}

const repairAiResponseIfNeeded = async ({
  aiResult,
  validation,
  systemPrompt,
  recentMessages,
  cleanText,
  conversationMemory,
}) => {
  if (!shouldRepairResponse(validation)) {
    return { aiResult, validation }
  }

  try {
    const repairPrompt = buildRepairInstruction({
      validation,
      userText: cleanText,
      conversationMemory,
    })

    const repaired = await callAgentLLM({
      systemPrompt,
      messages: [
        ...recentMessages,
        {
          role: 'assistant',
          content: clean(aiResult.content),
        },
        {
          role: 'user',
          content: repairPrompt,
        },
      ],
      temperature: 0.25,
      maxOutputTokens: Number(process.env.AI_AGENT_REPAIR_MAX_OUTPUT_TOKENS || 700),
    })

    if (!clean(repaired?.content)) {
      return { aiResult, validation }
    }

    return {
      aiResult: {
        ...aiResult,
        ...repaired,
        content: repaired.content,
        repaired: true,
        originalContent: aiResult.content,
      },
      validation,
    }
  } catch (error) {
    logger.warn('[AI_AGENT_RESPONSE_REPAIR_ERROR]', {
      message: error?.message,
      provider: error?.provider || 'gemini',
    })

    return { aiResult, validation }
  }
}

const getQuotaPeriod = () => new Date().toISOString().slice(0, 7)

const reserveAgentMessageQuota = async ({ tenantId, agent }) => {
  const period = getQuotaPeriod()

  if (agent?.quotas?.quotaPeriod !== period) {
    await AiAgent.updateOne(
      {
        _id: agent._id,
        tenantId,
        'quotas.quotaPeriod': { $ne: period },
      },
      {
        $set: {
          'quotas.quotaPeriod': period,
          'quotas.monthlyMessagesUsed': 0,
          'quotas.monthlyAiTokensUsed': 0,
        },
      },
    ).setOptions({ tenantId })
  }

  const limit = Number(agent?.quotas?.monthlyMessageLimit || 0)
  const tokenLimit = Number(agent?.quotas?.monthlyAiTokenLimit || 0)
  const query = {
    _id: agent._id,
    tenantId,
    ...(limit > 0 ? { 'quotas.monthlyMessagesUsed': { $lt: limit } } : {}),
    ...(tokenLimit > 0
      ? { 'quotas.monthlyAiTokensUsed': { $lt: tokenLimit } }
      : {}),
  }

  return AiAgent.findOneAndUpdate(
    query,
    {
      $inc: { 'quotas.monthlyMessagesUsed': 1 },
      $set: { 'quotas.quotaPeriod': period },
    },
    { new: true },
  )
    .setOptions({ tenantId })
    .lean()
}

const registerTokenUsage = async ({ tenantId, agentId, usageMetadata }) => {
  const tokens = Number(usageMetadata?.totalTokenCount || 0)
  if (!Number.isFinite(tokens) || tokens <= 0) return

  await AiAgent.updateOne(
    { _id: agentId, tenantId },
    { $inc: { 'quotas.monthlyAiTokensUsed': Math.round(tokens) } },
  ).setOptions({ tenantId })
}

const updateAgentStats = async ({
  tenantId,
  newConversation,
  becameLead,
  becameHandoff,
}) => {
  if (!tenantId) return null

  const increment = {
    ...(newConversation ? { 'stats.conversations': 1 } : {}),
    ...(becameLead ? { 'stats.leads': 1 } : {}),
    ...(becameHandoff ? { 'stats.handoffs': 1 } : {}),
  }

  try {
    return await AiAgent.updateOne(
      { tenantId },
      {
        ...(Object.keys(increment).length > 0 ? { $inc: increment } : {}),
        $set: {
          'stats.lastInteractionAt': new Date(),
        },
      },
    ).setOptions({ tenantId })
  } catch (error) {
    logger.error('[AI_AGENT_STATS_UPDATE_ERROR]', {
      tenantId,
      error: error?.message,
    })

    return null
  }
}

const registerLearningSafely = async ({
  tenantId,
  conversation,
  userText,
  assistantText,
  intent,
  leadScore,
  handoffRequired,
  actions,
  products,
}) => {
  try {
    await registerConversationLearningSignal({
      tenantId,
      conversation,
      userText,
      assistantText,
      intent,
      leadScore,
      handoffRequired,
      actions,
      products,
    })
  } catch (error) {
    logger.error('[AI_AGENT_LEARNING_SIGNAL_ERROR]', {
      tenantId,
      conversationId: conversation?._id,
      error: error?.message,
    })
  }
}

export const processAgentMessage = async ({
  tenantId,
  tenant = null,
  channel = 'webchat',
  externalUserId,
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  text,
  externalMessageId = '',
}) => {
  const cleanText = clean(text)
  channel = normalizeChannel(channel)
  externalUserId = clean(externalUserId)

  const resolvedCustomer = resolveCustomerData({
    text: cleanText,
    customerName,
    customerPhone,
    customerEmail,
  })

  const cleanCustomerName = resolvedCustomer.customerName
  const cleanCustomerPhone = resolvedCustomer.customerPhone
  const cleanCustomerEmail = resolvedCustomer.customerEmail

  if (!tenantId) {
    throw new Error('tenantId es obligatorio')
  }

  if (!externalUserId) {
    throw new Error('externalUserId es obligatorio')
  }

  if (!cleanText) {
    return {
      reply: 'No pude leer tu mensaje. ¿Podés enviarlo nuevamente?',
      intent: 'general_question',
      leadScore: 0,
      handoffRequired: false,
      actions: [],
    }
  }

  await registerCustomerInboundMessage({
    tenantId,
    channel,
    destination: cleanCustomerPhone || cleanCustomerEmail || externalUserId,
    consentSource: `${channel}_inbound_message`,
  }).catch(error => {
    logger.error('[AI_CONTACT_PREFERENCE_INBOUND_ERROR]', {
      tenantId,
      channel,
      error: error?.message,
    })
  })

  if (isOptOutMessage(cleanText)) {
    await registerOptOut({
      tenantId,
      channel,
      destination: cleanCustomerPhone || externalUserId,
    })

    return {
      reply:
        'Listo, registré tu solicitud. No volveremos a enviarte mensajes promocionales por este canal.',
      intent: 'opt_out',
      leadScore: 0,
      handoffRequired: false,
      actions: [],
    }
  }

  let agent = await getOrCreateAiAgentForTenant({
    tenantId,
    tenant,
  })

  if (
    includesConfiguredKeyword(
      cleanText,
      agent?.guardrails?.optOutKeywords || [],
    )
  ) {
    await registerOptOut({
      tenantId,
      channel,
      destination: cleanCustomerPhone || externalUserId,
    })

    return {
      reply:
        'Listo, registré tu solicitud. No volveremos a enviarte mensajes promocionales por este canal.',
      intent: 'opt_out',
      leadScore: 0,
      handoffRequired: false,
      actions: [],
    }
  }

  if (isBlockedTopic({ text: cleanText, agent })) {
    return {
      reply:
        'No puedo ayudar con ese tema desde el asistente automático. Voy a dejar la consulta para revisión de un asesor.',
      intent: 'general_question',
      leadScore: 0,
      handoffRequired: true,
      reason: 'blocked_topic',
      actions: [{ type: 'request_human', label: 'Hablar con un asesor' }],
    }
  }

  if (!agent?.enabled) {
    return {
      reply:
        'Gracias por escribirnos. En este momento un asesor va a revisar tu consulta.',
      intent: 'general_question',
      leadScore: 0,
      handoffRequired: true,
      reason: 'agent_disabled',
      actions: [],
    }
  }

  if (channel === 'webchat' && agent?.channels?.webchat?.enabled === false) {
    return {
      reply:
        'El asistente web no está activo para este comercio en este momento.',
      intent: 'general_question',
      leadScore: 0,
      handoffRequired: true,
      reason: 'webchat_disabled',
      actions: [],
    }
  }

  const preQuotaExternalMessageId = clean(externalMessageId)

  if (preQuotaExternalMessageId) {
    const duplicateConversation = await AiConversation.findOne({
      tenantId,
      channel,
      externalUserId,
      'messages.externalMessageId': preQuotaExternalMessageId,
      deletedAt: { $exists: false },
    })
      .setOptions({ tenantId })
      .lean()

    if (duplicateConversation) {
      const priorReply = [...(duplicateConversation.messages || [])]
        .reverse()
        .find(message => {
          return (
            message.role === 'assistant' &&
            message.metadata?.replyToExternalMessageId ===
              preQuotaExternalMessageId
          )
        })

      return {
        reply:
          priorReply?.content ||
          'Tu mensaje ya fue recibido y está siendo procesado.',
        conversationId: duplicateConversation._id || null,
        externalUserId,
        duplicate: true,
        actions: priorReply?.metadata?.actions || [],
      }
    }
  }

  const cleanExternalMessageId = clean(externalMessageId)

  if (cleanExternalMessageId) {
    const duplicateConversation = await AiConversation.findOne({
      tenantId,
      channel,
      externalUserId,
      'messages.externalMessageId': cleanExternalMessageId,
      deletedAt: { $exists: false },
    })
      .setOptions({ tenantId })
      .lean()

    if (duplicateConversation) {
      const priorReply = [...(duplicateConversation.messages || [])]
        .reverse()
        .find(message => {
          return (
            message.role === 'assistant' &&
            message.metadata?.replyToExternalMessageId === cleanExternalMessageId
          )
        })

      return {
        reply:
          priorReply?.content ||
          'Tu mensaje ya fue recibido y está siendo procesado.',
        conversationId: duplicateConversation._id,
        externalUserId,
        duplicate: true,
        actions: priorReply?.metadata?.actions || [],
      }
    }
  }

  agent = await reserveAgentMessageQuota({ tenantId, agent })
  if (!agent) {
    return {
      reply:
        'El asistente alcanzó temporalmente su límite de atención automática. Tu consulta queda disponible para un asesor.',
      intent: 'general_question',
      leadScore: 0,
      handoffRequired: true,
      reason: 'monthly_message_quota_exceeded',
      actions: [{ type: 'request_human', label: 'Hablar con un asesor' }],
    }
  }

  let conversation = await AiConversation.findOneAndUpdate(
    {
      tenantId,
      channel,
      externalUserId,
      status: { $ne: 'closed' },
      deletedAt: { $exists: false },
    },
    {
      $setOnInsert: {
        tenantId,
        channel,
        externalUserId,
        status: 'open',
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })

  const messageFilter = {
    _id: conversation._id,
    tenantId,
    ...(cleanExternalMessageId
      ? { 'messages.externalMessageId': { $ne: cleanExternalMessageId } }
      : {}),
  }

  conversation = await AiConversation.findOneAndUpdate(
    messageFilter,
    {
      $set: {
        lastMessageAt: new Date(),
        lastCustomerMessageAt: new Date(),
        ...buildCustomerSet({
          customerName: cleanCustomerName,
          customerPhone: cleanCustomerPhone,
          customerEmail: cleanCustomerEmail,
        }),
      },
      $push: {
        messages: {
          $each: [
            {
              role: 'user',
              channel,
              content: cleanText,
              externalMessageId: cleanExternalMessageId,
              metadata: {
                customerName: cleanCustomerName,
                customerPhone: cleanCustomerPhone,
                customerEmail: cleanCustomerEmail,
              },
            },
          ],
          $slice: -MAX_STORED_MESSAGES,
        },
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  if (!conversation && cleanExternalMessageId) {
    const duplicateConversation = await AiConversation.findOne({
      tenantId,
      channel,
      externalUserId,
      'messages.externalMessageId': cleanExternalMessageId,
      deletedAt: { $exists: false },
    })
      .setOptions({ tenantId })
      .lean()
    const priorReply = [...(duplicateConversation?.messages || [])]
      .reverse()
      .find(message => {
        return (
          message.role === 'assistant' &&
          message.metadata?.replyToExternalMessageId === cleanExternalMessageId
        )
      })

    return {
      reply:
        priorReply?.content ||
        'Tu mensaje ya fue recibido y está siendo procesado.',
      conversationId: duplicateConversation?._id || null,
      externalUserId,
      duplicate: true,
      actions: priorReply?.metadata?.actions || [],
    }
  }

  const newConversation = (conversation.messages || []).length === 1
  const previousLeadScore = Number(conversation.leadScore || 0)
  const previouslyRequiredHandoff = Boolean(conversation.handoffRequired)

  const conversationMemory = buildConversationMemory({
    conversation,
    currentText: cleanText,
  })
  const commerceQuery = buildContextualCommerceQuery({
    text: cleanText,
    conversationMemory,
  })

  const [toolContext, knowledge] = await Promise.all([
    runAgentCommerceTools({
      tenantId,
      query: commerceQuery,
      conversationMemory,
    }),
    searchRelevantKnowledgeForAgent({
      tenantId,
      query: commerceQuery,
    }),
  ])

  const commerceContext = {
    generatedAt: toolContext?.generatedAt,
    products: toolContext?.products || [],
    promotions: toolContext?.promotions || [],
    recommendations: toolContext?.recommendations || [],
    catalogSnapshot: toolContext?.catalogSnapshot || null,
  }

  const products = commerceContext.products || []
  const promotions = commerceContext.promotions || []
  const leadSignal = detectLeadIntentFromText(cleanText)
  const intent = leadSignal.intent
  const intentScore = leadSignal.intentScore
  const leadScore = leadSignal.leadScore
  const extractedPreferences = extractLeadPreferences({
    text: cleanText,
    knownCategories: commerceContext?.catalogSnapshot?.categories || [],
  })

  const systemPrompt = buildAgentSystemPrompt({
    agent,
    tenant,
    knowledge,
    products,
    commerceContext,
    conversationMemory,
    currentUserMessage: cleanText,
    intent,
  })

  const recentMessages = buildConversationHistory(conversation)

  let aiResult

  try {
    aiResult = await callAgentLLM({
      systemPrompt,
      messages: recentMessages,
      temperature: 0.35,
      maxOutputTokens: Number(process.env.AI_AGENT_MAX_OUTPUT_TOKENS || 1200),
    })
  } catch (error) {
    logger.error('[AI_AGENT_GEMINI_ERROR]', {
      message: error?.message,
      statusCode: error?.statusCode,
      provider: error?.provider || 'gemini',
      code: error?.code || null,
    })

    aiResult = {
      content:
        process.env.NODE_ENV === 'production'
          ? 'Gracias por tu mensaje. Estoy teniendo una demora para responder automáticamente. Ya dejo tu consulta registrada para que la revise un asesor.'
          : `Error Gemini: ${error?.message || 'Error desconocido'}`,
      fallback: true,
      error: error?.message || 'Error desconocido',
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || null,
    }
  }

  await registerTokenUsage({
    tenantId,
    agentId: agent._id,
    usageMetadata: aiResult.usageMetadata,
  }).catch(() => null)

  let validation = validateAgentCommerceResponse({
    responseText: aiResult.content,
    userMessage: cleanText,
    products,
    promotions,
    conversationMemory,
    businessContext: agent?.businessContext || {},
    policies: agent?.businessContext?.policies || {},
  })

  if (validation.shouldFallback) {
    const repaired = await repairAiResponseIfNeeded({
      aiResult,
      validation,
      systemPrompt,
      recentMessages,
      cleanText,
      conversationMemory,
    })

    aiResult = repaired.aiResult

    validation = validateAgentCommerceResponse({
      responseText: aiResult.content,
      userMessage: cleanText,
      products,
      promotions,
      conversationMemory,
      businessContext: agent?.businessContext || {},
      policies: agent?.businessContext?.policies || {},
    })

    if (validation.shouldFallback && shouldForceSafeFallback(validation)) {
      aiResult = {
        ...aiResult,
        content: buildConversationalFallbackResponse({
          userText: cleanText,
          products,
          promotions,
          conversationMemory,
          validation,
        }),
        fallback: true,
        validation,
      }
    } else {
      aiResult = {
        ...aiResult,
        validation,
        fallback: Boolean(aiResult.fallback && aiResult.error),
      }
    }
  }

  const actions = buildAgentActions({
    text: cleanText,
    responseText: aiResult.content,
    products,
    promotions,
    behavior: agent?.behavior || {},
  })

  if (actions.length > 0) {
    aiResult = {
      ...aiResult,
      content: `${clean(aiResult.content)}${buildActionAwareReplySuffix(actions)}`,
    }
  }

  aiResult = {
    ...aiResult,
    content: clean(aiResult.content),
  }

  if (aiResult.truncated || aiResult.finishReason === 'MAX_TOKENS') {
    aiResult = {
      ...aiResult,
      content:
        `${aiResult.content}\n\n` +
        'Para no darte una respuesta incompleta, puedo continuar con más detalle si me indicás qué producto, precio, stock, envío o financiación querés revisar.',
      fallback: true,
      truncated: true,
    }
  }

  if (!aiResult.content) {
    aiResult = {
      ...aiResult,
      content:
        'Recibí tu consulta, pero no pude generar una respuesta completa. Podés reformularla o pedirme ayuda con un producto específico.',
      fallback: true,
    }
  }

  const shouldHandoff =
    Boolean(aiResult.fallback && aiResult.error) ||
    actions.some(action => action.type === 'request_human') ||
    requiresHumanByPolicy({ text: cleanText, agent }) ||
    (conversation.messages || []).length >=
      Number(agent?.behavior?.maxMessagesBeforeHuman || 12)

  const assistantMessage = {
    role: 'assistant',
    channel,
    content: aiResult.content,
    metadata: {
      replyToExternalMessageId: cleanExternalMessageId,
      provider: aiResult.provider || 'gemini',
      model: aiResult.model || process.env.GEMINI_MODEL || null,
      finishReason: aiResult.finishReason || '',
      truncated: Boolean(aiResult.truncated),
      intent,
      leadScore,
      products: products
        .map(product => product.id || product._id)
        .filter(Boolean),
      promotions: promotions
        .map(promotion => promotion.code || promotion.id)
        .filter(Boolean),
      actions,
      validation: aiResult.validation || validation,
      fallback: Boolean(aiResult.fallback),
      error: aiResult.error || null,
      preferences: extractedPreferences,
      conversationMemory,
      commerceQuery,
      repaired: Boolean(aiResult.repaired),
      originalContent: aiResult.originalContent || null,
    },
  }

  conversation = await AiConversation.findOneAndUpdate(
    { _id: conversation._id, tenantId },
    {
      $push: {
        messages: {
          $each: [assistantMessage],
          $slice: -MAX_STORED_MESSAGES,
        },
      },
      $set: {
        intent,
        leadScore: Math.max(conversation.leadScore || 0, leadScore),
        handoffRequired: shouldHandoff,
        handoffReason: shouldHandoff
          ? aiResult.error || 'action_policy_or_max_messages'
          : '',
        status: shouldHandoff ? 'waiting_human' : 'open',
        lastMessageAt: new Date(),
        lastBusinessMessageAt: new Date(),
        ...buildCustomerSet({
          customerName: cleanCustomerName,
          customerPhone: cleanCustomerPhone,
          customerEmail: cleanCustomerEmail,
        }),
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  const assistantTextForLead = clean(aiResult.content)
  const productsForLead = Array.isArray(products) ? products : []
  const actionsForLead = Array.isArray(actions) ? actions : []

  try {
    await upsertLeadFromConversation({
      tenantId,
      conversation,

      customerName: cleanCustomerName,
      customerPhone: cleanCustomerPhone,
      customerEmail: cleanCustomerEmail,

      message: cleanText,
      assistantText: assistantTextForLead,

      intent,
      intentScore,
      leadScore,

      products: productsForLead,
      productsOfInterest: [],
      actions: actionsForLead,

      channel,
      preferences: extractedPreferences || {},

      metadata: {
        source: 'ai_agent_brain',
        channel,
        handoffRequired: Boolean(shouldHandoff),
        actionsCount: actionsForLead.length,
        productsContextCount: productsForLead.length,
        productsOfInterestCount: 0,
        productsOfInterestDetection: 'message_assistant_actions_only',
        llmFinishReason: aiResult.finishReason || '',
        llmTruncated: Boolean(aiResult.truncated),
        commerceQuery,
        conversationFollowUp: Boolean(conversationMemory.isFollowUp),
        responseRepaired: Boolean(aiResult.repaired),
      },
    })
  } catch (leadError) {
    logger.error('[AI_LEAD_UPSERT_ERROR]', {
      tenantId,
      conversationId: conversation?._id,
      error: leadError?.message,
    })
  }

  if (agent?.learning?.enabled !== false) {
    await registerLearningSafely({
      tenantId,
      conversation,
      userText: cleanText,
      assistantText: aiResult.content,
      intent,
      leadScore,
      handoffRequired: shouldHandoff,
      actions,
      products,
    })
  }

  await updateAgentStats({
    tenantId,
    newConversation,
    becameLead: previousLeadScore < 60 && leadScore >= 60,
    becameHandoff: !previouslyRequiredHandoff && shouldHandoff,
  })

  return {
    reply: aiResult.content,
    conversationId: conversation._id,
    externalUserId,
    intent,
    leadScore,
    handoffRequired: shouldHandoff,
    provider: aiResult.provider || 'gemini',
    model: aiResult.model || process.env.GEMINI_MODEL || null,
    products: products.slice(0, 3),
    recommendations: commerceContext.recommendations || [],
    actions,
    conversationMemory: {
      isFollowUp: Boolean(conversationMemory.isFollowUp),
      preferenceHints: conversationMemory.preferenceHints || {},
    },
    customer: {
      name: cleanCustomerName,
      phone: cleanCustomerPhone,
      email: cleanCustomerEmail,
    },
  }
}
