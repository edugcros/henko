// 📁 config/generateRefreshToken.js
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { env } from './env.js'

const ISSUER = 'henko-commerce-api'
const AUDIENCE = 'henko-commerce-client'
const TOKEN_VERSION = 1

/**
 * Genera refresh token seguro con jti hasheado para almacenar en DB.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{
 *   tenantId: string|import('mongoose').Types.ObjectId,
 *   role?: string,
 *   [key: string]: any
 * }} extraPayload
 * @returns {Promise<{refreshToken:string, hashedJti:string, jti:string}>}
 */
export const generateRefreshToken = async (userId, extraPayload = {}) => {
  if (!userId) {
    throw new Error('userId es requerido para generar refresh token')
  }

  if (!extraPayload.tenantId) {
    throw new Error('tenantId es requerido para refresh token multi-tenant')
  }

  const jti = crypto.randomUUID()

  const payload = {
    sub: String(userId),
    tenantId: String(extraPayload.tenantId),
    role: String(extraPayload.role || 'user'),
    jti,
    type: 'refresh',
    iss: ISSUER,
    aud: AUDIENCE,
    ver: TOKEN_VERSION,
  }

  const refreshToken = jwt.sign(payload, env.refreshTokenSecret, {
    expiresIn: env.jwtRefreshExpires,
    algorithm: 'HS256',
  })

  const hashedJti = await bcrypt.hash(jti, 10)

  return {
    refreshToken,
    hashedJti,
    jti,
  }
}

/**
 * Verifica refresh token.
 *
 * @param {string} token
 * @returns {Promise<Object>}
 */
export const verifyRefreshToken = async token => {
  if (!token) {
    throw new Error('Refresh token requerido')
  }

  try {
    return jwt.verify(token, env.refreshTokenSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    })
  } catch (err) {
    const error = new Error('Refresh token inválido o expirado')
    error.cause = err
    throw error
  }
}

export default generateRefreshToken