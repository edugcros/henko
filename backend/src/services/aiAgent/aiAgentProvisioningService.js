// 📁 src/services/aiAgent/aiAgentProvisioningService.js
// VERSIÓN PRODUCCIÓN - AGENTE IA COMERCIAL / APRENDIZAJE AMPLIO / DIÁLOGO / RAZONAMIENTO
//
// Objetivo:
// - Provisionar un agente por tenant con una base conversacional más rica.
// - Crear conocimiento inicial útil para ventas, soporte, políticas, objeciones y derivación humana.
// - Detectar huecos de información para que el comercio complete respuestas reales.
// - Aprender desde el catálogo sin inventar: categorías, marcas, etiquetas, especificaciones y señales comerciales.
// - Mantener idempotencia y compatibilidad con tenants existentes.

import crypto from 'crypto'

import AiAgent from '../../models/aiAgentModel.js'
import AiCampaignRule from '../../models/aiCampaignRuleModel.js'
import AiKnowledge from '../../models/aiKnowledgeModel.js'
import AiLearningSuggestion from '../../models/aiLearningSuggestionModel.js'
import AIPreference from '../../models/aIPreference.js'
import Product from '../../models/productModel.js'

const PROVISIONING_VERSION = '2026-06-market-ready-dialogue-v2'
const DEFAULT_LANGUAGE = 'es-AR'
const DEFAULT_CURRENCY = 'ARS'

const MAX_CATALOG_PRODUCTS_FOR_LEARNING = 500
const MAX_CATALOG_PRODUCTS_IN_SUMMARY = 80
const MAX_PREFERENCES_PER_TYPE = 40
const MAX_TAGS_IN_SUMMARY = 80
const MAX_ATTRIBUTES_IN_SUMMARY = 80
const MAX_KNOWLEDGE_CONTENT_CHARS = 14000

const clean = value => String(value || '').trim()

const compact = value => clean(value).replace(/\s+/g, ' ')

const truncate = (value, max = 1000) => {
  const text = compact(value)
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`
}

const normalize = value => clean(value).toLowerCase()

const normalizeKey = value => {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const safeArray = value => (Array.isArray(value) ? value : [])

const toPlainObject = value => {
  if (!value) return {}

  if (value instanceof Map) {
    return Object.fromEntries(value.entries())
  }

  if (typeof value?.toObject === 'function') {
    return value.toObject()
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  return {}
}

const uniqueValues = values => {
  const map = new Map()

  for (const value of safeArray(values)) {
    const text = compact(value)
    if (!text) continue
    const key = normalize(text)
    if (!map.has(key)) map.set(key, text)
  }

  return [...map.values()]
}


const normalizeAttributeValueList = value => {
  if (value === undefined || value === null || value === '') return []

  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeAttributeValueList(item))
  }

  if (typeof value === 'object') {
    const direct =
      value.value ??
      value.label ??
      value.name ??
      value.text ??
      value.title

    if (direct !== undefined && direct !== null && direct !== '') {
      return normalizeAttributeValueList(direct)
    }

    return Object.values(value).flatMap(item => normalizeAttributeValueList(item))
  }

  const text = compact(value)
  return text ? [text] : []
}

const countValues = values => {
  const map = new Map()

  for (const value of safeArray(values)) {
    const text = compact(value)
    if (!text) continue
    const key = normalize(text)
    const current = map.get(key) || { value: text, count: 0 }
    current.count += 1
    map.set(key, current)
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'es'))
}

const getTenantName = tenant => {
  return (
    clean(tenant?.name) ||
    clean(tenant?.storeName) ||
    clean(tenant?.businessName) ||
    clean(tenant?.commerceName) ||
    clean(tenant?.domain) ||
    'la tienda'
  )
}

const getTenantDomain = tenant => {
  return (
    clean(tenant?.domain) ||
    clean(tenant?.customDomain) ||
    clean(tenant?.shopDomain) ||
    clean(tenant?.publicDomain) ||
    ''
  )
}

const getTenantCurrency = tenant => {
  return clean(tenant?.currency || tenant?.moneda || DEFAULT_CURRENCY).toUpperCase()
}

const getTenantLocale = tenant => {
  return clean(tenant?.locale || tenant?.language || DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE
}

const buildHash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex')

const buildLegacyFingerprint = ({ tenantId, key }) => {
  return `default:${tenantId}:${key}`.slice(0, 40)
}

const buildFingerprint = ({ tenantId, key, namespace = 'default' }) => {
  const raw = `${namespace}:${tenantId}:${key}`
  if (raw.length <= 160) return raw
  return `${namespace}:${buildHash(raw).slice(0, 40)}`
}

const buildSuggestionQuery = ({ tenantId, key, namespace = 'default' }) => {
  const fingerprint = buildFingerprint({ tenantId, key, namespace })
  const legacyFingerprint = buildLegacyFingerprint({ tenantId, key })

  return {
    tenantId,
    $or: [
      { fingerprint },
      { fingerprint: legacyFingerprint },
    ],
  }
}

const buildAgentReasoningPolicy = ({ storeName, currency }) => ({
  enabled: true,
  mode: 'consultative_commerce',
  language: DEFAULT_LANGUAGE,
  currency,
  principles: [
    'Primero entender la intención del cliente antes de recomendar.',
    'No inventar stock, precios, envíos, garantías ni promociones si no están disponibles.',
    'Pedir una sola aclaración cuando falte un dato clave.',
    'Recomendar pocas opciones y explicar por qué encajan con la necesidad del cliente.',
    'Priorizar productos visibles, activos y con stock.',
    'Derivar a una persona cuando haya reclamos, pagos complejos, datos sensibles o baja confianza.',
  ],
  responsePlan: [
    'Detectar intención: compra, comparación, stock, precio, envío, pago, garantía, reclamo o postventa.',
    'Buscar señales: categoría, presupuesto, uso, talle/color/capacidad, urgencia y preferencia de marca.',
    'Responder con información disponible y aclarar límites.',
    'Proponer el siguiente paso: ver producto, elegir variante, agregar al carrito o hablar con asesor.',
  ],
  recommendationStrategy: {
    maxProductsToRecommend: 3,
    explainTradeoffs: true,
    compareBy: [
      'precio',
      'stock',
      'beneficio principal',
      'variante disponible',
      'garantía',
      'envío',
      'popularidad o reseñas cuando existan',
    ],
  },
  uncertaintyPolicy:
    `Si una respuesta requiere información no cargada por ${storeName}, responder que ese dato no está confirmado y ofrecer derivar a un asesor.`,
})

export const buildDefaultAiAgentPayload = ({
  tenantId,
  tenant = null,
} = {}) => {
  const storeName = getTenantName(tenant)
  const currency = getTenantCurrency(tenant)
  const locale = getTenantLocale(tenant)
  const domain = getTenantDomain(tenant)

  return {
    tenantId,
    name: `Asistente IA de ${storeName}`,
    enabled: true,

    channels: {
      webchat: {
        enabled: true,
        welcomeMessage:
          `Hola, soy el asistente de ${storeName}. Puedo ayudarte a elegir productos, resolver dudas de stock, variantes, pagos, envíos y garantías.`,
        collectLeadWhenUseful: true,
      },
      whatsapp: {
        enabled: false,
        handoffMessage:
          'Te derivo con un asesor para continuar por WhatsApp con información precisa.',
      },
    },

    personality: {
      tone: 'friendly',
      language: locale,
      style: 'claro, consultivo, breve y orientado a conversión',
      role:
        'asesor comercial experto en ecommerce: ayuda a comprar, compara opciones y evita inventar información',
      empathyLevel: 'high',
      verbosity: 'medium',
      persuasionStyle: 'no invasivo',
    },

    behavior: {
      canRecommendProducts: true,
      canCreateCartLinks: true,
      canOfferDiscounts: false,
      requireHumanForPayments: true,
      requireHumanForClaims: true,
      maxMessagesBeforeHuman: 12,
      minConfidenceToAnswer: 0.62,

      askClarifyingQuestions: true,
      maxClarifyingQuestions: 1,
      canCompareProducts: true,
      canExplainVariants: true,
      canUseCatalogSpecifications: true,
      canUseCustomerIntentSignals: true,
      rememberApprovedLearnings: true,

      handoffTriggers: [
        'reclamos o conflictos',
        'solicitud de datos sensibles',
        'pago manual o transferencia no confirmada',
        'cambio/devolución sin política cargada',
        'stock/precio/envío no confirmado',
        'cliente pide hablar con humano',
        'confianza baja o información contradictoria',
      ],

      reasoning: buildAgentReasoningPolicy({ storeName, currency }),

      learning: {
        enabled: true,
        sources: [
          'conversaciones',
          'correcciones humanas',
          'catálogo',
          'políticas aprobadas',
          'preguntas frecuentes',
          'comportamiento de compra',
        ],
        createSuggestionsFromUnknowns: true,
        requireHumanApproval: true,
        minConfidenceToAutoUseApprovedKnowledge: 0.82,
      },
    },

    businessContext: {
      storeName,
      domain,
      currency,
      description:
        'Asistente comercial para responder consultas de productos, stock, variantes, promociones, envíos, pagos, garantías, comparaciones y ayuda de compra.',
      goals: [
        'resolver dudas sin inventar',
        'ayudar al cliente a elegir',
        'reducir abandono de carrito',
        'capturar oportunidades comerciales',
        'derivar a humano cuando corresponda',
      ],
      policies: {
        shipping: '',
        returns: '',
        payments: '',
        privacy: '',
        warranty: '',
        pickup: '',
        invoices: '',
      },
      conversationPlaybook: {
        greeting:
          `Saludar en nombre de ${storeName}, preguntar necesidad y ofrecer ayuda concreta.`,
        discovery:
          'Identificar uso, presupuesto, categoría, marca preferida, variantes necesarias y urgencia.',
        recommendation:
          'Recomendar hasta 3 opciones con motivo breve y siguiente acción.',
        objectionHandling:
          'Responder objeciones de precio, confianza, stock, garantía y envío sin presionar.',
        closing:
          'Confirmar producto/variante, sugerir agregar al carrito o derivar con asesor.',
      },
    },

    stats: {
      conversations: 0,
      leads: 0,
      handoffs: 0,
      lastInteractionAt: null,
    },

    metadata: {
      provisioningVersion: PROVISIONING_VERSION,
      provisionedBy: 'ai_agent_default_provisioning',
    },
  }
}

const ensureDefaultCampaignRulesForTenant = async ({ tenantId } = {}) => {
  return AiCampaignRule.findOneAndUpdate(
    {
      tenantId,
      type: 'abandoned_cart',
      channel: 'whatsapp',
    },
    {
      $setOnInsert: {
        tenantId,
        name: 'Recuperación de carrito abandonado',
        type: 'abandoned_cart',
        enabled: true,
        channel: 'whatsapp',
        messageTemplate:
          'Hola {{customerName}}, vimos que dejaste {{productName}} en tu carrito por {{cartTotal}}. Podés retomarlo acá: {{checkoutUrl}}',
        useAiPersonalization: true,
        trigger: {
          delayMinutes: 30,
          minCartAmountCents: 0,
          maxAttempts: 2,
          onlyBusinessHours: true,
          businessHours: {
            start: '09:00',
            end: '20:00',
          },
          minHoursBetweenContacts: 6,
        },
        whatsappTemplate: {
          enabled: false,
          name: '',
          languageCode: 'es_AR',
        },
      },
      $set: {
        'metadata.provisionedBy': 'ai_agent_default_provisioning',
        'metadata.provisioningVersion': PROVISIONING_VERSION,
        'metadata.dialogueGoal':
          'recuperar carrito con tono útil, no invasivo, y derivar si el cliente tiene dudas',
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })
}

const buildDefaultKnowledgeItems = ({ tenantId, tenant } = {}) => {
  const storeName = getTenantName(tenant)
  const currency = getTenantCurrency(tenant)

  return [
    {
      type: 'custom',
      title: 'Identidad del comercio',
      content:
        `El asistente representa a ${storeName}. Debe responder en español rioplatense claro, amable y profesional. Su objetivo es ayudar a comprar, resolver dudas y derivar a un asesor cuando falte información. Nunca debe decir que es dueño del comercio ni inventar políticas.`,
      tags: ['base', 'identidad', 'asistente', 'tono'],
    },
    {
      type: 'policy',
      title: 'Regla ante información faltante',
      content:
        'Si no hay información suficiente sobre envíos, cambios, garantías, pagos, facturación, promociones, stock o precios, el asistente debe reconocerlo de forma breve, no inventar, y ofrecer derivar a un asesor. Ejemplo: "No tengo ese dato confirmado en este momento. Te puedo derivar con un asesor para confirmarlo."',
      tags: ['base', 'politicas', 'handoff', 'no-inventar'],
    },
    {
      type: 'custom',
      title: 'Marco de razonamiento conversacional',
      content:
        'Antes de responder, el asistente debe identificar la intención principal del mensaje: compra, comparación, stock, precio, variantes, envío, pago, garantía, cambios/devoluciones, reclamo, postventa o humano. Luego debe usar solo datos disponibles del catálogo y conocimiento aprobado. Si falta una variable clave, debe hacer una sola pregunta aclaratoria.',
      tags: ['base', 'razonamiento', 'intencion', 'dialogo'],
    },
    {
      type: 'sales_script',
      title: 'Diagnóstico comercial recomendado',
      content:
        'Cuando el cliente no sabe qué elegir, el asistente debe preguntar por uso, presupuesto, preferencia de marca, talle/color/capacidad, urgencia y si busca algo económico, premium o equilibrado. Luego debe recomendar hasta 3 opciones con una justificación breve.',
      tags: ['ventas', 'diagnostico', 'recomendacion'],
    },
    {
      type: 'sales_script',
      title: 'Cierre comercial recomendado',
      content:
        'Cuando el cliente muestre intención de compra, el asistente debe ayudar a elegir producto, confirmar disponibilidad, sugerir seleccionar variante, ver detalle o agregar al carrito. Debe evitar presión excesiva y mantener tono útil.',
      tags: ['base', 'ventas', 'conversion', 'cierre'],
    },
    {
      type: 'custom',
      title: 'Comparación de productos',
      content:
        `Para comparar productos, el asistente debe explicar diferencias por precio en ${currency}, stock, variantes, especificaciones visibles, garantía, envío y uso recomendado. Si no tiene datos suficientes para comparar, debe decirlo y pedir el dato faltante o derivar.`,
      tags: ['catalogo', 'comparacion', 'razonamiento'],
    },
    {
      type: 'custom',
      title: 'Uso de variantes y stock',
      content:
        'Si el producto tiene variantes, el asistente debe preguntar o guiar por los atributos disponibles, como color, talle, capacidad, presentación o modelo. No debe prometer disponibilidad de una variante si no hay stock confirmado.',
      tags: ['catalogo', 'variantes', 'stock'],
    },
    {
      type: 'policy',
      title: 'Pagos y operaciones sensibles',
      content:
        'El asistente puede explicar medios de pago aprobados si están cargados, pero debe derivar a humano para pagos manuales, comprobantes, transferencias no verificadas, problemas de cobro, reclamos de facturación o datos sensibles.',
      tags: ['pagos', 'seguridad', 'handoff'],
    },
    {
      type: 'policy',
      title: 'Cambios, devoluciones y garantías',
      content:
        'El asistente solo debe informar cambios, devoluciones o garantías si la política está cargada. Si el cliente tiene un reclamo o caso particular, debe pedir datos mínimos y derivar a un asesor.',
      tags: ['postventa', 'garantia', 'devoluciones', 'handoff'],
    },
    {
      type: 'sales_script',
      title: 'Manejo de objeciones',
      content:
        'Si el cliente duda por precio, confianza o envío, el asistente debe responder con beneficios reales, reseñas si existen, garantía si está cargada y alternativas de menor precio si el catálogo lo permite. No debe inventar descuentos.',
      tags: ['ventas', 'objeciones', 'confianza'],
    },
    {
      type: 'custom',
      title: 'Aprendizaje desde correcciones humanas',
      content:
        'Cuando un asesor corrija una respuesta, complete una política o apruebe una sugerencia, el asistente debe priorizar ese conocimiento aprobado en futuras conversaciones del mismo tenant. Las dudas repetidas deben convertirse en sugerencias de aprendizaje pendientes de revisión.',
      tags: ['aprendizaje', 'feedback', 'mejora-continua'],
    },
    {
      type: 'custom',
      title: 'Formato de respuesta recomendado',
      content:
        'Responder con frases claras. Para recomendaciones, usar estructura breve: opción recomendada, motivo, precio/stock si está disponible y siguiente paso. Evitar bloques largos si el usuario hizo una pregunta simple.',
      tags: ['dialogo', 'formato', 'ux'],
    },
  ].map(item => ({
    ...item,
    tenantId,
    source: 'system',
    status: 'approved',
    confidence: 1,
    approvedAt: new Date(),
    metadata: {
      provisionedBy: 'ai_agent_default_provisioning',
      provisioningVersion: PROVISIONING_VERSION,
      stableSystemKnowledge: true,
    },
  }))
}

const ensureDefaultKnowledgeForTenant = async ({ tenantId, tenant } = {}) => {
  const defaults = buildDefaultKnowledgeItems({ tenantId, tenant })
  const results = []

  for (const item of defaults) {
    results.push(
      await AiKnowledge.findOneAndUpdate(
        {
          tenantId,
          source: 'system',
          title: item.title,
        },
        {
          $set: {
            type: item.type,
            content: item.content,
            tags: item.tags,
            status: item.status,
            confidence: item.confidence,
            approvedAt: item.approvedAt,
            metadata: item.metadata,
          },
          $setOnInsert: {
            tenantId,
            source: item.source,
            title: item.title,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      ).setOptions({ tenantId }),
    )
  }

  return results
}

const buildLearningSuggestions = ({ tenantId, tenant } = {}) => {
  const storeName = getTenantName(tenant)

  return [
    {
      key: 'shipping-policy',
      title: 'Completar política de envíos',
      question: '¿Cuáles son las opciones, costos, zonas y tiempos de envío?',
      suggestedAnswer:
        'Completá la política real de envíos: zonas, costos, plazos, empresas utilizadas, retiro en local y condiciones especiales.',
      priority: 'high',
      tags: ['onboarding', 'envios', 'politicas'],
      intent: 'shipping',
    },
    {
      key: 'payment-policy',
      title: 'Completar medios de pago',
      question: '¿Qué medios de pago, cuotas, financiación o promociones bancarias acepta el comercio?',
      suggestedAnswer:
        'Completá los medios de pago reales: tarjetas, cuotas, transferencia, Mercado Pago, efectivo, financiación y restricciones.',
      priority: 'high',
      tags: ['onboarding', 'pagos', 'conversion'],
      intent: 'payments',
    },
    {
      key: 'returns-policy',
      title: 'Completar cambios y devoluciones',
      question: '¿Cuál es la política de cambios y devoluciones?',
      suggestedAnswer:
        'Indicá plazos, condiciones del producto, costos de envío, documentación necesaria y casos no cubiertos.',
      priority: 'high',
      tags: ['onboarding', 'devoluciones', 'postventa'],
      intent: 'returns',
    },
    {
      key: 'warranty-policy',
      title: 'Completar garantía',
      question: '¿Qué garantía tienen los productos y cómo se gestiona un reclamo?',
      suggestedAnswer:
        'Indicá cobertura, duración, quién responde la garantía, pasos para reclamar y casos excluidos.',
      priority: 'high',
      tags: ['onboarding', 'garantia', 'postventa'],
      intent: 'warranty',
    },
    {
      key: 'pickup-policy',
      title: 'Completar retiro en local',
      question: '¿Se puede retirar en local o punto de entrega? ¿En qué horarios?',
      suggestedAnswer:
        'Indicá si hay retiro, dirección o zona, horarios, requisitos y tiempo de preparación del pedido.',
      priority: 'medium',
      tags: ['onboarding', 'retiro', 'envios'],
      intent: 'pickup',
    },
    {
      key: 'invoice-policy',
      title: 'Completar facturación',
      question: '¿El comercio emite factura A, B o consumidor final?',
      suggestedAnswer:
        'Indicá tipos de factura, datos necesarios, plazos de emisión y canal para solicitar correcciones.',
      priority: 'medium',
      tags: ['facturacion', 'postventa'],
      intent: 'invoice',
    },
    {
      key: 'business-hours',
      title: 'Completar horarios de atención',
      question: '¿Cuáles son los horarios de atención humana?',
      suggestedAnswer:
        'Indicá días, horarios, feriados, tiempos de respuesta y canal preferido para atención humana.',
      priority: 'medium',
      tags: ['atencion', 'handoff'],
      intent: 'human_support',
    },
    {
      key: 'target-customer',
      title: 'Definir cliente ideal',
      question: `¿A qué tipo de cliente apunta ${storeName}?`,
      suggestedAnswer:
        'Describí público objetivo, necesidades frecuentes, rango de precios, estilo de comunicación y objeciones comunes.',
      priority: 'medium',
      tags: ['ventas', 'persona', 'estrategia'],
      intent: 'sales_strategy',
    },
    {
      key: 'tone-and-brand',
      title: 'Definir tono de marca',
      question: '¿Cómo debe hablar el asistente: formal, cercano, premium, técnico o juvenil?',
      suggestedAnswer:
        'Definí ejemplos de tono, palabras preferidas, palabras a evitar y nivel de formalidad.',
      priority: 'low',
      tags: ['marca', 'tono', 'dialogo'],
      intent: 'brand_voice',
    },
    {
      key: 'discount-rules',
      title: 'Definir reglas de descuentos',
      question: '¿El asistente puede mencionar descuentos, cupones o promociones?',
      suggestedAnswer:
        'Indicá si puede ofrecer descuentos, condiciones, límites, productos excluidos y cuándo derivar.',
      priority: 'medium',
      tags: ['ventas', 'descuentos', 'promociones'],
      intent: 'discounts',
    },
    {
      key: 'size-guide',
      title: 'Completar guía de talles o medidas',
      question: '¿Existe guía de talles, medidas o equivalencias?',
      suggestedAnswer:
        'Agregá tablas de talle/medida, recomendaciones por calce, margen de error y cómo elegir.',
      priority: 'medium',
      tags: ['catalogo', 'variantes', 'talles'],
      intent: 'size_guide',
    },
    {
      key: 'product-comparison-rules',
      title: 'Definir criterios de comparación',
      question: '¿Qué criterios debe priorizar el asistente al comparar productos?',
      suggestedAnswer:
        'Indicá si debe priorizar precio, calidad, marca, disponibilidad, garantía, margen, novedad o popularidad.',
      priority: 'low',
      tags: ['catalogo', 'comparacion', 'recomendaciones'],
      intent: 'comparison',
    },
    {
      key: 'lead-capture-rules',
      title: 'Definir captura de leads',
      question: '¿Cuándo debe pedir nombre, teléfono o email al cliente?',
      suggestedAnswer:
        'Definí cuándo capturar datos, qué datos pedir, cómo solicitar consentimiento y cuándo derivar.',
      priority: 'medium',
      tags: ['leads', 'ventas', 'privacidad'],
      intent: 'lead_capture',
    },
  ].map(suggestion => ({
    ...suggestion,
    tenantId,
    type: 'policy_gap',
    status: 'pending_review',
    normalizedQuestion: normalize(suggestion.question),
    confidence: 0.5,
    metadata: {
      intent: suggestion.intent,
      channel: 'system',
      sampleUserText: suggestion.question,
      sampleAssistantText: '',
      provisionedBy: 'ai_agent_default_provisioning',
      provisioningVersion: PROVISIONING_VERSION,
    },
  }))
}

const ensureDefaultLearningSuggestionsForTenant = async ({ tenantId, tenant } = {}) => {
  const suggestions = buildLearningSuggestions({ tenantId, tenant })
  const results = []

  for (const suggestion of suggestions) {
    const fingerprint = buildFingerprint({
      tenantId,
      key: suggestion.key,
      namespace: 'default',
    })

    results.push(
      await AiLearningSuggestion.findOneAndUpdate(
        buildSuggestionQuery({
          tenantId,
          key: suggestion.key,
          namespace: 'default',
        }),
        {
          $setOnInsert: {
            tenantId,
            type: suggestion.type,
            status: suggestion.status,
            title: suggestion.title,
            question: suggestion.question,
            suggestedAnswer: suggestion.suggestedAnswer,
            normalizedQuestion: suggestion.normalizedQuestion,
            fingerprint,
            confidence: suggestion.confidence,
            priority: suggestion.priority,
            tags: suggestion.tags,
            metadata: suggestion.metadata,
          },
          $set: {
            'metadata.provisioningVersion': PROVISIONING_VERSION,
            'metadata.lastProvisionedAt': new Date(),
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        },
      ).setOptions({ tenantId }),
    )
  }

  return results
}

const extractProductAttributeRows = product => {
  const rows = []

  const pushAttribute = ({ key, label, value, source, unit = '' }) => {
    const normalizedKey = normalizeKey(key || label)
    const normalizedLabel = compact(label || key)
    const values = normalizeAttributeValueList(value)

    for (const item of values) {
      const text = compact(item)
      if (!normalizedKey || !text) continue

      rows.push({
        key: normalizedKey,
        label: normalizedLabel || normalizedKey,
        value: text,
        unit: compact(unit),
        source,
      })
    }
  }

  const productAttributes = toPlainObject(product?.productAttributes)
  for (const [key, value] of Object.entries(productAttributes)) {
    pushAttribute({ key, value, source: 'productAttributes' })
  }

  const categoryAttributes = toPlainObject(product?.categoryAttributes)
  for (const [key, value] of Object.entries(categoryAttributes)) {
    pushAttribute({ key, value, source: 'categoryAttributes' })
  }

  const atributos = toPlainObject(product?.atributos)
  for (const [key, value] of Object.entries(atributos)) {
    pushAttribute({ key, value, source: 'atributos' })
  }

  for (const specification of safeArray(product?.specifications)) {
    pushAttribute({
      key: specification?.key,
      label: specification?.label,
      value: specification?.value,
      unit: specification?.unit,
      source: 'specifications',
    })
  }

  for (const filterAttribute of safeArray(product?.filterAttributes)) {
    pushAttribute({
      key: filterAttribute?.key,
      label: filterAttribute?.label,
      value: filterAttribute?.value,
      source: 'filterAttributes',
    })
  }

  for (const variant of safeArray(product?.variants)) {
    const attributes = toPlainObject(variant?.attributes || variant?.combinacion)
    for (const [key, value] of Object.entries(attributes)) {
      pushAttribute({ key, value, source: 'variants' })
    }
  }

  return rows
}

const fetchCatalogSnapshot = async ({ tenantId } = {}) => {
  const products = await Product.find({
    tenantId,
    isDeleted: { $ne: true },
  })
    .setOptions({ tenantId })
    .select(
      [
        'title',
        'slug',
        'categoria',
        'category',
        'categoryName',
        'subcategoria',
        'subcategory',
        'marca',
        'brand',
        'fabricante',
        'tags',
        'price',
        'stock',
        'status',
        'visibility',
        'hasVariants',
        'variants',
        'productAttributes',
        'categoryAttributes',
        'atributos',
        'specifications',
        'filterAttributes',
        'logistics',
        'seo',
        'updatedAt',
        'createdAt',
      ].join(' '),
    )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(MAX_CATALOG_PRODUCTS_FOR_LEARNING)
    .lean()

  const categories = []
  const subcategories = []
  const brands = []
  const tags = []
  const shippingTypes = []
  const attributeRows = []
  const productExamples = []

  for (const product of products) {
    const category = clean(product.categoria || product.category || product.categoryName)
    const subcategory = clean(product.subcategoria || product.subcategory)
    const brand = clean(product.marca || product.brand || product.fabricante)

    if (category) categories.push(category)
    if (subcategory) subcategories.push(subcategory)
    if (brand) brands.push(brand)

    tags.push(...safeArray(product.tags).map(clean).filter(Boolean))

    const shippingType = clean(product?.logistics?.shippingType)
    if (shippingType) shippingTypes.push(shippingType)

    attributeRows.push(...extractProductAttributeRows(product))

    if (productExamples.length < MAX_CATALOG_PRODUCTS_IN_SUMMARY) {
      productExamples.push({
        title: clean(product.title),
        category,
        subcategory,
        brand,
        price: Number(product.price || 0),
        stock: Number(product.stock || 0),
        hasVariants: Boolean(product.hasVariants || safeArray(product.variants).length),
        status: clean(product.status),
        visibility: clean(product.visibility),
      })
    }
  }

  return {
    totalProducts: products.length,
    categories: countValues(categories),
    subcategories: countValues(subcategories),
    brands: countValues(brands),
    tags: countValues(tags).slice(0, MAX_TAGS_IN_SUMMARY),
    shippingTypes: countValues(shippingTypes),
    attributeRows,
    productExamples,
  }
}

const buildCatalogKnowledgeContent = ({ snapshot, tenant } = {}) => {
  const storeName = getTenantName(tenant)
  const currency = getTenantCurrency(tenant)

  const attributeSummary = countValues(
    safeArray(snapshot?.attributeRows).map(row => `${row.label || row.key}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`),
  ).slice(0, MAX_ATTRIBUTES_IN_SUMMARY)

  const categoryText = safeArray(snapshot?.categories)
    .slice(0, 40)
    .map(item => `- ${item.value} (${item.count})`)
    .join('\n')

  const subcategoryText = safeArray(snapshot?.subcategories)
    .slice(0, 60)
    .map(item => `- ${item.value} (${item.count})`)
    .join('\n')

  const brandText = safeArray(snapshot?.brands)
    .slice(0, 40)
    .map(item => `- ${item.value} (${item.count})`)
    .join('\n')

  const tagText = safeArray(snapshot?.tags)
    .slice(0, 60)
    .map(item => `- ${item.value} (${item.count})`)
    .join('\n')

  const attributeText = attributeSummary
    .map(item => `- ${item.value} (${item.count})`)
    .join('\n')

  const productText = safeArray(snapshot?.productExamples)
    .slice(0, 40)
    .map(product => {
      const parts = [
        product.title,
        product.brand ? `marca ${product.brand}` : '',
        product.category ? `categoría ${product.category}` : '',
        product.subcategory ? `subcategoría ${product.subcategory}` : '',
        product.price > 0 ? `precio ${currency} ${product.price}` : '',
        `stock ${product.stock}`,
        product.hasVariants ? 'con variantes' : 'sin variantes',
      ].filter(Boolean)

      return `- ${parts.join(' · ')}`
    })
    .join('\n')

  const content = `
Resumen de catálogo para el asistente de ${storeName}.

Uso:
- Este resumen ayuda a orientar recomendaciones y diálogo comercial.
- No reemplaza la consulta exacta al catálogo cuando se requiera stock, precio o variante vigente.
- Si un dato específico no aparece en el producto consultado, el asistente debe aclarar que no está confirmado.

Total de productos analizados: ${snapshot?.totalProducts || 0}

Categorías frecuentes:
${categoryText || '- Sin categorías detectadas'}

Subcategorías frecuentes:
${subcategoryText || '- Sin subcategorías detectadas'}

Marcas frecuentes:
${brandText || '- Sin marcas detectadas'}

Etiquetas frecuentes:
${tagText || '- Sin etiquetas detectadas'}

Atributos y especificaciones frecuentes:
${attributeText || '- Sin atributos dinámicos detectados'}

Ejemplos de productos recientes:
${productText || '- Sin productos disponibles'}

Reglas de razonamiento:
- Para recomendar, cruzar categoría, necesidad del cliente, presupuesto, marca, variantes, stock y especificaciones visibles.
- Para comparar, explicar diferencias concretas y evitar inventar beneficios.
- Para envíos, pagos, cambios o garantías, usar políticas aprobadas; si faltan, derivar a asesor.
`.trim()

  return truncate(content, MAX_KNOWLEDGE_CONTENT_CHARS)
}

const ensureCatalogKnowledgeForTenant = async ({ tenantId, tenant } = {}) => {
  const snapshot = await fetchCatalogSnapshot({ tenantId })
  const content = buildCatalogKnowledgeContent({ snapshot, tenant })

  return AiKnowledge.findOneAndUpdate(
    {
      tenantId,
      source: 'system',
      title: 'Resumen inteligente del catálogo',
    },
    {
      $set: {
        type: 'custom',
        content,
        tags: ['catalogo', 'aprendizaje', 'recomendaciones', 'razonamiento'],
        status: 'approved',
        confidence: snapshot.totalProducts > 0 ? 0.9 : 0.45,
        approvedAt: new Date(),
        metadata: {
          provisionedBy: 'ai_agent_default_provisioning',
          provisioningVersion: PROVISIONING_VERSION,
          totalProducts: snapshot.totalProducts,
          categoriesCount: snapshot.categories.length,
          brandsCount: snapshot.brands.length,
          generatedAt: new Date(),
        },
      },
      $setOnInsert: {
        tenantId,
        source: 'system',
        title: 'Resumen inteligente del catálogo',
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).setOptions({ tenantId })
}

const registerPreferenceSafe = async ({
  tenantId,
  rawInput,
  correctedValue,
  type,
  confidence = 0.75,
  metadata = {},
}) => {
  const cleanRawInput = compact(rawInput)
  const cleanCorrectedValue = compact(correctedValue || rawInput)

  if (!cleanRawInput || !cleanCorrectedValue) return null

  try {
    return await AIPreference.registerPreference({
      tenantId,
      rawInput: cleanRawInput,
      correctedValue: cleanCorrectedValue,
      type,
      confidence,
      source: 'catalog_snapshot',
      metadata: {
        provisionedBy: 'catalog_snapshot',
        provisioningVersion: PROVISIONING_VERSION,
        ...metadata,
      },
    })
  } catch (error) {
    return {
      skipped: true,
      type,
      rawInput: cleanRawInput,
      reason: error?.message || 'Preference rejected by schema',
    }
  }
}

const ensureCatalogPreferencesForTenant = async ({ tenantId } = {}) => {
  const snapshot = await fetchCatalogSnapshot({ tenantId })

  const preferences = [
    ...safeArray(snapshot.categories).slice(0, MAX_PREFERENCES_PER_TYPE).map(item => ({
      rawInput: item.value,
      correctedValue: item.value,
      type: 'category',
      metadata: { count: item.count },
    })),
    ...safeArray(snapshot.brands).slice(0, MAX_PREFERENCES_PER_TYPE).map(item => ({
      rawInput: item.value,
      correctedValue: item.value,
      type: 'brand',
      metadata: { count: item.count },
    })),
  ]

  const results = []

  for (const preference of preferences) {
    results.push(
      await registerPreferenceSafe({
        tenantId,
        rawInput: preference.rawInput,
        correctedValue: preference.correctedValue,
        type: preference.type,
        confidence: 0.78,
        metadata: preference.metadata,
      }),
    )
  }

  return results.filter(Boolean)
}

export const provisionAiAgentDefaultsForTenant = async ({
  tenantId,
  tenant = null,
} = {}) => {
  if (!tenantId) return null

  const [
    campaignRules,
    knowledge,
    catalogKnowledge,
    suggestions,
    preferences,
  ] = await Promise.all([
    ensureDefaultCampaignRulesForTenant({ tenantId }),
    ensureDefaultKnowledgeForTenant({ tenantId, tenant }),
    ensureCatalogKnowledgeForTenant({ tenantId, tenant }),
    ensureDefaultLearningSuggestionsForTenant({ tenantId, tenant }),
    ensureCatalogPreferencesForTenant({ tenantId }),
  ])

  return {
    provisioningVersion: PROVISIONING_VERSION,
    campaignRules,
    knowledge,
    catalogKnowledge,
    suggestions,
    preferences,
  }
}

const buildExistingAgentPatch = ({ tenant } = {}) => {
  const storeName = getTenantName(tenant)
  const currency = getTenantCurrency(tenant)
  const locale = getTenantLocale(tenant)

  return {
    'personality.language': locale,
    'behavior.canRecommendProducts': true,
    'behavior.canCreateCartLinks': true,
    'behavior.requireHumanForPayments': true,
    'behavior.requireHumanForClaims': true,
    'behavior.canCompareProducts': true,
    'behavior.canExplainVariants': true,
    'behavior.canUseCatalogSpecifications': true,
    'behavior.askClarifyingQuestions': true,
    'behavior.maxClarifyingQuestions': 1,
    'behavior.reasoning': buildAgentReasoningPolicy({ storeName, currency }),
    'behavior.learning.enabled': true,
    'behavior.learning.requireHumanApproval': true,
    'businessContext.storeName': storeName,
    'businessContext.currency': currency,
    'metadata.provisioningVersion': PROVISIONING_VERSION,
    'metadata.lastProvisionedAt': new Date(),
  }
}

export const getOrCreateAiAgentForTenant = async ({
  tenantId,
  tenant = null,
  ensureDefaults = true,
  refreshAgentConfig = true,
} = {}) => {
  if (!tenantId) {
    throw new Error('tenantId es obligatorio para provisionar AiAgent')
  }

  const existingAgent = await AiAgent.findOne({ tenantId })
    .setOptions({ tenantId })
    .lean()

  if (existingAgent) {
    if (refreshAgentConfig) {
      await AiAgent.updateOne(
        { tenantId },
        {
          $set: buildExistingAgentPatch({ tenant }),
        },
      ).setOptions({ tenantId })
    }

    if (ensureDefaults) {
      await provisionAiAgentDefaultsForTenant({ tenantId, tenant })
    }

    return AiAgent.findOne({ tenantId })
      .setOptions({ tenantId })
      .lean()
  }

  const payload = buildDefaultAiAgentPayload({
    tenantId,
    tenant,
  })

  const agent = await AiAgent.findOneAndUpdate(
    { tenantId },
    {
      $setOnInsert: payload,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  )
    .setOptions({ tenantId })
    .lean()

  if (ensureDefaults) {
    await provisionAiAgentDefaultsForTenant({ tenantId, tenant })
  }

  return agent
}
