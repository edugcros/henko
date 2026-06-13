// 📁 src/controller/aiAgentCtrl.js
import AiAgent from '../models/aiAgentModel.js'
import AiConversation from '../models/aiConversationModel.js'
import AiKnowledge from '../models/aiKnowledgeModel.js'
import AiLead from '../models/aiLeadModel.js'
import AiCartRecovery from '../models/aiCartRecoveryModel.js'
import AiCampaignRule from '../models/aiCampaignRuleModel.js'
import { processAgentMessage } from '../services/aiAgent/aiAgentBrainService.js'

const getTenantId = req => req.tenant?._id || req.tenantId || req.user?.tenantId

export const getAiAgentConfig = async (req, res) => {
  const tenantId = getTenantId(req)
  const agent = await AiAgent.findOne({ tenantId }).setOptions({ tenantId }).lean()
  return res.status(200).json({ success: true, data: agent })
}

export const upsertAiAgentConfig = async (req, res) => {
  const tenantId = getTenantId(req)
  const payload = { ...req.body, tenantId }
  const agent = await AiAgent.findOneAndUpdate({ tenantId }, payload, { upsert: true, new: true, setDefaultsOnInsert: true }).setOptions({ tenantId })
  return res.status(200).json({ success: true, data: agent })
}

export const testAiAgentMessage = async (req, res) => {
  const tenantId = getTenantId(req)
  const { message, externalUserId = 'test-user' } = req.body
  const result = await processAgentMessage({ tenantId, tenant: req.tenant, channel: 'webchat', externalUserId, customerName: 'Usuario Test', text: message })
  return res.status(200).json({ success: true, data: result })
}

export const listAiConversations = async (req, res) => {
  const tenantId = getTenantId(req)
  const page = Math.max(Number(req.query.page || 1), 1)
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
  const filter = { tenantId }
  if (req.query.status) filter.status = req.query.status
  const [items, total] = await Promise.all([
    AiConversation.find(filter).setOptions({ tenantId }).sort({ lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AiConversation.countDocuments(filter).setOptions({ tenantId }),
  ])
  return res.status(200).json({ success: true, data: { items, total, page, limit } })
}

export const listAiLeads = async (req, res) => {
  const tenantId = getTenantId(req)
  const items = await AiLead.find({ tenantId }).setOptions({ tenantId }).sort({ score: -1, lastInteractionAt: -1 }).limit(100).lean()
  return res.status(200).json({ success: true, data: items })
}

export const listCartRecoveries = async (req, res) => {
  const tenantId = getTenantId(req)
  const items = await AiCartRecovery.find({ tenantId }).setOptions({ tenantId }).sort({ createdAt: -1 }).limit(100).lean()
  return res.status(200).json({ success: true, data: items })
}

export const createKnowledgeItem = async (req, res) => {
  const tenantId = getTenantId(req)
  const item = await AiKnowledge.create({ ...req.body, tenantId, source: 'admin', status: req.body.status || 'approved', approvedBy: req.user?._id || null, approvedAt: req.body.status === 'pending_approval' ? null : new Date() })
  return res.status(201).json({ success: true, data: item })
}

export const approveKnowledgeItem = async (req, res) => {
  const tenantId = getTenantId(req)
  const item = await AiKnowledge.findOneAndUpdate({ _id: req.params.id, tenantId }, { status: 'approved', approvedBy: req.user?._id || null, approvedAt: new Date() }, { new: true }).setOptions({ tenantId })
  return res.status(200).json({ success: true, data: item })
}

export const upsertCampaignRule = async (req, res) => {
  const tenantId = getTenantId(req)
  const rule = await AiCampaignRule.findOneAndUpdate({ _id: req.params.id || req.body._id, tenantId }, { ...req.body, tenantId }, { upsert: Boolean(req.body._id || req.params.id), new: true, setDefaultsOnInsert: true }).setOptions({ tenantId })
  return res.status(200).json({ success: true, data: rule })
}
