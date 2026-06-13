// 📁 src/controller/aiWebchatCtrl.js
import asyncHandler from 'express-async-handler'
import { processAgentMessage } from '../services/aiAgent/aiAgentBrainService.js'
import { getUserIdFromRequest } from '../utils/requestContext.js'
import User from '../models/userModel.js'
import Tenant from '../models/tenantModel.js'

const clean = value => String(value || '').trim()

const normalizeDomain = value => {
  return clean(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

const createSessionId = () => {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const getSessionId = req => {
  return clean(req.body?.sessionId)
}

const getVisitorId = req => {
  return clean(req.body?.visitorId)
}

const buildExternalUserId = ({
  sessionId,
  visitorId,
  customerEmail,
  customerPhone,
  user,
}) => {
  if (customerEmail) return `email:${clean(customerEmail).toLowerCase()}`
  if (customerPhone) return `phone:${clean(customerPhone)}`
  if (user?._id) return `user:${String(user._id)}`
  if (visitorId) return `visitor:${clean(visitorId)}`
  if (sessionId) return `session:${clean(sessionId)}`

  return `anonymous:${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const getRequestUser = async req => {
  const userId = getUserIdFromRequest(req)

  if (!userId) return null

  try {
    return await User.findById(userId)
      .select('_id name firstname lastname email phone tenantId')
      .lean()
  } catch {
    return null
  }
}

const buildTenantQuery = tenantDomain => {
  const domain = normalizeDomain(tenantDomain)

  if (!domain) return null

  return {
    $or: [
      { domain },
      { customDomain: domain },
      { subdomain: domain },
      { publicDomain: domain },
      { storefrontDomain: domain },
      { websiteDomain: domain },

      // Para estructuras tipo:
      // domains: [{ host: 'henko.local' }]
      { 'domains.host': domain },
      { 'domains.hostname': domain },
      { 'domains.domain': domain },
      { 'domains.value': domain },
      { 'domains.name': domain },

      // Para estructuras tipo:
      // settings.domain / storefront.domain
      { 'settings.domain': domain },
      { 'storefront.domain': domain },
      { 'storefront.host': domain },
    ],
  }
}

const resolveTenantForWebchat = async ({ req, user }) => {
  const existingTenant = req.tenant || req.resolvedTenant || null
  const existingTenantId =
    req.tenant?._id ||
    req.resolvedTenant?._id ||
    req.tenantId ||
    user?.tenantId ||
    null

  if (existingTenantId) {
    return {
      tenant: existingTenant && typeof existingTenant === 'object' ? existingTenant : null,
      tenantId: existingTenantId,
    }
  }

  const rawTenantDomain =
    req.body?.tenantDomain ||
    req.headers['x-tenant-domain'] ||
    req.headers.origin ||
    req.headers.referer ||
    ''

  const tenantQuery = buildTenantQuery(rawTenantDomain)

  if (!tenantQuery) {
    return {
      tenant: null,
      tenantId: null,
    }
  }

  const tenant = await Tenant.findOne(tenantQuery).lean()

  return {
    tenant,
    tenantId: tenant?._id || null,
  }
}

const buildCustomerData = ({ req, user }) => {
  const bodyName = clean(req.body?.customerName)
  const bodyEmail = clean(req.body?.customerEmail).toLowerCase()
  const bodyPhone = clean(req.body?.customerPhone)

  const userName = clean(
    user?.name ||
      [user?.firstname, user?.lastname].filter(Boolean).join(' '),
  )

  return {
    customerName: bodyName || userName,
    customerEmail: bodyEmail || clean(user?.email).toLowerCase(),
    customerPhone: bodyPhone || clean(user?.phone),
  }
}

export const sendWebchatMessage = asyncHandler(async (req, res) => {
  const message = clean(req.body?.message)
  const requestSessionId = getSessionId(req)
  const sessionId = requestSessionId || createSessionId()
  const visitorId = getVisitorId(req)

  const user = await getRequestUser(req)

  const { tenant, tenantId } = await resolveTenantForWebchat({
    req,
    user,
  })

  const { customerName, customerEmail, customerPhone } = buildCustomerData({
    req,
    user,
  })

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: 'Tenant no resuelto',
      debug:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
            bodyTenantDomain: req.body?.tenantDomain,
            normalizedTenantDomain: normalizeDomain(req.body?.tenantDomain),
            headerTenantDomain: req.headers['x-tenant-domain'],
            origin: req.headers.origin,
            referer: req.headers.referer,
            reqTenantId: req.tenantId,
            hasReqTenant: Boolean(req.tenant),
            hasResolvedTenant: Boolean(req.resolvedTenant),
            userTenantId: user?.tenantId || null,
          },
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
    sessionId: requestSessionId || sessionId,
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

