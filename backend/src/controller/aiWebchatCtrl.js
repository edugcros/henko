// 📁 src/controller/aiWebchatCtrl.js
import asyncHandler from 'express-async-handler'
import { processAgentMessage } from '../services/aiAgent/aiAgentBrainService.js'
import { getUserIdFromRequest } from '../utils/requestContext.js'
import User from '../models/userModel.js'

const clean = value => String(value || '').trim()

const createSessionId = () => {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const getSessionId = req => {
  return clean(req.body?.sessionId || req.headers['x-ai-session-id']).slice(0, 160)
}

const getVisitorId = req => {
  return clean(req.body?.visitorId || req.headers['x-ai-visitor-id']).slice(0, 160)
}

const buildExternalUserId = ({
  sessionId,
  visitorId,
  customerEmail,
  customerPhone,
  user,
}) => {
  // Para webchat comercial, la conversación debe poder separarse por sesión.
  // Email/teléfono se usan para fusionar/actualizar Lead, no necesariamente para agrupar chat.
  if (sessionId) return `session:${clean(sessionId)}`
  if (visitorId) return `visitor:${clean(visitorId)}`
  if (customerEmail) return `email:${clean(customerEmail).toLowerCase()}`
  if (customerPhone) return `phone:${clean(customerPhone)}`
  if (user?._id) return `user:${String(user._id)}`

  return `anonymous:${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const getRequestUser = async req => {
  const userId = getUserIdFromRequest(req)

  if (!userId) return null

  try {
    return await User.findById(userId)
      .select('_id name firstname lastname email phone mobile tenantId')
      .lean()
  } catch {
    return null
  }
}

const buildCustomerData = ({ req, user }) => {
  const bodyName = clean(req.body?.customerName).slice(0, 160)
  const bodyEmail = clean(req.body?.customerEmail)
    .toLowerCase()
    .slice(0, 320)
  const bodyPhone = clean(req.body?.customerPhone).slice(0, 40)

  const userName = clean(
    user?.name ||
      [user?.firstname, user?.lastname].filter(Boolean).join(' '),
  ).slice(0, 160)

  return {
    customerName: bodyName || userName,
    customerEmail: bodyEmail || clean(user?.email).toLowerCase().slice(0, 320),
    customerPhone: bodyPhone || clean(user?.phone || user?.mobile).slice(0, 40),
  }
}

export const sendWebchatMessage = asyncHandler(async (req, res) => {
  const message = clean(req.body?.message)
  const requestSessionId = getSessionId(req)
  const sessionId = requestSessionId || createSessionId()
  const visitorId = getVisitorId(req)

  const user = await getRequestUser(req)
  const tenant = req.tenant || null
  const tenantId = req.tenantId || req.tenant?._id || null

  const { customerName, customerEmail, customerPhone } = buildCustomerData({
    req,
    user,
  })

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
    })
  }

  if (!message) {
    return res.status(400).json({
      success: false,
      message: 'Mensaje vacío',
    })
  }

  if (message.length > 1000) {
    return res.status(400).json({
      success: false,
      message: 'Mensaje demasiado largo',
    })
  }

  const externalUserId = buildExternalUserId({
    sessionId,
    visitorId,
    customerEmail,
    customerPhone,
    user,
  })

  const result = await processAgentMessage({
    tenantId,
    tenant,
    channel: 'webchat',
    externalUserId,
    customerName,
    customerEmail,
    customerPhone,
    text: message,
    externalMessageId: clean(req.body?.messageId || req.body?.eventId).slice(
      0,
      200,
    ),
  })

  return res.status(200).json({
    success: true,
    data: {
      sessionId,
      visitorId,
      externalUserId,
      ...result,
    },
  })
})
