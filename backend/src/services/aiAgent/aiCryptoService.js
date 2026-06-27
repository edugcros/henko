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

  // Permite clave base64/base64url de 32 bytes, hex de 32 bytes o frase fuerte.
  try {
    const decoded = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (decoded.length === 32) return decoded
  } catch {
    // fallback a hex / hash
  }

  if (/^[a-f0-9]{64}$/i.test(secret)) {
    return Buffer.from(secret, 'hex')
  }

  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('AI_AGENT_SECRET_ENCRYPTION_KEY debe tener al menos 32 caracteres en producción')
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

  return [
    'v1',
    iv.toString(ENCODING),
    tag.toString(ENCODING),
    encrypted.toString(ENCODING),
  ].join('.')
}

export const decryptSecret = value => {
  const encryptedValue = clean(value)
  if (!encryptedValue) return ''

  const [version, ivEncoded, tagEncoded, payloadEncoded] =
    encryptedValue.split('.')

  if (version !== 'v1' || !ivEncoded || !tagEncoded || !payloadEncoded) {
    const allowLegacyPlaintext =
      process.env.NODE_ENV !== 'production' ||
      process.env.AI_AGENT_ALLOW_LEGACY_PLAINTEXT_SECRETS === 'true'

    if (!allowLegacyPlaintext) {
      throw new Error(
        'Se detectó un secreto legacy sin cifrar. Ejecute la migración antes de iniciar producción.',
      )
    }

    return encryptedValue
  }

  const key = getKey()
  const iv = Buffer.from(ivEncoded, ENCODING)
  const tag = Buffer.from(tagEncoded, ENCODING)
  const payload = Buffer.from(payloadEncoded, ENCODING)

  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || payload.length === 0) {
    throw new Error('Formato de secreto cifrado inválido')
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  })
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(payload), decipher.final()]).toString(
    'utf8',
  )
}

export const maskSecret = value => {
  const cleanValue = clean(value)
  if (!cleanValue) return ''
  if (cleanValue.length <= 10) return '***'
  return `${cleanValue.slice(0, 6)}***${cleanValue.slice(-4)}`
}
