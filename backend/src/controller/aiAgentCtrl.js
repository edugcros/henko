// 📁 src/controller/aiAgentCtrl.js
import asyncHandler from 'express-async-handler'
import AiAgent from '../models/aiAgentModel.js'
import AiKnowledge from '../models/aiKnowledgeModel.js'
import AiCartRecovery from '../models/aiCartRecoveryModel.js'
import AiCampaignRule from '../models/aiCampaignRuleModel.js'
import { processAgentMessage } from '../services/aiAgent/aiAgentBrainService.js'
import {
  getOrCreateAiAgentForTenant,
  provisionAiAgentDefaultsForTenant,
} from '../services/aiAgent/aiAgentProvisioningService.js'
import {
  isValidObjectId,
  resolveAuthorizedTenantFromRequest,
} from '../utils/requestContext.js'

const clean = value => String(value || '').trim()
const requireTenantId = req =>
  resolveAuthorizedTenantFromRequest(req, {
    requireUserTenant: true,
  }).tenantId
const toBoolean = value => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return Boolean(value)
}

const toBoundedNumber = (value, { min, max, fallback }) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(number, min), max)
}

const cleanStringList = (value, maxItems = 50) => {
  if (!Array.isArray(value)) return []
  return value
    .map(clean)
    .filter(Boolean)
    .slice(0, maxItems)
}

const allowedKnowledgeTypes = new Set([
  'faq',
  'policy',
  'product_hint',
  'objection',
  'sales_script',
  'custom',
  'learning_suggestion',
])
const allowedRuleTypes = new Set([
  'abandoned_cart',
  'lead_follow_up',
  'post_purchase',
  'winback',
])
const allowedRuleChannels = new Set(['whatsapp', 'email'])
const allowedTones = new Set([
  'formal',
  'friendly',
  'premium',
  'technical',
  'sales',
])
const BUSINESS_HOUR_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

const isMaskedSecret = value => clean(value).includes('***')

const cleanFaq = value => {
  if (!Array.isArray(value)) return []

  return value
    .map(item => ({
      question: clean(item?.question).slice(0, 500),
      answer: clean(item?.answer).slice(0, 2500),
      enabled: item?.enabled === undefined ? true : toBoolean(item.enabled),
    }))
    .filter(item => item.question && item.answer)
    .slice(0, 100)
}

const buildAgentConfigUpdate = body => {
  const update = {}

  if (body.name !== undefined) update.name = clean(body.name).slice(0, 100)
  if (body.enabled !== undefined) update.enabled = toBoolean(body.enabled)

  if (body.channels?.webchat) {
    if (body.channels.webchat.enabled !== undefined) {
      update['channels.webchat.enabled'] = toBoolean(
        body.channels.webchat.enabled,
      )
    }
  }

  if (body.channels?.whatsapp) {
    const whatsapp = body.channels.whatsapp
    if (whatsapp.enabled !== undefined) {
      update['channels.whatsapp.enabled'] = toBoolean(whatsapp.enabled)
    }
    for (const field of [
      'phoneNumberId',
      'businessAccountId',
      'webchatUrl',
      'accessToken',
      'appSecret',
      'verifyToken',
    ]) {
      if (
        whatsapp[field] !== undefined &&
        !isMaskedSecret(whatsapp[field])
      ) {
        update[`channels.whatsapp.${field}`] = clean(whatsapp[field]).slice(
          0,
          field === 'accessToken' || field === 'appSecret' ? 2000 : 300,
        )
      }
    }
  }

  for (const [section, allowedFields] of Object.entries({
    personality: ['tone', 'language', 'signature'],
    behavior: [
      'canRecommendProducts',
      'canCreateCartLinks',
      'canOfferDiscounts',
      'requireHumanForPayments',
      'requireHumanForClaims',
      'maxMessagesBeforeHuman',
      'minConfidenceToAnswer',
    ],
    guardrails: ['blockedTopics', 'humanHandoffKeywords', 'optOutKeywords'],
    learning: ['enabled', 'requireApproval'],
  })) {
    for (const field of allowedFields) {
      if (body?.[section]?.[field] !== undefined) {
        const value = body[section][field]

        if (
          section === 'guardrails' &&
          ['blockedTopics', 'humanHandoffKeywords', 'optOutKeywords'].includes(
            field,
          )
        ) {
          update[`${section}.${field}`] = cleanStringList(value, 80)
        } else if (
          section === 'behavior' &&
          field === 'maxMessagesBeforeHuman'
        ) {
          update[`${section}.${field}`] = toBoundedNumber(value, {
            min: 1,
            max: 80,
            fallback: 14,
          })
        } else if (
          section === 'behavior' &&
          field === 'minConfidenceToAnswer'
        ) {
          update[`${section}.${field}`] = toBoundedNumber(value, {
            min: 0,
            max: 1,
            fallback: 0.55,
          })
        } else if (section === 'personality' && field === 'tone') {
          const tone = clean(value)
          if (allowedTones.has(tone)) update[`${section}.${field}`] = tone
        } else if (section === 'personality' && field === 'signature') {
          update[`${section}.${field}`] = clean(value).slice(0, 250)
        } else if (
          section === 'behavior' ||
          section === 'learning'
        ) {
          update[`${section}.${field}`] = toBoolean(value)
        } else {
          update[`${section}.${field}`] = clean(value).slice(0, 500)
        }
      }
    }
  }

  if (body.businessContext?.description !== undefined) {
    update['businessContext.description'] = clean(
      body.businessContext.description,
    ).slice(0, 5000)
  }
  if (body.businessContext?.faq !== undefined) {
    update['businessContext.faq'] = cleanFaq(body.businessContext.faq)
  }
  for (const field of ['shipping', 'returns', 'payments', 'privacy']) {
    if (body.businessContext?.policies?.[field] !== undefined) {
      update[`businessContext.policies.${field}`] = clean(
        body.businessContext.policies[field],
      ).slice(0, 4000)
    }
  }

  if (body.quotas?.monthlyMessageLimit !== undefined) {
    update['quotas.monthlyMessageLimit'] = toBoundedNumber(
      body.quotas.monthlyMessageLimit,
      { min: 0, max: 1000000, fallback: 0 },
    )
  }
  if (body.quotas?.monthlyAiTokenLimit !== undefined) {
    update['quotas.monthlyAiTokenLimit'] = toBoundedNumber(
      body.quotas.monthlyAiTokenLimit,
      { min: 0, max: 1000000000, fallback: 0 },
    )
  }

  return update
}

export const getAiAgentConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const agent = await getOrCreateAiAgentForTenant({
    tenantId,
    tenant: req.tenant,
  })

  return res.status(200).json({ success: true, data: agent })
})

export const upsertAiAgentConfig = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const payload = buildAgentConfigUpdate(req.body || {})
  const agent = await AiAgent.findOneAndUpdate(
    { tenantId },
    {
      $set: payload,
      $setOnInsert: { tenantId },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  ).setOptions({ tenantId })

  await provisionAiAgentDefaultsForTenant({
    tenantId,
    tenant: req.tenant,
  })

  return res.status(200).json({ success: true, data: agent })
})

export const testAiAgentMessage = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const message = clean(req.body?.message)
  const externalUserId =
    clean(req.body?.externalUserId).slice(0, 160) || 'admin-test-user'

  if (!message || message.length > 2000) {
    return res.status(400).json({
      success: false,
      message: 'El mensaje debe tener entre 1 y 2000 caracteres',
    })
  }

  const result = await processAgentMessage({
    tenantId,
    tenant: req.tenant,
    channel: 'webchat',
    externalUserId,
    customerName: 'Usuario Test',
    text: message,
  })
  return res.status(200).json({ success: true, data: result })
})

export const listCartRecoveries = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const items = await AiCartRecovery.find({ tenantId })
    .setOptions({ tenantId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
  return res.status(200).json({ success: true, data: items })
})

export const createKnowledgeItem = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const title = clean(req.body.title).slice(0, 200)
  const content = clean(req.body.content).slice(0, 10000)
  const type = clean(req.body.type) || 'custom'
  const status =
    req.body.status === 'pending_approval' ? 'pending_approval' : 'approved'

  if (!allowedKnowledgeTypes.has(type)) {
    return res.status(400).json({
      success: false,
      message: 'Tipo de conocimiento inválido',
    })
  }

  if (!title || !content) {
    return res.status(400).json({
      success: false,
      message: 'Título y contenido son obligatorios',
    })
  }

  const item = await AiKnowledge.create({
    tenantId,
    type,
    title,
    content,
    confidence: toBoundedNumber(req.body.confidence, {
      min: 0,
      max: 1,
      fallback: 1,
    }),
    tags: cleanStringList(req.body.tags),
    source: 'admin',
    status,
    approvedBy: req.user?._id || null,
    approvedAt: status === 'pending_approval' ? null : new Date(),
  })

  return res.status(201).json({ success: true, data: item })
})

export const approveKnowledgeItem = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'ID de conocimiento inválido',
    })
  }

  const item = await AiKnowledge.findOneAndUpdate(
    { _id: req.params.id, tenantId },
    {
      status: 'approved',
      approvedBy: req.user?._id || null,
      approvedAt: new Date(),
    },
    { new: true },
  ).setOptions({ tenantId })

  if (!item) {
    return res.status(404).json({
      success: false,
      message: 'Conocimiento no encontrado',
    })
  }

  return res.status(200).json({ success: true, data: item })
})

export const upsertCampaignRule = asyncHandler(async (req, res) => {
  const tenantId = requireTenantId(req)
  const ruleId = clean(req.params.id || req.body._id)
  const body = req.body || {}
  const type = clean(body.type)
  const channel = clean(body.channel) || 'whatsapp'
  const name = clean(body.name).slice(0, 150)
  const messageTemplate = clean(body.messageTemplate).slice(0, 2000)
  const businessHoursStart = clean(body.trigger?.businessHours?.start) || '09:00'
  const businessHoursEnd = clean(body.trigger?.businessHours?.end) || '20:00'

  if (!name || !messageTemplate) {
    return res.status(400).json({
      success: false,
      message: 'Nombre y plantilla de mensaje son obligatorios',
    })
  }

  if (!allowedRuleTypes.has(type)) {
    return res.status(400).json({
      success: false,
      message: 'Tipo de regla inválido',
    })
  }

  if (!allowedRuleChannels.has(channel)) {
    return res.status(400).json({
      success: false,
      message: 'Canal de regla inválido',
    })
  }

  if (
    !BUSINESS_HOUR_REGEX.test(businessHoursStart) ||
    !BUSINESS_HOUR_REGEX.test(businessHoursEnd)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Horario comercial inválido. Use HH:mm',
    })
  }

  const payload = {
    tenantId,
    name,
    type,
    enabled: body.enabled === undefined ? true : toBoolean(body.enabled),
    channel,
    messageTemplate,
    useAiPersonalization:
      body.useAiPersonalization === undefined
        ? true
        : toBoolean(body.useAiPersonalization),
    trigger: {
      delayMinutes: toBoundedNumber(body.trigger?.delayMinutes, {
        min: 1,
        max: 43200,
        fallback: 30,
      }),
      minCartAmountCents: toBoundedNumber(
        body.trigger?.minCartAmountCents,
        { min: 0, max: 100000000000, fallback: 0 },
      ),
      maxAttempts: toBoundedNumber(body.trigger?.maxAttempts, {
        min: 1,
        max: 5,
        fallback: 2,
      }),
      onlyBusinessHours:
        body.trigger?.onlyBusinessHours === undefined
          ? true
          : toBoolean(body.trigger.onlyBusinessHours),
      businessHours: {
        start: businessHoursStart,
        end: businessHoursEnd,
      },
      minHoursBetweenContacts: toBoundedNumber(
        body.trigger?.minHoursBetweenContacts,
        { min: 1, max: 168, fallback: 6 },
      ),
    },
    whatsappTemplate: {
      enabled: toBoolean(body.whatsappTemplate?.enabled),
      name: clean(body.whatsappTemplate?.name).slice(0, 120),
      languageCode:
        clean(body.whatsappTemplate?.languageCode).slice(0, 20) || 'es_AR',
    },
    offer: {
      enabled: toBoolean(body.offer?.enabled),
      couponCode: clean(body.offer?.couponCode).toUpperCase().slice(0, 80),
    },
  }

  if (!ruleId) {
    const created = await AiCampaignRule.create(payload)
    return res.status(201).json({ success: true, data: created })
  }

  if (!isValidObjectId(ruleId)) {
    return res.status(400).json({
      success: false,
      message: 'ID de regla inválido',
    })
  }

  const rule = await AiCampaignRule.findOneAndUpdate(
    { _id: ruleId, tenantId },
    { $set: payload },
    { new: true, runValidators: true },
  ).setOptions({ tenantId })

  if (!rule) {
    return res.status(404).json({
      success: false,
      message: 'Regla de campaña no encontrada',
    })
  }

  return res.status(200).json({ success: true, data: rule })
})
