// 📁 src/services/aiAgent/aiCryptoService.js
// Cifrado AES-256-GCM para tokens sensibles del Agente IA.
import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const ENCODING = 'base64url'

const clean = value => String(value || '').trim()

const getKey = () => {
  const secret = clean(process.env.AI_AGENT_SECRET_ENCRYPTION_KEY)

  if (!secret) {
    throw new Error('AI_AGENT_SECRET_ENCRYPTION_KEY es obligatorio')
  }

  // Permite clave base64 de 32 bytes o frase fuerte que se deriva con SHA-256.
  try {
    const decoded = Buffer.from(secret, 'base64')
    if (decoded.length === 32) return decoded
  } catch {
    // fallback a hash
  }

  return crypto.createHash('sha256').update(secret).digest()
}

export const encryptSecret = value => {
  const plainText = clean(value)
  if (!plainText) return ''

  const key = getKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  })

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return ['v1', iv.toString(ENCODING), tag.toString(ENCODING), encrypted.toString(ENCODING)].join('.')
}

export const decryptSecret = value => {
  const encryptedValue = clean(value)
  if (!encryptedValue) return ''

  const [version, ivEncoded, tagEncoded, payloadEncoded] = encryptedValue.split('.')

  if (version !== 'v1' || !ivEncoded || !tagEncoded || !payloadEncoded) {
    // Compatibilidad: si todavía está plano en DB, lo devuelve como está.
    return encryptedValue
  }

  const key = getKey()
  const iv = Buffer.from(ivEncoded, ENCODING)
  const tag = Buffer.from(tagEncoded, ENCODING)
  const payload = Buffer.from(payloadEncoded, ENCODING)

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  })
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
}

export const maskSecret = value => {
  const cleanValue = clean(value)
  if (!cleanValue) return ''
  if (cleanValue.length <= 10) return '***'
  return `${cleanValue.slice(0, 6)}***${cleanValue.slice(-4)}`
}
