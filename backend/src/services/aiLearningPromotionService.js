import AIPreference from '../models/aIPreference.js'
import CorrectionLog from '../models/correctionLog.js'

const PROMOTION_MIN_OCCURRENCES = Number(process.env.AI_PROMOTION_MIN_OCCURRENCES || 3)
const PROMOTION_MIN_CONFIDENCE = Number(process.env.AI_PROMOTION_MIN_CONFIDENCE || 0.8)
const MAX_RECENT_LOGS = Number(process.env.AI_PROMOTION_LOOKBACK || 200)

function safeString(value, { lower = false } = {}) {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  if (!clean) return null
  return lower ? clean.toLowerCase() : clean
}

function normalizeType(field) {
  const clean = safeString(field, { lower: true })

  if (!clean) return 'general'
  if (clean === 'category') return 'category'
  if (clean === 'subcategory') return 'subcategory'
  if (clean === 'brand') return 'brand'
  if (clean.startsWith('attribute.material')) return 'material'
  if (clean.startsWith('attribute.')) return 'attribute'
  if (clean === 'tag') return 'tag'
  return 'general'
}

function extractFromRuleText(ruleText) {
  const text = safeString(ruleText)
  if (!text) return null

  const matches = [...text.matchAll(/"([^"]+)"/g)].map(match => match[1])
  if (matches.length < 2) return null

  return {
    rawInput: safeString(matches[0], { lower: true }),
    correctedValue: safeString(matches[1]),
  }
}

function confidenceScore(logRule, occurrences, contradictions) {
  const base = typeof logRule?.confidence === 'number' ? logRule.confidence : 0.5
  const repetitionBoost = Math.min(0.25, occurrences * 0.05)
  const contradictionPenalty = Math.min(0.35, contradictions * 0.1)

  const finalScore = base + repetitionBoost - contradictionPenalty
  return Math.max(0, Math.min(1, finalScore))
}

async function upsertPreference({
  tenantId,
  rawInput,
  correctedValue,
  type,
  confidence,
}) {
  const existing = await AIPreference.findOne({
    tenantId,
    rawInput,
    type,
  })

  if (existing) {
    existing.correctedValue = correctedValue
    existing.usageCount += 1
    existing.lastUsedAt = new Date()
    existing.confidence = Math.max(existing.confidence || 0, confidence)
    existing.source = 'auto-learning'
    await existing.save()
    return existing
  }

  return AIPreference.create({
    tenantId,
    rawInput,
    correctedValue,
    type,
    usageCount: 1,
    confidence,
    lastUsedAt: new Date(),
    source: 'auto-learning',
  })
}

export async function promoteLearnedRulesForTenant(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId es requerido')
  }

  const logs = await CorrectionLog.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(MAX_RECENT_LOGS)
    .lean()

  const candidates = new Map()

  for (const log of logs) {
    const learnedRules = Array.isArray(log.learnedRules) ? log.learnedRules : []

    for (const learned of learnedRules) {
      const field = safeString(learned?.field, { lower: true }) || 'general'
      const extracted = extractFromRuleText(learned?.rule)

      if (!extracted?.rawInput || !extracted?.correctedValue) continue

      const key = `${field}::${extracted.rawInput}`

      if (!candidates.has(key)) {
        candidates.set(key, {
          field,
          rawInput: extracted.rawInput,
          outcomes: new Map(),
        })
      }

      const candidate = candidates.get(key)
      const existingOutcome = candidate.outcomes.get(extracted.correctedValue) || {
        correctedValue: extracted.correctedValue,
        occurrences: 0,
        exampleRule: learned,
      }

      existingOutcome.occurrences += 1
      existingOutcome.exampleRule = learned
      candidate.outcomes.set(extracted.correctedValue, existingOutcome)
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

    if (!shouldPromote) {
      skipped.push({
        field: candidate.field,
        rawInput: candidate.rawInput,
        correctedValue: winner.correctedValue,
        occurrences: winner.occurrences,
        contradictions,
        score,
      })
      continue
    }

    const type = normalizeType(candidate.field)

    const pref = await upsertPreference({
      tenantId,
      rawInput: candidate.rawInput,
      correctedValue: winner.correctedValue,
      type,
      confidence: score,
    })

    promoted.push({
      field: candidate.field,
      rawInput: candidate.rawInput,
      correctedValue: winner.correctedValue,
      occurrences: winner.occurrences,
      contradictions,
      score,
      preferenceId: pref._id,
    })
  }

  return {
    promoted,
    skipped,
  }
}