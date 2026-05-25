import CorrectionLog from '../models/correctionLog.js'
import { promoteLearnedRulesForTenant } from './aiLearningPromotionService.js'

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

function buildFieldRule(field, fromValue, toValue, confidence = 0.72) {
  return {
    field,
    rule: `Para este tenant, cuando la IA produzca "${fromValue}", preferir "${toValue}" en el campo "${field}" si el contexto visual coincide.`,
    confidence,
  }
}

function buildMissingToValueRule(field, toValue, confidence = 0.62) {
  return {
    field,
    rule: `Para este tenant, cuando la IA no logre inferir el campo "${field}", considerar "${toValue}" si el contexto visual coincide.`,
    confidence,
  }
}

function dedupeRules(rules) {
  const map = new Map()

  for (const rule of rules) {
    const key = `${rule.field || 'general'}::${rule.rule}`.toLowerCase()
    const existing = map.get(key)

    if (!existing || (existing.confidence || 0) < (rule.confidence || 0)) {
      map.set(key, rule)
    }
  }

  return [...map.values()]
}

function computeLearnedRules(originalIAOutput, humanCorrection) {
  
  const rules = []

  const originalCategory = safeString(originalIAOutput?.categoria)
  const correctedCategory = safeString(humanCorrection?.categoria)

  if (!originalCategory && correctedCategory) {
    rules.push(buildMissingToValueRule('category', correctedCategory))
  } else if (
    originalCategory &&
    correctedCategory &&
    originalCategory !== correctedCategory
  ) {
    rules.push(buildFieldRule('category', originalCategory, correctedCategory))
  }

  const originalSubcategory = safeString(originalIAOutput?.subcategoria)
  const correctedSubcategory = safeString(humanCorrection?.subcategoria)

  if (!originalSubcategory && correctedSubcategory) {
    rules.push(buildMissingToValueRule('subcategory', correctedSubcategory))
  } else if (
    originalSubcategory &&
    correctedSubcategory &&
    originalSubcategory !== correctedSubcategory
  ) {
    rules.push(buildFieldRule('subcategory', originalSubcategory, correctedSubcategory))
  }

  const originalBrand = safeString(originalIAOutput?.marca)
  const correctedBrand = safeString(humanCorrection?.marca)

  if (!originalBrand && correctedBrand) {
    rules.push(buildMissingToValueRule('brand', correctedBrand, 0.58))
  } else if (
    originalBrand &&
    correctedBrand &&
    originalBrand !== correctedBrand
  ) {
    rules.push(buildFieldRule('brand', originalBrand, correctedBrand, 0.67))
  }

  const originalAttributes = normalizeAttributes(originalIAOutput?.atributos)
  const correctedAttributes = normalizeAttributes(humanCorrection?.atributos)

  for (const [key, correctedValue] of Object.entries(correctedAttributes)) {
    const originalValue = safeString(originalAttributes[key])

    if (!originalValue && correctedValue) {
      rules.push(buildMissingToValueRule(`attribute.${key}`, correctedValue, 0.6))
      continue
    }

    if (originalValue && originalValue !== correctedValue) {
      rules.push(buildFieldRule(`attribute.${key}`, originalValue, correctedValue))
    }
  }

  const originalTags = uniqueStringArray(originalIAOutput?.tags, { lower: true })
  const correctedTags = uniqueStringArray(humanCorrection?.tags, { lower: true })

  const addedTags = correctedTags.filter(tag => !originalTags.includes(tag))
  if (addedTags.length) {
    rules.push({
      field: 'tag',
      rule: `Para este tenant, considerar tags adicionales como: ${addedTags.join(', ')} cuando el contexto del producto sea similar.`,
      confidence: 0.6,
    })
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

  const logEntry = await CorrectionLog.create({
    tenantId: normalizedTenantId,
    originalIAOutput,
    humanCorrection,
    metadata: safeMetadata,
    learnedRules,
  })

  const promotionResult = await promoteLearnedRulesForTenant(normalizedTenantId)

  return {
    logEntry,
    learnedRules,
    promotionResult,
  }
}