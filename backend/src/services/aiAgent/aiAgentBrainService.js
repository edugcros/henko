// 📁 src/services/aiAgent/aiAgentBrainService.js
import AiConversation from '../../models/aiConversationModel.js'
import AiContactPreference from '../../models/aiContactPreferenceModel.js'
import { buildAgentSystemPrompt } from './aiAgentPromptService.js'
import { callAgentLLM } from './aiAgentLLMService.js'
import { searchRelevantKnowledgeForAgent } from './aiAgentToolService.js'
import { runAgentCommerceTools } from './aiAgentToolsV2Service.js'
import { registerConversationLearningSignal } from './aiAgentLearningService.js'
import { getOrCreateAiAgentForTenant } from './aiAgentProvisioningService.js'
import {
  buildSafeFallbackResponse,
  validateAgentCommerceResponse,
} from './aiAgentResponseValidatorService.js'
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

const resolveCustomerData = ({ text, customerName, customerPhone, customerEmail }) => {
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

const updateAgentStats = async ({ tenantId, leadScore, shouldHandoff }) => {
  if (!tenantId) return null

  return getOrCreateAiAgentForTenant({ tenantId })
    .then(agent => {
      if (!agent?._id) return null

      return import('../../models/aiAgentModel.js').then(({ default: AiAgent }) =>
        AiAgent.updateOne(
          { tenantId },
          {
            $inc: {
              'stats.conversations': 1,
              ...(leadScore >= 60 ? { 'stats.leads': 1 } : {}),
              ...(shouldHandoff ? { 'stats.handoffs': 1 } : {}),
            },
            $set: {
              'stats.lastInteractionAt': new Date(),
            },
          },
        ).setOptions({ tenantId }),
      )
    })
    .catch(error => {
      console.error('[AI_AGENT_STATS_UPDATE_ERROR]', {
        tenantId,
        error: error?.message,
      })

      return null
    })
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
    console.error('[AI_AGENT_LEARNING_SIGNAL_ERROR]', {
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
}) => {
  const cleanText = clean(text)
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

  const agent = await getOrCreateAiAgentForTenant({
    tenantId,
    tenant,
  })

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

  const conversation = await AiConversation.findOneAndUpdate(
    {
      tenantId,
      channel,
      externalUserId,
      status: { $ne: 'closed' },
    },
    {
      $setOnInsert: {
        tenantId,
        channel,
        externalUserId,
        status: 'open',
      },
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
          role: 'user',
          channel,
          content: cleanText,
          metadata: {
            customerName: cleanCustomerName,
            customerPhone: cleanCustomerPhone,
            customerEmail: cleanCustomerEmail,
          },
        },
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })

  const [toolContext, knowledge] = await Promise.all([
    runAgentCommerceTools({
      tenantId,
      query: cleanText
    }),
    searchRelevantKnowledgeForAgent({
      tenantId,
      query: cleanText,
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
  const extractedPreferences = extractLeadPreferences(cleanText)

  const systemPrompt = buildAgentSystemPrompt({
    agent,
    tenant,
    knowledge,
    products,
    commerceContext,
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
    console.error('[AI_AGENT_GEMINI_ERROR]', {
      message: error?.message,
      statusCode: error?.statusCode,
      details: error?.details,
      stack: error?.stack,
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

  const validation = validateAgentCommerceResponse({
    responseText: aiResult.content,
    products,
    promotions,
  })

  if (validation.shouldFallback) {
    aiResult = {
      ...aiResult,
      content: buildSafeFallbackResponse({
        products,
        promotions,
      }),
      fallback: true,
      validation,
    }
  }

  const actions = buildAgentActions({
    text: cleanText,
    responseText: aiResult.content,
    products,
    promotions,
    conversationId: conversation._id,
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
  (conversation.messages || []).length >=
    Number(agent?.behavior?.maxMessagesBeforeHuman || 12)

  conversation.messages.push({
    role: 'assistant',
    channel,
    content: aiResult.content,
    metadata: {
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
    },
  })

  if (cleanCustomerName) {
    conversation.customer = {
      ...(conversation.customer || {}),
      name: cleanCustomerName,
    }
    conversation.customerName = cleanCustomerName
  }

  if (cleanCustomerPhone) {
    conversation.customer = {
      ...(conversation.customer || {}),
      phone: cleanCustomerPhone,
    }
    conversation.customerPhone = cleanCustomerPhone
  }

  if (cleanCustomerEmail) {
    conversation.customer = {
      ...(conversation.customer || {}),
      email: cleanCustomerEmail,
    }
    conversation.customerEmail = cleanCustomerEmail
  }

  conversation.intent = intent
  conversation.leadScore = Math.max(conversation.leadScore || 0, leadScore)
  conversation.handoffRequired = shouldHandoff
  conversation.handoffReason = shouldHandoff
    ? aiResult.error || 'action_or_max_messages'
    : ''
  conversation.status = shouldHandoff ? 'waiting_human' : 'open'
  conversation.lastMessageAt = new Date()

  await conversation.save({ tenantId })

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
      },
    })
  } catch (leadError) {
    console.error('[AI_LEAD_UPSERT_ERROR]', {
      tenantId,
      conversationId: conversation?._id,
      error: leadError?.message,
    })
  }

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

  await updateAgentStats({
    tenantId,
    leadScore,
    shouldHandoff,
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
    customer: {
      name: cleanCustomerName,
      phone: cleanCustomerPhone,
      email: cleanCustomerEmail,
    },
  }
}