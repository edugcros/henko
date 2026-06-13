// 📁 src/services/aiAgent/aiAgentToolService.js
import AiKnowledge from '../../models/aiKnowledgeModel.js'

const clean = value => String(value || '').trim()

const escapeRegex = value => {
  return clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const buildSearchRegex = query => {
  const words = clean(query)
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length >= 3)
    .slice(0, 8)

  if (!words.length) return null

  return new RegExp(words.map(escapeRegex).join('|'), 'i')
}

export const searchRelevantKnowledgeForAgent = async ({
  tenantId,
  query,
  limit = 6,
} = {}) => {
  if (!tenantId) return []

  const cleanLimit = Math.min(Math.max(Number(limit || 6), 1), 20)
  const cleanQuery = clean(query)

  if (!cleanQuery) {
    return AiKnowledge.find({
      tenantId,
      status: 'approved',
    })
      .setOptions({ tenantId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(cleanLimit)
      .lean()
  }

  try {
    return await AiKnowledge.find(
      {
        tenantId,
        status: 'approved',
        $text: { $search: cleanQuery },
      },
      {
        score: { $meta: 'textScore' },
      },
    )
      .setOptions({ tenantId })
      .sort({ score: { $meta: 'textScore' } })
      .limit(cleanLimit)
      .lean()
  } catch {
    const regex = buildSearchRegex(cleanQuery)

    if (!regex) return []

    return AiKnowledge.find({
      tenantId,
      status: 'approved',
      $or: [{ title: regex }, { content: regex }, { tags: regex }],
    })
      .setOptions({ tenantId })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(cleanLimit)
      .lean()
  }
}