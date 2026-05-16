// 📁 config/generateAccessToken.js
import jwt from 'jsonwebtoken'
import { env } from './env.js'

const ISSUER = 'henko-commerce-api'
const AUDIENCE = 'henko-commerce-client'
const TOKEN_VERSION = 1

const sanitizeExtraPayload = payload => {
  const {
    sub,
    iss,
    aud,
    iat,
    exp,
    nbf,
    jti,
    ver,
    ...safePayload
  } = payload || {}

  return safePayload
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
    iss: ISSUER,
    aud: AUDIENCE,
    ver: TOKEN_VERSION,
  }

  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtAccessExpires,
    algorithm: 'HS256',
  })
}

export default generateAccessToken