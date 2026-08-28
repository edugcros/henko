// 📁 config/generateRefreshToken.js
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { env } from './env.js'

const getIssuer = () => env.jwtIssuer || 'commerce-platform-api'
const getAudience = () => env.jwtAudience || 'commerce-platform-client'
const TOKEN_VERSION = 1

// Sesión de admin: se cierra por inactividad (1h por defecto), no por
// tiempo fijo — cada refresh vuelve a extender la ventana. Se firma acá,
// en el propio JWT (no solo en el maxAge de la cookie en userCtrl.js), para
// que la expiración quede garantizada en las dos capas — la cookie y el
// token firmado — de forma consistente. No afecta a clientes de la tienda
// (siguen con env.jwtRefreshExpires, 7 días).
const getRefreshExpiresIn = role =>
  role === 'admin'
    ? process.env.JWT_ADMIN_REFRESH_EXPIRES || '1h'
    : env.jwtRefreshExpires

/**
 * Hash determinístico del jti (un UUID random, 122 bits de entropía — no un
 * secreto de baja entropía tipo password) para guardar en Mongo. Antes se
 * usaba bcrypt (lento, salteado a propósito para passwords humanos) — eso
 * hacía imposible comparar el jti recibido contra la DB con una query
 * directa, así que handleRefreshToken tenía que leer el usuario, comparar
 * en memoria, y recién ahí escribir: tres pasos separados, sin atomicidad.
 * Dos requests de refresh casi simultáneas (ej. varios componentes del
 * dashboard reaccionando en paralelo a un token de acceso vencido tras un
 * reload) podían leer el MISMO refreshToken válido, pasar las dos el
 * compare, y pisarse la escritura una a la otra — la cookie que terminaba
 * en el navegador podía no coincidir con lo que quedó persistido, y el
 * PRÓXIMO refresh fallaba con "Token de refresco inválido" aunque la
 * sesión fuera legítima. HMAC-SHA256 con este mismo secreto es determinístico
 * (permite un findOneAndUpdate atómico con compare-and-swap real) y sigue
 * siendo seguro para este uso: no hay password de por medio que un rainbow
 * table pueda atacar, el jti ya es aleatorio y sin significado por sí solo.
 */
export const hashRefreshJti = jti =>
  crypto.createHmac('sha256', env.refreshTokenSecret).update(String(jti)).digest('hex')

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
    iss: getIssuer(),
    aud: getAudience(),
    ver: TOKEN_VERSION,
  }

  const refreshToken = jwt.sign(payload, env.refreshTokenSecret, {
    expiresIn: getRefreshExpiresIn(extraPayload.role),
    algorithm: 'HS256',
  })

  const hashedJti = hashRefreshJti(jti)

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
      issuer: getIssuer(),
      audience: getAudience(),
    })
  } catch (err) {
    const error = new Error('Refresh token inválido o expirado')
    error.cause = err
    throw error
  }
}

export default generateRefreshToken