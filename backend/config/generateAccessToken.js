// 📁 config/generateAccessToken.js
import jwt from 'jsonwebtoken'
import { env } from './env.js'

const getIssuer = () => env.jwtIssuer || 'commerce-platform-api'
const getAudience = () => env.jwtAudience || 'commerce-platform-client'
const TOKEN_VERSION = 1
const RESERVED_CLAIMS = new Set([
  'sub',
  'iss',
  'aud',
  'iat',
  'exp',
  'nbf',
  'jti',
  'ver',
])

const sanitizeExtraPayload = payload => {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key]) => !RESERVED_CLAIMS.has(key)),
  )
}

/**
 * Genera access token seguro para arquitectura multi-tenant.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{
 *   tenantId: string|import('mongoose').Types.ObjectId,
 *   role: string,
 *   email?: string,
 *   [key: string]: any
 * }} extraPayload
 * @returns {string}
 */
export const generateAccessToken = (userId, extraPayload = {}) => {
  if (!userId) {
    throw new Error('userId es requerido para generar access token')
  }

  if (!extraPayload.tenantId) {
    throw new Error('tenantId es requerido para arquitectura multi-tenant')
  }

  if (!extraPayload.role) {
    throw new Error('role es requerido para control de permisos')
  }

  const safeExtraPayload = sanitizeExtraPayload(extraPayload)

  const payload = {
    ...safeExtraPayload,
    sub: String(userId),
    tenantId: String(extraPayload.tenantId),
    role: String(extraPayload.role),
    iss: getIssuer(),
    aud: getAudience(),
    ver: TOKEN_VERSION,
  }

  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtAccessExpires,
    algorithm: 'HS256',
  })
}

export default generateAccessToken
