// 📁 src/services/aiLearningService.js
import CorrectionLog from '../models/correctionLog.js'
import { promoteLearnedRulesForTenant } from './aiLearningPromotionService.js'
import logger from '../../config/logger.js'

function safeString(value, { lower = false } = {}) {
  if (typeof value !== 'string') return null

  const clean = value.trim()

  if (!clean) return null

  return lower ? clean.toLowerCase() : clean
}

function uniqueStringArray(value, { lower = false } = {}) {
  if (!Array.isArray(value)) return []

  const normalized = value
    .map(v => safeString(String(v ?? ''), { lower }))
    .filter(Boolean)

  return [...new Set(normalized)]
}

function normalizeAttributes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const out = {}

  for (const [key, val] of Object.entries(value)) {
    const cleanKey = safeString(String(key ?? ''), { lower: true })
    const cleanVal = safeString(String(val ?? ''))

    if (cleanKey && cleanVal) {
      out[cleanKey] = cleanVal
    }
  }

  return out
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function mapFieldToPreferenceType(field) {
  if (field === 'category') return 'category'
  if (field === 'subcategory') return 'subcategory'
  if (field === 'brand') return 'brand'
  if (field === 'tag') return 'tag'
  if (field?.startsWith('attribute.material')) return 'material'
  if (field?.startsWith('attribute.')) return 'attribute'
  return 'general'
}

function buildStructuredRule({
  field,
  rawInput = null,
  correctedValue,
  confidence = 0.72,
  reason = null,
}) {
  const normalizedField = safeString(String(field || ''), { lower: true })
  const normalizedRawInput = safeString(String(rawInput ?? ''))
  const normalizedCorrectedValue = safeString(String(correctedValue ?? ''))

  if (!normalizedField || !normalizedCorrectedValue) {
    return null
  }

  const type = mapFieldToPreferenceType(normalizedField)

  const rule = normalizedRawInput
    ? `Para este tenant, cuando la IA produzca "${normalizedRawInput}", preferir "${normalizedCorrectedValue}" en el campo "${normalizedField}" si el contexto visual coincide.`
    : `Para este tenant, cuando la IA no logre inferir el campo "${normalizedField}", considerar "${normalizedCorrectedValue}" si el contexto visual coincide.`

  return {
    field: normalizedField,
    type,
    rawInput: normalizedRawInput || `__missing__:${normalizedField}`,
    correctedValue: normalizedCorrectedValue,
    rule: reason || rule,
    confidence,
  }
}

function dedupeRules(rules) {
  const map = new Map()

  for (const rule of rules.filter(Boolean)) {
    const key = `${rule.type || 'general'}::${rule.field || 'general'}::${rule.rawInput || ''}::${rule.correctedValue || ''}`.toLowerCase()
    const existing = map.get(key)

    if (!existing || Number(existing.confidence || 0) < Number(rule.confidence || 0)) {
      map.set(key, rule)
    }
  }

  return [...map.values()]
}

function buildDiffSummary(originalIAOutput, humanCorrection) {
  const diff = []

  const addDiff = (field, originalValue, correctedValue) => {
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

  addDiff('category', originalIAOutput?.categoria, humanCorrection?.categoria)
  addDiff('subcategory', originalIAOutput?.subcategoria, humanCorrection?.subcategoria)
  addDiff('brand', originalIAOutput?.marca, humanCorrection?.marca)

  const originalAttributes = normalizeAttributes(originalIAOutput?.atributos)
  const correctedAttributes = normalizeAttributes(humanCorrection?.atributos)

  for (const key of new Set([
    ...Object.keys(originalAttributes),
    ...Object.keys(correctedAttributes),
  ])) {
    addDiff(`attribute.${key}`, originalAttributes[key], correctedAttributes[key])
  }

  return diff
}

function computeLearnedRules(originalIAOutput, humanCorrection) {
  const rules = []

  const originalCategory = safeString(originalIAOutput?.categoria)
  const correctedCategory = safeString(humanCorrection?.categoria)

  if (!originalCategory && correctedCategory) {
    rules.push(buildStructuredRule({
      field: 'category',
      correctedValue: correctedCategory,
      confidence: 0.62,
    }))
  } else if (
    originalCategory &&
    correctedCategory &&
    originalCategory !== correctedCategory
  ) {
    rules.push(buildStructuredRule({
      field: 'category',
      rawInput: originalCategory,
      correctedValue: correctedCategory,
      confidence: 0.72,
    }))
  }

  const originalSubcategory = safeString(originalIAOutput?.subcategoria)
  const correctedSubcategory = safeString(humanCorrection?.subcategoria)

  if (!originalSubcategory && correctedSubcategory) {
    rules.push(buildStructuredRule({
      field: 'subcategory',
      correctedValue: correctedSubcategory,
      confidence: 0.62,
    }))
  } else if (
    originalSubcategory &&
    correctedSubcategory &&
    originalSubcategory !== correctedSubcategory
  ) {
    rules.push(buildStructuredRule({
      field: 'subcategory',
      rawInput: originalSubcategory,
      correctedValue: correctedSubcategory,
      confidence: 0.72,
    }))
  }

  const originalBrand = safeString(originalIAOutput?.marca)
  const correctedBrand = safeString(humanCorrection?.marca)

  if (!originalBrand && correctedBrand) {
    rules.push(buildStructuredRule({
      field: 'brand',
      correctedValue: correctedBrand,
      confidence: 0.58,
    }))
  } else if (
    originalBrand &&
    correctedBrand &&
    originalBrand !== correctedBrand
  ) {
    rules.push(buildStructuredRule({
      field: 'brand',
      rawInput: originalBrand,
      correctedValue: correctedBrand,
      confidence: 0.67,
    }))
  }

  const originalAttributes = normalizeAttributes(originalIAOutput?.atributos)
  const correctedAttributes = normalizeAttributes(humanCorrection?.atributos)

  for (const [key, correctedValue] of Object.entries(correctedAttributes)) {
    const originalValue = safeString(originalAttributes[key])
    const field = `attribute.${key}`

    if (!originalValue && correctedValue) {
      rules.push(buildStructuredRule({
        field,
        correctedValue,
        confidence: 0.6,
      }))

      continue
    }

    if (originalValue && originalValue !== correctedValue) {
      rules.push(buildStructuredRule({
        field,
        rawInput: originalValue,
        correctedValue,
        confidence: 0.72,
      }))
    }
  }

  const originalTags = uniqueStringArray(originalIAOutput?.tags, { lower: true })
  const correctedTags = uniqueStringArray(humanCorrection?.tags, { lower: true })

  const addedTags = correctedTags.filter(tag => !originalTags.includes(tag))

  for (const tag of addedTags) {
    rules.push(buildStructuredRule({
      field: 'tag',
      rawInput: '__missing__:tag',
      correctedValue: tag,
      confidence: 0.6,
      reason: `Para este tenant, considerar el tag "${tag}" cuando el contexto del producto sea similar.`,
    }))
  }

  return dedupeRules(rules)
}

export async function registerVisualFeedback({
  tenantId,
  originalIAOutput,
  humanCorrection,
  metadata = {},
}) {
  const normalizedTenantId = String(tenantId || '').trim()

  if (!normalizedTenantId) {
    throw new Error('tenantId es requerido')
  }

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
    imageHash: safeMetadata?.imageHash || originalIAOutput?.hash || null,
    sourceModel: safeMetadata?.sourceModel || originalIAOutput?.source || null,
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
      promotionResult,
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
    promotionResult,
  }
}