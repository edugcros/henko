// 📁 src/utils/encryption.js
import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16

const getEncryptionKey = () => {
  const rawKey = String(process.env.ENCRYPTION_KEY || '')

  if (!rawKey) {
    throw new Error('Falta ENCRYPTION_KEY para operaciones de cifrado')
  }

  if (Buffer.byteLength(rawKey) !== 32) {
    throw new Error('ENCRYPTION_KEY debe tener exactamente 32 bytes')
  }

  return Buffer.from(rawKey)
}

const ENCRYPTION_KEY = getEncryptionKey()

export const encrypt = text => {
  if (!text) return null
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export const decrypt = text => {
  if (!text) return null
  const textParts = text.split(':')
  const iv = Buffer.from(textParts.shift(), 'hex')
  const encryptedText = Buffer.from(textParts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv)
  let decrypted = decipher.update(encryptedText)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString()
}
