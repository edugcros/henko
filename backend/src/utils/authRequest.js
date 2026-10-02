import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

import { isValidObjectId } from './requestContext.js'
import { getSessionCookieNames } from './cookieHelper.js'

export const parseBearer = req => {
  const auth = req.headers?.authorization
  if (!auth) return null

  const [type, token] = auth.split(' ')
  return type?.toLowerCase() === 'bearer' && token ? token : null
}

export const getAccessTokenFromRequest = req => {
  // El nombre depende de la app que hace la petición: panel y tienda tienen
  // cookies distintas porque comparten host de API y partición, y con un solo
  // nombre el último login pisaba al otro. El porqué está en cookieHelper.
  //
  // Se lee SOLO el nombre de la superficie, sin caer al otro. Caer sería
  // volver a traer el bug: el panel leería la sesión del comprador y seguiría
  // devolviendo 403.
  const { access } = getSessionCookieNames(req)

  return (
    parseBearer(req) ||
    req.cookies?.[access] ||
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
