// 📁 src/services/aiLearningService.js
import crypto from 'node:crypto'
import CorrectionLog from '../models/correctionLog.js'
import { promoteLearnedRulesForTenant } from './aiLearningPromotionService.js'
import logger from '../../config/logger.js'

function safeString(value, { lower = false, maxLength = 500 } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const clean = String(value).trim()
  if (!clean) return null

  const truncated = clean.slice(0, maxLength)
  return lower ? truncated.toLowerCase() : truncated
}

function uniqueStringArray(value, { lower = false, maxItems = 30 } = {}) {
  if (!Array.isArray(value)) return []

  const normalized = value
    .map(v => safeString(v, { lower, maxLength: 120 }))
    .filter(Boolean)

  return [...new Set(normalized)].slice(0, maxItems)
}

function normalizeAttributes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const out = {}

  for (const [key, val] of Object.entries(value)) {
    const cleanKey = safeString(key, { lower: true, maxLength: 80 })
    const cleanVal = safeString(val, { maxLength: 240 })

    if (cleanKey && cleanVal) out[cleanKey] = cleanVal
  }

  return out
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  const normalized = String(value)
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3})/g, '')
    .replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return {
    imageHash: safeString(value.imageHash, { lower: true, maxLength: 128 }),
    sourceModel: safeString(value.sourceModel, { maxLength: 120 }),
    source: safeString(value.source, { maxLength: 120 }),
    productId: safeString(value.productId, { maxLength: 80 }),
    jobId: safeString(value.jobId, { maxLength: 80 }),
    userId: safeString(value.userId, { maxLength: 80 }),
    businessRuleHint: safeString(value.businessRuleHint, { maxLength: 300 }),
  }
}

function mapFieldToPreferenceType(field) {
  if (field === 'category') return 'category'
  if (field === 'subcategory') return 'subcategory'
  if (field === 'brand') return 'brand'
  if (field === 'title') return 'title'
  if (field === 'description') return 'description'
  if (field === 'price' || field === 'precio_sugerido') return 'price'
  if (field === 'tag') return 'tag'
  if (field?.startsWith('attribute.material')) return 'material'
  if (field?.startsWith('attribute.color')) return 'color'
  if (field?.startsWith('attribute.')) return 'attribute'
  return 'general'
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function buildStructuredRule({
  field,
  rawInput = null,
  correctedValue,
  confidence = 0.72,
  reason = null,
}) {
  const normalizedField = safeString(field, { lower: true, maxLength: 120 })
  const normalizedRawInput = safeString(rawInput, { lower: true, maxLength: 240 })
  const normalizedCorrectedValue = safeString(correctedValue, { maxLength: 240 })

  if (!normalizedField || !normalizedCorrectedValue) return null

  const type = mapFieldToPreferenceType(normalizedField)
  const effectiveRawInput = normalizedRawInput || `__missing__:${normalizedField}`
  const fingerprint = hash(
    `${type}:${normalizedField}:${effectiveRawInput}:${normalizedCorrectedValue}`,
  ).slice(0, 40)

  const rule = normalizedRawInput
    ? `Para este tenant, cuando la IA produzca "${normalizedRawInput}", preferir "${normalizedCorrectedValue}" en el campo "${normalizedField}" si el contexto visual coincide.`
    : `Para este tenant, cuando la IA no logre inferir el campo "${normalizedField}", considerar "${normalizedCorrectedValue}" si el contexto visual coincide.`

  return {
    field: normalizedField,
    type,
    rawInput: effectiveRawInput,
    correctedValue: normalizedCorrectedValue,
    rule: safeString(reason, { maxLength: 500 }) || rule,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0.5)),
    fingerprint,
  }
}

function dedupeRules(rules) {
  const map = new Map()

  for (const rule of rules.filter(Boolean)) {
    const key = rule.fingerprint || `${rule.type}:${rule.field}:${rule.rawInput}:${rule.correctedValue}`.toLowerCase()
    const existing = map.get(key)

    if (!existing || Number(existing.confidence || 0) < Number(rule.confidence || 0)) {
      map.set(key, rule)
    }
  }

  return [...map.values()]
}

function addDiff(diff, field, originalValue, correctedValue) {
  const originalString = originalValue === undefined || originalValue === null
    ? null
    : String(originalValue)
  const correctedString = correctedValue === undefined || correctedValue === null
    ? null
    : String(correctedValue)

  if (originalString !== correctedString) {
    diff.push({
      field,
      originalValue: originalValue ?? null,
      correctedValue: correctedValue ?? null,
    })
  }
}

function getNormalizedVisualFields(value = {}) {
  const atributos = normalizeAttributes(value.atributos || value.attributes)

  return {
    title: safeString(value.titulo || value.title, { maxLength: 180 }),
    description: safeString(value.descripcion || value.description, { maxLength: 1500 }),
    category: safeString(value.categoria || value.category, { maxLength: 160 }),
    subcategory: safeString(value.subcategoria || value.subcategory, { maxLength: 160 }),
    brand: safeString(value.marca || value.brand, { maxLength: 160 }),
    price: normalizeNumber(value.precio_sugerido ?? value.suggestedPrice ?? value.price),
    tags: uniqueStringArray(value.tags, { lower: true, maxItems: 40 }),
    atributos,
  }
}

function buildDiffSummary(originalIAOutput, humanCorrection) {
  const diff = []
  const original = getNormalizedVisualFields(originalIAOutput)
  const corrected = getNormalizedVisualFields(humanCorrection)

  addDiff(diff, 'title', original.title, corrected.title)
  addDiff(diff, 'description', original.description, corrected.description)
  addDiff(diff, 'category', original.category, corrected.category)
  addDiff(diff, 'subcategory', original.subcategory, corrected.subcategory)
  addDiff(diff, 'brand', original.brand, corrected.brand)
  addDiff(diff, 'price', original.price, corrected.price)

  for (const key of new Set([
    ...Object.keys(original.atributos),
    ...Object.keys(corrected.atributos),
  ])) {
    addDiff(diff, `attribute.${key}`, original.atributos[key], corrected.atributos[key])
  }

  const originalTags = original.tags
  const correctedTags = corrected.tags
  const addedTags = correctedTags.filter(tag => !originalTags.includes(tag))
  const removedTags = originalTags.filter(tag => !correctedTags.includes(tag))

  if (addedTags.length || removedTags.length) {
    diff.push({
      field: 'tags',
      originalValue: originalTags,
      correctedValue: correctedTags,
      added: addedTags,
      removed: removedTags,
    })
  }

  return diff
}

function pushRuleIfChanged(rules, { field, originalValue, correctedValue, confidence }) {
  const original = safeString(originalValue, { maxLength: 240 })
  const corrected = safeString(correctedValue, { maxLength: 240 })

  if (!corrected) return

  rules.push(
    buildStructuredRule({
      field,
      rawInput: original || null,
      correctedValue: corrected,
      confidence: original ? confidence : Math.max(0.55, confidence - 0.1),
    }),
  )
}

function computeLearnedRules(originalIAOutput, humanCorrection) {
  const rules = []
  const original = getNormalizedVisualFields(originalIAOutput)
  const corrected = getNormalizedVisualFields(humanCorrection)

  pushRuleIfChanged(rules, {
    field: 'title',
    originalValue: original.title,
    correctedValue: corrected.title,
    confidence: 0.55,
  })
  pushRuleIfChanged(rules, {
    field: 'description',
    originalValue: original.description,
    correctedValue: corrected.description,
    confidence: 0.5,
  })
  pushRuleIfChanged(rules, {
    field: 'category',
    originalValue: original.category,
    correctedValue: corrected.category,
    confidence: 0.72,
  })
  pushRuleIfChanged(rules, {
    field: 'subcategory',
    originalValue: original.subcategory,
    correctedValue: corrected.subcategory,
    confidence: 0.72,
  })
  pushRuleIfChanged(rules, {
    field: 'brand',
    originalValue: original.brand,
    correctedValue: corrected.brand,
    confidence: 0.67,
  })

  if (corrected.price !== null && original.price !== corrected.price) {
    rules.push(
      buildStructuredRule({
        field: 'price',
        rawInput: original.price === null ? null : String(original.price),
        correctedValue: String(corrected.price),
        confidence: original.price === null ? 0.45 : 0.55,
      }),
    )
  }

  for (const [key, correctedValue] of Object.entries(corrected.atributos)) {
    const originalValue = original.atributos[key]
    if (originalValue === correctedValue) continue

    rules.push(
      buildStructuredRule({
        field: `attribute.${key}`,
        rawInput: originalValue || null,
        correctedValue,
        confidence: key === 'material' || key === 'color' ? 0.72 : 0.65,
      }),
    )
  }

  const addedTags = corrected.tags.filter(tag => !original.tags.includes(tag))

  for (const tag of addedTags) {
    rules.push(
      buildStructuredRule({
        field: 'tag',
        rawInput: '__missing__:tag',
        correctedValue: tag,
        confidence: 0.6,
        reason: `Para este tenant, considerar el tag "${tag}" cuando el contexto visual del producto sea similar.`,
      }),
    )
  }

  return dedupeRules(rules)
}

export async function registerVisualFeedback({
  tenantId,
  originalIAOutput,
  humanCorrection,
  metadata = {},
}) {
  const normalizedTenantId = safeString(tenantId, { maxLength: 80 })

  if (!normalizedTenantId) throw new Error('tenantId es requerido')

  if (!originalIAOutput || typeof originalIAOutput !== 'object' || Array.isArray(originalIAOutput)) {
    throw new Error('originalIAOutput es requerido')
  }

  if (!humanCorrection || typeof humanCorrection !== 'object' || Array.isArray(humanCorrection)) {
    throw new Error('humanCorrection es requerido')
  }

  const safeMetadata = normalizeMetadata(metadata)
  const learnedRules = computeLearnedRules(originalIAOutput, humanCorrection)
  const diffSummary = buildDiffSummary(originalIAOutput, humanCorrection)

  const logEntry = await CorrectionLog.create({
    tenantId: normalizedTenantId,
    imageHash: safeMetadata.imageHash || originalIAOutput.hash || null,
    sourceModel: safeMetadata.sourceModel || originalIAOutput.source || null,
    originalIAOutput,
    humanCorrection,
    diffSummary,
    metadata: safeMetadata,
    learnedRules,
  })

  logger.info('🧠 CorrectionLog creado', {
    tenantId: normalizedTenantId,
    correctionLogId: String(logEntry._id),
    learnedRulesCount: learnedRules.length,
    diffSummaryCount: diffSummary.length,
  })

  let promotionResult = null

  try {
    promotionResult = await promoteLearnedRulesForTenant(normalizedTenantId)

    logger.info('🧠 Resultado promoción IA', {
      tenantId: normalizedTenantId,
      promoted: promotionResult?.promoted?.length || 0,
      skipped: promotionResult?.skipped?.length || 0,
    })
  } catch (promotionError) {
    logger.error('❌ Error promoviendo reglas IA', {
      tenantId: normalizedTenantId,
      error: promotionError.stack || promotionError.message,
    })
  }

  return {
    logEntry,
    learnedRules,
    diffSummary,
    promotionResult,
  }
}
