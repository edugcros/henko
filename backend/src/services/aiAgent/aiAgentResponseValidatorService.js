// 📁 src/services/aiAgent/aiAgentResponseValidatorService.js
// VERSIÓN PRODUCCIÓN - VALIDACIÓN COMERCIAL / RAZONAMIENTO / APRENDIZAJE ASISTIDO
//
// Este servicio NO debe inventar aprendizaje por sí solo ni escribir en DB.
// Su responsabilidad es:
// 1) Validar que la respuesta del agente esté basada en contexto real.
// 2) Distinguir warnings leves vs riesgos que requieren regenerar/fallback.
// 3) Generar señales de aprendizaje para que otro servicio las persista.
// 4) Construir fallback dinámico y contextual, no una respuesta repetida.

const DEFAULT_CURRENCY = 'ARS'
const MAX_PRODUCT_REFERENCES = 5
const MAX_FALLBACK_PRODUCTS = 3
const MAX_LEARNING_SIGNALS = 8

const HARD_BLOCK_WARNINGS = new Set([
  'mentions_price_without_products',
  'mentions_stock_without_products',
  'mentions_discount_without_promotions',
  'contains_unverified_commercial_numbers',
  'discount_mentioned_without_known_code',
  'specific_recommendation_without_known_product_reference',
  'guarantees_availability_without_stock_context',
  'answers_policy_without_policy_context',
])

const SOFT_WARNINGS = new Set([
  'commercial_recommendation_without_known_product_reference',
  'mentions_shipping_without_policy_context',
  'mentions_payment_without_policy_context',
  'mentions_returns_without_policy_context',
  'mentions_warranty_without_policy_context',
  'too_generic_response',
  'missing_closing_question',
  'does_not_reference_available_product_when_context_exists',
])

const clean = value => String(value || '').trim()

const normalizeText = value => {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const normalizeKey = value => {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const unique = values => {
  const seen = new Set()
  const result = []

  for (const value of values || []) {
    const cleanValue = clean(value)
    if (!cleanValue) continue

    const key = normalizeText(cleanValue)
    if (seen.has(key)) continue

    seen.add(key)
    result.push(cleanValue)
  }

  return result
}

const safeArray = value => (Array.isArray(value) ? value : [])

const isPlainObject = value => {
  return value && typeof value === 'object' && !Array.isArray(value)
}

const toPlainObject = value => {
  if (!value) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (typeof value?.toObject === 'function') return value.toObject()
  return isPlainObject(value) ? value : {}
}

const safeJsonParse = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return fallback

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const includesAny = (text, values) => {
  const normalizedText = normalizeText(text)

  return unique(values).some(value => {
    const normalizedValue = normalizeText(value)
    return normalizedValue && normalizedText.includes(normalizedValue)
  })
}

const countKnownReferences = (text, values) => {
  const normalizedText = normalizeText(text)
  return unique(values).filter(value => {
    const normalizedValue = normalizeText(value)
    return normalizedValue && normalizedText.includes(normalizedValue)
  }).length
}

const extractNumbersWithContext = text => {
  const source = clean(text)
  const regex = /(?:[$%]\s*)?-?\d[\d.,]*(?:\s*[%])?/g
  const matches = []
  let match

  while ((match = regex.exec(source)) !== null) {
    const raw = match[0]
    const index = match.index
    const before = source.slice(Math.max(0, index - 28), index)
    const after = source.slice(index + raw.length, index + raw.length + 28)

    matches.push({
      raw,
      index,
      before,
      after,
      context: `${before}${raw}${after}`,
    })
  }

  return matches
}

const extractNumbers = text => extractNumbersWithContext(text).map(item => item.raw)

const parseLocalizedNumber = value => {
  const raw = clean(value).replace(/[^\d.,-]/g, '')
  if (!raw) return null

  const lastComma = raw.lastIndexOf(',')
  const lastDot = raw.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : ''
  let normalized = raw

  if (decimalSeparator) {
    const separatorIndex = raw.lastIndexOf(decimalSeparator)
    const decimals = raw.length - separatorIndex - 1
    const isDecimal = decimals > 0 && decimals <= 2

    normalized = isDecimal
      ? `${raw.slice(0, separatorIndex).replace(/[.,]/g, '')}.${raw.slice(separatorIndex + 1)}`
      : raw.replace(/[.,]/g, '')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

const toSafeNumber = value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const formatPrice = (value, currency = DEFAULT_CURRENCY) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  try {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: clean(currency || DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
      maximumFractionDigits: 0,
    }).format(parsed)
  } catch {
    return `$${parsed.toLocaleString('es-AR')}`
  }
}

const hasPolicyValue = value => {
  if (typeof value === 'string') return Boolean(clean(value))
  if (Array.isArray(value)) return value.some(hasPolicyValue)
  if (isPlainObject(value)) return Object.values(value).some(hasPolicyValue)
  return value !== undefined && value !== null && value !== false
}

const normalizePolicies = ({ policies = {}, businessContext = {}, knowledge = [] } = {}) => {
  const contextPolicies = toPlainObject(businessContext?.policies)
  const basePolicies = {
    ...contextPolicies,
    ...toPlainObject(policies),
  }

  const knowledgeText = safeArray(knowledge)
    .filter(item => ['policy', 'shipping', 'payment', 'returns', 'warranty'].includes(item?.type))
    .map(item => `${item?.title || ''} ${item?.content || ''}`)
    .join('\n')

  return {
    shipping: basePolicies.shipping || basePolicies.envios || basePolicies.delivery || '',
    payments: basePolicies.payments || basePolicies.pagos || basePolicies.payment || '',
    returns: basePolicies.returns || basePolicies.devoluciones || basePolicies.cambios || '',
    warranty: basePolicies.warranty || basePolicies.garantia || basePolicies.guarantee || '',
    privacy: basePolicies.privacy || basePolicies.privacidad || '',
    raw: basePolicies,
    knowledgeText,
  }
}

const getObjectTextValues = object => {
  const values = []

  const walk = value => {
    if (value === undefined || value === null) return

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const cleanValue = clean(value)
      if (cleanValue) values.push(cleanValue)
      return
    }

    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }

    if (value instanceof Map) {
      ;[...value.entries()].forEach(([key, nestedValue]) => {
        walk(key)
        walk(nestedValue)
      })
      return
    }

    if (isPlainObject(value)) {
      Object.entries(value).forEach(([key, nestedValue]) => {
        walk(key)
        walk(nestedValue)
      })
    }
  }

  walk(object)
  return values
}

const productTextValues = product => {
  const variants = safeArray(product?.variants)
  const specifications = safeArray(product?.specifications)
  const filterAttributes = safeArray(product?.filterAttributes)
  const productAttributes = toPlainObject(product?.productAttributes)
  const categoryAttributes = toPlainObject(product?.categoryAttributes)
  const atributos = toPlainObject(product?.atributos)
  const logistics = toPlainObject(product?.logistics)
  const seo = toPlainObject(product?.seo)

  return unique([
    product?.title,
    product?.name,
    product?.nombre,
    product?.sku,
    product?.brand,
    product?.marca,
    product?.category,
    product?.categoria,
    product?.subcategory,
    product?.subcategoria,
    product?.slug,
    product?.material,
    ...(Array.isArray(product?.color) ? product.color : [product?.color]),
    ...(Array.isArray(product?.tags) ? product.tags : []),
    seo.slug,
    seo.metaTitle,
    seo.metaDescription,
    seo.shortDescription,
    ...(Array.isArray(seo.keywords) ? seo.keywords : []),
    logistics.shippingType,
    logistics.warranty,
    logistics.originCountry,
    ...getObjectTextValues(productAttributes),
    ...getObjectTextValues(categoryAttributes),
    ...getObjectTextValues(atributos),
    ...specifications.flatMap(spec => [spec?.key, spec?.label, spec?.value, spec?.unit, spec?.group]),
    ...filterAttributes.flatMap(attr => [attr?.key, attr?.label, attr?.value]),
    ...variants.flatMap(variant => [
      variant?.sku,
      variant?.key,
      variant?.title,
      variant?.name,
      variant?.nombre,
      ...Object.values(toPlainObject(variant?.attributes || variant?.combinacion)),
    ]),
  ]).filter(Boolean)
}

const collectAllowedProductNames = products => {
  return safeArray(products).flatMap(productTextValues)
}

const collectAllowedPromotionCodes = promotions => {
  return unique(
    safeArray(promotions)
      .flatMap(promotion => [
        promotion.code,
        promotion.couponCode,
        promotion.name,
        promotion.title,
        promotion.description,
        promotion.label,
      ])
      .filter(Boolean),
  )
}

const collectAllowedNumbers = ({ products = [], promotions = [], policies = {} } = {}) => {
  const values = [
    ...safeArray(products).flatMap(product => [
      product.price,
      product.stock,
      product.compareAtPrice,
      product.discountPercentage,
      product?.logistics?.weightKg,
      product?.logistics?.dimensionsCm?.length,
      product?.logistics?.dimensionsCm?.width,
      product?.logistics?.dimensionsCm?.height,
      ...safeArray(product.variants).flatMap(variant => [variant.price, variant.stock]),
      ...safeArray(product.specifications).flatMap(spec => [spec.value]),
    ]),
    ...safeArray(promotions).flatMap(promotion => [
      promotion.discountValue,
      promotion.discountPercentage,
      promotion.percent,
      promotion.minPurchaseAmount,
      promotion.maxDiscountAmount,
    ]),
    ...extractNumbers(policies?.knowledgeText || '').map(parseLocalizedNumber),
    ...Object.values(toPlainObject(policies?.raw)).flatMap(value =>
      extractNumbers(typeof value === 'string' ? value : JSON.stringify(value || '')).map(parseLocalizedNumber),
    ),
  ]

  return values
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)
}

const detectIntents = ({ responseText = '', userMessage = '' } = {}) => {
  const text = normalizeText(`${userMessage}\n${responseText}`)

  return {
    price: /\$|ars|precio|vale|sale|cuesta|cuestan|valor|importe/.test(text),
    stock: /stock|disponible|disponibles|hay unidades|tenemos|queda|quedan|agotado|agotada/.test(text),
    discount: /descuento|cupon|cupon|promo|promocion|oferta|rebaja|% off|por ciento/.test(text),
    shipping: /envio|envios|entrega|delivery|correo|retirar|retiro|sucursal|domicilio/.test(text),
    payment: /pago|pagos|tarjeta|mercado pago|transferencia|cuota|cuotas|financiacion|financiación/.test(text),
    returns: /cambio|cambios|devolucion|devoluciones|reintegro|reembolso/.test(text),
    warranty: /garantia|garantía|garantizado|garantizada|falla|fallas/.test(text),
    recommendation: /recomiendo|recomendaria|recomendaría|te sugiero|ideal para|conviene|mejor opcion|mejor opción|opciones/.test(text),
    comparison: /comparar|diferencia|versus| vs |mejor que|cual conviene|cuál conviene/.test(text),
    variant: /talle|talla|color|medida|capacidad|modelo|variante|presentacion|presentación|numero|número/.test(text),
    purchase: /comprar|carrito|checkout|link|lo quiero|me lo llevo|reservar|pedido/.test(text),
    lead: /telefono|teléfono|whatsapp|contacto|asesor|humano/.test(text),
  }
}

const isAvailabilityClaim = text => {
  const lower = normalizeText(text)
  return /tenemos|hay stock|disponible|disponibles|queda|quedan|listo para comprar|lo podes comprar|lo podés comprar/.test(lower)
}

const shouldIgnoreNumber = ({ parsed, raw, context, intents }) => {
  const lowerContext = normalizeText(context)
  const rawValue = clean(raw)

  if (!parsed || parsed <= 0) return true

  // Cantidades conversacionales, estrellas, pasos, opciones, mensajes, etc.
  if (parsed <= 3 && !rawValue.includes('$') && !lowerContext.includes('precio')) return true

  // Años reales.
  if (parsed >= 1900 && parsed <= 2100) return true

  // Horarios y tiempos frecuentes que no son precio.
  if (/hora|hs|dias|días|dia|día|minuto|minutos|semana|semanas|mes|meses|hábil|habil/.test(lowerContext)) {
    return true
  }

  // Cuotas, talles y medidas pueden no estar en price context.
  if (/cuota|cuotas|talle|talla|numero|número|cm|mm|kg|gr|litro|ml|gb|tb|pulgada/.test(lowerContext)) {
    return !intents.price && !intents.discount
  }

  return false
}

const isNumberAllowed = ({ parsed, allowedNumbers }) => {
  return allowedNumbers.some(allowed => {
    if (!Number.isFinite(allowed)) return false
    const absoluteTolerance = Math.max(0.01, allowed * 0.015)
    return Math.abs(allowed - parsed) <= absoluteTolerance
  })
}

const classifyRisk = ({ blockedReasons, hardWarnings, softWarnings }) => {
  if (blockedReasons.length > 0 || hardWarnings.length > 0) return 'high'
  if (softWarnings.length >= 3) return 'medium'
  if (softWarnings.length > 0) return 'low'
  return 'none'
}

const calculateScore = ({ blockedReasons, hardWarnings, softWarnings, evidence }) => {
  let score = 100
  score -= blockedReasons.length * 35
  score -= hardWarnings.length * 22
  score -= softWarnings.length * 8

  if (evidence.knownProductReferences > 0) score += 5
  if (evidence.knownPromotionReferences > 0) score += 3

  return Math.max(0, Math.min(100, score))
}

const buildLearningSignal = ({ type, title, question, priority = 'medium', tags = [], metadata = {} }) => {
  return {
    type,
    title,
    question,
    priority,
    tags: unique(tags),
    metadata,
  }
}

const buildLearningSignals = ({ intents, products, promotions, policies, userMessage, warnings }) => {
  const signals = []
  const message = clean(userMessage)

  if (intents.shipping && !hasPolicyValue(policies.shipping)) {
    signals.push(
      buildLearningSignal({
        type: 'policy_gap',
        title: 'Completar política de envíos',
        question: message || '¿Cuáles son las opciones, costos y tiempos de envío?',
        priority: 'high',
        tags: ['envios', 'shipping', 'commerce_ai'],
        metadata: { intent: 'shipping' },
      }),
    )
  }

  if (intents.payment && !hasPolicyValue(policies.payments)) {
    signals.push(
      buildLearningSignal({
        type: 'policy_gap',
        title: 'Completar medios de pago y financiación',
        question: message || '¿Qué medios de pago, cuotas o financiación acepta el comercio?',
        priority: 'high',
        tags: ['pagos', 'cuotas', 'commerce_ai'],
        metadata: { intent: 'payment' },
      }),
    )
  }

  if (intents.returns && !hasPolicyValue(policies.returns)) {
    signals.push(
      buildLearningSignal({
        type: 'policy_gap',
        title: 'Completar política de cambios y devoluciones',
        question: message || '¿Cuál es la política de cambios y devoluciones?',
        priority: 'high',
        tags: ['devoluciones', 'cambios', 'commerce_ai'],
        metadata: { intent: 'returns' },
      }),
    )
  }

  if (intents.warranty && !hasPolicyValue(policies.warranty)) {
    signals.push(
      buildLearningSignal({
        type: 'policy_gap',
        title: 'Completar garantía',
        question: message || '¿Qué garantía tienen los productos?',
        priority: 'medium',
        tags: ['garantia', 'commerce_ai'],
        metadata: { intent: 'warranty' },
      }),
    )
  }

  if ((intents.price || intents.stock || intents.recommendation) && safeArray(products).length === 0) {
    signals.push(
      buildLearningSignal({
        type: 'catalog_gap',
        title: 'Mejorar recuperación de catálogo',
        question: message || 'El cliente preguntó por productos pero no se recuperó contexto de catálogo.',
        priority: 'high',
        tags: ['catalogo', 'retrieval', 'commerce_ai'],
        metadata: { intent: 'catalog', productsCount: safeArray(products).length },
      }),
    )
  }

  if (intents.discount && safeArray(promotions).length === 0) {
    signals.push(
      buildLearningSignal({
        type: 'promotion_gap',
        title: 'Completar promociones vigentes',
        question: message || 'El cliente consultó por descuentos o promociones.',
        priority: 'medium',
        tags: ['promociones', 'descuentos', 'commerce_ai'],
        metadata: { intent: 'discount' },
      }),
    )
  }

  if (warnings.includes('contains_unverified_commercial_numbers')) {
    signals.push(
      buildLearningSignal({
        type: 'answer_quality_issue',
        title: 'Respuesta con números no verificados',
        question: message || 'La IA usó precios, descuentos o valores que no estaban en contexto.',
        priority: 'high',
        tags: ['hallucination', 'numbers', 'commerce_ai'],
        metadata: { intent: 'validation' },
      }),
    )
  }

  return signals.slice(0, MAX_LEARNING_SIGNALS)
}

const getProductTitle = product => {
  return clean(product?.title || product?.name || product?.nombre || product?.slug || 'Producto')
}

const isProductAvailable = product => {
  if (product?.available !== undefined) return Boolean(product.available)
  if (product?.isAvailable !== undefined) return Boolean(product.isAvailable)

  const variants = safeArray(product?.variants).filter(variant => variant?.isActive !== false)
  if (variants.length > 0) {
    return variants.some(variant => Number(variant.stock || 0) > 0)
  }

  return Number(product?.stock || 0) > 0
}

const getProductStock = product => {
  const variants = safeArray(product?.variants).filter(variant => variant?.isActive !== false)
  if (variants.length > 0) {
    return variants.reduce((total, variant) => total + Number(variant.stock || 0), 0)
  }

  return Number(product?.stock || 0)
}

const getProductPrice = product => {
  const variants = safeArray(product?.variants).filter(variant => variant?.isActive !== false)

  if (variants.length > 0) {
    const prices = variants
      .map(variant => Number(variant.price || 0))
      .filter(price => Number.isFinite(price) && price > 0)

    if (prices.length === 0) return Number(product?.price || 0)

    const min = Math.min(...prices)
    const max = Math.max(...prices)

    return min === max ? min : { min, max }
  }

  return Number(product?.price || 0)
}

const formatProductPrice = (product, currency = DEFAULT_CURRENCY) => {
  if (product?.formattedPrice) return product.formattedPrice

  const price = getProductPrice(product)

  if (isPlainObject(price)) {
    const min = formatPrice(price.min, currency)
    const max = formatPrice(price.max, currency)
    return min && max ? `${min} a ${max}` : null
  }

  return formatPrice(price, currency)
}

const getVariantSummary = product => {
  const variants = safeArray(product?.variants).filter(variant => variant?.isActive !== false)
  if (!variants.length) return ''

  const attrMap = new Map()

  variants.forEach(variant => {
    const attributes = toPlainObject(variant?.attributes || variant?.combinacion)

    Object.entries(attributes).forEach(([key, value]) => {
      const cleanKey = clean(key)
      const cleanValue = clean(value)
      if (!cleanKey || !cleanValue) return
      if (!attrMap.has(cleanKey)) attrMap.set(cleanKey, new Set())
      attrMap.get(cleanKey).add(cleanValue)
    })
  })

  const parts = [...attrMap.entries()]
    .slice(0, 3)
    .map(([key, values]) => `${key}: ${[...values].slice(0, 5).join(', ')}`)

  return parts.length ? ` · opciones: ${parts.join(' · ')}` : ''
}

const getSpecSummary = product => {
  const specs = safeArray(product?.specifications)
    .filter(spec => spec?.visible !== false && clean(spec?.value))
    .slice(0, 2)
    .map(spec => `${clean(spec.label || spec.key)}: ${clean(spec.value)}${spec.unit ? ` ${spec.unit}` : ''}`)

  return specs.length ? ` · ${specs.join(' · ')}` : ''
}

const buildProductLine = ({ product, currency }) => {
  const title = getProductTitle(product)
  const price = formatProductPrice(product, currency)
  const stock = getProductStock(product)
  const stockText = Number.isFinite(stock) ? `stock: ${stock}` : 'stock a confirmar'
  const priceText = price ? ` — ${price}` : ''
  const variantSummary = getVariantSummary(product)
  const specSummary = getSpecSummary(product)

  return `• ${title}${priceText} — ${stockText}${variantSummary}${specSummary}`
}

const buildClarifyingQuestion = intents => {
  if (intents.variant) return '¿Qué talle, color, medida o variante necesitás?'
  if (intents.price) return '¿Tenés un rango de precio aproximado o una marca preferida?'
  if (intents.shipping) return '¿A qué zona o ciudad sería el envío?'
  if (intents.payment) return '¿Querés pagar en efectivo, transferencia, tarjeta o cuotas?'
  if (intents.comparison) return '¿Entre qué modelos o productos querés que compare?'
  return '¿Qué producto, marca, categoría, talle o color estás buscando?'
}

const buildPolicyFallback = ({ intents, policies }) => {
  if (intents.shipping && hasPolicyValue(policies.shipping)) return clean(policies.shipping)
  if (intents.payment && hasPolicyValue(policies.payments)) return clean(policies.payments)
  if (intents.returns && hasPolicyValue(policies.returns)) return clean(policies.returns)
  if (intents.warranty && hasPolicyValue(policies.warranty)) return clean(policies.warranty)
  return ''
}

const buildRepairInstruction = ({ warnings, blockedReasons, products, promotions, policies, userMessage }) => {
  const instructions = [
    'Reescribí la respuesta usando solamente datos presentes en el contexto.',
    'No inventes precios, stock, descuentos, cuotas, tiempos de envío ni garantías.',
  ]

  if (safeArray(products).length > 0) {
    const productNames = safeArray(products)
      .slice(0, MAX_PRODUCT_REFERENCES)
      .map(getProductTitle)
      .filter(Boolean)
      .join(', ')

    if (productNames) instructions.push(`Podés mencionar estos productos: ${productNames}.`)
  } else {
    instructions.push('No hay productos recuperados: pedí una aclaración concreta al cliente.')
  }

  if (safeArray(promotions).length > 0) {
    const codes = collectAllowedPromotionCodes(promotions).slice(0, 5).join(', ')
    if (codes) instructions.push(`Promociones/códigos válidos: ${codes}.`)
  }

  if (!hasPolicyValue(policies.shipping)) instructions.push('Si preguntan por envío, reconocé que falta la política de envíos y ofrecé derivar o pedir zona.')
  if (!hasPolicyValue(policies.payments)) instructions.push('Si preguntan por pagos/cuotas, no confirmes financiación sin datos del comercio.')
  if (!hasPolicyValue(policies.returns)) instructions.push('Si preguntan por cambios/devoluciones, no inventes condiciones.')
  if (!hasPolicyValue(policies.warranty)) instructions.push('Si preguntan por garantía, no confirmes plazos no disponibles.')

  return {
    userMessage: clean(userMessage),
    blockedReasons,
    warnings,
    instructions,
  }
}

export const validateAgentCommerceResponse = ({
  responseText,
  products = [],
  promotions = [],
  userMessage = '',
  businessContext = {},
  policies = {},
  knowledge = [],
  strictMode = false,
} = {}) => {
  const text = clean(responseText)
  const warnings = []
  const blockedReasons = []
  const softWarnings = []

  if (!text) {
    blockedReasons.push('empty_response')
  }

  const lower = normalizeText(text)
  const intents = detectIntents({ responseText: text, userMessage })
  const normalizedPolicies = normalizePolicies({ policies, businessContext, knowledge })

  const mentionsPrice = intents.price
  const mentionsStock = intents.stock
  const mentionsDiscount = intents.discount

  if (mentionsPrice && safeArray(products).length === 0) {
    warnings.push('mentions_price_without_products')
  }

  if (mentionsStock && safeArray(products).length === 0) {
    warnings.push('mentions_stock_without_products')
  }

  if (mentionsDiscount && safeArray(promotions).length === 0) {
    warnings.push('mentions_discount_without_promotions')
  }

  if (intents.shipping && !hasPolicyValue(normalizedPolicies.shipping)) {
    softWarnings.push('mentions_shipping_without_policy_context')
  }

  if (intents.payment && !hasPolicyValue(normalizedPolicies.payments)) {
    softWarnings.push('mentions_payment_without_policy_context')
  }

  if (intents.returns && !hasPolicyValue(normalizedPolicies.returns)) {
    softWarnings.push('mentions_returns_without_policy_context')
  }

  if (intents.warranty && !hasPolicyValue(normalizedPolicies.warranty)) {
    softWarnings.push('mentions_warranty_without_policy_context')
  }

  if (
    (intents.shipping && /llega|demora|tarda|envio gratis|envío gratis|costo|precio/.test(lower) && !hasPolicyValue(normalizedPolicies.shipping)) ||
    (intents.payment && /aceptamos|cuotas|sin interes|sin interés|financiacion|financiación/.test(lower) && !hasPolicyValue(normalizedPolicies.payments)) ||
    (intents.returns && /podes cambiar|podés cambiar|devolvemos|reembolso|dias|días/.test(lower) && !hasPolicyValue(normalizedPolicies.returns)) ||
    (intents.warranty && /garantia de|garantía de|meses|años|anos|cubre/.test(lower) && !hasPolicyValue(normalizedPolicies.warranty))
  ) {
    warnings.push('answers_policy_without_policy_context')
  }

  const allowedProductNames = collectAllowedProductNames(products)
  const allowedPromotionCodes = collectAllowedPromotionCodes(promotions)
  const knownProductReferences = countKnownReferences(text, allowedProductNames)
  const knownPromotionReferences = countKnownReferences(text, allowedPromotionCodes)
  const mentionsKnownProduct = knownProductReferences > 0
  const mentionsKnownPromotion = knownPromotionReferences > 0

  if (safeArray(products).length > 0 && intents.recommendation) {
    if (!mentionsKnownProduct) {
      const specificRecommendation = /te recomiendo\s+([a-z0-9áéíóúñü\s-]{4,})|elegi\s+|elegí\s+|compra\s+|comprá\s+/.test(lower)
      if (specificRecommendation) {
        warnings.push('specific_recommendation_without_known_product_reference')
      } else {
        softWarnings.push('commercial_recommendation_without_known_product_reference')
      }
    }
  }

  if (safeArray(products).length > 0 && !mentionsKnownProduct && /tenemos|encontre|encontré|opciones|producto/.test(lower)) {
    softWarnings.push('does_not_reference_available_product_when_context_exists')
  }

  if (mentionsDiscount && safeArray(promotions).length > 0 && !mentionsKnownPromotion) {
    warnings.push('discount_mentioned_without_known_code')
  }

  if (isAvailabilityClaim(text) && safeArray(products).length === 0) {
    warnings.push('guarantees_availability_without_stock_context')
  }

  const allowedNumbers = collectAllowedNumbers({
    products,
    promotions,
    policies: normalizedPolicies,
  })

  const suspiciousNumbers = extractNumbersWithContext(text).filter(item => {
    const parsed = parseLocalizedNumber(item.raw)
    if (!parsed) return false

    if (shouldIgnoreNumber({ parsed, raw: item.raw, context: item.context, intents })) {
      return false
    }

    // Solo convertirlo en problema duro cuando el número aparece en contexto comercial.
    const context = normalizeText(item.context)
    const commercialNumber =
      item.raw.includes('$') ||
      item.raw.includes('%') ||
      /precio|sale|cuesta|vale|ars|descuento|promo|stock|unidades|cuotas|financiacion|financiación/.test(context)

    if (!commercialNumber) return false

    return !isNumberAllowed({ parsed, allowedNumbers })
  })

  if (suspiciousNumbers.length > 0 && (mentionsPrice || mentionsDiscount || mentionsStock || intents.payment)) {
    warnings.push('contains_unverified_commercial_numbers')
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length
  if (wordCount < 8 && !blockedReasons.length) {
    softWarnings.push('too_generic_response')
  }

  if (!/[?¿]/.test(text) && (intents.recommendation || safeArray(products).length === 0)) {
    softWarnings.push('missing_closing_question')
  }

  const hardWarnings = warnings.filter(warning => HARD_BLOCK_WARNINGS.has(warning))
  const lowWarnings = [
    ...warnings.filter(warning => !HARD_BLOCK_WARNINGS.has(warning)),
    ...softWarnings,
  ]

  const riskLevel = classifyRisk({ blockedReasons, hardWarnings, softWarnings: lowWarnings })
  const score = calculateScore({
    blockedReasons,
    hardWarnings,
    softWarnings: lowWarnings,
    evidence: { knownProductReferences, knownPromotionReferences },
  })

  const shouldFallback =
    blockedReasons.length > 0 ||
    hardWarnings.length > 0 ||
    (strictMode && lowWarnings.some(warning => SOFT_WARNINGS.has(warning)))

  const allWarnings = unique([...warnings, ...softWarnings])

  const learningSignals = buildLearningSignals({
    intents,
    products,
    promotions,
    policies: normalizedPolicies,
    userMessage,
    warnings: allWarnings,
  })

  const fallbackResponse = shouldFallback
    ? buildSafeFallbackResponse({
      products,
      promotions,
      userMessage,
      businessContext,
      policies: normalizedPolicies,
      validation: {
        warnings: allWarnings,
        blockedReasons,
        intents,
      },
    })
    : null

  return {
    ok: blockedReasons.length === 0 && allWarnings.length === 0,
    blockedReasons,
    warnings: allWarnings,
    hardWarnings,
    softWarnings: lowWarnings,
    shouldFallback,
    shouldRegenerate: shouldFallback,
    riskLevel,
    score,
    intents,
    evidence: {
      productsCount: safeArray(products).length,
      promotionsCount: safeArray(promotions).length,
      knownProductReferences,
      knownPromotionReferences,
      suspiciousNumbers: suspiciousNumbers.map(item => item.raw),
      allowedNumbers,
    },
    missingContext: {
      products: safeArray(products).length === 0 && (mentionsPrice || mentionsStock || intents.recommendation),
      promotions: safeArray(promotions).length === 0 && mentionsDiscount,
      shippingPolicy: intents.shipping && !hasPolicyValue(normalizedPolicies.shipping),
      paymentPolicy: intents.payment && !hasPolicyValue(normalizedPolicies.payments),
      returnsPolicy: intents.returns && !hasPolicyValue(normalizedPolicies.returns),
      warrantyPolicy: intents.warranty && !hasPolicyValue(normalizedPolicies.warranty),
    },
    learningSignals,
    fallbackResponse,
    safeResponse: fallbackResponse,
    repairInstruction: buildRepairInstruction({
      warnings: allWarnings,
      blockedReasons,
      products,
      promotions,
      policies: normalizedPolicies,
      userMessage,
    }),
  }
}

export const buildSafeFallbackResponse = ({
  products = [],
  promotions = [],
  userMessage = '',
  businessContext = {},
  policies = {},
  validation = null,
} = {}) => {
  const intents = validation?.intents || detectIntents({ userMessage })
  const normalizedPolicies = policies?.raw
    ? policies
    : normalizePolicies({ policies, businessContext })
  const currency = clean(businessContext?.currency || businessContext?.moneda || DEFAULT_CURRENCY).toUpperCase()
  const productList = safeArray(products)
  const promotionList = safeArray(promotions)
  const availableProducts = productList
    .filter(isProductAvailable)
    .slice(0, MAX_FALLBACK_PRODUCTS)
  const policyText = buildPolicyFallback({ intents, policies: normalizedPolicies })

  if (policyText && productList.length === 0 && !intents.price && !intents.stock && !intents.recommendation) {
    return [
      policyText,
      '',
      '¿Querés que también te ayude a encontrar un producto del catálogo?',
    ].join('\n')
  }

  if (availableProducts.length > 0) {
    const intro = intents.recommendation || intents.comparison
      ? 'Con la información disponible, estas son las opciones más seguras para recomendar:'
      : intents.stock
        ? 'Estas opciones figuran disponibles en el catálogo:'
        : intents.price
          ? 'Estas opciones tienen precio cargado en el catálogo:'
          : 'Encontré estas opciones del catálogo:'

    const lines = availableProducts.map(product => buildProductLine({ product, currency }))
    const promoLine = promotionList.length > 0
      ? `\nPromociones detectadas: ${collectAllowedPromotionCodes(promotionList).slice(0, 3).join(', ') || 'hay promociones activas, a confirmar según producto'}.`
      : ''
    const policyLine = policyText ? `\n${policyText}` : ''
    const question = buildClarifyingQuestion(intents)

    return [
      intro,
      '',
      ...lines,
      promoLine,
      policyLine,
      '',
      question,
    ]
      .filter(line => line !== null && line !== undefined)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  if (productList.length > 0) {
    const lines = productList.slice(0, MAX_FALLBACK_PRODUCTS).map(product => buildProductLine({ product, currency }))

    return [
      'Encontré productos relacionados, pero no puedo confirmar disponibilidad exacta con la información actual:',
      '',
      ...lines,
      '',
      '¿Querés que te derive a un asesor o que busque alternativas disponibles?',
    ].join('\n')
  }

  if (promotionList.length > 0) {
    const codes = collectAllowedPromotionCodes(promotionList).slice(0, 4)

    return [
      codes.length
        ? `Hay promociones activas (${codes.join(', ')}), pero necesito saber qué producto te interesa para confirmar si aplica.`
        : 'Hay promociones activas, pero necesito saber qué producto te interesa para confirmar si aplica.',
      '',
      buildClarifyingQuestion(intents),
    ].join('\n')
  }

  if (intents.shipping || intents.payment || intents.returns || intents.warranty) {
    const missing = []
    if (intents.shipping) missing.push('envíos')
    if (intents.payment) missing.push('pagos/cuotas')
    if (intents.returns) missing.push('cambios/devoluciones')
    if (intents.warranty) missing.push('garantía')

    return [
      `Todavía no tengo información suficiente y aprobada sobre ${missing.join(', ')} para responder con precisión.`,
      'Puedo derivarte a un asesor o ayudarte a elegir un producto mientras se confirma esa política.',
      '',
      buildClarifyingQuestion(intents),
    ].join('\n')
  }

  return [
    'No encontré información suficiente en el catálogo para responder con precisión.',
    buildClarifyingQuestion(intents),
  ].join('\n')
}

export const buildAgentLearningCandidatesFromValidation = validation => {
  return safeArray(validation?.learningSignals).map(signal => ({
    type: signal.type,
    status: 'pending_review',
    title: signal.title,
    question: signal.question,
    suggestedAnswer: '',
    normalizedQuestion: normalizeText(signal.question),
    confidence: 0.45,
    priority: signal.priority || 'medium',
    tags: signal.tags || [],
    metadata: {
      ...(signal.metadata || {}),
      source: 'ai_agent_response_validator',
      riskLevel: validation?.riskLevel || 'unknown',
      warnings: validation?.warnings || [],
      blockedReasons: validation?.blockedReasons || [],
    },
  }))
}

export const buildRegenerationPromptFromValidation = validation => {
  const repair = validation?.repairInstruction || {}

  return [
    'La respuesta anterior no pasó la validación comercial.',
    `Motivos: ${safeArray(repair.blockedReasons).concat(safeArray(repair.warnings)).join(', ') || 'calidad insuficiente'}.`,
    '',
    'Instrucciones para regenerar:',
    ...safeArray(repair.instructions).map(item => `- ${item}`),
    '',
    repair.userMessage ? `Mensaje del cliente: ${repair.userMessage}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
