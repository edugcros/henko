// 📁 src/services/aiAgent/aiAgentLearningService.js
// VERSIÓN PRODUCCIÓN - APRENDIZAJE CONVERSACIONAL / MEMORIA / SUGERENCIAS HUMAN-IN-THE-LOOP

import crypto from 'node:crypto'
import AiLearningSuggestion from '../../models/aiLearningSuggestionModel.js'
import AiKnowledge from '../../models/aiKnowledgeModel.js'

const clean = value => String(value || '').trim()

const FINAL_SUGGESTION_STATUSES = new Set(['approved', 'rejected'])
const MUTABLE_SUGGESTION_STATUSES = ['pending_review', 'archived', 'approving']

const GENERIC_FALLBACK_PATTERNS = [
  /encontre estas opciones/i,
  /encontré estas opciones/i,
  /opciones del catalogo/i,
  /opciones del catálogo/i,
  /no encontre informacion suficiente/i,
  /no encontré información suficiente/i,
  /no tengo informacion/i,
  /no tengo información/i,
  /no puedo confirmar/i,
  /consultar con (un )?asesor/i,
  /un asesor podra ayudarte/i,
  /un asesor podrá ayudarte/i,
  /podrias decirme que producto/i,
  /podrías decirme qué producto/i,
]

const FOLLOW_UP_PATTERNS = [
  /\bese\b/i,
  /\besa\b/i,
  /\besos\b/i,
  /\besas\b/i,
  /\beste\b/i,
  /\besta\b/i,
  /\banterior\b/i,
  /\blo mismo\b/i,
  /\bigual\b/i,
  /\bmas barato\b/i,
  /\bmás barato\b/i,
  /\bmas caro\b/i,
  /\bmás caro\b/i,
  /\ben negro\b/i,
  /\ben blanco\b/i,
  /\ben rojo\b/i,
  /\ben azul\b/i,
  /\btalle\b/i,
  /\bcolor\b/i,
  /\bmedida\b/i,
  /\bcuotas?\b/i,
  /\benvio\b/i,
  /\benvío\b/i,
  /\bgarantia\b/i,
  /\bgarantía\b/i,
  /\by\s+/i,
]

const normalize = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const hash = value => {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
}

const clampNumber = ({ value, min = 0, max = 1, fallback = 0 } = {}) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, min), max)
}

const unique = values => {
  const seen = new Set()

  return (Array.isArray(values) ? values : [])
    .map(value => clean(value))
    .filter(Boolean)
    .filter(value => {
      const key = normalize(value)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const tokenize = value => {
  const stopWords = new Set([
    'para',
    'pero',
    'como',
    'cuando',
    'donde',
    'cuanto',
    'cual',
    'cuales',
    'este',
    'esta',
    'estos',
    'estas',
    'tengo',
    'tienen',
    'tenes',
    'quiero',
    'busco',
    'necesito',
    'podria',
    'podrias',
    'puedo',
    'algo',
    'sobre',
    'producto',
    'productos',
  ])

  return normalize(value)
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !stopWords.has(token))
}

const toPlainObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value === 'object' && !Array.isArray(value)) return value
  return {}
}

const shouldProtectSuggestionFromAutoMutation = suggestion => {
  return FINAL_SUGGESTION_STATUSES.has(suggestion?.status)
}

const getConversationMessages = conversation => {
  return Array.isArray(conversation?.messages) ? conversation.messages : []
}

const getRecentMessages = (conversation, limit = 12) => {
  return getConversationMessages(conversation)
    .slice(-limit)
    .filter(message => clean(message?.content))
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: clean(message.content),
      createdAt: message.createdAt || null,
      metadata: message.metadata || {},
    }))
}

const getRecentAssistantMessages = conversation => {
  return getRecentMessages(conversation, 12).filter(message => message.role === 'assistant')
}

const getRecentUserMessages = conversation => {
  return getRecentMessages(conversation, 12).filter(message => message.role !== 'assistant')
}

const getLastAssistantMessage = conversation => {
  return [...getRecentAssistantMessages(conversation)].reverse()[0] || null
}

const getPreviousUserMessage = conversation => {
  const userMessages = getRecentUserMessages(conversation)
  return userMessages.length >= 2 ? userMessages[userMessages.length - 2] : null
}

const buildConversationSummary = conversation => {
  const messages = getRecentMessages(conversation, 8)
  if (!messages.length) return ''

  return messages
    .map(message => {
      const role = message.role === 'assistant' ? 'Asistente' : 'Cliente'
      return `${role}: ${clean(message.content).slice(0, 220)}`
    })
    .join('\n')
}

const isGenericFallbackText = text => {
  const value = clean(text)
  if (!value) return false
  return GENERIC_FALLBACK_PATTERNS.some(pattern => pattern.test(value))
}

const isCatalogDumpResponse = text => {
  const value = normalize(text)
  return (
    value.startsWith('encontre estas opciones') ||
    value.startsWith('encontre estas opciones del catalogo') ||
    value.startsWith('encontre estas opciones disponibles') ||
    value.startsWith('encontré estas opciones') ||
    value.includes('opciones del catalogo')
  )
}

const hasRepeatedAssistantText = ({ assistantText, conversation }) => {
  const normalizedAssistantText = normalize(assistantText)
  if (!normalizedAssistantText || normalizedAssistantText.length < 40) return false

  return getRecentAssistantMessages(conversation).some(message => {
    const previous = normalize(message.content)
    if (!previous || previous.length < 40) return false
    if (previous === normalizedAssistantText) return true

    const currentTokens = new Set(tokenize(normalizedAssistantText))
    const previousTokens = new Set(tokenize(previous))
    const overlap = [...currentTokens].filter(token => previousTokens.has(token)).length
    const denominator = Math.max(1, Math.min(currentTokens.size, previousTokens.size))

    return overlap / denominator >= 0.86
  })
}

const detectQuestionSubtype = text => {
  const value = normalize(text)

  if (/envio|envios|entrega|retirar|retiro|domicilio|shipping|despacho/.test(value)) {
    return 'shipping_policy'
  }

  if (/pago|pagos|cuota|cuotas|financiacion|financiación|tarjeta|transferencia|mercado pago|mercadopago/.test(value)) {
    return 'payment_policy'
  }

  if (/garantia|garantía/.test(value)) {
    return 'warranty_policy'
  }

  if (/devolucion|devolución|cambio|reembolso|documentacion|patentamiento|papeles/.test(value)) {
    return 'returns_policy'
  }

  if (/descuento|cupon|cupón|promo|promocion|promoción|oferta/.test(value)) {
    return 'promotion'
  }

  if (/stock|disponible|hay|queda|quedan/.test(value)) {
    return 'stock'
  }

  if (/precio|cuanto|cuánto|vale|sale|cuesta|barato|caro|presupuesto/.test(value)) {
    return 'price'
  }

  if (/color|talle|talla|medida|presentacion|presentación|capacidad|litro|ml|gb|ram|almacenamiento/.test(value)) {
    return 'variant_or_specification'
  }

  if (/compar|diferencia|conviene|mejor|recomendas|recomendás|recomienda/.test(value)) {
    return 'comparison'
  }

  if (/comprar|carrito|checkout|link|finalizar|quiero llevar|lo llevo|reservar/.test(value)) {
    return 'purchase_intent'
  }

  if (/no encontre|no encontré|no tenes|no tienen|busco|quiero algo|necesito algo/.test(value)) {
    return 'product_gap'
  }

  if (FOLLOW_UP_PATTERNS.some(pattern => pattern.test(text))) {
    return 'conversation_follow_up'
  }

  return 'general'
}

const detectQuestionType = text => {
  const subtype = detectQuestionSubtype(text)

  if (
    [
      'shipping_policy',
      'payment_policy',
      'warranty_policy',
      'returns_policy',
    ].includes(subtype)
  ) {
    return 'policy_gap'
  }

  if (subtype === 'product_gap') return 'product_gap'

  if (
    [
      'stock',
      'price',
      'variant_or_specification',
      'promotion',
      'comparison',
      'purchase_intent',
      'conversation_follow_up',
    ].includes(subtype)
  ) {
    return 'faq_suggestion'
  }

  return 'general'
}

const isQuestionLike = text => {
  const raw = clean(text)
  const value = normalize(text)

  if (!value || value.length < 3) return false

  return (
    raw.includes('?') ||
    /^(que|qué|como|cómo|cuando|cuándo|donde|dónde|cuanto|cuánto|hay|tenes|tienen|puedo|necesito|quiero|busco|me interesa|me sirve|sirve|y\b)/i.test(
      value,
    ) ||
    FOLLOW_UP_PATTERNS.some(pattern => pattern.test(raw))
  )
}

const detectConversationContinuity = ({ userText, conversation }) => {
  const text = clean(userText)
  const normalized = normalize(text)
  const previousUserMessage = getPreviousUserMessage(conversation)
  const lastAssistantMessage = getLastAssistantMessage(conversation)
  const hasPriorContext = Boolean(previousUserMessage || lastAssistantMessage)
  const shortFollowUp = normalized.length > 0 && normalized.length <= 60
  const explicitFollowUp = FOLLOW_UP_PATTERNS.some(pattern => pattern.test(text))

  return {
    isFollowUp: hasPriorContext && (explicitFollowUp || shortFollowUp),
    explicitFollowUp,
    previousUserText: previousUserMessage?.content || '',
    lastAssistantText: lastAssistantMessage?.content || '',
    conversationSummary: buildConversationSummary(conversation),
  }
}

const getProductTitle = product => {
  return (
    clean(product?.title) ||
    clean(product?.name) ||
    clean(product?.nombre) ||
    clean(product?.slug) ||
    ''
  )
}

const buildProductsSummary = products => {
  return (Array.isArray(products) ? products : [])
    .slice(0, 6)
    .map(product => {
      const title = getProductTitle(product)
      const brand = clean(product?.brand || product?.marca)
      const category = clean(product?.category || product?.categoria)
      const stock = product?.stock ?? product?.totalStock ?? ''
      const price = product?.formattedPrice || product?.price || ''
      const variants = Array.isArray(product?.variants)
        ? product.variants
          .slice(0, 4)
          .map(variant => {
            const attributes = toPlainObject(variant?.attributes || variant?.combinacion)
            const attrText = Object.entries(attributes)
              .map(([key, value]) => `${key}:${value}`)
              .join('/')
            return [variant?.sku, attrText, `stock:${variant?.stock ?? 0}`]
              .filter(Boolean)
              .join(' ')
          })
          .filter(Boolean)
          .join(' | ')
        : ''

      return [title, brand, category, price ? `precio:${price}` : '', stock !== '' ? `stock:${stock}` : '', variants]
        .filter(Boolean)
        .join(' · ')
    })
    .join('\n')
}

const extractProductIds = products => {
  return (Array.isArray(products) ? products : [])
    .map(product => String(product?.id || product?._id || product?.productId || ''))
    .filter(Boolean)
    .slice(0, 10)
}

const extractProductNames = products => {
  return unique((Array.isArray(products) ? products : []).map(getProductTitle)).slice(0, 10)
}

const normalizeActions = actions => (Array.isArray(actions) ? actions : [])

const normalizeValidation = validation => {
  if (!validation || typeof validation !== 'object') return null

  return {
    shouldFallback: Boolean(validation.shouldFallback),
    riskLevel: clean(validation.riskLevel || ''),
    score: Number.isFinite(Number(validation.score)) ? Number(validation.score) : null,
    warnings: Array.isArray(validation.warnings) ? validation.warnings : [],
    hardWarnings: Array.isArray(validation.hardWarnings) ? validation.hardWarnings : [],
    softWarnings: Array.isArray(validation.softWarnings) ? validation.softWarnings : [],
    blockedReasons: Array.isArray(validation.blockedReasons)
      ? validation.blockedReasons
      : [],
    learningSignals: Array.isArray(validation.learningSignals)
      ? validation.learningSignals
      : [],
  }
}

const analyzeResponseQuality = ({
  userText,
  assistantText,
  conversation,
  products,
  actions,
  validation,
}) => {
  const cleanUserText = clean(userText)
  const cleanAssistantText = clean(assistantText)
  const normalizedAssistant = normalize(cleanAssistantText)
  const hasActions = normalizeActions(actions).length > 0
  const hasProducts = Array.isArray(products) && products.length > 0
  const questionLike = isQuestionLike(cleanUserText)
  const continuity = detectConversationContinuity({ userText, conversation })
  const genericFallback = isGenericFallbackText(cleanAssistantText)
  const catalogDump = isCatalogDumpResponse(cleanAssistantText)
  const repeated = hasRepeatedAssistantText({ assistantText: cleanAssistantText, conversation })
  const validationInfo = normalizeValidation(validation)
  const shortUnhelpful = questionLike && normalizedAssistant.length > 0 && normalizedAssistant.length < 18

  const issues = []

  if (!cleanAssistantText) issues.push('empty_assistant_response')
  if (genericFallback) issues.push('generic_fallback_response')
  if (catalogDump) issues.push('catalog_dump_response')
  if (repeated) issues.push('repeated_assistant_response')
  if (shortUnhelpful) issues.push('too_short_for_user_question')
  if (continuity.isFollowUp && genericFallback) issues.push('follow_up_lost_context')
  if (continuity.isFollowUp && catalogDump) issues.push('follow_up_answered_as_new_search')
  if (questionLike && !hasActions && !hasProducts && genericFallback) issues.push('question_unresolved')

  if (validationInfo?.shouldFallback) issues.push('validator_requested_fallback')
  for (const reason of validationInfo?.blockedReasons || []) issues.push(`blocked:${reason}`)
  for (const warning of validationInfo?.hardWarnings || []) issues.push(`hard_warning:${warning}`)

  const severe = issues.some(issue => {
    return (
      issue.startsWith('blocked:') ||
      issue.startsWith('hard_warning:') ||
      [
        'empty_assistant_response',
        'follow_up_lost_context',
        'validator_requested_fallback',
      ].includes(issue)
    )
  })

  const scorePenalty = Math.min(0.75, issues.length * 0.12 + (severe ? 0.2 : 0))
  const score = clampNumber({ value: 1 - scorePenalty, min: 0, max: 1, fallback: 0.5 })

  return {
    ok: issues.length === 0,
    score,
    severe,
    issues,
    questionLike,
    genericFallback,
    catalogDump,
    repeated,
    hasActions,
    hasProducts,
    continuity,
    validation: validationInfo,
  }
}

const buildPriority = ({ confidence, handoffRequired, leadScore, quality }) => {
  if (quality?.severe && handoffRequired && leadScore >= 70) return 'critical'
  if (quality?.severe || handoffRequired) return 'high'
  if (confidence >= 0.78 || leadScore >= 65) return 'high'
  if (confidence >= 0.55 || quality?.continuity?.isFollowUp) return 'medium'
  return 'low'
}

const buildCanonicalQuestion = ({ userText, quality, subtype }) => {
  const normalizedQuestion = normalize(userText)
  const tokens = tokenize(userText)

  if (quality?.continuity?.isFollowUp) {
    const previousTokens = tokenize(
      `${quality.continuity.previousUserText} ${quality.continuity.lastAssistantText}`,
    ).slice(0, 10)
    return normalize(
      [subtype, ...previousTokens, ...tokens].filter(Boolean).join(' '),
    ).slice(0, 400)
  }

  return normalizedQuestion.slice(0, 400)
}

const buildFingerprint = ({ tenantId, type, normalizedQuestion, subtype }) => {
  return hash(`${tenantId}:${type}:${subtype || 'general'}:${normalizedQuestion}`).slice(0, 40)
}

const buildSuggestedAnswer = ({
  userText,
  assistantText,
  handoffRequired,
  quality,
  products,
}) => {
  const cleanAssistantText = clean(assistantText)

  if (
    cleanAssistantText &&
    !handoffRequired &&
    !quality?.genericFallback &&
    !quality?.catalogDump &&
    !quality?.repeated &&
    !quality?.severe
  ) {
    return cleanAssistantText.slice(0, 1800)
  }

  const lines = [
    `Pregunta detectada: ${clean(userText)}`,
    '',
  ]

  if (quality?.continuity?.isFollowUp) {
    lines.push('Contexto conversacional detectado:')
    lines.push(quality.continuity.conversationSummary || 'Hay mensajes previos relacionados.')
    lines.push('')
  }

  const productSummary = buildProductsSummary(products)
  if (productSummary) {
    lines.push('Productos/contexto disponible al momento de la consulta:')
    lines.push(productSummary)
    lines.push('')
  }

  if (quality?.issues?.length) {
    lines.push(`Problemas detectados en la respuesta automática: ${quality.issues.join(', ')}`)
    lines.push('')
  }

  lines.push('Respuesta sugerida pendiente de completar o ajustar por el administrador.')
  lines.push(
    'Aprobá esta sugerencia cuando la respuesta sea correcta para el comercio y útil para consultas futuras similares.',
  )

  return lines.join('\n').slice(0, 2200)
}

const buildTags = ({ type, userText, intent, subtype, quality }) => {
  const tokens = tokenize(userText).slice(0, 8)

  return unique([
    type,
    intent,
    subtype,
    quality?.continuity?.isFollowUp ? 'follow_up' : '',
    quality?.genericFallback ? 'generic_fallback' : '',
    quality?.catalogDump ? 'catalog_dump' : '',
    quality?.repeated ? 'repeated_answer' : '',
    ...tokens,
  ])
}

const shouldCreateSuggestion = ({
  userText,
  assistantText,
  handoffRequired,
  actions,
  products,
  conversation,
  validation,
}) => {
  const cleanUserText = clean(userText)

  if (!cleanUserText) {
    return {
      create: false,
      quality: analyzeResponseQuality({
        userText,
        assistantText,
        conversation,
        products,
        actions,
        validation,
      }),
      reason: 'empty_user_text',
    }
  }

  const quality = analyzeResponseQuality({
    userText,
    assistantText,
    conversation,
    products,
    actions,
    validation,
  })

  if (handoffRequired) return { create: true, quality, reason: 'handoff_required' }
  if (quality.severe) return { create: true, quality, reason: 'severe_response_quality_issue' }
  if (quality.genericFallback) return { create: true, quality, reason: 'generic_fallback_response' }
  if (quality.catalogDump) return { create: true, quality, reason: 'catalog_dump_response' }
  if (quality.repeated && quality.questionLike) return { create: true, quality, reason: 'repeated_answer' }
  if (quality.continuity.isFollowUp && !quality.ok) return { create: true, quality, reason: 'follow_up_needs_learning' }
  if (quality.questionLike && !clean(assistantText)) return { create: true, quality, reason: 'question_without_answer' }

  const hasActions = normalizeActions(actions).length > 0
  const hasProducts = Array.isArray(products) && products.length > 0

  if (quality.questionLike && !hasActions && !hasProducts) {
    return { create: true, quality, reason: 'question_without_catalog_or_action_context' }
  }

  if (
    /no tengo informacion|no tengo información|no puedo confirmar|consultar con un asesor|un asesor/.test(
      normalize(assistantText),
    )
  ) {
    return { create: true, quality, reason: 'assistant_declared_missing_information' }
  }

  return { create: false, quality, reason: 'answer_looked_useful' }
}

const buildConfidence = ({ handoffRequired, leadScore, actions, quality }) => {
  const actionScore = normalizeActions(actions).length === 0 ? 0.12 : 0
  const leadComponent = leadScore >= 70 ? 0.25 : leadScore >= 50 ? 0.16 : 0.06
  const questionComponent = quality?.questionLike ? 0.2 : 0.06
  const handoffComponent = handoffRequired ? 0.22 : 0
  const qualityComponent = quality?.severe ? 0.22 : quality?.ok ? 0.05 : 0.14
  const followUpComponent = quality?.continuity?.isFollowUp ? 0.12 : 0

  return clampNumber({
    value:
      0.25 +
      actionScore +
      leadComponent +
      questionComponent +
      handoffComponent +
      qualityComponent +
      followUpComponent,
    min: 0.35,
    max: 0.96,
    fallback: 0.55,
  })
}

const buildLearningSignalsMetadata = ({ validation, extraLearningSignals }) => {
  const validationInfo = normalizeValidation(validation)
  const explicitSignals = Array.isArray(extraLearningSignals) ? extraLearningSignals : []

  return unique([
    ...(validationInfo?.learningSignals || []).map(signal =>
      typeof signal === 'string' ? signal : signal?.type || signal?.key || '',
    ),
    ...explicitSignals.map(signal =>
      typeof signal === 'string' ? signal : signal?.type || signal?.key || '',
    ),
  ]).slice(0, 20)
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
  productsOfInterest = [],
  preferences = {},
  validation = null,
  learningSignals = [],
  commerceContext = null,
} = {}) => {
  if (!tenantId || !clean(userText)) return null

  const decision = shouldCreateSuggestion({
    userText,
    assistantText,
    handoffRequired,
    actions,
    products,
    conversation,
    validation,
  })

  if (!decision.create) return null

  const quality = decision.quality
  const type = detectQuestionType(userText)
  const subtype = detectQuestionSubtype(userText)
  const normalizedQuestion = buildCanonicalQuestion({
    userText,
    quality,
    subtype,
  })

  if (!normalizedQuestion) return null

  const confidence = buildConfidence({
    handoffRequired,
    leadScore,
    actions,
    quality,
  })

  const fingerprint = buildFingerprint({
    tenantId,
    type,
    subtype,
    normalizedQuestion,
  })

  const conversationId = conversation?._id || conversation?.id || null
  const productIds = unique([
    ...extractProductIds(products),
    ...extractProductIds(productsOfInterest),
  ]).slice(0, 12)
  const productNames = unique([
    ...extractProductNames(products),
    ...extractProductNames(productsOfInterest),
  ]).slice(0, 12)
  const actionTypes = normalizeActions(actions)
    .map(action => clean(action?.type))
    .filter(Boolean)
    .slice(0, 10)
  const validationInfo = normalizeValidation(validation)
  const signalTypes = buildLearningSignalsMetadata({
    validation,
    extraLearningSignals: learningSignals,
  })

  const payload = {
    tenantId,
    type,
    title: clean(userText).slice(0, 160),
    question: clean(userText).slice(0, 500),
    suggestedAnswer: buildSuggestedAnswer({
      userText,
      assistantText,
      handoffRequired,
      quality,
      products,
    }),
    normalizedQuestion,
    fingerprint,
    confidence,
    priority: buildPriority({
      confidence,
      handoffRequired,
      leadScore,
      quality,
    }),
    tags: buildTags({ type, userText, intent, subtype, quality }),
    metadata: {
      intent,
      intentSubtype: subtype,
      leadScore,
      channel: conversation?.channel || 'webchat',
      creationReason: decision.reason,
      sampleUserText: clean(userText).slice(0, 1000),
      sampleAssistantText: clean(assistantText).slice(0, 1800),
      productIds,
      productNames,
      actionTypes,
      responseQuality: {
        ok: quality.ok,
        score: quality.score,
        severe: quality.severe,
        issues: quality.issues,
        genericFallback: quality.genericFallback,
        catalogDump: quality.catalogDump,
        repeated: quality.repeated,
      },
      conversationContinuity: {
        isFollowUp: quality.continuity.isFollowUp,
        explicitFollowUp: quality.continuity.explicitFollowUp,
        previousUserText: clean(quality.continuity.previousUserText).slice(0, 500),
        lastAssistantText: clean(quality.continuity.lastAssistantText).slice(0, 800),
        summary: clean(quality.continuity.conversationSummary).slice(0, 1800),
      },
      validation: validationInfo
        ? {
          shouldFallback: validationInfo.shouldFallback,
          riskLevel: validationInfo.riskLevel,
          score: validationInfo.score,
          warnings: validationInfo.warnings,
          hardWarnings: validationInfo.hardWarnings,
          softWarnings: validationInfo.softWarnings,
          blockedReasons: validationInfo.blockedReasons,
        }
        : null,
      learningSignals: signalTypes,
      preferences:
        preferences && typeof preferences === 'object' && !Array.isArray(preferences)
          ? preferences
          : {},
      catalogSnapshot: commerceContext?.catalogSnapshot
        ? {
          totalProducts: commerceContext.catalogSnapshot.totalProducts,
          activeProducts: commerceContext.catalogSnapshot.activeProducts,
          visibleProducts: commerceContext.catalogSnapshot.visibleProducts,
          withStock: commerceContext.catalogSnapshot.withStock,
          categories: Array.isArray(commerceContext.catalogSnapshot.categories)
            ? commerceContext.catalogSnapshot.categories.slice(0, 20)
            : [],
          brands: Array.isArray(commerceContext.catalogSnapshot.brands)
            ? commerceContext.catalogSnapshot.brands.slice(0, 20)
            : [],
        }
        : null,
    },
  }

  const update = {
    $setOnInsert: payload,
    $inc: {
      'signals.occurrences': 1,
      ...(handoffRequired ? { 'signals.handoffs': 1 } : {}),
      ...(quality.genericFallback ? { 'signals.genericFallbacks': 1 } : {}),
      ...(quality.catalogDump ? { 'signals.catalogDumps': 1 } : {}),
      ...(quality.repeated ? { 'signals.repeatedAnswers': 1 } : {}),
      ...(quality.continuity.isFollowUp ? { 'signals.followUps': 1 } : {}),
    },
    $addToSet: {
      ...(conversationId ? { sourceConversationIds: conversationId } : {}),
      tags: { $each: payload.tags },
    },
    $max: {
      confidence,
    },
    $set: {
      priority: payload.priority,
      question: payload.question,
      suggestedAnswer: payload.suggestedAnswer,
      'metadata.intent': payload.metadata.intent,
      'metadata.intentSubtype': payload.metadata.intentSubtype,
      'metadata.leadScore': payload.metadata.leadScore,
      'metadata.creationReason': payload.metadata.creationReason,
      'metadata.sampleUserText': payload.metadata.sampleUserText,
      'metadata.sampleAssistantText': payload.metadata.sampleAssistantText,
      'metadata.productIds': payload.metadata.productIds,
      'metadata.productNames': payload.metadata.productNames,
      'metadata.actionTypes': payload.metadata.actionTypes,
      'metadata.responseQuality': payload.metadata.responseQuality,
      'metadata.conversationContinuity': payload.metadata.conversationContinuity,
      'metadata.validation': payload.metadata.validation,
      'metadata.learningSignals': payload.metadata.learningSignals,
      'metadata.preferences': payload.metadata.preferences,
      'metadata.catalogSnapshot': payload.metadata.catalogSnapshot,
      updatedAt: new Date(),
    },
  }

  const existingSuggestion = await AiLearningSuggestion.findOne({
    tenantId,
    fingerprint,
  })
    .setOptions({ tenantId })
    .lean()

  if (shouldProtectSuggestionFromAutoMutation(existingSuggestion)) {
    return existingSuggestion
  }

  try {
    return await AiLearningSuggestion.findOneAndUpdate(
      {
        tenantId,
        fingerprint,
        status: { $in: MUTABLE_SUGGESTION_STATUSES },
      },
      update,
      {
        upsert: !existingSuggestion,
        new: true,
        setDefaultsOnInsert: true,
      },
    )
      .setOptions({ tenantId })
      .lean()
  } catch (error) {
    if (error?.code !== 11000) throw error
    return AiLearningSuggestion.findOne({ tenantId, fingerprint })
      .setOptions({ tenantId })
      .lean()
  }
}

const normalizeKnowledgeTags = ({ tags, fallbackTags }) => {
  return unique([
    ...(Array.isArray(tags) ? tags : []),
    ...(Array.isArray(fallbackTags) ? fallbackTags : []),
  ]).slice(0, 30)
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
    status: { $in: ['pending_review', 'archived'] },
  }).setOptions({ tenantId })

  if (!suggestion) {
    const existingApproved = await AiLearningSuggestion.findOne({
      _id: suggestionId,
      tenantId,
      status: 'approved',
      approvedKnowledgeId: { $ne: null },
    }).setOptions({ tenantId })

    if (existingApproved) return existingApproved.toObject()

    const error = new Error('Sugerencia no encontrada')
    error.statusCode = 404
    throw error
  }

  const previousStatus = suggestion.status
  const knowledgeTitle = clean(title) || suggestion.title
  const knowledgeContent = clean(content) || suggestion.suggestedAnswer

  if (!knowledgeTitle || !knowledgeContent) {
    const error = new Error('Título y contenido son obligatorios para aprobar')
    error.statusCode = 400
    throw error
  }

  const claimedSuggestion = await AiLearningSuggestion.findOneAndUpdate(
    {
      _id: suggestionId,
      tenantId,
      status: previousStatus,
    },
    {
      $set: {
        status: 'approving',
        reviewedBy: reviewerId || null,
        reviewedAt: new Date(),
      },
    },
    { new: true },
  ).setOptions({ tenantId })

  if (!claimedSuggestion) {
    const error = new Error('La sugerencia cambió mientras se procesaba la aprobación')
    error.statusCode = 409
    throw error
  }

  try {
    const knowledge = await AiKnowledge.create({
      tenantId,
      type: 'learning_suggestion',
      source: 'conversation',
      title: knowledgeTitle,
      content: knowledgeContent,
      tags: normalizeKnowledgeTags({
        tags,
        fallbackTags: claimedSuggestion.tags,
      }),
      status: 'approved',
      approvedBy: reviewerId || null,
      approvedAt: new Date(),
      relatedSuggestionId: claimedSuggestion._id,
      relatedConversationId: claimedSuggestion.sourceConversationIds?.[0] || null,
      metadata: {
        approvedFromSuggestion: true,
        suggestionType: claimedSuggestion.type,
        suggestionFingerprint: claimedSuggestion.fingerprint,
        intent: claimedSuggestion.metadata?.intent || '',
        intentSubtype: claimedSuggestion.metadata?.intentSubtype || '',
        creationReason: claimedSuggestion.metadata?.creationReason || '',
        responseQuality: claimedSuggestion.metadata?.responseQuality || null,
        conversationContinuity: claimedSuggestion.metadata?.conversationContinuity || null,
        productIds: claimedSuggestion.metadata?.productIds || [],
        productNames: claimedSuggestion.metadata?.productNames || [],
      },
    })

    const approvedSuggestion = await AiLearningSuggestion.findOneAndUpdate(
      { _id: claimedSuggestion._id, tenantId, status: 'approving' },
      {
        $set: {
          status: 'approved',
          approvedAt: new Date(),
          approvedKnowledgeId: knowledge._id,
          title: knowledgeTitle,
          suggestedAnswer: knowledgeContent,
        },
      },
      { new: true },
    )
      .setOptions({ tenantId })
      .lean()

    if (!approvedSuggestion) {
      await AiKnowledge.deleteOne({
        _id: knowledge._id,
        tenantId,
      }).setOptions({ tenantId })

      const conflictError = new Error(
        'La sugerencia cambió mientras se procesaba la aprobación',
      )
      conflictError.statusCode = 409
      throw conflictError
    }

    return approvedSuggestion
  } catch (error) {
    await AiLearningSuggestion.updateOne(
      { _id: claimedSuggestion._id, tenantId, status: 'approving' },
      { $set: { status: previousStatus || 'pending_review' } },
    ).setOptions({ tenantId })
    throw error
  }
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
    status: { $in: ['pending_review', 'archived'] },
  }).setOptions({ tenantId })

  if (!suggestion) {
    const error = new Error('Sugerencia no encontrada')
    error.statusCode = 404
    throw error
  }

  suggestion.status = 'rejected'
  suggestion.reviewedBy = reviewerId || null
  suggestion.reviewedAt = new Date()
  suggestion.rejectedAt = new Date()
  suggestion.rejectionReason = clean(reason).slice(0, 1000)

  await suggestion.save({ tenantId })

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
    status: { $in: ['pending_review', 'rejected'] },
  }).setOptions({ tenantId })

  if (!suggestion) {
    const error = new Error('Sugerencia no encontrada')
    error.statusCode = 404
    throw error
  }

  suggestion.status = 'archived'
  suggestion.reviewedBy = reviewerId || null
  suggestion.reviewedAt = new Date()
  suggestion.archivedAt = new Date()

  await suggestion.save({ tenantId })

  return suggestion.toObject()
}

export const buildLearningDebugSnapshot = ({
  userText,
  assistantText,
  conversation,
  products = [],
  actions = [],
  validation = null,
} = {}) => {
  const quality = analyzeResponseQuality({
    userText,
    assistantText,
    conversation,
    products,
    actions,
    validation,
  })

  return {
    type: detectQuestionType(userText),
    subtype: detectQuestionSubtype(userText),
    questionLike: isQuestionLike(userText),
    quality,
    normalizedQuestion: buildCanonicalQuestion({
      userText,
      quality,
      subtype: detectQuestionSubtype(userText),
    }),
  }
}

export default {
  registerConversationLearningSignal,
  approveLearningSuggestion,
  rejectLearningSuggestion,
  archiveLearningSuggestion,
  buildLearningDebugSnapshot,
}
