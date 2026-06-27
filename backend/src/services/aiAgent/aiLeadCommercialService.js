// 📁 src/services/aiAgent/aiLeadCommercialService.js
import mongoose from 'mongoose'
import AiLead from '../../models/aiLeadModel.js'

const { Types } = mongoose

export const AI_LEAD_STATUS = Object.freeze({
  NEW: 'new',
  QUALIFIED: 'qualified',
  HOT: 'hot',
  FOLLOW_UP: 'follow_up',
  WON: 'won',
  LOST: 'lost',
  DISCARDED: 'discarded',
})

export const AI_LEAD_INTENT = Object.freeze({
  UNKNOWN: 'unknown',
  SUPPORT: 'support',
  BROWSE: 'browse',
  COMPARE: 'compare',
  PRICE_CHECK: 'price_check',
  STOCK_QUESTION: 'stock_question',
  SHIPPING_QUESTION: 'shipping_question',
  POLICY_QUESTION: 'policy_question',
  PROMOTION: 'promotion',
  PURCHASE_INTENT: 'purchase_intent',
  CHECKOUT_INTENT: 'checkout_intent',
  POST_SALE: 'post_sale',
})

const FINAL_STATUSES = new Set([
  AI_LEAD_STATUS.WON,
  AI_LEAD_STATUS.LOST,
  AI_LEAD_STATUS.DISCARDED,
])

const clean = value => String(value || '').trim()
const lower = value => clean(value).toLowerCase()

const uniqueCleanValues = (values, maxItems = 20) => {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(value => clean(value))
        .filter(Boolean),
    ),
  ].slice(0, maxItems)
}

const sanitizeMetadata = metadata => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return Object.entries(metadata).reduce((acc, [key, value]) => {
    const cleanKey = clean(key).slice(0, 80)
    if (!cleanKey) return acc

    if (value == null) return acc

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      acc[cleanKey] = typeof value === 'string' ? clean(value).slice(0, 1000) : value
    }

    return acc
  }, {})
}

const clampScore = value => {
  const score = Number(value || 0)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}

const isValidObjectId = value => Types.ObjectId.isValid(String(value || ''))

const toObjectIdOrNull = value => {
  if (!value) return null
  return isValidObjectId(value) ? new Types.ObjectId(String(value)) : null
}

const normalizeTextForMatch = value => {
  return lower(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s._-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const includesNormalized = (text, needle) => {
  const cleanText = normalizeTextForMatch(text)
  const cleanNeedle = normalizeTextForMatch(needle)

  if (!cleanText || !cleanNeedle) return false
  if (cleanNeedle.length < 3) return false

  return cleanText.includes(cleanNeedle)
}

const getProductIdentityValues = product => {
  return [
    product?._id,
    product?.id,
    product?.productId,
    product?.slug,
    product?.sku,
    product?.variantSku,
    product?.variantSKU,
    product?.title,
    product?.name,
    product?.nombre,
  ]
    .map(value => clean(value))
    .filter(Boolean)
}

const getProductIdentityKey = product => {
  const productId = clean(product?.productId || product?._id || product?.id)
  const slug = lower(product?.slug)
  const sku = lower(product?.sku || product?.variantSku || product?.variantSKU)
  const title = normalizeTextForMatch(
    product?.title || product?.name || product?.nombre,
  )

  return productId || slug || sku || title
}

const uniqueProductsByIdentity = products => {
  const seen = new Set()

  return (products || []).filter(product => {
    const key = getProductIdentityKey(product)

    if (!key) return false
    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
}

const normalizeCustomer = ({
  conversation,
  customerName,
  customerEmail,
  customerPhone,
} = {}) => {
  return {
    name: clean(
      customerName ||
        conversation?.customer?.name ||
        conversation?.customerName,
    ),
    email: lower(
      customerEmail ||
        conversation?.customer?.email ||
        conversation?.customerEmail,
    ),
    phone: clean(
      customerPhone ||
        conversation?.customer?.phone ||
        conversation?.customerPhone,
    ),
  }
}

const mergeCustomerForUpdate = ({ existingLead, nextCustomer }) => {
  const existingCustomer = existingLead?.customer || {}

  return {
    name: clean(nextCustomer.name || existingCustomer.name),
    email: lower(nextCustomer.email || existingCustomer.email),
    phone: clean(nextCustomer.phone || existingCustomer.phone),
  }
}

export const detectLeadIntentFromText = value => {
  const text = lower(value)

  if (!text) {
    return {
      intent: AI_LEAD_INTENT.UNKNOWN,
      intentScore: 0,
      leadScore: 0,
    }
  }

  let intent = AI_LEAD_INTENT.BROWSE
  let intentScore = 10
  let leadScore = 10

  const add = (points, nextIntent) => {
    intentScore += points
    leadScore += points

    if (nextIntent) {
      intent = nextIntent
    }
  }

  if (
    /comprar|lo quiero|quiero pagar|pagar|checkout|finalizar compra|reservar|seña|señar/.test(
      text,
    )
  ) {
    add(35, AI_LEAD_INTENT.CHECKOUT_INTENT)
  }

  if (/precio|cu[aá]nto sale|cuanto sale|valor|costo|sale/.test(text)) {
    add(18, AI_LEAD_INTENT.PRICE_CHECK)
  }

  if (
    /cuotas|financiaci[oó]n|financiar|tarjeta|mercado pago|mercadopago|transferencia/.test(
      text,
    )
  ) {
    add(22, AI_LEAD_INTENT.PURCHASE_INTENT)
  }

  if (/stock|disponible|ten[eé]s|hay|queda|quedan/.test(text)) {
    add(16, AI_LEAD_INTENT.STOCK_QUESTION)
  }

  if (/env[ií]o|envio|retirar|entrega|delivery|correo|despacho/.test(text)) {
    add(12, AI_LEAD_INTENT.SHIPPING_QUESTION)
  }

  if (/cup[oó]n|cupon|descuento|promo|promoci[oó]n|oferta/.test(text)) {
    add(12, AI_LEAD_INTENT.PROMOTION)
  }

  if (/garant[ií]a|cambio|devoluci[oó]n|pol[ií]tica|reembolso/.test(text)) {
    add(8, AI_LEAD_INTENT.POLICY_QUESTION)
  }

  if (
    /asesor|vendedor|humano|llamar|whatsapp|contacto|hablar con alguien/.test(
      text,
    )
  ) {
    add(22, AI_LEAD_INTENT.PURCHASE_INTENT)
  }

  return {
    intent,
    intentScore: clampScore(intentScore),
    leadScore: clampScore(leadScore),
  }
}

const buildStatusFromLeadScore = ({ currentStatus, leadScore, hasContact }) => {
  if (FINAL_STATUSES.has(currentStatus)) {
    return currentStatus
  }

  if (leadScore >= 80) return AI_LEAD_STATUS.HOT
  if (leadScore >= 55 || hasContact) return AI_LEAD_STATUS.QUALIFIED

  return currentStatus || AI_LEAD_STATUS.NEW
}

const normalizeIntent = value => {
  const normalized = clean(value)

  if (!normalized) return ''

  const allowed = Object.values(AI_LEAD_INTENT)

  if (allowed.includes(normalized)) {
    return normalized
  }

  const legacyMap = {
    general_question: AI_LEAD_INTENT.BROWSE,
    price_question: AI_LEAD_INTENT.PRICE_CHECK,
    human_request: AI_LEAD_INTENT.PURCHASE_INTENT,
    cart_recovery: AI_LEAD_INTENT.CHECKOUT_INTENT,
    post_purchase: AI_LEAD_INTENT.POST_SALE,
    opt_out: AI_LEAD_INTENT.SUPPORT,
  }

  return legacyMap[normalized] || AI_LEAD_INTENT.UNKNOWN
}

const normalizeProductOfInterest = product => {
  if (!product) return null

  const productId = toObjectIdOrNull(
    product.productId || product._id || product.id,
  )
  const title = clean(product.title || product.name || product.nombre).slice(
    0,
    180,
  )
  const slug = clean(product.slug).slice(0, 180)
  const sku = clean(
    product.sku || product.variantSku || product.variantSKU,
  ).slice(0, 120)

  if (!productId && !title && !slug && !sku) return null

  return {
    productId,
    title,
    slug,
    sku,
    price: Math.max(
      Number(product.price || product.finalPrice || product.salePrice || 0) ||
        0,
      0,
    ),
    currency: clean(product.currency) || 'ARS',
    lastMentionedAt: product.lastMentionedAt
      ? new Date(product.lastMentionedAt)
      : new Date(),
  }
}

/**
 * Evita guardar productos falsos.
 * Solo devuelve productos realmente relacionados con la conversación:
 * - mencionados por el usuario,
 * - mencionados por la IA,
 * - usados en acciones view_product / add_to_cart / product_*,
 * - o enviados explícitamente como productsOfInterest.
 */
export const pickProductsOfInterest = ({
  userText = '',
  assistantText = '',
  actions = [],
  products = [],
  explicitProductsOfInterest = [],
} = {}) => {
  const normalizedText = `${userText || ''} ${assistantText || ''}`

  const actionProductRefs = new Set(
    (actions || [])
      .flatMap(action => [
        action?.productId,
        action?.id,
        action?._id,
        action?.slug,
        action?.sku,
        action?.variantSku,
        action?.variantSKU,
      ])
      .map(value => lower(value))
      .filter(Boolean),
  )

  const explicit = uniqueProductsByIdentity(explicitProductsOfInterest)
    .map(normalizeProductOfInterest)
    .filter(Boolean)

  const matched = uniqueProductsByIdentity(products)
    .filter(product => {
      const productRefs = getProductIdentityValues(product)
      const lowerRefs = productRefs.map(lower).filter(Boolean)

      const wasInAction = lowerRefs.some(ref => actionProductRefs.has(ref))

      if (wasInAction) return true

      const title = product.title || product.name || product.nombre
      const slug = product.slug
      const sku = product.sku || product.variantSku || product.variantSKU

      if (title && includesNormalized(normalizedText, title)) return true
      if (slug && includesNormalized(normalizedText, slug)) return true
      if (sku && includesNormalized(normalizedText, sku)) return true

      return false
    })
    .map(normalizeProductOfInterest)
    .filter(Boolean)

  return uniqueProductsByIdentity([...explicit, ...matched]).slice(0, 8)
}

const buildLeadLookup = ({ tenantId, conversation, customer }) => {
  const or = []
  const conversationId = conversation?._id || conversation?.id

  if (conversationId && isValidObjectId(conversationId)) {
    const objectId = new Types.ObjectId(String(conversationId))
    or.push({ conversationId: objectId })
    or.push({ lastConversationId: objectId })
  }

  if (customer?.email) {
    or.push({ 'customer.email': customer.email })
  }

  if (customer?.phone) {
    or.push({ 'customer.phone': customer.phone })
  }

  return {
    tenantId,
    deletedAt: { $exists: false },
    ...(or.length ? { $or: or } : { externalFallbackKey: '__no_match__' }),
  }
}

const buildExistingProductRefs = products => {
  return new Set(
    (products || [])
      .flatMap(product => [
        product?._id,
        product?.productId,
        product?.slug,
        product?.sku,
        product?.title,
      ])
      .map(value => lower(value))
      .filter(Boolean),
  )
}

const filterNewProductsOnly = ({
  existingProducts = [],
  nextProducts = [],
} = {}) => {
  const existingRefs = buildExistingProductRefs(existingProducts)

  return nextProducts.filter(product => {
    const refs = [
      product?._id,
      product?.productId,
      product?.slug,
      product?.sku,
      product?.title,
    ]
      .map(value => lower(value))
      .filter(Boolean)

    return !refs.some(ref => existingRefs.has(ref))
  })
}

export const upsertLeadFromConversation = async ({
  tenantId,
  conversation,
  customerName,
  customerEmail,
  customerPhone,
  message,
  assistantText = '',
  intent,
  intentScore,
  leadScore,
  products = [],
  productsOfInterest = [],
  actions = [],
  channel = 'webchat',
  preferences = {},
  metadata = {},
} = {}) => {
  if (!tenantId) return null

  const conversationId = toObjectIdOrNull(
    conversation?._id || conversation?.id,
  )

  const baseCustomer = normalizeCustomer({
    conversation,
    customerName,
    customerEmail,
    customerPhone,
  })

  const lookup = buildLeadLookup({
    tenantId,
    conversation,
    customer: baseCustomer,
  })

  const existingLead = await AiLead.findOne(lookup)
    .setOptions({ tenantId })
    .select(
      '_id status leadScore customer productsOfInterest preferences metadata',
    )
    .lean()

  const customer = mergeCustomerForUpdate({
    existingLead,
    nextCustomer: baseCustomer,
  })

  const textForIntent = `${message || ''} ${assistantText || ''}`
  const inferred = detectLeadIntentFromText(textForIntent)

  const normalizedIntent = normalizeIntent(intent) || inferred.intent
  const normalizedIntentScore = clampScore(intentScore ?? inferred.intentScore)
  const normalizedLeadScore = clampScore(leadScore ?? inferred.leadScore)

  const currentScore = clampScore(existingLead?.leadScore)
  const nextLeadScore = Math.max(currentScore, normalizedLeadScore)
  const hasContact = Boolean(customer.email || customer.phone)

  const nextStatus = buildStatusFromLeadScore({
    currentStatus: existingLead?.status,
    leadScore: nextLeadScore,
    hasContact,
  })

  const candidateProducts = pickProductsOfInterest({
    userText: message,
    assistantText,
    actions,
    products,
    explicitProductsOfInterest: productsOfInterest,
  })

  const newProductsOnly = filterNewProductsOnly({
    existingProducts: existingLead?.productsOfInterest || [],
    nextProducts: candidateProducts,
  })

  const safeMetadata = {
    ...sanitizeMetadata(existingLead?.metadata),
    ...sanitizeMetadata(metadata),
    lastAutoUpdateAt: new Date().toISOString(),
    lastAutoUpdateSource: clean(metadata?.source) || 'ai_agent',
  }

  const normalizedPreferences =
    preferences &&
    typeof preferences === 'object' &&
    !Array.isArray(preferences)
      ? preferences
      : {}
  const mergedPreferences = {
    colors: uniqueCleanValues([
      ...(existingLead?.preferences?.colors || []),
      ...(normalizedPreferences.colors || []),
    ]),
    sizes: uniqueCleanValues([
      ...(existingLead?.preferences?.sizes || []),
      ...(normalizedPreferences.sizes || []),
    ]),
    categories: uniqueCleanValues([
      ...(existingLead?.preferences?.categories || []),
      ...(normalizedPreferences.categories || []),
    ]),
    intents: uniqueCleanValues([
      ...(existingLead?.preferences?.intents || []),
      ...(normalizedPreferences.intents || []),
    ]),
    budgetMax: Number.isFinite(Number(normalizedPreferences.budgetMax))
      ? Math.max(0, Number(normalizedPreferences.budgetMax))
      : existingLead?.preferences?.budgetMax ?? null,
  }

  const resolvedChannel = clean(channel || conversation?.channel) || 'webchat'

  const update = {
    $setOnInsert: {
      tenantId,
      conversationId,
      channel: resolvedChannel,
      source: resolvedChannel,
    },
    $set: {
      lastConversationId: conversationId,
      customer,
      intent: normalizedIntent,
      intentScore: normalizedIntentScore,
      leadScore: nextLeadScore,
      score: nextLeadScore,
      status: nextStatus,
      preferences: mergedPreferences,
      lastMessage: clean(message).slice(0, 2000),
      lastInteractionAt: new Date(),
      metadata: safeMetadata,
    },
  }

  if (newProductsOnly.length) {
    update.$addToSet = {
      productsOfInterest: {
        $each: newProductsOnly,
      },
      products: {
        $each: newProductsOnly.map(product => ({
          productId: product.productId,
          title: product.title,
        })),
      },
    }
  }

  return AiLead.findOneAndUpdate(lookup, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  }).setOptions({ tenantId })
}

export const addLeadNote = async ({ tenantId, leadId, text, user } = {}) => {
  if (!tenantId || !isValidObjectId(leadId)) return null

  const cleanText = clean(text).slice(0, 3000)

  if (!cleanText) {
    const error = new Error('La nota no puede estar vacía')
    error.statusCode = 400
    throw error
  }

  return AiLead.findOneAndUpdate(
    {
      _id: leadId,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $push: {
        notes: {
          text: cleanText,
          createdBy: user?._id || user?.id || null,
          createdByName: clean(user?.name || user?.email),
        },
      },
      $set: {
        lastInteractionAt: new Date(),
      },
    },
    {
      new: true,
    },
  ).setOptions({ tenantId })
}

export const updateLeadStatus = async ({
  tenantId,
  leadId,
  status,
  reason = '',
  user,
} = {}) => {
  if (!tenantId || !isValidObjectId(leadId)) return null

  const cleanStatus = clean(status)
  const allowed = Object.values(AI_LEAD_STATUS)

  if (!allowed.includes(cleanStatus)) {
    const error = new Error('Estado de lead inválido')
    error.statusCode = 400
    throw error
  }

  const set = {
    status: cleanStatus,
    lastInteractionAt: new Date(),
  }

  if (cleanStatus === AI_LEAD_STATUS.WON) {
    set.wonAt = new Date()
  }

  if (cleanStatus === AI_LEAD_STATUS.LOST) {
    set.lostAt = new Date()
    set.lostReason = clean(reason).slice(0, 500)
  }

  if (cleanStatus === AI_LEAD_STATUS.DISCARDED) {
    set.discardedAt = new Date()
    set.discardedReason = clean(reason).slice(0, 500)
  }

  const update = {
    $set: set,
  }

  if (reason) {
    update.$push = {
      notes: {
        text: `Cambio de estado a ${cleanStatus}. Motivo: ${clean(reason).slice(0, 500)}`,
        createdBy: user?._id || user?.id || null,
        createdByName: clean(user?.name || user?.email),
      },
    }
  }

  return AiLead.findOneAndUpdate(
    {
      _id: leadId,
      tenantId,
      deletedAt: { $exists: false },
    },
    update,
    {
      new: true,
    },
  ).setOptions({ tenantId })
}

export const assignLead = async ({ tenantId, leadId, assignedTo } = {}) => {
  if (!tenantId || !isValidObjectId(leadId)) return null

  return AiLead.findOneAndUpdate(
    {
      _id: leadId,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $set: {
        assignedTo:
          assignedTo && isValidObjectId(assignedTo)
            ? new Types.ObjectId(String(assignedTo))
            : null,
        lastInteractionAt: new Date(),
      },
    },
    {
      new: true,
    },
  ).setOptions({ tenantId })
}

export const scheduleLeadFollowUp = async ({
  tenantId,
  leadId,
  nextFollowUpAt,
} = {}) => {
  if (!tenantId || !isValidObjectId(leadId)) return null

  const date = nextFollowUpAt ? new Date(nextFollowUpAt) : null

  if (date && Number.isNaN(date.getTime())) {
    const error = new Error('Fecha de seguimiento inválida')
    error.statusCode = 400
    throw error
  }

  const set = {
    nextFollowUpAt: date,
    lastInteractionAt: new Date(),
  }

  if (date) {
    set.status = AI_LEAD_STATUS.FOLLOW_UP
  }

  return AiLead.findOneAndUpdate(
    {
      _id: leadId,
      tenantId,
      deletedAt: { $exists: false },
    },
    {
      $set: set,
    },
    {
      new: true,
    },
  ).setOptions({ tenantId })
}
