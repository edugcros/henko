import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

import { isValidObjectId } from './requestContext.js'

export const parseBearer = req => {
  const auth = req.headers?.authorization
  if (!auth) return null

  const [type, token] = auth.split(' ')
  return type?.toLowerCase() === 'bearer' && token ? token : null
}

export const getAccessTokenFromRequest = req => {
  return (
    parseBearer(req) ||
    req.cookies?.token ||
    req.headers['x-access-token'] ||
    req.headers.token ||
    null
  )
}

export const decodeAccessToken = (
  token,
  {
    secret = process.env.JWT_SECRET,
    algorithms = ['HS256'],
  } = {},
) => {
  return jwt.verify(token, secret, { 
    algorithms,
    issuer: env.jwtIssuer || 'commerce-platform-api',
    audience: env.jwtAudience || 'commerce-platform-client', 
  })
}

export const getOptionalUserFromAccessToken = (
  req,
  {
    secret = process.env.JWT_SECRET,
    algorithms = ['HS256'],
  } = {},
) => {
  const token = getAccessTokenFromRequest(req)

  if (!token || token === 'undefined') return null

  try {
    const decoded = decodeAccessToken(token, { secret, algorithms })

    if (!isValidObjectId(decoded.sub)) return null

    return {
      id: decoded.sub,
      _id: decoded.sub,
      tenantId: decoded.tenantId,
      role: decoded.role,
      email: decoded.email || null,
      allowedTenants: Array.isArray(decoded.allowedTenants)
        ? decoded.allowedTenants
        : [],
    }
  } catch {
    return null
  }
}
