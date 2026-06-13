// 📁 src/controller/aiAgentEventCtrl.js
import asyncHandler from 'express-async-handler'
import { registerAiAgentEvent } from '../services/aiAgent/aiAgentEventService.js'

const clean = value => String(value || '').trim()

const getTenantId = req => {
  return req.tenant?._id || req.resolvedTenant?._id || req.tenantId || req.user?.tenantId
}

export const trackAiAgentEvent = asyncHandler(async (req, res) => {
  const tenantId = getTenantId(req)

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  const event = await registerAiAgentEvent({
    tenantId,
    conversationId: req.body?.conversationId,
    channel: clean(req.body?.channel || 'webchat'),
    externalUserId: clean(req.body?.externalUserId),
    type: clean(req.body?.type),
    actionType: clean(req.body?.actionType),
    productId: req.body?.productId,
    couponCode: req.body?.couponCode,
    value: req.body?.value,
    metadata: {
      label: req.body?.label,
      url: req.body?.url,
      intent: req.body?.intent,
      leadScore: req.body?.leadScore,
      path: req.body?.path,
      rawAction: req.body?.rawAction,
      userAgent: req.headers['user-agent'],
    },
  })

  return res.status(201).json({
    success: true,
    data: event,
  })
})