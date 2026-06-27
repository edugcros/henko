// 📁 src/services/aiLearningPromotionService.js
import AIPreference from '../models/aIPreference.js'
import CorrectionLog from '../models/correctionLog.js'

const PROMOTION_MIN_OCCURRENCES = Math.min(
  Math.max(Number(process.env.AI_PROMOTION_MIN_OCCURRENCES || 3), 1),
  50,
)
const PROMOTION_MIN_CONFIDENCE = Math.min(
  Math.max(Number(process.env.AI_PROMOTION_MIN_CONFIDENCE || 0.8), 0),
  1,
)
const MAX_RECENT_LOGS = Math.min(
  Math.max(Number(process.env.AI_PROMOTION_LOOKBACK || 200), 20),
  2000,
)

const FINAL_LOG_STATUSES = new Set(['approved', 'rejected'])

function safeString(value, { lower = false, maxLength = 500 } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const clean = String(value).trim()
  if (!clean) return null

  const truncated = clean.slice(0, maxLength)
  return lower ? truncated.toLowerCase() : truncated
}

function normalizeType(field) {
  const clean = safeString(field, { lower: true, maxLength: 120 })

  if (!clean) return 'general'
  if (clean === 'category' || clean === 'categoria') return 'category'
  if (clean === 'subcategory' || clean === 'subcategoria') return 'subcategory'
  if (clean === 'brand' || clean === 'marca') return 'brand'
  if (clean === 'title' || clean === 'titulo') return 'title'
  if (clean === 'description' || clean === 'descripcion') return 'description'
  if (clean === 'price' || clean === 'precio' || clean === 'precio_sugerido') return 'price'
  if (clean === 'tag' || clean === 'tags') return 'tag'
  if (clean.startsWith('attribute.material')) return 'material'
  if (clean.startsWith('attribute.color')) return 'color'
  if (clean.startsWith('attribute.')) return 'attribute'

  return 'general'
}

function extractFromRuleText(ruleText) {
  const text = safeString(ruleText, { maxLength: 2000 })
  if (!text) return null

  const matches = [...text.matchAll(/"([^"]+)"/g)].map(match => match[1])
  if (matches.length < 2) return null

  return {
    rawInput: safeString(matches[0], { lower: true, maxLength: 160 }),
    correctedValue: safeString(matches[1], { maxLength: 240 }),
  }
}

function extractFromLearnedRule(learned) {
  const rawInput = safeString(learned?.rawInput, {
    lower: true,
    maxLength: 160,
  })
  const correctedValue = safeString(learned?.correctedValue, {
    maxLength: 240,
  })

  if (rawInput && correctedValue) {
    return { rawInput, correctedValue }
  }

  return extractFromRuleText(learned?.rule)
}

function confidenceScore(logRule, occurrences, contradictions) {
  const base =
    typeof logRule?.confidence === 'number' && Number.isFinite(logRule.confidence)
      ? logRule.confidence
      : 0.5
  const repetitionBoost = Math.min(0.25, Math.max(occurrences, 0) * 0.05)
  const contradictionPenalty = Math.min(0.35, Math.max(contradictions, 0) * 0.1)

  const finalScore = base + repetitionBoost - contradictionPenalty
  return Math.max(0, Math.min(1, finalScore))
}

async function upsertPreference({
  tenantId,
  rawInput,
  correctedValue,
  type,
  field,
  confidence,
}) {
  return AIPreference.findOneAndUpdate(
    {
      tenantId,
      rawInput,
      type,
    },
    {
      $setOnInsert: {
        tenantId,
        rawInput,
        type,
        usageCount: 0,
        createdAt: new Date(),
      },
      $set: {
        correctedValue,
        field,
        source: 'auto-learning',
        lastUsedAt: new Date(),
      },
      $inc: {
        usageCount: 1,
      },
      $max: {
        confidence,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  )
    .setOptions({ tenantId })
    .lean()
}

export async function promoteLearnedRulesForTenant(tenantId) {
  const normalizedTenantId = safeString(tenantId, { maxLength: 80 })

  if (!normalizedTenantId) {
    throw new Error('tenantId es requerido')
  }

  const logs = await CorrectionLog.find({ tenantId: normalizedTenantId })
    .setOptions({ tenantId: normalizedTenantId })
    .sort({ createdAt: -1 })
    .limit(MAX_RECENT_LOGS)
    .lean()

  const candidates = new Map()

  for (const log of logs) {
    if (FINAL_LOG_STATUSES.has(log?.status)) continue

    const learnedRules = Array.isArray(log?.learnedRules) ? log.learnedRules : []

    for (const learned of learnedRules) {
      const field = safeString(learned?.field, {
        lower: true,
        maxLength: 120,
      }) || 'general'
      const type = normalizeType(learned?.type || field)
      const extracted = extractFromLearnedRule(learned)

      if (!extracted?.rawInput || !extracted?.correctedValue) continue

      const key = `${type}::${field}::${extracted.rawInput}`

      if (!candidates.has(key)) {
        candidates.set(key, {
          field,
          type,
          rawInput: extracted.rawInput,
          outcomes: new Map(),
        })
      }

      const candidate = candidates.get(key)
      const outcomeKey = safeString(extracted.correctedValue, {
        lower: true,
        maxLength: 240,
      })

      if (!outcomeKey) continue

      const existingOutcome = candidate.outcomes.get(outcomeKey) || {
        correctedValue: extracted.correctedValue,
        occurrences: 0,
        exampleRule: learned,
      }

      existingOutcome.occurrences += 1
      existingOutcome.exampleRule = learned
      candidate.outcomes.set(outcomeKey, existingOutcome)
    }
  }

  const promoted = []
  const skipped = []

  for (const candidate of candidates.values()) {
    const outcomes = [...candidate.outcomes.values()].sort(
      (a, b) => b.occurrences - a.occurrences,
    )

    if (!outcomes.length) continue

    const winner = outcomes[0]
    const contradictions = outcomes
      .slice(1)
      .reduce((sum, item) => sum + item.occurrences, 0)

    const score = confidenceScore(
      winner.exampleRule,
      winner.occurrences,
      contradictions,
    )

    const shouldPromote =
      winner.occurrences >= PROMOTION_MIN_OCCURRENCES &&
      score >= PROMOTION_MIN_CONFIDENCE &&
      contradictions < winner.occurrences

    const resultBase = {
      field: candidate.field,
      type: candidate.type,
      rawInput: candidate.rawInput,
      correctedValue: winner.correctedValue,
      occurrences: winner.occurrences,
      contradictions,
      score,
    }

    if (!shouldPromote) {
      skipped.push(resultBase)
      continue
    }

    const pref = await upsertPreference({
      tenantId: normalizedTenantId,
      rawInput: candidate.rawInput,
      correctedValue: winner.correctedValue,
      type: candidate.type,
      field: candidate.field,
      confidence: score,
    })

    promoted.push({
      ...resultBase,
      preferenceId: pref?._id || null,
    })
  }

  return {
    promoted,
    skipped,
    stats: {
      scannedLogs: logs.length,
      candidates: candidates.size,
      promoted: promoted.length,
      skipped: skipped.length,
    },
  }
}
