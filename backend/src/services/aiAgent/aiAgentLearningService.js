// 📁 src/services/aiAgent/aiAgentLearningService.js
import crypto from 'crypto'
import AiLearningSuggestion from '../../models/aiLearningSuggestionModel.js'
import AiKnowledge from '../../models/aiKnowledgeModel.js'

const clean = value => String(value || '').trim()

const normalize = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const tokenize = value => {
  return normalize(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 3)
}

const hash = value => {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

const buildFingerprint = ({ tenantId, type, normalizedQuestion }) => {
  return hash(`${tenantId}:${type}:${normalizedQuestion}`).slice(0, 40)
}

const detectQuestionType = text => {
  const value = normalize(text)

  if (
    /envio|envios|entrega|retirar|retiro|domicilio|shipping|despacho/.test(
      value,
    )
  ) {
    return 'policy_gap'
  }

  if (
    /garantia|devolucion|cambio|reembolso|documentacion|patentamiento|papeles/.test(
      value,
    )
  ) {
    return 'policy_gap'
  }

  if (
    /stock|disponible|hay|tenes|tienen|queda|precio|cuanto|vale|colores|talle|medida/.test(
      value,
    )
  ) {
    return 'faq_suggestion'
  }

  if (/no encontre|no tenes|busco|quiero algo|necesito algo/.test(value)) {
    return 'product_gap'
  }

  return 'general'
}

const isQuestionLike = text => {
  const value = normalize(text)

  if (!value || value.length < 8) return false

  return (
    value.includes('?') ||
    /^(que|qué|como|cómo|cuando|cuándo|donde|dónde|cuanto|cuánto|hay|tenes|tienen|puedo|necesito|quiero|busco|me interesa)/.test(
      value,
    )
  )
}

const buildPriority = ({ confidence, handoffRequired, leadScore }) => {
  if (handoffRequired && leadScore >= 70) return 'critical'
  if (handoffRequired) return 'high'
  if (confidence >= 0.75 || leadScore >= 60) return 'high'
  if (confidence >= 0.55) return 'medium'
  return 'low'
}

const buildSuggestedAnswer = ({ userText, assistantText, handoffRequired }) => {
  if (assistantText && !handoffRequired) {
    return clean(assistantText).slice(0, 1800)
  }

  return [
    `Pregunta detectada: ${clean(userText)}`,
    '',
    'Respuesta sugerida pendiente de completar por el administrador.',
    'Aprobá esta sugerencia solo cuando la información sea correcta para el comercio.',
  ].join('\n')
}

const buildTags = ({ type, userText, intent }) => {
  const tokens = tokenize(userText).slice(0, 8)

  return [...new Set([type, intent, ...tokens].filter(Boolean))]
}

const shouldCreateSuggestion = ({
  userText,
  assistantText,
  handoffRequired,
  actions,
  products,
}) => {
  const cleanUserText = clean(userText)
  const cleanAssistantText = clean(assistantText)
  const hasActions = Array.isArray(actions) && actions.length > 0
  const hasProducts = Array.isArray(products) && products.length > 0

  if (!cleanUserText) return false

  if (handoffRequired) return true

  if (isQuestionLike(cleanUserText) && !cleanAssistantText) return true

  if (isQuestionLike(cleanUserText) && !hasActions && !hasProducts) return true

  if (/no tengo informacion|no tengo información|no puedo confirmar|consultar con un asesor|un asesor/.test(
    normalize(cleanAssistantText),
  )) {
    return true
  }

  return false
}

export const registerConversationLearningSignal = async ({
  tenantId,
  conversation,
  userText,
  assistantText,
  intent = 'general_question',
  leadScore = 0,
  handoffRequired = false,
  actions = [],
  products = [],
} = {}) => {
  if (!tenantId || !clean(userText)) return null

  if (
    !shouldCreateSuggestion({
      userText,
      assistantText,
      handoffRequired,
      actions,
      products,
    })
  ) {
    return null
  }

  const type = detectQuestionType(userText)
  const normalizedQuestion = normalize(userText).slice(0, 400)

  if (!normalizedQuestion) return null

  const confidence = Math.min(
    0.95,
    Math.max(
      0.35,
      (handoffRequired ? 0.25 : 0) +
        (isQuestionLike(userText) ? 0.25 : 0) +
        (leadScore >= 60 ? 0.2 : 0) +
        (actions.length === 0 ? 0.15 : 0) +
        0.25,
    ),
  )

  const fingerprint = buildFingerprint({
    tenantId,
    type,
    normalizedQuestion,
  })

  const conversationId = conversation?._id || conversation?.id || null

  const payload = {
    tenantId,
    type,
    title: clean(userText).slice(0, 160),
    question: clean(userText).slice(0, 500),
    suggestedAnswer: buildSuggestedAnswer({
      userText,
      assistantText,
      handoffRequired,
    }),
    normalizedQuestion,
    fingerprint,
    confidence,
    priority: buildPriority({
      confidence,
      handoffRequired,
      leadScore,
    }),
    tags: buildTags({ type, userText, intent }),
    metadata: {
      intent,
      leadScore,
      channel: conversation?.channel || 'webchat',
      sampleUserText: clean(userText).slice(0, 1000),
      sampleAssistantText: clean(assistantText).slice(0, 1500),
      productIds: products
        .map(product => String(product?.id || product?._id || product?.productId || ''))
        .filter(Boolean)
        .slice(0, 10),
      actionTypes: actions
        .map(action => clean(action?.type))
        .filter(Boolean)
        .slice(0, 10),
    },
  }

  const update = {
    $setOnInsert: payload,
    $inc: {
      'signals.occurrences': 1,
      ...(handoffRequired ? { 'signals.handoffs': 1 } : {}),
    },
    $addToSet: {
      ...(conversationId ? { sourceConversationIds: conversationId } : {}),
    },
    $max: {
      confidence,
    },
    $set: {
      priority: payload.priority,
      updatedAt: new Date(),
    },
  }

  const suggestion = await AiLearningSuggestion.findOneAndUpdate(
    {
      tenantId,
      fingerprint,
      status: { $in: ['pending_review', 'archived'] },
    },
    update,
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).lean()

  return suggestion
}

export const approveLearningSuggestion = async ({
  tenantId,
  suggestionId,
  reviewerId,
  title,
  content,
  tags,
} = {}) => {
  const suggestion = await AiLearningSuggestion.findOne({
    _id: suggestionId,
    tenantId,
  })

  if (!suggestion) {
    const error = new Error('Sugerencia no encontrada')
    error.statusCode = 404
    throw error
  }

  if (suggestion.status === 'approved' && suggestion.approvedKnowledgeId) {
    return suggestion
  }

  const knowledgeTitle = clean(title) || suggestion.title
  const knowledgeContent = clean(content) || suggestion.suggestedAnswer

  if (!knowledgeTitle || !knowledgeContent) {
    const error = new Error('Título y contenido son obligatorios para aprobar')
    error.statusCode = 400
    throw error
  }

  const knowledge = await AiKnowledge.create({
    tenantId,
    title: knowledgeTitle,
    content: knowledgeContent,
    tags: Array.isArray(tags) && tags.length > 0 ? tags : suggestion.tags,
    status: 'approved',
  })

  suggestion.status = 'approved'
  suggestion.reviewedBy = reviewerId || null
  suggestion.reviewedAt = new Date()
  suggestion.approvedKnowledgeId = knowledge._id
  suggestion.title = knowledgeTitle
  suggestion.suggestedAnswer = knowledgeContent

  await suggestion.save()

  return suggestion.toObject()
}

export const rejectLearningSuggestion = async ({
  tenantId,
  suggestionId,
  reviewerId,
  reason = '',
} = {}) => {
  const suggestion = await AiLearningSuggestion.findOne({
    _id: suggestionId,
    tenantId,
  })

  if (!suggestion) {
    const error = new Error('Sugerencia no encontrada')
    error.statusCode = 404
    throw error
  }

  suggestion.status = 'rejected'
  suggestion.reviewedBy = reviewerId || null
  suggestion.reviewedAt = new Date()
  suggestion.rejectionReason = clean(reason).slice(0, 1000)

  await suggestion.save()

  return suggestion.toObject()
}

export const archiveLearningSuggestion = async ({
  tenantId,
  suggestionId,
  reviewerId,
} = {}) => {
  const suggestion = await AiLearningSuggestion.findOne({
    _id: suggestionId,
    tenantId,
  })

  if (!suggestion) {
    const error = new Error('Sugerencia no encontrada')
    error.statusCode = 404
    throw error
  }

  suggestion.status = 'archived'
  suggestion.reviewedBy = reviewerId || null
  suggestion.reviewedAt = new Date()

  await suggestion.save()

  return suggestion.toObject()
}